import { ConformalParams, ConformalState, ConformalMode, ConformalDomain } from './types';
import { loadCanonicalData } from '../storage/canonical';
import { getTargetSpec } from '../storage/targetSpecStore';
import { ForecastRecord } from '../forecast/types';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Debug flag for verbose logging - can be enabled via environment variable
 */
const CONFORMAL_DEBUG = process.env.CONFORMAL_DEBUG === '1';

/**
 * Calibrate conformal prediction parameters using historical base forecasts
 * 
 * Formulas:
 * ICP: s_i = |y_i - ŷ_i|; q_cal = Q_{1-α}({s_i})
 * ICP-scaled: s_i = |y_i - ŷ_i| / σ_pred_i; q_cal_s = Q_{1-α}({s_i})
 * CQR: e_i^L = L_i^0 - y_i; e_i^U = y_i - U_i^0; Δ_L = Q_{1-α}({e_i^L}); Δ_U = Q_{1-α}({e_i^U})
 * EnbPI: OOB residuals → q_cal
 * ACI: θ_{t+1} = θ_t + η(miss_t - α)
 */
export async function calibrate(
  symbol: string, 
  params: ConformalParams,
  base_method?: string,
  coverageOverride?: number,
  horizonOverride?: number
): Promise<ConformalState> {
  const { mode, domain, cal_window, eta, K } = params;
  
  // Load target specification
  const targetSpec = await getTargetSpec(symbol);
  if (!targetSpec) {
    throw new Error('Target specification not found');
  }
  
  // Use override values if provided, otherwise use target spec
  const effectiveCoverage = coverageOverride || targetSpec.coverage;
  const effectiveHorizon = horizonOverride || targetSpec.h;
  const alpha = 1 - effectiveCoverage;
  
  // Load canonical data for realized values
  const canonicalData = await loadCanonicalData(symbol);
  if (!canonicalData || canonicalData.length === 0) {
    throw new Error(
      `No canonical data found for symbol ${symbol}. ` +
      `Conformal prediction requires historical price data to compute residuals. ` +
      `Please ensure canonical data exists in /data/canonical/${symbol}.json.`
    );
  }
  
  // Load historical base forecasts
  const baseForecastPairs = await loadBaseForecastPairs(symbol, cal_window, domain, base_method, effectiveHorizon, effectiveCoverage);
  
  if (baseForecastPairs.length < cal_window) {
    const shortage = cal_window - baseForecastPairs.length;
    const suggestions = [];
    
    if (baseForecastPairs.length > 0) {
      suggestions.push(`reduce calibration window to ${baseForecastPairs.length}`);
    }
    suggestions.push(`generate ${shortage} more base forecasts for the current configuration`);
    
    const baseMethodInfo = base_method ? ` (method: ${base_method})` : '';
    const domainInfo = domain ? ` in ${domain} domain` : '';
    const configInfo = (effectiveHorizon || effectiveCoverage) 
      ? ` with h=${effectiveHorizon}, coverage=${effectiveCoverage}` 
      : '';
    
    throw new Error(
      `Insufficient base forecasts${baseMethodInfo}${domainInfo}${configInfo}: ` +
      `need ${cal_window}, have ${baseForecastPairs.length}. ` +
      `Consider: ${suggestions.join(' or ')}.`
    );
  }
  
  // Initialize state
  const state: ConformalState = {
    symbol,
    mode,
    domain,
    cal_window,
    params: {
      eta: eta || null,
      K: K || null
    },
    coverage: {
      last60: null,
      lastCal: null,
      miss_count: 0
    },
    updated_at: new Date().toISOString()
  };
  
  // Compute calibration parameters based on mode
  switch (mode) {
    case 'ICP':
      state.params.q_cal = calibrateICP(baseForecastPairs, alpha);
      break;
      
    case 'ICP-SCALED':
      state.params.q_cal_scaled = calibrateICPScaled(baseForecastPairs, alpha);
      break;
      
    case 'CQR':
      const cqrResult = calibrateCQR(baseForecastPairs, alpha);
      state.params.delta_L = cqrResult.delta_L;
      state.params.delta_U = cqrResult.delta_U;
      break;
      
    case 'EnbPI':
      if (!K || K < 5) {
        throw new Error(
          `EnbPI requires K >= 5, but got K=${K}. ` +
          `K controls the ensemble size for bootstrap prediction intervals. ` +
          `Use a larger K value or switch to ICP/CQR methods.`
        );
      }
      state.params.q_cal = calibrateEnbPI(baseForecastPairs, alpha, K);
      break;
      
    case 'ACI':
      if (!eta || eta <= 0) {
        throw new Error(
          `ACI requires positive eta, but got eta=${eta}. ` +
          `Eta controls the adaptation rate for Adaptive Conformal Inference. ` +
          `Use a positive value (typically 0.01-0.1) or switch to non-adaptive methods.`
        );
      }
      state.params.theta = calibrateACI(baseForecastPairs, alpha, eta);
      break;
      
    default:
      throw new Error(`Unknown conformal mode: ${mode}`);
  }
  
  // Compute coverage statistics
  state.coverage = computeCoverageStats(baseForecastPairs);
  
  return state;
}

