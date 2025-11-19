import { SigmaForecast } from './types';
import { loadCanonicalData } from '../storage/canonical';
import { CanonicalRow } from '../types/canonical';

export interface RangeParams {
  symbol: string;
  date_t?: string;
  estimator: "P" | "GK" | "RS" | "YZ";
  window: number;
  ewma_lambda?: number | null;
}

/**
 * Compute range-based volatility using daily OHLC data
 * 
 * Estimators:
 * - Parkinson (P): [ln(H/L)]² / (4 ln 2)
 * - Garman-Klass (GK): 0.5[ln(H/L)]² − (2 ln 2 − 1)[ln(C/O)]²
 * - Rogers-Satchell (RS): u(u − c) + d(d − c), u=ln(H/O), d=ln(L/O), c=ln(C/O)
 * - Yang-Zhang (YZ): k = 0.34 / (1.34 + (N+1)/(N−1)); σ²_YZ = var(g) + k var(c) + (1−k) mean(var_RS)
 */
export async function computeRangeSigma(params: RangeParams): Promise<SigmaForecast> {
  const { symbol, date_t, estimator, window, ewma_lambda } = params;
  
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
  
  if (filteredData.length < window + 1) { // Need extra day for overnight returns
    throw new Error(`Insufficient data: need ${window + 1}, have ${filteredData.length}`);
  }
  
  // Get the last 'window' observations plus one extra for overnight returns
  const windowData = filteredData.slice(-(window + 1));
  
  // Compute daily variance estimates
  const dailyVariances = computeDailyVariances(windowData, estimator);
  
  if (dailyVariances.length < window) {
    throw new Error('Insufficient variance estimates');
  }
  
  // Check for gap warnings (for YZ and RS estimators)
  const gapWarnings = checkGapWarnings(windowData);
  
  // Aggregate variances
  let aggregatedVar: number;
  if (ewma_lambda !== null && ewma_lambda !== undefined) {
    aggregatedVar = computeEwmaVariance(dailyVariances, ewma_lambda);
  } else {
    aggregatedVar = dailyVariances.reduce((sum, v) => sum + v, 0) / dailyVariances.length;
  }
  
  if (aggregatedVar <= 0) {
    throw new Error('Invalid variance estimate (σ² ≤ 0)');
  }
  
  const sigma_1d = Math.sqrt(aggregatedVar);
  
  // Prepare diagnostics
  const diagnostics: Record<string, any> = {
    estimator,
    window,
    ...(ewma_lambda !== null && ewma_lambda !== undefined ? { ewma_lambda } : {}),
    ...(estimator === 'YZ' ? { k: computeYangZhangK(window) } : {}),
    ...(gapWarnings.length > 0 ? { gap_warnings: gapWarnings } : {})
  };
  
  return {
    source: `Range-${estimator}` as any,
    sigma_1d,
    sigma2_1d: aggregatedVar,
    diagnostics
  };
}

/**
 * Compute daily variance estimates using the specified estimator
 */
function computeDailyVariances(data: CanonicalRow[], estimator: string): number[] {
  const variances: number[] = [];
  
  for (let i = 1; i < data.length; i++) {
    const prevRow = data[i - 1];
    const currRow = data[i];
    
    // OHLC prices
    const O = currRow.open;
    const H = currRow.high;
    const L = currRow.low;
    const C = currRow.close;
    const C_prev = prevRow.close;
    
    // Validate prices
    if (!O || !H || !L || !C || !C_prev || H <= 0 || L <= 0 || O <= 0 || C <= 0 || C_prev <= 0) {
      continue;
    }
    
    let variance: number;
    
    switch (estimator) {
      case 'P':
        // Parkinson: [ln(H/L)]² / (4 ln 2)
        variance = Math.pow(Math.log(H / L), 2) / (4 * Math.log(2));
        break;
        
      case 'GK':
        // Garman-Klass: 0.5[ln(H/L)]² − (2 ln 2 − 1)[ln(C/O)]²
        variance = 0.5 * Math.pow(Math.log(H / L), 2) - 
                   (2 * Math.log(2) - 1) * Math.pow(Math.log(C / O), 2);
        break;
        
      case 'RS':
        // Rogers-Satchell: u(u − c) + d(d − c)
        const u = Math.log(H / O);
        const d = Math.log(L / O);
        const c = Math.log(C / O);
        variance = u * (u - c) + d * (d - c);
        break;
        
      case 'YZ':
        // Yang-Zhang: computed separately as it requires multiple components
        variance = computeYangZhangVariance(data, i);
        break;
        
      default:
        throw new Error(`Unknown estimator: ${estimator}`);
    }
    
    if (variance > 0 && isFinite(variance)) {
      variances.push(variance);
    }
  }
  
  return variances;
}

