/**
 * EWMA Reaction Map Module
 *
 * Builds conditional forward-return distributions based on EWMA z-score buckets.
 * Supports multi-horizon analysis (h = 1, 2, 3, ...) and configurable train/test splits.
 */

import { runEwmaWalker, EwmaWalkerPoint } from "./ewmaWalker";
import { loadCanonicalData } from "../storage/canonical";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ZBucketId = "bigDown" | "medDown" | "normal" | "medUp" | "bigUp";

export interface ZBucket {
  id: ZBucketId;
  min: number; // inclusive
  max: number; // exclusive
}

export interface ReactionConfig {
  lambda: number;
  coverage: number;
  horizons: number[];        // e.g. [1, 2, 3]
  zBuckets: ZBucket[];       // bucket definitions
  trainFraction: number;     // e.g. 0.7 — the "split index %" for UI
  minTrainObs: number;       // e.g. 500
}

export interface ReactionBucketForwardStats {
  bucketId: ZBucketId;
  horizon: number;
  nObs: number;
  pUp: number;               // P(r_{t+h} > 0)
  meanReturn: number;
  stdReturn: number;
  q10: number;
  q25: number;
  q50: number;
  q75: number;
  q90: number;
}

export interface ReactionMapResult {
  symbol: string;
  config: ReactionConfig;
  stats: ReactionBucketForwardStats[];
  meta: {
    trainStart: string;
    trainEnd: string;
    testStart: string;
    testEnd: string;
    nTrain: number;
    nTest: number;
  };
}

/**
 * Tilt configuration for applying a small drift/tilt to EWMA forecasts
 * based on the reaction map (mean forward returns by z-bucket).
 */
