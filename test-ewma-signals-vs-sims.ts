/**
 * EWMA Signals vs Trading212 Simulation Diagnostic
 *
 * This script verifies:
 * 1. Are EWMA Unbiased signals always flat (no trades)?
 * 2. How often do EWMA Biased and EWMA Biased (Max) disagree on signals?
 * 3. Are the Trading212 sim results consistent with the signals and engine?
 *
 * Usage:
 *   npx tsx test-ewma-signals-vs-sims.ts [SYMBOL]
 *
 * Example:
 *   npx tsx test-ewma-signals-vs-sims.ts AAPL
 */

import {
  buildEwmaReactionMap,
  buildEwmaTiltConfigFromReactionMap,
  defaultReactionConfig,
  ReactionConfig,
} from "./lib/volatility/ewmaReaction";
import { runEwmaWalker, EwmaWalkerPoint, summarizeEwmaWalkerResults } from "./lib/volatility/ewmaWalker";
import { loadCanonicalDataWithMeta, CanonicalData } from "./lib/storage/canonical";
import {
  simulateTrading212Cfd,
  Trading212CfdConfig,
  Trading212SimBar,
  Trading212Signal,
  Trading212SimulationResult,
} from "./lib/backtest/trading212Cfd";

// ============================================================================
// Types
// ============================================================================

interface EwmaWalkerPathPoint {
  date_t: string;
  date_tp1: string;
  S_t: number;
  S_tp1: number;
  y_hat_tp1: number;
  L_tp1: number;
  U_tp1: number;
}

interface OptimizationCandidate {
  lambda: number;
  trainFraction: number;
  directionHitRate: number;
}

// ============================================================================
// Build Trading212 Sim Bars from EWMA Path
// ============================================================================

function buildTrading212SimBarsFromEwmaPath(
  canonicalRows: Array<{ date: string; adj_close: number | null; close: number }>,
  ewmaPath: EwmaWalkerPathPoint[] | null,
  thresholdPct: number
): Trading212SimBar[] {
  if (!ewmaPath) return [];

  // Build lookup from target date to forecast
  const ewmaMap = new Map<string, EwmaWalkerPathPoint>();
  ewmaPath.forEach((p) => {
    ewmaMap.set(p.date_tp1, p);
  });

  const bars: Trading212SimBar[] = [];

  for (const row of canonicalRows) {
    const price = row.adj_close ?? row.close;
    if (!price || !row.date) continue;

    const ewma = ewmaMap.get(row.date);
    if (!ewma) continue; // no forecast for this date

    // Compare forecast center vs origin price
    const diffPct = (ewma.y_hat_tp1 - ewma.S_t) / ewma.S_t;
    let signal: Trading212Signal = "flat";
    if (diffPct > thresholdPct) {
      signal = "long";
    } else if (diffPct < -thresholdPct) {
      signal = "short";
    }

    bars.push({
      date: row.date,
      price,
      signal,
    });
  }

  return bars;
}

// ============================================================================
// Signal Statistics
// ============================================================================

function computeSignalStats(bars: Trading212SimBar[]): { nLong: number; nShort: number; nFlat: number } {
  let nLong = 0, nShort = 0, nFlat = 0;
  for (const bar of bars) {
    if (bar.signal === "long") nLong++;
    else if (bar.signal === "short") nShort++;
    else nFlat++;
  }
  return { nLong, nShort, nFlat };
}

function countMismatches(
  barsA: Trading212SimBar[],
  barsB: Trading212SimBar[]
): { nMismatch: number; examples: Array<{ date: string; signalA: string; signalB: string }> } {
  const mapA = new Map<string, Trading212Signal>();
  barsA.forEach((b) => mapA.set(b.date, b.signal));

  let nMismatch = 0;
  const examples: Array<{ date: string; signalA: string; signalB: string }> = [];

  for (const b of barsB) {
    const sigA = mapA.get(b.date);
    if (sigA !== undefined && sigA !== b.signal) {
      nMismatch++;
      if (examples.length < 10) {
        examples.push({ date: b.date, signalA: sigA, signalB: b.signal });
      }
    }
  }

  return { nMismatch, examples };
}

// ============================================================================
// Log Simulation Results
// ============================================================================

