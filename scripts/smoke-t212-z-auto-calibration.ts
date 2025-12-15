import { ensureCanonicalOrHistory } from "@/lib/storage/canonical";
import { ensureDefaultTargetSpec } from "@/lib/targets/defaultSpec";
import {
  buildEwmaReactionMap,
  buildEwmaTiltConfigFromReactionMap,
  defaultReactionConfig,
} from "@/lib/volatility/ewmaReaction";
import { EwmaWalkerPoint, runEwmaWalker } from "@/lib/volatility/ewmaWalker";
import {
  simulateTrading212Cfd,
  Trading212CfdConfig,
  Trading212SimBar,
} from "@/lib/backtest/trading212Cfd";
import { CanonicalRow } from "@/lib/types/canonical";
import { parseSymbolsFromArgv } from "./_utils/cli";

const DEFAULT_SYMBOLS = ["NEE", "GD", "ABBV", "MO", "TRV"] as const;
const MIN_TRAIN_OBS = 500;
const SHRINK_FACTOR = 0.5;
const THRESHOLD_Q = 0.9;
const EXIT_RATIO = 0.3;
const FLIP_RATIO = 2.0;
const MIN_SAMPLES = 50;

type SymbolInput = string | typeof DEFAULT_SYMBOLS[number];

type EwmaRunBundle = {
  walk: { points: EwmaWalkerPoint[] };
  reactionMapTestStart: string | null;
};

function quantile(arr: number[], q: number): number {
  if (!arr.length) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function filterRowsForSim(rows: CanonicalRow[], startDate: string | null): CanonicalRow[] {
  if (!startDate) return rows;
  return rows.filter((r) => r.date >= startDate);
}

function calibrateAutoThresholds(
  path: EwmaWalkerPoint[],
  simStartDate: string | null,
  horizon: number,
  fallbackEnter: number
) {
  if (!simStartDate) {
    return {
      enterLong: fallbackEnter,
      enterShort: fallbackEnter,
      exitLong: fallbackEnter * EXIT_RATIO,
      exitShort: fallbackEnter * EXIT_RATIO,
      flipLong: fallbackEnter * FLIP_RATIO,
      flipShort: fallbackEnter * FLIP_RATIO,
    };
  }

  const sqrtH = Math.sqrt(horizon);
  const calibPoints = path
    .filter((p) => p.date_tp1 < simStartDate)
    .sort((a, b) => a.date_tp1.localeCompare(b.date_tp1))
    .slice(-252);

  const zEdges: number[] = [];
  for (const p of calibPoints) {
    const sigmaH = p.sigma_t * sqrtH;
    const muBase = Math.log(p.y_hat_tp1 / p.S_t);
    if (!Number.isFinite(muBase) || !Number.isFinite(sigmaH) || sigmaH <= 0) continue;
    zEdges.push(muBase / sigmaH);
  }

  if (zEdges.length === 0) {
    return {
      enterLong: fallbackEnter,
      enterShort: fallbackEnter,
      exitLong: fallbackEnter * EXIT_RATIO,
      exitShort: fallbackEnter * EXIT_RATIO,
      flipLong: fallbackEnter * FLIP_RATIO,
      flipShort: fallbackEnter * FLIP_RATIO,
    };
  }

  const pos = zEdges.filter((z) => z > 0);
  const neg = zEdges.filter((z) => z < 0).map((z) => -z);
  const absVals = zEdges.map((z) => Math.abs(z));

  const symEnter = quantile(absVals, THRESHOLD_Q);
  const enterLong = pos.length >= MIN_SAMPLES ? quantile(pos, THRESHOLD_Q) : symEnter;
  const enterShort = neg.length >= MIN_SAMPLES ? quantile(neg, THRESHOLD_Q) : symEnter;

  const enterLongFinal = Number.isFinite(enterLong) ? enterLong : fallbackEnter;
  const enterShortFinal = Number.isFinite(enterShort) ? enterShort : enterLongFinal;

  return {
    enterLong: enterLongFinal,
    enterShort: enterShortFinal,
    exitLong: enterLongFinal * EXIT_RATIO,
    exitShort: enterShortFinal * EXIT_RATIO,
    flipLong: enterLongFinal * FLIP_RATIO,
    flipShort: enterShortFinal * FLIP_RATIO,
  };
}

function buildBarsFromEwmaPath(
  rows: CanonicalRow[],
  path: EwmaWalkerPoint[],
  horizon: number,
  thresholds: ReturnType<typeof calibrateAutoThresholds>
): { bars: Trading212SimBar[]; fracPos: number; fracNeg: number } {
  const ewmaMap = new Map<string, EwmaWalkerPoint>();
  path.forEach((p) => ewmaMap.set(p.date_tp1, p));

  const sqrtH = Math.sqrt(horizon);
  const bars: Trading212SimBar[] = [];
  let qPrev = 0;
  let posCount = 0;
  let negCount = 0;
  let valid = 0;

  for (const row of rows) {
    const price = row.adj_close ?? row.close;
    if (!price || !row.date) continue;
    const ewma = ewmaMap.get(row.date);
    if (!ewma) continue;

    const muBase = Math.log(ewma.y_hat_tp1 / ewma.S_t);
    const sigmaH = ewma.sigma_t * sqrtH;
    if (!Number.isFinite(muBase) || !Number.isFinite(sigmaH) || sigmaH <= 0) continue;
    const zEdge = muBase / sigmaH;
    const edgeFrac = Math.exp(muBase) - 1;
    if (!Number.isFinite(edgeFrac)) continue;

    valid++;
    if (zEdge >= thresholds.enterLong) posCount++;
    if (zEdge <= -thresholds.enterShort) negCount++;

    let q = qPrev;
    if (qPrev === 0) {
      if (zEdge >= thresholds.enterLong) q = 1;
      else if (zEdge <= -thresholds.enterShort) q = -1;
    } else if (qPrev === 1) {
      if (zEdge <= -thresholds.flipShort) q = -1;
      else if (zEdge <= thresholds.exitLong) q = 0;
    } else if (qPrev === -1) {
      if (zEdge >= thresholds.flipLong) q = 1;
      else if (zEdge >= -thresholds.exitShort) q = 0;
    }
    qPrev = q;

    let signal: Trading212SimBar["signal"] = "flat";
    if (q > 0) signal = "long";
    else if (q < 0) signal = "short";

    bars.push({ date: row.date, price, signal });
  }

  return {
    bars,
    fracPos: valid > 0 ? posCount / valid : 0,
    fracNeg: valid > 0 ? negCount / valid : 0,
  };
}

async function runBiasedWalk(
  symbol: string,
  lambda: number,
  trainFraction: number,
  coverage: number,
  horizon: number
): Promise<EwmaRunBundle> {
  const reactionConfig = {
    ...defaultReactionConfig,
    lambda,
    coverage,
    trainFraction,
    minTrainObs: MIN_TRAIN_OBS,
    horizons: [horizon],
  };
  const reactionMap = await buildEwmaReactionMap(symbol, reactionConfig);
  const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor: SHRINK_FACTOR, horizon });
  const walk = await runEwmaWalker({ symbol, lambda, coverage, horizon, tiltConfig });
  return { walk, reactionMapTestStart: reactionMap.meta.testStart ?? null };
}