export interface EwmaTiltConfig {
  symbol: string;
  lambda: number;
  coverage: number;
  horizon: number;           // for now always 1
  shrinkFactor: number;      // 0..1, e.g. 0.5
  // per-bucket mean forward return (μ) in log-return units
  muByBucket: Partial<Record<ZBucketId, number>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_Z_BUCKETS: ZBucket[] = [
  { id: "bigDown", min: -Infinity, max: -2.0 },
  { id: "medDown", min: -2.0, max: -1.0 },
  { id: "normal",  min: -1.0, max:  1.0 },
  { id: "medUp",   min:  1.0, max:  2.0 },
  { id: "bigUp",   min:  2.0, max:  Infinity },
];

export const defaultReactionConfig: ReactionConfig = {
  lambda: 0.94,
  coverage: 0.95,
  horizons: [1, 2, 3],
  zBuckets: DEFAULT_Z_BUCKETS,
  trainFraction: 0.7,  // ← this is the "split index %" we can wire to a UI box later
  minTrainObs: 500,
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify a z-score into a bucket.
 * Returns null if z falls outside all defined buckets.
 */
export function bucketIdForZ(z: number, buckets: ZBucket[]): ZBucketId | null {
  for (const b of buckets) {
    if (z >= b.min && z < b.max) return b.id;
  }
  return null;
}

/**
 * Compute summary statistics from an array of forward returns.
 */
function summarizeForwardReturns(values: number[]): {
  mean: number;
  std: number;
  q10: number;
  q25: number;
  q50: number;
  q75: number;
  q90: number;
} {
  if (!values.length) {
    return { mean: NaN, std: NaN, q10: NaN, q25: NaN, q50: NaN, q75: NaN, q90: NaN };
  }

  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance =
    n > 1
      ? values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1)
      : 0;
  const std = Math.sqrt(variance);

  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => {
    const idx = Math.floor((sorted.length - 1) * p);
    return sorted[idx];
  };

  return {
    mean,
    std,
    q10: at(0.10),
    q25: at(0.25),
    q50: at(0.50),
    q75: at(0.75),
    q90: at(0.90),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the EWMA Reaction Map for a symbol.
 *
 * This function:
 * 1. Runs the EWMA walker to get z-scores (standardizedError) for each date.
 * 2. Splits observations into train/test sets based on trainFraction.
 * 3. For each training observation, classifies z_t into a bucket and computes
 *    forward returns r_{t+h} for each horizon h.
 * 4. Aggregates statistics by bucket and horizon.
 *
 * @param symbol - The ticker symbol
 * @param config - Reaction configuration (defaults to defaultReactionConfig)
 * @returns ReactionMapResult with stats by bucket/horizon and train/test metadata
 */
export async function buildEwmaReactionMap(
  symbol: string,
  config: ReactionConfig = defaultReactionConfig
): Promise<ReactionMapResult> {
  const {
    lambda,
    coverage,
    horizons,
    zBuckets,
    trainFraction,
    minTrainObs,
  } = config;

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Run EWMA walker to get z_t and dates
  // ───────────────────────────────────────────────────────────────────────────
  const walkerResult = await runEwmaWalker({
    symbol,
    lambda,
    coverage,
  });

  const points: EwmaWalkerPoint[] = walkerResult.points;
  if (!points.length) {
    throw new Error(`EWMA walker returned no points for ${symbol}`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Sort by date_t just in case
  // ───────────────────────────────────────────────────────────────────────────
  const sorted = [...points].sort((a, b) =>
    a.date_t < b.date_t ? -1 : a.date_t > b.date_t ? 1 : 0
  );

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Compute train/test split index based on trainFraction
  // ───────────────────────────────────────────────────────────────────────────
  const n = sorted.length;
  const splitIndex = Math.max(minTrainObs, Math.floor(n * trainFraction));

  if (splitIndex >= n - 1) {
    throw new Error(
      `Not enough data for train/test split: n=${n}, splitIndex=${splitIndex}`
    );
  }

  const train = sorted.slice(0, splitIndex);
  const test = sorted.slice(splitIndex);

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Load canonical prices for multi-horizon forward returns
  // ───────────────────────────────────────────────────────────────────────────
  const rows = await loadCanonicalData(symbol);

  // Build date → price map
  const priceByDate = new Map<string, number>();
  for (const row of rows) {
    const S = row.adj_close ?? row.close;
    if (S != null && Number.isFinite(S)) {
      priceByDate.set(row.date, S);
    }
  }

  // Build date → index map for horizon lookups
  const canonicalDates = rows.map((r) => r.date);
  const indexByDate = new Map<string, number>();
  canonicalDates.forEach((d, idx) => indexByDate.set(d, idx));

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Extract training points with z-scores
  // ───────────────────────────────────────────────────────────────────────────
  interface TrainPoint {
    date_t: string;
    date_tp1: string;      // date of t+1 (when signal is known)
    z_t: number;           // standardizedError
    S_t: number;
    S_tp1: number;         // price at t+1
  }

  const trainPoints: TrainPoint[] = train.map((p) => ({
    date_t: p.date_t,
    date_tp1: p.date_tp1,
    z_t: p.standardizedError,
    S_t: p.S_t,
    S_tp1: p.S_tp1,
  }));

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Prepare nested structure to collect forward returns by bucket & horizon
  // ───────────────────────────────────────────────────────────────────────────
  const forwardReturnsByBucket: Record<ZBucketId, Record<number, number[]>> = {
    bigDown: {},
    medDown: {},
    normal: {},
    medUp: {},
    bigUp: {},
  };

  for (const bucket of Object.keys(forwardReturnsByBucket) as ZBucketId[]) {
    for (const h of horizons) {
      forwardReturnsByBucket[bucket][h] = [];
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 7. For each train point, classify bucket and accumulate forward returns
  //
  // IMPORTANT: The walker's z_t = log(S_{t+1}/S_t) / sigma_t is computed
  // AFTER observing S_{t+1}. So the "signal" is known at end of day t+1.
  // The true forward return should be from t+1 onward:
  //   r_forward(h) = log(S_{t+1+h} / S_{t+1})
  //
  // This ensures we're measuring what happens AFTER the signal, not the
  // return that defined the signal itself.
  // ───────────────────────────────────────────────────────────────────────────

  for (const tp of trainPoints) {
    const { date_t, z_t, S_t, S_tp1, date_tp1 } = tp;
    const bucketId = bucketIdForZ(z_t, zBuckets);
    if (!bucketId) continue; // skip if outside defined range

    // Get index of t+1 (the day when the signal is known)
    const idx_tp1 = indexByDate.get(date_tp1);
    if (idx_tp1 == null) continue;

    // For each horizon h (in trading days AFTER the signal)
    for (const h of horizons) {
      const targetIdx = idx_tp1 + h;  // t+1+h
      if (targetIdx >= canonicalDates.length) continue;

      const date_forward = canonicalDates[targetIdx];
      const S_forward = priceByDate.get(date_forward);
      if (S_forward == null || S_tp1 == null) continue;

      // Forward return from t+1 to t+1+h
      const r_forward = Math.log(S_forward / S_tp1);
      forwardReturnsByBucket[bucketId][h].push(r_forward);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 8. Build ReactionBucketForwardStats[] from collected data
  // ───────────────────────────────────────────────────────────────────────────
  const stats: ReactionBucketForwardStats[] = [];

  for (const bucket of Object.keys(forwardReturnsByBucket) as ZBucketId[]) {
    for (const h of horizons) {
      const values = forwardReturnsByBucket[bucket][h];
      if (!values || values.length === 0) continue;

      const { mean, std, q10, q25, q50, q75, q90 } = summarizeForwardReturns(values);
      const nObs = values.length;
      const pUp = values.filter((v) => v > 0).length / nObs;

      stats.push({
        bucketId: bucket,
        horizon: h,
        nObs,
        pUp,
        meanReturn: mean,
        stdReturn: std,
        q10,
        q25,
        q50,
        q75,
        q90,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 9. Determine train/test date ranges
  // ───────────────────────────────────────────────────────────────────────────
  const trainStart = train[0].date_t;
  const trainEnd = train[train.length - 1].date_t;
  const testStart = test[0].date_t;
  const testEnd = test[test.length - 1].date_t;

  // ───────────────────────────────────────────────────────────────────────────
  // 10. Return the ReactionMapResult
  // ───────────────────────────────────────────────────────────────────────────
  return {
    symbol,
    config,
    stats,
    meta: {
      trainStart,
      trainEnd,
      testStart,
      testEnd,
      nTrain: train.length,
      nTest: test.length,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tilt Config Builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a ReactionMapResult (computed on the train sample) into an
 * EwmaTiltConfig for a specified horizon.
 *
 * The tilt μ_t for each bucket is the shrunk mean forward return:
 *   μ_tilt = shrinkFactor * meanReturn_{bucket,h}
 *
 * @param reaction - The reaction map result from buildEwmaReactionMap
 * @param options - Optional config: shrinkFactor (0..1, default 0.5), horizon (default from config)
 * @returns EwmaTiltConfig with muByBucket for the specified horizon
 */
export function buildEwmaTiltConfigFromReactionMap(
  reaction: ReactionMapResult,
  options?: { shrinkFactor?: number; horizon?: number }
): EwmaTiltConfig {
  const { symbol, config, stats } = reaction;
  const shrinkFactor = options?.shrinkFactor ?? 0.5;
  const horizon = options?.horizon ?? (config.horizons?.[0] ?? 1);

  // Extract meanReturn at h=1 per bucket
  const muByBucket: Partial<Record<ZBucketId, number>> = {};

  for (const s of stats) {
    if (s.horizon !== horizon) continue;
    // s.meanReturn is E[r_{t+1..t+1+h} | bucket] in log space
    // Apply shrink factor: mu_tilt = k * meanReturn
    muByBucket[s.bucketId] = s.meanReturn * shrinkFactor;
  }

  return {
    symbol,
    lambda: config.lambda,
    coverage: config.coverage,
    horizon,
    shrinkFactor,
    muByBucket,
  };
}
