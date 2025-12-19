import fs from "fs";
import path from "path";

export type LambdaCalmarCacheValue = Record<string, any>;

type CacheLookupOptions = {
  allowStale?: boolean;
  maxStaleTradingDays?: number;
  tradingDays?: string[];
  targetTrainEnd?: string;
};

type CacheLookupResult = {
  value: LambdaCalmarCacheValue | null;
  cacheKeyUsed: string | null;
  cacheStale: boolean;
  staleDays: number | null;
};

type CacheKeyParts = { key: string; baseKey: string };
type RedisEnv = { url: string; token: string } | null;

const LAMBDA_CALMAR_CACHE_VERSION = "v2";
const KEY_PREFIX = `lambdaCalmar:${LAMBDA_CALMAR_CACHE_VERSION}|`;
const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "lambdaCalmar.json");
const INDEX_PREFIX = "lambdaCalmar:index|";

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

function readLocalCache(): Record<string, LambdaCalmarCacheValue> {
  try {
    if (!fs.existsSync(CACHE_FILE)) return {};
    const raw = fs.readFileSync(CACHE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalCache(data: Record<string, LambdaCalmarCacheValue>) {
  ensureCacheDir();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function extractTrainEndFromKey(key: string): string | null {
  const part = key.split("|").find((p) => p.startsWith("trainEnd="));
  return part ? part.replace("trainEnd=", "") : null;
}

function buildBaseKeyFromKey(key: string): string {
  return key
    .split("|")
    .filter((p) => !p.startsWith("trainEnd="))
    .join("|");
}

function buildTradingDayIndex(tradingDays: string[]): Map<string, number> {
  const index = new Map<string, number>();
  tradingDays
    .filter((d) => typeof d === "string")
    .forEach((d, idx) => {
      if (!index.has(d)) {
        index.set(d, idx);
      }
    });
  return index;
}

function computeTradingDayDiff(index: Map<string, number> | null, from: string, to: string): number | null {
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
  targetTrainEnd: string,
  index: Map<string, number> | null,
  maxStaleDays: number
): { key: string; staleDays: number | null; trainEnd: string } | null {
  let best: { key: string; staleDays: number | null; trainEnd: string } | null = null;
  for (const key of keys) {
    const trainEnd = extractTrainEndFromKey(key);
    if (!trainEnd) continue;
    if (trainEnd > targetTrainEnd) continue;
    const diff = computeTradingDayDiff(index, trainEnd, targetTrainEnd);
    if (diff == null || diff < 0 || diff > maxStaleDays) continue;
    if (!best || trainEnd > best.trainEnd) {
      best = { key, staleDays: diff, trainEnd };
    }
  }
  return best;
}

function getRedisKeyValue(key: string, redisEnv: RedisEnv): Promise<LambdaCalmarCacheValue | null> {
  if (!redisEnv) return Promise.resolve(null);
  return fetch(`${redisEnv.url}/get/${encodeURIComponent(key)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${redisEnv.token}` },
    cache: "no-store",
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json?.result) {
        return typeof json.result === "string" ? JSON.parse(json.result) : json.result;
      }
      return null;
    })
    .catch((err) => {
      console.warn("[lambdaCalmarCache] Redis get failed:", err);
      return null;
    });
}

async function setRedisKeyValue(key: string, value: any, redisEnv: RedisEnv) {
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
    console.warn("[lambdaCalmarCache] Redis set failed:", err);
  }
}

async function getRedisIndex(baseKey: string, redisEnv: RedisEnv): Promise<string[]> {
  const raw = await getRedisKeyValue(`${INDEX_PREFIX}${baseKey}`, redisEnv);
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
      await setRedisKeyValue(`${INDEX_PREFIX}${baseKey}`, index, redisEnv);
    }
  } catch (err) {
    console.warn("[lambdaCalmarCache] Redis index update failed:", err);
  }
}

