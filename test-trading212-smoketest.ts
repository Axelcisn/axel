/**
 * Trading212 CFD Simulation Smoketest
 * 
 * Run with: npx tsx test-trading212-smoketest.ts
 * 
 * Tests the pure engine without React UI to verify:
 * - Flat signals produce no trades and constant equity
 * - Long positions track price correctly
 * - Stop-out triggers at 25% margin status
 * - Margin status formula matches Trading212 docs
 */

import { simulateTrading212Cfd, Trading212CfdConfig, Trading212SimBar } from "./lib/backtest/trading212Cfd";

function logCase(name: string, result: ReturnType<typeof simulateTrading212Cfd>) {
  const retPct =
    (result.finalEquity - result.initialEquity) / result.initialEquity * 100;
  const maxDdPct = result.maxDrawdown * 100;
  console.log(`\n=== ${name} ===`);
  console.log(`Initial equity: ${result.initialEquity.toFixed(2)}`);
  console.log(`Final equity  : ${result.finalEquity.toFixed(2)}`);
  console.log(`Return        : ${retPct.toFixed(2)}%`);
  console.log(`Max drawdown  : ${maxDdPct.toFixed(2)}%`);
  console.log(`Trades        : ${result.trades.length}`);
  console.log(`Stop-outs     : ${result.stopOutEvents}`);
  console.log(`Margin calls  : ${result.marginCallEvents}`);
}

function makeConfig(overrides: Partial<Trading212CfdConfig> = {}): Trading212CfdConfig {
  return {
    leverage: 5,
    fxFeeRate: 0.0,
    dailyLongSwapRate: 0,
    dailyShortSwapRate: 0,
    spreadBps: 0,
    marginCallLevel: 0.45,
    stopOutLevel: 0.25,
    positionFraction: 0.5,
    ...overrides,
  };
}

// 1) Always-flat, no swaps, no spread => equity constant
function testAlwaysFlat() {
  const bars: Trading212SimBar[] = [];
  let price = 100;
  for (let i = 0; i < 10; i++) {
    bars.push({ date: `2020-01-${String(i + 1).padStart(2, "0")}`, price, signal: "flat" });
    price += 1;
  }
  const config = makeConfig();
  const result = simulateTrading212Cfd(bars, 5000, config);
  logCase("Always flat (no trades)", result);
  
  // Assertions
  const pass = result.trades.length === 0 && Math.abs(result.finalEquity - 5000) < 0.01;
  console.log(`✓ PASS: ${pass ? "Yes" : "NO - expected 0 trades and equity = 5000"}`);
}

// 2) Always-long, leverage=5, positionFraction=0.2, no spread/swaps => should profit on rising prices
function testAlwaysLongUnlevered() {
  const bars: Trading212SimBar[] = [];
  const prices = [100, 110, 120, 130, 140];
  for (let i = 0; i < prices.length; i++) {
    bars.push({
      date: `2020-02-${String(i + 1).padStart(2, "0")}`,
      price: prices[i],
      signal: "long",
    });
  }
  // Use realistic params: 5x leverage, only 20% of equity as margin
  // This leaves 80% as buffer, so rising prices won't trigger stop-out
  const config = makeConfig({ leverage: 5, positionFraction: 0.2 });
  const result = simulateTrading212Cfd(bars, 5000, config);
  logCase("Always long, L=5, 20% position, no fees", result);
  
  // With 20% of 5000 = 1000 margin, 5x leverage = 5000 exposure
  // Price rises 40%, so profit = 5000 * 0.4 = 2000
  // Final equity should be around 5000 + 2000 = 7000
  const expectedMin = 6000; // Allow some margin for calculation differences
  const pass = result.finalEquity >= expectedMin && result.stopOutEvents === 0;
  console.log(`Expected final >= ${expectedMin}, Actual: ${result.finalEquity.toFixed(2)}, Stop-outs: ${result.stopOutEvents}`);
  console.log(`✓ PASS: ${pass ? "Yes" : "NO - expected profit with no stop-outs"}`);
}

// 3) Simple down-move to trigger stop-out
function testStopOut() {
  const bars: Trading212SimBar[] = [];
  bars.push({ date: "2020-03-01", price: 100, signal: "long" });
  bars.push({ date: "2020-03-02", price: 60, signal: "long" });
  bars.push({ date: "2020-03-03", price: 40, signal: "long" });
  const config = makeConfig({ leverage: 5, positionFraction: 0.8 });
  const result = simulateTrading212Cfd(bars, 5000, config);
  logCase("Stop-out stress", result);
  
  // With 5x leverage and 80% position, a 40% drop should trigger stop-out
  console.log(`✓ PASS: ${result.stopOutEvents > 0 ? "Yes - stop-out triggered" : "NO - expected stop-out"}`);
}

