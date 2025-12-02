/**
 * EWMA Biased (Tilted) Smoke Test
 *
 * Verifies that the biased EWMA implementation correctly:
 * 1. Builds ReactionMap for the specified horizon
 * 2. Extracts μ_t values per bucket
 * 3. Applies μ_t to forecasts (y_hat_tilted differs from neutral when μ ≠ 0)
 *
 * Usage:
 *   npx tsx test-ewma-biased-smoketest.ts [SYMBOL] [HORIZON]
 *
 * Example:
 *   npx tsx test-ewma-biased-smoketest.ts AAPL 5
 */

import {
  buildEwmaReactionMap,
  buildEwmaTiltConfigFromReactionMap,
  defaultReactionConfig,
  ZBucketId,
  DEFAULT_Z_BUCKETS,
} from "./lib/volatility/ewmaReaction";
import { runEwmaWalker, EwmaWalkerPoint } from "./lib/volatility/ewmaWalker";

const SHRINK_FACTOR = 0.5;

async function main() {
  const symbol = process.argv[2] || "AAPL";
  const horizon = parseInt(process.argv[3] || "5", 10);

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  EWMA Biased (Tilted) Smoke Test");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("\nSymbol:", symbol);
  console.log("Horizon:", horizon);
  console.log("Shrink Factor:", SHRINK_FACTOR);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 1: Build Reaction Map for this horizon
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n───────────────────────────────────────────────────────────────");
  console.log("  Step 1: Build Reaction Map");
  console.log("───────────────────────────────────────────────────────────────");

  const reactionConfig = {
    ...defaultReactionConfig,
    horizons: [horizon], // CRITICAL: use the specified horizon
  };

  console.log("  Config: lambda =", reactionConfig.lambda);
  console.log("          coverage =", reactionConfig.coverage);
  console.log("          horizons =", reactionConfig.horizons);
  console.log("          trainFraction =", reactionConfig.trainFraction);

  const t0 = Date.now();
  const reactionMap = await buildEwmaReactionMap(symbol, reactionConfig);
  console.log(`  ✓ Built in ${((Date.now() - t0) / 1000).toFixed(2)}s`);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2: Extract Tilt Config (μ by bucket)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n───────────────────────────────────────────────────────────────");
  console.log("  Step 2: Extract Tilt Config");
  console.log("───────────────────────────────────────────────────────────────");

  const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, {
    shrinkFactor: SHRINK_FACTOR,
    horizon,
  });

  console.log("  Tilt Config:");
  console.log("    horizon:", tiltConfig.horizon);
  console.log("    shrinkFactor:", tiltConfig.shrinkFactor);
  console.log("    lambda:", tiltConfig.lambda);
  console.log("    coverage:", tiltConfig.coverage);
  console.log();

  const bucketOrder: ZBucketId[] = ["bigDown", "medDown", "normal", "medUp", "bigUp"];
  let anyNonZero = false;
  for (const bucketId of bucketOrder) {
    const mu = tiltConfig.muByBucket[bucketId];
    const muStr = mu != null ? (mu * 100).toFixed(4) + "%" : "(n/a)";
    console.log(`    ${bucketId.padEnd(10)}: μ = ${muStr}`);
    if (mu != null && Math.abs(mu) > 1e-9) {
      anyNonZero = true;
    }
  }

  if (!anyNonZero) {
    console.log("\n  ⚠️  WARNING: All μ values are zero! Biased = Neutral.");
  } else {
    console.log("\n  ✓ Found non-zero μ values - tilt will be applied.");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 3: Run EWMA Walker - Neutral (no tilt) vs Biased (with tilt)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n───────────────────────────────────────────────────────────────");
  console.log("  Step 3: Compare Neutral vs Biased EWMA Walker");
  console.log("───────────────────────────────────────────────────────────────");

  // Run NEUTRAL (no tiltConfig)
  console.log("\n  Running NEUTRAL (μ = 0)...");
  const t1 = Date.now();
  const neutralResult = await runEwmaWalker({
    symbol,
    lambda: reactionConfig.lambda,
    coverage: reactionConfig.coverage,
    horizon,
    // NO tiltConfig
  });
  console.log(`    ✓ Completed in ${((Date.now() - t1) / 1000).toFixed(2)}s, ${neutralResult.points.length} points`);

  // Run BIASED (with tiltConfig)
  console.log("\n  Running BIASED (μ = μ_bucket)...");
  const t2 = Date.now();
  const biasedResult = await runEwmaWalker({
    symbol,
    lambda: tiltConfig.lambda,
    coverage: tiltConfig.coverage,
    horizon,
    tiltConfig, // <-- BIASED
  });
  console.log(`    ✓ Completed in ${((Date.now() - t2) / 1000).toFixed(2)}s, ${biasedResult.points.length} points`);

  // ─────────────────────────────────────────────────────────────────────────
  // Step 4: Compare Forecasts
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n───────────────────────────────────────────────────────────────");
  console.log("  Step 4: Compare Forecasts");
  console.log("───────────────────────────────────────────────────────────────");

  const neutralPoints = neutralResult.points;
  const biasedPoints = biasedResult.points;

  // Sanity check: same number of points
  if (neutralPoints.length !== biasedPoints.length) {
    console.log("  ⚠️  WARNING: Different point counts!");
    console.log("    Neutral:", neutralPoints.length);
    console.log("    Biased:", biasedPoints.length);
  }

  // Count how many forecasts differ
  let diffCount = 0;
  let maxDiff = 0;
  let sumDiff = 0;
  let exampleDiffs: { date: string; neutral: number; biased: number; diff: number }[] = [];

  const minLen = Math.min(neutralPoints.length, biasedPoints.length);
  for (let i = 0; i < minLen; i++) {
    const nPt = neutralPoints[i];
    const bPt = biasedPoints[i];

    const diff = Math.abs(bPt.y_hat_tp1 - nPt.y_hat_tp1);
    if (diff > 1e-9) {
      diffCount++;
      maxDiff = Math.max(maxDiff, diff);
      sumDiff += diff;

      if (exampleDiffs.length < 5) {
        exampleDiffs.push({
          date: nPt.date_t,
          neutral: nPt.y_hat_tp1,
          biased: bPt.y_hat_tp1,
          diff,
        });
      }
    }
  }

  const avgDiff = diffCount > 0 ? sumDiff / diffCount : 0;

  console.log(`\n  Forecast Comparison (${minLen} points):`);
  console.log(`    Points with y_hat difference: ${diffCount} / ${minLen} (${((diffCount / minLen) * 100).toFixed(1)}%)`);
  console.log(`    Max difference: $${maxDiff.toFixed(4)}`);
  console.log(`    Avg difference: $${avgDiff.toFixed(4)}`);

  if (exampleDiffs.length > 0) {
    console.log("\n  Example differences:");
    for (const ex of exampleDiffs) {
      console.log(`    ${ex.date}: neutral=$${ex.neutral.toFixed(2)} biased=$${ex.biased.toFixed(2)} diff=$${ex.diff.toFixed(4)}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 5: Compare OOS Forecasts
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n───────────────────────────────────────────────────────────────");
  console.log("  Step 5: Compare OOS Forecasts");
  console.log("───────────────────────────────────────────────────────────────");

  const neutralOos = neutralResult.oosForecast;
  const biasedOos = biasedResult.oosForecast;

  if (!neutralOos || !biasedOos) {
    console.log("  ⚠️  OOS forecast not available.");
  } else {
    console.log(`\n  Neutral OOS:`);
    console.log(`    originDate: ${neutralOos.originDate}`);
    console.log(`    targetDate: ${neutralOos.targetDate}`);
    console.log(`    S_t:        $${neutralOos.S_t.toFixed(2)}`);
    console.log(`    y_hat:      $${neutralOos.y_hat.toFixed(2)}`);
    console.log(`    L:          $${neutralOos.L.toFixed(2)}`);
    console.log(`    U:          $${neutralOos.U.toFixed(2)}`);

    console.log(`\n  Biased OOS:`);
    console.log(`    originDate: ${biasedOos.originDate}`);
    console.log(`    targetDate: ${biasedOos.targetDate}`);
    console.log(`    S_t:        $${biasedOos.S_t.toFixed(2)}`);
    console.log(`    y_hat:      $${biasedOos.y_hat.toFixed(2)}`);
    console.log(`    L:          $${biasedOos.L.toFixed(2)}`);
    console.log(`    U:          $${biasedOos.U.toFixed(2)}`);

    const oosDiff = Math.abs(biasedOos.y_hat - neutralOos.y_hat);
    if (oosDiff > 1e-9) {
      console.log(`\n  ✓ OOS y_hat differs by $${oosDiff.toFixed(4)}`);
    } else {
      console.log(`\n  ⚠️  OOS y_hat is the same (diff = $${oosDiff.toFixed(6)})`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════");

  const passed = diffCount > 0 && anyNonZero;
  if (passed) {
    console.log("\n  ✅ PASS: Biased EWMA produces different forecasts when μ ≠ 0");
  } else if (!anyNonZero) {
    console.log("\n  ⚠️  INCONCLUSIVE: All μ values are zero (no bias to apply)");
  } else {
    console.log("\n  ❌ FAIL: Biased and neutral forecasts are identical despite non-zero μ");
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
