import {
  simulateCfd,
  type CfdSimConfig,
  type CfdSimBar,
  type CfdSimulationResult,
  type CfdSignal,
} from "./cfdSim";

export type FirstTradeReason =
  | "boundary_open_detected"
  | "in_window_transition"
  | "carry_in_at_start"
  | "no_bars_in_window"
  | "no_clean_open"
  | null;

export type WindowSimResult = {
  firstTradeDate: string | null;
  firstTradeReason?: FirstTradeReason;
  lastCloseDate: string | null;
  result: CfdSimulationResult | null;
  bars: CfdSimBar[];
};

const signalToInt = (signal: CfdSignal): number => {
  if (signal === "flat") return 0;
  return 1;
};

export function computeFirstTradeDateFromSignals(
  bars: CfdSimBar[],
  window: { start: string; end: string } | null,
  strategyStart?: string | null
): { date: string | null; reason: FirstTradeReason } {
  if (!window) return { date: null, reason: null };
  if (!bars.length) return { date: null, reason: null };

  const windowStart = strategyStart ? (strategyStart > window.start ? strategyStart : window.start) : window.start;
  const windowEnd = window.end;

  // Sort defensively to ensure chronological order
  const sorted = [...bars].sort((a, b) => a.date.localeCompare(b.date));

  const strategyStartIdx = strategyStart
    ? sorted.findIndex((b) => b.date >= strategyStart)
    : 0;

  // First bar inside the window
  const startIdx = sorted.findIndex((b) => b.date >= windowStart && b.date <= windowEnd);
  if (startIdx === -1) {
    return { date: null, reason: "no_bars_in_window" };
  }

  const firstBar = sorted[startIdx];
  const firstSignal = signalToInt(firstBar.signal);
  let prevSignal = 0;
  let scanIdx = startIdx;

  if (firstSignal !== 0) {
    const prevIdx = startIdx - 1;
    const strategyFloor = strategyStartIdx === -1 ? 0 : strategyStartIdx;
    const hasPrev = prevIdx >= strategyFloor;
    const prevSignalVal = prevIdx >= 0 ? signalToInt(sorted[prevIdx].signal) : null;

    // Boundary clean-open: first bar non-flat, previous day (within strategy start) flat
    if (hasPrev && prevSignalVal === 0) {
      return { date: firstBar.date, reason: "boundary_open_detected" };
    }

    // Treat as carry-in; continue scanning for the next clean transition inside the window
    prevSignal = firstSignal;
    scanIdx = startIdx + 1;
  }

  for (let i = scanIdx; i < sorted.length; i++) {
    const bar = sorted[i];
    if (bar.date < windowStart) continue;
    if (bar.date > windowEnd) break;

    const currSignal = signalToInt(bar.signal);
    if (prevSignal === 0 && currSignal !== 0) {
      return { date: bar.date, reason: "in_window_transition" };
    }

    prevSignal = currSignal;
  }

  return { date: null, reason: firstSignal !== 0 ? "carry_in_at_start" : "no_clean_open" };
}

export function computeLastCloseDateFromSignals(
  bars: CfdSimBar[],
  window: { start: string; end: string } | null,
  strategyStart?: string | null
): string | null {
  if (!window) return null;
  const windowStart = strategyStart ? (strategyStart > window.start ? strategyStart : window.start) : window.start;
  const inWindow = bars.filter((b) => b.date >= windowStart && b.date <= window.end);
  if (inWindow.length === 0) return null;

  let prevSignal = 0;
  let lastClose: string | null = null;

  for (let i = 0; i < inWindow.length; i++) {
    const currSignal = signalToInt(inWindow[i].signal);
    const isFirstBar = i === 0;

    // Carry-in
    if (isFirstBar && currSignal !== 0) {
      prevSignal = currSignal;
      continue;
    }

    if (prevSignal !== 0 && currSignal === 0) {
      lastClose = inWindow[i].date;
    }

    prevSignal = currSignal;
  }

  // If still non-flat at the end, extend to window end
  const lastSignal = signalToInt(inWindow[inWindow.length - 1].signal);
  if (lastSignal !== 0) {
    lastClose = window.end;
  }

  return lastClose;
}

export function computeWindowSimFromBars(
  bars: CfdSimBar[],
  window: { start: string; end: string } | null,
  initialEquity: number,
  config: CfdSimConfig,
  strategyStart?: string | null
): WindowSimResult {
  if (!window || !bars.length) {
    return { firstTradeDate: null, lastCloseDate: null, result: null, bars: [] };
  }

  const { date: firstTradeDate, reason: firstTradeReason } = computeFirstTradeDateFromSignals(
    bars,
    window,
    strategyStart
  );
  if (!firstTradeDate) {
    return { firstTradeDate: null, firstTradeReason, lastCloseDate: null, result: null, bars: [] };
  }

  const lastCloseDate = computeLastCloseDateFromSignals(bars, window, strategyStart);
  if (!lastCloseDate || firstTradeDate > lastCloseDate) {
    return { firstTradeDate: null, firstTradeReason, lastCloseDate: null, result: null, bars: [] };
  }

  const barsWindow = bars.filter((b) => b.date >= firstTradeDate && b.date <= lastCloseDate);
  if (barsWindow.length === 0) {
    return { firstTradeDate: null, firstTradeReason, lastCloseDate: null, result: null, bars: [] };
  }

  const result = simulateCfd(barsWindow, initialEquity, config);
  return {
    firstTradeDate,
    firstTradeReason,
    lastCloseDate,
    result,
    bars: barsWindow,
  };
}
