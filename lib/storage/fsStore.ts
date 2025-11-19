import * as fs from 'fs';
import * as path from 'path';
import { CanonicalRow, CanonicalTableMeta, RepairRecord } from '../types/canonical';

const DATA_ROOT = path.join(process.cwd(), 'data');

export type GbmForecast = {
  symbol: string;
  date_t: string;               // YYYY-MM-DD format
  date_forecast: string;        // ISO timestamp
  S_t: number;                  // Price at date_t
  estimates: {
    mu_star_hat: number;        // MLE drift
    sigma_hat: number;          // MLE volatility  
    mu_star_used: number;       // Shrunk drift
    z_alpha: number;            // Critical value
  };
  pi: {
    L1: number;                 // Lower bound
    U1: number;                 // Upper bound
    band_width_bp: number;      // Band width in bp
  };
  params: {
    windowN: 252 | 504 | 756;
    lambdaDrift: number;        // 0..1
    coverage: number;           // e.g., 0.95
  };
  window_period: {
    start: string;              // YYYY-MM-DD
    end: string;                // YYYY-MM-DD
    n_obs: number;              // Number of observations
  };
  meta: {
    tz: string;                 // Exchange timezone
  };
};

export async function saveRaw(file: Buffer, symbol: string): Promise<string> {
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `${timestamp}-${symbol}.xlsx`;
  const filePath = path.join(DATA_ROOT, 'uploads', filename);
  
  // Ensure directory exists
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  
  // Atomic write: write to temp file then rename
  const tempPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tempPath, file);
  await fs.promises.rename(tempPath, filePath);
  
  return filePath;
}

export async function saveCanonical(
  symbol: string, 
  payload: { rows: CanonicalRow[]; meta: CanonicalTableMeta }
): Promise<string> {
  const filename = `${symbol}.json`;
  const filePath = path.join(DATA_ROOT, 'canonical', filename);
  
  // Ensure directory exists
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  
  // Atomic write: write to temp file then rename
  const tempPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(payload, null, 2));
  await fs.promises.rename(tempPath, filePath);
  
  return filePath;
}

export async function appendRepairs(symbol: string, repairs: RepairRecord[]): Promise<string> {
  const filename = `repairs-${symbol}.json`;
  const filePath = path.join(DATA_ROOT, 'audit', filename);
  
  // Ensure directory exists
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  
  let existingRepairs: RepairRecord[] = [];
  
  // Read existing repairs if file exists
  try {
    const existingContent = await fs.promises.readFile(filePath, 'utf-8');
    existingRepairs = JSON.parse(existingContent);
  } catch (error) {
    // File doesn't exist or is invalid, start with empty array
    existingRepairs = [];
  }
  
  // Append new repairs
  const allRepairs = [...existingRepairs, ...repairs];
  
  // Atomic write: write to temp file then rename
  const tempPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(allRepairs, null, 2));
  await fs.promises.rename(tempPath, filePath);
  
  return filePath;
}

/**
 * Load repair records for a symbol
 */
export async function loadRepairs(symbol: string): Promise<RepairRecord[]> {
  const filename = `repairs-${symbol}.json`;
  const filePath = path.join(DATA_ROOT, 'audit', filename);
  
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content) as RepairRecord[];
  } catch (error) {
    // File doesn't exist or is invalid - return empty array
    return [];
  }
}

/**
 * Save a GBM forecast to the filesystem
 */
export async function saveForecast(forecast: GbmForecast): Promise<string> {
  const { symbol, date_t } = forecast;
  const filename = `${symbol}-${date_t}.json`;
  const filePath = path.join(DATA_ROOT, 'forecasts', filename);
  
  // Ensure directory exists
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  
  // Atomic write: write to temp file then rename
  const tempPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(forecast, null, 2));
  await fs.promises.rename(tempPath, filePath);
  
  return filePath;
}

/**
 * Load GBM forecasts for a symbol (all date_t values)
 */
export async function getForecasts(symbol: string): Promise<GbmForecast[]> {
  const forecastsDir = path.join(DATA_ROOT, 'forecasts');
  
  try {
    const files = await fs.promises.readdir(forecastsDir);
    const symbolFiles = files.filter(f => f.startsWith(`${symbol}-`) && f.endsWith('.json'));
    
    const forecasts: GbmForecast[] = [];
    for (const file of symbolFiles) {
      try {
        const filePath = path.join(forecastsDir, file);
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const forecast = JSON.parse(content) as GbmForecast;
        forecasts.push(forecast);
      } catch (error) {
        console.warn(`Failed to load forecast file ${file}:`, error);
      }
    }
    
    // Sort by date_t descending (most recent first)
    forecasts.sort((a, b) => b.date_t.localeCompare(a.date_t));
    
    return forecasts;
  } catch (error) {
    // Directory doesn't exist or other error
    return [];
  }
}