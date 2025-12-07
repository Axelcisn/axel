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
  const range = searchParams.get("range") ?? "5y";
  const interval = searchParams.get("interval") ?? "1d";

  try {
    const rows = await fetchYahooOhlcv(symbol, { range, interval });

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
    return NextResponse.json(
      {
        error: "Yahoo history sync failed",
        message,
      },
      { status: 500 }
    );
  }
}
