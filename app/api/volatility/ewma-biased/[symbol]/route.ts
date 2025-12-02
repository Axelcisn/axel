/**
 * EWMA Biased API Route
 *
 * Builds a Reaction Map for the requested horizon & coverage,
 * derives an EwmaTiltConfig from it, and runs EWMA Walker with that tilt.
 *
 * GET /api/volatility/ewma-biased/[symbol]
 *
 * Query params:
 *   - lambda: EWMA decay factor (default 0.94)
 *   - coverage: PI coverage (default 0.95)
 *   - h: Forecast horizon in trading days (default 1)
 *   - trainFraction: Train/test split fraction (default 0.7)
 *   - minTrainObs: Minimum training observations (default 500)
 *   - shrinkFactor: Shrinkage factor for tilt (default 0.5)
 */

import { NextRequest, NextResponse } from "next/server";
import { runEwmaWalker, summarizeEwmaWalkerResults } from "@/lib/volatility/ewmaWalker";
import {
  defaultReactionConfig,
  buildEwmaReactionMap,
  buildEwmaTiltConfigFromReactionMap,
} from "@/lib/volatility/ewmaReaction";

interface RouteParams {
  params: { symbol: string };
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const symbol = (params.symbol || "").toUpperCase();
    if (!symbol) {
      return NextResponse.json(
        { success: false, error: "Symbol is required" },
        { status: 400 }
      );
    }

    const searchParams = request.nextUrl.searchParams;

    const lambdaParam = searchParams.get("lambda");
    const coverageParam = searchParams.get("coverage");
    const horizonParam = searchParams.get("h");
    const trainFractionParam = searchParams.get("trainFraction");
    const minTrainObsParam = searchParams.get("minTrainObs");
    const shrinkFactorParam = searchParams.get("shrinkFactor");

    const lambda = lambdaParam ? Number(lambdaParam) : 0.94;
    const coverage = coverageParam ? Number(coverageParam) : 0.95;
    const horizon = horizonParam ? Number(horizonParam) : 1;
    const trainFraction = trainFractionParam ? Number(trainFractionParam) : 0.7;
    const minTrainObs = minTrainObsParam ? Number(minTrainObsParam) : 500;
    const shrinkFactor = shrinkFactorParam ? Number(shrinkFactorParam) : 0.5;

    // Validate parameters
    if (isNaN(lambda) || lambda <= 0 || lambda >= 1) {
      return NextResponse.json(
        { success: false, error: "lambda must be between 0 and 1" },
        { status: 400 }
      );
    }
    if (isNaN(coverage) || coverage <= 0 || coverage >= 1) {
      return NextResponse.json(
        { success: false, error: "coverage must be between 0 and 1" },
        { status: 400 }
      );
    }
    if (isNaN(horizon) || horizon < 1) {
      return NextResponse.json(
        { success: false, error: "h (horizon) must be at least 1" },
        { status: 400 }
      );
    }

    // 1) Build Reaction Map on train sample for this horizon
    const reactionConfig = {
      ...defaultReactionConfig,
      lambda,
      coverage,
      trainFraction,
      minTrainObs,
      horizons: [horizon],
    };

    const reactionMap = await buildEwmaReactionMap(symbol, reactionConfig);

    // 2) Turn it into a tilt config for this horizon
    const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, {
      shrinkFactor,
      horizon,
    });

    // 3) Run EWMA walker with tiltConfig for full sample
    const result = await runEwmaWalker({
      symbol,
      lambda,
      coverage,
      horizon,
      tiltConfig,
    });

    const summary = summarizeEwmaWalkerResults(result);

    return NextResponse.json({
      success: true,
      symbol,
      horizon,
      tiltConfig,
      points: result.points,
      piMetrics: {
        empiricalCoverage: summary.coverage,
        coverage: summary.targetCoverage,
        intervalScore: summary.intervalScore,
        avgWidth: summary.avgWidth,
        nPoints: summary.nPoints,
      },
      zMean: summary.zMean,
      zStd: summary.zStd,
      directionHitRate: summary.directionHitRate,
      volatilityStats: summary.volatilityStats,
      dateRange: summary.dateRange,
      params: result.params,
      oosForecast: result.oosForecast ?? null,
      reactionMeta: reactionMap.meta,
    });
  } catch (error: unknown) {
    console.error("[EWMA Biased API] Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
