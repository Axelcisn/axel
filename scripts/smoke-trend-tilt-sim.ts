/**
 * Smoke test for EWMA Trend tilt in Trading212 CFD sims.
 * Runs Biased/Biased(Max) with and without Trend tilt for a panel of symbols.
 */

import { loadTrendWeightCalibration } from '@/lib/storage/trendCalibration';
import { loadCanonicalDataWithMeta } from '@/lib/storage/canonical';
import {
  buildEwmaReactionMap,
  buildEwmaTiltConfigFromReactionMap,
  defaultReactionConfig,
} from '@/lib/volatility/ewmaReaction';
import {
  runEwmaWalker,
  summarizeEwmaWalkerResults,
  type EwmaWalkerPoint,
} from '@/lib/volatility/ewmaWalker';
import {
  simulateTrading212Cfd,
  type Trading212CfdConfig,
  type Trading212SimBar,
} from '@/lib/backtest/trading212Cfd';
import { computeEwmaGapZSeries } from '@/lib/indicators/ewmaCrossover';
import { parseSymbolsFromArgv } from './_utils/cli';
import { summarizeTrading212Result } from './_utils/t212Summary';

interface SimSummary {
  symbol: string;
  variant: 'biased' | 'biased-trend' | 'biased-max' | 'biased-max-trend';
  totalReturnPct: number;
  maxDrawdownPct: number;
  trades: number;
  stopOuts: number;
  sharpeApprox?: number;
  lambda: number;
  trainFraction: number;
  cagrPct: number | null;
  finalEquity: number;
  initialEquity: number;
  years: number | null;
  multiplier: number | null;
}

type VariantId = SimSummary['variant'];

const HORIZON = 1;
const COVERAGE = 0.95;
const LAMBDA = 0.94;
const TRAIN_FRACTION = 0.7;
const MIN_TRAIN_OBS = 500;
const SHRINK_FACTOR = 0.5;
const THRESHOLD_PCT = 0;
const TREND_SHORT_WINDOW = 14;
const TREND_LONG_WINDOW = 50;
const TREND_LOOKBACK = 60;
const INITIAL_EQUITY = 5000;

const T212_CONFIG: Trading212CfdConfig = {
  leverage: 5,
  fxFeeRate: 0.005,
  dailyLongSwapRate: 0,
  dailyShortSwapRate: 0,
  spreadBps: 5,
  marginCallLevel: 0.45,
  stopOutLevel: 0.25,
  positionFraction: 0.25,
};

function buildBarsFromEwmaPath(
  canonicalRows: Array<{ date: string; adj_close: number | null; close: number | null }>,
  ewmaPath: EwmaWalkerPoint[],
  options: {
    useTrendTilt: boolean;
    trendWeight: number | null;
    trendZByDate?: Map<string, number>;
    horizon: number;
  }
): Trading212SimBar[] {
  const { useTrendTilt, trendWeight, trendZByDate, horizon } = options;

  const ewmaMap = new Map<string, EwmaWalkerPoint>();
  for (const p of ewmaPath) {
    ewmaMap.set(p.date_tp1, p);
  }

  const bars: Trading212SimBar[] = [];

  for (const row of canonicalRows) {
    const price = (row.adj_close ?? row.close) || null;
    if (!price || !row.date) continue;

    const ewma = ewmaMap.get(row.date);
    if (!ewma) continue;

    const diffPctBase = (ewma.y_hat_tp1 - ewma.S_t) / ewma.S_t;
    let diffForSignal = diffPctBase;

    if (
      useTrendTilt &&
      trendWeight != null &&
      Number.isFinite(trendWeight) &&
      trendZByDate &&
      Number.isFinite(ewma.sigma_t)
    ) {
      const zRaw = trendZByDate.get(row.date);
      if (zRaw != null && Number.isFinite(zRaw)) {
        const zClamped = Math.max(-2, Math.min(2, zRaw));
        const muBase = Math.log(ewma.y_hat_tp1 / ewma.S_t);
        const sigmaH = ewma.sigma_t * Math.sqrt(horizon);
        if (Number.isFinite(muBase) && Number.isFinite(sigmaH) && sigmaH > 0) {
          const muTrend = muBase + trendWeight * zClamped * sigmaH;
          const relChange = Math.exp(muTrend) - 1;
          if (Number.isFinite(relChange)) {
            diffForSignal = relChange;
          }
        }
      }
    }

    let signal: Trading212SimBar['signal'] = 'flat';
    if (diffForSignal > THRESHOLD_PCT) {
      signal = 'long';
    } else if (diffForSignal < -THRESHOLD_PCT) {
      signal = 'short';
    }

    bars.push({
      date: row.date,
      price,
      signal,
    });
  }

  return bars;
}

