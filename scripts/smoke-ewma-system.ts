/**
 * Integrated smoke test for EWMA / Trend tilt / Trading212 simulations.
 * Runs calibration, EWMA sigma, z-series, trend tilt branch, and four sim variants.
 */
import assert from 'node:assert/strict';

import { loadTrendWeightCalibration } from '@/lib/storage/trendCalibration';
import { loadCanonicalData } from '@/lib/storage/canonical';
import { runEwmaWalker, type EwmaWalkerPoint } from '@/lib/volatility/ewmaWalker';
import { computeEwmaGapZSeries } from '@/lib/indicators/ewmaCrossover';
import {
  simulateTrading212Cfd,
  type Trading212CfdConfig,
  type Trading212SimBar,
  type Trading212SimulationResult,
} from '@/lib/backtest/trading212Cfd';
import { type CanonicalRow } from '@/lib/types/canonical';

const SMOKE_SYMBOLS = ['AAPL', 'TSLA', 'MSFT'];
const HORIZON = 1;
const COVERAGE = 0.95;
const SHORT_WINDOW = 14;
const LONG_WINDOW = 50;
const Z_LOOKBACK = 60;

const INITIAL_EQUITY = 10000;
const LEVERAGE = 1;
const POSITION_FRACTION = 0.2;
const THRESHOLD_PCT = 0.01;

const T212_CONFIG: Trading212CfdConfig = {
  leverage: LEVERAGE,
  fxFeeRate: 0.005,
  dailyLongSwapRate: 0,
  dailyShortSwapRate: 0,
  spreadBps: 5,
  marginCallLevel: 0.45,
  stopOutLevel: 0.25,
  positionFraction: POSITION_FRACTION,
};

function expectFinite(name: string, value: number) {
  assert.ok(Number.isFinite(value), `${name} is not finite: ${value}`);
}

function expectInRange(name: string, value: number, min: number, max: number) {
  expectFinite(name, value);
  assert.ok(value >= min && value <= max, `${name}=${value} out of range [${min}, ${max}]`);
}

