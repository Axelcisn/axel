/**
 * Smoke test for windowed Trading212 sim re-run logic.
 *
 * Run:
 *   npx tsc --noEmit
 *   npx tsx scripts/smoke-window-sim-rerun.ts --symbols=EMR,ITW,PNR,CDW,RSG
 */

import { applyActivityMaskToEquitySeries, computeTradeActivityWindow } from "../lib/backtest/equityActivity";
import {
  computeWindowSimFromBars,
  computeFirstTradeDateFromSignals,
  computeLastCloseDateFromSignals,
} from "../lib/backtest/windowSim";
import {
  simulateTrading212Cfd,
  type Trading212CfdConfig,
  type Trading212SimBar,
  type Trading212SimulationResult,
} from "../lib/backtest/trading212Cfd";
import { ensureCanonicalOrHistory } from "@/lib/storage/canonical";
import { buildBarsWithSignalsForSymbol, type CanonicalRowLite } from "./_utils/buildBarsWithSignals";

const DEFAULT_SYMBOLS = ["ZBRA", "ODFL", "PAYX", "KR", "CMI"];
const DEFAULT_LOOKBACK_BARS = 252;
const DEFAULT_CONTEXT_BARS = 63;
const DEFAULT_MIN_TRADES = 1;
const INITIAL_EQUITY = 10_000;

