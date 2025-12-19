/**
 * Validate z-WFO recency constraints produce restartable windows.
 *
 * Run:
 *   npx tsx scripts/smoke-z-wfo-recent-opens.ts --symbols=ABT,NUE,AIG,KMI,SWK
 */

import { NextRequest } from "next/server";
import { GET as zWfoOptimizeGet } from "@/app/api/volatility/z-threshold-optimize/[symbol]/route";
import { parseSymbolsFromArgs } from "./_utils/cli";

const DEFAULT_SYMBOLS = ["ABT", "NUE", "AIG", "KMI", "SWK"];

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
  // Recency constraints are enabled by default; no need to override.
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
    const result = await callApi(symbol);
    const best = result.best as any;
    const recency = best?.recency?.recent;
    if (!recency) {
      throw new Error(`${symbol}: missing recency stats on best candidate`);
    }

    const flatPct63 = typeof recency.flatPct === "number" ? recency.flatPct : NaN;
    const opens63 = recency.opens ?? 0;
    const closes63 = recency.closes ?? 0;
    const flips63 = recency.flips ?? 0;
    const cacheHit = !!result.cacheHit;
    const reason = best.reason ?? "none";
    const selectionTier = best.selectionTier ?? "unknown";
    const recencyPass = !!best.recencyPass;

    console.log(
      `${symbol}: tier=${selectionTier} recencyPass=${recencyPass} flatPct63=${flatPct63.toFixed(2)} opens63=${opens63} closes63=${closes63} flips63=${flips63} applyRecommended=${best.applyRecommended} reason=${reason} cacheHit=${cacheHit}`
    );

    if (selectionTier === "strict" && opens63 < 1) {
      throw new Error(`${symbol}: strict tier but opens63<1`);
    }
    if (opens63 === 0) {
      if (selectionTier === "strict") {
        throw new Error(`${symbol}: strict tier cannot have opens63=0`);
      }
      if (recencyPass) {
        throw new Error(`${symbol}: opens63=0 but recencyPass=true`);
      }
      if (!reason.includes("noCandidateRecency")) {
        throw new Error(`${symbol}: expected recency failure reason when opens63=0 (got ${reason})`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
