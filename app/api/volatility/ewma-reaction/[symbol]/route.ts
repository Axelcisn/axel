/**
 * EWMA Reaction Map API
 *
 * GET /api/volatility/ewma-reaction/[symbol]
 *
 * Query params:
 *   - lambda?: EWMA decay factor (default 0.94)
 *   - coverage?: PI coverage (default 0.95)
 *   - trainFraction?: Train/test split fraction (default 0.7)
 *   - minTrainObs?: Minimum training observations (default 500)
 *   - horizons?: Comma-separated integers, e.g. "1,2,3" (default "1,2,3")
 *
 * Returns:
 *   { success: true, result: ReactionMapResult }
 *   or
 *   { success: false, error: string }
 */

import { NextResponse } from "next/server";
import {
  buildEwmaReactionMap,
  defaultReactionConfig,
  ReactionConfig,
} from "@/lib/volatility/ewmaReaction";

export async function GET(
  req: Request,
  { params }: { params: { symbol: string } }
) {
  try {
    const { symbol } = params;

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: "Symbol is required" },
        { status: 400 }
      );
    }

    const url = new URL(req.url);
    const lambdaParam = url.searchParams.get("lambda");
    const coverageParam = url.searchParams.get("coverage");
    const trainFractionParam = url.searchParams.get("trainFraction");
    const minTrainObsParam = url.searchParams.get("minTrainObs");
    const horizonsParam = url.searchParams.get("horizons");

    const config: ReactionConfig = {
      ...defaultReactionConfig,
    };

    if (lambdaParam) {
      const val = parseFloat(lambdaParam);
      if (Number.isFinite(val) && val > 0 && val < 1) {
        config.lambda = val;
      }
    }

    if (coverageParam) {
      const val = parseFloat(coverageParam);
      if (Number.isFinite(val) && val > 0 && val < 1) {
        config.coverage = val;
      }
    }

    if (trainFractionParam) {
      const val = parseFloat(trainFractionParam);
      if (Number.isFinite(val)) {
        config.trainFraction = Math.min(0.95, Math.max(0.05, val));
      }
    }

    if (minTrainObsParam) {
      const val = parseInt(minTrainObsParam, 10);
      if (Number.isFinite(val) && val > 0) {
        config.minTrainObs = val;
      }
    }

    if (horizonsParam) {
      const horizons = horizonsParam
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((h) => Number.isFinite(h) && h > 0);
      if (horizons.length > 0) {
        config.horizons = horizons;
      }
    }

    const result = await buildEwmaReactionMap(symbol.toUpperCase(), config);

    return NextResponse.json({ success: true, result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[EWMA REACTION API ERROR]", message);
    return NextResponse.json(
      {
        success: false,
        error: message || "Failed to build EWMA reaction map",
      },
      { status: 500 }
    );
  }
}
