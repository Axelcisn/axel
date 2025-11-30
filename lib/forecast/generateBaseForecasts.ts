// lib/forecast/generateBaseForecasts.ts
import { loadCanonicalData } from '@/lib/storage/canonical';
import { ForecastRecord } from '@/lib/forecast/types';
import { getTargetSpec } from '@/lib/storage/targetSpecStore';
import fs from 'fs';
import path from 'path';

type BaseMethod =
  | 'GBM'
  | 'GARCH11-N'
  | 'GARCH11-t'
  | 'Range-P'
  | 'Range-GK'
  | 'Range-RS'
  | 'Range-YZ'
  | 'HAR'
  | string; // Allow any string for flexibility

interface GenerateOptions {
  symbol: string;
  baseMethod: BaseMethod;
  calWindow: number;
  domain: 'log' | 'price';
  horizon?: number;              // Optional horizon override
  coverage?: number;             // Optional coverage override
}

interface GenerateResult {
  created: number;
  alreadyExisting: number;
  errors: number;
  generatedFileIds: string[];   // Add tracking for auto-cleanup
}

/**
 * Generate base forecasts for a specific calibration window
 * This creates historical forecasts that can be used for conformal prediction calibration
 */
export async function generateBaseForecastsForWindow(opts: GenerateOptions): Promise<GenerateResult> {
  const { symbol, baseMethod, calWindow, domain, horizon, coverage } = opts;

  // 1) Load canonical OHLC data
  const canonical = await loadCanonicalData(symbol);
  if (!canonical || canonical.length === 0) {
    throw new Error('No canonical data found for symbol');
  }

  // 2) Get target specification for forecast parameters
  const targetSpec = await getTargetSpec(symbol);
  if (!targetSpec) {
    throw new Error('Target specification not found - please save target spec first');
  }

  // 3) Load existing forecasts to avoid duplicates
  const existingForecasts = await loadExistingForecasts(symbol);

  // 4) Determine which dates need base forecasts (now horizon-aware)
  const datesToGenerate = getRequiredForecastDates(
    canonical, 
    calWindow, 
    existingForecasts, 
    baseMethod,
    horizon,  // Pass horizon for horizon-aware duplicate detection
    coverage  // Pass coverage for coverage-aware duplicate detection
  );

  let created = 0;
  let alreadyExisting = existingForecasts.filter(f => 
    f.method === baseMethod && 
    f.locked && 
    !f.method.includes('Conformal')
  ).length;
  let errors = 0;
  const generatedFileIds: string[] = [];   // Track generated files for cleanup

  // 5) Generate forecasts for each required date
  for (const date_t of datesToGenerate) {
    try {
      const forecast = await generateSingleBaseForecast({
        symbol,
        date_t,
        baseMethod,
        domain,
        targetSpec,
        canonical,
        horizonOverride: horizon,       // Pass horizon override
        coverageOverride: coverage      // Pass coverage override
      });

      if (forecast) {
        const fileId = await saveForecast(symbol, forecast);
        generatedFileIds.push(fileId);
        created++;
      }
    } catch (err) {
      console.error(`Failed to generate forecast for ${symbol} on ${date_t}:`, err);
      errors++;
    }
  }

  return { created, alreadyExisting, errors, generatedFileIds };
}

/**
 * Load existing forecasts for a symbol
 */
async function loadExistingForecasts(symbol: string): Promise<ForecastRecord[]> {
  try {
    const forecastsDir = path.join(process.cwd(), 'data', 'forecasts', symbol);
    if (!fs.existsSync(forecastsDir)) {
      return [];
    }

    const files = fs.readdirSync(forecastsDir);
    const forecasts: ForecastRecord[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const filePath = path.join(forecastsDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const forecast = JSON.parse(content) as ForecastRecord;
          forecasts.push(forecast);
        } catch (err) {
          // Skip invalid files
          continue;
        }
      }
    }

    return forecasts;
  } catch (err) {
    return [];
  }
}

