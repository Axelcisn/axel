import { type Trading212SimBar } from "@/lib/backtest/trading212Cfd";

export type CanonicalRowLite = { date: string; close?: number | null; adj_close?: number | null };

export interface BuildBarsOptions {
  symbol: string;
  rows: CanonicalRowLite[];
  h?: number;
  coverage?: number;
  // Placeholders for future parity with app config (z thresholds, shrinkK, costs)
}

/**
  * Build Trading212 bars with simple signals for smoke tests.
  * Signals mirror the existing smoke-window-sim-rerun logic:
  * - long if price > previous close
  * - short if price < previous close
  * - flat if unchanged or first bar
  */
export function buildBarsWithSignalsForSymbol(opts: BuildBarsOptions): Trading212SimBar[] {
  const { rows } = opts;
  const bars: Trading212SimBar[] = [];
  let prevClose: number | null = null;

  for (const r of rows) {
    const price = (r.adj_close ?? r.close) as number | undefined;
    if (!price || price <= 0 || !r.date) continue;
    let signal: "flat" | "long" | "short" = "flat";
    if (prevClose != null) {
      if (price > prevClose) signal = "long";
      else if (price < prevClose) signal = "short";
    }
    prevClose = price;
    bars.push({ date: r.date, price, signal });
  }

  return bars;
}
