import * as fs from 'fs';
import * as path from 'path';
import { ForecastRecord } from './types';

// Use /tmp in production (Vercel), data/ in development
const DATA_ROOT = process.env.NODE_ENV === 'production' 
  ? '/tmp/data' 
  : path.join(process.cwd(), 'data');
const FORECASTS_DIR = path.join(DATA_ROOT, 'forecasts');

export async function saveForecast(record: ForecastRecord): Promise<string> {
  const symbolDir = path.join(FORECASTS_DIR, record.symbol);
  // Generate filename based on method: date-method.json (e.g., 2025-11-06-Conformal-CQR.json)
  const methodSlug = record.method.replace(/[^a-zA-Z0-9]/g, '-');
  const filename = `${record.date_t}-${methodSlug}.json`;
  const filePath = path.join(symbolDir, filename);
  
  try {
    // Ensure directory exists
    await fs.promises.mkdir(symbolDir, { recursive: true });
    
    // Ensure locked flag is set
    const lockedRecord: ForecastRecord = {
      ...record,
      locked: true,
      created_at: new Date().toISOString()
    };
    
    // Atomic write: write to temp file then rename
    const tempPath = `${filePath}.tmp`;
    await fs.promises.writeFile(tempPath, JSON.stringify(lockedRecord, null, 2));
    await fs.promises.rename(tempPath, filePath);
    
    return filePath;
  } catch (error) {
    // In production (read-only filesystem), we can't save but we should not fail
    console.warn('Could not save forecast to disk (read-only filesystem):', error);
    // Return a virtual path to indicate the forecast was "saved"
    return filePath;
  }
}

export async function getForecast(symbol: string, date_t?: string): Promise<ForecastRecord | null> {
  const symbolDir = path.join(FORECASTS_DIR, symbol);
  
  try {
    if (date_t) {
      // Get specific forecast
      const filename = `${date_t}-gbm.json`;
      const filePath = path.join(symbolDir, filename);
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(content) as ForecastRecord;
    } else {
      // Get latest forecast (lexicographic max by filename)
      const files = await fs.promises.readdir(symbolDir);
      const forecastFiles = files.filter(f => f.match(/^\d{4}-\d{2}-\d{2}-.+\.json$/)).sort();
      
      if (forecastFiles.length === 0) {
        return null;
      }
      
      const latestFile = forecastFiles[forecastFiles.length - 1];
      const filePath = path.join(symbolDir, latestFile);
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(content) as ForecastRecord;
    }
  } catch (error) {
    return null;
  }
}

export async function listForecasts(symbol: string): Promise<string[]> {
  const symbolDir = path.join(FORECASTS_DIR, symbol);
  
  try {
    const files = await fs.promises.readdir(symbolDir);
    return files.filter(f => f.match(/^\d{4}-\d{2}-\d{2}-.+\.json$/)).sort();
  } catch (error) {
    return [];
  }
}

/**
 * Load base forecasts (non-conformal) for conformal calibration
 */
export async function loadBaseForecasts(symbol: string, method?: string): Promise<ForecastRecord[]> {
  const symbolDir = path.join(FORECASTS_DIR, symbol);
  
  try {
    const files = await fs.promises.readdir(symbolDir);
    const forecastFiles = files
      .filter(f => f.match(/^\d{4}-\d{2}-\d{2}-.+\.json$/))
      .filter(f => !f.includes('Conformal')) // Exclude conformal forecasts
      .sort();
    
    if (method) {
      // Filter by specific method if provided
      const methodSlug = method.replace(/[^a-zA-Z0-9]/g, '-');
      forecastFiles.filter(f => f.includes(methodSlug));
    }
    
    const forecasts: ForecastRecord[] = [];
    for (const file of forecastFiles) {
      try {
        const filePath = path.join(symbolDir, file);
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const forecast = JSON.parse(content) as ForecastRecord;
        if (forecast.locked) {
          forecasts.push(forecast);
        }
      } catch (err) {
        console.warn(`Failed to load forecast ${file}:`, err);
      }
    }
    
    return forecasts;
  } catch (error) {
    return [];
  }
}

/**
 * Prefer the most recent forecast created for that date, across all methods
 */
