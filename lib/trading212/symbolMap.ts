// lib/trading212/symbolMap.ts
// Maps canonical symbols (e.g. "AAPL") to Trading212 tickers (e.g. "AAPL_US_EQ").

/**
 * Static map from canonical symbol to Trading212 ticker.
 * For now this is a small static map; we can later build this from T212 metadata.
 */
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
  // Add more symbols as needed
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
 * Reverse map: Trading212 ticker to canonical symbol.
 * Returns null if no mapping exists.
 */
export function mapT212TickerToSymbol(t212Ticker: string): string | null {
  const upper = t212Ticker.toUpperCase();
  for (const [symbol, ticker] of Object.entries(T212_TICKER_MAP)) {
    if (ticker.toUpperCase() === upper) {
      return symbol;
    }
  }
  return null;
}

/**
 * Check if a symbol has a Trading212 mapping.
 */
export function hasT212Mapping(symbol: string): boolean {
  return mapSymbolToT212Ticker(symbol) !== null;
}
