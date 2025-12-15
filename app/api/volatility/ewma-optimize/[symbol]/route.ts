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

function quantile(arr: number[], q: number): number {
  if (!arr.length) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

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
    const zEnterManual = Number(sp.get("zEnter") ?? "0.3");
    const zModeParam = (sp.get("zMode") ?? "auto").toString().toLowerCase();
    const zMode: "auto" | "manual" = zModeParam === "manual" ? "manual" : "auto";

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

    // Candidate type for storing all valid combos (includes neutral metrics for comparison)
    type Candidate = {
      lambda: number;
      trainFraction: number;
      directionHitRate: number;       // biased
      coverage: number;               // biased
      intervalScore: number;          // biased
      avgWidth: number;               // biased
      neutralDirectionHitRate: number;
      neutralIntervalScore: number;
      zEnterUsed: number;
      shortOpportunityRate: number;
      score: number;
    };

    const candidates: Candidate[] = [];

    // Cache neutral EWMA metrics per λ (computed once per λ, reused across train fractions)
    const neutralByLambda = new Map<
      number,
      {
        directionHitRate: number;
        intervalScore: number;
        coverage: number;
        avgWidth: number;
      }
    >();

    let testedCombos = 0;
    let skippedCombos = 0;

    const minShortRate = 0.01;
    const penaltyWeight = 1.0;

    // Brute force grid search
    for (let l = lambdaMin; l <= lambdaMax + 1e-9; l += lambdaStep) {
      const lambda = Math.round(Math.min(Math.max(l, 0.01), 0.99) * 100) / 100;

      // Compute neutral EWMA metrics once per λ (no tilt config)
      let neutralMetrics = neutralByLambda.get(lambda);
      if (!neutralMetrics) {
        const neutralWalker = await runEwmaWalker({
          symbol,
          lambda,
          coverage,
          horizon,
        });
        const neutralSummary = summarizeEwmaWalkerResults(neutralWalker);

        neutralMetrics = {
          directionHitRate: neutralSummary.directionHitRate,
          intervalScore: neutralSummary.intervalScore,
          coverage: neutralSummary.coverage,
          avgWidth: neutralSummary.avgWidth,
        };
        neutralByLambda.set(lambda, neutralMetrics);
        console.log(`  Neutral λ=${lambda.toFixed(2)}: hit=${(neutralMetrics.directionHitRate * 100).toFixed(2)}%, score=${neutralMetrics.intervalScore.toFixed(4)}`);
      }

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
        const sqrtH = Math.sqrt(horizon);
        const trainStart = reactionMap.meta.trainStart;
        const trainEnd = reactionMap.meta.trainEnd;
        const edgeSample = walker.points
          .filter((p) => !trainStart || (p.date_t >= trainStart && p.date_t <= trainEnd))
          .map((p) => {
            const muBase = Math.log(p.y_hat_tp1 / p.S_t);
            const sigmaH = p.sigma_t * sqrtH;
            if (!Number.isFinite(muBase) || !Number.isFinite(sigmaH) || sigmaH <= 0) return NaN;
            return muBase / sigmaH;
          })
          .filter((z): z is number => Number.isFinite(z));

        const edgesForPenalty =
          edgeSample.length > 0
            ? edgeSample
            : walker.points
                .map((p) => {
                  const muBase = Math.log(p.y_hat_tp1 / p.S_t);
                  const sigmaH = p.sigma_t * sqrtH;
                  if (!Number.isFinite(muBase) || !Number.isFinite(sigmaH) || sigmaH <= 0) return NaN;
                  return muBase / sigmaH;
                })
                .filter((z): z is number => Number.isFinite(z));

        const absEdges = edgesForPenalty.map((z) => Math.abs(z));
        let zEnterUsed = zEnterManual;
        if (zMode === "auto") {
          const q = quantile(absEdges, 0.9);
          if (Number.isFinite(q)) {
            zEnterUsed = q;
          }
        }
        const shortOpportunityRate =
          edgesForPenalty.length > 0
            ? edgesForPenalty.filter((z) => z <= -zEnterUsed).length / edgesForPenalty.length
            : 0;
        const shortPenalty = Math.max(0, minShortRate - shortOpportunityRate);
        const score = hit - penaltyWeight * shortPenalty;

        testedCombos++;

        // Grab neutral metrics for this λ (already computed above)
        const neutral = neutralByLambda.get(lambda)!;

        // Push every valid combo into candidates array
        candidates.push({
          lambda,
          trainFraction,
          directionHitRate: hit,
          coverage: summary.coverage,
          intervalScore: summary.intervalScore,
          avgWidth: summary.avgWidth,
          neutralDirectionHitRate: neutral.directionHitRate,
          neutralIntervalScore: neutral.intervalScore,
          zEnterUsed,
          shortOpportunityRate,
          score,
        });

        if (testedCombos % 10 === 0) {
          console.log(`  Tested ${testedCombos} combos, latest: λ=${lambda.toFixed(2)}, train=${(trainFraction * 100).toFixed(0)}%, hit=${(hit * 100).toFixed(2)}%`);
        }
      }
    }

    console.log(`[EWMA Optimize] Done. Tested ${testedCombos} combos, skipped ${skippedCombos}.`);

    if (candidates.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "No valid grid points (train/test too small).",
        },
        { status: 400 }
      );
    }

    // Sort descending by penalized score, then hit-rate as tie-breaker
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.directionHitRate - a.directionHitRate;
    });

    // Keep top N (e.g. 10)
    const topCandidates = candidates.slice(0, 10);
    const best = topCandidates[0];

    // Neutral baseline for the best λ (so UI can show a "Rank 0" row)
    const neutralMetricsForBest = neutralByLambda.get(best.lambda);
    const neutralBaseline = neutralMetricsForBest
      ? {
          lambda: best.lambda,
          directionHitRate: neutralMetricsForBest.directionHitRate,
          intervalScore: neutralMetricsForBest.intervalScore,
          coverage: neutralMetricsForBest.coverage,
          avgWidth: neutralMetricsForBest.avgWidth,
        }
      : null;

    console.log(
      `  Best: λ=${best.lambda.toFixed(2)}, train=${(best.trainFraction * 100).toFixed(
        0
      )}%, hit=${(best.directionHitRate * 100).toFixed(2)}%, shortOpp=${(best.shortOpportunityRate * 100).toFixed(2)}%, zEnter=${best.zEnterUsed.toFixed(3)}`
    );

    return NextResponse.json({
      success: true,
      symbol,
      horizon,
      coverage,
      testedCombos,
      skippedCombos,
      best,
      candidates: topCandidates,
      neutralBaseline,
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
