import fs from 'fs';
import path from 'path';
import { CanonicalRow, CanonicalTableMeta } from '../types/canonical';

export interface CanonicalData {
  rows: CanonicalRow[];
  meta: CanonicalTableMeta;
}

function getDataBaseUrl(): string {
  return process.env.NODE_ENV === 'production'
    ? '' // Use relative path in production
    : ''; // Use relative path in development too
}

/**
 * Load canonical data for a symbol
 */
export async function loadCanonicalData(symbol: string): Promise<CanonicalRow[]> {
  const baseUrl = getDataBaseUrl();
  const canonicalUrl = `${baseUrl}/data/canonical/${symbol}.json`;
  
  try {
    const response = await fetch(canonicalUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const canonicalData: CanonicalData = await response.json();
    return canonicalData.rows;
  } catch (error) {
    throw new Error(`No canonical data found for ${symbol}`);
  }
}

/**
 * Load canonical data with metadata for a symbol
 */
export async function loadCanonicalDataWithMeta(symbol: string): Promise<CanonicalData> {
  const baseUrl = getDataBaseUrl();
  const canonicalUrl = `${baseUrl}/data/canonical/${symbol}.json`;
  
  try {
    const response = await fetch(canonicalUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const canonicalData: CanonicalData = await response.json();
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
      const yahooRange = needsDepth ? "max" : "1mo";
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

/**
 * Ensure we have a canonical-like history for a symbol by falling back to Yahoo
 * when the canonical file is missing or too shallow. Optionally persists the
 * merged dataset to the canonical store for reuse.
 */
export async function ensureCanonicalOrHistory(
  symbol: string,
  opts?: { minRows?: number; interval?: '1d'; persist?: boolean; forceMaxRefresh?: boolean }
): Promise<CanonicalData> {
  const minRows = opts?.minRows ?? 252;
  const interval = opts?.interval ?? '1d';
  const persist = opts?.persist !== false;
  const forceMaxRefresh = opts?.forceMaxRefresh === true;

  let existing: CanonicalData | null = null;
  try {
    existing = await loadCanonicalDataWithMeta(symbol);
    const hasRange = (existing.meta as any)?.range;
    const prevRange = typeof hasRange === "string" ? hasRange : null;
    const prevStart = existing.meta?.calendar_span?.start ?? null;
    const prevRows = existing.rows.length;

    const isLikelyShallowDaily =
      interval === "1d" &&
      (
        (prevRange != null && prevRange !== "max") ||
        (
          !prevRange &&
          prevRows >= 1000 &&
          prevRows <= 2000 &&
          (() => {
            if (!prevStart) return false;
            const startYear = Number(prevStart.slice(0, 4));
            if (!Number.isFinite(startYear)) return false;
            const currentYear = new Date().getUTCFullYear();
            return currentYear - startYear <= 7;
          })()
        ) ||
        forceMaxRefresh
      );

    if (existing.rows.length >= minRows && !isLikelyShallowDaily) {
      return existing;
    }
  } catch {
    existing = null;
  }

  // Helper: Check if US markets have closed (past 4:05 PM ET)
  function isUsMarketClosed(): boolean {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
    const parts = formatter.formatToParts(now);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const totalMinutes = hour * 60 + minute;
    return totalMinutes >= 16 * 60 + 5; // 16:05 ET
  }

  // Helper: Get today's date in YYYY-MM-DD format in US Eastern timezone
  function getTodayET(): string {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  }

  // Fetch Yahoo history and merge with any existing canonical rows
  const { fetchYahooOhlcv } = await import('@/lib/marketData/yahoo');
  let yahooRows = await fetchYahooOhlcv(symbol, { range: 'max', interval });

  // Filter out today's incomplete bar if the market hasn't closed
  const todayET = getTodayET();
  if (!isUsMarketClosed()) {
    yahooRows = yahooRows.filter((row) => row.date < todayET);
  }

  // Merge existing canonical rows (if any) with Yahoo rows; Yahoo takes precedence
  let mergedRows: CanonicalRow[] = [];
  const dateMap = new Map<string, CanonicalRow>();
  if (existing?.rows?.length) {
    for (const row of existing.rows) {
      dateMap.set(row.date, row);
    }
  }
  for (const row of yahooRows) {
    dateMap.set(row.date, row);
  }
  mergedRows = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // Compute log returns so downstream models have them available
  for (let i = 1; i < mergedRows.length; i++) {
    const prev = mergedRows[i - 1];
    const curr = mergedRows[i];
    const prevPrice = prev.adj_close ?? prev.close;
    const currPrice = curr.adj_close ?? curr.close;
    if (typeof prevPrice === 'number' && typeof currPrice === 'number' && prevPrice > 0 && currPrice > 0) {
      curr.r = Math.log(currPrice / prevPrice);
    } else {
      curr.r = null;
    }
  }
  if (mergedRows.length > 0) {
    mergedRows[0].r = null;
  }

  const meta: CanonicalTableMeta = {
    symbol,
    exchange: existing?.meta?.exchange,
    exchange_tz: existing?.meta?.exchange_tz ?? 'America/New_York',
    calendar_span: {
      start: mergedRows[0]?.date ?? '',
      end: mergedRows[mergedRows.length - 1]?.date ?? '',
    },
    rows: mergedRows.length,
    missing_trading_days: existing?.meta?.missing_trading_days ?? [],
    invalid_rows: existing?.meta?.invalid_rows ?? 0,
    generated_at: new Date().toISOString(),
    range: "max",
  };

  if (mergedRows.length === 0) {
    throw new Error(`No data found for ${symbol}`);
  }

  if (persist) {
    // Persist using the same canonical writer as uploads
    const { saveCanonical } = await import('./fsStore');
    await saveCanonical(symbol, { rows: mergedRows, meta });
    if (process.env.NODE_ENV !== "production") {
      const prevRange = existing?.meta ? (existing.meta as any).range ?? null : null;
      const prevStart = existing?.meta?.calendar_span?.start ?? null;
      console.log("[canonical] refresh shallow cache -> max", {
        symbol,
        prevRange,
        prevRows: existing?.rows.length ?? 0,
        newRows: mergedRows.length,
        prevStart,
        newStart: mergedRows[0]?.date ?? null,
      });
    }
  }

  return { rows: mergedRows, meta };
}
