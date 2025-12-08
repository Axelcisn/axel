/**
 * Smoke tests for core indicators: EWMA, Momentum (ROC), ADX (Wilder DMI).
 * Checks formulas on synthetic series and sanity on real canonical data.
 */

import { loadCanonicalData } from '../lib/storage/canonical';
import { runEwmaWalker } from '../lib/volatility/ewmaWalker';
import { computeMomentum, MomentumPoint } from '../lib/indicators/momentum';
import { computeAdx, AdxPoint } from '../lib/indicators/adx';
import { computeEwmaSeries } from '../lib/indicators/ewmaCrossover';

type PriceRow = { date: string; close: number };
type OhlcRow = { date: string; high: number; low: number; close: number };

const EPS = 1e-6;
let allOk = true;

function fail(msg: string) {
  console.error('FAIL:', msg);
  allOk = false;
}

function pass(msg: string) {
  console.log('PASS:', msg);
}

function approxEqual(a: number, b: number, eps = 1e-3) {
  return Math.abs(a - b) <= eps;
}

// ---------- Synthetic EWMA ----------
function testEwmaSynthetic() {
  console.log('\n=== EWMA synthetic ===');
  let ok = true;
  const window = 5;

  const makeSeries = (vals: number[]): PriceRow[] =>
    vals.map((v, i) => ({ date: `2020-01-${String(i + 1).padStart(2, '0')}`, close: v }));

  // Constant
  const constant = makeSeries(Array.from({ length: 20 }, () => 100));
  const ewmaConst = computeEwmaSeries(constant, window);
  const constOk = ewmaConst.every((p) => approxEqual(p.value, 100, 1e-3));
  if (!constOk) {
    ok = false;
    fail('EWMA constant series not flat at 100');
  } else {
    pass('EWMA constant series flat at 100');
  }

  // Linear uptrend
  const uptrend = makeSeries(Array.from({ length: 20 }, (_, i) => 100 + i));
  const ewmaUp = computeEwmaSeries(uptrend, window);
  const valuesUp = ewmaUp.map((p) => p.value);
  const monoUp = valuesUp.every((v, i) => i === 0 || v >= valuesUp[i - 1] - EPS);
  const lagsPrice = ewmaUp.every((p, idx) => p.value <= uptrend[idx + (uptrend.length - ewmaUp.length)]?.close + EPS);
  if (!monoUp || !lagsPrice) {
    ok = false;
    fail('EWMA uptrend not monotone increasing and lagging price');
  } else {
    pass('EWMA uptrend monotone and lags price');
  }

  // Jump then flat
  const jumpFlatVals = [100, 100, 100, 150, ...Array.from({ length: 16 }, () => 150)];
  const jumpFlat = makeSeries(jumpFlatVals);
  const ewmaJump = computeEwmaSeries(jumpFlat, window);
  const lastVal = ewmaJump[ewmaJump.length - 1]?.value ?? 0;
  const noOvershoot = ewmaJump.every((p) => p.value <= 150 + EPS);
  if (!noOvershoot || Math.abs(lastVal - 150) > 1) {
    ok = false;
    fail('EWMA jump/flat does not converge toward 150 without overshoot');
  } else {
    pass('EWMA jump/flat converges toward 150 without overshoot');
  }

  return ok;
}

