import { NextRequest, NextResponse } from "next/server";
import { loadCanonicalDataWithMeta } from "@/lib/storage/canonical";
import { fetchYahooOhlcv } from "@/lib/marketData/yahoo";
import type { CanonicalRow } from "@/lib/types/canonical";

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
    
    // Check if canonical data is stale (last date is more than 1 day old)
    const today = new Date().toISOString().split('T')[0];
    const lastCanonicalDate = rows.length > 0 ? rows[rows.length - 1].date : null;
    const isStale = !lastCanonicalDate || lastCanonicalDate < today;
    
    // If stale or no canonical data, try to supplement with Yahoo data
    if (isStale) {
      try {
        const yahooRows = await fetchYahooOhlcv(symbol, { range: "1mo", interval: "1d" });
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