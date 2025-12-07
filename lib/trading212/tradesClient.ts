// Client-safe Trading212 trade types and fetch helpers.
// Safe to import from client components.

import type { Trading212Trade } from "@/lib/backtest/trading212Cfd";

// ---- Simple trade type (matches server-side T212SimpleTrade) ----

export interface T212SimpleTrade {
  id: number;
  ticker: string;
  side: "BUY" | "SELL";
  filledAt: string;
  quantity: number;
  price: number;
  grossValue: number;
  realisedPnl: number;
  currency: string;
}

// ---- Client-side fetch helper ----

/**
 * Fetch trades for a Trading212 ticker via the API route.
 * Safe to call from client components.
 */
export async function fetchT212Trades(
  t212Ticker: string,
  options?: { maxPages?: number; pageSize?: number }
): Promise<T212SimpleTrade[]> {
  const params = new URLSearchParams();
  if (options?.maxPages != null) {
    params.set("maxPages", String(options.maxPages));
  }
  if (options?.pageSize != null) {
    params.set("pageSize", String(options.pageSize));
  }

  const url = `/api/t212/trades/${encodeURIComponent(t212Ticker)}${
    params.toString() ? `?${params.toString()}` : ""
  }`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to fetch T212 trades: ${res.status} – ${text}`);
  }

  const data = await res.json();
  return data.items ?? [];
}

// ---- Overlay type for chart visualization ----

export interface RealTradesOverlay {
  runId: string;
  label: string;
  color: string;
  trades: Trading212Trade[];
}

// ---- Converter to chart overlay format ----

/**
 * Convert an array of T212SimpleTrade into an overlay
 * suitable for PriceChart visualization.
 *
 * Real T212 trades are single fills, not paired entry/exit like simulations.
 * We model each fill as a trade where entry=exit on the same date.
 * BUY = "long" entry marker, SELL = "short" entry marker (representing a close).
 */
export function convertSimpleTradesToOverlay(
  trades: T212SimpleTrade[],
  options?: { runId?: string; label?: string; color?: string }
): RealTradesOverlay {
  const runId = options?.runId ?? "real-trades";
  const label = options?.label ?? "Real Trades";
  const color = options?.color ?? "#10B981"; // emerald-500 for real trades

  const convertedTrades: Trading212Trade[] = trades.map((t) => {
    // Extract just the date portion (YYYY-MM-DD) from ISO datetime
    const dateOnly = t.filledAt.substring(0, 10);

    return {
      entryDate: dateOnly,
      exitDate: dateOnly, // same date for single-fill trades
      side: t.side === "BUY" ? "long" : "short",
      entryPrice: t.price,
      exitPrice: t.price,
      quantity: t.quantity,
      grossPnl: t.realisedPnl,
      swapFees: 0,
      fxFees: 0,
      netPnl: t.realisedPnl,
      margin: t.grossValue, // use gross value as "margin" for display
    } as Trading212Trade;
  });

  return {
    runId,
    label,
    color,
    trades: convertedTrades,
  };
}

// ---- Symbol mapping (client-safe static map) ----

const T212_TICKER_MAP: Record<string, string> = {
  AAPL: "AAPL_US_EQ",
  TSLA: "TSLA_US_EQ",
  MSFT: "MSFT_US_EQ",
  AMD: "AMD_US_EQ",
  NVDA: "NVDA_US_EQ",
  PLTR: "PLTR_US_EQ",
  GOOGL: "GOOGL_US_EQ",
  GOOG: "GOOG_US_EQ",
  AMZN: "AMZN_US_EQ",
  META: "META_US_EQ",
  NFLX: "NFLX_US_EQ",
  INTC: "INTC_US_EQ",
  CRM: "CRM_US_EQ",
  ORCL: "ORCL_US_EQ",
  CSCO: "CSCO_US_EQ",
  ADBE: "ADBE_US_EQ",
  PYPL: "PYPL_US_EQ",
  UBER: "UBER_US_EQ",
  ABNB: "ABNB_US_EQ",
  COIN: "COIN_US_EQ",
  SQ: "SQ_US_EQ",
  SHOP: "SHOP_US_EQ",
  SNOW: "SNOW_US_EQ",
  DDOG: "DDOG_US_EQ",
  NET: "NET_US_EQ",
  CRWD: "CRWD_US_EQ",
  ZS: "ZS_US_EQ",
  MDB: "MDB_US_EQ",
  PANW: "PANW_US_EQ",
  NOW: "NOW_US_EQ",
};


/**
 * Map a canonical symbol to its Trading212 ticker.
 * Returns null if no mapping exists.
 */
export function mapSymbolToT212Ticker(symbol: string): string | null {
  const upper = symbol.toUpperCase();
  return T212_TICKER_MAP[upper] ?? null;
}

/**
 * Check if a symbol has a Trading212 mapping.
 */
export function hasT212Mapping(symbol: string): boolean {
  return mapSymbolToT212Ticker(symbol) !== null;
}

// ---- Paired Trade Types (client-safe re-export) ----

export interface T212PairedTrade {
  id: string;
  ticker: string;
  side: "long" | "short";
  entryDate: string;
  exitDate: string | null;
  quantity: number;
  entryPrice: number;
  exitPrice: number | null;
  realisedPnl: number | null;
  currency: string;
  entryFillIds: number[];
  exitFillIds: number[];
}

export interface PairedTradesSummary {
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  totalPnl: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
}

export interface PairedTradesResponse {
  ticker: string;
  rawFillCount: number;
  pairedTrades: T212PairedTrade[];
  summary: PairedTradesSummary;
}

/**
 * Fetch FIFO-paired trades for a Trading212 ticker via the API route.
 * Safe to call from client components.
 */
export async function fetchT212PairedTrades(
  t212Ticker: string,
  options?: { maxPages?: number; pageSize?: number }
): Promise<PairedTradesResponse> {
  const params = new URLSearchParams();
  if (options?.maxPages != null) {
    params.set("maxPages", String(options.maxPages));
  }
  if (options?.pageSize != null) {
    params.set("pageSize", String(options.pageSize));
  }

  const url = `/api/t212/trades/${encodeURIComponent(t212Ticker)}/paired${
    params.toString() ? `?${params.toString()}` : ""
  }`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to fetch T212 paired trades: ${res.status} – ${text}`);
  }

  return res.json();
}