/**
 * Determine which dates need base forecasts generated
 */
function getRequiredForecastDates(
  canonical: any[],
  calWindow: number,
  existingForecasts: ForecastRecord[],
  baseMethod: string,
  horizon?: number,
  coverage?: number
): string[] {
  if (canonical.length < calWindow + 1) {
    throw new Error(`Insufficient canonical data: need ${calWindow + 1} days, have ${canonical.length}`);
  }

  // Get the last calWindow trading days (excluding the most recent day)
  const lastIdx = canonical.length - 1;
  const startIdx = Math.max(0, lastIdx - calWindow);
  const endIdx = lastIdx; // Don't include the very last day

  const requiredDates: string[] = [];
  
  for (let i = startIdx; i < endIdx; i++) {
    const date = canonical[i].date;
    
    // Check if we already have a locked base forecast for this date, method, and horizon
    const existing = existingForecasts.find(f => {
      if (f.date_t !== date) return false;
      if (f.method !== baseMethod) return false;
      if (!f.locked) return false;
      if (f.method.includes('Conformal')) return false;

      // Horizon-aware duplicate detection
      if (typeof horizon === "number") {
        const forecastH =
          typeof f.horizonTrading === "number"
            ? f.horizonTrading
            : typeof f.target?.h === "number"
            ? f.target.h
            : undefined;

        if (forecastH !== undefined && forecastH !== horizon) {
          return false; // This is a base forecast for a different horizon
        }
      }

      // Coverage-aware duplicate detection (optional)
      if (typeof coverage === "number" && typeof f.target?.coverage === "number") {
        const covDiff = Math.abs(f.target.coverage - coverage);
        if (covDiff > 1e-6) return false;
      }

      return true;
    });
    
    if (!existing) {
      requiredDates.push(date);
    }
  }

  return requiredDates;
}

/**
 * Generate a single base forecast for a specific date
 */
async function generateSingleBaseForecast(opts: {
  symbol: string;
  date_t: string;
  baseMethod: string;
  domain: 'log' | 'price';
  targetSpec: any;
  canonical: any[];
  horizonOverride?: number;     // Optional horizon override
  coverageOverride?: number;    // Optional coverage override
}): Promise<ForecastRecord | null> {
  const { symbol, date_t, baseMethod, domain, targetSpec, canonical, horizonOverride, coverageOverride } = opts;

  // Find the date in canonical data
  const dateIdx = canonical.findIndex(row => row.date === date_t);
  if (dateIdx === -1 || dateIdx >= canonical.length - 1) {
    throw new Error(`Date ${date_t} not found in canonical data or insufficient future data`);
  }

  // Get historical data up to date_t for model fitting
  const historicalData = canonical.slice(0, dateIdx + 1);
  
  // Create effective target spec with overrides
  const effectiveTargetSpec = {
    ...targetSpec,
    h: horizonOverride ?? targetSpec.h,
    coverage: coverageOverride ?? targetSpec.coverage
  };

  // Generate forecast using the appropriate method
  let forecast: ForecastRecord;

  const isGbmBaseMethod = baseMethod === 'GBM' || baseMethod === 'GBM-CC';

  if (isGbmBaseMethod) {
    forecast = await generateGbmForecast(symbol, date_t, historicalData, effectiveTargetSpec, domain);
  } else if (baseMethod.startsWith('GARCH')) {
    forecast = await generateGarchForecast(symbol, date_t, historicalData, effectiveTargetSpec, domain, baseMethod);
  } else if (baseMethod.startsWith('Range')) {
    forecast = await generateRangeForecast(symbol, date_t, historicalData, effectiveTargetSpec, domain, baseMethod);
  } else if (baseMethod === 'HAR') {
    forecast = await generateHarForecast(symbol, date_t, historicalData, effectiveTargetSpec, domain);
  } else {
    throw new Error(`Unsupported base method: ${baseMethod}`);
  }

  // Mark as locked base forecast
  forecast.locked = true;
  forecast.method = baseMethod as any;
  
  return forecast;
}

