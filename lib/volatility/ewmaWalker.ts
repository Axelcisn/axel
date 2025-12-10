/**
 * EWMA Walker - Exponentially Weighted Moving Average volatility forecaster
 * with h-day ahead prediction intervals for backtesting diagnostics.
 * 
 * This implements a "walk-forward" approach:
 * - At each time t, use data up to t to estimate daily volatility σ_t
 * - Forecast for t+h: ŷ_{t+h} = S_t (random walk center)
 * - H-day volatility is σ_h = σ_t × √h
 * - Prediction interval: [L_{t+h}, U_{t+h}] = S_t × exp(±z_{α/2} × σ_t × √h)
 * - Then observe S_{t+h} and evaluate coverage
 * 
 * Default horizon h=1 gives the classic 1-day forecast.
 */

import { loadCanonicalDataWithYahooSupplement } from '../storage/canonical';
import { getNormalCritical } from '../forecast/critical';
import { generateFutureTradingDates } from '../chart/tradingDays';
import type { EwmaTiltConfig, ZBucketId } from './ewmaReaction';
import { bucketIdForZ, DEFAULT_Z_BUCKETS } from './ewmaReaction';

/**
 * A single forecast point from the EWMA walker
 */
export interface EwmaWalkerPoint {
  /** Date at forecast origin */
  date_t: string;
  /** Date of target (t+h, where h is the horizon) */
  date_tp1: string;
  /** Price at t */
  S_t: number;
  /** Realized price at t+h */
  S_tp1: number;
  /** Forecast center (= S_t for random walk) */
  y_hat_tp1: number;
  /** Lower bound of PI */
  L_tp1: number;
  /** Upper bound of PI */
  U_tp1: number;
  /** EWMA volatility at t (daily) */
  sigma_t: number;
  /** Standardized error: (log(S_{t+h}/S_t)) / (sigma_t * sqrt(h)) */
  standardizedError: number;
  /** Whether realized price is inside PI */
  insidePi: boolean;
  /** Direction correct: forecast direction matches realized */
  directionCorrect: boolean;
}

/**
 * Out-of-sample forecast point at horizon h beyond last historical date
 */
export interface EwmaOosForecastPoint {
  /** Last historical date used as origin (T) */
  originDate: string;
  /** Future target date at horizon h (T+h trading days) */
  targetDate: string;
  /** Last historical price S_T */
  S_t: number;
  /** Random-walk forecast center at horizon h (= S_T) */
  y_hat: number;
  /** Lower bound of h-day PI */
  L: number;
  /** Upper bound of h-day PI */
  U: number;
  /** EWMA daily volatility at T */
  sigma_t: number;
}

/**
 * PI metrics for a single point
 */
export interface EwmaPiMetric {
  date: string;
  lower: number;
  upper: number;
  realized: number;
  inside: boolean;
  intervalScore: number;
}

/**
 * Aggregated metrics from the EWMA walk
 */
export interface EwmaAggregatedMetrics {
  /** Empirical coverage rate */
  coverage: number;
  /** Target coverage (e.g., 0.95) */
  targetCoverage: number;
  /** Average interval score */
  avg_interval_score: number;
  /** Total number of observations */
  count: number;
}

/**
 * Parameters for running the EWMA walker
 */
export interface EwmaWalkerParams {
  /** Stock symbol */
  symbol: string;
  /** EWMA decay factor (typical: 0.94 for daily data) */
  lambda?: number;
  /** Start date for walk (ISO string) */
  startDate?: string;
  /** End date for walk (ISO string) */
  endDate?: string;
  /** Initial window size for first volatility estimate */
  initialWindow?: number;
  /** Desired coverage level (e.g., 0.95) */
  coverage?: number;
  /** Forecast horizon in trading days (default 1) */
  horizon?: number;
  /** Optional tilt config for biased drift by z-bucket (log-return units) */
  tiltConfig?: EwmaTiltConfig;
}

/**
 * Result of running the EWMA walker
 */