function getArgValue(key: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${key}=`));
  return hit ? hit.slice(key.length + 3) : null;
}

function parseBoolArg(key: string, defaultValue: boolean): boolean {
  const raw = getArgValue(key);
  if (raw == null) return defaultValue;
  return raw !== "false" && raw !== "0";
}

function parseNumberArg(key: string, defaultValue: number): number {
  const raw = getArgValue(key);
  if (raw == null) return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultValue;
}

function parseSymbolsArg(defaultSymbols: string[]): string[] {
  const raw = getArgValue("symbols");
  if (!raw) return defaultSymbols;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

async function loadCanonical(symbol: string, minRows: number): Promise<CanonicalRowLite[]> {
  const { rows } = await ensureCanonicalOrHistory(symbol, { interval: "1d", minRows });
  return rows.map((r) => ({ date: r.date, close: r.close, adj_close: r.adj_close }));
}

function alignAndMask(
  sim: Trading212SimulationResult,
  window: { start: string; end: string }
): { series: { date: string; equity: number | null }[]; activityStart: string | null; activityEnd: string | null } {
  const dates = sim.accountHistory
    .map((h) => h.date)
    .filter((d) => d >= window.start && d <= window.end);
  const dateSet = new Set(dates);
  const seriesDates = Array.from(dateSet).sort();

  const equityMap = new Map<string, { equity: number; marginUsed: number; freeMargin: number }>();
  sim.accountHistory.forEach((h) => {
    equityMap.set(h.date, {
      equity: h.equity,
      marginUsed: h.marginUsed,
      freeMargin: h.freeMargin ?? h.equity - h.marginUsed,
    });
  });

  let lastEquity: number | null = null;
  let lastMargin: number | null = null;
  let lastFree: number | null = null;
  const baseSeries = seriesDates.map((date) => {
    const hit = equityMap.get(date);
    const equity = hit?.equity ?? lastEquity;
    const marginUsed = hit?.marginUsed ?? lastMargin ?? 0;
    const freeMargin = hit?.freeMargin ?? (equity != null ? equity - marginUsed : lastFree);
    if (equity != null) lastEquity = equity;
    if (marginUsed != null) lastMargin = marginUsed;
    if (freeMargin != null) lastFree = freeMargin;
    return { date, equity, equityDelta: null, marginUsed, freeMargin };
  });

  const { activityStartDate, activityEndDate } = computeTradeActivityWindow(
    sim.accountHistory,
    null
  );
  const masked = applyActivityMaskToEquitySeries(baseSeries, activityStartDate, activityEndDate);

  return {
    series: masked.map((m) => ({ date: m.date, equity: m.equity })),
    activityStart: activityStartDate,
    activityEnd: activityEndDate,
  };
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const symbols = parseSymbolsArg(DEFAULT_SYMBOLS);
  const scanOpen = parseBoolArg("scanOpen", true);
  const lookbackBars = parseNumberArg("lookbackBars", DEFAULT_LOOKBACK_BARS);
  const contextBars = parseNumberArg("contextBars", DEFAULT_CONTEXT_BARS);
  const minTrades = parseNumberArg("minTrades", DEFAULT_MIN_TRADES);
  const spreadBps = parseNumberArg("spreadBps", 0);

  const config: Trading212CfdConfig = {
    leverage: 5,
    fxFeeRate: 0,
    dailyLongSwapRate: 0,
    dailyShortSwapRate: 0,
    spreadBps,
    marginCallLevel: 0.45,
    stopOutLevel: 0.25,
    positionFraction: 0.25,
  };

  for (const sym of symbols) {
    console.log(`\n=== ${sym} ===`);

    const minRows = Math.max(lookbackBars + contextBars + 1, 2);
    const rows = (await loadCanonical(sym.toUpperCase(), minRows)).sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length < 2) {
      console.log("No clean open in lookback range");
      console.log("NO CLEAN OPEN FOUND");
      continue;
    }

    const bars = buildBarsWithSignalsForSymbol({ symbol: sym, rows });
    if (bars.length < 2) {
      console.log("No clean open in lookback range");
      console.log("NO CLEAN OPEN FOUND");
      continue;
    }

    const lastIdx = bars.length - 1;
    const scanStartIdx = Math.max(bars.length - lookbackBars, 1);
    const scanRange = { start: bars[Math.min(scanStartIdx, lastIdx)].date, end: bars[lastIdx].date };

    if (!scanOpen) {
      const windowStartIdx = Math.max(bars.length - contextBars, 0);
      const windowEndIdx = lastIdx;
      const window = { start: bars[windowStartIdx].date, end: bars[windowEndIdx].date };
      const windowSim = computeWindowSimFromBars(bars, window, INITIAL_EQUITY, config, null);
      const firstTradeDate = windowSim.firstTradeDate;
      const lastCloseDate = windowSim.lastCloseDate;
      const trades = windowSim.result?.trades.length ?? 0;

      console.log({
        mode: "direct-window",
        scanRange,
        window,
        firstTradeDate,
        lastCloseDate,
        trades,
      });

      if (!windowSim.result || !firstTradeDate || !lastCloseDate) {
        console.log(firstTradeDate ? "Open found but no close found (still allowed: lastCloseDate=windowEnd)" : "No clean open in lookback range");
        continue;
      }

      const firstSnap = windowSim.result.accountHistory[0];
      assert(
        Math.abs(firstSnap.equity - INITIAL_EQUITY) < 1e-6,
        `${sym}: equity at firstTradeDate not equal to initialEquity`
      );

      const masked = alignAndMask(windowSim.result, window);
      const beforeStart = masked.series.filter((p) => p.date < firstTradeDate);
      const afterEnd = masked.series.filter((p) => p.date > lastCloseDate);
      assert(
        beforeStart.every((p) => p.equity == null),
        `${sym}: equity not null before firstTradeDate`
      );
      assert(afterEnd.every((p) => p.equity == null), `${sym}: equity not null after lastCloseDate`);
      assert(trades >= minTrades, `${sym}: expected at least ${minTrades} trades inside window`);

      console.log("PASS");
      continue;
    }

    let firstOpenIdx: number | null = null;
    for (let i = lastIdx; i >= scanStartIdx; i--) {
      const prevSignal = bars[i - 1]?.signal ?? "flat";
      const currSignal = bars[i].signal;
      if (currSignal !== "flat" && prevSignal === "flat") {
        firstOpenIdx = i;
        break;
      }
    }

    if (firstOpenIdx == null) {
      console.log(`scanRange=${scanRange.start}..${scanRange.end}`);
      console.log("No clean open in lookback range");
      console.log("NO CLEAN OPEN FOUND");
      continue;
    }

    const windowStartIdx = Math.max(firstOpenIdx - contextBars, 0);
    const windowEndIdx = Math.min(firstOpenIdx + contextBars, lastIdx);
    const window = { start: bars[windowStartIdx].date, end: bars[windowEndIdx].date };

    let lastCloseIdx: number | null = null;
    for (let i = firstOpenIdx + 1; i <= windowEndIdx; i++) {
      const prevSignal = bars[i - 1].signal;
      const currSignal = bars[i].signal;
      if (prevSignal !== "flat" && currSignal === "flat") {
        lastCloseIdx = i;
      }
    }

    const { date: firstTradeDate } = computeFirstTradeDateFromSignals(bars, window, null);
    const lastCloseDate = computeLastCloseDateFromSignals(bars, window, null);
    const windowSim = computeWindowSimFromBars(bars, window, INITIAL_EQUITY, config, null);

    const trades = windowSim.result?.trades.length ?? 0;
    const openCloseNote =
      lastCloseIdx == null ? "Open found but no close found (still allowed: lastCloseDate=windowEnd)" : null;

    console.log({
      scanRange,
      window,
      firstOpenIdx,
      firstTradeDate,
      lastCloseIdx,
      lastCloseDate,
      trades,
    });

    if (!windowSim.result || !firstTradeDate || !lastCloseDate) {
      const startSignal = bars[windowStartIdx].signal;
      const reason =
        startSignal !== "flat"
          ? "Carry-in detected at windowStart (strict policy)"
          : "No clean open in lookback range";
      console.log(reason);
      if (openCloseNote && firstTradeDate) {
        console.log(openCloseNote);
      }
      continue;
    }

    // Assertions
    const firstSnap = windowSim.result.accountHistory[0];
    assert(
      Math.abs(firstSnap.equity - INITIAL_EQUITY) < 1e-6,
      `${sym}: equity at firstTradeDate not equal to initialEquity`
    );

    const masked = alignAndMask(windowSim.result, window);
    const beforeStart = masked.series.filter((p) => p.date < firstTradeDate);
    const afterEnd = masked.series.filter((p) => p.date > lastCloseDate);
    assert(
      beforeStart.every((p) => p.equity == null),
      `${sym}: equity not null before firstTradeDate`
    );
    if (lastCloseIdx != null) {
      assert(afterEnd.every((p) => p.equity == null), `${sym}: equity not null after lastCloseDate`);
    }
    assert(trades >= minTrades, `${sym}: expected at least ${minTrades} trades inside window`);

    console.log(
      `${sym} scan=${scanRange.start}..${scanRange.end} window=${window.start}..${window.end} firstTradeDate=${firstTradeDate} lastCloseDate=${lastCloseDate} trades=${trades} ${openCloseNote ?? ""
      }`
    );
    console.log("PASS\n");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
