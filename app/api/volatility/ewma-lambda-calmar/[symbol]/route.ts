import { NextRequest, NextResponse } from "next/server";
import { optimizeEwmaLambdaCalmar } from "@/lib/volatility/ewmaLambdaCalmar";
import {
  buildLambdaCalmarCacheKey,
  getLambdaCalmarCache,
  setLambdaCalmarCache,
} from "@/lib/cache/lambdaCalmarCache";

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = (params.symbol || "").toUpperCase();
    if (!symbol) {
      return NextResponse.json({ success: false, error: "Symbol is required" }, { status: 400 });
    }

    const searchParams = request.nextUrl.searchParams;
    const rangeStart = searchParams.get("rangeStart");
    if (!rangeStart || !/^\d{4}-\d{2}-\d{2}$/.test(rangeStart)) {
      return NextResponse.json(
        { success: false, error: "rangeStart (YYYY-MM-DD) is required" },
        { status: 400 }
      );
    }

    const horizon = Math.max(1, Math.floor(Number(searchParams.get("h") ?? "1")));
    const coverage = Number(searchParams.get("coverage") ?? "0.95");
    const initialEquity = Number(searchParams.get("equity") ?? "1000");
    const leverage = Number(searchParams.get("leverage") ?? "5");
    const positionFraction = Number(searchParams.get("posFrac") ?? "0.25");
    const costBps = Number(searchParams.get("costBps") ?? "0");
    const signalRule = (searchParams.get("signalRule") ?? "z").toLowerCase();
    const objective = "calmar";

    if (!Number.isFinite(coverage) || coverage <= 0 || coverage >= 1) {
      return NextResponse.json(
        { success: false, error: "coverage must be between 0 and 1" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(initialEquity) || initialEquity <= 0) {
      return NextResponse.json(
        { success: false, error: "initialEquity must be positive" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(leverage) || leverage <= 0) {
      return NextResponse.json(
        { success: false, error: "leverage must be positive" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(positionFraction) || positionFraction <= 0) {
      return NextResponse.json(
        { success: false, error: "posFrac must be positive" },
        { status: 400 }
      );
    }
    if (signalRule !== "z") {
      return NextResponse.json(
        { success: false, error: "Only z signalRule is supported" },
        { status: 400 }
      );
    }

    const cacheKey = buildLambdaCalmarCacheKey({
      symbol,
      rangeStart,
      h: horizon,
      coverage,
      objective,
      costBps,
      leverage,
      posFrac: positionFraction,
      signalRule,
    });

    const cached = await getLambdaCalmarCache(cacheKey);
    if (cached) {
      return NextResponse.json({ success: true, ...cached, cacheHit: true });
    }

    const result = await optimizeEwmaLambdaCalmar({
      symbol,
      rangeStart,
      horizon,
      coverage,
      initialEquity,
      leverage,
      positionFraction,
      costBps,
      signalRule: "z",
    });

    const payload = { ...result, cacheHit: false, objective };
    await setLambdaCalmarCache(cacheKey, payload);

    return NextResponse.json({ success: true, ...payload });
  } catch (err: any) {
    console.error("[EWMA Lambda Calmar] error", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