export interface EwmaWalkerResult {
  /** All forecast points (in-sample only) */
  points: EwmaWalkerPoint[];
  /** Per-point PI metrics (in-sample only) */
  piMetrics: EwmaPiMetric[];
  /** Aggregated performance metrics (in-sample only) */
  aggregatedMetrics: EwmaAggregatedMetrics;
  /** Parameters used (tiltConfig is optional) */
  params: Required<Omit<EwmaWalkerParams, 'symbol' | 'tiltConfig'>> & { tiltConfig?: EwmaTiltConfig };
  /** Optional out-of-sample tail forecast at horizon h (NOT included in diagnostics) */
  oosForecast?: EwmaOosForecastPoint;
}

/**
 * Compute interval score for a single observation
 * Lower is better; penalizes both width and misses
 */
function computeIntervalScore(
  lower: number,
  upper: number,
  realized: number,
  alpha: number
): number {
  const width = upper - lower;
  let score = width;
  
  if (realized < lower) {
    score += (2 / alpha) * (lower - realized);
  } else if (realized > upper) {
    score += (2 / alpha) * (realized - upper);
  }
  
  return score;
}

/**
 * Run the EWMA walker on historical data
 */
export async function runEwmaWalker(params: EwmaWalkerParams): Promise<EwmaWalkerResult> {
  const {
    symbol,
    lambda = 0.94,
    startDate,
    endDate,
    initialWindow = 252,
    coverage = 0.95,
    horizon = 1,
    tiltConfig,
  } = params;

  // Validate and normalize horizon
  const h = Number.isFinite(horizon) && horizon >= 1 ? Math.floor(horizon) : 1;

  // Check if we have a valid tilt config for this horizon
  const tiltHorizon = tiltConfig?.horizon;
  const hasTilt =
    !!tiltConfig &&
    tiltConfig.muByBucket &&
    Object.keys(tiltConfig.muByBucket).length > 0 &&
    (tiltHorizon === undefined || tiltHorizon === h);

  // Load canonical data (supplemented with Yahoo for recent dates)
  const rawData = await loadCanonicalDataWithYahooSupplement(symbol);
  if (!rawData || rawData.length === 0) {
    throw new Error(`No canonical data found for ${symbol}`);
  }

  // Filter to valid rows and sort by date
  let data = rawData
    .filter(row => row.adj_close !== null && row.adj_close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Apply date filters
  if (startDate) {
    data = data.filter(row => row.date >= startDate);
  }
  if (endDate) {
    data = data.filter(row => row.date <= endDate);
  }

  // Need enough data for initial window plus h steps for at least one forecast
  if (data.length < initialWindow + h + 1) {
    throw new Error(
      `Insufficient data: need ${initialWindow + h + 1} rows for h=${h}, have ${data.length}`
    );
  }

  // Compute log returns
  const logReturns: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const ret = Math.log(data[i].adj_close! / data[i - 1].adj_close!);
    logReturns.push(ret);
  }

  // Get critical value for coverage
  const alpha = 1 - coverage;
  const z = getNormalCritical(1 - alpha / 2);

  // Precompute sqrt(h) for h-day volatility scaling
  const sqrtH = Math.sqrt(h);

  const points: EwmaWalkerPoint[] = [];
  const piMetrics: EwmaPiMetric[] = [];

  // Walk forward starting after initial window
  // data index: 0, 1, ..., initialWindow-1, initialWindow, ...
  // At index t (starting from initialWindow), we forecast for t+h
  // Stop h steps before the end so that target index t+h is always valid
  for (let t = initialWindow; t < data.length - h; t++) {
    // Compute EWMA variance up to time t
    // Use returns from index 0 to t-1 (since return[i] is from data[i] to data[i+1])
    const returnsUpToT = logReturns.slice(0, t);
    
    // Initialize with sample variance of first chunk
    const initialReturns = returnsUpToT.slice(0, initialWindow);
    const meanRet = initialReturns.reduce((sum, r) => sum + r, 0) / initialReturns.length;
    let variance = initialReturns.reduce((sum, r) => sum + Math.pow(r - meanRet, 2), 0) 
                   / (initialReturns.length - 1);

    // Apply EWMA recursion from initialWindow onwards
    for (let j = initialWindow; j < returnsUpToT.length; j++) {
      variance = lambda * variance + (1 - lambda) * Math.pow(returnsUpToT[j], 2);
    }

    // Daily volatility at time t
    const sigma_t = Math.sqrt(variance);
    
    // H-day horizon volatility
    const sigma_h = sigma_t * sqrtH;
    
    const S_t = data[t].adj_close!;
    const S_target = data[t + h].adj_close!;  // t + h
    const date_t = data[t].date;
    const date_target = data[t + h].date;

    // Compute standardized error for z-bucket classification (always relative to neutral)
    const logReturnH = Math.log(S_target / S_t);
    const standardizedError = logReturnH / sigma_h;

    // Baseline drift is 0 (neutral random walk)
    let mu_t = 0;

    // If we have a tiltConfig for this horizon, get bucket-specific mu
    if (hasTilt) {
      const bucketId = bucketIdForZ(standardizedError, DEFAULT_Z_BUCKETS);
      if (bucketId && tiltConfig!.muByBucket[bucketId] != null) {
        mu_t = tiltConfig!.muByBucket[bucketId]!;
      }
    }

    // Forecast center in log-space: log(S_t) + mu_t
    const y_hat_target = S_t * Math.exp(mu_t);

    // Prediction interval shifted by the same drift
    // PI: S_t × exp(μ_t ± z × σ_h)
    const L_target = S_t * Math.exp(mu_t - z * sigma_h);
    const U_target = S_t * Math.exp(mu_t + z * sigma_h);

    // Evaluate coverage relative to the (possibly tilted) band
    const insidePi = S_target >= L_target && S_target <= U_target;

    // Direction: for tilted, check if realized moved in same direction as predicted drift
    // For neutral (mu_t=0), this is just whether price went up
    const directionCorrect = mu_t === 0
      ? logReturnH >= 0
      : Math.sign(logReturnH) === Math.sign(mu_t);

    const point: EwmaWalkerPoint = {
      date_t,
      date_tp1: date_target,  // Keep field name for compatibility, but it's now t+h
      S_t,
      S_tp1: S_target,
      y_hat_tp1: y_hat_target,
      L_tp1: L_target,
      U_tp1: U_target,
      sigma_t,
      standardizedError,
      insidePi,
      directionCorrect
    };
    points.push(point);

    // Compute interval score (in log space for comparability)
    const intervalScore = computeIntervalScore(
      Math.log(L_target),
      Math.log(U_target),
      Math.log(S_target),
      alpha
    );

    piMetrics.push({
      date: date_target,
      lower: L_target,
      upper: U_target,
      realized: S_target,
      inside: insidePi,
      intervalScore
    });
  }

  // Aggregate metrics
  const totalInside = points.filter(p => p.insidePi).length;
  const empiricalCoverage = totalInside / points.length;
  const avgIntervalScore = piMetrics.reduce((sum, m) => sum + m.intervalScore, 0) / piMetrics.length;

  const aggregatedMetrics: EwmaAggregatedMetrics = {
    coverage: empiricalCoverage,
    targetCoverage: coverage,
    avg_interval_score: avgIntervalScore,
    count: points.length
  };

  // --- Compute OOS forecast at horizon h beyond last historical date ---
  // We need σ at the very last date (index n-1), not just n-h-1
  // Recompute EWMA variance up to the last available return
  const n = data.length;
  const lastDate = data[n - 1].date;
  const S_T = data[n - 1].adj_close!;

  // Initialize variance with the first initialWindow returns
  const initialReturnsForOOS = logReturns.slice(0, initialWindow);
  const meanRetOOS = initialReturnsForOOS.reduce((sum, r) => sum + r, 0) / initialReturnsForOOS.length;
  let varianceOOS = initialReturnsForOOS.reduce((sum, r) => sum + Math.pow(r - meanRetOOS, 2), 0)
                    / (initialReturnsForOOS.length - 1);

  // Apply EWMA recursion all the way to the last available return (logReturns.length - 1)
  // logReturns[i] is the return from data[i] to data[i+1], so logReturns has length n-1
  for (let j = initialWindow; j < logReturns.length; j++) {
    varianceOOS = lambda * varianceOOS + (1 - lambda) * Math.pow(logReturns[j], 2);
  }

  const sigmaAtLastDate = Math.sqrt(varianceOOS);

  // Build OOS forecast point
  let oosForecast: EwmaOosForecastPoint | undefined;

  // Generate h future trading dates from lastDate
  const futureDates = generateFutureTradingDates(lastDate, h);

  if (futureDates && futureDates.length > 0) {
    // Target date is the h-th future trading day
    const targetDate = futureDates[futureDates.length - 1];

    // H-day volatility for OOS
    const sigma_h_oos = sigmaAtLastDate * sqrtH;

    // For OOS, we need to determine what bucket the last observation falls into
    // Use the last in-sample point's standardizedError if available
    let mu_oos = 0;
    if (hasTilt && points.length > 0) {
      const lastZ = points[points.length - 1].standardizedError;
      const bucketId = bucketIdForZ(lastZ, DEFAULT_Z_BUCKETS);
      if (bucketId && tiltConfig!.muByBucket[bucketId] != null) {
        mu_oos = tiltConfig!.muByBucket[bucketId]!;
      }
    }

    // Forecast center with optional drift
    const y_hat_oos = S_T * Math.exp(mu_oos);
    const L_oos = S_T * Math.exp(mu_oos - z * sigma_h_oos);
    const U_oos = S_T * Math.exp(mu_oos + z * sigma_h_oos);

    oosForecast = {
      originDate: lastDate,
      targetDate,
      S_t: S_T,
      y_hat: y_hat_oos,
      L: L_oos,
      U: U_oos,
      sigma_t: sigmaAtLastDate,
    };
  }

  return {
    points,
    piMetrics,
    aggregatedMetrics,
    params: {
      lambda,
      startDate: startDate || data[0].date,
      endDate: endDate || data[data.length - 1].date,
      initialWindow,
      coverage,
      horizon: h,
      tiltConfig,
    },
    oosForecast,
  };
}