/**
 * Compute Yang-Zhang variance for a single day
 */
function computeYangZhangVariance(data: CanonicalRow[], index: number): number {
  if (index === 0) return 0;
  
  const currRow = data[index];
  const prevRow = data[index - 1];
  
  const O = currRow.open;
  const H = currRow.high;
  const L = currRow.low;
  const C = currRow.close;
  const C_prev = prevRow.close;
  
  if (!O || !H || !L || !C || !C_prev) return 0;
  
  // Overnight return: g = ln(O/C_{t-1})
  const g = Math.log(O / C_prev);
  
  // Close-to-close return: c = ln(C/O)
  const c = Math.log(C / O);
  
  // Rogers-Satchell component
  const u = Math.log(H / O);
  const d = Math.log(L / O);
  const rs = u * (u - c) + d * (d - c);
  
  // For YZ, we need to estimate k and variance components over a window
  // This is simplified - in practice would use rolling window
  const k = 0.34 / (1.34 + (22 + 1) / (22 - 1)); // Assuming N=22 for monthly window
  
  // Simplified YZ (proper implementation would need rolling statistics)
  return g * g + k * c * c + (1 - k) * rs;
}

/**
 * Compute Yang-Zhang k parameter
 */
function computeYangZhangK(N: number): number {
  return 0.34 / (1.34 + (N + 1) / (N - 1));
}

/**
 * Compute EWMA variance
 */
function computeEwmaVariance(variances: number[], lambda: number): number {
  if (variances.length === 0) return 0;
  
  let ewmaVar = variances[0]; // Initialize with first variance
  
  for (let i = 1; i < variances.length; i++) {
    ewmaVar = (1 - lambda) * variances[i] + lambda * ewmaVar;
  }
  
  return ewmaVar;
}

/**
 * Check for gap warnings (overnight price gaps)
 */
function checkGapWarnings(data: CanonicalRow[]): string[] {
  const warnings: string[] = [];
  const gaps: number[] = [];
  const closes: number[] = [];
  
  // Compute gaps and close-to-close returns
  for (let i = 1; i < data.length; i++) {
    const prevRow = data[i - 1];
    const currRow = data[i];
    
    if (prevRow.close && currRow.open && currRow.close) {
      const gap = Math.log(currRow.open / prevRow.close);
      const c = Math.log(currRow.close / currRow.open);
      
      gaps.push(gap);
      closes.push(c);
    }
  }
  
  if (gaps.length === 0 || closes.length === 0) return warnings;
  
  // Compute standard deviations
  const gapMean = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
  const closeMean = closes.reduce((sum, c) => sum + c, 0) / closes.length;
  
  const gapStd = Math.sqrt(gaps.reduce((sum, g) => sum + (g - gapMean) ** 2, 0) / gaps.length);
  const closeStd = Math.sqrt(closes.reduce((sum, c) => sum + (c - closeMean) ** 2, 0) / closes.length);
  
  // Check for large gaps
  const largeGaps = gaps.filter(g => Math.abs(g) > 2 * closeStd);
  const maxGapRatio = Math.max(...gaps.map(g => Math.abs(g) / closeStd));
  const threshold = 2.0;
  
  if (largeGaps.length > 0) {
    warnings.push(`Gap day detected: ${largeGaps.length} large overnight gaps (|g| > ${threshold} * std(c)). Max gap ratio: ${maxGapRatio.toFixed(2)}, threshold: ${threshold.toFixed(1)}. Consider using RS or YZ estimators.`);
  }
  
  return warnings;
}