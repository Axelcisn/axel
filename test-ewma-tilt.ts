/**
 * EWMA Tilt Simulation Test Script
 *
 * Compares baseline EWMA (μ=0) vs tilted EWMA (μ=μ_bucket) on out-of-sample data.
 *
 * Usage:
 *   npx tsx test-ewma-tilt.ts [SYMBOL]
 *   npm run test:ewma-tilt -- [SYMBOL]
 *
 * Example:
 *   npx tsx test-ewma-tilt.ts AAPL
 */

import { defaultReactionConfig, ZBucketId } from "./lib/volatility/ewmaReaction";
import { runEwmaTiltSimulation, EwmaTiltPoint } from "./lib/volatility/ewmaTilt";

async function main() {
  const symbol = process.argv[2] || "AAPL";

  const reactionConfig = {
    ...defaultReactionConfig,
    trainFraction: 0.7,
    horizons: [1], // we only use h=1 for tilt
  };

  const shrinkFactor = 0.5;

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  EWMA Tilt Simulation Test");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("\nSymbol:", symbol);
  console.log("\nConfig:");
  console.log("  lambda:        ", reactionConfig.lambda);
  console.log("  coverage:      ", reactionConfig.coverage);
  console.log("  trainFraction: ", reactionConfig.trainFraction);
  console.log("  minTrainObs:   ", reactionConfig.minTrainObs);
  console.log("  shrinkFactor:  ", shrinkFactor);

  console.log("\n───────────────────────────────────────────────────────────────");
  console.log("  Running Tilt Simulation...");
  console.log("───────────────────────────────────────────────────────────────");

  const startTime = Date.now();
  const result = await runEwmaTiltSimulation(symbol, reactionConfig, shrinkFactor);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n✓ Completed in ${elapsed}s`);

  console.log("\n───────────────────────────────────────────────────────────────");
  console.log("  Train / Test Split");
  console.log("───────────────────────────────────────────────────────────────");
  console.log("  Train:", result.meta.trainStart, "→", result.meta.trainEnd, `(n=${result.meta.nTrain})`);
  console.log("  Test :", result.meta.testStart, "→", result.meta.testEnd, `(n=${result.meta.nTest})`);

  console.log("\n───────────────────────────────────────────────────────────────");
  console.log("  Tilt Config (μ by bucket, after shrinkage)");
  console.log("───────────────────────────────────────────────────────────────");
  const bucketOrder: ZBucketId[] = ["bigDown", "medDown", "normal", "medUp", "bigUp"];
  for (const bucketId of bucketOrder) {
    const mu = result.tiltConfig.muByBucket[bucketId];
    const muStr = mu != null ? (mu * 100).toFixed(4) + "%" : "(n/a)";
    console.log(`  ${bucketId.padEnd(10)}: μ = ${muStr}`);
  }

  const points = result.points;

  // ─────────────────────────────────────────────────────────────────────────
  // Compute summary metrics
  // ─────────────────────────────────────────────────────────────────────────
  let n = 0;
  let sumAbsZBase = 0;
  let sumAbsZTilt = 0;
  let sumZBase = 0;
  let sumZTilt = 0;
  let sumZ2Base = 0;
  let sumZ2Tilt = 0;
  let dirHitsBase = 0;
  let dirHitsTilt = 0;
  let insideBase = 0;
  let insideTilt = 0;

  // Track by bucket
  const bucketStats: Record<ZBucketId, {
    n: number;
    dirHitsBase: number;
    dirHitsTilt: number;
    sumReturnWhenTilted: number;
  }> = {
    bigDown: { n: 0, dirHitsBase: 0, dirHitsTilt: 0, sumReturnWhenTilted: 0 },
    medDown: { n: 0, dirHitsBase: 0, dirHitsTilt: 0, sumReturnWhenTilted: 0 },
    normal: { n: 0, dirHitsBase: 0, dirHitsTilt: 0, sumReturnWhenTilted: 0 },
    medUp: { n: 0, dirHitsBase: 0, dirHitsTilt: 0, sumReturnWhenTilted: 0 },
    bigUp: { n: 0, dirHitsBase: 0, dirHitsTilt: 0, sumReturnWhenTilted: 0 },
  };

  for (const p of points) {
    n++;
    sumAbsZBase += Math.abs(p.z_error_baseline);
    sumAbsZTilt += Math.abs(p.z_error_tilted);
    sumZBase += p.z_error_baseline;
    sumZTilt += p.z_error_tilted;
    sumZ2Base += p.z_error_baseline * p.z_error_baseline;
    sumZ2Tilt += p.z_error_tilted * p.z_error_tilted;
    if (p.dirCorrect_baseline) dirHitsBase++;
    if (p.dirCorrect_tilted) dirHitsTilt++;
    if (p.insidePi_baseline) insideBase++;
    if (p.insidePi_tilted) insideTilt++;

    // Per-bucket stats
    if (p.bucketId && bucketStats[p.bucketId]) {
      const bs = bucketStats[p.bucketId];
      bs.n++;
      if (p.dirCorrect_baseline) bs.dirHitsBase++;
      if (p.dirCorrect_tilted) bs.dirHitsTilt++;
      bs.sumReturnWhenTilted += p.realizedLogReturn;
    }
  }

  const meanZBase = sumZBase / n;
  const meanZTilt = sumZTilt / n;
  const stdZBase = Math.sqrt(sumZ2Base / n - meanZBase * meanZBase);
  const stdZTilt = Math.sqrt(sumZ2Tilt / n - meanZTilt * meanZTilt);

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Results on Test Sample (n=" + n + ")");
  console.log("═══════════════════════════════════════════════════════════════");

  console.log("\n┌─ Z-Error Statistics");
  console.log("│");
  console.log("│  Metric              Baseline      Tilted       Δ");
  console.log("│  ────────────────────────────────────────────────────────────");
  console.log(
    "│  Mean |z|          " +
      (sumAbsZBase / n).toFixed(4).padStart(8) +
      "    " +
      (sumAbsZTilt / n).toFixed(4).padStart(8) +
      "    " +
      ((sumAbsZTilt / n - sumAbsZBase / n) * 100).toFixed(2).padStart(6) +
      "%"
  );
  console.log(
    "│  Mean z             " +
      meanZBase.toFixed(4).padStart(7) +
      "    " +
      meanZTilt.toFixed(4).padStart(8) +
      "    " +
      ((meanZTilt - meanZBase)).toFixed(4).padStart(7)
  );
  console.log(
    "│  Std z              " +
      stdZBase.toFixed(4).padStart(7) +
      "    " +
      stdZTilt.toFixed(4).padStart(8) +
      "    " +
      ((stdZTilt - stdZBase)).toFixed(4).padStart(7)
  );

  console.log("\n┌─ Direction Hit-Rate");
  console.log("│");
  console.log(
    "│  Baseline:  " +
      ((dirHitsBase / n) * 100).toFixed(2) +
      "% (" +
      dirHitsBase +
      "/" +
      n +
      ")"
  );
  console.log(
    "│  Tilted:    " +
      ((dirHitsTilt / n) * 100).toFixed(2) +
      "% (" +
      dirHitsTilt +
      "/" +
      n +
      ")"
  );
  const dirDelta = ((dirHitsTilt - dirHitsBase) / n) * 100;
  console.log("│  Δ:         " + (dirDelta >= 0 ? "+" : "") + dirDelta.toFixed(2) + " pp");

  console.log("\n┌─ PI Coverage (target: " + (reactionConfig.coverage * 100).toFixed(0) + "%)");
  console.log("│");
  console.log(
    "│  Baseline:  " +
      ((insideBase / n) * 100).toFixed(2) +
      "% (" +
      insideBase +
      "/" +
      n +
      ")"
  );
  console.log(
    "│  Tilted:    " +
      ((insideTilt / n) * 100).toFixed(2) +
      "% (" +
      insideTilt +
      "/" +
      n +
      ")"
  );
  const covDelta = ((insideTilt - insideBase) / n) * 100;
  console.log("│  Δ:         " + (covDelta >= 0 ? "+" : "") + covDelta.toFixed(2) + " pp");

  console.log("\n───────────────────────────────────────────────────────────────");
  console.log("  Direction Hit-Rate by Bucket");
  console.log("───────────────────────────────────────────────────────────────");
  console.log("  Bucket       n     Base     Tilt      Δ");
  console.log("  ────────────────────────────────────────────────────────────");

  for (const bucketId of bucketOrder) {
    const bs = bucketStats[bucketId];
    if (bs.n === 0) {
      console.log(`  ${bucketId.padEnd(10)}   0      -        -       -`);
      continue;
    }
    const baseRate = (bs.dirHitsBase / bs.n) * 100;
    const tiltRate = (bs.dirHitsTilt / bs.n) * 100;
    const delta = tiltRate - baseRate;
    console.log(
      `  ${bucketId.padEnd(10)} ${bs.n.toString().padStart(4)}   ` +
        `${baseRate.toFixed(1).padStart(5)}%   ` +
        `${tiltRate.toFixed(1).padStart(5)}%   ` +
        `${(delta >= 0 ? "+" : "") + delta.toFixed(1).padStart(5)} pp`
    );
  }

  console.log("\n───────────────────────────────────────────────────────────────");
  console.log("  ✓ Tilt simulation completed successfully");
  console.log("───────────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("\n❌ EWMA tilt test failed:");
  console.error(err);
  process.exit(1);
});
