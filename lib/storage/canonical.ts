import fs from 'fs';
import path from 'path';
import { CanonicalRow, CanonicalTableMeta } from '../types/canonical';

export interface CanonicalData {
  rows: CanonicalRow[];
  meta: CanonicalTableMeta;
}

/**
 * Load canonical data for a symbol
 */
export async function loadCanonicalData(symbol: string): Promise<CanonicalRow[]> {
  // Use /tmp in production (Vercel), data/ in development
  const dataRoot = process.env.NODE_ENV === 'production' 
    ? '/tmp/data' 
    : path.join(process.cwd(), 'data');
  const canonicalPath = path.join(dataRoot, 'canonical', `${symbol}.json`);
  
  try {
    const canonicalContent = await fs.promises.readFile(canonicalPath, 'utf-8');
    const canonicalData: CanonicalData = JSON.parse(canonicalContent);
    return canonicalData.rows;
  } catch (error) {
    throw new Error(`No canonical data found for ${symbol}`);
  }
}

/**
 * Load canonical data with metadata for a symbol
 */
export async function loadCanonicalDataWithMeta(symbol: string): Promise<CanonicalData> {
  const canonicalPath = path.join(process.cwd(), 'data', 'canonical', `${symbol}.json`);
  
  try {
    const canonicalContent = await fs.promises.readFile(canonicalPath, 'utf-8');
    const canonicalData: CanonicalData = JSON.parse(canonicalContent);
    return canonicalData;
  } catch (error) {
    throw new Error(`No canonical data found for ${symbol}`);
  }
}

/**
 * Alias for compatibility
 */
export const loadCanonical = loadCanonicalDataWithMeta;

/**
 * Load canonical data supplemented with fresh Yahoo data for missing recent dates.
 * This ensures EWMA and other calculations have up-to-date data.
 */
export async function loadCanonicalDataWithYahooSupplement(symbol: string): Promise<CanonicalRow[]> {
  // Dynamic import to avoid circular dependencies
  const { fetchYahooOhlcv } = await import('@/lib/marketData/yahoo');
  
  let canonicalRows: CanonicalRow[] = [];
  
  // Try to load canonical data
  try {
    canonicalRows = await loadCanonicalData(symbol);
  } catch {
    // No canonical data, will try Yahoo only
  }
  
  // Check if canonical data is stale (last date is more than 1 day old)
  const today = new Date().toISOString().split('T')[0];
  const lastCanonicalDate = canonicalRows.length > 0 
    ? canonicalRows[canonicalRows.length - 1].date 
    : null;
  const isStale = !lastCanonicalDate || lastCanonicalDate < today;
  
  // If stale or no canonical data, supplement with Yahoo data
  if (isStale) {
    try {
      const yahooRows = await fetchYahooOhlcv(symbol, { range: "1mo", interval: "1d" });
      if (yahooRows.length > 0) {
        // Merge: Yahoo takes precedence for overlapping dates
        const dateMap = new Map<string, CanonicalRow>();
        for (const row of canonicalRows) {
          dateMap.set(row.date, row);
        }
        for (const row of yahooRows) {
          dateMap.set(row.date, row);
        }
        canonicalRows = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
      }
    } catch (err) {
      console.warn(`[canonical] Yahoo supplement failed for ${symbol}:`, err);
    }
  }
  
  if (canonicalRows.length === 0) {
    throw new Error(`No data found for ${symbol}`);
  }
  
  return canonicalRows;
}