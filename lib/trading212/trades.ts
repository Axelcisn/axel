// Trading212 trade history helpers – flattens paginated order+fill data into simple trades.
// Server-only. Do NOT import from client components.

import {
  getHistoricalOrders,
  T212HistoricalOrder,
  T212OrderSide,
} from "@/lib/trading212/client";

// ---- Simple trade type ----

export interface T212SimpleTrade {
  id: number; // fill id (unique per fill)
  ticker: string; // Trading212 ticker, e.g. TSLA_US_EQ
  side: T212OrderSide; // "BUY" | "SELL"
  filledAt: string; // ISO datetime from fill
  quantity: number;
  price: number;
  grossValue: number; // price * quantity
  realisedPnl: number; // realised P&L from walletImpact
  currency: string; // walletImpact currency
}

// ---- Pagination helper ----

/**
 * Fetch all historical trades for a given Trading212 ticker,
 * aggregating across all pages via nextPagePath.
 */
export async function getAllHistoricalTradesForTicker(
  ticker: string,
  options?: { maxPages?: number; pageSize?: number }
): Promise<T212SimpleTrade[]> {
  const maxPages = options?.maxPages ?? 10;
  const pageSize = options?.pageSize ?? 50; // T212 API max is 50

  const trades: T212SimpleTrade[] = [];
  let cursorPath: string | undefined = undefined;

  for (let page = 0; page < maxPages; page++) {
    const response = await getHistoricalOrders({
      limit: pageSize,
      cursorPath,
      ticker, // let the API filter by ticker if it supports that
    });

    const items = response.items ?? [];

    for (const item of items) {
      const simple = convertHistoricalOrderToSimpleTrade(item);
      if (simple) {
        trades.push(simple);
      }
    }

    if (!response.nextPagePath) {
      break;
    }

    cursorPath = response.nextPagePath;
  }

  // Sort by filledAt ascending
  trades.sort((a, b) =>
    a.filledAt < b.filledAt ? -1 : a.filledAt > b.filledAt ? 1 : 0
  );

  return trades;
}

// ---- Converter ----

/**
 * Convert a T212HistoricalOrder (order + fill) into a simplified T212SimpleTrade.
 * Returns null if essential fields are missing.
 */
function convertHistoricalOrderToSimpleTrade(
  item: T212HistoricalOrder
): T212SimpleTrade | null {
  const { order, fill } = item;
  if (!order || !fill) {
    return null;
  }

  const price = fill.price;
  const quantity = fill.quantity;

  if (price == null || quantity == null) {
    return null;
  }

  const grossValue = price * quantity;
  const wallet = fill.walletImpact;
  const currency = wallet?.currency ?? order.currency;
  const realisedPnl = wallet?.realisedProfitLoss ?? 0;

  const simple: T212SimpleTrade = {
    id: fill.id, // use fill id as unique trade id
    ticker: order.ticker,
    side: order.side,
    filledAt: fill.filledAt,
    quantity,
    price,
    grossValue,
    realisedPnl,
    currency,
  };

  return simple;
}