async function optimizeBiasedConfig(
  symbol: string,
  coverage: number,
  horizon: number
): Promise<{ lambda: number; trainFraction: number }> {
  const lambdaGrid = Array.from({ length: 11 }, (_, i) => 0.5 + i * 0.05);
  const trainGrid = Array.from({ length: 9 }, (_, i) => 0.5 + i * 0.05);
  let best: { lambda: number; trainFraction: number; score: number } | null = null;
  const minShortRate = 0.01;

  for (const lambda of lambdaGrid) {
    for (const trainFraction of trainGrid) {
      try {
        const reactionConfig = {
          ...defaultReactionConfig,
          lambda,
          coverage,
          trainFraction,
          minTrainObs: MIN_TRAIN_OBS,
          horizons: [horizon],
        };
        const reactionMap = await buildEwmaReactionMap(symbol, reactionConfig);
        const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor: SHRINK_FACTOR, horizon });
        const walk = await runEwmaWalker({ symbol, lambda, coverage, horizon, tiltConfig });
        const sqrtH = Math.sqrt(horizon);
        const edges = walk.points
          .filter((p) => p.date_t >= reactionMap.meta.trainStart && p.date_t <= reactionMap.meta.trainEnd)
          .map((p) => {
            const muBase = Math.log(p.y_hat_tp1 / p.S_t);
            const sigmaH = p.sigma_t * sqrtH;
            if (!Number.isFinite(muBase) || !Number.isFinite(sigmaH) || sigmaH <= 0) return NaN;
            return muBase / sigmaH;
          })
          .filter((z): z is number => Number.isFinite(z));
        const absEdges = edges.length > 0 ? edges.map((z) => Math.abs(z)) : [];
        const zEnterSym = absEdges.length > 0 ? quantile(absEdges, THRESHOLD_Q) : 0.3;
        const shortOpp = edges.length > 0 ? edges.filter((z) => z <= -zEnterSym).length / edges.length : 0;
        const hit = walk.points.length
          ? walk.points.filter((p) => p.directionCorrect).length / walk.points.length
          : 0;
        const score = hit - Math.max(0, minShortRate - shortOpp);
        if (!best || score > best.score) {
          best = { lambda, trainFraction, score };
        }
      } catch {
        continue;
      }
    }
  }

  return best ? { lambda: best.lambda, trainFraction: best.trainFraction } : { lambda: 0.94, trainFraction: 0.7 };
}

