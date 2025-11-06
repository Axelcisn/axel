import { BootstrapConfig } from './types';

/**
 * Stationary Bootstrap Implementation (Politis-Romano)
 * 
 * Generates bootstrap replicates of time series data while preserving
 * the dependence structure through random block lengths.
 * 
 * Expected block length ℓ determines the geometric distribution parameter:
 * p = 1/ℓ (probability of ending a block at each step)
 */

/**
 * Generate a single stationary bootstrap replicate
 */
function generateStationaryBootstrapSample(
  series: number[], 
  expectedBlock: number
): number[] {
  
  const n = series.length;
  if (n === 0) return [];
  
  const sample: number[] = [];
  const p = 1 / expectedBlock; // Block termination probability
  
  while (sample.length < n) {
    // Random starting point
    let startIndex = Math.floor(Math.random() * n);
    
    // Generate block with geometric length
    let blockLength = 0;
    do {
      // Add current element to sample
      if (sample.length < n) {
        sample.push(series[startIndex]);
        blockLength++;
      }
      
      // Move to next element (circular)
      startIndex = (startIndex + 1) % n;
      
      // Check if block should terminate
    } while (sample.length < n && Math.random() > p);
  }
  
  return sample.slice(0, n); // Ensure exact length
}

/**
 * Compute aggregate statistic from a series
 */
function computeAggregate(series: number[], agg: "mean" | "median" | "std"): number {
  if (series.length === 0) return 0;
  
  switch (agg) {
    case "mean":
      return series.reduce((sum, val) => sum + val, 0) / series.length;
    
    case "median":
      const sorted = series.slice().sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    
    case "std":
      const mean = series.reduce((sum, val) => sum + val, 0) / series.length;
      const variance = series.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (series.length - 1);
      return Math.sqrt(variance);
    
    default:
      throw new Error(`Unsupported aggregate: ${agg}`);
  }
}

/**
 * Compute percentile from array of values
 */
function computePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  
  const sorted = values.slice().sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  
  if (Number.isInteger(index)) {
    return sorted[index];
  } else {
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }
}

/**
 * Stationary bootstrap confidence interval
 */
export async function stationaryBootstrapCI(
  series: number[],
  agg: "mean" | "median" | "std",
  cfg: BootstrapConfig
): Promise<[number, number]> {
  
  if (series.length === 0) {
    return [0, 0];
  }
  
  console.log(`Running stationary bootstrap: ℓ=${cfg.expected_block}, B=${cfg.reps}`);
  
  const bootstrapStats: number[] = [];
  
  // Generate bootstrap replicates
  for (let b = 0; b < cfg.reps; b++) {
    const bootSample = generateStationaryBootstrapSample(series, cfg.expected_block);
    const bootStat = computeAggregate(bootSample, agg);
    bootstrapStats.push(bootStat);
    
    // Progress logging for large bootstrap runs
    if (cfg.reps >= 1000 && b % 100 === 0 && b > 0) {
      console.log(`Bootstrap progress: ${b}/${cfg.reps}`);
    }
  }
  
  // Compute percentile confidence interval (2.5%, 97.5% for 95% CI)
  const lower = computePercentile(bootstrapStats, 2.5);
  const upper = computePercentile(bootstrapStats, 97.5);
  
  return [lower, upper];
}

/**
 * Multiple confidence intervals for different aggregates
 */
export async function multipleBootstrapCIs(
  series: number[],
  aggregates: Array<"mean" | "median" | "std">,
  cfg: BootstrapConfig
): Promise<Record<string, [number, number]>> {
  
  const results: Record<string, [number, number]> = {};
  
  for (const agg of aggregates) {
    const ci = await stationaryBootstrapCI(series, agg, cfg);
    results[agg] = ci;
  }
  
  return results;
}

/**
 * Bootstrap confidence interval for coverage rate
 */