/**
 * Apply conformal prediction to today's base forecast
 */
export async function applyConformalToday(
  symbol: string, 
  params: ConformalParams,
  base_method?: string,
  coverageOverride?: number,
  horizonOverride?: number
): Promise<{
  state: ConformalState;
  L: number;
  U: number;
  m_log: number;
  s_scale: number;
  critical: { type: "normal" | "t"; value: number; df?: number };
}> {
  // Get calibrated state
  const state = await calibrate(symbol, params, base_method, coverageOverride, horizonOverride);
  
  // Load latest base forecast
  const latestForecast = await loadLatestBaseForecast(symbol, base_method);
  if (!latestForecast) {
    const methodInfo = base_method ? ` for method ${base_method}` : '';
    throw new Error(
      `No base forecast found for today${methodInfo} (symbol: ${symbol}). ` +
      `To apply conformal prediction, generate a base forecast first using the volatility modeling tools.`
    );
  }
  
  // Extract base prediction values
  const m_log = latestForecast.m_log || latestForecast.diagnostics?.m_log || 0;
  const s_scale = latestForecast.s_scale || latestForecast.diagnostics?.s_scale || 0;
  const base_L = latestForecast.L_h || latestForecast.intervals?.L_h || 0;
  const base_U = latestForecast.U_h || latestForecast.intervals?.U_h || 0;
  const critical = latestForecast.critical || { type: "normal" as const, value: 1.96 };
  
  // Ensure critical has required value property
  const safeCritical = {
    type: critical.type,
    value: critical.value || critical.z_alpha || 1.96,
    ...(critical.df ? { df: critical.df } : {})
  };
  
  // Convert to target domain
  let y_pred: number, L_base: number, U_base: number;
  if (params.domain === 'log') {
    y_pred = m_log;
    L_base = Math.log(base_L);
    U_base = Math.log(base_U);
  } else {
    y_pred = Math.exp(m_log);
    L_base = base_L;
    U_base = base_U;
  }
  
  // Apply conformal adjustment
  let L: number, U: number;
  
  switch (params.mode) {
    case 'ICP':
      const q_cal = state.params.q_cal!;
      L = y_pred - q_cal;
      U = y_pred + q_cal;
      break;
      
    case 'ICP-SCALED':
      const q_cal_scaled = state.params.q_cal_scaled!;
      const sigma_pred = params.domain === 'log' ? s_scale : s_scale * Math.exp(m_log);
      const half_width = q_cal_scaled * sigma_pred;
      L = y_pred - half_width;
      U = y_pred + half_width;
      break;
      
    case 'CQR':
      const delta_L = state.params.delta_L!;
      const delta_U = state.params.delta_U!;
      L = L_base - delta_L;
      U = U_base + delta_U;
      break;
      
    case 'EnbPI':
      const q_cal_enbpi = state.params.q_cal!;
      L = y_pred - q_cal_enbpi;
      U = y_pred + q_cal_enbpi;
      break;
      
    case 'ACI':
      const theta = state.params.theta!;
      // For ACI, use theta as an offset to the base intervals
      const base_half_width = (U_base - L_base) / 2;
      const center = (L_base + U_base) / 2;
      const adjusted_half_width = base_half_width + theta;
      L = center - adjusted_half_width;
      U = center + adjusted_half_width;
      break;
      
    default:
      throw new Error(`Unknown conformal mode: ${params.mode}`);
  }
  
  // Convert back to price domain if needed for final output
  if (params.domain === 'log') {
    L = Math.exp(L);
    U = Math.exp(U);
  }
  
  return {
    state,
    L,
    U,
    m_log,
    s_scale,
    critical: safeCritical
  };
}