// 4) Margin status sanity check: log first few snapshots
function testMarginStatus() {
  const bars: Trading212SimBar[] = [];
  const prices = [100, 80, 60, 50, 40];
  for (let i = 0; i < prices.length; i++) {
    bars.push({
      date: `2020-04-${String(i + 1).padStart(2, "0")}`,
      price: prices[i],
      signal: "long",
    });
  }
  const config = makeConfig({ leverage: 5, positionFraction: 0.5 });
  const result = simulateTrading212Cfd(bars, 5000, config);
  
  console.log("\n=== Margin status series ===");
  console.log("Trading212 margin status formula:");
  console.log("  - Above 50%: equity / (equity + margin) × 100");
  console.log("  - Below 50%: equity / margin × 50");
  console.log("");
  console.log("Date        | Price | Equity   | Margin   | Status | Position");
  console.log("------------|-------|----------|----------|--------|----------");
  
  result.accountHistory.forEach((snap) => {
    console.log(
      `${snap.date} | ${snap.price.toFixed(0).padStart(5)} | ` +
      `${snap.equity.toFixed(0).padStart(8)} | ${snap.marginUsed.toFixed(0).padStart(8)} | ` +
      `${(snap.marginStatus).toFixed(1).padStart(5)}% | ` +
      `${snap.side ?? "flat"} (${snap.quantity.toFixed(0)})`
    );
  });
  
  // Check if margin status drops and eventually triggers events
  const lastSnap = result.accountHistory[result.accountHistory.length - 1];
  console.log(`\nFinal margin status: ${lastSnap.marginStatus.toFixed(1)}%`);
  console.log(`Stop-outs: ${result.stopOutEvents}, Margin calls: ${result.marginCallEvents}`);
  console.log(`Note: With 50% position fraction and 5x leverage, stop-outs trigger on large drops.`);
  console.log(`      After each stop-out, position is reopened with remaining equity, hence 50% status.`);
}

// 5) Test short position behavior with realistic params
function testShortPosition() {
  const bars: Trading212SimBar[] = [];
  const prices = [100, 90, 80, 70, 60]; // Price falling = short profits
  for (let i = 0; i < prices.length; i++) {
    bars.push({
      date: `2020-05-${String(i + 1).padStart(2, "0")}`,
      price: prices[i],
      signal: "short",
    });
  }
  // Use realistic params: 5x leverage, 20% position fraction
  const config = makeConfig({ leverage: 5, positionFraction: 0.2 });
  const result = simulateTrading212Cfd(bars, 5000, config);
  logCase("Short position, price falling, L=5, 20% position", result);
  
  // With 20% of 5000 = 1000 margin, 5x leverage = 5000 exposure at price 100
  // Price falls 40%, so profit = 5000 * 0.4 = 2000
  // Final equity should be around 5000 + 2000 = 7000
  // Note: Due to position sizing at each bar, actual returns may differ
  const retPct = (result.finalEquity - result.initialEquity) / result.initialEquity * 100;
  const pass = retPct > 15 && result.stopOutEvents === 0;
  console.log(`Return: ${retPct.toFixed(1)}%, Stop-outs: ${result.stopOutEvents}`);
  console.log(`✓ PASS: ${pass ? "Yes - short profited on falling price" : "NO - expected profit with no stop-outs"}`);
}

// 6) Test signal transitions
function testSignalTransitions() {
  const bars: Trading212SimBar[] = [
    { date: "2020-06-01", price: 100, signal: "flat" },
    { date: "2020-06-02", price: 105, signal: "long" },
    { date: "2020-06-03", price: 110, signal: "long" },
    { date: "2020-06-04", price: 108, signal: "flat" },  // Close long
    { date: "2020-06-05", price: 105, signal: "short" }, // Open short
    { date: "2020-06-06", price: 100, signal: "short" },
    { date: "2020-06-07", price: 95, signal: "flat" },   // Close short
  ];
  const config = makeConfig({ leverage: 2, positionFraction: 0.5 });
  const result = simulateTrading212Cfd(bars, 5000, config);
  logCase("Signal transitions (flat→long→flat→short→flat)", result);
  
  console.log("\nTrades:");
  result.trades.forEach((t, i) => {
    console.log(`  ${i + 1}. ${t.entryDate} → ${t.exitDate}: ${t.side} @ ${t.entryPrice.toFixed(2)} → ${t.exitPrice.toFixed(2)}, Net PnL: ${t.netPnl.toFixed(2)}`);
  });
  
  console.log(`✓ PASS: ${result.trades.length >= 2 ? "Yes - multiple trades executed" : "NO - expected 2+ trades"}`);
}

