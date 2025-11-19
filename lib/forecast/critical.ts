/**
 * Critical value functions for forecast intervals
 * Extracted from route handlers to avoid cross-importing issues
 */

/**
 * Get normal critical value for given coverage
 */
export function getNormalCritical(coverage: number): number {
  const alpha = 1 - coverage;
  
  // Inverse normal CDF approximation (Beasley-Springer-Moro)
  // For common coverage levels
  if (coverage === 0.95) return 1.96;
  if (coverage === 0.99) return 2.576;
  if (coverage === 0.90) return 1.645;
  
  // Approximation for other levels
  const p = 1 - alpha / 2;
  const t = Math.sqrt(-2 * Math.log(1 - p));
  const c0 = 2.515517;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;
  
  return t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
}

/**
 * Get Student-t critical value for given degrees of freedom and coverage
 */
export function getStudentTCritical(df: number, coverage: number): number {
  // Simplified approximation - in practice would use proper t-distribution
  const normalCrit = getNormalCritical(coverage);
  
  if (df <= 1) return Infinity;
  if (df >= 100) return normalCrit;
  
  // Rough approximation: t_critical ≈ normal_critical * sqrt(df/(df-2))
  return normalCrit * Math.sqrt(df / (df - 2));
}