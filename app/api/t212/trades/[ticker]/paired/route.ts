import { NextResponse } from "next/server";
import { getHistoricalOrders } from "@/lib/trading212/client";
import { pairTrades, summarizePairedTrades } from "@/lib/trading212/tradePairer";
import type { T212SimpleTrade } from "@/lib/trading212/tradesClient";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ ticker: string }>;
}

/**
 * GET /api/t212/trades/[ticker]/paired
 * 
 * Returns FIFO-paired trades for a Trading212 ticker.
 * Converts raw BUY/SELL fills into entry/exit trades with P&L.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const { ticker } = await params;

  if (!ticker) {
    return NextResponse.json(
      { error: "Missing ticker parameter" },
      { status: 400 }
    );
  }

  const url = new URL(request.url);
  const maxPages = parseInt(url.searchParams.get("maxPages") ?? "10", 10);
  const pageSize = parseInt(url.searchParams.get("pageSize") ?? "50", 10); // T212 API max is 50

  try {
    // Fetch all historical orders, paginated
    const allFills: T212SimpleTrade[] = [];
    let cursorPath: string | undefined;

    for (let page = 0; page < maxPages; page++) {
      const result = await getHistoricalOrders({
        ticker,
        limit: pageSize,
        cursorPath,
      });

      // Convert raw historical orders to T212SimpleTrade format
      // T212HistoricalOrder has nested { order, fill } structure
      for (const item of result.items) {
        const { order, fill } = item;
        
        // Only include orders for this ticker that have fills
        if (order.ticker === ticker && order.status === "FILLED" && fill) {
          allFills.push({
            id: fill.id,
            ticker: order.ticker,
            side: order.side as "BUY" | "SELL",
            filledAt: fill.filledAt,
            quantity: fill.quantity,
            price: fill.price,
            grossValue: order.filledValue ?? 0,
            realisedPnl: fill.walletImpact?.realisedProfitLoss ?? 0,
            currency: order.currency,
          });
        }
      }

      // Extract cursor from nextPagePath if present
      cursorPath = result.nextPagePath ?? undefined;
      if (!cursorPath) break;
    }

    // Pair the trades using FIFO
    const pairedTrades = pairTrades(allFills);
    const summary = summarizePairedTrades(pairedTrades);

    return NextResponse.json({
      ticker,
      rawFillCount: allFills.length,
      pairedTrades,
      summary,
    });
  } catch (err) {
    console.error("Error fetching/pairing T212 trades:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch or pair trades",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
