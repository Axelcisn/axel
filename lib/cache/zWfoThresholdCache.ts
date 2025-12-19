import fs from "fs";
import path from "path";

export type ZWfoThresholdCacheValue = Record<string, any>;

export type ZWfoThresholdCacheKeyParts = {
  key: string;
  baseKey: string;
  dataEnd: string;
};

type CacheLookupOptions = {
  allowStale?: boolean;
  maxStaleTradingDays?: number;
  tradingDays?: string[];
  targetDataEnd?: string;
};

type CacheLookupResult = {
  value: ZWfoThresholdCacheValue | null;
  cacheKeyUsed: string | null;
  cacheStale: boolean;
  staleDays: number | null;
};

type RedisEnv = { url: string; token: string } | null;

const Z_WFO_CACHE_VERSION = "v2";
const KEY_PREFIX = `zWfo:${Z_WFO_CACHE_VERSION}|`;
const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "zWfoThreshold.json");
const INDEX_PREFIX = "zWfoThreshold:index|";

function getRedisEnv(): RedisEnv {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || null;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || null;
  return url && token ? { url, token } : null;
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function readLocalCache(): Record<string, ZWfoThresholdCacheValue> {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    const raw = fs.readFileSync(CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalCache(data: Record<string, ZWfoThresholdCacheValue>) {
  ensureCacheDir();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function formatList(values: number[]): string {
  return [...values]
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b)
    .join(",");
}

function extractDataEndFromKey(key: string): string | null {
  const part = key.split("|").find((p) => p.startsWith("dataEnd="));
  return part ? part.replace("dataEnd=", "") : null;
}

function buildBaseKeyFromKey(key: string, tag: string): string {
  return key
    .split("|")
    .filter((p) => !p.startsWith(tag))
    .join("|");
}

function buildTradingDayIndex(tradingDays: string[]): Map<string, number> {
  const map = new Map<string, number>();
  tradingDays
    .filter((d) => typeof d === "string")
    .forEach((d, idx) => {
      if (!map.has(d)) {
        map.set(d, idx);
      }
    });
  return map;
}

function computeTradingDayDiff(
  index: Map<string, number> | null,
  from: string,
  to: string
): number | null {
  if (index?.size) {
    const start = index.get(from);
    const end = index.get(to);
    if (start != null && end != null) {
      return end - start;
    }
  }
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return null;
  return Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
}

function pickStaleCandidate(
  keys: string[],
  targetDataEnd: string,
  index: Map<string, number> | null,
  maxStaleDays: number
): { key: string; staleDays: number | null; dataEnd: string } | null {
  let best: { key: string; staleDays: number | null; dataEnd: string } | null = null;
  for (const key of keys) {
    const dataEnd = extractDataEndFromKey(key);
    if (!dataEnd) continue;
    if (dataEnd > targetDataEnd) continue;
    const diff = computeTradingDayDiff(index, dataEnd, targetDataEnd);
    if (diff == null || diff < 0 || diff > maxStaleDays) continue;
    if (!best || dataEnd > best.dataEnd) {
      best = { key, staleDays: diff, dataEnd };
    }
  }
  return best;
}

async function fetchRedisValue(key: string, redisEnv: RedisEnv): Promise<ZWfoThresholdCacheValue | null> {
  if (!redisEnv) return null;
  try {
    const res = await fetch(`${redisEnv.url}/get/${encodeURIComponent(key)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${redisEnv.token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json?.result) {
      return typeof json.result === "string" ? JSON.parse(json.result) : json.result;
    }
  } catch (err) {
    console.warn("[zWfoThresholdCache] Redis get failed:", err);
  }
  return null;
}

async function setRedisValue(key: string, value: any, redisEnv: RedisEnv) {
  if (!redisEnv) return;
  try {
    await fetch(`${redisEnv.url}/set/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisEnv.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(value),
    });
  } catch (err) {
    console.warn("[zWfoThresholdCache] Redis set failed:", err);
  }
}

async function getRedisIndex(baseKey: string, redisEnv: RedisEnv): Promise<string[]> {
  const raw = await fetchRedisValue(`${INDEX_PREFIX}${baseKey}`, redisEnv);
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function updateRedisIndex(baseKey: string, key: string, redisEnv: RedisEnv) {
  if (!redisEnv) return;
  try {
    const index = await getRedisIndex(baseKey, redisEnv);
    if (!index.includes(key)) {
      index.push(key);
      await setRedisValue(`${INDEX_PREFIX}${baseKey}`, index, redisEnv);
    }
  } catch (err) {
    console.warn("[zWfoThresholdCache] Redis index update failed:", err);
  }
}

export function buildZWfoThresholdCacheKey(params: {
  symbol: string;
  dataEnd: string;
  h: number;
  coverage: number;
  lambda: number;
  trainFraction: number;
  minTrainObs: number;
  shrinkK: number;
  trainLen: number;
  valLen: number;
  stepLen: number;
  quantilesEnter: number[];
  quantilesExit: number[];
  quantilesFlip: number[];
  costBps: number;
  leverage: number;
  posFrac: number;
  initialEquity: number;
  minFlatPct: number;
  minCloses: number;
  maxFlipPct: number | null;
  flipGamma: number;
  tradeEta: number;
  simStartDate?: string | null;
  minOpensInLast63: number;
  minFlatPctLast63: number;
  recencyBars63: number;
  recencyBars252: number;
  enforceRecency: boolean;
}): ZWfoThresholdCacheKeyParts {
  const {
    symbol,
    dataEnd,
    h,
    coverage,
    lambda,
    trainFraction,
    minTrainObs,
    shrinkK,
    trainLen,
    valLen,
    stepLen,
    quantilesEnter,
    quantilesExit,
    quantilesFlip,
    costBps,
    leverage,
    posFrac,
    initialEquity,
    minFlatPct,
    minCloses,
    maxFlipPct,
    flipGamma,
    tradeEta,
    simStartDate,
    minOpensInLast63,
    minFlatPctLast63,
    recencyBars63,
    recencyBars252,
    enforceRecency,
  } = params;

  const baseParts = [
    `${KEY_PREFIX}${symbol.toUpperCase()}`,
    `h=${h}`,
    `cov=${coverage}`,
    `lambda=${lambda}`,
    `trainFrac=${trainFraction}`,
    `minTrain=${minTrainObs}`,
    `simStart=${simStartDate ?? "none"}`,
    `trainLen=${trainLen}`,
    `valLen=${valLen}`,
    `stepLen=${stepLen}`,
    `qE=${formatList(quantilesEnter)}`,
    `qX=${formatList(quantilesExit)}`,
    `qF=${formatList(quantilesFlip)}`,
    `cost=${costBps}`,
    `lev=${leverage}`,
    `pos=${posFrac}`,
    `initEq=${initialEquity}`,
    `shrink=${shrinkK}`,
    `minFlat=${minFlatPct}`,
    `minCloses=${minCloses}`,
    `maxFlip=${maxFlipPct ?? "null"}`,
    `flipGamma=${flipGamma}`,
    `tradeEta=${tradeEta}`,
    `minOpens63=${minOpensInLast63}`,
    `minFlat63=${minFlatPctLast63}`,
    `recency63=${recencyBars63}`,
    `recency252=${recencyBars252}`,
    `enforceRecency=${enforceRecency ? 1 : 0}`,
  ];

  const baseKey = baseParts.join("|");
  const key = `${baseKey}|dataEnd=${dataEnd}`;

  return { key, baseKey, dataEnd };
}

export async function getZWfoThresholdCache(
  parts: ZWfoThresholdCacheKeyParts,
  opts?: CacheLookupOptions
): Promise<CacheLookupResult> {
  const allowStale = opts?.allowStale ?? false;
  const maxStaleTradingDays = opts?.maxStaleTradingDays ?? 5;
  const tradingDays = opts?.tradingDays ?? [];
  const targetDataEnd = opts?.targetDataEnd ?? parts.dataEnd;
  const tradingIndex = tradingDays.length ? buildTradingDayIndex(tradingDays) : null;

  const redisEnv = getRedisEnv();
  if (redisEnv) {
    const cached = await fetchRedisValue(parts.key, redisEnv);
    if (cached) {
      return { value: cached, cacheKeyUsed: parts.key, cacheStale: false, staleDays: 0 };
    }
    if (allowStale && targetDataEnd) {
      const indexKeys = await getRedisIndex(parts.baseKey, redisEnv);
      const candidate = pickStaleCandidate(indexKeys, targetDataEnd, tradingIndex, maxStaleTradingDays);
      if (candidate) {
        const value = await fetchRedisValue(candidate.key, redisEnv);
        if (value) {
          return {
            value,
            cacheKeyUsed: candidate.key,
            cacheStale: true,
            staleDays: candidate.staleDays,
          };
        }
      }
    }
  }

  const local = readLocalCache();
  if (local[parts.key]) {
    return { value: local[parts.key], cacheKeyUsed: parts.key, cacheStale: false, staleDays: 0 };
  }

  if (allowStale && targetDataEnd) {
    const localKeys = Object.keys(local).filter(
      (k) => buildBaseKeyFromKey(k, "dataEnd=") === parts.baseKey
    );
    const candidate = pickStaleCandidate(localKeys, targetDataEnd, tradingIndex, maxStaleTradingDays);
    if (candidate && local[candidate.key]) {
      return {
        value: local[candidate.key],
        cacheKeyUsed: candidate.key,
        cacheStale: true,
        staleDays: candidate.staleDays,
      };
    }
  }

  return { value: null, cacheKeyUsed: null, cacheStale: false, staleDays: null };
}

export async function setZWfoThresholdCache(
  parts: ZWfoThresholdCacheKeyParts,
  value: ZWfoThresholdCacheValue
): Promise<void> {
  const redisEnv = getRedisEnv();
  if (redisEnv) {
    await setRedisValue(parts.key, value, redisEnv);
    await updateRedisIndex(parts.baseKey, parts.key, redisEnv);
  }

  const local = readLocalCache();
  local[parts.key] = value;
  writeLocalCache(local);
}
