/**
 * VaR Backtesting Framework
 * Implements comprehensive Value-at-Risk validation with Basel-style diagnostics
 */

import fs from 'fs';
import path from 'path';
import { ForecastRecord } from '@/lib/forecast/types';
import { CanonicalRow } from '@/lib/types/canonical';
import { loadCanonicalData } from '@/lib/storage/canonical';

// ─────────────────────────────────────────────────────────────
// Core Types
// ─────────────────────────────────────────────────────────────

export interface VarBacktestPoint {
  symbol: string;
  date_t: string;              // origin date (forecast date)
  verifyDate: string;          // date VaR applies to
  model: "GBM" | "GARCH11-N" | "GARCH11-t" | "Range-P" | "Range-GK" | "Range-RS" | "Range-YZ";
  horizonTrading: number;      // 1,2,3,5 trading days
  coverage: number;            // e.g. 0.95
  alpha: number;               // 1 - coverage (e.g. 0.05)
  VaR_lower: number;           // lower band / VaR estimate at alpha
  VaR_upper?: number;          // upper band (for info)
  S_t: number;                 // price at t
  S_obs: number;               // realized price at verifyDate
  ret_obs: number;             // realized return from t to verifyDate (log)
  breach: 0 | 1;               // 1 if loss > VaR (ret_obs < log(VaR_lower/S_t))
}

export interface VarCoverageSummary {
  n: number;                   // number of observations
  alpha: number;               // nominal coverage (e.g. 0.05)
  empiricalRate: number;       // actual breach rate
  coverageError: number;       // empiricalRate - alpha
}

export interface KupiecResult {
  POF: number;                 // Proportion-of-failures test statistic
  pValue: number;              // p-value under chi-square(1)
  n: number;                   // sample size
  I: number;                   // number of breaches
  alpha: number;               // nominal coverage
  alpha_hat: number;           // empirical coverage
}

export interface ChristoffersenSummary {
  N00: number;                 // no breach -> no breach transitions
  N01: number;                 // no breach -> breach transitions
  N10: number;                 // breach -> no breach transitions  
  N11: number;                 // breach -> breach transitions
  alpha_hat: number;           // empirical breach rate
  LR_ind: number;              // independence test statistic
  pValue_ind: number;          // independence test p-value
  LR_cc: number;               // conditional coverage test statistic
  pValue_cc: number;           // conditional coverage test p-value
}

export type TrafficLightZone = "green" | "yellow" | "red";

export interface VarDiagnostics {
  coverage: VarCoverageSummary;
  kupiec: KupiecResult;
  christoffersen: ChristoffersenSummary;
  trafficLight: TrafficLightZone;
}

// ─────────────────────────────────────────────────────────────
// Core Data Assembly
// ─────────────────────────────────────────────────────────────

/**
 * Build VaR backtest dataset from forecast + realized data
 */
