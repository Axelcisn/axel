/**
 * Smoke to verify cache key prefixes are versioned.
 *
 * Run:
 *   npx tsx scripts/smoke-cache-version-prefix.ts
 */

import { buildZWfoThresholdCacheKey } from "@/lib/cache/zWfoThresholdCache";
import { buildLambdaCalmarCacheKey } from "@/lib/cache/lambdaCalmarCache";

function testZWfoKey() {
  const parts = buildZWfoThresholdCacheKey({
    symbol: "TEST",
    dataEnd: "2024-01-05",
    h: 1,
    coverage: 0.95,
    lambda: 0.94,
    trainFraction: 0.7,
    minTrainObs: 500,
    shrinkK: 0.5,
    trainLen: 252,
    valLen: 63,
    stepLen: 63,
    quantilesEnter: [0.8, 0.9],
    quantilesExit: [0.5],
    quantilesFlip: [0.95],
    costBps: 0,
    leverage: 5,
    posFrac: 0.25,
    initialEquity: 5000,
    minFlatPct: 2,
    minCloses: 1,
    maxFlipPct: null,
    flipGamma: 0,
    tradeEta: 0,
    simStartDate: null,
    minOpensInLast63: 1,
    minFlatPctLast63: 1,
    recencyBars63: 63,
    recencyBars252: 252,
    enforceRecency: true,
  });

  if (!parts.key.startsWith("zWfo:v2|")) {
    throw new Error(`zWfo cache key missing version prefix: ${parts.key}`);
  }
  if (!parts.baseKey.startsWith("zWfo:v2|")) {
    throw new Error(`zWfo baseKey missing version prefix: ${parts.baseKey}`);
  }
  console.log(`zWfo key: ${parts.key}`);
}

function testLambdaCalmarKey() {
  const key = buildLambdaCalmarCacheKey({
    symbol: "TEST",
    trainEndUsed: "2024-01-05",
    h: 1,
    coverage: 0.95,
    objective: "calmar",
    costBps: 0,
    leverage: 5,
    posFrac: 0.25,
    signalRule: "z",
    shrinkFactor: 0.5,
  });

  if (!key.startsWith("lambdaCalmar:v2|")) {
    throw new Error(`lambdaCalmar cache key missing version prefix: ${key}`);
  }
  console.log(`lambdaCalmar key: ${key}`);
}

function main() {
  testZWfoKey();
  testLambdaCalmarKey();
}

main();
