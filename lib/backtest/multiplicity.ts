import { Multiplicity } from './types';

/**
 * Multiple Testing Correction using Benjamini-Hochberg FDR Control
 * 
 * Implements the step-up procedure for controlling False Discovery Rate
 * at level q across multiple hypothesis tests.
 */

interface TestResult {
  id: string;
  p_raw: number;
}

/**
 * Apply Benjamini-Hochberg FDR correction
 */
export function benjaminiHochbergFDR(
  tests: TestResult[],
  fdr_q: number = 0.10
): Multiplicity {
  
  if (tests.length === 0) {
    return { fdr_q, adjusted: [] };
  }
  
  console.log(`Applying BH-FDR correction: ${tests.length} tests, q=${fdr_q}`);
  
  // Sort by raw p-values (ascending)
  const sortedTests = tests
    .map((test, originalIndex) => ({ ...test, originalIndex }))
    .sort((a, b) => a.p_raw - b.p_raw);
  
  const m = tests.length; // Total number of tests
  const adjusted: Array<{ id: string; p_raw: number; q_value: number }> = [];
  
  // Compute q-values using step-up procedure
  for (let i = 0; i < sortedTests.length; i++) {
    const test = sortedTests[i];
    const rank = i + 1; // 1-based rank
    
    // BH q-value: min over all j>=i of (m * p(j)) / j
    let q_value = 1.0;
    
    for (let j = i; j < sortedTests.length; j++) {
      const p_j = sortedTests[j].p_raw;
      const rank_j = j + 1;
      const candidate_q = Math.min(1.0, (m * p_j) / rank_j);
      q_value = Math.min(q_value, candidate_q);
    }
    
    adjusted.push({
      id: test.id,
      p_raw: test.p_raw,
      q_value
    });
  }
  
  // Sort back to original order
  adjusted.sort((a, b) => {
    const aIndex = tests.findIndex(t => t.id === a.id);
    const bIndex = tests.findIndex(t => t.id === b.id);
    return aIndex - bIndex;
  });
  
  return { fdr_q, adjusted };
}

/**
 * Create test results from engine comparisons
 */
export function createEngineComparisonTests(
  engineNames: string[],
  pValues: number[]
): TestResult[] {
  
  if (engineNames.length !== pValues.length) {
    throw new Error('Engine names and p-values arrays must have same length');
  }
  
  return engineNames.map((name, i) => ({
    id: name,
    p_raw: pValues[i]
  }));
}

/**
 * Create test results from multiple comparisons
 */
export function createPairwiseComparisonTests(
  comparisons: Array<{ engineA: string; engineB: string; p_value: number }>
): TestResult[] {
  
  return comparisons.map(comp => ({
    id: `${comp.engineA}_vs_${comp.engineB}`,
    p_raw: comp.p_value
  }));
}

/**
 * Family-wise error rate correction (Bonferroni)
 */
export function bonferroniCorrection(
  tests: TestResult[]
): Array<{ id: string; p_raw: number; p_bonferroni: number }> {
  
  const m = tests.length;
  
  return tests.map(test => ({
    id: test.id,
    p_raw: test.p_raw,
    p_bonferroni: Math.min(1.0, test.p_raw * m)
  }));
}

/**
 * Holm-Bonferroni step-down correction
 */
export function holmBonferroniCorrection(
  tests: TestResult[]
): Array<{ id: string; p_raw: number; p_holm: number }> {
  
  if (tests.length === 0) return [];
  
  // Sort by raw p-values (ascending)
  const sortedTests = tests
    .map((test, originalIndex) => ({ ...test, originalIndex }))
    .sort((a, b) => a.p_raw - b.p_raw);
  
  const m = tests.length;
  const corrected: Array<{ id: string; p_raw: number; p_holm: number }> = [];
  
  // Apply step-down procedure
  for (let i = 0; i < sortedTests.length; i++) {
    const test = sortedTests[i];
    const steps_remaining = m - i;
    
    // Holm correction: p_adj = max(p_raw * steps_remaining, previous_p_adj)
    const p_holm_candidate = test.p_raw * steps_remaining;
    const p_holm = i === 0 
      ? Math.min(1.0, p_holm_candidate)
      : Math.min(1.0, Math.max(p_holm_candidate, corrected[i - 1].p_holm));
    
    corrected.push({
      id: test.id,
      p_raw: test.p_raw,
      p_holm
    });
  }
  
  // Sort back to original order
  corrected.sort((a, b) => {
    const aIndex = tests.findIndex(t => t.id === a.id);
    const bIndex = tests.findIndex(t => t.id === b.id);
    return aIndex - bIndex;
  });
  
  return corrected;
}

