/**
 * Verify z-WFO threshold cache returns hits on repeat calls.
 *
 * Run:
 *   npx tsx scripts/smoke-z-wfo-cache.ts --symbols=ABT,NUE --clearDevCache=true
 */

import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { GET as zWfoOptimizeGet } from "@/app/api/volatility/z-threshold-optimize/[symbol]/route";
import { parseSymbolsFromArgs } from "./_utils/cli";

const DEFAULT_SYMBOLS = ["ABT", "NUE"];

function getArgValue(key: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${key}=`));
  return hit ? hit.slice(key.length + 3) : null;
}

function parseBoolArg(key: string, defaultValue: boolean): boolean {
  const raw = getArgValue(key);
  if (raw == null) return defaultValue;
  return raw !== "false" && raw !== "0";
}

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
  const clearDevCache = parseBoolArg("clearDevCache", true);
  const cacheFile = path.join(process.cwd(), ".cache", "zWfoThreshold.json");
  const hasRedis =
    !!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
    !!(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN);

  if (clearDevCache && !hasRedis) {
    if (fs.existsSync(cacheFile)) {
      fs.unlinkSync(cacheFile);
      console.log(`Cleared local cache file at ${cacheFile}`);
    } else {
      console.log("Local cache already clean (filesystem backend)");
    }
  }

  for (const sym of symbols) {
    const symbol = sym.toUpperCase();
    const first = await callApi(symbol);
    const second = await callApi(symbol);

    console.log(
      `${symbol} call1 cacheHit=${!!first.cacheHit} call2 cacheHit=${!!second.cacheHit} dataEndUsed=${first.dataEndUsed ?? "unknown"}`
    );

    if (first.cacheHit) {
      throw new Error(`${symbol}: expected cache miss on first call`);
    }
    if (!second.cacheHit) {
      throw new Error(`${symbol}: expected cache hit on second call`);
    }
    if (second.cacheStale) {
      throw new Error(`${symbol}: unexpected stale cache reuse`);
    }
    if (JSON.stringify(first.best?.thresholds) !== JSON.stringify(second.best?.thresholds)) {
      throw new Error(`${symbol}: cached thresholds differ from initial compute`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
