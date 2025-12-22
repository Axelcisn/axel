import { SigmaForecast } from './types';
import { loadCanonicalData } from '../storage/canonical';
import { CanonicalRow } from '../types/canonical';

export interface HarParams {
  symbol: string;
  date_t?: string;
  window: number;
  use_intraday_rv: boolean;
}

/**
 * Fit HAR-RV model and forecast one-step RV
 * 
 * Model: RV_{t+1} = β0 + βd RV_t + βw RV_t^(w) + βm RV_t^(m)
 * Returns: sigma_1d = sqrt(RV̂_{t+1})
 */
export async function fitAndForecastHar(params: HarParams): Promise<SigmaForecast> {
  const { symbol, date_t, window, use_intraday_rv } = params;
  
  // Load canonical data
  const data = await loadCanonicalData(symbol);
  if (!data || data.length === 0) {
    throw new Error(`No canonical data found for ${symbol}`);
  }
  
  // Filter up to date_t if specified
  let filteredData = data;
  if (date_t) {
    filteredData = data.filter((row: CanonicalRow) => row.date <= date_t);
  }
  
  if (filteredData.length < window) {
    throw new Error(`Insufficient data: need ${window}, have ${filteredData.length}`);
  }
  
  // If intraday RV is unavailable, fall back to squared daily log returns
  const hasRvData = checkForRealizedVolatility(filteredData);
  if (!hasRvData && use_intraday_rv) {
    throw new Error('HAR-RV disabled: no realized volatility data available');
  }
  
  // Get the last 'window' observations
  const windowData = filteredData.slice(-window);
  
  // Compute daily RV from squared returns (proxy since we don't have intraday data)
  const dailyRV = computeDailyRV(windowData);
  
  if (dailyRV.length < 22) { // Need at least 22 days for weekly/monthly averages
    throw new Error('Insufficient RV data for HAR model');
  }
  
  // Compute weekly and monthly RV averages
  const { rvDaily, rvWeekly, rvMonthly } = computeHarComponents(dailyRV);
  
  if (rvDaily.length < 10) {
    throw new Error('Insufficient data for HAR regression');
  }
  
  // Fit HAR model using OLS
  const harResult = fitHarModel(rvDaily, rvWeekly, rvMonthly);
  
  // One-step RV forecast
  const latestDaily = rvDaily[rvDaily.length - 1];
  const latestWeekly = rvWeekly[rvWeekly.length - 1];
  const latestMonthly = rvMonthly[rvMonthly.length - 1];
  
  const rvForecast = harResult.beta0 + 
                     harResult.beta_d * latestDaily + 
                     harResult.beta_w * latestWeekly + 
                     harResult.beta_m * latestMonthly;
  
  if (rvForecast <= 0) {
    throw new Error('Invalid RV forecast (RV ≤ 0)');
  }
  
  const sigma_1d = Math.sqrt(rvForecast);
  
  // Prepare diagnostics
  const diagnostics = {
    beta0: harResult.beta0,
    beta_d: harResult.beta_d,
    beta_w: harResult.beta_w,
    beta_m: harResult.beta_m,
    R2_in_sample: harResult.r2
  };
  
  return {
    source: 'HAR-RV',
    sigma_1d,
    sigma2_1d: rvForecast,
    diagnostics
  };
}

/**
 * Check if realized volatility data is available
 * (In practice, this would check for intraday data)
 */
function checkForRealizedVolatility(data: CanonicalRow[]): boolean {
  const rv = computeDailyRV(data);
  return rv.length > 0;
}

/**
 * Compute daily RV from squared returns (proxy)
 */
function computeDailyRV(data: CanonicalRow[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i].r;
    if (typeof r === "number" && Number.isFinite(r)) {
      returns.push(r);
      continue;
    }
    const prev = data[i - 1];
    const curr = data[i];
    const prevPrice = (prev.adj_close ?? prev.close) as number | null;
    const currPrice = (curr.adj_close ?? curr.close) as number | null;
    if (
      prevPrice != null &&
      currPrice != null &&
      prevPrice > 0 &&
      currPrice > 0
    ) {
      returns.push(Math.log(currPrice / prevPrice));
    }
  }
  return returns.map(r => r * r); // RV approximated by squared daily log returns
}

/**
 * Compute HAR components (daily, weekly, monthly RV)
 */
