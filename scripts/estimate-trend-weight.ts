import fs from 'fs';
import path from 'path';
import { buildTrendPanel, type TrendPanelRow } from './build-trend-panel';

interface RegressionResult {
  beta0: number;
  beta1: number;
  beta2: number;
  r2: number;
}

interface TrendWeightResult extends RegressionResult {
  trendSignalWeightGlobalRaw: number;
  trendSignalWeightGlobal: number;
}

interface TrendWeightCalibration {
  calibrationDate: string;
  horizon: number;
  shortWindow: number;
  longWindow: number;
  lookback: number;
  symbols: string[];
  rowCount: number;
  beta0: number;
  beta1: number;
  beta2: number;
  r2: number;
  corrYBase: number;
  corrYTrend: number;
  beta2Raw?: number;
  trendSignalWeightGlobal: number;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function variance(xs: number[], m: number): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) {
    const d = x - m;
    s += d * d;
  }
  return s / xs.length;
}

function covariance(xs: number[], mx: number, ys: number[], my: number): number {
  const n = xs.length;
  if (n === 0 || ys.length !== n) return NaN;
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += (xs[i] - mx) * (ys[i] - my);
  }
  return s / n;
}

function correlation(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  const vx = variance(xs, mx);
  const vy = variance(ys, my);
  const cov = covariance(xs, mx, ys, my);
  if (!Number.isFinite(cov) || vx <= 0 || vy <= 0) return NaN;
  return cov / Math.sqrt(vx * vy);
}

function fitLinearRegression(panel: TrendPanelRow[]): RegressionResult | null {
  const xs1: number[] = [];
  const xs2: number[] = [];
  const ys: number[] = [];

  for (const row of panel) {
    const { y, baseSignal, trendSignal } = row;
    if (
      !Number.isFinite(y) ||
      !Number.isFinite(baseSignal) ||
      !Number.isFinite(trendSignal)
    ) {
      continue;
    }
    ys.push(y);
    xs1.push(baseSignal);
    xs2.push(trendSignal);
  }

  const n = ys.length;
  if (n < 10) {
    console.warn('Not enough rows for regression:', n);
    return null;
  }

  const mx1 = mean(xs1);
  const mx2 = mean(xs2);
  const var1 = variance(xs1, mx1);
  const var2 = variance(xs2, mx2);
  const eps = 1e-12;

  // Handle degenerate cases where one predictor is (nearly) constant
  if (var1 <= eps && var2 <= eps) {
    console.warn('Both predictors are near-constant; cannot fit regression.');
    return null;
  }

  // Intercept + trendSignal only
  if (var1 <= eps) {
    let sum1 = n;
    let sumX2 = 0;
    let sumX2X2 = 0;
    let sumY = 0;
    let sumX2Y = 0;

    for (let i = 0; i < n; i++) {
      const x2 = xs2[i];
      const y = ys[i];
      sumX2 += x2;
      sumX2X2 += x2 * x2;
      sumY += y;
      sumX2Y += x2 * y;
    }

    const det = sum1 * sumX2X2 - sumX2 * sumX2;
    if (Math.abs(det) < eps || !Number.isFinite(det)) {
      console.warn('Singular design matrix for trend-only regression.');
      return null;
    }

    const beta0 = (sumY * sumX2X2 - sumX2 * sumX2Y) / det;
    const beta2 = (sum1 * sumX2Y - sumX2 * sumY) / det;
    const beta1 = 0;

    const yMean = mean(ys);
    let ssTot = 0;
    let ssRes = 0;
    for (let i = 0; i < n; i++) {
      const y = ys[i];
      const x2 = xs2[i];
      const yPred = beta0 + beta2 * x2;
      ssTot += (y - yMean) ** 2;
      ssRes += (y - yPred) ** 2;
    }
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : NaN;

    return { beta0, beta1, beta2, r2 };
  }

  // Intercept + baseSignal only
  if (var2 <= eps) {
    let sum1 = n;
    let sumX1 = 0;
    let sumX1X1 = 0;
    let sumY = 0;
    let sumX1Y = 0;

    for (let i = 0; i < n; i++) {
      const x1 = xs1[i];
      const y = ys[i];
      sumX1 += x1;
      sumX1X1 += x1 * x1;
      sumY += y;
      sumX1Y += x1 * y;
    }

    const det = sum1 * sumX1X1 - sumX1 * sumX1;
    if (Math.abs(det) < eps || !Number.isFinite(det)) {
      console.warn('Singular design matrix for base-only regression.');
      return null;
    }

    const beta0 = (sumY * sumX1X1 - sumX1 * sumX1Y) / det;
    const beta1 = (sum1 * sumX1Y - sumX1 * sumY) / det;
    const beta2 = 0;

    const yMean = mean(ys);
    let ssTot = 0;
    let ssRes = 0;
    for (let i = 0; i < n; i++) {
      const y = ys[i];
      const x1 = xs1[i];
      const yPred = beta0 + beta1 * x1;
      ssTot += (y - yMean) ** 2;
      ssRes += (y - yPred) ** 2;
    }
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : NaN;

    return { beta0, beta1, beta2, r2 };
  }

  // Full model: intercept + baseSignal + trendSignal
  const sum1 = n; // sum of 1s
  let sumX1 = 0;
  let sumX2 = 0;
  let sumX1X1 = 0;
  let sumX2X2 = 0;
  let sumX1X2 = 0;
  let sumY = 0;
  let sumX1Y = 0;
  let sumX2Y = 0;

  for (let i = 0; i < n; i++) {
    const x1 = xs1[i];
    const x2 = xs2[i];
    const y = ys[i];

    sumX1 += x1;
    sumX2 += x2;
    sumX1X1 += x1 * x1;
    sumX2X2 += x2 * x2;
    sumX1X2 += x1 * x2;

    sumY += y;
    sumX1Y += x1 * y;
    sumX2Y += x2 * y;
  }

  const a11 = sum1;
  const a12 = sumX1;
  const a13 = sumX2;
  const a22 = sumX1X1;
  const a23 = sumX1X2;
  const a33 = sumX2X2;

  const b1 = sumY;
  const b2 = sumX1Y;
  const b3 = sumX2Y;

  const det =
    a11 * (a22 * a33 - a23 * a23) -
    a12 * (a12 * a33 - a13 * a23) +
    a13 * (a12 * a23 - a13 * a22);

  if (Math.abs(det) < eps || !Number.isFinite(det)) {
    console.warn('Singular XᵀX matrix; cannot solve regression.');
    return null;
  }

  const inv11 = (a22 * a33 - a23 * a23) / det;
  const inv12 = (a13 * a23 - a12 * a33) / det;
  const inv13 = (a12 * a23 - a13 * a22) / det;
  const inv21 = inv12;
  const inv22 = (a11 * a33 - a13 * a13) / det;
  const inv23 = (a13 * a12 - a11 * a23) / det;
  const inv31 = inv13;
  const inv32 = inv23;
  const inv33 = (a11 * a22 - a12 * a12) / det;

  const beta0 = inv11 * b1 + inv12 * b2 + inv13 * b3;
  const beta1 = inv21 * b1 + inv22 * b2 + inv23 * b3;
  const beta2 = inv31 * b1 + inv32 * b2 + inv33 * b3;

  const yMean = mean(ys);
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const y = ys[i];
    const x1 = xs1[i];
    const x2 = xs2[i];
    const yPred = beta0 + beta1 * x1 + beta2 * x2;
    ssTot += (y - yMean) ** 2;
    ssRes += (y - yPred) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : NaN;

  return { beta0, beta1, beta2, r2 };
}

