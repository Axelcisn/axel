import {
  simulateTrading212Cfd,
  type Trading212CfdConfig,
  type Trading212SimBar,
  type Trading212SimulationResult,
  type Trading212Signal,
} from "./trading212Cfd";

export type WindowSimResult = {
  firstTradeDate: string | null;
  lastCloseDate: string | null;
  result: Trading212SimulationResult | null;
  bars: Trading212SimBar[];
};

const signalToInt = (signal: Trading212Signal): number => {
  if (signal === "flat") return 0;
  return 1;
};

export function computeFirstTradeDateFromSignals(
  bars: Trading212SimBar[],
  window: { start: string; end: string } | null,
  strategyStart?: string | null
): string | null {
  if (!window) return null;
  const windowStart = strategyStart ? (strategyStart > window.start ? strategyStart : window.start) : window.start;
  const inWindow = bars.filter((b) => b.date >= windowStart && b.date <= window.end);
  if (inWindow.length === 0) return null;

  let prevSignal = 0;

  for (let i = 0; i < inWindow.length; i++) {
    const currSignal = signalToInt(inWindow[i].signal);
    const isFirstBar = i === 0;

    // Carry-in: first bar non-flat => no clean restart
    if (isFirstBar && currSignal !== 0) {
      prevSignal = currSignal;
      continue;
    }

    if (prevSignal === 0 && currSignal !== 0) {
      return inWindow[i].date;
    }

    prevSignal = currSignal;
  }

  return null;
}

export function computeLastCloseDateFromSignals(
  bars: Trading212SimBar[],
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
  bars: Trading212SimBar[],
  window: { start: string; end: string } | null,
  initialEquity: number,
  config: Trading212CfdConfig,
  strategyStart?: string | null
): WindowSimResult {
  if (!window || !bars.length) {
    return { firstTradeDate: null, lastCloseDate: null, result: null, bars: [] };
  }

  const firstTradeDate = computeFirstTradeDateFromSignals(bars, window, strategyStart);
  if (!firstTradeDate) {
    return { firstTradeDate: null, lastCloseDate: null, result: null, bars: [] };
  }

  const lastCloseDate = computeLastCloseDateFromSignals(bars, window, strategyStart);
  if (!lastCloseDate || firstTradeDate > lastCloseDate) {
    return { firstTradeDate: null, lastCloseDate: null, result: null, bars: [] };
  }

  const barsWindow = bars.filter((b) => b.date >= firstTradeDate && b.date <= lastCloseDate);
  if (barsWindow.length === 0) {
    return { firstTradeDate: null, lastCloseDate: null, result: null, bars: [] };
  }

  const result = simulateTrading212Cfd(barsWindow, initialEquity, config);
  return {
    firstTradeDate,
    lastCloseDate,
    result,
    bars: barsWindow,
  };
}