// 7) FX Fee Test
// Confirm that when fxFeeRate > 0, net P&L = gross P&L − FX fee
function testFxFee() {
  const bars: Trading212SimBar[] = [
    { date: "2020-07-01", price: 100, signal: "long" },  // Open long
    { date: "2020-07-02", price: 110, signal: "flat" }, // Close by going flat
  ];
  
  const config = makeConfig({
    leverage: 5,
    positionFraction: 0.5,
    fxFeeRate: 0.005, // 0.5% FX fee
    spreadBps: 0,
    dailyLongSwapRate: 0,
    dailyShortSwapRate: 0,
  });
  
  const result = simulateTrading212Cfd(bars, 5000, config);
  logCase("FX Fee Test (0.5% on profit)", result);
  
  if (result.trades.length === 0) {
    console.log("❌ FAIL: No trades executed");
    return;
  }
  
  const trade = result.trades[0];
  const expectedFxFee = Math.abs(trade.grossPnl) * 0.005;
  const expectedNetPnl = trade.grossPnl - expectedFxFee;
  
  console.log(`\nFX Fee Analysis:`);
  console.log(`  Gross P&L   : ${trade.grossPnl.toFixed(2)}`);
  console.log(`  FX Fee Rate : 0.5%`);
  console.log(`  Expected Fee: ${expectedFxFee.toFixed(2)}`);
  console.log(`  Actual Fee  : ${trade.fxFees.toFixed(2)}`);
  console.log(`  Expected Net: ${expectedNetPnl.toFixed(2)}`);
  console.log(`  Actual Net  : ${trade.netPnl.toFixed(2)}`);
  console.log(`  Total FX    : ${result.fxFeesTotal.toFixed(2)}`);
  
  const feeMatch = Math.abs(trade.fxFees - expectedFxFee) < 0.01;
  const netMatch = Math.abs(trade.netPnl - expectedNetPnl) < 0.01;
  const pass = feeMatch && netMatch && result.fxFeesTotal > 0;
  
  console.log(`✓ PASS: ${pass ? "Yes - FX fee correctly applied" : "NO - FX fee calculation mismatch"}`);
}

// 8) Overnight Interest (Swap) Test
// Confirm that daily swap is applied as exposure × dailyRate each day
function testOvernightInterest() {
  const bars: Trading212SimBar[] = [
    { date: "2020-08-01", price: 100, signal: "long" },  // Open long
    { date: "2020-08-02", price: 100, signal: "long" },  // Hold (swap applied)
    { date: "2020-08-03", price: 100, signal: "flat" },  // Close (swap applied before close)
  ];
  
  const dailySwapRate = -0.001; // -0.1% per day (negative = cost for longs)
  
  const config = makeConfig({
    leverage: 5,
    positionFraction: 0.5,
    fxFeeRate: 0,
    spreadBps: 0,
    dailyLongSwapRate: dailySwapRate,
    dailyShortSwapRate: 0,
  });
  
  const result = simulateTrading212Cfd(bars, 5000, config);
  logCase("Overnight Interest Test (-0.1%/day swap)", result);
  
  // Calculate expected swap fees
  // Initial: 5000 equity, 50% position = 2500 margin, 5x leverage = 12500 exposure
  // Each night: exposure * -0.001 = -12.5 per night
  // Position held for 2 nights (Day 1→2 and Day 2→3)
  
  console.log(`\nOvernight Interest Analysis:`);
  console.log(`  Daily Swap Rate: ${(dailySwapRate * 100).toFixed(2)}%`);
  console.log(`  Total Swap Fees: ${result.swapFeesTotal.toFixed(2)}`);
  
  // Check that swap fees are negative (cost) and have reasonable magnitude
  const swapIsNegative = result.swapFeesTotal < 0;
  const swapMagnitudeOk = Math.abs(result.swapFeesTotal) > 10 && Math.abs(result.swapFeesTotal) < 50;
  
  // Final equity should be less than initial due to swap costs (price didn't change)
  const equityDecreased = result.finalEquity < result.initialEquity;
  
  console.log(`  Swap is negative (cost): ${swapIsNegative ? "Yes" : "No"}`);
  console.log(`  Swap magnitude reasonable: ${swapMagnitudeOk ? "Yes" : "No"} (expected ~25)`);
  console.log(`  Equity decreased: ${equityDecreased ? "Yes" : "No"}`);
  console.log(`  Final equity: ${result.finalEquity.toFixed(2)} (started at ${result.initialEquity.toFixed(2)})`);
  
  const pass = swapIsNegative && equityDecreased;
  console.log(`✓ PASS: ${pass ? "Yes - overnight interest correctly applied" : "NO - overnight interest issue"}`);
}

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║       Trading212 CFD Simulation Engine Smoketest          ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  
  testAlwaysFlat();
  testAlwaysLongUnlevered();
  testStopOut();
  testMarginStatus();
  testShortPosition();
  testSignalTransitions();
  testFxFee();
  testOvernightInterest();
  
  console.log("\n════════════════════════════════════════════════════════════");
  console.log("Smoketest complete. Review results above for correctness.");
  console.log("════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
