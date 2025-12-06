import { promises as fs } from 'fs';
import path from 'path';
import { 
  WatchlistRow, 
  WatchlistSummary, 
  FinalPIRecord, 
  EventRecord, 
  MappingPrediction, 
  BacktestQuality 
} from './types';
import { backtestStorage } from '@/lib/backtest/store';

/**
 * Assembles a complete watchlist row for a symbol by aggregating data from:
 * - Latest Final PI forecast record (bands + provenance)
 * - Latest Event (if created today) for deviation fields
 * - Today's Mapping prediction for survival forecast
 * - Backtest outcomes for quality metrics
 */
export async function assembleRow(symbol: string, todayISO: string): Promise<WatchlistRow> {
  const row: WatchlistRow = {
    symbol,
    as_of: todayISO,
    deviation: {
      direction: "none",
      z_B: null,
      z_excess_B: null,
      pct_outside_B: null,
      ndist_B: null,
      vol_regime_pct: null
    },
    forecast: {
      source: "none",
      T_hat_median: null,
      I60: null,
      I80: null,
      P_ge_k: {},
      next_review_date: null
    },
    bands: {
      L_1: null,
      U_1: null,
      sigma_forecast: null,
      critical: { type: "none" },
      conformal: undefined
    },
    quality: {},
    provenance: {
      pi_engine: null,
      range_sigma: null,
      conformal_mode: null,
      surv_model: null,
      evaluation: "rolling-origin"
    }
  };

  try {
    // 1. Load latest Final PI forecast
    const finalPI = await loadLatestFinalPI(symbol, todayISO);
    if (finalPI) {
      populateBandsFromPI(row, finalPI);
      populateProvenanceFromPI(row, finalPI);
    }

    // 2. Load latest Event (if created today)
    const event = await loadTodayEvent(symbol, todayISO);
    if (event) {
      populateDeviationFromEvent(row, event);
    }

    // 3. Load today's Mapping prediction
    const mapping = await loadTodayMapping(symbol, todayISO);
    if (mapping) {
      populateForecastFromMapping(row, mapping, todayISO);
    }

    // 4. Load backtest quality metrics
    const quality = await loadBacktestQuality(symbol);
    if (quality) {
      populateQualityFromBacktest(row, quality);
    }

    return row;

  } catch (error) {
    console.error(`Failed to assemble row for ${symbol}:`, error);
    return row; // Return partial row with nulls for missing data
  }
}

/**
 * Assembles watchlist for multiple symbols
 * Uses Promise.allSettled to process symbols in parallel while handling errors per-symbol
 */
export async function assembleWatchlist(symbols: string[], todayISO: string): Promise<WatchlistSummary> {
  // Process all symbols in parallel
  const results = await Promise.allSettled(
    symbols.map(symbol => assembleRow(symbol, todayISO))
  );

  // Collect successful rows and log errors
  const rows: WatchlistRow[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      rows.push(result.value);
    } else {
      console.error(`Failed to assemble row for ${symbols[index]}:`, result.reason);
      // Continue with other symbols - error already logged
    }
  });

  const summary: WatchlistSummary = {
    as_of: todayISO,
    rows
  };

  // Persist to storage
  await saveWatchlistSummary(summary);

  return summary;
}

/**
 * Get canonical symbols from existing data files
 */
export async function getCanonicalSymbols(): Promise<string[]> {
  try {
    const canonicalDir = path.join(process.cwd(), 'data', 'canonical');
    const files = await fs.readdir(canonicalDir);
    const symbols = files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
      .sort();
    return symbols;
  } catch (error) {
    console.warn('Failed to read canonical symbols:', error);
    return [];
  }
}

/**
 * Load latest Final PI forecast record
 */
