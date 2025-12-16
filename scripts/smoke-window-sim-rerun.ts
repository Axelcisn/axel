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

type CanonicalRowLite = { date: string; close?: number | null; adj_close?: number | null };

const DEFAULT_SYMBOLS = ["ZBRA", "ODFL", "PAYX", "KR", "CMI"];
const VISIBLE_DAYS = 63;
const INITIAL_EQUITY = 10_000;

async function loadCanonical(symbol: string): Promise<CanonicalRowLite[]> {
  const { rows } = await ensureCanonicalOrHistory(symbol, { interval: "1d", minRows: VISIBLE_DAYS + 1 });
  return rows.map((r) => ({ date: r.date, close: r.close, adj_close: r.adj_close }));
}

function buildBars(rows: CanonicalRowLite[]): Trading212SimBar[] {
  const bars: Trading212SimBar[] = [];
  let prevClose: number | null = null;
  for (const r of rows) {
    const price = (r.adj_close ?? r.close) as number | undefined;
    if (!price || price <= 0 || !r.date) continue;
    let signal: "flat" | "long" | "short" = "flat";
    if (prevClose != null) {
      if (price > prevClose) {
        signal = "long";
      } else if (price < prevClose) {
        signal = "short";
      }
    }
    prevClose = price;
    bars.push({ date: r.date, price, signal });
  }
  return bars;
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
  const arg = process.argv.find((a) => a.startsWith("--symbols="));
  const symbols = arg ? arg.replace("--symbols=", "").split(",") : DEFAULT_SYMBOLS;

  const config: Trading212CfdConfig = {
    leverage: 5,
    fxFeeRate: 0,
    dailyLongSwapRate: 0,
    dailyShortSwapRate: 0,
    spreadBps: 0,
    marginCallLevel: 0.45,
    stopOutLevel: 0.25,
    positionFraction: 0.25,
  };

  for (const sym of symbols) {
    const rows = (await loadCanonical(sym.toUpperCase())).sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length < VISIBLE_DAYS + 1) {
      console.log(`${sym}: SKIP (not enough rows)`);
      continue;
    }
    const windowRows = rows.slice(-VISIBLE_DAYS);
    const window = { start: windowRows[0].date, end: windowRows[windowRows.length - 1].date };
    const bars = buildBars(rows);

    const firstTradeDate = computeFirstTradeDateFromSignals(bars, window, null);
    const lastCloseDate = computeLastCloseDateFromSignals(bars, window, null);
    const windowSim = computeWindowSimFromBars(bars, window, INITIAL_EQUITY, config, null);

    console.log(`\n=== ${sym} ===`);
    console.log({ window, firstTradeDate, lastCloseDate, trades: windowSim.result?.trades.length ?? 0 });

    if (!windowSim.result || !firstTradeDate || !lastCloseDate) {
      console.log("No window sim (carry-in or no trades in window)");
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
    assert(afterEnd.every((p) => p.equity == null), `${sym}: equity not null after lastCloseDate`);
    assert(windowSim.result.trades.length > 0, `${sym}: expected trades inside window`);

    console.log("PASS");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
