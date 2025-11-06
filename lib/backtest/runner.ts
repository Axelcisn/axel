import { ROConfig, ROOutcome, PIMetrics } from './types';
import { createPIMetrics, aggregatePIMetrics, getTradingDaysBetween } from './scoring';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Rolling-Origin Cross-Validation for Prediction Intervals
 * 
 * Implements honest, out-of-sample evaluation:
 * - Freeze at t close; verify t+1 using Final PI available at t
 * - Train on 3-year moving window; refit daily (enforced by immutable forecast files)
 * - No look-ahead bias
 */

interface FinalPI {
  date: string;           // forecast date (t)
  method: string;         // engine name
  L: number;              // lower bound
  U: number;              // upper bound
  coverage_nominal: number; // target coverage (e.g., 0.95)
}

interface PriceRecord {
  date: string;
  adjClose: number;
}

/**
 * Load Final PI for a specific date and engine
 */
async function loadFinalPI(
  symbol: string, 
  date: string, 
  engine: string
): Promise<FinalPI | null> {
  try {
    // Path: /data/forecasts/<symbol>/<date>-final.json
    const filePath = path.join(
      process.cwd(), 
      'data', 
      'forecasts', 
      symbol, 
      `${date}-final.json`
    );
    
    const content = await fs.readFile(filePath, 'utf8');
    const finalData = JSON.parse(content);
    
    // Find the specified engine's PI
    const enginePI = finalData.engines?.find((e: any) => e.method === engine);
    if (!enginePI || !enginePI.pi) {
      return null;
    }
    
    return {
      date,
      method: engine,
      L: enginePI.pi.L,
      U: enginePI.pi.U,
      coverage_nominal: enginePI.pi.coverage_nominal || 0.95
    };
  } catch (error) {
    return null;
  }
}

/**
 * Load realized price for a specific date
 */
async function loadRealizedPrice(symbol: string, date: string): Promise<number | null> {
  try {
    // First try to load from market data files
    // Path: /data/market/<symbol>/<date>-eod.json
    const filePath = path.join(
      process.cwd(),
      'data',
      'market',
      symbol,
      `${date}-eod.json`
    );
    
    const content = await fs.readFile(filePath, 'utf8');
    const marketData = JSON.parse(content);
    
    return marketData.adjClose || marketData.close || null;
  } catch (error) {
    // Fallback: could implement API call to external data source
    return null;
  }
}

/**
 * Get training window dates (3 years back from forecast date)
 */
function getTrainingWindow(forecastDate: string, trainYears: number): { start: string; end: string } {
  const endDate = new Date(forecastDate);
  endDate.setDate(endDate.getDate() - 1); // End at t-1 for forecast at t
  
  const startDate = new Date(endDate);
  startDate.setFullYear(startDate.getFullYear() - trainYears);
  
  return {
    start: startDate.toISOString().split('T')[0],
    end: endDate.toISOString().split('T')[0]
  };
}

/**
 * Check if training window has sufficient data
 */
async function hasValidTrainingWindow(
  symbol: string, 
  trainWindow: { start: string; end: string }
): Promise<boolean> {
  try {
    // Check if we have at least 250 trading days of data (rough heuristic)
    const tradingDays = getTradingDaysBetween(trainWindow.start, trainWindow.end);
    return tradingDays.length >= 250;
  } catch (error) {
    return false;
  }
}

/**
 * Main rolling-origin evaluation function
 */
