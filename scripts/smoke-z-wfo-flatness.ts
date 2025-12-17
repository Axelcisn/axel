/**
 * Compare z-WFO thresholds with and without flatness/flip constraints.
 *
 * Run:
 *   npx tsx scripts/smoke-z-wfo-flatness.ts --symbols=FIS,KHC,DHI,MAR,MCK
 */

import { buildEwmaReactionMap, buildEwmaTiltConfigFromReactionMap, defaultReactionConfig } from "@/lib/volatility/ewmaReaction";
import { runEwmaWalker } from "@/lib/volatility/ewmaWalker";
import { ensureCanonicalOrHistory } from "@/lib/storage/canonical";
import {
  optimizeZHysteresisThresholds,
  computeZEdgeSeries,
  buildBarsFromZEdges,
  summarizeSignalStats,
} from "@/lib/volatility/zWfoOptimize";
import { Trading212CfdConfig } from "@/lib/backtest/trading212Cfd";
import { computeFirstTradeDateFromSignals } from "@/lib/backtest/windowSim";
import { parseSymbolsFromArgs } from "./_utils/cli";

type RunLabel = "baseline" | "constrained";

async function runForSymbol(symbol: string) {
  const h = 1;
  const coverage = 0.95;
  const lambda = 0.94;
  const shrinkFactor = 0.5;

  const { rows } = await ensureCanonicalOrHistory(symbol, { interval: "1d", minRows: 400 });

  const reactionMap = await buildEwmaReactionMap(symbol, {
    ...defaultReactionConfig,
    lambda,
    coverage,
    horizons: [h],
  });
  const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor, horizon: h });

  const ewmaResult = await runEwmaWalker({
    symbol,
    lambda,
    coverage,
    horizon: h,
    tiltConfig,
  });

  const tradingConfig: Trading212CfdConfig = {
    leverage: 5,
    fxFeeRate: 0.005,
    dailyLongSwapRate: 0,
    dailyShortSwapRate: 0,
    spreadBps: 0,
    marginCallLevel: 0.45,
    stopOutLevel: 0.25,
    positionFraction: 0.25,
  };

  const zSeries = computeZEdgeSeries(rows, ewmaResult.points, h, reactionMap.meta.testStart ?? null);

  const runConfig: Record<RunLabel, Parameters<typeof optimizeZHysteresisThresholds>[0]> = {
    baseline: {
      symbol,
      horizon: h,
      ewmaPath: ewmaResult.points,
      canonicalRows: rows,
      simStartDate: reactionMap.meta.testStart ?? null,
      trainLen: 252,
      valLen: 63,
      stepLen: 63,
      quantilesEnter: [0.8, 0.85, 0.9, 0.95],
      quantilesExit: [0.4, 0.5, 0.6, 0.7],
      quantilesFlip: [0.95, 0.97, 0.99],
      tradingConfig,
      initialEquity: 5000,
      minFlatPct: 0,
      minCloses: 0,
      maxFlipPct: null,
      scorePenalty: { flipGamma: 0, tradeEta: 0 },
    },
    constrained: {
      symbol,
      horizon: h,
      ewmaPath: ewmaResult.points,
      canonicalRows: rows,
      simStartDate: reactionMap.meta.testStart ?? null,
      trainLen: 252,
      valLen: 63,
      stepLen: 63,
      quantilesEnter: [0.8, 0.85, 0.9, 0.95],
      quantilesExit: [0.4, 0.5, 0.6, 0.7],
      quantilesFlip: [0.95, 0.97, 0.99],
      tradingConfig,
      initialEquity: 5000,
      minFlatPct: 2,
      minCloses: 1,
      maxFlipPct: 60,
      scorePenalty: { flipGamma: 0.01, tradeEta: 0.001 },
    },
  };

  const outputs: Record<RunLabel, any> = {} as any;

  for (const label of ["baseline", "constrained"] as RunLabel[]) {
    const res = await optimizeZHysteresisThresholds(runConfig[label]);
    const best = res.best;

    // Build bars on the last 63 trading days to check strict window start behavior
    const lastWindow = zSeries.slice(Math.max(0, zSeries.length - 63));
    const { bars } = buildBarsFromZEdges(lastWindow, best.thresholds, 0);
    const stats = summarizeSignalStats(bars);
    const window = lastWindow.length
      ? { start: lastWindow[0].date, end: lastWindow[lastWindow.length - 1].date }
      : null;
    const { date: firstDate } = window ? computeFirstTradeDateFromSignals(bars, window, null) : { date: null };
    outputs[label] = {
      bestScore: best.meanScore,
      foldCount: best.folds,
      avgTradeCount: best.avgTradeCount,
      flatPct: stats.flatPct.toFixed(1),
      opens: stats.opens,
      closes: stats.closes,
      flips: stats.flips,
      cleanOpenFound: !!firstDate,
    };
  }

  console.log(`\n=== ${symbol} ===`);
  console.log(outputs);
}

async function main() {
  const { symbols } = parseSymbolsFromArgs(process.argv, {
    defaultSymbols: ["FIS", "KHC", "DHI", "MAR", "MCK"],
  });

  for (const sym of symbols) {
    await runForSymbol(sym);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