function deriveTrendWeight(reg: RegressionResult): TrendWeightResult {
  const { beta0, beta1, beta2, r2 } = reg;

  const raw = beta2;
  const shrink = 1.0;
  let weight = raw * shrink;

  const maxAbs = 0.2;
  if (weight > maxAbs) weight = maxAbs;
  if (weight < -maxAbs) weight = -maxAbs;

  return {
    beta0,
    beta1,
    beta2,
    r2,
    trendSignalWeightGlobalRaw: raw,
    trendSignalWeightGlobal: weight,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const symbolsArg = args.find((a) => a.startsWith('--symbols='));
  const horizonArg = args.find((a) => a.startsWith('--h='));

  if (!symbolsArg) {
    console.error(
      'Usage: npx tsx scripts/estimate-trend-weight.ts --symbols=AAPL,TSLA,... [--h=1]'
    );
    process.exit(1);
  }

  const symbols = symbolsArg.split('=')[1].split(',').map((s) => s.trim());
  const parsedH = horizonArg ? parseInt(horizonArg.split('=')[1], 10) : 1;
  const horizon = Number.isFinite(parsedH) && parsedH > 0 ? parsedH : 1;

  const shortWindow = 14;
  const longWindow = 50;
  const lookback = 60;

  console.log('Building trend panel...');
  const panel = await buildTrendPanel(
    symbols,
    horizon,
    shortWindow,
    longWindow,
    lookback
  );
  console.log(`Panel rows: ${panel.length}`);
  if (panel.length < 10) {
    console.warn('Too few rows for a meaningful regression; exiting.');
    process.exit(0);
  }

  const ys = panel.map((r) => r.y);
  const baseSignals = panel.map((r) => r.baseSignal);
  const trendSignals = panel.map((r) => r.trendSignal);

  const corrYBase = correlation(ys, baseSignals);
  const corrYTrend = correlation(ys, trendSignals);

  console.log('Summary stats:');
  console.log(
    'y:      min',
    Math.min(...ys).toFixed(4),
    'max',
    Math.max(...ys).toFixed(4),
    'mean',
    mean(ys).toFixed(4)
  );
  console.log(
    'base:   min',
    Math.min(...baseSignals).toFixed(4),
    'max',
    Math.max(...baseSignals).toFixed(4),
    'mean',
    mean(baseSignals).toFixed(4)
  );
  console.log(
    'trend:  min',
    Math.min(...trendSignals).toFixed(4),
    'max',
    Math.max(...trendSignals).toFixed(4),
    'mean',
    mean(trendSignals).toFixed(4)
  );
  console.log(
    'corr(y, baseSignal):',
    corrYBase.toFixed(4)
  );
  console.log(
    'corr(y, trendSignal):',
    corrYTrend.toFixed(4)
  );

  const reg = fitLinearRegression(panel);
  if (!reg) {
    console.warn('Regression failed or was singular.');
    process.exit(0);
  }

  const res = deriveTrendWeight(reg);

  console.log('Regression coefficients:');
  console.log('  beta0 =', res.beta0.toFixed(6));
  console.log('  beta1 =', res.beta1.toFixed(6));
  console.log('  beta2 =', res.beta2.toFixed(6));
  console.log('  R^2   =', res.r2.toFixed(4));
  console.log('Trend weight:');
  console.log('  raw      =', res.trendSignalWeightGlobalRaw.toFixed(6));
  console.log('  clamped  =', res.trendSignalWeightGlobal.toFixed(6));

  if (!Number.isFinite(res.r2) || res.r2 < 0 || res.r2 > 1) {
    console.warn('WARNING: R^2 is outside [0,1] or not finite.');
  }
  if (!Number.isFinite(res.beta2) || Math.abs(res.beta2) > 1) {
    console.warn('WARNING: |beta2| is large or non-finite.');
  }
  if (!Number.isFinite(res.trendSignalWeightGlobal)) {
    console.warn('WARNING: trendSignalWeightGlobal is non-finite.');
  }

  const calibrationDate = new Date().toISOString().slice(0, 10);
  const calibration: TrendWeightCalibration = {
    calibrationDate,
    horizon,
    shortWindow,
    longWindow,
    lookback,
    symbols,
    rowCount: panel.length,
    beta0: res.beta0,
    beta1: res.beta1,
    beta2: res.beta2,
    r2: res.r2,
    corrYBase,
    corrYTrend,
    beta2Raw: res.trendSignalWeightGlobalRaw,
    trendSignalWeightGlobal: res.trendSignalWeightGlobal,
  };

  const calibrationDir = path.join(process.cwd(), 'data', 'calibration');
  const calibrationPath = path.join(calibrationDir, 'trend-weight.json');
  if (!fs.existsSync(calibrationDir)) {
    fs.mkdirSync(calibrationDir, { recursive: true });
  }

  fs.writeFileSync(calibrationPath, JSON.stringify(calibration, null, 2), 'utf8');
  console.log('Wrote Trend weight calibration to', calibrationPath);

  try {
    const raw = fs.readFileSync(calibrationPath, 'utf8');
    const loaded = JSON.parse(raw) as TrendWeightCalibration;
    console.log('Read back calibration:', loaded);

    if (
      !loaded ||
      typeof loaded.trendSignalWeightGlobal !== 'number' ||
      !Number.isFinite(loaded.trendSignalWeightGlobal)
    ) {
      console.warn(
        'WARNING: trendSignalWeightGlobal missing or non-finite in calibration file.'
      );
    }
    if (!Number.isFinite(loaded.r2) || loaded.r2 < 0 || loaded.r2 > 1) {
      console.warn('WARNING: r2 outside [0,1] or non-finite in calibration file.');
    }
    if (!loaded.calibrationDate) {
      console.warn('WARNING: calibrationDate is empty.');
    }
    if (loaded.rowCount < 100) {
      console.warn('WARNING: rowCount < 100; calibration may be based on too few observations.');
    }
    if (Math.abs(loaded.trendSignalWeightGlobal) > 0.5) {
      console.warn(
        'WARNING: trendSignalWeightGlobal magnitude > 0.5; may be too large.'
      );
    }
  } catch (err) {
    console.error('ERROR: Failed to read back calibration JSON:', err);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