// Helper interfaces
interface ForecastPair {
  forecast: ForecastRecord;
  realizedDate: string;  // Date when y_i was realized (t+1)
  realized: number;  // y_i in chosen domain
  y_pred: number;    // ŷ_i in chosen domain
  sigma_pred?: number; // σ_pred_i for ICP-scaled
  L_base: number;    // L_i^0 for CQR
  U_base: number;    // U_i^0 for CQR
}

/**
 * Unified base forecast selector function 
 * Centralizes all filtering logic to ensure consistency between head counts and calibration
 */
export function isMatchingBaseForecast(
  forecast: ForecastRecord,
  opts: {
    symbol?: string;
    baseMethod?: string;
    domain?: 'log' | 'price';
    horizon?: number;
    coverage?: number;
  }
): boolean {
  const { symbol, baseMethod, domain, horizon, coverage } = opts;

  // Core filters that must always apply
  if (!forecast.locked) return false;
  if (forecast.method.startsWith('Conformal:')) return false;
  
  // Symbol filter
  if (symbol && forecast.symbol !== symbol) return false;
  
  // Base method filter (exact match)
  if (baseMethod) {
    const m = forecast.method;
    const b = baseMethod;

    // Treat legacy "GBM" and new "GBM-CC" as equivalent
    const isGbmAlias =
      (b === 'GBM-CC' && m === 'GBM') ||
      (b === 'GBM' && m === 'GBM-CC');

    if (m !== b && !isGbmAlias) {
      return false;
    }
  }
  
  // Domain filter - check if forecast was generated for specific domain
  if (domain && forecast.domain) {
    if (forecast.domain !== domain) return false;
  }
  
  // Horizon filter - check if forecast was generated for specific horizon
  if (horizon !== undefined) {
    // For GBM forecasts, use horizonTrading when it's a valid number
    if (typeof forecast.horizonTrading === "number") {
      if (forecast.horizonTrading !== horizon) return false;
    }
    // Otherwise fall back to target.h (for older forecasts or non-GBM)
    else if (forecast.target?.h !== undefined) {
      if (forecast.target.h !== horizon) return false;
    }
  }
  
  // Coverage filter - check if forecast was generated for specific coverage  
  if (coverage !== undefined && forecast.target?.coverage !== undefined) {
    if (Math.abs(forecast.target.coverage - coverage) > 0.001) return false;
  }
  
  return true;
}

/**
 * Load historical base forecasts paired with realized values
 */