// ---------- Synthetic Momentum ----------
function testMomentumSynthetic() {
  console.log('\n=== Momentum synthetic ===');
  let ok = true;
  const period = 3;
  const makeSeries = (vals: number[]): PriceRow[] =>
    vals.map((v, i) => ({ date: `2020-02-${String(i + 1).padStart(2, '0')}`, close: v }));

  const checkSeries = (name: string, rows: PriceRow[], sign: 'zero' | 'pos' | 'neg') => {
    const res = computeMomentum(rows, period);
    const pts = res.points;
    if (pts.length === 0) {
      ok = false;
      fail(`Momentum ${name}: no points`);
      return;
    }
    pts.forEach((p, idx) => {
      const originalIdx = idx + period;
      const expectedDiff = rows[originalIdx].close - rows[originalIdx - period].close;
      const expectedPct = expectedDiff / rows[originalIdx - period].close;
      if (!approxEqual(p.momentum, expectedDiff, 1e-6) || !approxEqual(p.momentumPct, expectedPct, 1e-6)) {
        ok = false;
        fail(`Momentum ${name}: math mismatch at ${p.date}`);
      }
      if (sign === 'zero' && (Math.abs(p.momentum) > 1e-6 || Math.abs(p.momentumPct) > 1e-6)) {
        ok = false;
        fail(`Momentum ${name}: expected ~0 got ${p.momentum} / ${p.momentumPct}`);
      }
      if (sign === 'pos' && (p.momentum <= 0 || p.momentumPct <= 0)) {
        ok = false;
        fail(`Momentum ${name}: expected positive at ${p.date}`);
      }
      if (sign === 'neg' && (p.momentum >= 0 || p.momentumPct >= 0)) {
        ok = false;
        fail(`Momentum ${name}: expected negative at ${p.date}`);
      }
    });
    if (ok) pass(`Momentum ${name}: math checks ok`);
  };

  checkSeries('constant', makeSeries(Array(10).fill(100)), 'zero');
  checkSeries('uptrend', makeSeries(Array.from({ length: 10 }, (_, i) => 100 + 10 * i)), 'pos');
  checkSeries('downtrend', makeSeries(Array.from({ length: 10 }, (_, i) => 100 - 10 * i)), 'neg');

  return ok;
}

// ---------- Synthetic ADX ----------
function buildOhlcFromClose(closes: number[]): OhlcRow[] {
  return closes.map((c, i) => ({
    date: `2020-03-${String(i + 1).padStart(2, '0')}`,
    high: c + 1,
    low: c - 1,
    close: c,
  }));
}

function testAdxSynthetic() {
  console.log('\n=== ADX synthetic ===');
  let ok = true;
  const period = 14;

  const upCloses = Array.from({ length: 40 }, (_, i) => 100 + i * 2);
  const flatCloses = Array.from({ length: 40 }, () => 100);

  const upRes = computeAdx(buildOhlcFromClose(upCloses), period);
  const flatRes = computeAdx(buildOhlcFromClose(flatCloses), period);

  const upPts = upRes.points;
  const flatPts = flatRes.points;

  const diDominance = upPts.filter((p) => p.plusDI > p.minusDI).length / (upPts.length || 1);
  if (diDominance < 0.7) {
    ok = false;
    fail('ADX uptrend: +DI does not dominate -DI');
  } else {
    pass('ADX uptrend: +DI dominates');
  }

  const upAdxMax = upPts.reduce((m, p) => Math.max(m, p.adx), 0);
  if (upAdxMax < 25) {
    ok = false;
    fail('ADX uptrend: ADX never rises above 25');
  } else {
    pass('ADX uptrend: ADX rises above 25');
  }

  const flatAdxMax = flatPts.reduce((m, p) => Math.max(m, p.adx), 0);
  if (flatAdxMax > 5) {
    ok = false;
    fail('ADX flat: ADX not near zero');
  } else {
    pass('ADX flat: ADX stays near zero');
  }

  const allInRange = [...upPts, ...flatPts].every(
    (p) =>
      p.adx >= -EPS &&
      p.adx <= 100 + EPS &&
      p.plusDI >= -EPS &&
      p.plusDI <= 100 + EPS &&
      p.minusDI >= -EPS &&
      p.minusDI <= 100 + EPS
  );
  if (!allInRange) {
    ok = false;
    fail('ADX synthetic: values outside [0,100]');
  } else {
    pass('ADX synthetic: values within [0,100]');
  }

  return ok;
}

