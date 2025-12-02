/**
 * EWMA Tilt Simulation Module
 *
 * Applies a small drift/tilt (μ ≠ 0) to EWMA forecasts based on the
 * reaction map (conditional mean forward returns by z-bucket).
 *
 * This module:
 * 1. Builds a ReactionMap on the training sample,
 * 2. Converts it to a tilt config (μ_bucket for h=1),
 * 3. Applies the tilt to EWMA forecasts on the test sample,
 * 4. Compares baseline (μ=0) vs tilted (μ=μ_bucket) performance.
 */

import {
  EwmaTiltConfig,
  bucketIdForZ,
  ZBucketId,
  ReactionConfig,
  buildEwmaReactionMap,
  buildEwmaTiltConfigFromReactionMap,
  DEFAULT_Z_BUCKETS,
} from "./ewmaReaction";
import { runEwmaWalker, EwmaWalkerPoint } from "./ewmaWalker";
import { loadCanonicalData } from "../storage/canonical";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-point results comparing baseline (μ=0) vs tilted (μ=μ_bucket) forecasts.
 * 
 * Timeline:
 * - date_t: forecast origin
 * - date_tp1: signal observation date (z_t is known)
 * - date_tp2: forward target date (what we're predicting)
 * - realizedLogReturn = log(S_{t+2} / S_{t+1})
 */
export interface EwmaTiltPoint {
  date_t: string;
  date_tp1: string;
  date_tp2: string;       // forward target date
  S_t: number;
  S_tp1: number;
  S_tp2: number;          // realized price at t+2
  z_t: number;            // standardizedError from baseline walker (known at t+1)
  sigma_t: number;

  // Baseline (μ=0): predict S_{t+2} = S_{t+1}
  y_hat_baseline: number;
  L_baseline: number;
  U_baseline: number;

  // Tilted (μ_t = mu_{bucket}): predict S_{t+2} = S_{t+1} * exp(μ_t)
  bucketId: ZBucketId | null;
  mu_t: number;           // applied drift (log-return)
  y_hat_tilted: number;
  L_tilted: number;
  U_tilted: number;

  // Realized forward return (t+1 → t+2) and errors
  realizedLogReturn: number;
  z_error_baseline: number;
  z_error_tilted: number;

  dirCorrect_baseline: boolean;
  dirCorrect_tilted: boolean;
  insidePi_baseline: boolean;
  insidePi_tilted: boolean;
}

/**
 * Result of the tilt simulation.
 */
export interface EwmaTiltResult {
  symbol: string;
  horizon: number;
  lambda: number;
  coverage: number;
  shrinkFactor: number;
  tiltConfig: EwmaTiltConfig;
  points: EwmaTiltPoint[];
  meta: {
    trainStart: string;
    trainEnd: string;
    testStart: string;
    testEnd: string;
    nTrain: number;
    nTest: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: get z-critical value for a given coverage
// ─────────────────────────────────────────────────────────────────────────────

function getZCritical(coverage: number): number {
  // Common values
  if (coverage === 0.95) return 1.96;
  if (coverage === 0.90) return 1.645;
  if (coverage === 0.99) return 2.576;
  // Approximate using inverse normal (good enough for this purpose)
  // For coverage p, we want z such that Φ(z) - Φ(-z) = p
  // i.e., 2*Φ(z) - 1 = p, so Φ(z) = (1+p)/2
  const p = (1 + coverage) / 2;
  // Approximation for inverse normal CDF
  const a = 0.4361836;
  const b = -0.1201676;
  const c = 0.937298;
  const t = Math.sqrt(-2 * Math.log(1 - p));
  return t - (a + b * t + c * t * t) / (1 + 0.33267 * t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run a tilt simulation comparing baseline EWMA (μ=0) vs tilted EWMA (μ=μ_bucket).
 *
 * This function:
 * 1. Runs EWMA walker to get baseline z-scores and volatilities,
 * 2. Splits into train/test using the same logic as buildEwmaReactionMap,
 * 3. Builds a ReactionMap on train and converts to tilt config,
 * 4. Applies the tilt only on test points,
 * 5. Returns per-point comparisons and aggregated metrics.
 *
 * @param symbol - Ticker symbol
 * @param reactionConfig - Reaction configuration (lambda, coverage, trainFraction, etc.)
 * @param shrinkFactor - Shrinkage factor for the tilt (0..1), default 0.5
 * @returns EwmaTiltResult with per-point comparisons
 */
export async function runEwmaTiltSimulation(
  symbol: string,
  reactionConfig: ReactionConfig,
  shrinkFactor: number = 0.5
): Promise<EwmaTiltResult> {
  const { lambda, coverage, trainFraction, minTrainObs, zBuckets } = reactionConfig;

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Run EWMA walker to get baseline points
  // ───────────────────────────────────────────────────────────────────────────
  const walkerResult = await runEwmaWalker({ symbol, lambda, coverage });
  const points: EwmaWalkerPoint[] = walkerResult.points;

  if (!points.length) {
    throw new Error(`EWMA walker returned no points for ${symbol}`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Sort by date_t
  // ───────────────────────────────────────────────────────────────────────────
  const sorted = [...points].sort((a, b) =>
    a.date_t < b.date_t ? -1 : a.date_t > b.date_t ? 1 : 0
  );

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Compute train/test split
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
  // 4. Build ReactionMap on train and convert to tilt config
  // ───────────────────────────────────────────────────────────────────────────
  // Note: This calls buildEwmaReactionMap which re-runs the walker internally.
  // For v1 this is acceptable; we can refactor later to share walker results.
  const reactionMap = await buildEwmaReactionMap(symbol, {
    ...reactionConfig,
    horizons: [1], // Only need h=1 for tilt
  });

  const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor, horizon: 1 });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Get z-critical for the coverage
  // ───────────────────────────────────────────────────────────────────────────
  const zCrit = getZCritical(coverage);

  // ───────────────────────────────────────────────────────────────────────────
  // 5b. Load canonical data to get forward prices (t+1 → t+2)
  // ───────────────────────────────────────────────────────────────────────────
  const rows = await loadCanonicalData(symbol);
  const priceByDate = new Map<string, number>();
  for (const row of rows) {
    const S = row.adj_close ?? row.close;
    if (S != null && Number.isFinite(S)) {
      priceByDate.set(row.date, S);
    }
  }
  const canonicalDates = rows.map((r) => r.date);
  const indexByDate = new Map<string, number>();
  canonicalDates.forEach((d, idx) => indexByDate.set(d, idx));

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Apply tilt on test points and build EwmaTiltPoint[]
  //
  // IMPORTANT: The signal z_t = log(S_{t+1}/S_t) / σ_t is known at end of day t+1.
  // The tilt predicts the NEXT day's return: t+1 → t+2.
  // So we need to look up S_{t+2} to compute the true forward return.
  // ───────────────────────────────────────────────────────────────────────────
  const tiltPoints: EwmaTiltPoint[] = [];

  for (const p of test) {
    const date_t = p.date_t;
    const date_tp1 = p.date_tp1;
    const S_t = p.S_t;
    const S_tp1 = p.S_tp1;
    const sigma_t = p.sigma_t;
    const z_t = p.standardizedError;

    // Find the index of t+1 and get S_{t+2}
    const idx_tp1 = indexByDate.get(date_tp1);
    if (idx_tp1 == null) continue;
    
    const idx_tp2 = idx_tp1 + 1;
    if (idx_tp2 >= canonicalDates.length) continue;
    
    const date_tp2 = canonicalDates[idx_tp2];
    const S_tp2 = priceByDate.get(date_tp2);
    if (S_tp2 == null) continue;

    // The forward return we're predicting is t+1 → t+2 (AFTER the signal)
    const realizedLogReturn = Math.log(S_tp2 / S_tp1);

    // ─────────────────────────────────────────────────────────────────────────
    // Baseline (μ = 0): predict S_{t+2} = S_{t+1}
    // ─────────────────────────────────────────────────────────────────────────
    const mu_baseline = 0;
    const y_hat_baseline = S_tp1 * Math.exp(mu_baseline); // = S_tp1
    const L_baseline = S_tp1 * Math.exp(mu_baseline - zCrit * sigma_t);
    const U_baseline = S_tp1 * Math.exp(mu_baseline + zCrit * sigma_t);

    const z_error_baseline = (realizedLogReturn - mu_baseline) / sigma_t;
    
    // Check if realized S_{t+2} is inside baseline PI
    const insidePi_baseline = S_tp2 >= L_baseline && S_tp2 <= U_baseline;

    // ─────────────────────────────────────────────────────────────────────────
    // Tilted (μ_t = muByBucket[bucketId])
    // ─────────────────────────────────────────────────────────────────────────
    const bucketId = bucketIdForZ(z_t, zBuckets);
    const mu_t =
      bucketId != null && tiltConfig.muByBucket[bucketId] != null
        ? tiltConfig.muByBucket[bucketId]!
        : 0;

    const y_hat_tilted = S_tp1 * Math.exp(mu_t);
    const L_tilted = S_tp1 * Math.exp(mu_t - zCrit * sigma_t);
    const U_tilted = S_tp1 * Math.exp(mu_t + zCrit * sigma_t);

    const z_error_tilted = (realizedLogReturn - mu_t) / sigma_t;
    
    // Direction correctness:
    // - For tilted: did the realized return (t+1→t+2) have the same sign as μ_t?
    // - For baseline: always bet "up" (50% expected hit rate)
    const dirCorrect_tilted =
      mu_t === 0
        ? realizedLogReturn >= 0  // no tilt = no directional bet, count up as win
        : Math.sign(realizedLogReturn) === Math.sign(mu_t);
    
    const dirCorrect_baseline = realizedLogReturn >= 0;  // baseline = always bet "up"
    
    // Check if realized S_{t+2} is inside tilted PI
    const insidePi_tilted = S_tp2 >= L_tilted && S_tp2 <= U_tilted;

    tiltPoints.push({
      date_t,
      date_tp1,
      date_tp2,
      S_t,
      S_tp1,
      S_tp2,
      z_t,
      sigma_t,

      // Baseline
      y_hat_baseline,
      L_baseline,
      U_baseline,

      // Tilted
      bucketId,
      mu_t,
      y_hat_tilted,
      L_tilted,
      U_tilted,

      // Realized
      realizedLogReturn,
      z_error_baseline,
      z_error_tilted,

      dirCorrect_baseline,
      dirCorrect_tilted,
      insidePi_baseline,
      insidePi_tilted,
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Return result
  // ───────────────────────────────────────────────────────────────────────────
  return {
    symbol,
    horizon: 1,
    lambda,
    coverage,
    shrinkFactor,
    tiltConfig,
    points: tiltPoints,
    meta: {
      trainStart: train[0].date_t,
      trainEnd: train[train.length - 1].date_t,
      testStart: test[0].date_t,
      testEnd: test[test.length - 1].date_t,
      nTrain: train.length,
      nTest: test.length,
    },
  };
}