export async function loadBaseForecastPairs(
  symbol: string, 
  cal_window: number, 
  domain: ConformalDomain,
  base_method?: string,
  horizon?: number,
  coverage?: number
): Promise<ForecastPair[]> {
  const forecastsDir = path.join(process.cwd(), 'data', 'forecasts', symbol);
  
  // Check if directory exists using async stat
  try {
    await fs.stat(forecastsDir);
  } catch {
    return []; // Directory doesn't exist
  }
  
  // Load canonical data
  const canonicalData = await loadCanonicalData(symbol);
  const priceMap = new Map<string, number>();
  canonicalData.forEach(row => {
    if (row.adj_close) {
      priceMap.set(row.date, row.adj_close);
    }
  });
  
  // Load all forecast files asynchronously
  const allFiles = await fs.readdir(forecastsDir);
  const files = allFiles
    .filter((f: string) => f.endsWith('.json') && f.includes('-'))
    .sort();
  
  const pairs: ForecastPair[] = [];
  
  for (const file of files) {
    try {
      const content = await fs.readFile(path.join(forecastsDir, file), 'utf-8');
      const forecast: ForecastRecord = JSON.parse(content);
      
      // Use unified selector for all filtering
      const isMatching = isMatchingBaseForecast(forecast, { 
        symbol, 
        baseMethod: base_method, 
        domain,
        horizon,
        coverage
      });
      
      if (CONFORMAL_DEBUG && isMatching) {
        console.log('[DEBUG] matching base forecast', forecast.date_t, forecast.method, forecast.target);
      }
      
      if (!isMatching) continue;
      
      // Get forecast date and determine horizon for verify date calculation
      const forecastDate = forecast.date_t;
      
      // Determine effective horizon for this forecast (fallback to 1)
      const effectiveHorizon =
        typeof forecast.horizonTrading === "number"
          ? forecast.horizonTrading
          : typeof forecast.target?.h === "number"
          ? forecast.target.h
          : 1;
      
      const verifyDate = getTradingDayOffset(
        forecastDate,
        canonicalData,
        effectiveHorizon
      );
      
      if (!verifyDate) {
        if (CONFORMAL_DEBUG) {
          console.log(
            '[DEBUG] no trading day', effectiveHorizon, 'days after',
            forecast.date_t,
            'method=', forecast.method
          );
        }
        continue;
      }
      
      const S_t = priceMap.get(forecastDate);
      const S_t_plus_h = priceMap.get(verifyDate);
      
      if (!S_t || !S_t_plus_h) {
        if (CONFORMAL_DEBUG) {
          console.log('[DEBUG] no canonical outcome for forecast', forecast.date_t, 'verifyDate=', verifyDate, 'S_t=', S_t, 'S_t_plus_h=', S_t_plus_h);
        }
        continue;
      }
      
      // Compute realized value in chosen domain
      const realized = domain === 'log' ? Math.log(S_t_plus_h) : S_t_plus_h;
      
      // Extract prediction values
      const m_log = forecast.m_log || forecast.diagnostics?.m_log || 0;
      const s_scale = forecast.s_scale || forecast.diagnostics?.s_scale || 0;
      const base_L = forecast.L_h || forecast.intervals?.L_h || 0;
      const base_U = forecast.U_h || forecast.intervals?.U_h || 0;
      
      // Get L and U for prediction calculation
      const L = forecast.L_h ?? forecast.intervals?.L_h;
      const U = forecast.U_h ?? forecast.intervals?.U_h;
      
      // Compute y_predPrice: prefer y_hat, but fall back for robust calibration
      let y_predPrice = forecast.y_hat ?? 
                       (L && U ? Math.sqrt(L * U) : S_t);
      
      const prediction_source = forecast.y_hat != null ? 'y_hat' : 
                               (L && U ? 'geometric_mean' : 'S_t_fallback');
      
      // Debug logging for calibration robustness (only when debug enabled)
      if (CONFORMAL_DEBUG) {
        console.log(`[CALIBRATION] ${forecastDate}: y_pred=${y_predPrice.toFixed(2)}, realized=${S_t_plus_h.toFixed(2)}, diff=${(y_predPrice - S_t_plus_h).toFixed(2)}, source=${prediction_source}`);
      }
      
      // Convert to target domain  
      const y_pred = domain === 'log' ? Math.log(y_predPrice) : y_predPrice;
      const L_base = domain === 'log' ? Math.log(base_L) : base_L;
      const U_base = domain === 'log' ? Math.log(base_U) : base_U;
      const sigma_pred = domain === 'log' ? s_scale : s_scale * Math.exp(m_log);
      
      pairs.push({
        forecast,
        realizedDate: verifyDate,
        realized,
        y_pred,
        sigma_pred,
        L_base,
        U_base
      });
      
    } catch (error) {
      // Skip invalid files
      continue;
    }
  }
  
  // Return last cal_window pairs
  return pairs.slice(-cal_window);
}

