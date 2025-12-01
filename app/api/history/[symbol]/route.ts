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

    // Load canonical data using existing utility
    const canonicalData = await loadCanonicalDataWithMeta(symbol);
    
    if (!canonicalData || !canonicalData.rows) {
      return NextResponse.json(
        { error: `No historical data found for ${symbol}` },
        { status: 404 }
      );
    }

    let { rows, meta } = canonicalData;

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

  } catch (error) {
    console.error('Historical data API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch historical data' },
      { status: 500 }
    );
  }
}