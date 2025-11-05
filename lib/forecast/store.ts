import * as fs from 'fs';
import * as path from 'path';
import { ForecastRecord } from './types';

const DATA_ROOT = path.join(process.cwd(), 'data');
const FORECASTS_DIR = path.join(DATA_ROOT, 'forecasts');

export async function saveForecast(record: ForecastRecord): Promise<string> {
  const symbolDir = path.join(FORECASTS_DIR, record.symbol);
  const filename = `${record.date_t}-gbm.json`;
  const filePath = path.join(symbolDir, filename);
  
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
      const gbmFiles = files.filter(f => f.endsWith('-gbm.json')).sort();
      
      if (gbmFiles.length === 0) {
        return null;
      }
      
      const latestFile = gbmFiles[gbmFiles.length - 1];
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
    return files.filter(f => f.endsWith('-gbm.json')).sort();
  } catch (error) {
    return [];
  }
}