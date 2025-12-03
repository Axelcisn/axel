/**
 * Unit Tests for Trading212 Margin Status Formula
 * 
 * Run with: npx tsx test-margin-status-unit.ts
 * 
 * Trading212 margin status formula:
 * - Above 50%: Status = Total Funds / (Total Funds + Margin) * 100
 * - Below 50%: Status = Total Funds / Margin * 50
 * 
 * See: https://helpcentre.trading212.com/hc/en-us/articles/360008654957
 */

import { computeMarginStatus } from "./lib/backtest/trading212Cfd";

const EPSILON = 0.1; // Allow ±0.1% tolerance

function assertApprox(actual: number, expected: number, testName: string): boolean {
  const diff = Math.abs(actual - expected);
  const pass = diff <= EPSILON;
  if (pass) {
    console.log(`✅ ${testName}: ${actual.toFixed(2)}% ≈ ${expected.toFixed(2)}% (diff: ${diff.toFixed(4)})`);
  } else {
    console.log(`❌ ${testName}: ${actual.toFixed(2)}% ≠ ${expected.toFixed(2)}% (diff: ${diff.toFixed(4)})`);
  }
  return pass;
}

function assertEqual(actual: number, expected: number, testName: string): boolean {
  const pass = actual === expected;
  if (pass) {
    console.log(`✅ ${testName}: ${actual} === ${expected}`);
  } else {
    console.log(`❌ ${testName}: ${actual} !== ${expected}`);
  }
  return pass;
}

// ============================================================================
// Test Cases
// ============================================================================

/**
 * Test 1: No margin, positive equity
 * When no positions are open, account status should be 100%
 */
function testNoMarginPositiveEquity(): boolean {
  const equity = 5000;
  const marginUsed = 0;
  const status = computeMarginStatus(equity, marginUsed);
  return assertEqual(status, 100, "No margin, positive equity → 100%");
}

/**
 * Test 2: Above 50% branch example
 * equity = 1000, marginUsed = 400
 * Status = 1000 / (1000 + 400) * 100 = 71.43%
 */
function testAbove50Branch(): boolean {
  const equity = 1000;
  const marginUsed = 400;
  const expected = (equity / (equity + marginUsed)) * 100; // 71.43%
  const status = computeMarginStatus(equity, marginUsed);
  return assertApprox(status, expected, `Above 50% branch (equity=${equity}, margin=${marginUsed})`);
}

/**
 * Test 3: Exactly 50% example
 * equity = 500, marginUsed = 500
 * Above-50 formula: 500 / (500 + 500) * 100 = 50%
 * Below-50 formula: 500 / 500 * 50 = 50%
 * Both formulas give 50% at the boundary
 */
function testExactly50(): boolean {
  const equity = 500;
  const marginUsed = 500;
  const status = computeMarginStatus(equity, marginUsed);
  return assertApprox(status, 50, `Exactly 50% (equity=${equity}, margin=${marginUsed})`);
}

/**
 * Test 4: Below 50% branch example (stop-out edge)
 * equity = 250, marginUsed = 500
 * Status = 250 / 500 * 50 = 25% (stop-out threshold)
 */
function testBelow50Branch(): boolean {
  const equity = 250;
  const marginUsed = 500;
  const expected = (equity / marginUsed) * 50; // 25%
  const status = computeMarginStatus(equity, marginUsed);
  return assertApprox(status, expected, `Below 50% branch (equity=${equity}, margin=${marginUsed}) → stop-out edge`);
}

/**
 * Test 5a: Equity = 0 (fully distressed)
 * Should return 0% to trigger stop-out
 */
function testEquityZero(): boolean {
  const equity = 0;
  const marginUsed = 500;
  const status = computeMarginStatus(equity, marginUsed);
  return assertEqual(status, 0, "Equity = 0 → 0% (fully distressed)");
}

/**
 * Test 5b: Equity negative (deeply distressed)
 * Should return 0% to trigger stop-out
 */
function testEquityNegative(): boolean {
  const equity = -100;
  const marginUsed = 500;
  const status = computeMarginStatus(equity, marginUsed);
  return assertEqual(status, 0, "Equity = -100 → 0% (deeply distressed)");
}

/**
 * Test 6: Very healthy account
 * equity = 10000, marginUsed = 100
 * Status = 10000 / (10000 + 100) * 100 = 99.01%
 */
function testVeryHealthy(): boolean {
  const equity = 10000;
  const marginUsed = 100;
  const expected = (equity / (equity + marginUsed)) * 100; // 99.01%
  const status = computeMarginStatus(equity, marginUsed);
  return assertApprox(status, expected, `Very healthy (equity=${equity}, margin=${marginUsed})`);
}

/**
 * Test 7: Just above margin call (45%)
 * We need to find equity such that status ≈ 46%
 * For above-50 branch: status = equity / (equity + margin) * 100
 * At status = 46%: 0.46 = equity / (equity + margin)
 * Solving: equity = 0.46 * (equity + margin)
 *          equity = 0.46 * equity + 0.46 * margin
 *          0.54 * equity = 0.46 * margin
 *          equity = (0.46/0.54) * margin ≈ 0.852 * margin
 * 
 * But 46% is below 50%, so we use below-50 formula:
 * status = equity / margin * 50
 * For status = 46%: equity = 46 * margin / 50 = 0.92 * margin
 */
function testJustAboveMarginCall(): boolean {
  const marginUsed = 1000;
  const equity = 920; // Should give 46% via below-50 formula
  const expected = (equity / marginUsed) * 50; // 46%
  const status = computeMarginStatus(equity, marginUsed);
  return assertApprox(status, expected, `Just above margin call (equity=${equity}, margin=${marginUsed})`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║    Trading212 Margin Status Formula - Unit Tests          ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  console.log("Formula reference:");
  console.log("  - Above 50%: Status = equity / (equity + margin) × 100");
  console.log("  - Below 50%: Status = equity / margin × 50");
  console.log("  - No margin: Status = 100%");
  console.log("  - Equity ≤ 0: Status = 0%\n");

  const results: boolean[] = [];

  console.log("--- Test 1: No margin, positive equity ---");
  results.push(testNoMarginPositiveEquity());

  console.log("\n--- Test 2: Above 50% branch ---");
  results.push(testAbove50Branch());

  console.log("\n--- Test 3: Exactly 50% boundary ---");
  results.push(testExactly50());

  console.log("\n--- Test 4: Below 50% branch (stop-out edge at 25%) ---");
  results.push(testBelow50Branch());

  console.log("\n--- Test 5a: Equity = 0 (fully distressed) ---");
  results.push(testEquityZero());

  console.log("\n--- Test 5b: Equity negative (deeply distressed) ---");
  results.push(testEquityNegative());

  console.log("\n--- Test 6: Very healthy account ---");
  results.push(testVeryHealthy());

  console.log("\n--- Test 7: Just above margin call (46%) ---");
  results.push(testJustAboveMarginCall());

  // Summary
  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log("\n════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed}/${total} tests passed`);
  if (passed === total) {
    console.log("✅ All margin status formula tests PASSED!");
  } else {
    console.log("❌ Some tests FAILED. Review above.");
  }
  console.log("════════════════════════════════════════════════════════════\n");

  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
