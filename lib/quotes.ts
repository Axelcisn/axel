import { loadCanonicalDataWithMeta } from "@/lib/storage/canonical";
import type { Quote } from "@/lib/types/quotes";

/**
 * Fallback quote provider that derives a quote from canonical OHLC data.
 * TODO: add real-time providers (e.g., IBKR/Yahoo quote) ahead of this fallback.
 */
export async function getQuoteFromCanonical(symbol: string): Promise<Quote> {
  const canonical = await loadCanonicalDataWithMeta(symbol);
  const rows = canonical?.rows ?? [];

  if (!Array.isArray(rows) || rows.length < 1) {
    throw new Error("No canonical data");
  }

  const lastRow = rows[rows.length - 1];
  const prevRow = rows.length >= 2 ? rows[rows.length - 2] : null;

  const lastClose = lastRow?.adj_close ?? lastRow?.close;
  if (lastClose == null) {
    throw new Error("Missing last close");
  }

  const prevClose = prevRow ? prevRow.adj_close ?? prevRow.close : null;
  const change = prevClose != null ? lastClose - prevClose : null;
  const changePct =
    prevClose != null && prevClose !== 0 ? (change! / prevClose) * 100 : null;

  const dateStr = lastRow?.date;
  const asOf =
    dateStr && !Number.isNaN(Date.parse(dateStr))
      ? new Date(dateStr).toISOString()
      : new Date().toISOString();

  return {
    symbol,
    price: lastClose,
    prevClose,
    change,
    changePct,
    currency: "USD",
    asOf,
  };
}