/**
 * Get next trading day from canonical data
 */
function getNextTradingDay(date: string, canonicalData: any[]): string | null {
  const currentIndex = canonicalData.findIndex(row => row.date === date);
  if (currentIndex === -1 || currentIndex === canonicalData.length - 1) {
    return null;
  }
  return canonicalData[currentIndex + 1].date;
}

/**
 * Get trading day that is offset steps ahead from start date
 */
function getTradingDayOffset(
  startDate: string,
  canonicalData: any[],
  offset: number
): string | null {
  if (offset <= 0) return startDate;

  const startIndex = canonicalData.findIndex(row => row.date === startDate);
  if (startIndex === -1) return null;

  const targetIndex = startIndex + offset;
  if (targetIndex >= canonicalData.length) {
    return null; // no such future trading day in our data
  }

  return canonicalData[targetIndex].date;
}

/**
 * Load latest base forecast
 */
async function loadLatestBaseForecast(symbol: string, base_method?: string): Promise<ForecastRecord | null> {
  const forecastsDir = path.join(process.cwd(), 'data', 'forecasts', symbol);
  
  // Check if directory exists using async stat
  try {
    await fs.stat(forecastsDir);
  } catch {
    return null; // Directory doesn't exist
  }
  
  const allFiles = await fs.readdir(forecastsDir);
  const files = allFiles
    .filter((f: string) => f.endsWith('.json') && f.includes('-'))
    .sort()
    .reverse(); // Latest first
  
  for (const file of files) {
    try {
      const content = await fs.readFile(path.join(forecastsDir, file), 'utf-8');
      const forecast: ForecastRecord = JSON.parse(content);
      
      if (!forecast.locked) continue;
      if (forecast.method.startsWith('Conformal:')) continue;
      if (base_method && forecast.method !== base_method) continue;
      
      return forecast;
    } catch (error) {
      continue;
    }
  }
  
  return null;
}

/**
 * ICP calibration: q_cal = Q_{1-α}(|y_i - ŷ_i|)
 */
function calibrateICP(pairs: ForecastPair[], alpha: number): number {
  const scores = pairs.map(pair => Math.abs(pair.realized - pair.y_pred));
  return quantile(scores, 1 - alpha);
}

/**
 * ICP-scaled calibration: q_cal_s = Q_{1-α}(|y_i - ŷ_i| / σ_pred_i)
 */
function calibrateICPScaled(pairs: ForecastPair[], alpha: number): number {
  const scores = pairs.map(pair => {
    const residual = Math.abs(pair.realized - pair.y_pred);
    const sigma = pair.sigma_pred || 1;
    return residual / sigma;
  });
  return quantile(scores, 1 - alpha);
}

/**
 * CQR calibration: Δ_L = Q_{1-α}({e_i^L}); Δ_U = Q_{1-α}({e_i^U})
 */
function calibrateCQR(pairs: ForecastPair[], alpha: number): { delta_L: number; delta_U: number } {
  const errors_L = pairs.map(pair => pair.L_base - pair.realized);
  const errors_U = pairs.map(pair => pair.realized - pair.U_base);
  
  return {
    delta_L: quantile(errors_L, 1 - alpha),
    delta_U: quantile(errors_U, 1 - alpha)
  };
}

/**
 * EnbPI calibration: OOB residuals → q_cal
 */
