import { RegimeBreaks } from './types';

/**
 * Regime Detection using Bai-Perron Structural Break Tests
 * 
 * Simplified implementation for detecting structural breaks in time series.
 * In production, would use a proper Bai-Perron implementation with
 * sequential testing and optimal break selection.
 */

interface BreakCandidate {
  date: string;
  index: number;
  test_stat: number;
  p_value: number;
}

/**
 * Detect structural breaks in interval scores or coverage rates
 */
export function detectRegimeBreaks(
  dates: string[],
  values: number[],
  maxBreaks: number = 3
): RegimeBreaks {
  
  if (dates.length !== values.length) {
    throw new Error('Dates and values arrays must have same length');
  }
  
  if (dates.length < 30) {
    return { break_dates: [] }; // Insufficient data for break detection
  }
  
  console.log(`Detecting regime breaks in series of length ${dates.length}`);
  
  // Find break candidates using simplified change point detection
  const candidates = findBreakCandidates(dates, values, maxBreaks);
  
  // Select significant breaks (p < 0.05)
  const significantBreaks = candidates
    .filter(candidate => candidate.p_value < 0.05)
    .sort((a, b) => a.index - b.index)
    .slice(0, maxBreaks)
    .map(candidate => candidate.date);
  
  console.log(`Found ${significantBreaks.length} significant breaks:`, significantBreaks);
  
  return {
    break_dates: significantBreaks
  };
}

/**
 * Find potential break points using rolling window statistics
 */
function findBreakCandidates(
  dates: string[],
  values: number[],
  maxBreaks: number
): BreakCandidate[] {
  
  const n = values.length;
  const minSegmentSize = Math.max(10, Math.floor(n / 10)); // At least 10 obs per segment
  const candidates: BreakCandidate[] = [];
  
  // Search for breaks in the middle portion (trim 15% from each end)
  const startSearch = Math.floor(n * 0.15);
  const endSearch = Math.floor(n * 0.85);
  
  for (let i = startSearch; i < endSearch; i += 5) { // Check every 5th point for efficiency
    if (i < minSegmentSize || i > n - minSegmentSize) continue;
    
    // Split series at candidate break point
    const before = values.slice(0, i);
    const after = values.slice(i);
    
    // Compute test statistic (simplified F-test for mean difference)
    const testStat = computeMeanDifferenceTest(before, after);
    const pValue = approximatePValue(testStat, before.length, after.length);
    
    candidates.push({
      date: dates[i],
      index: i,
      test_stat: testStat,
      p_value: pValue
    });
  }
  
  // Sort by test statistic (strongest breaks first)
  return candidates.sort((a, b) => b.test_stat - a.test_stat);
}

/**
 * Compute test statistic for mean difference between two segments
 */
function computeMeanDifferenceTest(before: number[], after: number[]): number {
  if (before.length === 0 || after.length === 0) return 0;
  
  const mean1 = before.reduce((sum, val) => sum + val, 0) / before.length;
  const mean2 = after.reduce((sum, val) => sum + val, 0) / after.length;
  
  const var1 = before.reduce((sum, val) => sum + Math.pow(val - mean1, 2), 0) / (before.length - 1);
  const var2 = after.reduce((sum, val) => sum + Math.pow(val - mean2, 2), 0) / (after.length - 1);
  
  // Pooled variance
  const pooledVar = ((before.length - 1) * var1 + (after.length - 1) * var2) / 
                    (before.length + after.length - 2);
  
  if (pooledVar === 0) return 0;
  
  // Two-sample t-test statistic
  const standardError = Math.sqrt(pooledVar * (1 / before.length + 1 / after.length));
  return Math.abs(mean1 - mean2) / standardError;
}

/**
 * Approximate p-value for t-test (simplified)
 */
function approximatePValue(tStat: number, n1: number, n2: number): number {
  if (tStat === 0) return 1;
  
  const df = n1 + n2 - 2;
  
  // Rough approximation using normal distribution for large df
  if (df > 30) {
    return 2 * (1 - standardNormalCDF(Math.abs(tStat)));
  }
  
  // Very rough t-distribution approximation for small df
  const criticalValues = [1.96, 2.58, 3.29]; // 5%, 1%, 0.1% levels
  const pLevels = [0.05, 0.01, 0.001];
  
  for (let i = 0; i < criticalValues.length; i++) {
    if (Math.abs(tStat) < criticalValues[i]) {
      return i === 0 ? 0.1 : pLevels[i - 1];
    }
  }
  
  return 0.0005; // Very small p-value
}

/**
 * Standard normal CDF (reused from compare.ts)
 */
function standardNormalCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

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
 * Detect breaks in coverage rates over time
 */
export function detectCoverageBreaks(
  dates: string[],
  coverageHits: number[], // Array of 0s and 1s
  maxBreaks: number = 3
): RegimeBreaks {
  
  // Convert to rolling coverage rates for smoother break detection
  const windowSize = Math.min(30, Math.floor(coverageHits.length / 5));
  const rollingCoverage: number[] = [];
  const rollingDates: string[] = [];
  
  for (let i = windowSize - 1; i < coverageHits.length; i++) {
    const window = coverageHits.slice(i - windowSize + 1, i + 1);
    const coverage = window.reduce((sum, hit) => sum + hit, 0) / window.length;
    
    rollingCoverage.push(coverage);
    rollingDates.push(dates[i]);
  }
  
  return detectRegimeBreaks(rollingDates, rollingCoverage, maxBreaks);
}

/**
 * Detect breaks in interval scores over time
 */
export function detectIntervalScoreBreaks(
  dates: string[],
  intervalScores: number[],
  maxBreaks: number = 3
): RegimeBreaks {
  
  // Use log-transformed interval scores for better break detection
  const logScores = intervalScores.map(score => Math.log(Math.max(score, 0.01)));
  
  return detectRegimeBreaks(dates, logScores, maxBreaks);
}

/**
 * Comprehensive regime analysis
 */
export function comprehensiveRegimeAnalysis(
  dates: string[],
  coverageHits: number[],
  intervalScores: number[],
  maxBreaks: number = 3
): {
  coverage_breaks: RegimeBreaks;
  interval_score_breaks: RegimeBreaks;
  combined_breaks: RegimeBreaks;
} {
  
  console.log('Running comprehensive regime analysis');
  
  const coverage_breaks = detectCoverageBreaks(dates, coverageHits, maxBreaks);
  const interval_score_breaks = detectIntervalScoreBreaks(dates, intervalScores, maxBreaks);
  
  // Combine breaks from both series (union)
  const allBreaks = new Set([
    ...coverage_breaks.break_dates,
    ...interval_score_breaks.break_dates
  ]);
  
  const combined_breaks: RegimeBreaks = {
    break_dates: Array.from(allBreaks).sort().slice(0, maxBreaks)
  };
  
  return {
    coverage_breaks,
    interval_score_breaks,
    combined_breaks
  };
}