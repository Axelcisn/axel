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
 * 
 * IMPORTANT: Filters out today's incomplete bar if the US market has not closed yet.
 */
export async function loadCanonicalDataWithYahooSupplement(symbol: string): Promise<CanonicalRow[]> {
  // Dynamic import to avoid circular dependencies
  const { fetchYahooOhlcv } = await import('@/lib/marketData/yahoo');
  // Minimum depth needed for EWMA + reaction map defaults (~500 train obs + 252-day warmup)
  const MIN_ROWS_FOR_EWMA = 760;
  
  let canonicalRows: CanonicalRow[] = [];
  
  // Try to load canonical data
  try {
    canonicalRows = await loadCanonicalData(symbol);
  } catch {
    // No canonical data, will try Yahoo only
  }
  
  // Helper: Check if US markets have closed (past 4:05 PM ET)
  function isUsMarketClosed(): boolean {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
    const parts = formatter.formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    const totalMinutes = hour * 60 + minute;
    return totalMinutes >= 16 * 60 + 5; // 16:05 ET
  }
  
  // Helper: Get today's date in YYYY-MM-DD format in US Eastern timezone
  function getTodayET(): string {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date());
  }
  
  // Check if canonical data is stale (last date is more than 1 day old)
  const todayET = getTodayET();
  const lastCanonicalDate = canonicalRows.length > 0 
    ? canonicalRows[canonicalRows.length - 1].date 
    : null;
  const isStale = !lastCanonicalDate || lastCanonicalDate < todayET;
  const needsDepth = canonicalRows.length < MIN_ROWS_FOR_EWMA;
  
  // If stale or too shallow (not enough rows), supplement with Yahoo data
  if (isStale || needsDepth) {
    try {
      // Fetch a deeper history when we don't have enough rows to satisfy EWMA defaults
      const yahooRange = needsDepth ? "5y" : "1mo";
      let yahooRows = await fetchYahooOhlcv(symbol, { range: yahooRange, interval: "1d" });
      
      // IMPORTANT: Filter out today's incomplete bar if market hasn't closed
      if (!isUsMarketClosed()) {
        yahooRows = yahooRows.filter(row => row.date < todayET);
      }
      
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
