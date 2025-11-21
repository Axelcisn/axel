/**
 * GBM Baseline PI Engine - Pure functions for geometric Brownian motion
 * prediction interval computation with MLE estimation and drift shrinkage.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TargetSpec } from '../types/targetSpec';
import { CanonicalRow, CanonicalTableMeta } from '../types/canonical';
import { ForecastRecord, GbmEstimates } from '../forecast/types';
import { saveForecast } from '../forecast/store';

export type ComputeGbmForecastParams = {
  symbol: string;
  date_t?: string;
  window?: number;
  lambda_drift?: number;
};

export type GbmInputs = {
  dates: string[];                 // ascending trading dates
  adjClose: number[];              // same length as dates, > 0
  windowN: 252 | 504 | 756;
  lambdaDrift: number;             // 0..1
  coverage: number;                // e.g., 0.95
};

export type GbmEstimatesLocal = {
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
export function computeGbmEstimates(input: GbmInputs): GbmEstimatesLocal {
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
 * Compute prediction intervals from GBM estimates
 */
export function computeGbmPI(S_t: number, est: GbmEstimatesLocal): GbmPI {
  const { mu_star_used, sigma_hat, z_alpha } = est;
  
  // m_t = ln(S_t) + mu_star_used
  const m_t = Math.log(S_t) + mu_star_used;
  
  // s_t = sigma_hat
  const s_t = sigma_hat;
  
  // Prediction intervals
  // L1 = exp(m_t - z_alpha * s_t)
  // U1 = exp(m_t + z_alpha * s_t)
  const L1 = Math.exp(m_t - z_alpha * s_t);
  const U1 = Math.exp(m_t + z_alpha * s_t);
  
  // Band width in basis points
  const band_width_bp = Math.round(10000 * (U1 / L1 - 1));
  
  return {
    L1,
    U1,
    band_width_bp
  };
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

export async function computeGbmForecast({
  symbol,
  date_t,
  window = 504,
  lambda_drift = 0.25
}: ComputeGbmForecastParams): Promise<ForecastRecord> {
  
  // Read Target Spec
  const targetSpecPath = path.join(process.cwd(), 'data', 'specs', `${symbol}-target.json`);
  let targetSpec: TargetSpec;
  
  try {
    const targetSpecContent = await fs.promises.readFile(targetSpecPath, 'utf-8');
    targetSpec = JSON.parse(targetSpecContent);
  } catch (error) {
    throw new Error('Target Spec required (h, coverage)');
  }
  
  const { h, coverage } = targetSpec;
  
  // Read canonical data
  const canonicalPath = path.join(process.cwd(), 'data', 'canonical', `${symbol}.json`);
  let canonicalData: { rows: CanonicalRow[], meta: CanonicalTableMeta };
  
  try {
    const canonicalContent = await fs.promises.readFile(canonicalPath, 'utf-8');
    canonicalData = JSON.parse(canonicalContent);
  } catch (error) {
    throw new Error('Canonical dataset not found');
  }
  
  const { rows } = canonicalData;
  
  // Sort rows by date and filter valid rows
  const validRows = rows
    .filter(row => row.valid !== false && row.adj_close && row.adj_close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  
  if (validRows.length === 0) {
    throw new Error('No valid price data found');
  }
  
  // Determine date_t (latest canonical date if not provided)
  const effectiveDate = date_t || validRows[validRows.length - 1].date;
  
  // Find the index for date_t
  const dateIndex = validRows.findIndex(row => row.date === effectiveDate);
  if (dateIndex === -1) {
    throw new Error(`Date ${effectiveDate} not found in canonical data`);
  }
  
  // Get the current price S_t
  const S_t = validRows[dateIndex].adj_close!;
  if (S_t <= 0) {
    throw new Error('Non-positive price at date_t');
  }
  
  // Build r_window for last N valid days (up to and including date_t)
  const endIndex = dateIndex;
  const startIndex = Math.max(0, endIndex - window + 1);
  
  if (endIndex - startIndex + 1 < window) {
    throw new Error(`Insufficient history (N<window)`);
  }
  
  // Extract log returns for the window
  const windowRows = validRows.slice(startIndex, endIndex + 1);
  const logReturns: number[] = [];
  
  for (let i = 1; i < windowRows.length; i++) {
    const prev = windowRows[i - 1].adj_close!;
    const curr = windowRows[i].adj_close!;
    if (prev > 0 && curr > 0) {
      logReturns.push(Math.log(curr / prev));
    }
  }
  
  const N = logReturns.length;
  if (N < window - 1) {
    throw new Error(`Insufficient history (N<window)`);
  }
  
  // Compute MLE estimates with denominator N
  const mu_star_hat = logReturns.reduce((sum, r) => sum + r, 0) / N;
  
  const variance = logReturns.reduce((sum, r) => sum + Math.pow(r - mu_star_hat, 2), 0) / N;
  const sigma_hat = Math.sqrt(variance);
  
  if (sigma_hat < 1e-8) {
    throw new Error('Vol too small to form PI');
  }
  
  // Apply drift shrinkage
  const mu_star_used = lambda_drift * mu_star_hat;
  
  // PI components (log scale)
  const m_log = Math.log(S_t) + h * mu_star_used;  // m_t(h)
  const s_scale = sigma_hat * Math.sqrt(h);        // s_t(h)
  
  // Critical value
  const alpha = 1 - coverage;
  const z_alpha = normalInverse(1 - alpha / 2);
  
  // Prediction intervals
  const L_h = Math.exp(m_log - z_alpha * s_scale);
  const U_h = Math.exp(m_log + z_alpha * s_scale);
  
  // Band width in basis points (for h=1)
  const band_width_bp = h === 1 ? 10000 * (U_h / L_h - 1) : 10000 * (Math.exp(z_alpha * s_scale / Math.sqrt(h)) - Math.exp(-z_alpha * s_scale / Math.sqrt(h)));
  
  // Compute explicit predicted price (y_hat) using GBM expected value formula
  // For GBM with log-price dynamics, E[S_{t+h} | S_t] = S_t * exp(mu_eff * h)
  const y_hat = S_t * Math.exp(mu_star_used * h);

  // Build estimates
  const estimates: GbmEstimates = {
    mu_star_hat,
    sigma_hat,
    mu_star_used,
    window_start: windowRows[0].date,
    window_end: windowRows[windowRows.length - 1].date,
    n: N
  };
  
  // Build forecast record
  const forecastRecord: ForecastRecord = {
    symbol,
    date_t: effectiveDate,
    method: "GBM-CC",
    y_hat, // Add explicit predicted price
    params: {
      window,
      lambda_drift,
      coverage,
      h
    },
    estimates,
    target: {
      h,
      coverage
    },
    S_t, // Add current price for chart display
    critical: {
      type: "normal",
      z_alpha
    },
    m_log,
    s_scale,
    L_h,
    U_h,
    band_width_bp,
    provenance: {
      rng_seed: null, // GBM doesn't use randomness
      params_snapshot: {
        window,
        lambda_drift,
        coverage,
        h,
        method: "GBM-CC"
      },
      regime_tag: null, // TODO: Add regime detection from backtest
      conformal: null   // Not a conformal method
    },
    locked: true,
    created_at: new Date().toISOString()
  };
  
  // Persist and return
  await saveForecast(forecastRecord);
  return forecastRecord;
}