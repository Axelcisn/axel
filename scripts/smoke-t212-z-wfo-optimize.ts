import { ensureCanonicalOrHistory } from "@/lib/storage/canonical";
import {
  buildEwmaReactionMap,
  buildEwmaTiltConfigFromReactionMap,
  defaultReactionConfig,
} from "@/lib/volatility/ewmaReaction";
import { runEwmaWalker } from "@/lib/volatility/ewmaWalker";
import {
  buildBarsFromZEdges,
  computeZEdgeSeries,
  optimizeZHysteresisThresholds,
  type ZHysteresisThresholds,
} from "@/lib/volatility/zWfoOptimize";
import {
  simulateTrading212Cfd,
  type Trading212CfdConfig,
  type Trading212SimBar,
} from "@/lib/backtest/trading212Cfd";
import { parseSymbolsFromArgv } from "./_utils/cli";

const DEFAULT_SYMBOLS = ["APD", "ECL", "SHW", "CL", "KMB"] as const;
const HORIZON = 1;
const COVERAGE = 0.95;
const formatScore = (v: number) => (Number.isFinite(v) ? v.toFixed(3) : "—");

function summarizeEntries(bars: Trading212SimBar[]): { long: number; short: number } {
  let prev: Trading212SimBar["signal"] | null = null;
  let long = 0;
  let short = 0;
  for (const b of bars) {
    if (b.signal !== prev) {
      if (b.signal === "long") long++;
      if (b.signal === "short") short++;
    }
    prev = b.signal;
  }
  return { long, short };
}

function computeAutoThresholds(zEdges: number[], fallbackEnter: number): ZHysteresisThresholds | null {
  if (!zEdges.length) return null;
  const exitRatio = 0.3;
  const flipRatio = 2.0;
  const targetQ = 0.9;
  const minSamples = 50;
  const pos = zEdges.filter((z) => z > 0);
  const neg = zEdges.filter((z) => z < 0).map((z) => -z);
  const absVals = zEdges.map((z) => Math.abs(z));

  const quantile = (values: number[], q: number): number => {
    if (!values.length) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const posIdx = (sorted.length - 1) * q;
    const base = Math.floor(posIdx);
    const rest = posIdx - base;
    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }
    return sorted[base];
  };

  const symEnter = quantile(absVals, targetQ);
  const enterLong = pos.length >= minSamples ? quantile(pos, targetQ) : symEnter;
  const enterShort = neg.length >= minSamples ? quantile(neg, targetQ) : symEnter;

  const enterLongFinal = Number.isFinite(enterLong) ? enterLong : fallbackEnter;
  const enterShortFinal = Number.isFinite(enterShort) ? enterShort : enterLongFinal;

  const thresholds: ZHysteresisThresholds = {
    enterLong: enterLongFinal,
    enterShort: enterShortFinal,
    exitLong: enterLongFinal * exitRatio,
    exitShort: enterShortFinal * exitRatio,
    flipLong: enterLongFinal * flipRatio,
    flipShort: enterShortFinal * flipRatio,
  };

  if (!(thresholds.exitLong < thresholds.enterLong && thresholds.enterLong < thresholds.flipLong)) return null;
  if (!(thresholds.exitShort < thresholds.enterShort && thresholds.enterShort < thresholds.flipShort)) return null;

  return thresholds;
}

function scoreRun(returnPct: number, maxDrawdown: number): number {
  return maxDrawdown > 0 ? returnPct / maxDrawdown : returnPct;
}

