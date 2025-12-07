import { NextRequest, NextResponse } from "next/server";
import { getAllHistoricalTradesForTicker } from "@/lib/trading212/trades";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: rawTicker } = await params;
  const { searchParams } = new URL(request.url);

  const maxPagesParam = searchParams.get("maxPages");
  const pageSizeParam = searchParams.get("pageSize");

  const maxPages = maxPagesParam ? Number(maxPagesParam) : undefined;
  const pageSize = pageSizeParam ? Number(pageSizeParam) : undefined;

  try {
    const trades = await getAllHistoricalTradesForTicker(rawTicker, {
      maxPages,
      pageSize,
    });

    return NextResponse.json({ items: trades }, { status: 200 });
  } catch (err: unknown) {
    console.error("T212 trades route error", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Trading212 trades fetch failed",
        message,
      },
      { status: 500 }
    );
  }
}
