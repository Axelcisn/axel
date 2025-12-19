/**
 * Smoke test: optimize-only should apply any hard-pass z-WFO candidate,
 * regardless of applyRecommended, and avoid applying hard-fail results.
 *
 * Run:
 *   npx tsx scripts/smoke-z-optimize-apply-policy.ts --symbols=CME,ICE,BK,SCHW,SPG
 */

import { NextRequest } from "next/server";
import { GET as zWfoOptimizeGet } from "@/app/api/volatility/z-threshold-optimize/[symbol]/route";
import { decideZOptimizeApply } from "@/lib/volatility/zOptimizeApplyPolicy";
import { parseSymbolsFromArgs } from "./_utils/cli";

const DEFAULT_SYMBOLS = ["CME", "ICE", "BK", "SCHW", "SPG"];

function buildRequest(symbol: string): NextRequest {
  const url = new URL(`http://localhost/api/volatility/z-threshold-optimize/${symbol}`);
  url.searchParams.set("h", "1");
  url.searchParams.set("coverage", "0.95");
  url.searchParams.set("lambda", "0.94");
  url.searchParams.set("trainFraction", "0.7");
  url.searchParams.set("minTrainObs", "500");
  url.searchParams.set("trainLenBars", "252");
  url.searchParams.set("valLenBars", "63");
  url.searchParams.set("stepLenBars", "63");
  url.searchParams.set("costBps", "0");
  url.searchParams.set("initialEquity", "5000");
  url.searchParams.set("leverage", "5");
  url.searchParams.set("positionFraction", "0.25");
  url.searchParams.set("shrinkFactor", "0.5");
  return new NextRequest(url);
}

async function callApi(symbol: string) {
  const req = buildRequest(symbol);
  const res = await zWfoOptimizeGet(req, { params: { symbol } });
  const json = await res.json();
  if (!json.success) {
    throw new Error(`API failure for ${symbol}: ${json.error || "unknown error"}`);
  }
  return json;
}

async function main() {
  const { symbols } = parseSymbolsFromArgs(process.argv, { defaultSymbols: DEFAULT_SYMBOLS });

  for (const sym of symbols) {
    const symbol = sym.toUpperCase();
    const json = await callApi(symbol);
    const best = json.best as any;
    const decision = decideZOptimizeApply(best);

    const reason: string | null = best?.reason ?? null;
    const applyRecommended = !!best?.applyRecommended;
    const recencyRecent = best?.recency?.recent;
    if (!recencyRecent) {
      throw new Error(`${symbol}: missing best.recency.recent`);
    }

    const opens63 = recencyRecent.opens ?? 0;
    const flatPct63 = recencyRecent.flatPct ?? 0;
    const selectionTier = best?.selectionTier;
    const strictPass = !!best?.strictPass;
    const recencyPass = !!best?.recencyPass;

    console.log(
      `${symbol}: tier=${selectionTier} strictPass=${strictPass} recencyPass=${recencyPass} reason=${reason ?? "none"} applyRecommended=${applyRecommended} hardPass=${decision.hardPass} applied=${decision.applied} opens63=${opens63} flatPct63=${Number(flatPct63).toFixed(2)}`
    );

    if (!selectionTier) {
      throw new Error(`${symbol}: missing selectionTier`);
    }

    if (selectionTier === "strict") {
      if (!decision.hardPass || !decision.applied) {
        throw new Error(`${symbol}: strict tier must hard-pass and apply`);
      }
      if (!strictPass || !recencyPass) {
        throw new Error(`${symbol}: strict tier should have strictPass/recencyPass=true`);
      }
      if (reason && (reason.includes("noCandidateRecency") || reason.includes("noCandidateStrict"))) {
        throw new Error(`${symbol}: strict tier should not carry recency/strict failure reason (${reason})`);
      }
    } else {
      if (decision.hardPass || decision.applied) {
        throw new Error(`${symbol}: non-strict tier must not be applied`);
      }
      if (!reason || (!reason.includes("noCandidateRecency") && !reason.includes("noCandidateStrict"))) {
        throw new Error(`${symbol}: expected strict/recency failure reason for non-strict tier, got ${reason}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