/**
 * Compute summary statistics from EWMA walker results
 */
export function summarizeEwmaWalkerResults(result: EwmaWalkerResult) {
  const { points, aggregatedMetrics } = result;

  // Z-score statistics
  const zScores = points.map(p => p.standardizedError);
  const zMean = zScores.reduce((sum, z) => sum + z, 0) / zScores.length;
  const zVariance = zScores.reduce((sum, z) => sum + Math.pow(z - zMean, 2), 0) / zScores.length;
  const zStd = Math.sqrt(zVariance);

  // Direction hit rate (count of insidePi for simplified version)
  const directionHitRate = points.filter(p => p.directionCorrect).length / points.length;

  // Volatility statistics
  const volatilities = points.map(p => p.sigma_t);
  const avgVolatility = volatilities.reduce((sum, v) => sum + v, 0) / volatilities.length;
  const minVolatility = Math.min(...volatilities);
  const maxVolatility = Math.max(...volatilities);

  // Average band width (as percentage)
  const avgWidth = points.reduce((sum, p) => {
    const width = (p.U_tp1 - p.L_tp1) / p.S_t;
    return sum + width;
  }, 0) / points.length;

  return {
    coverage: aggregatedMetrics.coverage,
    targetCoverage: aggregatedMetrics.targetCoverage,
    intervalScore: aggregatedMetrics.avg_interval_score,
    avgWidth,
    zMean,
    zStd,
    directionHitRate,
    nPoints: points.length,
    volatilityStats: {
      avg: avgVolatility,
      min: minVolatility,
      max: maxVolatility
    },
    dateRange: {
      start: points[0]?.date_t,
      end: points[points.length - 1]?.date_tp1
    }
  };
}
