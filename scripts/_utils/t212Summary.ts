import type { Trading212SimulationResult } from "@/lib/backtest/trading212Cfd";

export type T212Summary = {
  initialEquity: number;
  finalEquity: number;
  returnPct: number;
  cagrPct: number | null;
  maxDrawdownPct: number | null;
  trades: number;
  closedTrades: number;
  openedTrades: number;
  winRatePct: number | null;
  stopOuts: number;
  startDate: string | null;
  endDate: string | null;
  days: number | null;
  years: number | null;
  multiplier: number | null;
};

export function summarizeTrading212Result(result: Trading212SimulationResult): T212Summary {
  const history = result.accountHistory ?? [];
  const tradesList = result.trades ?? [];

  const initialEquity =
    typeof result.initialEquity === "number" && Number.isFinite(result.initialEquity)
      ? result.initialEquity
      : 5000;
  const finalEquity =
    typeof result.finalEquity === "number" && Number.isFinite(result.finalEquity)
      ? result.finalEquity
      : history.length > 0
        ? history[history.length - 1].equity
        : tradesList[tradesList.length - 1]?.closingEquity ?? initialEquity;

  const startDate =
    (result as any).firstDate ??
    (history.length > 0 ? history[0].date ?? null : null);
  const endDate =
    (result as any).lastDate ??
    (history.length > 0 ? history[history.length - 1].date ?? null : null);
  let days: number | null = null;
  if (startDate && endDate) {
    const startMs = Date.parse(startDate);
    const endMs = Date.parse(endDate);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      days = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24));
    }
  }

  const returnPct = initialEquity > 0 ? finalEquity / initialEquity - 1 : 0;

  let cagrPct: number | null = null;
  if (days != null && days >= 30 && initialEquity > 0 && finalEquity > 0) {
    const years = days / 365.25;
    const growth = finalEquity / initialEquity;
    cagrPct = growth > 0 && years > 0 ? Math.pow(growth, 1 / years) - 1 : null;
  }

  const years = days != null && days > 0 ? days / 365.25 : null;
  const multiplier = initialEquity > 0 && finalEquity > 0 ? finalEquity / initialEquity : null;

  const closedTrades = tradesList.length;
  let openedTrades = 0;
  let prevSide: Trading212SimulationResult["accountHistory"][number]["side"] | null = null;
  for (const snap of history) {
    if (snap.side && snap.side !== prevSide) {
      openedTrades++;
    }
    prevSide = snap.side;
  }
  const trades = Math.max(closedTrades, openedTrades);

  const winning = tradesList.filter((t) => (t.netPnl ?? 0) > 0).length;
  const winRatePct = closedTrades > 0 ? winning / closedTrades : null;

  let stopOuts = 0;
  if (Array.isArray(result.stopOutEvents as any)) {
    stopOuts = (result.stopOutEvents as any).length;
  } else if (typeof result.stopOutEvents === "number") {
    stopOuts = result.stopOutEvents;
  } else {
    stopOuts = 0; // no other explicit signal; treat as zero
  }

  const maxDrawdownPct =
    typeof result.maxDrawdown === "number" && Number.isFinite(result.maxDrawdown)
      ? result.maxDrawdown
      : null;

  return {
    initialEquity,
    finalEquity,
    returnPct,
    cagrPct,
    maxDrawdownPct,
    trades,
    closedTrades,
    openedTrades,
    winRatePct,
    stopOuts,
    startDate,
    endDate,
    days,
    years,
    multiplier,
  };
}
