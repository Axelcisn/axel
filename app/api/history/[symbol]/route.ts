import { NextRequest, NextResponse } from "next/server";
import { loadCanonicalDataWithMeta } from "@/lib/storage/canonical";
import { fetchYahooOhlcv } from "@/lib/marketData/yahoo";
import type { CanonicalRow } from "@/lib/types/canonical";

/**
 * Check if US markets have closed for today.
 * Returns true if it's past 4:00 PM Eastern Time.
 * This is used to filter out incomplete intraday data from Yahoo.
 */
function isUsMarketClosed(now: Date = new Date()): boolean {
  // Convert to US Eastern time
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
  
  // US regular trading ends at 16:00 ET (4:00 PM)
  // Add a small buffer (5 minutes) to account for settlement
  const marketCloseMinutes = 16 * 60 + 5; // 16:05 ET
  
  return totalMinutes >= marketCloseMinutes;
}

/**
 * Get today's date in YYYY-MM-DD format in US Eastern timezone.
 */
function getTodayET(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now); // Returns YYYY-MM-DD format
}

/**
 * Merge canonical rows with fresh Yahoo data.
 * Yahoo data takes precedence for overlapping dates, and fills in missing recent dates.
 */
function mergeWithYahooData(canonicalRows: CanonicalRow[], yahooRows: CanonicalRow[]): CanonicalRow[] {
  const dateMap = new Map<string, CanonicalRow>();
  
  // First add all canonical rows
  for (const row of canonicalRows) {
    dateMap.set(row.date, row);
  }
  
  // Then overlay Yahoo data (more recent)
  for (const row of yahooRows) {
    dateMap.set(row.date, row);
  }
  
  // Sort by date ascending
  return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const { symbol } = params;
    const url = new URL(request.url);
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    const requestedInterval = url.searchParams.get("interval"); // e.g., "1d", "1h", "1m"

    // Load canonical data using existing utility
    let canonicalData = await loadCanonicalDataWithMeta(symbol).catch(() => null);
    
    let rows: CanonicalRow[] = canonicalData?.rows ?? [];
    let meta = canonicalData?.meta ?? {};

    // Aim to serve at least ~5y of daily data (~1260 trading days)
    const MIN_ROWS_FOR_CHART = 1260;
    
    // Check if canonical data is stale (last date is more than 1 day old)
    const todayET = getTodayET();
    const lastCanonicalDate = rows.length > 0 ? rows[rows.length - 1].date : null;
    const isStale = !lastCanonicalDate || lastCanonicalDate < todayET;
    const needsDepth = rows.length < MIN_ROWS_FOR_CHART;
    
    // If stale or too shallow, try to supplement with Yahoo data
    if (isStale || needsDepth) {
      try {
        // Use a deep range when we lack enough history, otherwise top up with a shorter range.
        const yahooRange = needsDepth ? "max" : "1mo";
        let yahooRows = await fetchYahooOhlcv(symbol, { range: yahooRange, interval: "1d" });
        
        // IMPORTANT: If the US market has not closed yet, filter out today's incomplete bar.
        // Yahoo returns intraday data as a daily bar with the current price as "close",
        // which is misleading for forecasting. We only want confirmed closing prices.
        if (!isUsMarketClosed()) {
          const beforeFilterCount = yahooRows.length;
          yahooRows = yahooRows.filter(row => row.date < todayET);
          if (yahooRows.length < beforeFilterCount) {
            console.log(`[history/${symbol}] Filtered out incomplete today's bar (market still open). todayET=${todayET}`);
            (meta as any).marketOpen = true;
            (meta as any).filteredTodayBar = true;
          }
        }
        
        if (yahooRows.length > 0) {
          rows = mergeWithYahooData(rows, yahooRows);
          (meta as any).supplementedWithYahoo = true;
          (meta as any).yahooDataRange = {
            first: yahooRows[0]?.date,
            last: yahooRows[yahooRows.length - 1]?.date,
          };
        }
      } catch (yahooErr) {
        console.warn(`[history/${symbol}] Yahoo supplement failed:`, yahooErr);
        // Continue with canonical data only
      }
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: `No historical data found for ${symbol}` },
        { status: 404 }
      );
    }

    // Log a warning if the requested interval doesn't match stored meta (debug helper)
    const storedInterval = (meta as any)?.interval;
    if (requestedInterval && storedInterval && requestedInterval !== storedInterval) {
      console.warn(
        `[history/${symbol}] Requested interval=${requestedInterval} but canonical has interval=${storedInterval}`
      );
    }

    // Filter by date range if provided
    if (start || end) {
      rows = rows.filter((row) => {
        const d = row.date;
        if (start && d < start) return false;
        if (end && d > end) return false;
        return true;
      });
    }

    // Ensure rows are sorted by date (ascending)
    rows.sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({ 
      rows, 
      meta: {
        ...meta,
        interval: (meta as any)?.interval ?? requestedInterval ?? "1d",
        filteredRows: rows.length,
        start,
        end
      }
    });

  } catch (error: any) {
    console.error('Historical data API error:', error);

    // Detect missing file / missing canonical case
    const code = error?.code;
    const msg = String(error?.message ?? "");

    if (code === "ENOENT" || msg.includes("No canonical data")) {
      const { symbol } = params;
      return NextResponse.json(
        { error: "not_found", symbol, message: `No canonical history found for ${symbol}` },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: "internal_error", message: "Failed to fetch historical data" },
      { status: 500 }
    );
  }
}
