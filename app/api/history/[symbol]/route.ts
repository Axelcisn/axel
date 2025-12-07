import { NextRequest, NextResponse } from "next/server";
import { loadCanonicalDataWithMeta } from "@/lib/storage/canonical";

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
    const canonicalData = await loadCanonicalDataWithMeta(symbol);
    
    if (!canonicalData || !canonicalData.rows) {
      return NextResponse.json(
        { error: `No historical data found for ${symbol}` },
        { status: 404 }
      );
    }

    let { rows, meta } = canonicalData;

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