function computeHarComponents(dailyRV: number[]): {
  rvDaily: number[];
  rvWeekly: number[];
  rvMonthly: number[];
} {
  const n = dailyRV.length;
  const rvDaily: number[] = [];
  const rvWeekly: number[] = [];
  const rvMonthly: number[] = [];
  
  for (let i = 21; i < n; i++) { // Start from index 21 to have enough history
    // Daily RV (just the current day)
    rvDaily.push(dailyRV[i]);
    
    // Weekly RV (average of last 5 days)
    const weeklyAvg = dailyRV.slice(i - 4, i + 1).reduce((sum, rv) => sum + rv, 0) / 5;
    rvWeekly.push(weeklyAvg);
    
    // Monthly RV (average of last 22 days)
    const monthlyAvg = dailyRV.slice(i - 21, i + 1).reduce((sum, rv) => sum + rv, 0) / 22;
    rvMonthly.push(monthlyAvg);
  }
  
  return { rvDaily, rvWeekly, rvMonthly };
}

interface HarResult {
  beta0: number;
  beta_d: number;
  beta_w: number;
  beta_m: number;
  r2: number;
}

/**
 * Fit HAR model using OLS regression
 * RV_{t+1} = β0 + βd RV_t + βw RV_t^(w) + βm RV_t^(m)
 */
function fitHarModel(rvDaily: number[], rvWeekly: number[], rvMonthly: number[]): HarResult {
  const n = Math.min(rvDaily.length, rvWeekly.length, rvMonthly.length) - 1;
  
  // Prepare regression data
  const Y: number[] = []; // RV_{t+1}
  const X: number[][] = []; // [1, RV_t, RV_t^(w), RV_t^(m)]
  
  for (let i = 0; i < n; i++) {
    Y.push(rvDaily[i + 1]); // Next day's RV
    X.push([1, rvDaily[i], rvWeekly[i], rvMonthly[i]]);
  }
  
  // Solve OLS: β = (X'X)^(-1)X'Y
  const beta = solveOLS(X, Y);
  
  // Compute R²
  const yMean = Y.reduce((sum, y) => sum + y, 0) / Y.length;
  let ssTot = 0;
  let ssRes = 0;
  
  for (let i = 0; i < n; i++) {
    const yPred = beta[0] + beta[1] * rvDaily[i] + beta[2] * rvWeekly[i] + beta[3] * rvMonthly[i];
    ssTot += (Y[i] - yMean) ** 2;
    ssRes += (Y[i] - yPred) ** 2;
  }
  
  const r2 = 1 - (ssRes / ssTot);
  
  return {
    beta0: beta[0],
    beta_d: beta[1],
    beta_w: beta[2],
    beta_m: beta[3],
    r2
  };
}

/**
 * Solve OLS regression using normal equations
 */
function solveOLS(X: number[][], Y: number[]): number[] {
  const n = X.length;
  const k = X[0].length;
  
  // Compute X'X
  const XtX: number[][] = Array(k).fill(0).map(() => Array(k).fill(0));
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      for (let t = 0; t < n; t++) {
        XtX[i][j] += X[t][i] * X[t][j];
      }
    }
  }
  
  // Compute X'Y
  const XtY: number[] = Array(k).fill(0);
  for (let i = 0; i < k; i++) {
    for (let t = 0; t < n; t++) {
      XtY[i] += X[t][i] * Y[t];
    }
  }
  
  // Solve using simple matrix inversion (for 4x4 matrix)
  const XtXInv = invertMatrix4x4(XtX);
  
  // β = (X'X)^(-1)X'Y
  const beta: number[] = Array(k).fill(0);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      beta[i] += XtXInv[i][j] * XtY[j];
    }
  }
  
  return beta;
}

/**
 * Invert a 4x4 matrix (simplified for HAR model)
 */
function invertMatrix4x4(matrix: number[][]): number[][] {
  // This is a simplified inversion - in practice would use proper linear algebra
  const n = matrix.length;
  const identity = Array(n).fill(0).map((_, i) => Array(n).fill(0).map((__, j) => i === j ? 1 : 0));
  const augmented = matrix.map((row, i) => [...row, ...identity[i]]);
  
  // Gaussian elimination (simplified)
  for (let i = 0; i < n; i++) {
    // Find pivot
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
        maxRow = k;
      }
    }
    [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
    
    // Make diagonal 1
    const pivot = augmented[i][i];
    if (Math.abs(pivot) < 1e-10) {
      throw new Error('Matrix is singular');
    }
    
    for (let j = 0; j < 2 * n; j++) {
      augmented[i][j] /= pivot;
    }
    
    // Eliminate column
    for (let k = 0; k < n; k++) {
      if (k !== i) {
        const factor = augmented[k][i];
        for (let j = 0; j < 2 * n; j++) {
          augmented[k][j] -= factor * augmented[i][j];
        }
      }
    }
  }
  
  // Extract inverse
  return augmented.map(row => row.slice(n));
}