export async function buildVarBacktestSeries(opts: {
  symbol: string;
  model: "GBM" | "GARCH11-N" | "GARCH11-t" | "Range-P" | "Range-GK" | "Range-RS" | "Range-YZ";
  horizonTrading: number;
  coverage: number;
  startDate?: string;
  endDate?: string;
}): Promise<VarBacktestPoint[]> {
  const { symbol, model, horizonTrading, coverage, startDate, endDate } = opts;
  const alpha = 1 - coverage;

  // Load canonical data for price realizations
  const canonicalData = await loadCanonicalData(symbol);
  const priceMap = new Map<string, number>();
  canonicalData.forEach(row => {
    if (row.adj_close !== null) {
      priceMap.set(row.date, row.adj_close);
    }
  });

  // Load forecast files
  const forecastsDir = path.join(process.cwd(), 'data', 'forecasts', symbol);
  if (!fs.existsSync(forecastsDir)) {
    return [];
  }

  const files = fs.readdirSync(forecastsDir)
    .filter(f => f.endsWith('.json'))
    .sort();

  const points: VarBacktestPoint[] = [];

  for (const file of files) {
    try {
      const filePath = path.join(forecastsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const forecast: ForecastRecord = JSON.parse(content);

      // Filter by model type
      if (!isMatchingModel(forecast, model)) continue;

      // Filter by horizon
      if (forecast.horizonTrading !== horizonTrading) continue;

      // Filter by coverage (with tolerance)
      if (forecast.target?.coverage && Math.abs(forecast.target.coverage - coverage) > 0.001) continue;

      // Filter by date range
      if (startDate && forecast.date_t < startDate) continue;
      if (endDate && forecast.date_t > endDate) continue;

      // Must be locked and have intervals
      if (!forecast.locked || !forecast.intervals) continue;

      // Must have verifyDate for VaR evaluation
      if (!forecast.verifyDate) continue;

      // Get current price and realized price
      const S_t = forecast.S_t || forecast.estimates?.S_t;
      const S_obs = priceMap.get(forecast.verifyDate);

      if (!S_t || !S_obs) continue;

      // Compute realized log return
      const ret_obs = Math.log(S_obs / S_t);

      // Define VaR breach: ret_obs < log(VaR_lower / S_t)
      const VaR_lower = forecast.intervals.L_h;
      const VaR_upper = forecast.intervals.U_h;
      const threshold = Math.log(VaR_lower / S_t);
      const breach = ret_obs < threshold ? 1 : 0;

      points.push({
        symbol,
        date_t: forecast.date_t,
        verifyDate: forecast.verifyDate,
        model,
        horizonTrading,
        coverage,
        alpha,
        VaR_lower,
        VaR_upper,
        S_t,
        S_obs,
        ret_obs,
        breach
      });

    } catch (error) {
      console.warn(`Failed to process forecast file ${file}:`, error);
      continue;
    }
  }

  return points.sort((a, b) => a.date_t.localeCompare(b.date_t));
}

/**
 * Check if forecast matches the requested model
 */
function isMatchingModel(forecast: ForecastRecord, model: "GBM" | "GARCH11-N" | "GARCH11-t" | "Range-P" | "Range-GK" | "Range-RS" | "Range-YZ"): boolean {
  const method = forecast.method;

  switch (model) {
    case "GBM":
      return method === "GBM" || method === "GBM-CC";
    case "GARCH11-N":
      return method === "GARCH11-N";
    case "GARCH11-t":
      return method === "GARCH11-t";
    case "Range-P":
      return method === "Range-P";
    case "Range-GK":
      return method === "Range-GK";
    case "Range-RS":
      return method === "Range-RS";
    case "Range-YZ":
      return method === "Range-YZ";
    default:
      return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Basic Coverage Metrics
// ─────────────────────────────────────────────────────────────

/**
 * Calculate empirical breach rate
 */
export function empiricalBreachRate(series: VarBacktestPoint[]): number {
  if (series.length === 0) return 0;
  const breaches = series.filter(p => p.breach === 1).length;
  return breaches / series.length;
}

/**
 * Calculate coverage error (empirical - nominal)
 */
export function coverageError(series: VarBacktestPoint[]): number {
  if (series.length === 0) return 0;
  const empirical = empiricalBreachRate(series);
  const alpha = series[0]?.alpha || 0.05;
  return empirical - alpha;
}

/**
 * Summarize VaR coverage statistics
 */
export function summarizeVarCoverage(series: VarBacktestPoint[]): VarCoverageSummary {
  const n = series.length;
  const alpha = series[0]?.alpha || 0.05;
  const empiricalRate = empiricalBreachRate(series);
  const coverageError = empiricalRate - alpha;

  return {
    n,
    alpha,
    empiricalRate,
    coverageError
  };
}

// ─────────────────────────────────────────────────────────────
// Kupiec Proportion-of-Failures Test
// ─────────────────────────────────────────────────────────────

/**
 * Chi-square cumulative distribution function approximation
 * For df=1 case (Kupiec test)
 */
function chiSquareCDF(x: number, df: number): number {
  if (x <= 0) return 0;
  if (df === 1) {
    // For df=1, use normal approximation: P(χ²₁ ≤ x) = 2*Φ(√x) - 1
    const z = Math.sqrt(x);
    return 2 * normalCDF(z) - 1;
  }
  // For other df, use simple approximation (could be improved)
  return 1 - Math.exp(-x / 2);
}

/**
 * Normal cumulative distribution function
 */
function normalCDF(z: number): number {
  return 0.5 * (1 + erf(z / Math.sqrt(2)));
}

/**
 * Error function approximation
 */
function erf(x: number): number {
  // Abramowitz and Stegun approximation
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
 * Kupiec proportion-of-failures test
 */
export function summarizeKupiec(series: VarBacktestPoint[]): KupiecResult {
  const n = series.length;
  if (n === 0) {
    return { POF: 0, pValue: 1, n: 0, I: 0, alpha: 0.05, alpha_hat: 0 };
  }

  const alpha = series[0].alpha;
  const I = series.filter(p => p.breach === 1).length;
  const alpha_hat = I / n;

  if (I === 0 || I === n) {
    // Degenerate cases - test statistic undefined
    return { POF: Infinity, pValue: 0, n, I, alpha, alpha_hat };
  }

  // Likelihood ratio test statistic (using log-likelihood to avoid underflow)
  // POF = -2 * [log L₀ - log L₁]
  // log L₀ = (n-I)*log(1-α) + I*log(α) 
  // log L₁ = (n-I)*log(1-α̂) + I*log(α̂)
  
  const logL0 = (n - I) * Math.log(1 - alpha) + I * Math.log(alpha);
  const logL1 = (n - I) * Math.log(1 - alpha_hat) + I * Math.log(alpha_hat);
  const POF = -2 * (logL0 - logL1);

  // Under H₀: α̂ = α, POF ~ χ²(1)
  const pValue = 1 - chiSquareCDF(POF, 1);

  return {
    POF,
    pValue,
    n,
    I,
    alpha,
    alpha_hat
  };
}

// ─────────────────────────────────────────────────────────────
// Christoffersen Independence Tests
// ─────────────────────────────────────────────────────────────

/**
 * Christoffersen independence and conditional coverage tests
 */
export function summarizeChristoffersen(series: VarBacktestPoint[]): ChristoffersenSummary {
  if (series.length < 2) {
    return {
      N00: 0, N01: 0, N10: 0, N11: 0,
      alpha_hat: 0,
      LR_ind: 0, pValue_ind: 1,
      LR_cc: 0, pValue_cc: 1
    };
  }

  // Build 2x2 transition matrix
  let N00 = 0, N01 = 0, N10 = 0, N11 = 0;
  
  for (let i = 1; i < series.length; i++) {
    const prev = series[i-1].breach;
    const curr = series[i].breach;
    
    if (prev === 0 && curr === 0) N00++;
    else if (prev === 0 && curr === 1) N01++;
    else if (prev === 1 && curr === 0) N10++;
    else if (prev === 1 && curr === 1) N11++;
  }

  const total = N00 + N01 + N10 + N11;
  if (total === 0) {
    return {
      N00, N01, N10, N11,
      alpha_hat: 0,
      LR_ind: 0, pValue_ind: 1,
      LR_cc: 0, pValue_cc: 1
    };
  }

  // Estimate transition probabilities
  const p = (N01 + N11) / total;  // Overall breach rate
  const p_0 = N01 / Math.max(N00 + N01, 1);  // Breach rate after no breach
  const p_1 = N11 / Math.max(N10 + N11, 1);  // Breach rate after breach

  // Independence test likelihood ratio
  // H₀: p₀ = p₁ = p (independence)
  // H₁: p₀ ≠ p₁ (dependence)
  
  const logL0_ind = (N01 + N11) * Math.log(Math.max(p, 1e-10)) + 
                    (N00 + N10) * Math.log(Math.max(1 - p, 1e-10));
                    
  const logL1_ind = N00 * Math.log(Math.max(1 - p_0, 1e-10)) +
                    N01 * Math.log(Math.max(p_0, 1e-10)) +
                    N10 * Math.log(Math.max(1 - p_1, 1e-10)) +
                    N11 * Math.log(Math.max(p_1, 1e-10));

  const LR_ind = -2 * (logL0_ind - logL1_ind);
  const pValue_ind = 1 - chiSquareCDF(LR_ind, 1);

  // Conditional coverage test (combines POF + independence)
  const kupiec = summarizeKupiec(series);
  const LR_cc = kupiec.POF + LR_ind;
  const pValue_cc = 1 - chiSquareCDF(LR_cc, 2);

  return {
    N00, N01, N10, N11,
    alpha_hat: p,
    LR_ind,
    pValue_ind,
    LR_cc,
    pValue_cc
  };
}

// ─────────────────────────────────────────────────────────────
// Basel Traffic Light Classification  
// ─────────────────────────────────────────────────────────────

/**
 * Basel-style traffic light classification
 * Based on binomial probability under H₀
 */
export function classifyTrafficLight(n: number, I: number, alpha: number): TrafficLightZone {
  if (n === 0) return "green";

  // Calculate cumulative probability P(X ≥ I) under Binomial(n, α)
  const prob = binomialTailProbability(n, I, alpha);

  // Basel-style thresholds (adapted)
  if (prob >= 0.10) return "green";     // High probability - within expected range
  if (prob >= 0.01) return "yellow";    // Low probability - borderline
  return "red";                         // Very low probability - significant deviation
}

/**
 * Binomial tail probability P(X ≥ k) for X ~ Binomial(n, p)
 */
function binomialTailProbability(n: number, k: number, p: number): number {
  if (k > n) return 0;
  if (k <= 0) return 1;

  let prob = 0;
  for (let i = k; i <= n; i++) {
    prob += binomialPMF(n, i, p);
  }
  return prob;
}

/**
 * Binomial probability mass function
 */
function binomialPMF(n: number, k: number, p: number): number {
  if (k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;

  return binomialCoeff(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k);
}

/**
 * Binomial coefficient C(n, k) = n! / (k! * (n-k)!)
 */
function binomialCoeff(n: number, k: number): number {
  if (k > n - k) k = n - k; // Take advantage of symmetry
  
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = result * (n - i) / (i + 1);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// Integrated Diagnostics
// ─────────────────────────────────────────────────────────────

/**
 * Compute comprehensive VaR diagnostics for multiple models
 */
export async function computeVarDiagnostics(opts: {
  symbol: string;
  models: ("GBM" | "GARCH11-N" | "GARCH11-t" | "Range-P" | "Range-GK" | "Range-RS" | "Range-YZ")[];
  horizonTrading: number;
  coverage: number;
  startDate?: string;
  endDate?: string;
}): Promise<{ [model: string]: VarDiagnostics }> {
  
  const results: { [model: string]: VarDiagnostics } = {};

  for (const model of opts.models) {
    try {
      // Build VaR backtest series for this model
      const series = await buildVarBacktestSeries({
        symbol: opts.symbol,
        model,
        horizonTrading: opts.horizonTrading,
        coverage: opts.coverage,
        startDate: opts.startDate,
        endDate: opts.endDate
      });

      if (series.length === 0) {
        // No data available for this model
        results[model] = {
          coverage: { n: 0, alpha: 1 - opts.coverage, empiricalRate: 0, coverageError: 0 },
          kupiec: { POF: 0, pValue: 1, n: 0, I: 0, alpha: 1 - opts.coverage, alpha_hat: 0 },
          christoffersen: {
            N00: 0, N01: 0, N10: 0, N11: 0,
            alpha_hat: 0,
            LR_ind: 0, pValue_ind: 1,
            LR_cc: 0, pValue_cc: 1
          },
          trafficLight: "green"
        };
        continue;
      }

      // Compute all diagnostics
      const coverage = summarizeVarCoverage(series);
      const kupiec = summarizeKupiec(series);
      const christoffersen = summarizeChristoffersen(series);
      const trafficLight = classifyTrafficLight(series.length, kupiec.I, kupiec.alpha);

      results[model] = {
        coverage,
        kupiec,
        christoffersen,
        trafficLight
      };

    } catch (error) {
      console.error(`Error computing VaR diagnostics for ${model}:`, error);
      
      // Return empty result on error
      results[model] = {
        coverage: { n: 0, alpha: 1 - opts.coverage, empiricalRate: 0, coverageError: 0 },
        kupiec: { POF: 0, pValue: 1, n: 0, I: 0, alpha: 1 - opts.coverage, alpha_hat: 0 },
        christoffersen: {
          N00: 0, N01: 0, N10: 0, N11: 0,
          alpha_hat: 0,
          LR_ind: 0, pValue_ind: 1,
          LR_cc: 0, pValue_cc: 1
        },
        trafficLight: "green"
      };
    }
  }

  return results;
}