// Server-only Yahoo Finance OHLCV fetcher.
// Do NOT import this from client components.

import type { CanonicalRow } from "@/lib/types/canonical";

// ---- Yahoo Finance chart response types ----

interface YahooChartQuote {
  open: (number | null)[];
  high: (number | null)[];
  low: (number | null)[];
  close: (number | null)[];
  volume: (number | null)[];
}

interface YahooChartAdjclose {
  adjclose: (number | null)[];
}

interface YahooChartResult {
  timestamp: number[];
  indicators: {
    quote: YahooChartQuote[];
    adjclose?: YahooChartAdjclose[];
  };
}

interface YahooChartResponse {
  chart: {
    result: YahooChartResult[] | null;
    error: null | { code: string; description: string };
  };
}

// ---- Fetch helper ----

/**
 * Fetch OHLCV candles from Yahoo Finance's v8/finance/chart endpoint.
 * Returns rows in CanonicalRow format, sorted by date ascending.
 */
export async function fetchYahooOhlcv(
  symbol: string,
  options?: { range?: string; interval?: string }
): Promise<CanonicalRow[]> {
  const range = options?.range ?? "5y";
  const interval = options?.interval ?? "1d";

  const url = new URL(
    `/v8/finance/chart/${encodeURIComponent(symbol)}`,
    "https://query2.finance.yahoo.com"
  );
  url.searchParams.set("range", range);
  url.searchParams.set("interval", interval);
  url.searchParams.set("includePrePost", "false");
  // Include dividends & splits info even if we don't fully use it yet
  url.searchParams.set("events", "div,split");
  url.searchParams.set("includeAdjustedClose", "true");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Yahoo Finance request failed: ${res.status} ${res.statusText} – ${text}`
    );
  }

  const data = (await res.json()) as YahooChartResponse;

  if (!data.chart || data.chart.error) {
    throw new Error(
      `Yahoo Finance chart error: ${data.chart?.error?.code ?? "UNKNOWN"} - ${
        data.chart?.error?.description ?? ""
      }`
    );
  }

  const result = data.chart.result?.[0];
  if (!result) {
    return [];
  }

  const { timestamp, indicators } = result;
  const quote = indicators.quote?.[0];
  if (!quote || !timestamp || timestamp.length === 0) {
    return [];
  }

  const adj = indicators.adjclose?.[0];

  const rows: CanonicalRow[] = [];

  for (let i = 0; i < timestamp.length; i++) {
    const ts = timestamp[i];
    const open = quote.open[i];
    const high = quote.high[i];
    const low = quote.low[i];
    const close = quote.close[i];
    const volume = quote.volume[i];
    const adjClose = adj?.adjclose?.[i] ?? close;

    // Skip rows with missing key prices
    if (
      open == null ||
      high == null ||
      low == null ||
      close == null ||
      adjClose == null
    ) {
      continue;
    }

    // Convert seconds-since-epoch to YYYY-MM-DD (UTC)
    const date = new Date(ts * 1000);
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const isoDate = `${yyyy}-${mm}-${dd}`;

    const row: CanonicalRow = {
      date: isoDate,
      open,
      high,
      low,
      close,
      adj_close: adjClose,
      volume: volume ?? null,
      split_factor: null,
      cash_dividend: null,
      r: null,
      valid: true,
      issues: [],
    };

    rows.push(row);
  }

  // Sort by date ascending, just to be safe
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return rows;
}
