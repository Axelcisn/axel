/**
 * Smoke test for trade marker fallback when windowSim result is null.
 *
 * This does NOT relax strict no-carry-in restart for equity; it only verifies
 * we can still show price-chart markers from the global simulation when
 * windowSim is blocked.
 *
 * Run:
 *   npx tsx scripts/smoke-trade-overlay-fallback.ts
 */

import { type Trading212Trade } from "@/lib/backtest/trading212Cfd";
import { type WindowSimResult } from "@/lib/backtest/windowSim";
import { selectTradesForChartMarkers } from "@/lib/trading212/tradeOverlayFallback";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(msg);
  }
}

function buildSyntheticTrade(): Trading212Trade {
  return {
    entryDate: "2024-01-03",
    exitDate: "2024-01-05",
    side: "long",
    entryPrice: 100,
    exitPrice: 110,
    quantity: 1,
    grossPnl: 10,
    swapFees: 0,
    fxFees: 0,
    netPnl: 10,
    margin: 100,
    openingEquity: 1000,
    closingEquity: 1010,
  };
}

async function main() {
  const visibleWindow = { start: "2024-01-01", end: "2024-01-10" };
  const globalTrades = [buildSyntheticTrade()];

  // Simulate strict restart being blocked: windowSim exists but has no result/trades.
  const windowResultBlocked: WindowSimResult = {
    firstTradeDate: null,
    firstTradeReason: "carry_in_at_start",
    lastCloseDate: null,
    result: null,
    bars: [],
  };

  const { trades, source } = selectTradesForChartMarkers({
    windowResult: windowResultBlocked,
    globalTrades,
    visibleWindow,
    strategyStartDate: "2024-01-01",
  });

  assert(source === "globalFallback", `Expected source=globalFallback, got ${source}`);
  assert(trades.length === 1, `Expected 1 trade from global fallback, got ${trades.length}`);
  assert(trades[0].entryDate === "2024-01-03", "Unexpected entryDate");
  assert(trades[0].exitDate === "2024-01-05", "Unexpected exitDate");

  console.log("[trade-overlay-fallback-smoke] PASSED", {
    source,
    trades: trades.length,
    window: visibleWindow,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

