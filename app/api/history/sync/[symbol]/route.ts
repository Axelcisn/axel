import { NextRequest, NextResponse } from "next/server";
import { fetchYahooOhlcv } from "@/lib/marketData/yahoo";
import { saveCanonical } from "@/lib/storage/fsStore";
import type { CanonicalRow, CanonicalTableMeta } from "@/lib/types/canonical";

export const dynamic = "force-dynamic";

/**
 * Build a CanonicalTableMeta compatible with the existing pipeline.
 */
function buildMeta(
  symbol: string,
  rows: CanonicalRow[],
  extra?: Record<string, unknown>
): CanonicalTableMeta {
  const dates = rows.map((r) => r.date).sort();
  const invalidCount = rows.filter((r) => r.valid === false).length;

  return {
    symbol,
    exchange: undefined, // Yahoo doesn't provide explicit exchange info
    exchange_tz: "America/New_York", // Default for US stocks; could be improved
    calendar_span: {
      start: dates[0] ?? "",
      end: dates[dates.length - 1] ?? "",
    },
    rows: rows.length,
    missing_trading_days: [], // Not computed for Yahoo sync
    invalid_rows: invalidCount,
    generated_at: new Date().toISOString(),
    // Extra metadata
    ...extra,
  } as CanonicalTableMeta;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol.toUpperCase();

  const { searchParams } = new URL(request.url);
  const interval = searchParams.get("interval") ?? "1d";
  
  // Sensible range defaults per interval
  const defaultRangeForInterval: Record<string, string> = {
    "1d": "max",
    "1h": "6mo",
    "1m": "5d",
  };
  const range = searchParams.get("range") ?? defaultRangeForInterval[interval] ?? "1y";

  try {
    const rows = await fetchYahooOhlcv(symbol, { range, interval });

    // Check if Yahoo returned empty data (symbol not found or no data available)
    if (!rows || rows.length === 0) {
      return NextResponse.json(
        {
          error: "yahoo_not_found",
          symbol,
          message: `No Yahoo Finance data found for ${symbol}`,
        },
        { status: 404 }
      );
    }

    // Ensure rows are sorted ascending
    rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Compute log returns r using adj_close when available
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const curr = rows[i];
      const prevPrice = prev.adj_close ?? prev.close;
      const currPrice = curr.adj_close ?? curr.close;
      if (typeof prevPrice === 'number' && typeof currPrice === 'number' && prevPrice > 0 && currPrice > 0) {
        rows[i].r = Math.log(currPrice / prevPrice);
      } else {
        rows[i].r = null;
      }
    }
    if (rows.length > 0) {
      rows[0].r = null; // first row has no prior
    }

    // Build meta compatible with the existing canonical pipeline
    const meta = buildMeta(symbol, rows, {
      vendor: "yahoo",
      source: "yahoo-chart-api",
      range,
      interval,
    });

    await saveCanonical(symbol, { rows, meta });

    return NextResponse.json({ rows, meta }, { status: 200 });
  } catch (err: unknown) {
    console.error("Yahoo history sync error", err);
    const message = err instanceof Error ? err.message : "Unknown error";

    // Distinguish between "no data" errors and network/server errors
    const isNotFound =
      message.includes("chart error") ||
      message.includes("Not Found") ||
      message.includes("No data");

    if (isNotFound) {
      return NextResponse.json(
        {
          error: "yahoo_not_found",
          symbol,
          message: `No Yahoo Finance data found for ${symbol}`,
        },
        { status: 404 }
      );
    }

    // Network/server/rate-limit errors
    return NextResponse.json(
      {
        error: "yahoo_failed",
        symbol,
        message: "Failed to fetch data from Yahoo Finance. Please try again later.",
      },
      { status: 502 }
    );
  }
}
