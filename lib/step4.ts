/*
 * Step-4 volatility and prediction interval engine.
 * Implements the requirements from the Step-4 hardening instructions.
 */

export type VolModel = 'GBM_CC' | 'GARCH11_N' | 'GARCH11_t' | 'HAR_RV';

export interface Step4Variables {
  window_days: number;
  horizon_h_days: number;
  pi_coverage: number;
  drift_shrinkage_lambda: number;
  vol_model: VolModel;
  variance_targeting: boolean;
  innovations_df: number;
  vol_window_days?: number | null;
  skip_earnings: boolean;
}

export interface Step4InputRow extends Record<string, any> {
  date?: string | Date;
  Adj_Close?: number | null;
  adj_close?: number | null;
  close?: number | null;
  adjClose?: number | null;
  rv_d?: number | null;
  skipEarnings?: boolean;
  skip_earnings?: boolean;
}

export type NullableNumber = number | null;

export interface Step4ComputedRow extends Step4InputRow {
  adj_close_normalized?: NullableNumber;
  log_return?: NullableNumber;
  simple_return?: NullableNumber;
  mu_star_hat?: NullableNumber;
  sigma_hat?: NullableNumber;
  mu_star_used?: NullableNumber;
  sigma2_forecast_1d?: NullableNumber;
  sigma_forecast_1d?: NullableNumber;
  critical_value?: NullableNumber;
  expected_price_next_1d?: NullableNumber;
  pi_lower_1d?: NullableNumber;
  pi_upper_1d?: NullableNumber;
  band_width_bp?: NullableNumber;
  adj_close_next?: NullableNumber;
  z_score_next_1d?: NullableNumber;
  breakout_flag_1d?: boolean | null;
  breakout_direction_1d?: 'UP' | 'DOWN' | 'IN' | null;
  percent_outside_signed_1d?: NullableNumber;
  garch_alpha?: NullableNumber;
  garch_beta?: NullableNumber;
  garch_omega?: NullableNumber;
  garch_persistence?: NullableNumber;
  uncond_variance?: NullableNumber;
  innovations_df_out?: NullableNumber;
  aic?: NullableNumber;
  bic?: NullableNumber;
  diagnostics_reason?: 'ok' | 'insufficient_history' | 'no_next_day' | 'skip_earnings' | 'missing_price' | 'har_requirements';
}

export interface Step4Diagnostics {
  variables: Step4Variables;
  variable_values: Record<string, any>;
  nonNullCounts: Record<string, number>;
  sampleRows: Step4ComputedRow[];
  errors: string[];
  warnings: string[];
}

export interface Step4Result {
  rows: Step4ComputedRow[];
  diagnostics: Step4Diagnostics;
}

const REQUIRED_KEYS: (keyof Step4Variables)[] = [
  'window_days',
  'horizon_h_days',
  'pi_coverage',
  'drift_shrinkage_lambda',
  'vol_model',
  'variance_targeting',
  'innovations_df',
  'skip_earnings',
];

const OPTIONAL_KEYS: (keyof Step4Variables)[] = ['vol_window_days'];

const SUM_LIMIT = 1 - 1e-6;
const LOG_TWO_PI = Math.log(2 * Math.PI);

/**
 * Convert arbitrary label casing / spacing to canonical snake_case key.
 */
function canonicalKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_|_$/g, '');
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'yes', '1'].includes(normalized)) return true;
    if (['false', 'no', '0', ''].includes(normalized)) return false;
  }
  if (typeof value === 'number') return value !== 0;
  return false;
}

function parseNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeVariables(input: Record<string, any>): Step4Variables {
  const normalizedEntries = Object.entries(input).reduce<Record<string, any>>((acc, [key, value]) => {
    acc[canonicalKey(key)] = value;
    return acc;
  }, {});

  const errors: string[] = [];

  for (const required of REQUIRED_KEYS) {
    if (!(required in normalizedEntries)) {
      errors.push(`Missing required variable key: ${required}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  const window_days = parseNumber(normalizedEntries.window_days);
  const horizon_h_days = parseNumber(normalizedEntries.horizon_h_days);
  const pi_coverage = parseNumber(normalizedEntries.pi_coverage);
  const drift_shrinkage_lambda = parseNumber(normalizedEntries.drift_shrinkage_lambda);
  const vol_model = normalizedEntries.vol_model as VolModel;
  const variance_targeting = parseBoolean(normalizedEntries.variance_targeting);
  const innovations_df = parseNumber(normalizedEntries.innovations_df);
  const skip_earnings = parseBoolean(normalizedEntries.skip_earnings);
  const vol_window_days = OPTIONAL_KEYS.includes('vol_window_days')
    ? parseNumber(normalizedEntries.vol_window_days)
    : null;

  if (!window_days || window_days <= 1) {
    throw new Error('window_days must be a positive integer greater than 1');
  }
  if (!horizon_h_days || horizon_h_days < 1) {
    throw new Error('horizon_h_days must be a positive integer');
  }
  if (!pi_coverage || pi_coverage <= 0 || pi_coverage >= 1) {
    throw new Error('pi_coverage must be between 0 and 1');
  }
  if (drift_shrinkage_lambda == null) {
    throw new Error('drift_shrinkage_lambda must be provided');
  }
  if (!innovations_df || innovations_df <= 2) {
    throw new Error('innovations_df must be greater than 2');
  }
  if (!['GBM_CC', 'GARCH11_N', 'GARCH11_t', 'HAR_RV'].includes(vol_model)) {
    throw new Error(`Unsupported vol_model: ${vol_model}`);
  }
  if (vol_window_days != null && vol_window_days <= 1) {
    throw new Error('vol_window_days must be greater than 1 when specified');
  }

  return {
    window_days: Math.floor(window_days),
    horizon_h_days: Math.floor(horizon_h_days),
    pi_coverage,
    drift_shrinkage_lambda,
    vol_model,
    variance_targeting,
    innovations_df: Math.floor(innovations_df),
    vol_window_days: vol_window_days != null ? Math.floor(vol_window_days) : null,
    skip_earnings,
  };
}

function getAdjClose(row: Step4InputRow): NullableNumber {
  if (typeof row.Adj_Close === 'number') return row.Adj_Close;
  if (typeof row.adj_close === 'number') return row.adj_close;
  if (typeof row.adjClose === 'number') return row.adjClose;
  if (typeof row.close === 'number') return row.close;
  return null;
}

function mean(values: number[]): number {
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function sampleVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const sqDiff = values.reduce((acc, value) => acc + (value - avg) ** 2, 0);
  return sqDiff / (values.length - 1);
}

function standardDeviation(values: number[]): number {
  const variance = sampleVariance(values);
  return Math.sqrt(Math.max(variance, 0));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

function logit(p: number): number {
  return Math.log(p / (1 - p));
}

function gammaln(z: number): number {
  const cof = [
    76.18009172947146,
    -86.50532032941677,
    24.01409824083091,
    -1.231739572450155,
    0.1208650973866179e-2,
    -0.5395239384953e-5,
  ];
  let x = z;
  let y = z;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < cof.length; j++) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

function betacf(x: number, a: number, b: number): number {
  const MAX_ITER = 100;
  const EPS = 3e-7;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1, m2 = 2; m <= MAX_ITER; m++, m2 += 2) {
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;
    aa = -((a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function betainc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betacf(x, a, b)) / a;
  }
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

function studentTCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const a = df / 2;
  const b = 0.5;
  const ib = betainc(x, a, b);
  if (t >= 0) {
    return 1 - 0.5 * ib;
  }
  return 0.5 * ib;
}

function inverseStudentTCdf(df: number, p: number): number {
  if (p <= 0 || p >= 1) {
    throw new Error('p must be between 0 and 1 for inverseStudentTCdf');
  }
  if (p === 0.5) return 0;
  if (p < 0.5) {
    return -inverseStudentTCdf(df, 1 - p);
  }
  let low = 0;
  let high = 1;
  while (studentTCdf(high, df) < p) {
    high *= 2;
  }
  for (let iter = 0; iter < 100; iter++) {
    const mid = (low + high) / 2;
    const cdf = studentTCdf(mid, df);
    if (Math.abs(cdf - p) < 1e-8) {
      return mid;
    }
    if (cdf < p) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

function inverseNormalCdf(p: number): number {
  if (p <= 0 || p >= 1) {
    throw new Error('p must be between 0 and 1 for inverseNormalCdf');
  }
  // Abramowitz and Stegun approximation
  const a1 = -39.6968302866538;
  const a2 = 220.946098424521;
  const a3 = -275.928510446969;
  const a4 = 138.357751867269;
  const a5 = -30.6647980661472;
  const a6 = 2.50662827745924;
  const b1 = -54.4760987982241;
  const b2 = 161.585836858041;
  const b3 = -155.698979859887;
  const b4 = 66.8013118877197;
  const b5 = -13.2806815528857;
  const c1 = -0.00778489400243029;
  const c2 = -0.322396458041136;
  const c3 = -2.40075827716184;
  const c4 = -2.54973253934373;
  const c5 = 4.37466414146497;
  const c6 = 2.93816398269878;
  const d1 = 0.00778469570904146;
  const d2 = 0.32246712907004;
  const d3 = 2.445134137143;
  const d4 = 3.75440866190742;
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
      ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
    );
  }
  if (phigh < p) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
        ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
    );
  }
  q = p - 0.5;
  const r = q * q;
  return (
    (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q /
    (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1)
  );
}

interface GarchParams {
  omega: number;
  alpha: number;
  beta: number;
  sigma2SeriesDesc: number[];
  logLikelihood: number;
  aic: number;
  bic: number;
}

function clearGarchFields(row: Step4ComputedRow): void {
  row.garch_alpha = null;
  row.garch_beta = null;
  row.garch_omega = null;
  row.garch_persistence = null;
  row.uncond_variance = null;
  row.innovations_df_out = null;
  row.aic = null;
  row.bic = null;
}

interface FitGarchOptions {
  distribution: 'normal' | 'student-t';
  df: number;
  varianceTargeting: boolean;
}

function decodeParams(
  params: number[],
  sampleVar: number,
  varianceTargeting: boolean,
): { omega: number; alpha: number; beta: number } {
  const sumLimit = SUM_LIMIT;
  let offset = 0;
  let omega = 0;
  if (!varianceTargeting) {
    const w = params[offset++];
    omega = Math.exp(w);
  }
  const u = params[offset++];
  const v = params[offset++];
  const alphaRaw = clamp(sigmoid(u), 1e-6, 1 - 1e-6);
  const alpha = alphaRaw * sumLimit;
  const betaRaw = clamp(sigmoid(v), 1e-6, 1 - 1e-6);
  const beta = betaRaw * Math.max(sumLimit - alpha, 1e-6);
  if (varianceTargeting) {
    const persistence = alpha + beta;
    const baseVar = sampleVar > 0 ? sampleVar : 1e-6;
    omega = (1 - persistence) * baseVar;
  }
  return { omega, alpha, beta };
}

function computeGarchSeries(
  epsDesc: number[],
  params: { omega: number; alpha: number; beta: number },
  distribution: 'normal' | 'student-t',
  df: number,
): { sigma2SeriesDesc: number[]; logLikelihood: number } {
  const epsAsc = [...epsDesc].reverse();
  const n = epsAsc.length;
  const sigma2Asc: number[] = new Array(n);
  const baseVar = sampleVariance(epsAsc) || 1e-6;
  let sigma2Prev = baseVar;
  let logLik = 0;
  for (let t = 0; t < n; t++) {
    const epsPrevSq = t === 0 ? baseVar : epsAsc[t - 1] ** 2;
    const sigma2 = params.omega + params.alpha * epsPrevSq + params.beta * sigma2Prev;
    const safeSigma2 = Math.max(sigma2, 1e-8);
    sigma2Asc[t] = safeSigma2;
    const epsValue = epsAsc[t];
    if (distribution === 'normal') {
      logLik += -0.5 * (LOG_TWO_PI + Math.log(safeSigma2) + (epsValue ** 2) / safeSigma2);
    } else {
      const nu = df;
      const denom = (nu - 2) * safeSigma2;
      logLik +=
        gammaln((nu + 1) / 2) -
        gammaln(nu / 2) -
        0.5 * (Math.log((nu - 2) * Math.PI) + Math.log(safeSigma2)) -
        ((nu + 1) / 2) * Math.log(1 + (epsValue ** 2) / denom);
    }
    sigma2Prev = safeSigma2;
  }
  return {
    sigma2SeriesDesc: sigma2Asc.reverse(),
    logLikelihood: logLik,
  };
}

function fitGarch(epsDesc: number[], options: FitGarchOptions): GarchParams | null {
  if (epsDesc.length < 5) {
    return null;
  }
  const epsAsc = [...epsDesc].reverse();
  const sampleVar = sampleVariance(epsAsc) || 1e-6;
  const initialAlpha = 0.05;
  const initialBeta = 0.9;
  const boundedAlpha = Math.min(initialAlpha, SUM_LIMIT - 1e-4);
  const boundedBeta = Math.min(initialBeta, SUM_LIMIT - boundedAlpha - 1e-4);
  const initialOmega = (1 - boundedAlpha - boundedBeta) * sampleVar;

  const initialParams: number[] = [];
  if (!options.varianceTargeting) {
    initialParams.push(Math.log(Math.max(initialOmega, 1e-6)));
  }
  initialParams.push(logit(boundedAlpha / SUM_LIMIT));
  initialParams.push(logit(boundedBeta / Math.max(SUM_LIMIT - boundedAlpha, 1e-6)));

  const dimension = initialParams.length;
  const simplex: number[][] = new Array(dimension + 1);
  const STEP = 0.1;
  simplex[0] = [...initialParams];
  for (let i = 0; i < dimension; i++) {
    const point = [...initialParams];
    point[i] += STEP;
    simplex[i + 1] = point;
  }

  function objective(params: number[]): number {
    const decoded = decodeParams(params, sampleVar, options.varianceTargeting);
    if (decoded.alpha < 0 || decoded.beta < 0 || decoded.alpha + decoded.beta >= SUM_LIMIT) {
      return Number.POSITIVE_INFINITY;
    }
    const { sigma2SeriesDesc, logLikelihood } = computeGarchSeries(epsDesc, decoded, options.distribution, options.df);
    if (!sigma2SeriesDesc.every(v => Number.isFinite(v) && v > 0)) {
      return Number.POSITIVE_INFINITY;
    }
    return -logLikelihood;
  }

  const values = simplex.map(point => objective(point));

  const MAX_ITER = 250;
  const TOL = 1e-6;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const order = simplex
      .map((point, idx) => ({ point, value: values[idx] }))
      .sort((a, b) => a.value - b.value);

    for (let i = 0; i < order.length; i++) {
      simplex[i] = order[i].point;
      values[i] = order[i].value;
    }

    const bestValue = values[0];
    const worstValue = values[dimension];
    if (Math.abs(worstValue - bestValue) < TOL) {
      break;
    }

    const centroid = new Array(dimension).fill(0);
    for (let i = 0; i < dimension; i++) {
      for (let j = 0; j < dimension; j++) {
        centroid[j] += simplex[i][j];
      }
    }
    for (let j = 0; j < dimension; j++) {
      centroid[j] /= dimension;
    }

    const worst = simplex[dimension];
    const reflected = centroid.map((c, j) => c + (c - worst[j]));
    const reflectedValue = objective(reflected);

    if (reflectedValue < values[0]) {
      const expanded = centroid.map((c, j) => c + 2 * (c - worst[j]));
      const expandedValue = objective(expanded);
      if (expandedValue < reflectedValue) {
        simplex[dimension] = expanded;
        values[dimension] = expandedValue;
      } else {
        simplex[dimension] = reflected;
        values[dimension] = reflectedValue;
      }
      continue;
    }

    if (reflectedValue < values[dimension - 1]) {
      simplex[dimension] = reflected;
      values[dimension] = reflectedValue;
      continue;
    }

    const contracted = centroid.map((c, j) => c + 0.5 * (worst[j] - c));
    const contractedValue = objective(contracted);
    if (contractedValue < values[dimension]) {
      simplex[dimension] = contracted;
      values[dimension] = contractedValue;
      continue;
    }

    for (let i = 1; i < simplex.length; i++) {
      simplex[i] = simplex[0].map((value, j) => value + 0.5 * (simplex[i][j] - value));
      values[i] = objective(simplex[i]);
    }
  }

  const bestParams = simplex[0];
  const decoded = decodeParams(bestParams, sampleVar, options.varianceTargeting);
  const { sigma2SeriesDesc, logLikelihood } = computeGarchSeries(
    epsDesc,
    decoded,
    options.distribution,
    options.df,
  );
  const k = options.varianceTargeting ? 2 : 3;
  const n = epsDesc.length;
  const aic = 2 * k - 2 * logLikelihood;
  const bic = Math.log(n) * k - 2 * logLikelihood;
  return {
    omega: decoded.omega,
    alpha: decoded.alpha,
    beta: decoded.beta,
    sigma2SeriesDesc,
    logLikelihood,
    aic,
    bic,
  };
}

function computeBandWidthBp(lower: number, upper: number): number {
  if (lower <= 0) return 0;
  return 10000 * (upper / lower - 1);
}

function shouldSkipRow(row: Step4InputRow, variables: Step4Variables): boolean {
  if (!variables.skip_earnings) return false;
  const flags = [row.skipEarnings, (row as any).skip_earnings, (row as any).skipVerification];
  return flags.some(value => value === true);
}

const COMPUTED_COLUMNS = [
  'adj_close_normalized',
  'log_return',
  'simple_return',
  'mu_star_hat',
  'sigma_hat',
  'mu_star_used',
  'sigma2_forecast_1d',
  'sigma_forecast_1d',
  'critical_value',
  'expected_price_next_1d',
  'pi_lower_1d',
  'pi_upper_1d',
  'band_width_bp',
  'adj_close_next',
  'z_score_next_1d',
  'breakout_flag_1d',
  'breakout_direction_1d',
  'percent_outside_signed_1d',
  'garch_alpha',
  'garch_beta',
  'garch_omega',
  'garch_persistence',
  'uncond_variance',
  'innovations_df_out',
  'aic',
  'bic',
];

export function computeStep4(
  inputRows: Step4InputRow[],
  variableMap: Record<string, any>,
): Step4Result {
  const variables = normalizeVariables(variableMap);
  const rows: Step4ComputedRow[] = inputRows.map(row => ({ ...row }));
  const errors: string[] = [];
  const warnings: string[] = [];

  const n = rows.length;
  if (n === 0) {
    const emptyDiagnostics: Step4Diagnostics = {
      variables,
      variable_values: {
        window_days: variables.window_days,
        horizon_h_days: variables.horizon_h_days,
        pi_coverage: variables.pi_coverage,
        drift_shrinkage_lambda: variables.drift_shrinkage_lambda,
        vol_model: variables.vol_model,
        variance_targeting: variables.variance_targeting,
        innovations_df: variables.innovations_df,
        vol_window_days: variables.vol_window_days ?? null,
        skip_earnings: variables.skip_earnings,
      },
      nonNullCounts: {},
      sampleRows: [],
      errors,
      warnings,
    };
    return { rows: [], diagnostics: emptyDiagnostics };
  }
  const adjCloses: NullableNumber[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const adjClose = getAdjClose(rows[i]);
    if (adjClose == null || !Number.isFinite(adjClose)) {
      rows[i].diagnostics_reason = 'missing_price';
    }
    rows[i].adj_close_normalized = adjClose;
    adjCloses[i] = adjClose;
  }

  const logReturns: NullableNumber[] = new Array(n).fill(null);
  const simpleReturns: NullableNumber[] = new Array(n).fill(null);
  for (let i = 0; i < n - 1; i++) {
    const current = adjCloses[i];
    const next = adjCloses[i + 1];
    if (current != null && next != null && next !== 0) {
      logReturns[i] = Math.log(current / next);
      simpleReturns[i] = current / next - 1;
    } else {
      logReturns[i] = null;
      simpleReturns[i] = null;
    }
    rows[i].log_return = logReturns[i];
    rows[i].simple_return = simpleReturns[i];
  }
  rows[n - 1].log_return = null;
  rows[n - 1].simple_return = null;

  const muStarHat: NullableNumber[] = new Array(n).fill(null);
  const sigmaHat: NullableNumber[] = new Array(n).fill(null);
  const window = variables.window_days;
  for (let i = 0; i < n; i++) {
    const end = i + window;
    if (end > n) {
      rows[i].diagnostics_reason = rows[i].diagnostics_reason ?? 'insufficient_history';
      continue;
    }
    const windowReturns: number[] = [];
    let valid = true;
    for (let j = i; j < end; j++) {
      const value = logReturns[j];
      if (value == null) {
        valid = false;
        break;
      }
      windowReturns.push(value);
    }
    if (!valid || windowReturns.length === 0) {
      rows[i].diagnostics_reason = rows[i].diagnostics_reason ?? 'insufficient_history';
      continue;
    }
    muStarHat[i] = mean(windowReturns);
    sigmaHat[i] = standardDeviation(windowReturns);
    rows[i].mu_star_hat = muStarHat[i];
    rows[i].sigma_hat = sigmaHat[i];
  }

  const muStarUsed: NullableNumber[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const mu = muStarHat[i];
    if (mu == null) {
      rows[i].mu_star_used = null;
      continue;
    }
    const used = variables.drift_shrinkage_lambda * mu;
    muStarUsed[i] = used;
    rows[i].mu_star_used = used;
  }

  const epsilon: NullableNumber[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (logReturns[i] != null && muStarUsed[i] != null) {
      epsilon[i] = (logReturns[i] as number) - (muStarUsed[i] as number);
    }
  }

  const zNormal = inverseNormalCdf(0.5 + variables.pi_coverage / 2);
  const tCritical = inverseStudentTCdf(variables.innovations_df, 0.5 + variables.pi_coverage / 2);

  for (let i = 0; i < n; i++) {
    const sigmaBase = sigmaHat[i];
    const muUsed = muStarUsed[i];
    const price = adjCloses[i];
    const skipRow = shouldSkipRow(rows[i], variables);
    clearGarchFields(rows[i]);

    if (sigmaBase == null || muUsed == null || price == null) {
      rows[i].sigma2_forecast_1d = null;
      rows[i].sigma_forecast_1d = null;
      rows[i].critical_value = null;
      rows[i].expected_price_next_1d = null;
      rows[i].pi_lower_1d = null;
      rows[i].pi_upper_1d = null;
      rows[i].band_width_bp = null;
      rows[i].diagnostics_reason = rows[i].diagnostics_reason ?? 'insufficient_history';
      continue;
    }

    let sigmaForecast: number | null = null;
    let sigma2Forecast: number | null = null;
    let criticalValue: number | null = null;
    if (variables.vol_model === 'GBM_CC') {
      sigmaForecast = sigmaBase;
      sigma2Forecast = sigmaBase ** 2;
      criticalValue = zNormal;
    } else if (variables.vol_model === 'HAR_RV') {
      if (rows[i].rv_d == null) {
        rows[i].diagnostics_reason = 'har_requirements';
        warnings.push('HAR_RV selected but rv_d is missing.');
        rows[i].sigma2_forecast_1d = null;
        rows[i].sigma_forecast_1d = null;
        rows[i].critical_value = null;
        rows[i].expected_price_next_1d = null;
        rows[i].pi_lower_1d = null;
        rows[i].pi_upper_1d = null;
        rows[i].band_width_bp = null;
        continue;
      }
      sigmaForecast = sigmaBase;
      sigma2Forecast = sigmaBase ** 2;
      criticalValue = zNormal;
    } else {
      const volWindow = variables.vol_window_days && variables.vol_window_days > 0
        ? variables.vol_window_days
        : variables.window_days;
      const end = i + volWindow;
      if (end > n) {
        rows[i].diagnostics_reason = rows[i].diagnostics_reason ?? 'insufficient_history';
        continue;
      }
      const epsWindow: number[] = [];
      let valid = true;
      for (let j = i; j < end; j++) {
        const value = epsilon[j];
        if (value == null) {
          valid = false;
          break;
        }
        epsWindow.push(value);
      }
      if (!valid || epsWindow.length < 5) {
        rows[i].diagnostics_reason = rows[i].diagnostics_reason ?? 'insufficient_history';
        continue;
      }
      const garch = fitGarch(epsWindow, {
        distribution: variables.vol_model === 'GARCH11_t' ? 'student-t' : 'normal',
        df: variables.innovations_df,
        varianceTargeting: variables.variance_targeting,
      });
      if (!garch) {
        rows[i].diagnostics_reason = rows[i].diagnostics_reason ?? 'insufficient_history';
        continue;
      }
      garchResult = garch;
      const sigma2Current = garch.sigma2SeriesDesc[0];
      const epsCurrent = epsilon[i] ?? 0;
      sigma2Forecast = garch.omega + garch.alpha * (epsCurrent ** 2) + garch.beta * sigma2Current;
      sigma2Forecast = Math.max(sigma2Forecast, 1e-12);
      sigmaForecast = Math.sqrt(sigma2Forecast);
      criticalValue = variables.vol_model === 'GARCH11_t' ? tCritical : zNormal;
      rows[i].garch_alpha = garch.alpha;
      rows[i].garch_beta = garch.beta;
      rows[i].garch_omega = garch.omega;
      rows[i].garch_persistence = garch.alpha + garch.beta;
      rows[i].uncond_variance = garch.omega / Math.max(1 - (garch.alpha + garch.beta), 1e-6);
      rows[i].innovations_df_out = variables.vol_model === 'GARCH11_t' ? variables.innovations_df : null;
      rows[i].aic = garch.aic;
      rows[i].bic = garch.bic;
    }

    if (sigmaForecast == null || sigma2Forecast == null || criticalValue == null) {
      rows[i].diagnostics_reason = rows[i].diagnostics_reason ?? 'insufficient_history';
      continue;
    }

    rows[i].sigma2_forecast_1d = sigma2Forecast;
    rows[i].sigma_forecast_1d = sigmaForecast;
    rows[i].critical_value = criticalValue;

    const expected = price * Math.exp(muUsed);
    const lower = price * Math.exp(muUsed - criticalValue * sigmaForecast);
    const upper = price * Math.exp(muUsed + criticalValue * sigmaForecast);
    rows[i].expected_price_next_1d = expected;
    rows[i].pi_lower_1d = lower;
    rows[i].pi_upper_1d = upper;
    rows[i].band_width_bp = computeBandWidthBp(lower, upper);

    if (skipRow) {
      rows[i].diagnostics_reason = 'skip_earnings';
    } else {
      rows[i].diagnostics_reason = rows[i].diagnostics_reason ?? 'ok';
    }
  }

  for (let i = 0; i < n; i++) {
    const nextRow = i === 0 ? null : rows[i - 1];
    const currentPrice = adjCloses[i];
    const muUsed = muStarUsed[i];
    const sigmaForecast = rows[i].sigma_forecast_1d ?? null;
    const skipRow = shouldSkipRow(rows[i], variables);
    if (nextRow && nextRow.adj_close_normalized != null && currentPrice != null && muUsed != null && sigmaForecast) {
      const nextPrice = nextRow.adj_close_normalized as number;
      rows[i].adj_close_next = skipRow ? null : nextPrice;
      if (skipRow) {
        rows[i].z_score_next_1d = null;
        rows[i].breakout_flag_1d = null;
        rows[i].breakout_direction_1d = null;
        rows[i].percent_outside_signed_1d = null;
        continue;
      }
      const zScore =
        (Math.log(nextPrice) - Math.log(currentPrice) - muUsed) /
        (sigmaForecast === 0 ? 1e-9 : sigmaForecast);
      rows[i].z_score_next_1d = zScore;
      const lower = rows[i].pi_lower_1d;
      const upper = rows[i].pi_upper_1d;
      if (lower != null && upper != null) {
        if (nextPrice > upper) {
          rows[i].breakout_flag_1d = true;
          rows[i].breakout_direction_1d = 'UP';
          rows[i].percent_outside_signed_1d = (nextPrice - upper) / upper;
        } else if (nextPrice < lower) {
          rows[i].breakout_flag_1d = true;
          rows[i].breakout_direction_1d = 'DOWN';
          rows[i].percent_outside_signed_1d = (nextPrice - lower) / lower;
        } else {
          rows[i].breakout_flag_1d = false;
          rows[i].breakout_direction_1d = 'IN';
          rows[i].percent_outside_signed_1d = 0;
        }
      } else {
        rows[i].breakout_flag_1d = null;
        rows[i].breakout_direction_1d = null;
        rows[i].percent_outside_signed_1d = null;
      }
    } else {
      rows[i].adj_close_next = null;
      rows[i].z_score_next_1d = null;
      rows[i].breakout_flag_1d = null;
      rows[i].breakout_direction_1d = null;
      rows[i].percent_outside_signed_1d = null;
      if (i === 0) {
        rows[i].diagnostics_reason = rows[i].diagnostics_reason ?? 'no_next_day';
      }
    }
  }

  const nonNullCounts: Record<string, number> = {};
  for (const key of COMPUTED_COLUMNS) {
    let count = 0;
    for (const row of rows) {
      const value = (row as any)[key];
      if (value !== null && value !== undefined) {
        count += 1;
      }
    }
    nonNullCounts[key] = count;
  }

  const sampleIndices = Array.from(new Set([0, Math.floor(n / 2), Math.max(n - 1, 0)])).filter(
    index => index >= 0 && index < n,
  );
  const sampleRows = sampleIndices.map(index => rows[index]);

  const diagnostics: Step4Diagnostics = {
    variables,
    variable_values: {
      window_days: variables.window_days,
      horizon_h_days: variables.horizon_h_days,
      pi_coverage: variables.pi_coverage,
      drift_shrinkage_lambda: variables.drift_shrinkage_lambda,
      vol_model: variables.vol_model,
      variance_targeting: variables.variance_targeting,
      innovations_df: variables.innovations_df,
      vol_window_days: variables.vol_window_days ?? null,
      skip_earnings: variables.skip_earnings,
    },
    nonNullCounts,
    sampleRows,
    errors,
    warnings,
  };

  return {
    rows,
    diagnostics,
  };
}
