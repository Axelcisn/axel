import type { Trading212AccountSnapshot } from "./trading212Cfd";

export interface SimulationEquityPoint {
  date: string;
  equity: number | null;
  equityDelta: number | null;
  marginUsed?: number | null;
  freeMargin?: number | null;
  selectedPnl?: number | null;
  selectedEquity?: number | null;
  selectedSide?: Trading212AccountSnapshot["side"] | null;
  selectedContracts?: number | null;
}

export interface TradeActivityWindow {
  activityStartDate: string | null;
  activityEndDate: string | null;
}

/**
 * Derive the first open and last close dates within a windowed account history.
 * Uses side transitions, including the side before the window, to detect opens/closes.
 */
export function computeTradeActivityWindow(
  history: Trading212AccountSnapshot[],
  prevSideBefore: Trading212AccountSnapshot["side"] | null
): TradeActivityWindow {
  if (!history || history.length === 0) {
    return { activityStartDate: null, activityEndDate: null };
  }

  let activityStartDate: string | null = null;
  let activityEndDate: string | null = null;
  let prevSide: Trading212AccountSnapshot["side"] | null = prevSideBefore ?? null;

  for (let i = 0; i < history.length; i++) {
    const snap = history[i];
    const currentSide = snap.side;

    // First open: prev flat -> now positioned
    if (activityStartDate == null && currentSide != null && prevSide == null) {
      activityStartDate = snap.date;
    }

    // Close: prev positioned -> now flat
    if (currentSide == null && prevSide != null) {
      activityEndDate = snap.date;
    }

    prevSide = currentSide;
  }

  // If still open at the end of the window, extend end date to the last snapshot
  if (prevSide != null) {
    activityEndDate = history[history.length - 1].date;
  }

  if (!activityStartDate) {
    return { activityStartDate: null, activityEndDate: null };
  }

  return { activityStartDate, activityEndDate: activityEndDate ?? activityStartDate };
}

/**
 * Mask an equity series so values only appear within the activity window.
 * Outside the window all values are null. Δ is recomputed using in-window points only.
 */
export function applyActivityMaskToEquitySeries(
  series: SimulationEquityPoint[],
  activityStartDate: string | null,
  activityEndDate: string | null
): SimulationEquityPoint[] {
  if (!activityStartDate || !activityEndDate) {
    return series.map((pt) => ({
      ...pt,
      equity: null,
      equityDelta: null,
      marginUsed: null,
      freeMargin: null,
    }));
  }

  let lastEquityInWindow: number | null = null;

  return series.map((pt) => {
    const inWindow = pt.date >= activityStartDate && pt.date <= activityEndDate;
    if (!inWindow) {
      return {
        ...pt,
        equity: null,
        equityDelta: null,
        marginUsed: null,
        freeMargin: null,
      };
    }

    const equity = pt.equity != null ? pt.equity : null;
    const equityDelta =
      equity != null && lastEquityInWindow != null ? equity - lastEquityInWindow : null;

    if (equity != null) {
      lastEquityInWindow = equity;
    }

    return {
      ...pt,
      equity,
      equityDelta,
      marginUsed: pt.marginUsed ?? null,
      freeMargin: pt.freeMargin ?? null,
    };
  });
}
