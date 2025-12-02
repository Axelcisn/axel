import { NextRequest, NextResponse } from "next/server";
import {
  defaultReactionConfig,
  buildEwmaReactionMap,
  buildEwmaTiltConfigFromReactionMap,
} from "@/lib/volatility/ewmaReaction";
import {
  runEwmaWalker,
  summarizeEwmaWalkerResults,
} from "@/lib/volatility/ewmaWalker";

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = (params.symbol || "").toUpperCase();
    const sp = request.nextUrl.searchParams;

    const horizon = Number(sp.get("h") ?? "1");
    const coverage = Number(sp.get("coverage") ?? "0.95");
    const shrinkFactor = Number(sp.get("shrinkFactor") ?? "0.5");
    const minTrainObs = Number(sp.get("minTrainObs") ?? "500");

    // Lambda grid
    const lambdaMin = Number(sp.get("lambdaMin") ?? "0.01");
    const lambdaMax = Number(sp.get("lambdaMax") ?? "0.99");
    const lambdaStep = Number(sp.get("lambdaStep") ?? "0.01");

    // Train% grid
    const trainMin = Number(sp.get("trainMin") ?? "0.50");
    const trainMax = Number(sp.get("trainMax") ?? "0.95");
    const trainStep = Number(sp.get("trainStep") ?? "0.01");

    console.log(`[EWMA Optimize] Starting grid search for ${symbol}`);
    console.log(`  Horizon: ${horizon}, Coverage: ${coverage}`);
    console.log(`  Lambda: [${lambdaMin}, ${lambdaMax}] step ${lambdaStep}`);
    console.log(`  Train%: [${trainMin}, ${trainMax}] step ${trainStep}`);

    let best = {
      lambda: 0,
      trainFraction: 0,
      directionHitRate: -Infinity,
      coverage: 0,
      intervalScore: Infinity,
      avgWidth: 0,
    };

    let testedCombos = 0;
    let skippedCombos = 0;

    // Brute force grid search
    for (let l = lambdaMin; l <= lambdaMax + 1e-9; l += lambdaStep) {
      const lambda = Math.round(Math.min(Math.max(l, 0.01), 0.99) * 100) / 100;

      for (let t = trainMin; t <= trainMax + 1e-9; t += trainStep) {
        const trainFraction = Math.round(Math.min(Math.max(t, 0.01), 0.99) * 100) / 100;

        const reactionConfig = {
          ...defaultReactionConfig,
          lambda,
          coverage,
          trainFraction,
          minTrainObs,
          horizons: [horizon],
        };

        // Build Reaction Map and skip combos with insufficient data
        const reactionMap = await buildEwmaReactionMap(symbol, reactionConfig);
        const { nTrain, nTest } = reactionMap.meta;
        if (nTrain < minTrainObs || nTest <= 0) {
          skippedCombos++;
          continue;
        }

        const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, {
          shrinkFactor,
          horizon,
        });

        const walker = await runEwmaWalker({
          symbol,
          lambda,
          coverage,
          horizon,
          tiltConfig,
        });

        const summary = summarizeEwmaWalkerResults(walker);
        const hit = summary.directionHitRate;

        testedCombos++;

        if (hit > best.directionHitRate) {
          best = {
            lambda,
            trainFraction,
            directionHitRate: hit,
            coverage: summary.coverage,
            intervalScore: summary.intervalScore,
            avgWidth: summary.avgWidth,
          };
          console.log(`  New best: λ=${lambda.toFixed(2)}, train=${(trainFraction * 100).toFixed(0)}%, hit=${(hit * 100).toFixed(2)}%`);
        }
      }
    }

    console.log(`[EWMA Optimize] Done. Tested ${testedCombos} combos, skipped ${skippedCombos}.`);

    if (best.directionHitRate === -Infinity) {
      return NextResponse.json(
        {
          success: false,
          error: "No valid grid points (train/test too small).",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      symbol,
      horizon,
      coverage,
      testedCombos,
      skippedCombos,
      best,
    });
  } catch (err: unknown) {
    console.error("[EWMA Optimize API] error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
