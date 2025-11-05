import { SigmaForecast } from './types';
import { loadCanonicalData } from '../storage/canonical';
import { CanonicalRow } from '../types/canonical';

export interface GarchParams {
  symbol: string;
  date_t?: string;
  window: number;
  dist: "normal" | "student-t";
  variance_targeting: boolean;
  df?: number | null;
}

/**
 * Fit GARCH(1,1) and forecast one-step variance
 * 
 * Model: σ²_t = ω + α ε²_{t-1} + β σ²_{t-1}
 * One-step: σ²_{t+1|t} = ω + α ε²_t + β σ²_t
 * Multi-step: σ²_{t+h|t} = ω [1-(α+β)^h]/(1-α-β) + (α+β)^h σ²_t
 */
export async function fitAndForecastGarch(params: GarchParams): Promise<SigmaForecast> {
  const { symbol, date_t, window, dist, variance_targeting, df } = params;
  
  // Validate window
  if (window < 600) {
    throw new Error('GARCH requires window >= 600 (recommend 1000)');
  }
  
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
  
  // Get the last 'window' observations
  const windowData = filteredData.slice(-window);
  
  // Extract log returns (demeaned)
  const returns = windowData
    .map((row: CanonicalRow) => row.r)
    .filter((r: number | null | undefined): r is number => r !== null && r !== undefined);
  if (returns.length < window - 1) {
    throw new Error('Insufficient returns for GARCH estimation');
  }
  
  // Demean returns
  const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const residuals = returns.map(r => r - meanReturn);
  
  // Initial variance estimate
  const unconditionalVar = residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length;
  
  // GARCH parameter estimation using QMLE (simplified Nelder-Mead style optimization)
  const result = estimateGarch(residuals, unconditionalVar, variance_targeting);
  
  // Check stationarity
  if (result.alpha + result.beta >= 1) {
    throw new Error('GARCH model is non-stationary (α + β ≥ 1)');
  }
  
  if (result.alpha + result.beta >= 0.98) {
    console.warn('GARCH model is near-integrated (α + β ≥ 0.98)');
  }
  
  // One-step variance forecast
  const lastResidual = residuals[residuals.length - 1];
  const lastVariance = result.sigma2_series[result.sigma2_series.length - 1];
  const sigma2_forecast = result.omega + result.alpha * (lastResidual * lastResidual) + result.beta * lastVariance;
  
  if (sigma2_forecast <= 0) {
    throw new Error('Invalid variance forecast (σ² ≈ 0)');
  }
  
  const sigma_1d = Math.sqrt(sigma2_forecast);
  
  // Prepare diagnostics
  const diagnostics = {
    omega: result.omega,
    alpha: result.alpha,
    beta: result.beta,
    alpha_plus_beta: result.alpha + result.beta,
    unconditional_var: unconditionalVar,
    dist,
    ...(dist === 'student-t' && df ? { df } : {})
  };
  
  return {
    source: dist === 'normal' ? 'GARCH11-N' : 'GARCH11-t',
    sigma_1d,
    sigma2_1d: sigma2_forecast,
    diagnostics
  };
}

interface GarchResult {
  omega: number;
  alpha: number;
  beta: number;
  sigma2_series: number[];
  loglikelihood: number;
}

/**
 * Estimate GARCH(1,1) parameters using QMLE
 */
function estimateGarch(residuals: number[], unconditionalVar: number, varianceTargeting: boolean): GarchResult {
  const n = residuals.length;
  
  // Initial parameter guesses
  let omega = varianceTargeting ? 0 : unconditionalVar * 0.1;
  let alpha = 0.05;
  let beta = 0.9;
  
  // Simple grid search optimization (in practice, would use proper BFGS)
  let bestParams = { omega, alpha, beta };
  let bestLogLikelihood = -Infinity;
  
  // Grid search over reasonable parameter space
  const alphaRange = [0.01, 0.03, 0.05, 0.07, 0.1, 0.15];
  const betaRange = [0.85, 0.88, 0.9, 0.92, 0.95];
  
  for (const a of alphaRange) {
    for (const b of betaRange) {
      if (a + b >= 0.999) continue; // Ensure stationarity
      
      const w = varianceTargeting ? (1 - a - b) * unconditionalVar : unconditionalVar * 0.1;
      if (w <= 0) continue;
      
      const { sigma2_series, loglikelihood } = computeGarchLikelihood(residuals, w, a, b);
      
      if (loglikelihood > bestLogLikelihood) {
        bestLogLikelihood = loglikelihood;
        bestParams = { omega: w, alpha: a, beta: b };
      }
    }
  }
  
  // Compute final variance series with best parameters
  const { sigma2_series } = computeGarchLikelihood(residuals, bestParams.omega, bestParams.alpha, bestParams.beta);
  
  return {
    omega: bestParams.omega,
    alpha: bestParams.alpha,
    beta: bestParams.beta,
    sigma2_series,
    loglikelihood: bestLogLikelihood
  };
}

/**
 * Compute GARCH variance series and log-likelihood
 */
function computeGarchLikelihood(residuals: number[], omega: number, alpha: number, beta: number): { sigma2_series: number[], loglikelihood: number } {
  const n = residuals.length;
  const sigma2_series: number[] = [];
  
  // Initialize with unconditional variance
  const unconditionalVar = residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length;
  sigma2_series[0] = unconditionalVar;
  
  let loglikelihood = 0;
  
  for (let t = 1; t < n; t++) {
    // σ²_t = ω + α ε²_{t-1} + β σ²_{t-1}
    const sigma2_t = omega + alpha * (residuals[t-1] * residuals[t-1]) + beta * sigma2_series[t-1];
    
    if (sigma2_t <= 0) {
      return { sigma2_series: [], loglikelihood: -Infinity };
    }
    
    sigma2_series[t] = sigma2_t;
    
    // Add to log-likelihood (assuming normal distribution)
    loglikelihood += -0.5 * (Math.log(2 * Math.PI) + Math.log(sigma2_t) + (residuals[t] * residuals[t]) / sigma2_t);
  }
  
  return { sigma2_series, loglikelihood };
}