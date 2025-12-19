import { NextRequest, NextResponse } from "next/server";
import { defaultReactionConfig, buildEwmaReactionMap, buildEwmaTiltConfigFromReactionMap } from "@/lib/volatility/ewmaReaction";
import { runEwmaWalker } from "@/lib/volatility/ewmaWalker";
import { ensureCanonicalOrHistory } from "@/lib/storage/canonical";
import { optimizeZHysteresisThresholds } from "@/lib/volatility/zWfoOptimize";
import { Trading212CfdConfig } from "@/lib/backtest/trading212Cfd";
import {
  buildZWfoThresholdCacheKey,
  getZWfoThresholdCache,
  setZWfoThresholdCache,
} from "@/lib/cache/zWfoThresholdCache";

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
    const shrinkFactorRaw = Number(sp.get("shrinkFactor") ?? "0.5");

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
    const minFlatPctRaw = Number(sp.get("minFlatPct") ?? "2");
    const minClosesRaw = Number(sp.get("minCloses") ?? "1");
    const maxFlipPctRaw = sp.get("maxFlipPct");
    const flipGammaRaw = Number(sp.get("flipGamma") ?? "0.0");
    const tradeEtaRaw = Number(sp.get("tradeEta") ?? "0.0");
    const allowStale = sp.get("allowStale") === "1" || sp.get("allowStale") === "true";
    const minOpensLast63Raw = Number(sp.get("minOpensLast63") ?? "1");
    const minFlatPctLast63Raw = Number(sp.get("minFlatPctLast63") ?? "1");
    const recencyBarsRaw = (sp.get("recencyBars") ?? "").split(",").map((v) => Number(v.trim()));
    const recencyBars63Raw = Number.isFinite(recencyBarsRaw[0]) ? recencyBarsRaw[0] : Number(sp.get("recencyBars63") ?? "63");
    const recencyBars252Raw = Number.isFinite(recencyBarsRaw[1]) ? recencyBarsRaw[1] : Number(sp.get("recencyBars252") ?? "252");
    const enforceRecency = sp.get("enforceRecency") !== "0";

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
    const shrinkFactor = Number.isFinite(shrinkFactorRaw) ? shrinkFactorRaw : 0.5;
    const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor, horizon });
    const ewmaResult = await runEwmaWalker({
      symbol,
      lambda,
      coverage,
      horizon,
      tiltConfig,
    });

    const { rows } = await ensureCanonicalOrHistory(symbol, { interval: "1d", minRows: 260 });
    const dataEndUsed = rows.length ? rows[rows.length - 1].date : null;
    if (!dataEndUsed) {
      throw new Error(`Unable to determine dataEnd for ${symbol}`);
    }
    const tradingDays = rows.map((r) => r.date).filter((d): d is string => !!d);

    const minFlatPct = Number.isFinite(minFlatPctRaw) ? minFlatPctRaw : 2;
    const minCloses = Number.isFinite(minClosesRaw) ? minClosesRaw : 1;
    const maxFlipPct = maxFlipPctRaw != null ? Number(maxFlipPctRaw) : null;
    const flipGamma = Number.isFinite(flipGammaRaw) ? flipGammaRaw : 0;
    const tradeEta = Number.isFinite(tradeEtaRaw) ? tradeEtaRaw : 0;
    const costBps = Number.isFinite(spreadBpsRaw) ? spreadBpsRaw : 0;
    const leverage = Number.isFinite(leverageRaw) && leverageRaw > 0 ? leverageRaw : 5;
    const positionFraction =
      Number.isFinite(positionFractionRaw) && positionFractionRaw > 0 ? positionFractionRaw : 0.25;
    const initialEquity =
      Number.isFinite(initialEquityRaw) && initialEquityRaw > 0 ? initialEquityRaw : 5000;
    const recencyBars63 = Number.isFinite(recencyBars63Raw) && recencyBars63Raw > 0 ? Math.floor(recencyBars63Raw) : 63;
    const recencyBars252 =
      Number.isFinite(recencyBars252Raw) && recencyBars252Raw > 0 ? Math.floor(recencyBars252Raw) : 252;
    const minOpensLast63 = Number.isFinite(minOpensLast63Raw) ? minOpensLast63Raw : 1;
    const minFlatPctLast63 = Number.isFinite(minFlatPctLast63Raw) ? minFlatPctLast63Raw : 1;
    const enforceRecencyChecks = enforceRecency !== false;

    const tradingConfig: Trading212CfdConfig = {
      leverage,
      fxFeeRate: 0.005,
      dailyLongSwapRate: 0,
      dailyShortSwapRate: 0,
      spreadBps: costBps,
      marginCallLevel: 0.45,
      stopOutLevel: 0.25,
      positionFraction,
    };

    const cacheKey = buildZWfoThresholdCacheKey({
      symbol,
      dataEnd: dataEndUsed,
      h: horizon,
      coverage,
      lambda,
      trainFraction,
      minTrainObs,
      shrinkK: shrinkFactor,
      trainLen,
      valLen,
      stepLen,
      quantilesEnter,
      quantilesExit,
      quantilesFlip,
      costBps,
      leverage,
      posFrac: positionFraction,
      initialEquity,
      minFlatPct,
      minCloses,
      maxFlipPct,
      flipGamma,
      tradeEta,
      simStartDate: reactionMap.meta.testStart ?? null,
      minOpensInLast63: minOpensLast63,
      minFlatPctLast63,
      recencyBars63,
      recencyBars252,
      enforceRecency: enforceRecencyChecks,
    });

    const cached = await getZWfoThresholdCache(cacheKey, {
      allowStale,
      maxStaleTradingDays: 5,
      tradingDays,
      targetDataEnd: dataEndUsed,
    });

    if (cached.value) {
      return NextResponse.json({
        success: true,
        symbol,
        horizon,
        best: cached.value.best,
        foldSummaries: cached.value.foldSummaries,
        zEdgeSamples: cached.value.zEdgeSamples,
        reactionMeta: reactionMap.meta,
        cacheHit: true,
        cacheStale: cached.cacheStale,
        staleDays: cached.staleDays,
        dataEndUsed: cached.value.dataEndUsed ?? dataEndUsed,
      });
    }

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
      initialEquity,
      minFlatPct,
      minCloses,
      maxFlipPct,
      minOpensInLast63: minOpensLast63,
      minFlatPctLast63,
      recencyBars63,
      recencyBars252,
      enforceRecency: enforceRecencyChecks,
      scorePenalty: {
        flipGamma,
        tradeEta,
      },
    });

    const payload = {
      ...result,
      cacheHit: false,
      cacheStale: false,
      staleDays: null as number | null,
      dataEndUsed,
    };

    await setZWfoThresholdCache(cacheKey, payload);

    return NextResponse.json({
      success: true,
      symbol,
      horizon,
      ...payload,
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