function summarizeSim(
  symbol: string,
  variant: VariantId,
  result: ReturnType<typeof simulateTrading212Cfd>,
  config: { lambda: number; trainFraction: number }
): SimSummary {
  const summary = summarizeTrading212Result(result);

  let sharpeApprox: number | undefined;
  if (result.accountHistory.length > 1) {
    const returns: number[] = [];
    for (let i = 1; i < result.accountHistory.length; i++) {
      const prev = result.accountHistory[i - 1].equity;
      const curr = result.accountHistory[i].equity;
      if (prev > 0 && Number.isFinite(prev) && Number.isFinite(curr)) {
        returns.push((curr - prev) / prev);
      }
    }
    if (returns.length > 1) {
      const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
      const variance =
        returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (returns.length - 1);
      const std = Math.sqrt(variance);
      if (std > 0 && Number.isFinite(mean) && Number.isFinite(std)) {
        sharpeApprox = mean / std;
      }
    }
  }

  return {
    symbol,
    variant,
    totalReturnPct: summary.returnPct * 100,
    maxDrawdownPct: (summary.maxDrawdownPct ?? 0) * 100,
    trades: summary.trades,
    stopOuts: summary.stopOuts,
    cagrPct: summary.cagrPct,
    finalEquity: summary.finalEquity,
    initialEquity: summary.initialEquity,
    years: summary.years,
    multiplier: summary.multiplier,
    sharpeApprox,
    lambda: config.lambda,
    trainFraction: config.trainFraction,
  };
}

function filterRowsForSim(
  rows: Array<{ date: string; adj_close: number | null; close: number | null }>,
  startDate: string | null
) {
  if (!startDate) return rows;
  return rows.filter((r) => r.date >= startDate);
}

async function optimizeBiasedConfig(
  symbol: string,
  coverage: number,
  horizon: number,
  shrinkFactor: number
): Promise<{ lambda: number; trainFraction: number }> {
  const lambdaGrid = Array.from({ length: 11 }, (_, i) => 0.5 + i * 0.05); // 0.50..1.00
  const trainGrid = Array.from({ length: 9 }, (_, i) => 0.5 + i * 0.05); // 0.50..0.90

  let best: { lambda: number; trainFraction: number; hit: number } | null = null;

  for (const lambda of lambdaGrid) {
    for (const trainFraction of trainGrid) {
      try {
        const reactionConfig = {
          ...defaultReactionConfig,
          lambda,
          coverage,
          trainFraction,
          horizons: [horizon],
          minTrainObs: MIN_TRAIN_OBS,
        };
        const reactionMap = await buildEwmaReactionMap(symbol, reactionConfig);
        const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor, horizon });
        const walk = await runEwmaWalker({ symbol, lambda, coverage, horizon, tiltConfig });
        // Use directionHitRate as a simple objective (same as Timing page optimizer)
        const summary = summarizeEwmaWalkerResults(walk);
        const hitRate = summary?.directionHitRate ?? 0;
        if (!best || hitRate > best.hit) {
          best = { lambda, trainFraction, hit: hitRate };
        }
      } catch {
        continue;
      }
    }
  }

  return best
    ? { lambda: best.lambda, trainFraction: best.trainFraction }
    : { lambda: LAMBDA, trainFraction: TRAIN_FRACTION };
}