async function loadLatestFinalPI(symbol: string, todayISO: string): Promise<FinalPIRecord | null> {
  try {
    const forecastDir = path.join(process.cwd(), 'data', 'forecasts', symbol);
    const files = await fs.readdir(forecastDir);
    
    // Find latest final-pi file on or before today
    const finalPIFiles = files
      .filter(f => f.startsWith('final-pi-') && f.endsWith('.json'))
      .map(f => ({
        file: f,
        date: f.replace('final-pi-', '').replace('.json', '')
      }))
      .filter(({ date }) => date <= todayISO)
      .sort((a, b) => b.date.localeCompare(a.date));

    if (finalPIFiles.length === 0) return null;

    const latestFile = finalPIFiles[0];
    const filePath = path.join(forecastDir, latestFile.file);
    const content = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(content);

    // Extract the first (primary) forecast record
    if (data.forecasts && data.forecasts.length > 0) {
      const forecast = data.forecasts[0];
      return {
        date: latestFile.date,
        method: forecast.method || 'unknown',
        L: forecast.L,
        U: forecast.U,
        sigma_forecast: forecast.sigma_forecast,
        critical: forecast.critical,
        conformal: forecast.conformal
      };
    }

    return null;
  } catch (error) {
    console.warn(`Failed to load Final PI for ${symbol}:`, error);
    return null;
  }
}

/**
 * Load today's event record
 */
async function loadTodayEvent(symbol: string, todayISO: string): Promise<EventRecord | null> {
  try {
    const eventPath = path.join(process.cwd(), 'data', 'events', `${symbol}-${todayISO}.json`);
    const content = await fs.readFile(eventPath, 'utf8');
    const data = JSON.parse(content);
    return data as EventRecord;
  } catch (error) {
    // No event today is normal
    return null;
  }
}

/**
 * Load today's mapping prediction
 */
async function loadTodayMapping(symbol: string, todayISO: string): Promise<MappingPrediction | null> {
  try {
    const mappingPath = path.join(process.cwd(), 'data', 'mapping', symbol, `${todayISO}.json`);
    const content = await fs.readFile(mappingPath, 'utf8');
    const data = JSON.parse(content);
    return data as MappingPrediction;
  } catch (error) {
    console.warn(`Failed to load mapping for ${symbol} on ${todayISO}:`, error);
    return null;
  }
}

/**
 * Load backtest quality metrics
 */
async function loadBacktestQuality(symbol: string): Promise<BacktestQuality | null> {
  try {
    const summary = await backtestStorage.getBacktestSummary(symbol);
    if (!summary) return null;

    return {
      pi_coverage_250d: summary.coverage_250d,
      interval_score: summary.avg_interval_score,
      c_index: summary.c_index,
      ibs_20d: summary.ibs, // Use IBS as proxy for 20d
      fdr_q: summary.fdr_q,
      pbo: summary.pbo,
      dsr: summary.dsr,
      regime: summary.regime_count ? {
        id: summary.regime_count,
        break_date: undefined // Would need to get from detailed outcome
      } : undefined
    };
  } catch (error) {
    console.warn(`Failed to load backtest quality for ${symbol}:`, error);
    return null;
  }
}

/**
 * Populate bands from Final PI
 */
function populateBandsFromPI(row: WatchlistRow, finalPI: FinalPIRecord): void {
  row.bands.L_1 = finalPI.L;
  row.bands.U_1 = finalPI.U;
  row.bands.sigma_forecast = finalPI.sigma_forecast || null;
  row.bands.critical = finalPI.critical || { type: "none" };
  row.bands.conformal = finalPI.conformal;
}

/**
 * Populate provenance from Final PI
 */
function populateProvenanceFromPI(row: WatchlistRow, finalPI: FinalPIRecord): void {
  // Parse method string to extract components
  const method = finalPI.method;
  
  // Extract PI engine (e.g., "GARCH11-t", "GBM-CC")
  if (method.includes('GARCH')) {
    row.provenance.pi_engine = method.includes('GARCH11') ? 'GARCH11-t' : 'GARCH-bootstrap';
  } else if (method.includes('GBM')) {
    row.provenance.pi_engine = 'GBM-CC';
  } else if (method.includes('exp_smooth')) {
    row.provenance.pi_engine = 'exp_smooth';
  } else if (method.includes('linear')) {
    row.provenance.pi_engine = 'linear';
  } else {
    row.provenance.pi_engine = method;
  }

  // Extract range sigma method
  if (method.includes('Range')) {
    row.provenance.range_sigma = method.includes('YZ') ? 'Range-YZ' : 'Range-CC';
  }

  // Extract conformal mode
  if (finalPI.conformal?.mode) {
    row.provenance.conformal_mode = finalPI.conformal.mode;
  }
}

