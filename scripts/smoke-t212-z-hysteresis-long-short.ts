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

const DEFAULT_SYMBOLS = ["DE", "UPS", "FDX", "COP", "SPGI"] as const;
const Z_ENTER = 0.3;
const Z_EXIT = 0.1;
const Z_FLIP = 0.6;
const MIN_TRAIN_OBS = 500;
const SHRINK_FACTOR = 0.5;
const THRESHOLD_FRAC = 0; // bps not used in z rule
const MIN_SHORT_RATE = 0.02;

type SymbolInput = string | typeof DEFAULT_SYMBOLS[number];

type EwmaRunBundle = {
  walk: { points: EwmaWalkerPoint[] };
  reactionMapTestStart: string | null;
};

function filterRowsForSim(rows: CanonicalRow[], startDate: string | null): CanonicalRow[] {
  if (!startDate) return rows;
  return rows.filter((r) => r.date >= startDate);
}

function buildBarsFromEwmaPath(
  rows: CanonicalRow[],
  path: EwmaWalkerPoint[],
  horizon: number,
  rule: "bps" | "z",
  zEnter: number,
  zExit: number,
  zFlip: number,
  thresholdFrac: number
): { bars: Trading212SimBar[]; zEdgeStats: { fracPos: number; fracNeg: number } } {
  const ewmaMap = new Map<string, EwmaWalkerPoint>();
  path.forEach((p) => ewmaMap.set(p.date_tp1, p));

  const sqrtH = Math.sqrt(horizon);
  const bars: Trading212SimBar[] = [];
  let qPrev = 0;
  let posCount = 0;
  let negCount = 0;
  let validZ = 0;

  for (const row of rows) {
    const price = row.adj_close ?? row.close;
    if (!price || !row.date) continue;
    const ewma = ewmaMap.get(row.date);
    if (!ewma) continue;

    const muBase = Math.log(ewma.y_hat_tp1 / ewma.S_t);
    const sigmaH = ewma.sigma_t * sqrtH;
    if (!Number.isFinite(muBase) || !Number.isFinite(sigmaH) || sigmaH <= 0) continue;

    const edgeFrac = Math.exp(muBase) - 1;
    const zEdge = muBase / sigmaH;
    validZ++;
    if (zEdge >= zEnter) posCount++;
    if (zEdge <= -zEnter) negCount++;

    let signal: Trading212SimBar["signal"] = "flat";

    if (rule === "bps") {
      if (edgeFrac > thresholdFrac) signal = "long";
      else if (edgeFrac < -thresholdFrac) signal = "short";
    } else {
      let q = qPrev;
      if (qPrev === 0) {
        if (zEdge >= zEnter) q = 1;
        else if (zEdge <= -zEnter) q = -1;
      } else if (qPrev === 1) {
        if (zEdge <= -zFlip) q = -1;
        else if (zEdge <= zExit) q = 0;
      } else if (qPrev === -1) {
        if (zEdge >= zFlip) q = 1;
        else if (zEdge >= -zExit) q = 0;
      }
      qPrev = q;
      if (q > 0) signal = "long";
      else if (q < 0) signal = "short";
    }

    bars.push({ date: row.date, price, signal });
  }

  return {
    bars,
    zEdgeStats: {
      fracPos: validZ > 0 ? posCount / validZ : 0,
      fracNeg: validZ > 0 ? negCount / validZ : 0,
    },
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
  const lambdaGrid = Array.from({ length: 11 }, (_, i) => 0.5 + i * 0.05); // 0.50..1.00
  const trainGrid = Array.from({ length: 9 }, (_, i) => 0.5 + i * 0.05); // 0.50..0.90

  let best: { lambda: number; trainFraction: number; score: number } | null = null;

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
        let shortCount = 0;
        let valid = 0;
        for (const p of walk.points) {
          const muBase = Math.log(p.y_hat_tp1 / p.S_t);
          const sigmaH = p.sigma_t * sqrtH;
          if (!Number.isFinite(muBase) || !Number.isFinite(sigmaH) || sigmaH <= 0) continue;
          const zEdge = muBase / sigmaH;
          valid++;
          if (zEdge <= -Z_ENTER) shortCount++;
        }
        const shortOpportunityRate = valid > 0 ? shortCount / valid : 0;
        const score = walk.points.length
          ? walk.points.filter((p) => p.directionCorrect).length / walk.points.length -
            Math.max(0, MIN_SHORT_RATE - shortOpportunityRate)
          : -Infinity;

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
  const { bars: barsBiased, zEdgeStats: zStatsBiased } = buildBarsFromEwmaPath(
    rowsBiased,
    biased.walk.points,
    horizon,
    "z",
    Z_ENTER,
    Z_EXIT,
    Z_FLIP,
    THRESHOLD_FRAC
  );
  const simBiased = simulateTrading212Cfd(barsBiased, 5000, config);
  const biasedEntries = countEntries(simBiased.accountHistory);
  const closedLong = simBiased.trades.filter((t) => t.side === "long").length;
  const closedShort = simBiased.trades.filter((t) => t.side === "short").length;

  const best = await optimizeBiasedConfig(sym, coverage, horizon);
  const biasedMax = await runBiasedWalk(sym, best.lambda, best.trainFraction, coverage, horizon);
  const rowsMax = filterRowsForSim(rows, biasedMax.reactionMapTestStart);
  const { bars: barsMax, zEdgeStats: zStatsMax } = buildBarsFromEwmaPath(
    rowsMax,
    biasedMax.walk.points,
    horizon,
    "z",
    Z_ENTER,
    Z_EXIT,
    Z_FLIP,
    THRESHOLD_FRAC
  );
  const simMax = simulateTrading212Cfd(barsMax, 5000, config);
  const maxEntries = countEntries(simMax.accountHistory);
  const closedLongMax = simMax.trades.filter((t) => t.side === "long").length;
  const closedShortMax = simMax.trades.filter((t) => t.side === "short").length;

  console.log(`\n=== ${sym} (h=${horizon}, cov=${coverage}) ===`);
  console.log(`Biased:   λ=0.94 train=0.70 zEdge>=enter ${(zStatsBiased.fracPos * 100).toFixed(1)}%  zEdge<=-enter ${(zStatsBiased.fracNeg * 100).toFixed(1)}%`);
  console.log(
    `          entries L/S=${biasedEntries.longEntries}/${biasedEntries.shortEntries}  closed L/S=${closedLong}/${closedShort}`
  );
  console.log(
    `Max:      λ=${best.lambda.toFixed(2)} train=${(best.trainFraction * 100).toFixed(0)} zEdge>=enter ${(zStatsMax.fracPos * 100).toFixed(1)}%  zEdge<=-enter ${(zStatsMax.fracNeg * 100).toFixed(1)}%`
  );
  console.log(
    `          entries L/S=${maxEntries.longEntries}/${maxEntries.shortEntries}  closed L/S=${closedLongMax}/${closedShortMax}`
  );

  return { biasedShorts: biasedEntries.shortEntries, maxShorts: maxEntries.shortEntries };
}

async function main() {
  const symbols = (parseSymbolsFromArgv(process.argv.slice(2), DEFAULT_SYMBOLS as unknown as string[]) as string[]).map((s) =>
    s.toUpperCase()
  );

  const config: Trading212CfdConfig = {
    leverage: 5,
    fxFeeRate: 0.005,
    dailyLongSwapRate: 0,
    dailyShortSwapRate: 0,
    spreadBps: 5,
    marginCallLevel: 0.45,
    stopOutLevel: 0.25,
    positionFraction: 0.25,
  };

  let totalBiasedShorts = 0;
  for (const sym of symbols) {
    const res = await runForSymbol(sym, config);
    totalBiasedShorts += res.biasedShorts;
  }

  if (totalBiasedShorts === 0) {
    console.warn(`\n[WARN] No short entries observed across biased runs (check z thresholds or tilt balance).`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