async function runSmokeForSymbol(symbol: string): Promise<SimSummary[]> {
  const calibration = await loadTrendWeightCalibration();
  const trendWeight =
    calibration && Number.isFinite(calibration.trendSignalWeightGlobal)
      ? calibration.trendSignalWeightGlobal
      : null;

  if (trendWeight == null) {
    console.warn(`[WARN] No valid Trend weight for ${symbol}; Trend variants will be skipped`);
  }

  const canonical = await loadCanonicalDataWithMeta(symbol);
  const canonicalRows = canonical.rows
    .filter((r) => r.date && (r.adj_close != null || r.close != null))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!canonicalRows.length) {
    throw new Error(`No canonical rows for ${symbol}`);
  }

  const priceRowsForZ = canonicalRows
    .map((r) => {
      const price = r.adj_close ?? r.close ?? null;
      return price && price > 0 ? { date: r.date, close: price } : null;
    })
    .filter((r): r is { date: string; close: number } => !!r);

  let trendZByDate: Map<string, number> | undefined;
  if (trendWeight != null) {
    const zSeries = computeEwmaGapZSeries(
      priceRowsForZ,
      TREND_SHORT_WINDOW,
      TREND_LONG_WINDOW,
      TREND_LOOKBACK
    );
    trendZByDate = new Map<string, number>();
    for (const p of zSeries) {
      if (Number.isFinite(p.z)) {
        trendZByDate.set(p.date, p.z);
      }
    }
  }

  const reactionMapBase = await buildEwmaReactionMap(symbol, {
    ...defaultReactionConfig,
    lambda: LAMBDA,
    coverage: COVERAGE,
    horizons: [HORIZON],
    trainFraction: TRAIN_FRACTION,
    minTrainObs: MIN_TRAIN_OBS,
  });

  const tiltConfigBase = buildEwmaTiltConfigFromReactionMap(reactionMapBase, {
    shrinkFactor: SHRINK_FACTOR,
    horizon: HORIZON,
  });

  const ewmaBiased = await runEwmaWalker({
    symbol,
    lambda: LAMBDA,
    coverage: COVERAGE,
    horizon: HORIZON,
    tiltConfig: tiltConfigBase,
  });

  // Max-config: optimize lambda/trainFraction, then build a separate path
  const maxConfig = await optimizeBiasedConfig(symbol, COVERAGE, HORIZON, SHRINK_FACTOR);
  const reactionMapMax = await buildEwmaReactionMap(symbol, {
    ...defaultReactionConfig,
    lambda: maxConfig.lambda,
    coverage: COVERAGE,
    horizons: [HORIZON],
    trainFraction: maxConfig.trainFraction,
    minTrainObs: MIN_TRAIN_OBS,
  });
  const tiltConfigMax = buildEwmaTiltConfigFromReactionMap(reactionMapMax, {
    shrinkFactor: SHRINK_FACTOR,
    horizon: HORIZON,
  });
  const ewmaBiasedMax = await runEwmaWalker({
    symbol,
    lambda: maxConfig.lambda,
    coverage: COVERAGE,
    horizon: HORIZON,
    tiltConfig: tiltConfigMax,
  });

  const pathBiased = ewmaBiased.points;
  const pathBiasedMax = ewmaBiasedMax.points;

  const simWindowBaseStart = reactionMapBase.meta?.testStart ?? null;
  const simWindowMaxStart = reactionMapMax.meta?.testStart ?? simWindowBaseStart ?? null;

  const variants: VariantId[] = ['biased', 'biased-trend', 'biased-max', 'biased-max-trend'];
  const results: Record<VariantId, SimSummary> = {} as any;

  for (const variant of variants) {
    const useTrendTilt =
      trendWeight != null &&
      (variant === 'biased-trend' || variant === 'biased-max-trend') &&
      trendZByDate;

    if ((variant === 'biased-trend' || variant === 'biased-max-trend') && !useTrendTilt) {
      continue; // skip Trend variants if we lack calibration
    }

    const isMax = variant.startsWith('biased-max');
    const path = isMax ? pathBiasedMax : pathBiased;
    const windowStart = isMax ? simWindowMaxStart : simWindowBaseStart;
    const lambdaCfg = isMax ? maxConfig.lambda : LAMBDA;
    const trainCfg = isMax ? maxConfig.trainFraction : TRAIN_FRACTION;

    const rowsForSim = filterRowsForSim(canonicalRows, windowStart);

    const bars = buildBarsFromEwmaPath(rowsForSim, path, {
      useTrendTilt: !!useTrendTilt,
      trendWeight,
      trendZByDate,
      horizon: HORIZON,
    });

    if (!bars.length) {
      throw new Error(`No bars built for ${symbol} ${variant}`);
    }

    const sim = simulateTrading212Cfd(bars, INITIAL_EQUITY, T212_CONFIG);
    results[variant] = summarizeSim(symbol, variant, sim, {
      lambda: lambdaCfg,
      trainFraction: trainCfg,
    });
  }

  const summaries = Object.values(results);

  // Warn if max config differs but outputs identical
  const base = results['biased'];
  const max = results['biased-max'];
  if (
    base &&
    max &&
    (base.lambda !== max.lambda || base.trainFraction !== max.trainFraction) &&
    Math.abs(base.totalReturnPct - max.totalReturnPct) < 1e-6 &&
    Math.abs(base.maxDrawdownPct - max.maxDrawdownPct) < 1e-6 &&
    base.trades === max.trades
  ) {
    console.warn(
      `[WARN] ${symbol} biased-max uses different params (λ=${max.lambda.toFixed(
        2
      )}, train=${(max.trainFraction * 100).toFixed(
        0
      )}%) but produced identical metrics to biased; check path coupling`
    );
  }

  const warnIf = (baseId: VariantId, trendId: VariantId) => {
    const base = results[baseId];
    const trend = results[trendId];
    if (!base || !trend) return;

    if (trend.trades > base.trades * 5) {
      console.warn(
        `[WARN] ${symbol} ${trendId} trades ${trend.trades} > 5x base ${base.trades}`
      );
    }
    if (trend.maxDrawdownPct > base.maxDrawdownPct * 2) {
      console.warn(
        `[WARN] ${symbol} ${trendId} max DD ${trend.maxDrawdownPct.toFixed(
          2
        )}% > 2x base ${base.maxDrawdownPct.toFixed(2)}%`
      );
    }
    const retDelta = Math.abs(trend.totalReturnPct - base.totalReturnPct);
    if (retDelta < 0.5 && trend.maxDrawdownPct > base.maxDrawdownPct * 1.5) {
      console.warn(
        `[WARN] ${symbol} ${trendId} similar return (+/-0.5%) but much worse DD vs base`
      );
    }
  };

  warnIf('biased', 'biased-trend');
  warnIf('biased-max', 'biased-max-trend');

  return summaries;
}