/**
 * Populate deviation from Event
 */
function populateDeviationFromEvent(row: WatchlistRow, event: EventRecord): void {
  row.deviation.direction = event.direction;
  row.deviation.z_B = event.z_B || null;
  row.deviation.z_excess_B = event.z_excess_B || null;
  row.deviation.pct_outside_B = event.pct_outside_B || null;
  row.deviation.ndist_B = event.ndist_B || null;
  row.deviation.vol_regime_pct = event.vol_regime_pct || null;
}

/**
 * Populate forecast from Mapping prediction
 */
function populateForecastFromMapping(row: WatchlistRow, mapping: MappingPrediction, todayISO: string): void {
  row.forecast.source = mapping.source;
  row.forecast.T_hat_median = mapping.T_hat_median;
  row.forecast.I60 = mapping.I60;
  row.forecast.I80 = mapping.I80;
  row.forecast.P_ge_k = mapping.P_ge_k;
  
  // Calculate next_review_date = today + round(T_hat_median)
  if (mapping.T_hat_median != null) {
    const reviewDays = Math.round(mapping.T_hat_median);
    const reviewDate = new Date(todayISO);
    reviewDate.setDate(reviewDate.getDate() + reviewDays);
    row.forecast.next_review_date = reviewDate.toISOString().split('T')[0];
  }

  // Extract survival model from mapping source info if available
  if (mapping.source === 'Cox') {
    row.provenance.surv_model = 'Cox(efron,cluster)';
  } else if (mapping.source === 'AFT') {
    row.provenance.surv_model = 'AFT-lognormal';
  } else if (mapping.source === 'KM') {
    row.provenance.surv_model = 'Kaplan-Meier';
  }
}

/**
 * Populate quality from Backtest
 */
function populateQualityFromBacktest(row: WatchlistRow, quality: BacktestQuality): void {
  row.quality.pi_coverage_250d = quality.pi_coverage_250d || null;
  row.quality.interval_score = quality.interval_score || null;
  row.quality.c_index = quality.c_index || null;
  row.quality.ibs_20d = quality.ibs_20d || null;
  row.quality.fdr_q = quality.fdr_q || null;
  row.quality.pbo = quality.pbo || null;
  row.quality.dsr = quality.dsr || null;
  row.quality.regime = quality.regime || null;
}

/**
 * Save watchlist summary to storage
 */
async function saveWatchlistSummary(summary: WatchlistSummary): Promise<void> {
  try {
    const watchlistDir = path.join(process.cwd(), 'data', 'watchlist');
    
    // Ensure directory exists
    try {
      await fs.access(watchlistDir);
    } catch {
      await fs.mkdir(watchlistDir, { recursive: true });
    }

    const filePath = path.join(watchlistDir, `${summary.as_of}.json`);
    await fs.writeFile(filePath, JSON.stringify(summary, null, 2), 'utf8');
    
    console.log(`Saved watchlist summary to ${filePath}`);
  } catch (error) {
    console.error('Failed to save watchlist summary:', error);
    throw error;
  }
}

/**
 * Load watchlist summary from storage
 */
export async function loadWatchlistSummary(asOf: string): Promise<WatchlistSummary | null> {
  try {
    const filePath = path.join(process.cwd(), 'data', 'watchlist', `${asOf}.json`);
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as WatchlistSummary;
  } catch (error) {
    return null;
  }
}

/**
 * Get latest watchlist summary
 */
export async function getLatestWatchlistSummary(): Promise<WatchlistSummary | null> {
  try {
    const watchlistDir = path.join(process.cwd(), 'data', 'watchlist');
    const files = await fs.readdir(watchlistDir);
    
    const summaryFiles = files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
      .sort()
      .reverse();

    if (summaryFiles.length === 0) return null;

    const latestDate = summaryFiles[0];
    return await loadWatchlistSummary(latestDate);
  } catch (error) {
    return null;
  }
}