async function runForSymbol(symbol: string, config: Trading212CfdConfig, initialEquity: number) {
  const sym = symbol.toUpperCase();
  const { rows } = await ensureCanonicalOrHistory(sym, { interval: "1d", minRows: 800 });

  const lambda = 0.94;
  const trainFraction = 0.7;
  const reactionConfig = {
    ...defaultReactionConfig,
    lambda,
    coverage: COVERAGE,
    trainFraction,
    horizons: [HORIZON],
  };

  const reactionMap = await buildEwmaReactionMap(sym, reactionConfig);
  const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor: 0.5, horizon: HORIZON });
  const ewmaResult = await runEwmaWalker({ symbol: sym, lambda, coverage: COVERAGE, horizon: HORIZON, tiltConfig });

  const optimizeResult = await optimizeZHysteresisThresholds({
    symbol: sym,
    horizon: HORIZON,
    ewmaPath: ewmaResult.points,
    canonicalRows: rows,
    simStartDate: reactionMap.meta.testStart ?? null,
    trainLen: 252,
    valLen: 63,
    stepLen: 63,
    quantilesEnter: [0.8, 0.85, 0.9, 0.95],
    quantilesExit: [0.4, 0.5, 0.6, 0.7],
    quantilesFlip: [0.95, 0.97, 0.99],
    tradingConfig: config,
    initialEquity,
  });

  const zSeries = computeZEdgeSeries(rows, ewmaResult.points, HORIZON, reactionMap.meta.testStart ?? null);
  const orderingValid =
    optimizeResult.best.thresholds.exitLong < optimizeResult.best.thresholds.enterLong &&
    optimizeResult.best.thresholds.enterLong < optimizeResult.best.thresholds.flipLong &&
    optimizeResult.best.thresholds.exitShort < optimizeResult.best.thresholds.enterShort &&
    optimizeResult.best.thresholds.enterShort < optimizeResult.best.thresholds.flipShort;

  const quantilesOk =
    optimizeResult.best.quantiles.exit < optimizeResult.best.quantiles.enter &&
    optimizeResult.best.quantiles.enter < optimizeResult.best.quantiles.flip;

  const totalShortEntries = optimizeResult.foldSummaries.reduce(
    (sum, f) => sum + (f.shortEntries ?? 0),
    0
  );

  console.log(`\n=== ${sym} (h=${HORIZON}, cov=${COVERAGE}) ===`);
  console.log(
    `baseline=${formatScore(optimizeResult.best.baselineScore)} best=${formatScore(optimizeResult.best.bestScore)} applyRecommended=${optimizeResult.best.applyRecommended} reason=${optimizeResult.best.reason ?? "—"}`
  );
  console.log(
    `Quantiles enter/exit/flip=${optimizeResult.best.quantiles.enter.toFixed(2)}/${optimizeResult.best.quantiles.exit.toFixed(2)}/${optimizeResult.best.quantiles.flip.toFixed(2)} thresholds L/S enter=${optimizeResult.best.thresholds.enterLong.toFixed(3)}/${optimizeResult.best.thresholds.enterShort.toFixed(3)} exit=${optimizeResult.best.thresholds.exitLong.toFixed(3)}/${optimizeResult.best.thresholds.exitShort.toFixed(3)} flip=${optimizeResult.best.thresholds.flipLong.toFixed(3)}/${optimizeResult.best.thresholds.flipShort.toFixed(3)}`
  );
  console.log(
    `orderingValid=${orderingValid} totalShortEntries=${totalShortEntries} avgTrades=${optimizeResult.best.avgTradeCount.toFixed(1)} avgShortOpp=${optimizeResult.best.avgShortOppCount.toFixed(1)}`
  );

  if (!quantilesOk) {
    throw new Error(`[${sym}] quantile ordering invalid`);
  }
  if (!orderingValid) {
    throw new Error(`[${sym}] threshold ordering invalid`);
  }

  if (optimizeResult.best.applyRecommended) {
    const { bars } = buildBarsFromZEdges(zSeries, optimizeResult.best.thresholds, 0);
    const sim = simulateTrading212Cfd(bars, initialEquity, config);
    const entries = summarizeEntries(bars);
    const retPct = sim.initialEquity > 0 ? (sim.finalEquity - sim.initialEquity) / sim.initialEquity : 0;
    console.log(
      `Full-period optimized: entries L/S=${entries.long}/${entries.short} returnPct=${(retPct * 100).toFixed(2)}% maxDD=${(sim.maxDrawdown * 100).toFixed(2)}%`
    );
  } else {
    const autoThresholds = computeAutoThresholds(zSeries.map((p) => p.zEdge), 0.3);
    if (!autoThresholds) {
      throw new Error(`[${sym}] auto thresholds unavailable for guardrail check`);
    }
    const autoScoreFold = optimizeResult.best.baselineScore;
    const { bars: autoBars } = buildBarsFromZEdges(zSeries, autoThresholds, 0);
    const autoSim = simulateTrading212Cfd(autoBars, initialEquity, config);
    const autoReturn =
      autoSim.initialEquity > 0 ? (autoSim.finalEquity - autoSim.initialEquity) / autoSim.initialEquity : 0;
    const autoScoreFull = scoreRun(autoReturn, autoSim.maxDrawdown ?? 0);
    const guardScore = Number.isFinite(autoScoreFold) ? autoScoreFold : autoScoreFull;

    console.log(
      `Auto thresholds: returnPct=${(autoReturn * 100).toFixed(2)}% maxDD=${(autoSim.maxDrawdown * 100).toFixed(
        2
      )}% guardScore=${guardScore.toFixed(3)} vs bestScore=${optimizeResult.best.bestScore.toFixed(3)}`
    );

    if (optimizeResult.best.reason === "bestScore<=baselineScore" && guardScore < optimizeResult.best.bestScore - 1e-6) {
      throw new Error(
        `[${sym}] auto guard score ${guardScore.toFixed(3)} should be >= bestScore ${optimizeResult.best.bestScore.toFixed(3)}`
      );
    }
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

  const failures: string[] = [];
  for (const sym of symbols) {
    try {
      await runForSymbol(sym, config, 5000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`[${sym}] ${message}`);
      console.error(`[${sym}] ERROR:`, err);
    }
  }

  if (failures.length) {
    throw new Error(`WFO smoke failures: ${failures.join("; ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