export async function runRollingOriginPI(
  symbol: string,
  config: ROConfig,
  engines?: string[]
): Promise<ROOutcome> {
  
  const defaultEngines = ["GBM-CC", "GARCH11-t", "Range-YZ"];
  const selectedEngines = engines || defaultEngines;
  
  // Determine OOS evaluation period
  const today = new Date().toISOString().split('T')[0];
  const oosStart = config.start || (() => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 1); // Default: 1 year back
    return date.toISOString().split('T')[0];
  })();
  const oosEnd = config.end || today;
  
  console.log(`Running rolling-origin backtest for ${symbol}`);
  console.log(`OOS period: ${oosStart} to ${oosEnd}`);
  console.log(`Engines: ${selectedEngines.join(', ')}`);
  console.log(`Training window: ${config.train_years} years`);
  
  const allMetrics: PIMetrics[] = [];
  const oosTrainingDays = getTradingDaysBetween(oosStart, oosEnd);
  
  let processedDays = 0;
  let skippedDays = 0;
  
  for (const forecastDate of oosTrainingDays) {
    // Get next trading day for realization
    const nextDate = getNextTradingDay(forecastDate);
    if (!nextDate) {
      skippedDays++;
      continue;
    }
    
    // Check training window validity
    const trainWindow = getTrainingWindow(forecastDate, config.train_years);
    const hasValidTrain = await hasValidTrainingWindow(symbol, trainWindow);
    
    if (!hasValidTrain) {
      skippedDays++;
      continue;
    }
    
    // Load realized price at t+1
    const realizedPrice = await loadRealizedPrice(symbol, nextDate);
    if (realizedPrice === null) {
      skippedDays++;
      continue;
    }
    
    // Process each engine
    for (const engine of selectedEngines) {
      // Load Final PI available at forecast date (t)
      const finalPI = await loadFinalPI(symbol, forecastDate, engine);
      if (!finalPI) {
        continue; // Skip if no PI available for this engine/date
      }
      
      // Create PI metrics record
      const piMetrics = createPIMetrics(
        forecastDate,
        realizedPrice,
        finalPI.L,
        finalPI.U,
        engine,
        config.alpha
      );
      
      allMetrics.push(piMetrics);
    }
    
    processedDays++;
    
    // Progress logging
    if (processedDays % 50 === 0) {
      console.log(`Processed ${processedDays} days, skipped ${skippedDays}`);
    }
  }
  
  console.log(`Backtest complete: ${processedDays} days processed, ${skippedDays} skipped`);
  console.log(`Total PI metrics: ${allMetrics.length}`);
  
  // Create outcome with basic aggregation
  const outcome: ROOutcome = {
    config,
    pi_metrics: allMetrics,
    updated_at: new Date().toISOString()
  };
  
  return outcome;
}

/**
 * Get next trading day (simplified - skips weekends)
 */
function getNextTradingDay(date: string): string | null {
  const current = new Date(date);
  current.setDate(current.getDate() + 1);
  
  // Skip weekends
  let dayOfWeek = current.getDay();
  while (dayOfWeek === 0 || dayOfWeek === 6) {
    current.setDate(current.getDate() + 1);
    dayOfWeek = current.getDay();
  }
  
  return current.toISOString().split('T')[0];
}

/**
 * Aggregate metrics by engine for summary statistics
 */
export function aggregateMetricsByEngine(metrics: PIMetrics[]): Record<string, {
  coverage_60d: number;
  coverage_250d: number;
  avg_interval_score: number;
  count: number;
}> {
  const engineGroups: Record<string, PIMetrics[]> = {};
  
  // Group by engine
  for (const metric of metrics) {
    if (!engineGroups[metric.method]) {
      engineGroups[metric.method] = [];
    }
    engineGroups[metric.method].push(metric);
  }
  
  // Aggregate each engine
  const results: Record<string, any> = {};
  for (const [engine, engineMetrics] of Object.entries(engineGroups)) {
    // Sort by date for windowed calculations
    const sortedMetrics = engineMetrics.sort((a, b) => a.date.localeCompare(b.date));
    
    const coverage_60d = aggregatePIMetrics(sortedMetrics, 60).coverage;
    const coverage_250d = aggregatePIMetrics(sortedMetrics, 250).coverage;
    const overall = aggregatePIMetrics(sortedMetrics);
    
    results[engine] = {
      coverage_60d,
      coverage_250d,
      avg_interval_score: overall.avg_interval_score,
      count: overall.count
    };
  }
  
  return results;
}

/**
 * Filter metrics by date range
 */
export function filterMetricsByDateRange(
  metrics: PIMetrics[],
  start?: string,
  end?: string
): PIMetrics[] {
  return metrics.filter(metric => {
    if (start && metric.date < start) return false;
    if (end && metric.date > end) return false;
    return true;
  });
}

/**
 * Get available engines from metrics
 */
export function getAvailableEngines(metrics: PIMetrics[]): string[] {
  const engines = new Set<string>();
  for (const metric of metrics) {
    engines.add(metric.method);
  }
  return Array.from(engines).sort();
}