async function main() {
  const symbols = parseSymbolsFromArgv(process.argv.slice(2), ['AAPL', 'TSLA', 'MSFT']);

  const all: SimSummary[] = [];
  for (const symbol of symbols) {
    console.log(`\n=== ${symbol} ===`);
    const rows = await runSmokeForSymbol(symbol);
    all.push(...rows);

    for (const r of rows) {
      console.log(
        [
          r.symbol.padEnd(6),
          r.variant.padEnd(16),
          `λ=${r.lambda.toFixed(2)}`.padEnd(10),
          `train=${(r.trainFraction * 100).toFixed(0)}%`.padEnd(12),
          `Ret: ${r.totalReturnPct.toFixed(2)}%`.padEnd(14),
          r.multiplier != null ? `(x${r.multiplier.toFixed(2)})`.padEnd(10) : `(x—)`.padEnd(10),
          `DD: ${r.maxDrawdownPct.toFixed(2)}%`.padEnd(14),
          `Trades: ${r.trades}`.padEnd(12),
          `StopOuts: ${r.stopOuts}`.padEnd(14),
          `InitEq: ${r.initialEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.padEnd(20),
          `FinalEq: ${r.finalEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.padEnd(22),
          r.years != null ? `Years: ${r.years.toFixed(2)}`.padEnd(14) : `Years: —`.padEnd(14),
          r.cagrPct != null ? `CAGR: ${(r.cagrPct * 100).toFixed(2)}%` : `CAGR: —`,
          r.sharpeApprox != null ? `Sharpe~ ${r.sharpeApprox.toFixed(2)}` : '',
        ].join('  ')
      );
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