function countEntries(history: { side: "long" | "short" | null }[]) {
  let prev: "long" | "short" | null = null;
  let longEntries = 0;
  let shortEntries = 0;
  for (const snap of history) {
    if (snap.side !== prev) {
      if (snap.side === "long") longEntries++;
      else if (snap.side === "short") shortEntries++;
    }
    prev = snap.side;
  }
  return { longEntries, shortEntries };
}

async function runForSymbol(symbol: SymbolInput, config: Trading212CfdConfig) {
  const sym = (symbol as string).toUpperCase();
  const { rows } = await ensureCanonicalOrHistory(sym, { interval: "1d", minRows: 260 });
  const spec = await ensureDefaultTargetSpec(sym, {});
  const horizon = spec.h ?? 1;
  const coverage = spec.coverage ?? 0.95;

  const biased = await runBiasedWalk(sym, 0.94, 0.7, coverage, horizon);
  const rowsBiased = filterRowsForSim(rows, biased.reactionMapTestStart);
  const threshBiased = calibrateAutoThresholds(biased.walk.points, rowsBiased[0]?.date ?? null, horizon, 0.3);
  const biasedBars = buildBarsFromEwmaPath(rowsBiased, biased.walk.points, horizon, threshBiased);
  const simBiased = simulateTrading212Cfd(biasedBars.bars, 5000, config);
  const biasedEntries = countEntries(simBiased.accountHistory);
  const closedLong = simBiased.trades.filter((t) => t.side === "long").length;
  const closedShort = simBiased.trades.filter((t) => t.side === "short").length;

  const best = await optimizeBiasedConfig(sym, coverage, horizon);
  const biasedMax = await runBiasedWalk(sym, best.lambda, best.trainFraction, coverage, horizon);
  const rowsMax = filterRowsForSim(rows, biasedMax.reactionMapTestStart);
  const threshMax = calibrateAutoThresholds(biasedMax.walk.points, rowsMax[0]?.date ?? null, horizon, 0.3);
  const maxBars = buildBarsFromEwmaPath(rowsMax, biasedMax.walk.points, horizon, threshMax);
  const simMax = simulateTrading212Cfd(maxBars.bars, 5000, config);
  const maxEntries = countEntries(simMax.accountHistory);
  const closedLongMax = simMax.trades.filter((t) => t.side === "long").length;
  const closedShortMax = simMax.trades.filter((t) => t.side === "short").length;

  const pctLongBiased = (biasedBars.fracPos * 100).toFixed(1);
  const pctShortBiased = (biasedBars.fracNeg * 100).toFixed(1);

  console.log(`\n=== ${sym} (h=${horizon}, cov=${coverage}) ===`);
  console.log(
    `Biased:   λ=0.94 train=0.70  enterL=${threshBiased.enterLong.toFixed(3)} enterS=${threshBiased.enterShort.toFixed(3)} exitL=${threshBiased.exitLong.toFixed(3)} exitS=${threshBiased.exitShort.toFixed(3)} flipL=${threshBiased.flipLong.toFixed(3)} flipS=${threshBiased.flipShort.toFixed(3)}`
  );
  console.log(
    `          pct(z>=enterL)=${pctLongBiased}% pct(z<=-enterS)=${pctShortBiased}% entries L/S=${biasedEntries.longEntries}/${biasedEntries.shortEntries} closed L/S=${closedLong}/${closedShort}`
  );

  console.log(
    `Max:      λ=${best.lambda.toFixed(2)} train=${(best.trainFraction * 100).toFixed(0)}  enterL=${threshMax.enterLong.toFixed(3)} enterS=${threshMax.enterShort.toFixed(3)} exitL=${threshMax.exitLong.toFixed(3)} exitS=${threshMax.exitShort.toFixed(3)} flipL=${threshMax.flipLong.toFixed(3)} flipS=${threshMax.flipShort.toFixed(3)}`
  );
  console.log(
    `          pct(z>=enterL)=${(maxBars.fracPos * 100).toFixed(1)}% pct(z<=-enterS)=${(maxBars.fracNeg * 100).toFixed(1)}% entries L/S=${maxEntries.longEntries}/${maxEntries.shortEntries} closed L/S=${closedLongMax}/${closedShortMax}`
  );

  if (biasedBars.fracPos === 0 && biasedBars.fracNeg === 0) {
    console.warn(`[WARN] ${sym} auto thresholds produced no extremes (check calibration window).`);
  }
}

async function main() {
  const symbols = parseSymbolsFromArgv(process.argv.slice(2), DEFAULT_SYMBOLS as unknown as string[]);

  const config: Trading212CfdConfig = {
    leverage: 5,
    fxFeeRate: 0.005,
    dailyLongSwapRate: 0,
    dailyShortSwapRate: 0,
    spreadBps: 0,
    marginCallLevel: 0.45,
    stopOutLevel: 0.25,
    positionFraction: 0.25,
  };

  for (const sym of symbols) {
    await runForSymbol(sym, config);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