/**
 * Generate GBM-based forecast
 */
async function generateGbmForecast(
  symbol: string,
  date_t: string,
  historicalData: any[],
  targetSpec: any,
  domain: 'log' | 'price'
): Promise<ForecastRecord> {
  // Simplified GBM implementation
  // In a real implementation, this would call your actual GBM engine
  
  const prices = historicalData.map(row => parseFloat(row.adj_close));
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i-1]));
  }

  const mu = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mu, 2), 0) / (returns.length - 1);
  const sigma = Math.sqrt(variance);
  
  const currentPrice = prices[prices.length - 1];
  const h = targetSpec.h;
  
  // Calculate prediction intervals
  const z_alpha = 1.96; // 95% confidence
  const sqrt_h = Math.sqrt(h);
  const drift = mu - 0.5 * variance;
  
  const m_log = Math.log(currentPrice) + drift * h;
  const s_scale = sigma * sqrt_h;
  
  const L_h = Math.exp(m_log - z_alpha * s_scale);
  const U_h = Math.exp(m_log + z_alpha * s_scale);
  
  // Compute explicit predicted price (y_hat) using GBM expected value formula
  const y_hat = currentPrice * Math.exp(drift * h);

  return {
    symbol,
    method: 'GBM' as any,
    date_t,
    created_at: new Date().toISOString(),
    locked: true,
    y_hat, // Add explicit predicted price
    horizonTrading: targetSpec.h, // Add horizonTrading field from target spec
    target: {
      h: targetSpec.h,
      coverage: targetSpec.coverage,
      window_requirements: {
        min_days: Math.min(historicalData.length, 252)
      }
    },
    estimates: {
      mu_star_hat: mu,
      sigma_hat: sigma,
      mu_star_used: drift,
      window_start: historicalData[0].date,
      window_end: date_t,
      n: historicalData.length,
      sigma_forecast: s_scale,
      sigma2_forecast: s_scale * s_scale,
      critical_value: z_alpha,
      window_span: {
        start: historicalData[0].date,
        end: date_t
      }
    },
    intervals: {
      L_h,
      U_h,
      band_width_bp: 10000 * (U_h / L_h - 1)
    },
    diagnostics: {
      method_source: 'GBM',
      m_log,
      s_scale
    },
    provenance: {
      rng_seed: null,
      params_snapshot: {
        mu,
        sigma,
        h: targetSpec.h,
        coverage: targetSpec.coverage
      },
      regime_tag: null,
      conformal: null
    }
  };
}

/**
 * Generate GARCH-based forecast (simplified)
 */
