/**
 * Smoke-test script for EWMA Reaction Map module
 * 
 * Usage:
 *   npx tsx test-ewma-reaction.ts [SYMBOL]
 *   npm run test:ewma-reaction -- [SYMBOL]
 * 
 * Example:
 *   npx tsx test-ewma-reaction.ts AAPL
 */

import { 
  buildEwmaReactionMap, 
  defaultReactionConfig, 
  ReactionBucketForwardStats 
} from "./lib/volatility/ewmaReaction";

async function main() {
  const symbol = process.argv[2] || "AAPL";

  const config = {
    ...defaultReactionConfig,
    trainFraction: 0.7,      // 70% train / 30% test
    horizons: [1, 2],        // keep it simple at first
  };

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  EWMA Reaction Map Smoke Test");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("\nSymbol:", symbol);
  console.log("\nConfig:");
  console.log("  lambda:        ", config.lambda);
  console.log("  coverage:      ", config.coverage);
  console.log("  horizons:      ", config.horizons);
  console.log("  trainFraction: ", config.trainFraction);
  console.log("  minTrainObs:   ", config.minTrainObs);
  console.log("\nZ-Buckets:");
  for (const b of config.zBuckets) {
    const minStr = b.min === -Infinity ? "-∞" : b.min.toFixed(1);
    const maxStr = b.max === Infinity ? "+∞" : b.max.toFixed(1);
    console.log(`  ${b.id.padEnd(10)} : [${minStr}, ${maxStr})`);
  }

  console.log("\n───────────────────────────────────────────────────────────────");
  console.log("  Building Reaction Map...");
  console.log("───────────────────────────────────────────────────────────────");

  const startTime = Date.now();
  const result = await buildEwmaReactionMap(symbol, config);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n✓ Completed in ${elapsed}s`);

  console.log("\n───────────────────────────────────────────────────────────────");
  console.log("  Train / Test Split");
  console.log("───────────────────────────────────────────────────────────────");
  console.log("  Train:", result.meta.trainStart, "→", result.meta.trainEnd, `(n=${result.meta.nTrain})`);
  console.log("  Test :", result.meta.testStart, "→", result.meta.testEnd, `(n=${result.meta.nTest})`);
  
  const actualTrainFrac = result.meta.nTrain / (result.meta.nTrain + result.meta.nTest);
  console.log(`  Actual split: ${(actualTrainFrac * 100).toFixed(1)}% train / ${((1 - actualTrainFrac) * 100).toFixed(1)}% test`);

  // Group stats by bucket
  const grouped: Record<string, ReactionBucketForwardStats[]> = {};
  for (const s of result.stats) {
    const key = s.bucketId;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(s);
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Forward Return Stats by Bucket & Horizon");
  console.log("═══════════════════════════════════════════════════════════════");

  // Order buckets logically
  const bucketOrder = ["bigDown", "medDown", "normal", "medUp", "bigUp"];
  
  for (const bucketId of bucketOrder) {
    if (!grouped[bucketId]) {
      console.log(`\n┌─ Bucket: ${bucketId}`);
      console.log("│  (no observations)");
      continue;
    }
    
    const bucketStats = grouped[bucketId].sort((a, b) => a.horizon - b.horizon);

    console.log(`\n┌─ Bucket: ${bucketId}`);
    console.log("│");
    console.log("│  h   nObs    pUp      mean      std      q10      q50      q90");
    console.log("│  ─────────────────────────────────────────────────────────────");
    
    for (const s of bucketStats) {
      const line = 
        `│  ${s.horizon}  ` +
        `${s.nObs.toString().padStart(5, " ")}  ` +
        `${(s.pUp * 100).toFixed(1).padStart(5, " ")}%  ` +
        `${(s.meanReturn * 100).toFixed(3).padStart(7, " ")}%  ` +
        `${(s.stdReturn * 100).toFixed(3).padStart(6, " ")}%  ` +
        `${(s.q10 * 100).toFixed(3).padStart(7, " ")}%  ` +
        `${(s.q50 * 100).toFixed(3).padStart(7, " ")}%  ` +
        `${(s.q90 * 100).toFixed(3).padStart(7, " ")}%`;
      console.log(line);
    }
  }

  // Summary stats
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Summary");
  console.log("═══════════════════════════════════════════════════════════════");
  
  const totalObs = result.stats.reduce((sum, s) => sum + s.nObs, 0) / config.horizons.length;
  console.log(`  Total classified observations: ~${Math.round(totalObs)}`);
  
  // Check bucket distribution for h=1
  const h1Stats = result.stats.filter(s => s.horizon === 1);
  console.log("\n  Bucket distribution (h=1):");
  for (const bucketId of bucketOrder) {
    const stat = h1Stats.find(s => s.bucketId === bucketId);
    if (stat) {
      const pct = (stat.nObs / totalObs * 100).toFixed(1);
      console.log(`    ${bucketId.padEnd(10)}: ${stat.nObs.toString().padStart(5)} obs (${pct.padStart(5)}%)`);
    }
  }

  console.log("\n───────────────────────────────────────────────────────────────");
  console.log("  ✓ Smoke test completed successfully");
  console.log("───────────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("\n❌ EWMA Reaction test failed:");
  console.error(err);
  process.exit(1);
});
