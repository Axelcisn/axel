import { NextRequest, NextResponse } from "next/server";
import { defaultReactionConfig, buildEwmaReactionMap, buildEwmaTiltConfigFromReactionMap } from "@/lib/volatility/ewmaReaction";
import { runEwmaWalker } from "@/lib/volatility/ewmaWalker";
import { ensureCanonicalOrHistory } from "@/lib/storage/canonical";
import { optimizeZHysteresisThresholds } from "@/lib/volatility/zWfoOptimize";
import { Trading212CfdConfig } from "@/lib/backtest/trading212Cfd";

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = (params.symbol || "").toUpperCase();
    if (!symbol) {
      return NextResponse.json(
        { success: false, error: "Symbol is required" },
        { status: 400 }
      );
    }

    const sp = request.nextUrl.searchParams;

    const horizonRaw = Number(sp.get("h") ?? "1");
    const horizon = Number.isFinite(horizonRaw) && horizonRaw >= 1 ? Math.floor(horizonRaw) : 1;
    const lambda = Number(sp.get("lambda") ?? "0.94");
    const coverage = Number(sp.get("coverage") ?? "0.95");
    const trainFraction = Number(sp.get("trainFraction") ?? "0.7");
    const minTrainObs = Number(sp.get("minTrainObs") ?? "500");
    const shrinkFactor = Number(sp.get("shrinkFactor") ?? "0.5");

    const trainLenRaw = Number(sp.get("trainLenBars") ?? "252");
    const valLenRaw = Number(sp.get("valLenBars") ?? "63");
    const stepLenRaw = Number(sp.get("stepLenBars") ?? "63");
    const trainLen = Number.isFinite(trainLenRaw) && trainLenRaw > 0 ? Math.floor(trainLenRaw) : 252;
    const valLen = Number.isFinite(valLenRaw) && valLenRaw > 0 ? Math.floor(valLenRaw) : 63;
    const stepLen = Number.isFinite(stepLenRaw) && stepLenRaw > 0 ? Math.floor(stepLenRaw) : 63;

    const minShortOppPerFoldRaw = Number(sp.get("minShortOppPerFold") ?? "1");
    const initialEquityRaw = Number(sp.get("initialEquity") ?? "5000");
    const leverageRaw = Number(sp.get("leverage") ?? "5");
    const positionFractionRaw = Number(sp.get("positionFraction") ?? "0.25");
    const spreadBpsRaw = Number(sp.get("costBps") ?? "0");

    const parseList = (key: string, fallback: number[]) => {
      const raw = sp.get(key);
      if (!raw) return fallback;
      const parts = raw
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isFinite(v) && v > 0 && v < 1);
      return parts.length ? parts : fallback;
    };

    const quantilesEnter = parseList("qEnter", [0.8, 0.85, 0.9, 0.95]);
    const quantilesExit = parseList("qExit", [0.4, 0.5, 0.6, 0.7]);
    const quantilesFlip = parseList("qFlip", [0.95, 0.97, 0.99]);

    if (horizon < 1) {
      return NextResponse.json(
        { success: false, error: "h (horizon) must be >= 1" },
        { status: 400 }
      );
    }

    const reactionConfig = {
      ...defaultReactionConfig,
      lambda,
      coverage,
      trainFraction,
      minTrainObs,
      horizons: [horizon],
    };

    const reactionMap = await buildEwmaReactionMap(symbol, reactionConfig);
    const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor, horizon });
    const ewmaResult = await runEwmaWalker({
      symbol,
      lambda,
      coverage,
      horizon,
      tiltConfig,
    });

    const { rows } = await ensureCanonicalOrHistory(symbol, { interval: "1d", minRows: 260 });

    const tradingConfig: Trading212CfdConfig = {
      leverage: Number.isFinite(leverageRaw) && leverageRaw > 0 ? leverageRaw : 5,
      fxFeeRate: 0.005,
      dailyLongSwapRate: 0,
      dailyShortSwapRate: 0,
      spreadBps: Number.isFinite(spreadBpsRaw) ? spreadBpsRaw : 0,
      marginCallLevel: 0.45,
      stopOutLevel: 0.25,
      positionFraction: Number.isFinite(positionFractionRaw) && positionFractionRaw > 0 ? positionFractionRaw : 0.25,
    };

    const result = await optimizeZHysteresisThresholds({
      symbol,
      horizon,
      ewmaPath: ewmaResult.points,
      canonicalRows: rows,
      simStartDate: reactionMap.meta.testStart ?? null,
      trainLen,
      valLen,
      stepLen,
      quantilesEnter,
      quantilesExit,
      quantilesFlip,
      tradingConfig,
      initialEquity: Number.isFinite(initialEquityRaw) && initialEquityRaw > 0 ? initialEquityRaw : 5000,
    });

    return NextResponse.json({
      success: true,
      symbol,
      horizon,
      best: result.best,
      foldSummaries: result.foldSummaries,
      zEdgeSamples: result.zEdgeSamples,
      reactionMeta: reactionMap.meta,
    });
  } catch (err: unknown) {
    console.error("[Z-Threshold Optimize] error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