async function generateGarchForecast(
  symbol: string,
  date_t: string,
  historicalData: any[],
  targetSpec: any,
  domain: 'log' | 'price',
  method: string
): Promise<ForecastRecord> {
  // Simplified GARCH implementation
  // In practice, this would call your actual GARCH engine
  
  const prices = historicalData.map(row => parseFloat(row.adj_close));
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i-1]));
  }

  const mu = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mu, 2), 0) / (returns.length - 1);
  const sigma = Math.sqrt(variance);
  
  const currentPrice = prices[prices.length - 1];
  const h = targetSpec.h;
  
  // Simple GARCH(1,1) approximation
  const omega = variance * 0.1;
  const alpha = 0.1;
  const beta = 0.8;
  const long_run_var = omega / (1 - alpha - beta);
  
  const z_alpha = method.includes('-t') ? 2.0 : 1.96; // t-distribution vs normal
  const sqrt_h = Math.sqrt(h);
  
  const m_log = Math.log(currentPrice) + mu * h;
  const s_scale = Math.sqrt(long_run_var) * sqrt_h;
  
  const L_h = Math.exp(m_log - z_alpha * s_scale);
  const U_h = Math.exp(m_log + z_alpha * s_scale);
  
  // Compute explicit predicted price (y_hat) using expected value formula
  const y_hat = currentPrice * Math.exp(mu * h);

  return {
    symbol,
    method: method as any,
    date_t,
    created_at: new Date().toISOString(),
    locked: true,
    y_hat, // Add explicit predicted price
    target: {
      h: targetSpec.h,
      coverage: targetSpec.coverage,
      window_requirements: {
        min_days: Math.min(historicalData.length, 252)
      }
    },
    estimates: {
      mu_star_hat: mu,
      sigma_hat: sigma,
      mu_star_used: mu,
      window_start: historicalData[0].date,
      window_end: date_t,
      n: historicalData.length,
      sigma_forecast: s_scale,
      sigma2_forecast: s_scale * s_scale,
      critical_value: z_alpha,
      window_span: {
        start: historicalData[0].date,
        end: date_t
      }
    },
    intervals: {
      L_h,
      U_h,
      band_width_bp: 10000 * (U_h / L_h - 1)
    },
    diagnostics: {
      method_source: method,
      m_log,
      s_scale,
      garch_params: { omega, alpha, beta }
    },
    provenance: {
      rng_seed: null,
      params_snapshot: {
        omega,
        alpha,
        beta,
        h: targetSpec.h,
        coverage: targetSpec.coverage
      },
      regime_tag: null,
      conformal: null
    }
  };
}

/**
 * Generate Range-based forecast (simplified)
 */
async function generateRangeForecast(
  symbol: string,
  date_t: string,
  historicalData: any[],
  targetSpec: any,
  domain: 'log' | 'price',
  method: string
): Promise<ForecastRecord> {
  // Extract range estimator type from method
  const estimatorType = method.split('-')[1]; // 'P', 'GK', 'RS', 'YZ'
  
  const prices = historicalData.map(row => ({
    open: parseFloat(row.open),
    high: parseFloat(row.high),
    low: parseFloat(row.low),
    close: parseFloat(row.adj_close)
  }));

  const ranges = prices.map(p => {
    switch (estimatorType) {
      case 'P': return Math.log(p.high / p.low);
      case 'GK': return 0.5 * Math.pow(Math.log(p.high / p.low), 2) - (2 * Math.log(2) - 1) * Math.pow(Math.log(p.close / p.open), 2);
      case 'RS': return Math.log(p.high / p.close) * Math.log(p.high / p.open) + Math.log(p.low / p.close) * Math.log(p.low / p.open);
      case 'YZ': return Math.log(p.open / p.close) + 0.5 * Math.pow(Math.log(p.high / p.low), 2) - (2 * Math.log(2) - 1) * Math.pow(Math.log(p.close / p.open), 2);
      default: return Math.log(p.high / p.low);
    }
  });

  const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  const sigma = Math.sqrt(avgRange);
  
  const currentPrice = prices[prices.length - 1].close;
  const h = targetSpec.h;
  const z_alpha = 1.96;
  const sqrt_h = Math.sqrt(h);
  
  const m_log = Math.log(currentPrice);
  const s_scale = sigma * sqrt_h;
  
  const L_h = Math.exp(m_log - z_alpha * s_scale);
  const U_h = Math.exp(m_log + z_alpha * s_scale);
  
  // For range-based models, predicted price is same as current (no drift assumed)
  const y_hat = currentPrice; // Range models typically assume zero drift

  return {
    symbol,
    method: method as any,
    date_t,
    created_at: new Date().toISOString(),
    locked: true,
    y_hat, // Add explicit predicted price
    target: {
      h: targetSpec.h,
      coverage: targetSpec.coverage,
      window_requirements: {
        min_days: Math.min(historicalData.length, 22)
      }
    },
    estimates: {
      mu_star_hat: 0,
      sigma_hat: sigma,
      mu_star_used: 0,
      window_start: historicalData[0].date,
      window_end: date_t,
      n: historicalData.length,
      sigma_forecast: s_scale,
      sigma2_forecast: s_scale * s_scale,
      critical_value: z_alpha,
      window_span: {
        start: historicalData[0].date,
        end: date_t
      }
    },
    intervals: {
      L_h,
      U_h,
      band_width_bp: 10000 * (U_h / L_h - 1)
    },
    diagnostics: {
      method_source: method,
      m_log,
      s_scale,
      range_estimator: estimatorType
    },
    provenance: {
      rng_seed: null,
      params_snapshot: {
        estimator: estimatorType,
        avg_range: avgRange,
        h: targetSpec.h,
        coverage: targetSpec.coverage
      },
      regime_tag: null,
      conformal: null
    }
  };
}

