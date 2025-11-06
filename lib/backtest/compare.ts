import { PICompare, PIMetrics } from './types';

/**
 * Diebold-Mariano Test with HAC (Newey-West) Variance Estimation
 * 
 * Compares two forecasting methods based on loss differential:
 * d_t = IS_A(t) − IS_B(t)
 * dm_stat = d̄ / sqrt(Var_HAC(d_t) / T)
 * dm_pvalue = 2 * (1 − Φ(|dm_stat|))
 */

/**
 * Compute Diebold-Mariano test statistic with HAC variance
 */
export function dmTestHAC(
  d: number[], 
  lags?: number
): { dm_stat: number; dm_pvalue: number; hac_lags: number } {
  
  const T = d.length;
  if (T < 10) {
    throw new Error('Insufficient observations for DM test (need at least 10)');
  }
  
  // Determine lag length if not provided
  const hacLags = lags || Math.floor(4 * Math.pow(T / 100, 2/9));
  const effectiveLags = Math.min(hacLags, Math.floor(T / 4)); // Cap at T/4
  
  // Sample mean of loss differential
  const d_bar = d.reduce((sum, val) => sum + val, 0) / T;
  
  // Compute HAC variance using Newey-West estimator
  const hacVariance = computeNeweyWestVariance(d, d_bar, effectiveLags);
  
  // DM test statistic
  const dm_stat = d_bar / Math.sqrt(hacVariance / T);
  
  // Two-sided p-value (asymptotically standard normal)
  const dm_pvalue = 2 * (1 - standardNormalCDF(Math.abs(dm_stat)));
  
  return {
    dm_stat,
    dm_pvalue,
    hac_lags: effectiveLags
  };
}

/**
 * Compute Newey-West HAC variance estimator
 */
function computeNeweyWestVariance(d: number[], d_bar: number, lags: number): number {
  const T = d.length;
  
  // Center the series
  const centered = d.map(val => val - d_bar);
  
  // Gamma_0 (variance)
  let gamma_0 = 0;
  for (let t = 0; t < T; t++) {
    gamma_0 += centered[t] * centered[t];
  }
  gamma_0 /= T;
  
  // Sum of weighted autocovariances
  let hac_variance = gamma_0;
  
  for (let j = 1; j <= lags; j++) {
    // Compute gamma_j (autocovariance at lag j)
    let gamma_j = 0;
    for (let t = j; t < T; t++) {
      gamma_j += centered[t] * centered[t - j];
    }
    gamma_j /= T;
    
    // Bartlett kernel weight
    const weight = 1 - (j / (lags + 1));
    
    // Add symmetric terms (gamma_j and gamma_{-j})
    hac_variance += 2 * weight * gamma_j;
  }
  
  return Math.max(hac_variance, 1e-10); // Ensure positive variance
}

/**
 * Standard normal cumulative distribution function
 */
function standardNormalCDF(x: number): number {
  // Approximation using error function
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

/**
 * Error function approximation (Abramowitz and Stegun)
 */
function erf(x: number): number {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  
  return sign * y;
}

/**
 * Align two series of PI metrics by date and compute loss differential
 */
function alignMetricsAndComputeDifferential(
  metricsA: PIMetrics[],
  metricsB: PIMetrics[]
): number[] {
  
  // Create maps for fast lookup
  const mapA = new Map<string, PIMetrics>();
  const mapB = new Map<string, PIMetrics>();
  
  for (const metric of metricsA) {
    mapA.set(metric.date, metric);
  }
  
  for (const metric of metricsB) {
    mapB.set(metric.date, metric);
  }
  
  // Find common dates
  const commonDates = Array.from(mapA.keys()).filter(date => mapB.has(date));
  commonDates.sort();
  
  // Compute loss differential series
  const differential: number[] = [];
  
  for (const date of commonDates) {
    const metricA = mapA.get(date)!;
    const metricB = mapB.get(date)!;
    
    // d_t = IS_A(t) - IS_B(t)
    const d_t = metricA.interval_score - metricB.interval_score;
    differential.push(d_t);
  }
  
  return differential;
}

/**
 * Perform DM test comparing two engines' PI performance
 */
export function compareEnginesDM(
  metricsA: PIMetrics[],
  metricsB: PIMetrics[],
  engineA: string,
  engineB: string,
  hacLags?: number
): PICompare {
  
  // Align metrics and compute differential
  const differential = alignMetricsAndComputeDifferential(metricsA, metricsB);
  
  if (differential.length < 10) {
    throw new Error(`Insufficient overlapping observations: ${differential.length} (need ≥10)`);
  }
  
  // Run DM test
  const dmResult = dmTestHAC(differential, hacLags);
  
  return {
    engineA,
    engineB,
    dm_stat: dmResult.dm_stat,
    dm_pvalue: dmResult.dm_pvalue,
    hac_lags: dmResult.hac_lags
  };
}

/**
 * Filter metrics by engine name
 */
export function filterMetricsByEngine(metrics: PIMetrics[], engine: string): PIMetrics[] {
  return metrics.filter(metric => metric.method === engine);
}

/**
 * Compute summary statistics for loss differential
 */
export function computeDifferentialStats(d: number[]): {
  mean: number;
  std: number;
  min: number;
  max: number;
  count: number;
  positive_count: number;
  negative_count: number;
} {
  if (d.length === 0) {
    return { mean: 0, std: 0, min: 0, max: 0, count: 0, positive_count: 0, negative_count: 0 };
  }
  
  const mean = d.reduce((sum, val) => sum + val, 0) / d.length;
  const variance = d.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (d.length - 1);
  const std = Math.sqrt(variance);
  
  const min = Math.min(...d);
  const max = Math.max(...d);
  
  const positive_count = d.filter(val => val > 0).length;
  const negative_count = d.filter(val => val < 0).length;
  
  return {
    mean,
    std,
    min,
    max,
    count: d.length,
    positive_count,
    negative_count
  };
}

/**
 * Perform multiple pairwise DM tests
 */
export function multipleEngineComparisons(
  metrics: PIMetrics[],
  engines: string[],
  hacLags?: number
): PICompare[] {
  
  const results: PICompare[] = [];
  
  for (let i = 0; i < engines.length; i++) {
    for (let j = i + 1; j < engines.length; j++) {
      const engineA = engines[i];
      const engineB = engines[j];
      
      const metricsA = filterMetricsByEngine(metrics, engineA);
      const metricsB = filterMetricsByEngine(metrics, engineB);
      
      try {
        const comparison = compareEnginesDM(metricsA, metricsB, engineA, engineB, hacLags);
        results.push(comparison);
      } catch (error) {
        console.warn(`Failed to compare ${engineA} vs ${engineB}:`, error);
      }
    }
  }
  
  return results;
}