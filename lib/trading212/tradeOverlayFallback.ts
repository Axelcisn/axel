import type { Trading212Trade } from "@/lib/backtest/trading212Cfd";
import type { WindowSimResult } from "@/lib/backtest/windowSim";

export type TradeOverlaySource = "windowSim" | "globalFallback";

function overlapsWindow(
  trade: Trading212Trade,
  window: { start: string; end: string } | null
): boolean {
  if (!window) return true;
  const tradeStart = trade.entryDate;
  const tradeEnd = trade.exitDate;
  return tradeStart <= window.end && tradeEnd >= window.start;
}

export function selectTradesForChartMarkers(params: {
  windowResult?: WindowSimResult | null;
  globalTrades: Trading212Trade[];
  visibleWindow: { start: string; end: string } | null;
  strategyStartDate?: string | null;
}): { trades: Trading212Trade[]; source: TradeOverlaySource } {
  const windowTrades = params.windowResult?.result?.trades;
  if (windowTrades) {
    return { trades: windowTrades, source: "windowSim" };
  }

  const strategyStart = params.strategyStartDate ?? null;
  const filtered = params.globalTrades.filter((t) => {
    if (strategyStart && t.entryDate < strategyStart) return false;
    return overlapsWindow(t, params.visibleWindow);
  });

  return { trades: filtered, source: "globalFallback" };
}