/**
 * Comprehensive multiplicity analysis
 */
export function comprehensiveMultiplicityAnalysis(
  tests: TestResult[],
  fdr_q: number = 0.10
): {
  fdr: Multiplicity;
  bonferroni: Array<{ id: string; p_raw: number; p_bonferroni: number }>;
  holm: Array<{ id: string; p_raw: number; p_holm: number }>;
  summary: {
    total_tests: number;
    significant_raw: number;
    significant_fdr: number;
    significant_bonferroni: number;
    significant_holm: number;
  };
} {
  
  console.log(`Comprehensive multiplicity analysis: ${tests.length} tests`);
  
  const fdr = benjaminiHochbergFDR(tests, fdr_q);
  const bonferroni = bonferroniCorrection(tests);
  const holm = holmBonferroniCorrection(tests);
  
  // Count significant results
  const alpha = 0.05;
  const significant_raw = tests.filter(t => t.p_raw < alpha).length;
  const significant_fdr = fdr.adjusted.filter(t => t.q_value < fdr_q).length;
  const significant_bonferroni = bonferroni.filter(t => t.p_bonferroni < alpha).length;
  const significant_holm = holm.filter(t => t.p_holm < alpha).length;
  
  return {
    fdr,
    bonferroni,
    holm,
    summary: {
      total_tests: tests.length,
      significant_raw,
      significant_fdr,
      significant_bonferroni,
      significant_holm
    }
  };
}

/**
 * Filter significant results after FDR correction
 */
export function getSignificantResults(
  multiplicity: Multiplicity,
  threshold?: number
): Array<{ id: string; p_raw: number; q_value: number }> {
  
  const fdr_threshold = threshold || multiplicity.fdr_q;
  
  return multiplicity.adjusted.filter(result => result.q_value < fdr_threshold);
}

/**
 * Validate multiplicity inputs
 */
export function validateMultiplicityInputs(
  tests: TestResult[],
  fdr_q: number
): void {
  
  if (fdr_q <= 0 || fdr_q >= 1) {
    throw new Error('FDR level q must be between 0 and 1');
  }
  
  for (const test of tests) {
    if (test.p_raw < 0 || test.p_raw > 1) {
      throw new Error(`Invalid p-value for test ${test.id}: ${test.p_raw}`);
    }
  }
  
  const uniqueIds = new Set(tests.map(t => t.id));
  if (uniqueIds.size !== tests.length) {
    throw new Error('Test IDs must be unique');
  }
}

/**
 * Estimate power for multiple testing
 */
export function estimateMultipleTestingPower(
  tests: TestResult[],
  effect_sizes: number[],
  alpha: number = 0.05
): {
  uncorrected_power: number;
  bonferroni_power: number;
  estimated_fdr: number;
} {
  
  if (tests.length !== effect_sizes.length) {
    throw new Error('Tests and effect sizes must have same length');
  }
  
  const m = tests.length;
  
  // Simplified power calculation (assumes normal distribution)
  const uncorrected_power = effect_sizes
    .map(effect => 1 - standardNormalCDF(1.96 - effect))
    .reduce((sum, power) => sum + power, 0) / m;
  
  const bonferroni_alpha = alpha / m;
  const bonferroni_critical = standardNormalCDF(1 - bonferroni_alpha / 2);
  const bonferroni_power = effect_sizes
    .map(effect => 1 - standardNormalCDF(bonferroni_critical - effect))
    .reduce((sum, power) => sum + power, 0) / m;
  
  // Rough FDR estimate
  const significant_tests = tests.filter(t => t.p_raw < alpha).length;
  const estimated_fdr = significant_tests > 0 ? 
    (alpha * m) / significant_tests : 0;
  
  return {
    uncorrected_power,
    bonferroni_power,
    estimated_fdr: Math.min(1, estimated_fdr)
  };
}

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