export async function bootstrapCoverageCI(
  coverageHits: number[], // Array of 0s and 1s
  cfg: BootstrapConfig
): Promise<[number, number]> {
  
  return stationaryBootstrapCI(coverageHits, "mean", cfg);
}

/**
 * Bootstrap confidence interval for interval score
 */
export async function bootstrapIntervalScoreCI(
  intervalScores: number[],
  cfg: BootstrapConfig
): Promise<[number, number]> {
  
  return stationaryBootstrapCI(intervalScores, "mean", cfg);
}

/**
 * Comprehensive bootstrap analysis
 */
export async function comprehensiveBootstrapAnalysis(
  coverageHits: number[],
  intervalScores: number[],
  cfg: BootstrapConfig
): Promise<{
  coverage_ci: [number, number];
  interval_score_ci: [number, number];
  coverage_stats: {
    original: number;
    bootstrap_mean: number;
    bootstrap_std: number;
  };
  interval_score_stats: {
    original: number;
    bootstrap_mean: number;
    bootstrap_std: number;
  };
}> {
  
  console.log(`Comprehensive bootstrap analysis: ℓ=${cfg.expected_block}, B=${cfg.reps}`);
  
  // Coverage analysis
  const coverage_ci = await bootstrapCoverageCI(coverageHits, cfg);
  
  // Interval score analysis
  const interval_score_ci = await bootstrapIntervalScoreCI(intervalScores, cfg);
  
  // Generate additional bootstrap statistics
  const coverageBootstrapStats: number[] = [];
  const intervalScoreBootstrapStats: number[] = [];
  
  for (let b = 0; b < Math.min(cfg.reps, 500); b++) { // Limit for stats computation
    const coverageSample = generateStationaryBootstrapSample(coverageHits, cfg.expected_block);
    const intervalScoreSample = generateStationaryBootstrapSample(intervalScores, cfg.expected_block);
    
    coverageBootstrapStats.push(computeAggregate(coverageSample, "mean"));
    intervalScoreBootstrapStats.push(computeAggregate(intervalScoreSample, "mean"));
  }
  
  return {
    coverage_ci,
    interval_score_ci,
    coverage_stats: {
      original: computeAggregate(coverageHits, "mean"),
      bootstrap_mean: computeAggregate(coverageBootstrapStats, "mean"),
      bootstrap_std: computeAggregate(coverageBootstrapStats, "std")
    },
    interval_score_stats: {
      original: computeAggregate(intervalScores, "mean"),
      bootstrap_mean: computeAggregate(intervalScoreBootstrapStats, "mean"),
      bootstrap_std: computeAggregate(intervalScoreBootstrapStats, "std")
    }
  };
}

/**
 * Validate bootstrap configuration
 */
export function validateBootstrapConfig(cfg: BootstrapConfig, seriesLength: number): void {
  if (cfg.expected_block < 1) {
    throw new Error('Expected block length must be >= 1');
  }
  
  if (cfg.expected_block > seriesLength) {
    console.warn(`Expected block length (${cfg.expected_block}) > series length (${seriesLength})`);
  }
  
  if (cfg.reps < 100) {
    console.warn(`Low bootstrap replications (${cfg.reps}), consider increasing for better accuracy`);
  }
  
  if (cfg.reps > 10000) {
    console.warn(`High bootstrap replications (${cfg.reps}), may be computationally expensive`);
  }
}

/**
 * Optimal block length selection (rule of thumb)
 */
export function selectOptimalBlockLength(seriesLength: number): number {
  // Rule of thumb: ℓ ≈ n^(1/3) for stationary bootstrap
  const optimal = Math.ceil(Math.pow(seriesLength, 1/3));
  
  // Bounds checking
  const minBlock = Math.max(1, Math.ceil(seriesLength / 100));
  const maxBlock = Math.min(50, Math.ceil(seriesLength / 4));
  
  return Math.max(minBlock, Math.min(optimal, maxBlock));
}