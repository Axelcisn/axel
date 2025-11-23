/**
 * GBM Baseline PI Engine - Pure functions for geometric Brownian motion
 * prediction interval computation with MLE estimation and drift shrinkage.
 */

export type GbmInputs = {
  dates: string[];                 // ascending trading dates
  adjClose: number[];              // same length as dates, > 0
  windowN: 252 | 504 | 756;
  lambdaDrift: number;             // 0..1
  coverage: number;                // e.g., 0.95
};

export type GbmEstimates = {
  mu_star_hat: number;             // mean log-return
  sigma_hat: number;               // MLE sd, denom N
  mu_star_used: number;            // lambda * mu_star_hat
  z_alpha: number;                 // Φ^{-1}(1 − α/2)
};

export type GbmPI = {
  L1: number;                      // exp( ln(S_t) + mu* − z*sigma )
  U1: number;                      // exp( ln(S_t) + mu* + z*sigma )
  band_width_bp: number;           // 10000 * (U1/L1 − 1)
};

/**
 * Validate price series for GBM computation
 * @throws Error if any price is non-positive
 */
export function validateSeriesForGBM(adjClose: number[]): void {
  for (let i = 0; i < adjClose.length; i++) {
    if (adjClose[i] <= 0) {
      throw new Error("Non-positive price in series");
    }
  }
}

/**
 * Compute GBM parameter estimates using MLE with drift shrinkage
 */
export function computeGbmEstimates(input: GbmInputs): GbmEstimates {
  const { dates, adjClose, windowN, lambdaDrift, coverage } = input;
  
  // Validate inputs
  if (dates.length !== adjClose.length) {
    throw new Error("Dates and prices must have same length");
  }
  if (adjClose.length < windowN + 1) {
    throw new Error(`Insufficient data: need ${windowN + 1} observations for ${windowN} returns`);
  }
  
  validateSeriesForGBM(adjClose);
  
  // Take trailing window + 1 for windowN returns
  const windowPrices = adjClose.slice(-windowN - 1);
  
  // Compute log returns: r_t = ln(AdjClose_t / AdjClose_{t-1})
  const returns: number[] = [];
  for (let i = 1; i < windowPrices.length; i++) {
    returns.push(Math.log(windowPrices[i] / windowPrices[i - 1]));
  }
  
  // MLE estimates
  // mu_star_hat = mean(r)
  const N = returns.length;
  const mu_star_hat = returns.reduce((sum, r) => sum + r, 0) / N;
  
  // sigma_hat = sqrt((1/N) * Σ (r_i − mu_star_hat)^2) - denominator N, no Bessel correction
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mu_star_hat, 2), 0) / N;
  const sigma_hat = Math.sqrt(variance);
  
  // Drift shrinkage
  const mu_star_used = lambdaDrift * mu_star_hat;
  
  // Critical value: z_alpha = Φ^{-1}(1 − α/2)
  const alpha = 1 - coverage;
  const z_alpha = normalInverse(1 - alpha / 2);
  
  return {
    mu_star_hat,
    sigma_hat,
    mu_star_used,
    z_alpha
  };
}

/**
 * Compute GBM prediction intervals with proper horizon scaling
 */
export function computeGbmInterval(params: {
  S_t: number;              // adj close at origin date
  muStarUsed: number;       // μ*_used (per trading day)
  sigmaHat: number;         // σ_hat (per trading day)
  h_eff: number;            // effective horizon in "time units" for GBM
  coverage: number;         // e.g. 0.95
}): { L_h: number; U_h: number; m_t: number; s_t: number; z_alpha: number } {
  const { S_t, muStarUsed, sigmaHat, h_eff, coverage } = params;
  
  // Log-price mean and std for horizon h_eff
  const m_t = Math.log(S_t) + muStarUsed * h_eff;
  const s_t = sigmaHat * Math.sqrt(h_eff);
  
  const alpha = 1 - coverage;
  const z_alpha = normalInverse(1 - alpha / 2);
  
  const L_h = Math.exp(m_t - z_alpha * s_t);
  const U_h = Math.exp(m_t + z_alpha * s_t);
  
  return {
    L_h,
    U_h,
    m_t,
    s_t,
    z_alpha
  };
}

/**
 * Compute prediction intervals from GBM estimates (legacy wrapper)
 */
export function computeGbmPI(S_t: number, est: GbmEstimates): GbmPI {
  const { mu_star_used, sigma_hat, z_alpha } = est;
  
  // Use h_eff = 1 for backward compatibility
  const result = computeGbmInterval({
    S_t,
    muStarUsed: mu_star_used,
    sigmaHat: sigma_hat,
    h_eff: 1,
    coverage: 0.95 // Default coverage for legacy calls
  });
  
  // Band width in basis points
  const band_width_bp = Math.round(10000 * (result.U_h / result.L_h - 1));
  
  return {
    L1: result.L_h,
    U1: result.U_h,
    band_width_bp
  };
}

/**
 * Compute expected price from GBM estimates
 * For GBM with log-price dynamics, E[S_{t+h} | S_t] = S_t * exp(mu_eff * h)
 */
export function computeGbmExpectedPrice(S_t: number, est: GbmEstimates, h: number = 1): number {
  const { mu_star_used } = est;
  // For GBM, the conditional expectation is S_t * exp(drift * horizon)
  return S_t * Math.exp(mu_star_used * h);
}

/**
 * Inverse normal CDF approximation (Beasley-Springer-Moro algorithm)
 */
function normalInverse(p: number): number {
  if (p <= 0 || p >= 1) {
    throw new Error("Probability must be between 0 and 1");
  }
  
  // Constants for Beasley-Springer-Moro approximation
  const a = [
    0,
    -3.969683028665376e+01,
    2.209460984245205e+02,
    -2.759285104469687e+02,
    1.383577518672690e+02,
    -3.066479806614716e+01,
    2.506628277459239e+00
  ];
  
  const b = [
    0,
    -5.447609879822406e+01,
    1.615858368580409e+02,
    -1.556989798598866e+02,
    6.680131188771972e+01,
    -1.328068155288572e+01
  ];
  
  const c = [
    0,
    -7.784894002430293e-03,
    -3.223964580411365e-01,
    -2.400758277161838e+00,
    -2.549732539343734e+00,
    4.374664141464968e+00,
    2.938163982698783e+00
  ];
  
  const d = [
    0,
    7.784695709041462e-03,
    3.224671290700398e-01,
    2.445134137142996e+00,
    3.754408661907416e+00
  ];
  
  // Split into regions
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  
  let q: number;
  let r: number;
  
  if (p < pLow) {
    // Rational approximation for lower region
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[1] * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) * q + c[6]) /
           ((((d[1] * q + d[2]) * q + d[3]) * q + d[4]) * q + 1);
  } else if (p <= pHigh) {
    // Rational approximation for central region
    q = p - 0.5;
    r = q * q;
    return (((((a[1] * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * r + a[6]) * q /
           (((((b[1] * r + b[2]) * r + b[3]) * r + b[4]) * r + b[5]) * r + 1);
  } else {
    // Rational approximation for upper region
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[1] * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) * q + c[6]) /
            ((((d[1] * q + d[2]) * q + d[3]) * q + d[4]) * q + 1);
  }
}