import assert from 'node:assert/strict';

import { loadCanonicalData } from '@/lib/storage/canonical';
import { runEwmaWalker, type EwmaWalkerPoint } from '@/lib/volatility/ewmaWalker';
import { computeEwmaGapZSeries } from '@/lib/indicators/ewmaCrossover';
import { loadTrendWeightCalibration, type TrendWeightCalibration } from '@/lib/storage/trendCalibration';
import type { CanonicalRow } from '@/lib/types/canonical';

const SMOKE_SYMBOLS = ['AAPL', 'TSLA', 'MSFT']; // you can adjust later
const EWMA_LAMBDA_UNBIASED = 0.94;
const EWMA_COVERAGE = 0.95;
const EWMA_INITIAL_WINDOW = 252;
const EWMA_HORIZON = 1;

const TREND_SHORT = 14;
const TREND_LONG = 50;
const TREND_LOOKBACK = 60;

function expectFinite(name: string, value: number) {
  assert.ok(Number.isFinite(value), `${name} is not finite: ${value}`);
}

function expectInRange(name: string, value: number, min: number, max: number) {
  expectFinite(name, value);
  assert.ok(value >= min && value <= max, `${name}=${value} out of range [${min}, ${max}]`);
}

async function checkCanonical(symbol: string) {
  console.log(`▶ Canonical for ${symbol}`);

  const rows = await loadCanonicalData(symbol);
  assert.ok(rows.length > EWMA_INITIAL_WINDOW + 10, `${symbol}: not enough canonical rows`);

  // Ensure date ascending and strictly positive prices
  let prevDate: string | null = null;
  for (const row of rows) {
    assert.ok(row.date, `${symbol}: row without date`);
    if (prevDate !== null) {
      assert.ok(
        row.date >= prevDate,
        `${symbol}: dates not sorted (found ${row.date} after ${prevDate})`
      );
    }
    prevDate = row.date;

    const price = row.adj_close ?? row.close;
    assert.ok(price != null && price > 0, `${symbol}: non-positive adj_close/close at ${row.date}`);
  }

  console.log(`  ✓ ${symbol}: canonical rows=${rows.length}, dates sorted, prices > 0`);
}

async function checkEwmaUnbiased(symbol: string) {
  console.log(`▶ EWMA (unbiased) for ${symbol}`);

  const ewmaResult = await runEwmaWalker({
    symbol,
    lambda: EWMA_LAMBDA_UNBIASED,
    coverage: EWMA_COVERAGE,
    initialWindow: EWMA_INITIAL_WINDOW,
    horizon: EWMA_HORIZON,
  });

  const points = ewmaResult.points;
  assert.ok(points.length > 0, `${symbol}: ewma points empty`);

  let finiteSigma = 0;
  for (const p of points) {
    expectFinite(`${symbol}.S_t`, p.S_t);
    expectFinite(`${symbol}.y_hat`, p.y_hat_tp1);
    expectFinite(`${symbol}.L_tp1`, p.L_tp1);
    expectFinite(`${symbol}.U_tp1`, p.U_tp1);
    if (Number.isFinite(p.sigma_t) && p.sigma_t > 0) finiteSigma++;
  }
  assert.ok(
    finiteSigma > points.length * 0.8,
    `${symbol}: too few finite sigma_t values in EWMA points`
  );

  console.log(`  ✓ ${symbol}: EWMA points=${points.length}, sigma_t finite in ${finiteSigma}`);
}

async function checkEwmaConfigs(symbol: string, calibration: TrendWeightCalibration | null) {
  console.log(`▶ EWMA configs for ${symbol}`);

  // For now, we just log lambda/trainFraction choices from timing logic indirectly via walker.
  // You can extend this later to call biased/optimized endpoints.
  // For Phase 2, just ensure unbiased walker works; Biased/Max will be covered in sim-level smoke.
  console.log('  (Biased/Max configs will be exercised in sim-level smoke tests)');
}

async function checkTrendZSeries(symbol: string) {
  console.log(`▶ Trend z-series for ${symbol}`);

  const canonical = await loadCanonicalData(symbol);
  const priceRows = canonical
    .map((row) => {
      const price = row.adj_close ?? row.close;
      return price && price > 0 ? { date: row.date, close: price } : null;
    })
    .filter((r): r is { date: string; close: number } => !!r);

  const zSeries = computeEwmaGapZSeries(priceRows, TREND_SHORT, TREND_LONG, TREND_LOOKBACK);
  assert.ok(zSeries.length > 0, `${symbol}: z-series empty`);

  let finiteZ = 0;
  let sumZ = 0;
  for (const p of zSeries) {
    if (Number.isFinite(p.z)) {
      finiteZ++;
      sumZ += p.z;
    }
  }
  assert.ok(finiteZ > zSeries.length * 0.8, `${symbol}: too many non-finite z values`);

  const meanZ = sumZ / finiteZ;
  // z should be roughly centered; let's allow |mean| <= 0.5
  assert.ok(
    Math.abs(meanZ) <= 0.5,
    `${symbol}: mean z too far from 0 (${meanZ.toFixed(3)})`
  );

  console.log(
    `  ✓ ${symbol}: z-series length=${zSeries.length}, finite=${finiteZ}, meanZ≈${meanZ.toFixed(3)}`
  );
}

async function checkTrendCalibration() {
  console.log('▶ Trend calibration JSON');

  const calibration = await loadTrendWeightCalibration();
  assert.ok(calibration, 'TrendWeightCalibration is null/undefined');

  const {
    trendSignalWeightGlobal,
    calibrationDate,
    horizon,
    shortWindow,
    longWindow,
    lookback,
    rowCount,
    r2,
  } = calibration;

  expectFinite('trendSignalWeightGlobal', trendSignalWeightGlobal);
  assert.ok(
    Math.abs(trendSignalWeightGlobal) <= 0.2,
    `trendSignalWeightGlobal too large: ${trendSignalWeightGlobal}`
  );
  assert.ok(calibrationDate, 'calibrationDate missing/empty');
  assert.ok(horizon > 0, 'horizon must be > 0');
  assert.ok(shortWindow > 0 && longWindow > 0, 'short/long windows must be > 0');
  assert.ok(lookback > 0, 'lookback must be > 0');
  assert.ok(rowCount > 0, 'rowCount must be > 0');
  expectInRange('r2', r2, 0, 1);

  const effectiveTrendWeight =
    Math.abs(trendSignalWeightGlobal) >= 0.005 ? trendSignalWeightGlobal : 0.05;

  console.log(
    `  ✓ calibration: raw=${trendSignalWeightGlobal.toFixed(6)}, r2=${r2.toFixed(
      4
    )}, rowCount=${rowCount}`
  );
  console.log(`  ✓ effectiveTrendWeight (for sims) = ${effectiveTrendWeight.toFixed(3)}`);

  return { calibration, effectiveTrendWeight };
}

async function main() {
  console.log('=== EWMA / Trend INPUTS smoke test ===');

  const { calibration, effectiveTrendWeight } = await checkTrendCalibration();

  for (const symbol of SMOKE_SYMBOLS) {
    await checkCanonical(symbol);
    await checkEwmaUnbiased(symbol);
    await checkTrendZSeries(symbol);
    await checkEwmaConfigs(symbol, calibration);
  }

  console.log('\nAll input-level smoke checks completed.');
}

main().catch((err) => {
  console.error('\nINPUTS SMOKE TEST FAILED:');
  console.error(err);
  process.exit(1);
});