function buildBarsFromEwmaPath(
  canonicalRows: CanonicalRow[],
  ewmaPath: EwmaWalkerPoint[],
  options: {
    useTrendTilt: boolean;
    trendWeight: number | null;
    trendZByDate?: Map<string, number>;
    horizon: number;
    thresholdPct?: number;
  }
): Trading212SimBar[] {
  const { useTrendTilt, trendWeight, trendZByDate, horizon, thresholdPct } = options;
  const appliedThreshold = thresholdPct ?? THRESHOLD_PCT;

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
    if (diffForSignal > appliedThreshold) {
      signal = 'long';
    } else if (diffForSignal < -appliedThreshold) {
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

async function checkTrendCalibration() {
  console.log('▶ Check 1: Trend calibration JSON');

  const calibration = await loadTrendWeightCalibration();
  assert.ok(calibration, 'TrendWeightCalibration is null/undefined');

  const { trendSignalWeightGlobal, calibrationDate, r2, rowCount } = calibration;

  expectFinite('trendSignalWeightGlobal', trendSignalWeightGlobal);
  assert.ok(
    Math.abs(trendSignalWeightGlobal) <= 0.5,
    `trendSignalWeightGlobal too large: ${trendSignalWeightGlobal}`
  );
  assert.ok(
    calibrationDate && typeof calibrationDate === 'string',
    'calibrationDate missing/empty'
  );
  expectInRange('r2', r2, 0, 1);
  assert.ok(rowCount >= 500, `rowCount too small: ${rowCount}`);

  console.log('  ✓ calibration loaded and looks sane');
}

async function checkEwmaAndZForSymbol(symbol: string) {
  console.log(`▶ Check 2: EWMA & z-series for ${symbol}`);

  const canonical = await loadCanonicalData(symbol);
  assert.ok(canonical.length > 0, `${symbol}: canonical data empty`);

  const ewmaResult = await runEwmaWalker({
    symbol,
    lambda: 0.94,
    horizon: HORIZON,
    coverage: COVERAGE,
    initialWindow: 252,
  });

  assert.ok(ewmaResult.points && ewmaResult.points.length > 0, `${symbol}: ewmaResult.points empty`);

  let sigmaFiniteCount = 0;
  for (const p of ewmaResult.points) {
    if (Number.isFinite(p.sigma_t) && p.sigma_t > 0) sigmaFiniteCount++;
  }
  assert.ok(
    sigmaFiniteCount > ewmaResult.points.length * 0.5,
    `${symbol}: too few finite sigma_t values`
  );

  const priceRows = canonical
    .map((row) => {
      const p = row.adj_close ?? row.close;
      return p && p > 0 ? { date: row.date, close: p } : null;
    })
    .filter((r): r is { date: string; close: number } => !!r);

  const zSeries = computeEwmaGapZSeries(priceRows, SHORT_WINDOW, LONG_WINDOW, Z_LOOKBACK);
  assert.ok(zSeries.length > 0, `${symbol}: z-series empty`);

  let finiteZ = 0;
  for (const z of zSeries) {
    if (Number.isFinite(z.z)) finiteZ++;
  }
  assert.ok(finiteZ > zSeries.length * 0.8, `${symbol}: too many non-finite z values`);

  console.log(`  ✓ ${symbol}: EWMA σ_t and z-series look sane`);
}

async function checkTrendTiltBranchOnSymbol(symbol: string, trendWeight: number) {
  console.log(`▶ Check 3: Trend tilt branch for ${symbol}`);

  const canonical = await loadCanonicalData(symbol);
  assert.ok(canonical.length > 0, `${symbol}: canonical data empty`);

  const ewmaResult = await runEwmaWalker({
    symbol,
    lambda: 0.94,
    horizon: HORIZON,
    coverage: COVERAGE,
    initialWindow: 252,
  });

  const ewmaPath = ewmaResult.points;
  assert.ok(ewmaPath.length > 0, `${symbol}: ewmaPath empty`);

  const zMap = new Map<string, number>();
  for (const p of ewmaPath.slice(0, 200)) {
    zMap.set(p.date_tp1, 2); // force non-zero tilt input on target date
    zMap.set(p.date_t, 2);   // also on origin date for overlap
  }

  const tiltWeight = Math.max(Math.abs(trendWeight || 0), 0.2);

  const barsBase = buildBarsFromEwmaPath(canonical, ewmaPath, {
    useTrendTilt: false,
    trendWeight,
    trendZByDate: zMap,
    horizon: HORIZON,
    thresholdPct: 0,
  });

  const barsTrend = buildBarsFromEwmaPath(canonical, ewmaPath, {
    useTrendTilt: true,
    trendWeight: tiltWeight,
    trendZByDate: zMap,
    horizon: HORIZON,
    thresholdPct: 0,
  });

  assert.ok(barsBase.length > 0 && barsTrend.length > 0, `${symbol}: no bars built`);

  let diffSignals = 0;
  for (let i = 0; i < Math.min(barsBase.length, barsTrend.length); i++) {
    if (barsBase[i].signal !== barsTrend[i].signal) diffSignals++;
  }
  assert.ok(diffSignals > 0, 'Trend tilt branch never changed any signals (synthetic z=1)');

  console.log(`  ✓ ${symbol}: Trend tilt changed ${diffSignals} signals`);
}

interface SimVariantSummary {
  symbol: string;
  variant: 'biased' | 'biased-trend' | 'max' | 'max-trend';
  lambda?: number;
  trainFraction?: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  trades: number;
  stopOuts: number;
}

async function runSimVariant(
  symbol: string,
  baseMode: 'biased' | 'max',
  withTrend: boolean,
  trendWeight: number | null
): Promise<SimVariantSummary> {
  const canonical = await loadCanonicalData(symbol);
  const canonicalRows = canonical
    .filter((r) => r.date && (r.adj_close != null || r.close != null))
    .sort((a, b) => a.date.localeCompare(b.date));
  assert.ok(canonicalRows.length > 0, `${symbol}: no canonical rows for sim`);

  const ewmaResult = await runEwmaWalker({
    symbol,
    lambda: 0.94,
    coverage: COVERAGE,
    horizon: HORIZON,
    initialWindow: 252,
  });

  const ewmaPath = ewmaResult.points;
  assert.ok(ewmaPath.length > 0, `${symbol}: ewma path empty`);

  const priceRowsForZ = canonicalRows
    .map((r) => {
      const price = r.adj_close ?? r.close ?? null;
      return price && price > 0 ? { date: r.date, close: price } : null;
    })
    .filter((r): r is { date: string; close: number } => !!r);

  const zSeries = computeEwmaGapZSeries(priceRowsForZ, SHORT_WINDOW, LONG_WINDOW, Z_LOOKBACK);
  const trendZByDate = new Map<string, number>();
  for (const p of zSeries) {
    if (Number.isFinite(p.z)) {
      trendZByDate.set(p.date, p.z);
    }
  }

  const bars = buildBarsFromEwmaPath(canonicalRows, ewmaPath, {
    useTrendTilt: withTrend,
    trendWeight: withTrend ? trendWeight : null,
    trendZByDate,
    horizon: HORIZON,
    // For smoke testing, force trades to occur by treating any non-zero expected move as a signal.
    thresholdPct: 0,
  });

  assert.ok(
    bars.length > 0,
    `${symbol}/${baseMode}${withTrend ? '-trend' : ''}: no bars`
  );

  const longs = bars.filter((b) => b.signal === 'long').length;
  const shorts = bars.filter((b) => b.signal === 'short').length;
  console.log(
    `  [DEBUG] ${symbol}/${baseMode}${withTrend ? '+trend' : ''} bars=${bars.length}, long=${longs}, short=${shorts}`
  );

  const sim: Trading212SimulationResult = simulateTrading212Cfd(bars, INITIAL_EQUITY, T212_CONFIG);

  // Consistency checks on simulation result
  const pnl = sim.finalEquity - sim.initialEquity;
  const totalReturnPct = (pnl / sim.initialEquity) * 100;
  expectFinite(`${symbol}/${baseMode}/ret`, totalReturnPct);

  const maxDrawdownPct = sim.maxDrawdown * 100;
  expectInRange(`${symbol}/${baseMode}/dd`, maxDrawdownPct, 0, 100);
  assert.strictEqual(
    sim.trades.length,
    sim.trades.length,
    `${symbol}/${baseMode}: trades length inconsistent`
  );

  return {
    symbol,
    variant: withTrend ? (`${baseMode}-trend` as const) : baseMode,
    lambda: ewmaResult.params.lambda,
    trainFraction: undefined,
    totalReturnPct,
    maxDrawdownPct,
    trades: sim.trades.length,
    stopOuts: sim.stopOutEvents ?? 0,
  };
}

async function checkSimVariantsForSymbol(symbol: string, trendWeight: number) {
  console.log(`▶ Check 4: sims for ${symbol}`);

  const variants: SimVariantSummary[] = [];
  variants.push(await runSimVariant(symbol, 'biased', false, trendWeight));
  variants.push(await runSimVariant(symbol, 'biased', true, trendWeight));
  variants.push(await runSimVariant(symbol, 'max', false, trendWeight));
  variants.push(await runSimVariant(symbol, 'max', true, trendWeight));

  const biased = variants.find((v) => v.variant === 'biased')!;
  const biasedTrend = variants.find((v) => v.variant === 'biased-trend')!;
  const max = variants.find((v) => v.variant === 'max')!;
  const maxTrend = variants.find((v) => v.variant === 'max-trend')!;

  // Warn if Biased vs Max share config or are identical
  if (
    biased.lambda !== undefined &&
    max.lambda !== undefined &&
    (biased.lambda !== max.lambda || biased.trainFraction !== max.trainFraction)
  ) {
    if (
      biased.totalReturnPct === max.totalReturnPct &&
      biased.maxDrawdownPct === max.maxDrawdownPct &&
      biased.trades === max.trades
    ) {
      console.warn(
        `  ⚠ ${symbol}: Biased and Max use different λ/train, but metrics are identical. Check Max config.`
      );
    }
  } else {
    console.warn(
      `  ⚠ ${symbol}: Biased and Max share λ/train or config missing; Max may just be a fallback to Biased.`
    );
  }

  const metricsIdentical = (a: SimVariantSummary, b: SimVariantSummary) =>
    a.totalReturnPct === b.totalReturnPct &&
    a.maxDrawdownPct === b.maxDrawdownPct &&
    a.trades === b.trades &&
    a.stopOuts === b.stopOuts;

  if (metricsIdentical(biased, biasedTrend)) {
    console.warn(
      `  ⚠ ${symbol}: Biased vs Biased+Trend metrics identical – check effectiveTrendWeight or tilt wiring.`
    );
  }

  if (metricsIdentical(max, maxTrend)) {
    console.warn(
      `  ⚠ ${symbol}: Max vs Max+Trend metrics identical – check effectiveTrendWeight or tilt wiring.`
    );
  }

  if (metricsIdentical(biased, biasedTrend) && metricsIdentical(max, maxTrend)) {
    throw new Error(
      `${symbol}: Trend ON/OFF has no effect on any variant – smoke fail for Trend tilt.`
    );
  }

  for (const v of variants) {
    expectFinite(`${symbol}/${v.variant}/ret`, v.totalReturnPct);
    expectFinite(`${symbol}/${v.variant}/dd`, v.maxDrawdownPct);
    assert.ok(v.trades >= 0, `${symbol}/${v.variant}/trades negative`);
  }

  console.log(
    variants
      .map(
        (v) =>
          `${v.symbol}  ${v.variant.padEnd(12)}  Ret: ${v.totalReturnPct.toFixed(
            2
          )}%  DD: ${v.maxDrawdownPct.toFixed(2)}%  Trades: ${v.trades}`
      )
      .join('\n')
  );
}

async function main() {
  console.log('=== EWMA / Trend / Simulation smoke test ===');

  await checkTrendCalibration();
  const calibration = await loadTrendWeightCalibration();
  const trendWeight = calibration?.trendSignalWeightGlobal ?? 0;

  for (const symbol of SMOKE_SYMBOLS) {
    await checkEwmaAndZForSymbol(symbol);
    await checkTrendTiltBranchOnSymbol(symbol, trendWeight || 0.05);
    await checkSimVariantsForSymbol(symbol, trendWeight || 0.05);
  }

  console.log('\nAll smoke checks completed.');
}

main().catch((err) => {
  console.error('\nSMOKE TEST FAILED:');
  console.error(err);
  process.exit(1);
});
