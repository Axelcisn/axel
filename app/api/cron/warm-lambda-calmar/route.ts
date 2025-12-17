import { NextRequest, NextResponse } from "next/server";
import { CRON_LAMBDA_CALMAR_UNIVERSE } from "@/lib/config/cronUniverse";
import { ensureCanonicalOrHistory } from "@/lib/storage/canonical";
import { loadCalmarTrainingData, optimizeEwmaLambdaCalmar } from "@/lib/volatility/ewmaLambdaCalmar";
import {
  buildLambdaCalmarCacheKey,
  setLambdaCalmarCache,
} from "@/lib/cache/lambdaCalmarCache";

// Schedule weekly Monday 16:10 ET (documented only; wire in deployment scheduler separately).

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const batch = Number(params.get("batch") ?? "0");
    const batchSize = Number(params.get("batchSize") ?? "10");
    const horizon = Number(params.get("h") ?? "1");
    const coverage = Number(params.get("coverage") ?? "0.95");
    const initialEquity = Number(params.get("equity") ?? "1000");
    const leverage = Number(params.get("leverage") ?? "5");
    const posFrac = Number(params.get("posFrac") ?? "0.25");
    const costBps = Number(params.get("costBps") ?? "0");
    const shrinkFactorRaw = Number(params.get("shrinkFactor") ?? "0.5");
    const shrinkFactor = Number.isFinite(shrinkFactorRaw)
      ? Math.min(1, Math.max(0, shrinkFactorRaw))
      : 0.5;
    const dryRun = params.get("dryRun") === "true";
    const symbolsParam = params.get("symbols");
    const universe = symbolsParam
      ? symbolsParam
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      : CRON_LAMBDA_CALMAR_UNIVERSE;
    const signalRule = "z";
    const objective = "calmar";

    const start = batch * batchSize;
    const end = start + batchSize;
    const symbols = universe.slice(start, end);

    const offsetsParam = params.get("offsets");
    const offsets = offsetsParam
      ? offsetsParam
          .split(",")
          .map((v) => Number(v.trim()))
          .filter((v) => Number.isFinite(v) && v > 0)
      : [21, 63, 126, 252];

    const results: Array<{ symbol: string; rangeStart: string; trainEndUsed: string; cacheKey: string }> = [];

    for (const symbol of symbols) {
      try {
        const { rows } = await ensureCanonicalOrHistory(symbol, { interval: "1d", minRows: 260 });
        const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
        const lastIdx = sorted.length - 1;
        const rangeStarts = new Set<string>();
        for (const off of offsets) {
          const idx = Math.max(0, lastIdx - off);
          const date = sorted[idx]?.date;
          if (date) rangeStarts.add(date);
        }

        for (const rangeStart of Array.from(rangeStarts)) {
          const trainingData = await loadCalmarTrainingData(symbol, rangeStart);
          const trainEndUsed = trainingData.trainEnd;
          const res = await optimizeEwmaLambdaCalmar({
            symbol,
            rangeStart,
            horizon,
            coverage,
            initialEquity,
            leverage,
            positionFraction: posFrac,
            costBps,
            shrinkFactor,
            signalRule,
            trainingData,
          });
          const cacheKey = buildLambdaCalmarCacheKey({
            symbol,
            trainEndUsed,
            h: horizon,
            coverage,
            objective,
            costBps,
            leverage,
            posFrac,
            signalRule,
            shrinkFactor,
          });
          if (!dryRun) {
            await setLambdaCalmarCache(cacheKey, {
              ...res,
              cacheHit: false,
              objective,
              rangeStartUsed: rangeStart,
              trainEndUsed,
            });
          }
          results.push({ symbol, rangeStart, trainEndUsed, cacheKey });
        }
      } catch (err) {
        console.warn("[warm-lambda-calmar] failed for", symbol, err);
      }
    }

    return NextResponse.json({
      success: true,
      batch,
      batchSize,
      symbols,
      warmed: results.length,
      results,
      dryRun,
    });
  } catch (err) {
    console.error("[warm-lambda-calmar] error", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