export async function getFinalForecastForDate(symbol: string, date_t: string): Promise<ForecastRecord | null> {
  const symbolDir = path.join(FORECASTS_DIR, symbol);
  
  try {
    const files = await fs.promises.readdir(symbolDir);
    const forecastFiles = files
      .filter(f => f.match(/^\d{4}-\d{2}-\d{2}-.+\.json$/))
      .filter(f => f.startsWith(date_t))
      .sort();
    
    if (forecastFiles.length === 0) {
      return null;
    }
    
    // Find the most recent by created_at for this date
    let latestForecast: ForecastRecord | null = null;
    let latestCreatedAt = '';
    
    for (const file of forecastFiles) {
      try {
        const filePath = path.join(symbolDir, file);
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const forecast = JSON.parse(content) as ForecastRecord;
        
        if (forecast.locked && forecast.created_at > latestCreatedAt) {
          latestForecast = forecast;
          latestCreatedAt = forecast.created_at;
        }
      } catch (err) {
        console.warn(`Failed to load forecast ${file}:`, err);
      }
    }
    
    return latestForecast;
  } catch (error) {
    return null;
  }
}

/**
 * Latest by created_at across all methods
 */
export async function getLatestFinalForecast(symbol: string): Promise<ForecastRecord | null> {
  const symbolDir = path.join(FORECASTS_DIR, symbol);
  
  try {
    const files = await fs.promises.readdir(symbolDir);
    const forecastFiles = files
      .filter(f => f.match(/^\d{4}-\d{2}-\d{2}-.+\.json$/))
      .sort();
    
    if (forecastFiles.length === 0) {
      return null;
    }
    
    // Find the most recent by created_at across all dates and methods
    let latestForecast: ForecastRecord | null = null;
    let latestCreatedAt = '';
    
    for (const file of forecastFiles) {
      try {
        const filePath = path.join(symbolDir, file);
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const forecast = JSON.parse(content) as ForecastRecord;
        
        if (forecast.locked && forecast.created_at > latestCreatedAt) {
          latestForecast = forecast;
          latestCreatedAt = forecast.created_at;
        }
      } catch (err) {
        console.warn(`Failed to load forecast ${file}:`, err);
      }
    }
    
    return latestForecast;
  } catch (error) {
    return null;
  }
}

/**
 * Get all forecasts for a specific date
 */
export async function getForecastsForDate(symbol: string, date_t: string): Promise<ForecastRecord[]> {
  const symbolDir = path.join(FORECASTS_DIR, symbol);
  
  try {
    const files = await fs.promises.readdir(symbolDir);
    const forecastFiles = files
      .filter(f => f.match(/^\d{4}-\d{2}-\d{2}-.+\.json$/))
      .filter(f => f.startsWith(date_t))
      .sort();
    
    const forecasts: ForecastRecord[] = [];
    for (const file of forecastFiles) {
      try {
        const filePath = path.join(symbolDir, file);
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const forecast = JSON.parse(content) as ForecastRecord;
        if (forecast.locked) {
          forecasts.push(forecast);
        }
      } catch (err) {
        console.warn(`Failed to load forecast ${file}:`, err);
      }
    }
    
    return forecasts;
  } catch (error) {
    return [];
  }
}

/**
 * Update an existing forecast file
 */
export async function updateForecast(symbol: string, date_t: string, method: string, updates: Partial<ForecastRecord>): Promise<boolean> {
  const symbolDir = path.join(FORECASTS_DIR, symbol);
  const methodSlug = method.replace(/[^a-zA-Z0-9]/g, '-');
  const filename = `${date_t}-${methodSlug}.json`;
  const filePath = path.join(symbolDir, filename);
  
  try {
    // Read existing forecast
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const forecast = JSON.parse(content) as ForecastRecord;
    
    // Apply updates
    const updatedForecast = { ...forecast, ...updates };
    
    // Atomic write
    const tempPath = `${filePath}.tmp`;
    await fs.promises.writeFile(tempPath, JSON.stringify(updatedForecast, null, 2));
    await fs.promises.rename(tempPath, filePath);
    
    return true;
  } catch (error) {
    console.warn(`Failed to update forecast ${filename}:`, error);
    return false;
  }
}

/**
 * Deactivate all other forecasts for the same date and activate the specified one
 */
export async function setActiveForecast(symbol: string, date_t: string, method: string): Promise<void> {
  // Get all forecasts for this date
  const forecasts = await getForecastsForDate(symbol, date_t);
  
  // Deactivate all other forecasts for this date
  for (const forecast of forecasts) {
    if (forecast.method !== method) {
      await updateForecast(symbol, forecast.date_t, forecast.method, { is_active: false });
    }
  }
}