export function buildLambdaCalmarCacheKeyParts(params: {
  symbol: string;
  trainEndUsed: string;
  h: number;
  coverage: number;
  objective: string;
  costBps: number;
  leverage: number;
  posFrac: number;
  signalRule: string;
  shrinkFactor?: number;
}): CacheKeyParts {
  const { symbol, trainEndUsed, h, coverage, objective, costBps, leverage, posFrac, signalRule, shrinkFactor } = params;
  const baseKey = [
    `${KEY_PREFIX}${symbol.toUpperCase()}`,
    `h=${h}`,
    `cov=${coverage}`,
    `obj=${objective}`,
    `cost=${costBps}`,
    `lev=${leverage}`,
    `pos=${posFrac}`,
    `sig=${signalRule}`,
    `shrink=${shrinkFactor ?? 0.5}`,
  ].join("|");
  const key = [baseKey, `trainEnd=${trainEndUsed}`].join("|");
  return { key, baseKey };
}

export function buildLambdaCalmarCacheKey(params: {
  symbol: string;
  trainEndUsed: string;
  h: number;
  coverage: number;
  objective: string;
  costBps: number;
  leverage: number;
  posFrac: number;
  signalRule: string;
  shrinkFactor?: number;
}): string {
  return buildLambdaCalmarCacheKeyParts(params).key;
}

export async function getLambdaCalmarCache(
  keyOrParts: string | CacheKeyParts,
  opts?: CacheLookupOptions
): Promise<CacheLookupResult> {
  const allowStale = opts?.allowStale ?? false;
  const maxStaleTradingDays = opts?.maxStaleTradingDays ?? 5;
  const tradingDays = opts?.tradingDays ?? [];
  const targetTrainEnd = opts?.targetTrainEnd ?? null;
  const tradingIndex = tradingDays.length ? buildTradingDayIndex(tradingDays) : null;

  const parts: CacheKeyParts =
    typeof keyOrParts === "string"
      ? { key: keyOrParts, baseKey: buildBaseKeyFromKey(keyOrParts) }
      : keyOrParts;

  const redisEnv = getRedisEnv();
  if (redisEnv) {
    const direct = await getRedisKeyValue(parts.key, redisEnv);
    if (direct) {
      return { value: direct, cacheKeyUsed: parts.key, cacheStale: false, staleDays: 0 };
    }
    if (allowStale && targetTrainEnd) {
      const index = await getRedisIndex(parts.baseKey, redisEnv);
      const candidate = pickStaleCandidate(index, targetTrainEnd, tradingIndex, maxStaleTradingDays);
      if (candidate) {
        const value = await getRedisKeyValue(candidate.key, redisEnv);
        if (value) {
          return { value, cacheKeyUsed: candidate.key, cacheStale: true, staleDays: candidate.staleDays };
        }
      }
    }
  }

  const local = readLocalCache();
  if (local[parts.key]) {
    return { value: local[parts.key], cacheKeyUsed: parts.key, cacheStale: false, staleDays: 0 };
  }

  if (allowStale && targetTrainEnd) {
    const localKeys = Object.keys(local).filter((k) => buildBaseKeyFromKey(k) === parts.baseKey);
    const candidate = pickStaleCandidate(localKeys, targetTrainEnd, tradingIndex, maxStaleTradingDays);
    if (candidate && local[candidate.key]) {
      return { value: local[candidate.key], cacheKeyUsed: candidate.key, cacheStale: true, staleDays: candidate.staleDays };
    }
  }

  return { value: null, cacheKeyUsed: null, cacheStale: false, staleDays: null };
}

export async function setLambdaCalmarCache(
  keyOrParts: string | CacheKeyParts,
  value: LambdaCalmarCacheValue
): Promise<void> {
  const parts: CacheKeyParts =
    typeof keyOrParts === "string"
      ? { key: keyOrParts, baseKey: buildBaseKeyFromKey(keyOrParts) }
      : keyOrParts;

  const redisEnv = getRedisEnv();
  if (redisEnv) {
    await setRedisKeyValue(parts.key, value, redisEnv);
    await updateRedisIndex(parts.baseKey, parts.key, redisEnv);
  }

  const local = readLocalCache();
  local[parts.key] = value;
  writeLocalCache(local);
}
