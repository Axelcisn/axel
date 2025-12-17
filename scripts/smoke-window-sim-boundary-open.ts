/**
 * Smoke test for windowSim boundary clean-open detection.
 *
 * Before the boundary fix, a non-flat signal on window start was treated as
 * carry-in and firstTradeDate stayed null. This script ensures the new
 * logic treats a flat->non-flat transition at the boundary as a valid entry.
 *
 * Run:
 *   npx tsx scripts/smoke-window-sim-boundary-open.ts
 */

import {
  computeWindowSimFromBars,
  type FirstTradeReason,
  type WindowSimResult,
} from "@/lib/backtest/windowSim";
import { type Trading212CfdConfig, type Trading212SimBar } from "@/lib/backtest/trading212Cfd";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(msg);
  }
}

function buildSyntheticBars(): Trading212SimBar[] {
  const dates = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-06"];
  const signals: Trading212SimBar["signal"][] = ["flat", "long", "long", "flat", "flat", "flat"];

  return dates.map((date, idx) => ({
    date,
    price: 100 + idx, // simple monotone prices
    signal: signals[idx],
  }));
}

function runBoundarySmoke(): WindowSimResult {
  const bars = buildSyntheticBars();
  const window = { start: "2024-01-02", end: "2024-01-06" };
  const strategyStart = "2024-01-01";
  const initialEquity = 10_000;
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

  const windowSim = computeWindowSimFromBars(bars, window, initialEquity, config, strategyStart);

  // Expect boundary open at d2 with a clean close at d4
  assert(windowSim.firstTradeDate === "2024-01-02", `Unexpected firstTradeDate: ${windowSim.firstTradeDate}`);
  assert(windowSim.firstTradeReason === "boundary_open_detected", `Unexpected firstTradeReason: ${windowSim.firstTradeReason}`);
  assert(windowSim.lastCloseDate === "2024-01-04", `Unexpected lastCloseDate: ${windowSim.lastCloseDate}`);
  assert(windowSim.result, "Expected a simulation result");
  assert(windowSim.result.trades.length > 0, "Expected at least one trade in the window");

  const firstSnap = windowSim.result.accountHistory[0];
  assert(firstSnap?.date === windowSim.firstTradeDate, "Account history should start at firstTradeDate");
  assert(
    Math.abs(firstSnap.equity - initialEquity) < 1e-6,
    `Equity at firstTradeDate not equal to initialEquity (${firstSnap?.equity})`
  );

  return windowSim;
}

function main() {
  const res = runBoundarySmoke();
  const summary = {
    firstTradeDate: res.firstTradeDate,
    firstTradeReason: res.firstTradeReason as FirstTradeReason,
    lastCloseDate: res.lastCloseDate,
    trades: res.result?.trades.length ?? 0,
    equityStart: res.result?.accountHistory?.[0]?.equity ?? null,
    equityEnd: res.result?.finalEquity ?? null,
  };
  console.log("[boundary-open-smoke] PASSED", summary);
}

main();
