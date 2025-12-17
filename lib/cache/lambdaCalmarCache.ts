import fs from "fs";
import path from "path";

type LambdaCalmarCacheValue = Record<string, any>;

const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "lambdaCalmar.json");

function getRedisEnv() {
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
  const { symbol, trainEndUsed, h, coverage, objective, costBps, leverage, posFrac, signalRule, shrinkFactor } = params;
  return [
    symbol.toUpperCase(),
    `trainEnd=${trainEndUsed}`,
    `h=${h}`,
    `cov=${coverage}`,
    `obj=${objective}`,
    `cost=${costBps}`,
    `lev=${leverage}`,
    `pos=${posFrac}`,
    `sig=${signalRule}`,
    `shrink=${shrinkFactor ?? 0.5}`,
  ].join("|");
}

export async function getLambdaCalmarCache(key: string): Promise<LambdaCalmarCacheValue | null> {
  const redisEnv = getRedisEnv();
  if (redisEnv) {
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
      console.warn("[lambdaCalmarCache] Redis get failed, fallback to local:", err);
    }
  }

  const local = readLocalCache();
  return local[key] ?? null;
}

export async function setLambdaCalmarCache(key: string, value: LambdaCalmarCacheValue): Promise<void> {
  const redisEnv = getRedisEnv();
  if (redisEnv) {
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
      console.warn("[lambdaCalmarCache] Redis set failed, writing to local cache:", err);
    }
  }

  const local = readLocalCache();
  local[key] = value;
  writeLocalCache(local);
}