// ---------- Real data smoke ----------
async function smokeReal() {
  console.log('\n=== Real-symbol smoke ===');
  let ok = true;
  const symbols = ['TSLA', 'AAPL', 'MSFT'];
  const momentumPeriod = 10;
  const adxPeriod = 14;

  for (const symbol of symbols) {
    console.log(`\n-- ${symbol} --`);
    const rows = await loadCanonicalData(symbol);
    const daily = rows
      .filter((r) => r.close != null && r.high != null && r.low != null)
      .sort((a, b) => a.date.localeCompare(b.date));

    const recent = daily.slice(-260); // approx last year
    if (recent.length === 0) {
      ok = false;
      fail(`${symbol}: no canonical data`);
      continue;
    }

    // EWMA walker
    try {
      const ewma = await runEwmaWalker({
        symbol,
        lambda: 0.94,
        coverage: 0.95,
        horizon: 1,
      });
      const pathSample = ewma.points.slice(-5);
      const hasNaN = ewma.points.some(
        (p) =>
          !isFinite(p.y_hat_tp1) ||
          !isFinite(p.L_tp1) ||
          !isFinite(p.U_tp1) ||
          p.L_tp1 > p.U_tp1
      );
      if (ewma.points.length === 0 || hasNaN) {
        ok = false;
        fail(`${symbol} EWMA walker: invalid data`);
      } else {
        pass(`${symbol} EWMA walker: ${ewma.points.length} points`);
        console.log('Sample (date_t, S_tp1, L, U):');
        pathSample.forEach((p) =>
          console.log(
            `${p.date_t} -> ${p.S_tp1?.toFixed(2)} in [${p.L_tp1.toFixed(2)}, ${p.U_tp1.toFixed(
              2
            )}]`
          )
        );
      }
    } catch (err) {
      ok = false;
      fail(`${symbol} EWMA walker error: ${(err as Error).message}`);
    }

    // Momentum
    const momRows: PriceRow[] = recent.map((r) => ({ date: r.date, close: r.close }));
    const mom = computeMomentum(momRows, momentumPeriod);
    const momInvalid = mom.points.some((p) => !isFinite(p.momentum) || !isFinite(p.momentumPct));
    if (mom.points.length === 0 || momInvalid) {
      ok = false;
      fail(`${symbol} Momentum: invalid points`);
    } else {
      pass(`${symbol} Momentum: ${mom.points.length} points`);
      const last = mom.latest!;
      console.log(
        `Momentum last: ${last.date} Δ=${last.momentum.toFixed(2)} (${(last.momentumPct * 100).toFixed(
          2
        )}%)`
      );
      const lastYear = mom.points.slice(-260);
      const momPctVals = lastYear.map((p) => p.momentumPct);
      const minPct = Math.min(...momPctVals);
      const maxPct = Math.max(...momPctVals);
      const meanPct = momPctVals.reduce((a, b) => a + b, 0) / momPctVals.length;
      console.log(
        `Momentum pct stats (last ~year): min=${(minPct * 100).toFixed(
          2
        )}%, max=${(maxPct * 100).toFixed(2)}%, mean=${(meanPct * 100).toFixed(2)}%`
      );
    }

    // ADX
    const adxRows: OhlcRow[] = recent.map((r) => ({
      date: r.date,
      high: r.high,
      low: r.low,
      close: r.close,
    }));
    const adx = computeAdx(adxRows, adxPeriod);
    const adxInvalid = adx.points.some(
      (p) =>
        p.adx < -EPS ||
        p.adx > 100 + EPS ||
        p.plusDI < -EPS ||
        p.plusDI > 100 + EPS ||
        p.minusDI < -EPS ||
        p.minusDI > 100 + EPS
    );
    if (adx.points.length === 0 || adxInvalid) {
      ok = false;
      fail(`${symbol} ADX: invalid points`);
    } else {
      pass(`${symbol} ADX: ${adx.points.length} points`);
      const last = adx.latest!;
      console.log(
        `ADX last: ${last.date} +DI=${last.plusDI.toFixed(2)} -DI=${last.minusDI.toFixed(
          2
        )} ADX=${last.adx.toFixed(2)}`
      );
      const lastYear = adx.points.slice(-260);
      const adxVals = lastYear.map((p) => p.adx);
      const minAdx = Math.min(...adxVals);
      const maxAdx = Math.max(...adxVals);
      console.log(`ADX stats (last ~year): min=${minAdx.toFixed(2)}, max=${maxAdx.toFixed(2)}`);
    }
  }

  return ok;
}

async function main() {
  let syntheticOk = true;
  syntheticOk = testEwmaSynthetic() && syntheticOk;
  syntheticOk = testMomentumSynthetic() && syntheticOk;
  syntheticOk = testAdxSynthetic() && syntheticOk;

  const realOk = await smokeReal();

  console.log('\n=== Summary ===');
  console.log(`EWMA synthetic: ${syntheticOk ? 'PASS' : 'FAIL'}`);
  console.log(`Momentum synthetic: ${syntheticOk ? 'PASS' : 'FAIL'}`); // combined flag covers all synthetic
  console.log(`ADX synthetic: ${syntheticOk ? 'PASS' : 'FAIL'}`);
  console.log(`Real-symbol smoke: ${realOk ? 'PASS' : 'FAIL'}`);

  allOk = allOk && syntheticOk && realOk;
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