function logSim(name: string, sim: Trading212SimulationResult): void {
  const retPct = ((sim.finalEquity - sim.initialEquity) / sim.initialEquity) * 100;
  console.log(`\n  === ${name} ===`);
  console.log(`    Initial equity: $${sim.initialEquity.toFixed(2)}`);
  console.log(`    Final equity:   $${sim.finalEquity.toFixed(2)}`);
  console.log(`    Return:         ${retPct >= 0 ? "+" : ""}${retPct.toFixed(2)}%`);
  console.log(`    Max Drawdown:   ${(sim.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`    Trades:         ${sim.trades.length}`);
  console.log(`    Stop-outs:      ${sim.stopOutEvents}`);
  console.log(`    Margin calls:   ${sim.marginCallEvents}`);
  if (sim.accountHistory.length > 0) {
    console.log(`    First date:     ${sim.accountHistory[0].date}`);
    console.log(`    Last date:      ${sim.accountHistory[sim.accountHistory.length - 1].date}`);
    console.log(`    Days simulated: ${sim.accountHistory.length}`);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const symbol = process.argv[2] || "AAPL";

  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("  EWMA Signals vs Trading212 Simulation Diagnostic");
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log(`\n  Symbol: ${symbol}`);

  // Default parameters (same as Timing page defaults)
  const lambda = 0.94;
  const coverage = 0.95;
  const h = 1;
  const trainFraction = 0.70;
  const minTrainObs = 500;
  const shrinkFactor = 0.5;
  const thresholdPct = 0.0; // threshold for signal generation

  console.log(`  Lambda: ${lambda}`);
  console.log(`  Coverage: ${coverage}`);
  console.log(`  Horizon: ${h}`);
  console.log(`  Train Fraction: ${(trainFraction * 100).toFixed(0)}%`);
  console.log(`  Threshold Pct: ${thresholdPct}`);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 0: Load canonical data
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n───────────────────────────────────────────────────────────────────────");
  console.log("  Step 0: Load Canonical Data");
  console.log("───────────────────────────────────────────────────────────────────────");

  const canonicalData: CanonicalData = await loadCanonicalDataWithMeta(symbol);
  const canonicalRows = canonicalData.rows;
  console.log(`  ✓ Loaded ${canonicalRows.length} rows for ${symbol}`);
  console.log(`    First date: ${canonicalRows[0]?.date}`);
  console.log(`    Last date:  ${canonicalRows[canonicalRows.length - 1]?.date}`);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 1: Build Reaction Map (for train/test split info)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n───────────────────────────────────────────────────────────────────────");
  console.log("  Step 1: Build Reaction Map (baseline λ/Train%)");
  console.log("───────────────────────────────────────────────────────────────────────");

  const reactionConfig: ReactionConfig = {
    ...defaultReactionConfig,
    lambda,
    coverage,
    trainFraction,
    minTrainObs,
    horizons: [h],
  };

  const t0 = Date.now();
  const reactionMap = await buildEwmaReactionMap(symbol, reactionConfig);
  console.log(`  ✓ Built Reaction Map in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
  console.log(`    Train window: ${reactionMap.meta.trainStart} → ${reactionMap.meta.trainEnd}`);
  console.log(`    Test window:  ${reactionMap.meta.testStart} → ${reactionMap.meta.testEnd}`);
  console.log(`    nTrain: ${reactionMap.meta.nTrain}, nTest: ${reactionMap.meta.nTest}`);

  const testStart = reactionMap.meta.testStart;
  const testEnd = reactionMap.meta.testEnd;

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2: Build EWMA Unbiased Path
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n───────────────────────────────────────────────────────────────────────");
  console.log("  Step 2: Build EWMA Unbiased Path");
  console.log("───────────────────────────────────────────────────────────────────────");

  const t1 = Date.now();
  const ewmaUnbiasedResult = await runEwmaWalker({
    symbol,
    lambda,
    coverage,
    horizon: h,
    // NO tiltConfig => UNBIASED
  });
  const ewmaUnbiasedPath: EwmaWalkerPathPoint[] = ewmaUnbiasedResult.points.map((p) => ({
    date_t: p.date_t,
    date_tp1: p.date_tp1,
    S_t: p.S_t,
    S_tp1: p.S_tp1,
    y_hat_tp1: p.y_hat_tp1,
    L_tp1: p.L_tp1,
    U_tp1: p.U_tp1,
  }));
  console.log(`  ✓ Built Unbiased path in ${((Date.now() - t1) / 1000).toFixed(2)}s, ${ewmaUnbiasedPath.length} points`);

  // Check: for UNBIASED, y_hat_tp1 should equal S_t (random walk center)
  let unbiasedDrifts = 0;
  for (const p of ewmaUnbiasedPath.slice(0, 10)) {
    const diff = Math.abs(p.y_hat_tp1 - p.S_t);
    if (diff > 0.0001) unbiasedDrifts++;
  }
  console.log(`    Sample check: y_hat_tp1 == S_t? ${unbiasedDrifts === 0 ? "YES ✓" : "NO ✗ (some differ)"}`);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 3: Build EWMA Biased Baseline Path
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n───────────────────────────────────────────────────────────────────────");
  console.log("  Step 3: Build EWMA Biased Baseline Path (λ=0.94, Train=70%)");
  console.log("───────────────────────────────────────────────────────────────────────");

  const tiltConfigBaseline = buildEwmaTiltConfigFromReactionMap(reactionMap, {
    shrinkFactor,
    horizon: h,
  });

  console.log("  Tilt μ by bucket:");
  for (const [bucket, mu] of Object.entries(tiltConfigBaseline.muByBucket)) {
    console.log(`    ${bucket.padEnd(10)}: μ = ${((mu as number) * 100).toFixed(4)}%`);
  }

  const t2 = Date.now();
  const ewmaBiasedBaselineResult = await runEwmaWalker({
    symbol,
    lambda,
    coverage,
    horizon: h,
    tiltConfig: tiltConfigBaseline,
  });
  const ewmaBiasedPathBaseline: EwmaWalkerPathPoint[] = ewmaBiasedBaselineResult.points.map((p) => ({
    date_t: p.date_t,
    date_tp1: p.date_tp1,
    S_t: p.S_t,
    S_tp1: p.S_tp1,
    y_hat_tp1: p.y_hat_tp1,
    L_tp1: p.L_tp1,
    U_tp1: p.U_tp1,
  }));
  console.log(`  ✓ Built Biased Baseline path in ${((Date.now() - t2) / 1000).toFixed(2)}s, ${ewmaBiasedPathBaseline.length} points`);

  const baselineSummary = summarizeEwmaWalkerResults(ewmaBiasedBaselineResult);
  console.log(`    Direction Hit Rate: ${(baselineSummary.directionHitRate * 100).toFixed(2)}%`);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 4: Grid Search for Best λ/Train% (simplified)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n───────────────────────────────────────────────────────────────────────");
  console.log("  Step 4: Find Optimized λ/Train% (simplified grid)");
  console.log("───────────────────────────────────────────────────────────────────────");

  // Simplified grid to keep script fast
  const lambdaGrid = [0.90, 0.92, 0.94, 0.96, 0.98];
  const trainGrid = [0.50, 0.60, 0.70, 0.80, 0.90];

  let best: OptimizationCandidate | null = null;

  console.log("  Searching grid...");
  for (const testLambda of lambdaGrid) {
    for (const testTrain of trainGrid) {
      const testConfig: ReactionConfig = {
        ...defaultReactionConfig,
        lambda: testLambda,
        coverage,
        trainFraction: testTrain,
        minTrainObs,
        horizons: [h],
      };

      try {
        const testReactionMap = await buildEwmaReactionMap(symbol, testConfig);
        if (testReactionMap.meta.nTest <= 0) continue;

        const testTiltConfig = buildEwmaTiltConfigFromReactionMap(testReactionMap, {
          shrinkFactor,
          horizon: h,
        });

        const testResult = await runEwmaWalker({
          symbol,
          lambda: testLambda,
          coverage,
          horizon: h,
          tiltConfig: testTiltConfig,
        });

        const testSummary = summarizeEwmaWalkerResults(testResult);
        const hit = testSummary.directionHitRate;

        if (!best || hit > best.directionHitRate) {
          best = { lambda: testLambda, trainFraction: testTrain, directionHitRate: hit };
        }
      } catch (e) {
        // Skip invalid combos
      }
    }
  }

  if (!best) {
    console.log("  ⚠️  No valid optimization candidates found! Using baseline.");
    best = { lambda, trainFraction, directionHitRate: baselineSummary.directionHitRate };
  }

  console.log(`  ✓ Best candidate:`);
  console.log(`      λ = ${best.lambda.toFixed(2)}`);
  console.log(`      Train% = ${(best.trainFraction * 100).toFixed(0)}%`);
  console.log(`      Direction Hit Rate = ${(best.directionHitRate * 100).toFixed(2)}%`);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 5: Build EWMA Biased Max Path (using best λ/Train%)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n───────────────────────────────────────────────────────────────────────");
  console.log(`  Step 5: Build EWMA Biased Max Path (λ=${best.lambda}, Train=${(best.trainFraction * 100).toFixed(0)}%)`);
  console.log("───────────────────────────────────────────────────────────────────────");

  const maxConfig: ReactionConfig = {
    ...defaultReactionConfig,
    lambda: best.lambda,
    coverage,
    trainFraction: best.trainFraction,
    minTrainObs,
    horizons: [h],
  };

  const maxReactionMap = await buildEwmaReactionMap(symbol, maxConfig);
  const tiltConfigMax = buildEwmaTiltConfigFromReactionMap(maxReactionMap, {
    shrinkFactor,
    horizon: h,
  });

  console.log("  Tilt μ by bucket (Max):");
  for (const [bucket, mu] of Object.entries(tiltConfigMax.muByBucket)) {
    console.log(`    ${bucket.padEnd(10)}: μ = ${((mu as number) * 100).toFixed(4)}%`);
  }

  const t3 = Date.now();
  const ewmaBiasedMaxResult = await runEwmaWalker({
    symbol,
    lambda: best.lambda,
    coverage,
    horizon: h,
    tiltConfig: tiltConfigMax,
  });
  const ewmaBiasedPathMax: EwmaWalkerPathPoint[] = ewmaBiasedMaxResult.points.map((p) => ({
    date_t: p.date_t,
    date_tp1: p.date_tp1,
    S_t: p.S_t,
    S_tp1: p.S_tp1,
    y_hat_tp1: p.y_hat_tp1,
    L_tp1: p.L_tp1,
    U_tp1: p.U_tp1,
  }));
  console.log(`  ✓ Built Biased Max path in ${((Date.now() - t3) / 1000).toFixed(2)}s, ${ewmaBiasedPathMax.length} points`);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 6: Build Sim Bars for Each Strategy
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n───────────────────────────────────────────────────────────────────────");
  console.log("  Step 6: Build Trading212 Sim Bars");
  console.log("───────────────────────────────────────────────────────────────────────");

  // Filter canonical rows to test window
  const rowsForSim = canonicalRows.filter(
    (row) => row.date >= testStart && row.date <= testEnd
  );
  console.log(`  Sim window: ${testStart} → ${testEnd}`);
  console.log(`  Rows in sim window: ${rowsForSim.length}`);

  const barsUnbiased = buildTrading212SimBarsFromEwmaPath(rowsForSim, ewmaUnbiasedPath, thresholdPct);
  const barsBiased = buildTrading212SimBarsFromEwmaPath(rowsForSim, ewmaBiasedPathBaseline, thresholdPct);
  const barsBiasedMax = buildTrading212SimBarsFromEwmaPath(rowsForSim, ewmaBiasedPathMax, thresholdPct);

  console.log(`  Bars built:`);
  console.log(`    Unbiased:    ${barsUnbiased.length} bars`);
  console.log(`    Biased:      ${barsBiased.length} bars`);
  console.log(`    Biased Max:  ${barsBiasedMax.length} bars`);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 7: Compute Signal Statistics
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n───────────────────────────────────────────────────────────────────────");
  console.log("  Step 7: Signal Statistics");
  console.log("───────────────────────────────────────────────────────────────────────");

  const statsUnbiased = computeSignalStats(barsUnbiased);
  const statsBiased = computeSignalStats(barsBiased);
  const statsBiasedMax = computeSignalStats(barsBiasedMax);

  console.log(`\n  UNBIASED signals:`);
  console.log(`    Long:  ${statsUnbiased.nLong}`);
  console.log(`    Short: ${statsUnbiased.nShort}`);
  console.log(`    Flat:  ${statsUnbiased.nFlat}`);
  console.log(`    → ${statsUnbiased.nLong === 0 && statsUnbiased.nShort === 0 ? "✓ ALL FLAT (expected)" : "⚠️ NOT ALL FLAT!"}`);

  console.log(`\n  BIASED BASELINE signals:`);
  console.log(`    Long:  ${statsBiased.nLong}`);
  console.log(`    Short: ${statsBiased.nShort}`);
  console.log(`    Flat:  ${statsBiased.nFlat}`);

  console.log(`\n  BIASED MAX signals:`);
  console.log(`    Long:  ${statsBiasedMax.nLong}`);
  console.log(`    Short: ${statsBiasedMax.nShort}`);
  console.log(`    Flat:  ${statsBiasedMax.nFlat}`);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 8: Compare Biased vs Biased Max Signals
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n───────────────────────────────────────────────────────────────────────");
  console.log("  Step 8: Biased vs Biased Max Signal Comparison");
  console.log("───────────────────────────────────────────────────────────────────────");

  const { nMismatch, examples } = countMismatches(barsBiased, barsBiasedMax);

  console.log(`\n  Mismatches: ${nMismatch} / ${Math.min(barsBiased.length, barsBiasedMax.length)} days`);

  if (nMismatch === 0) {
    console.log("  → ✓ Biased and Biased Max have IDENTICAL signals");
  } else {
    console.log("  → ⚠️ Signals DIFFER on some days:");
    for (const ex of examples) {
      console.log(`      ${ex.date}: Biased=${ex.signalA}, Max=${ex.signalB}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 9: Run Trading212 Simulations
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n───────────────────────────────────────────────────────────────────────");
  console.log("  Step 9: Run Trading212 CFD Simulations");
  console.log("───────────────────────────────────────────────────────────────────────");

  const config: Trading212CfdConfig = {
    leverage: 5,
    fxFeeRate: 0.005,
    dailyLongSwapRate: 0,
    dailyShortSwapRate: 0,
    spreadBps: 5,
    marginCallLevel: 0.45,
    stopOutLevel: 0.25,
    positionFraction: 0.25, // 25% Position
  };
  const initialEquity = 5000;

  console.log(`  Config:`);
  console.log(`    Initial Equity: $${initialEquity}`);
  console.log(`    Leverage: ${config.leverage}x`);
  console.log(`    Position Fraction: ${(config.positionFraction * 100).toFixed(0)}%`);

  const simUnbiased = simulateTrading212Cfd(barsUnbiased, initialEquity, config);
  const simBiased = simulateTrading212Cfd(barsBiased, initialEquity, config);
  const simBiasedMax = simulateTrading212Cfd(barsBiasedMax, initialEquity, config);

  logSim("EWMA Unbiased", simUnbiased);
  logSim("EWMA Biased (baseline λ=0.94, Train=70%)", simBiased);
  logSim(`EWMA Biased Max (λ=${best.lambda}, Train=${(best.trainFraction * 100).toFixed(0)}%)`, simBiasedMax);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 10: Summary & Assertions
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════════════");

  // Assertion 1: Unbiased has all flat signals => 0 trades
  const unbiasedAllFlat = statsUnbiased.nLong === 0 && statsUnbiased.nShort === 0;
  console.log(`\n  1. Unbiased signals all flat? ${unbiasedAllFlat ? "✓ YES" : "✗ NO"}`);
  console.log(`     Trades: ${simUnbiased.trades.length} (expected: 0)`);

  // Assertion 2: Biased vs Max signal comparison
  console.log(`\n  2. Biased vs Biased Max signal mismatches: ${nMismatch}`);

  // Assertion 3: Equity comparison
  const deltaEquity = simBiasedMax.finalEquity - simBiased.finalEquity;
  console.log(`\n  3. Equity delta (Max - Baseline): $${deltaEquity.toFixed(2)}`);

  const biasedRetPct = ((simBiased.finalEquity - simBiased.initialEquity) / simBiased.initialEquity) * 100;
  const maxRetPct = ((simBiasedMax.finalEquity - simBiasedMax.initialEquity) / simBiasedMax.initialEquity) * 100;

  console.log(`     Biased baseline return: ${biasedRetPct >= 0 ? "+" : ""}${biasedRetPct.toFixed(2)}%`);
  console.log(`     Biased Max return:      ${maxRetPct >= 0 ? "+" : ""}${maxRetPct.toFixed(2)}%`);

  // Additional diagnostic: compare λ/Train% used
  console.log(`\n  4. Parameters used:`);
  console.log(`     Baseline: λ=${lambda}, Train%=${(trainFraction * 100).toFixed(0)}%`);
  console.log(`     Max:      λ=${best.lambda}, Train%=${(best.trainFraction * 100).toFixed(0)}%`);

  if (best.lambda === lambda && best.trainFraction === trainFraction) {
    console.log(`     → ✓ Same parameters (baseline IS the best)`);
  } else {
    console.log(`     → Parameters differ (Max uses optimized values)`);
  }

  console.log("\n───────────────────────────────────────────────────────────────────────");
  console.log("  DONE");
  console.log("───────────────────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