/**
 * Generate HAR-based forecast (simplified)
 */
async function generateHarForecast(
  symbol: string,
  date_t: string,
  historicalData: any[],
  targetSpec: any,
  domain: 'log' | 'price'
): Promise<ForecastRecord> {
  // Simplified HAR implementation
  const prices = historicalData.map(row => parseFloat(row.adj_close));
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i-1]));
  }

  const variance = returns.reduce((sum, r) => sum + r * r, 0) / returns.length;
  const sigma = Math.sqrt(variance);
  
  const currentPrice = prices[prices.length - 1];
  const h = targetSpec.h;
  const z_alpha = 1.96;
  const sqrt_h = Math.sqrt(h);
  
  const m_log = Math.log(currentPrice);
  const s_scale = sigma * sqrt_h;
  
  const L_h = Math.exp(m_log - z_alpha * s_scale);
  const U_h = Math.exp(m_log + z_alpha * s_scale);
  
  // For HAR models, predicted price is same as current (no drift assumed)
  const y_hat = currentPrice; // HAR models typically assume zero drift

  return {
    symbol,
    method: 'HAR' as any,
    date_t,
    created_at: new Date().toISOString(),
    locked: true,
    y_hat, // Add explicit predicted price
    target: {
      h: targetSpec.h,
      coverage: targetSpec.coverage,
      window_requirements: {
        min_days: Math.min(historicalData.length, 22)
      }
    },
    estimates: {
      mu_star_hat: 0,
      sigma_hat: sigma,
      mu_star_used: 0,
      window_start: historicalData[0].date,
      window_end: date_t,
      n: historicalData.length,
      sigma_forecast: s_scale,
      sigma2_forecast: s_scale * s_scale,
      critical_value: z_alpha,
      window_span: {
        start: historicalData[0].date,
        end: date_t
      }
    },
    intervals: {
      L_h,
      U_h,
      band_width_bp: 10000 * (U_h / L_h - 1)
    },
    diagnostics: {
      method_source: 'HAR',
      m_log,
      s_scale
    },
    provenance: {
      rng_seed: null,
      params_snapshot: {
        realized_vol: variance,
        h: targetSpec.h,
        coverage: targetSpec.coverage
      },
      regime_tag: null,
      conformal: null
    }
  };
}

/**
 * Save a single forecast to the filesystem
 */
async function saveForecast(symbol: string, forecast: ForecastRecord): Promise<string> {
  const forecastsDir = path.join(process.cwd(), 'data', 'forecasts', symbol);
  
  // Ensure directory exists
  fs.mkdirSync(forecastsDir, { recursive: true });
  
  // Generate timestamp ID for tracking
  const timestampId = Date.now().toString();
  
  // Generate filename based on date and method
  const filename = `${forecast.date_t}_${forecast.method.replace(/[^a-zA-Z0-9]/g, '-')}_${timestampId}.json`;
  const filePath = path.join(forecastsDir, filename);
  
  fs.writeFileSync(filePath, JSON.stringify(forecast, null, 2));
  
  // Return the timestamp ID for tracking
  return timestampId;
}