function calibrateEnbPI(pairs: ForecastPair[], alpha: number, K: number): number {
  // Simplified EnbPI - in practice would use proper bagging
  // For now, use bootstrap aggregation of residuals
  const residuals: number[] = [];
  
  for (let k = 0; k < K; k++) {
    // Bootstrap sample
    const bootstrap_pairs = bootstrapSample(pairs);
    const oob_pairs = pairs.filter(p => !bootstrap_pairs.includes(p));
    
    // Compute OOB residuals
    oob_pairs.forEach(pair => {
      residuals.push(Math.abs(pair.realized - pair.y_pred));
    });
  }
  
  if (residuals.length === 0) {
    // Fallback to regular ICP
    return calibrateICP(pairs, alpha);
  }
  
  return quantile(residuals, 1 - alpha);
}

/**
 * ACI calibration: Initialize θ₀ and simulate updates
 */
function calibrateACI(pairs: ForecastPair[], alpha: number, eta: number): number {
  let theta = 0;
  
  // Simulate ACI updates over historical data
  for (const pair of pairs) {
    // Check if realized value was in the interval
    const miss = (pair.realized < pair.L_base || pair.realized > pair.U_base) ? 1 : 0;
    
    // Update theta: θ_{t+1} = θ_t + η(miss_t - α)
    theta = theta + eta * (miss - alpha);
  }
  
  return theta;
}

/**
 * Compute coverage statistics using conformal-adjusted intervals
 */
function computeCoverageStats(pairs: ForecastPair[]): { 
  last60: number | null; 
  lastCal: number | null; 
  miss_count: number;
  miss_details: Array<{
    date: string;
    realized_date: string;
    horizon: number;
    realized: number;
    y_pred: number;
    L_base: number;
    U_base: number;
    miss_type: 'below' | 'above';
    miss_magnitude: number;
  }>;
} {
  const total = pairs.length;
  const last60_pairs = pairs.slice(-Math.min(60, total));
  
  // TODO: For now using base intervals, but this should be enhanced to use 
  // conformal-adjusted intervals once we have the calibrated parameters
  // Count hits in base intervals (this will be updated in future to use conformal intervals)
  const hits_total = pairs.filter(pair => 
    pair.realized >= pair.L_base && pair.realized <= pair.U_base
  ).length;
  
  const hits_60 = last60_pairs.filter(pair => 
    pair.realized >= pair.L_base && pair.realized <= pair.U_base
  ).length;
  
  // Collect detailed miss information
  const miss_details = pairs
    .filter(pair => pair.realized < pair.L_base || pair.realized > pair.U_base)
    .map(pair => ({
      date: pair.forecast.date_t,  // ← Forecast date
      realized_date: pair.realizedDate,  // ← Outcome date (when realized value was observed)
      horizon: pair.forecast.horizonTrading ?? pair.forecast.target?.h ?? 1,  // ← Trading horizon
      realized: pair.realized,
      y_pred: pair.y_pred,
      L_base: pair.L_base,
      U_base: pair.U_base,
      miss_type: pair.realized < pair.L_base ? 'below' as const : 'above' as const,
      miss_magnitude: pair.realized < pair.L_base 
        ? Math.abs(pair.realized - pair.L_base)
        : Math.abs(pair.realized - pair.U_base)
    }));
  
  const miss_count = miss_details.length;
  
  return {
    last60: last60_pairs.length > 0 ? hits_60 / last60_pairs.length : null,
    lastCal: total > 0 ? hits_total / total : null,
    miss_count,
    miss_details
  };
}

/**
 * Compute quantile of array
 */
function quantile(arr: number[], q: number): number {
  if (arr.length === 0) return 0;
  
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  
  if (lower === upper) {
    return sorted[lower];
  }
  
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Bootstrap sample with replacement
 */
function bootstrapSample<T>(arr: T[]): T[] {
  const sample: T[] = [];
  for (let i = 0; i < arr.length; i++) {
    const randomIndex = Math.floor(Math.random() * arr.length);
    sample.push(arr[randomIndex]);
  }
  return sample;
}