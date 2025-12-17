import { simulateTrading212Cfd, Trading212CfdConfig, Trading212Signal, Trading212SimBar } from "@/lib/backtest/trading212Cfd";
import { ensureCanonicalOrHistory } from "@/lib/storage/canonical";
import {
  bucketIdForZ,
  DEFAULT_Z_BUCKETS,
  type ReactionBucketForwardStats,
  type ReactionMapResult,
  buildEwmaTiltConfigFromReactionMap,
} from "@/lib/volatility/ewmaReaction";
import { runEwmaWalker, type EwmaWalkerPoint } from "@/lib/volatility/ewmaWalker";
import type { CanonicalRow } from "@/lib/types/canonical";

export const EWMA_LAMBDA_GRID = Array.from({ length: 11 }, (_, i) =>
  Math.min(0.99, Math.round((0.5 + i * 0.05) * 100) / 100)
);

export interface EwmaLambdaCalmarParams {
  symbol: string;
  rangeStart: string; // YYYY-MM-DD
  coverage?: number;
  horizon?: number;
  initialEquity?: number;
  leverage?: number;
  positionFraction?: number;
  costBps?: number;
  shrinkFactor?: number;
  signalRule?: "z";
  zEnter?: number;
  zExit?: number;
  zFlip?: number;
  trainingData?: CalmarTrainingData;
}

export interface EwmaLambdaCalmarResult {
  lambdaStar: number | null;
  calmarScore: number;
  trainSpan: { start: string; end: string };
  updatedAt: string;
  note?: string | null;
  noTrade?: boolean;
  grid: Array<{
    lambda: number;
    calmar: number;
    returnPct: number;
    maxDrawdown: number;
  }>;
}

export interface CalmarTrainingData {
  cleanRows: CanonicalRow[];
  trainRows: CanonicalRow[];
  trainStart: string;
  trainEnd: string;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function summarizeBucketReturns(
  points: EwmaWalkerPoint[],
  horizon: number
): ReactionBucketForwardStats[] {
  const returnsByBucket = new Map<string, number[]>();

  for (const p of points) {
    const z = p.standardizedError;
    const bucket = Number.isFinite(z) ? bucketIdForZ(z, DEFAULT_Z_BUCKETS) : null;
    if (!bucket) continue;
    const r = Math.log(p.S_tp1 / p.S_t);
    if (!Number.isFinite(r)) continue;
    const arr = returnsByBucket.get(bucket) ?? [];
    arr.push(r);
    returnsByBucket.set(bucket, arr);
  }

  return DEFAULT_Z_BUCKETS.map((bucket) => {
    const values = returnsByBucket.get(bucket.id) ?? [];
    const n = values.length;
    const mean = n ? values.reduce((s, v) => s + v, 0) / n : 0;
    const variance =
      n > 1 ? values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (n - 1) : 0;
    const stdReturn = n > 0 ? Math.sqrt(variance) : 0;
    const sorted = [...values].sort((a, b) => a - b);

    return {
      bucketId: bucket.id,
      horizon,
      nObs: n,
      pUp: n ? values.filter((v) => v > 0).length / n : 0,
      meanReturn: mean,
      stdReturn,
      q10: quantile(sorted, 0.1),
      q25: quantile(sorted, 0.25),
      q50: quantile(sorted, 0.5),
      q75: quantile(sorted, 0.75),
      q90: quantile(sorted, 0.9),
    };
  });
}

export async function loadCalmarTrainingData(symbol: string, rangeStart: string): Promise<CalmarTrainingData> {
  const { rows } = await ensureCanonicalOrHistory(symbol, { interval: "1d", minRows: 260 });
  const cleanRows = rows
    .filter((r) => {
      const price = r.adj_close ?? r.close;
      return r.date && price != null && price > 0;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const trainRows = cleanRows.filter((r) => r.date < rangeStart);
  if (trainRows.length === 0) {
    throw new Error(`No historical data found before ${rangeStart}`);
  }

  const trainStart = trainRows[0].date;
  const trainEnd = trainRows[trainRows.length - 1].date;

  return { cleanRows, trainRows, trainStart, trainEnd };
}

function buildZSignalBars(
  rows: CanonicalRow[],
  path: EwmaWalkerPoint[],
  horizon: number,
  thresholds: { enter: number; exit: number; flip: number }
): Trading212SimBar[] {
  if (!path.length) return [];
  const ewmaMap = new Map<string, EwmaWalkerPoint>();
  path.forEach((p) => ewmaMap.set(p.date_tp1, p));

  const sqrtH = Math.sqrt(horizon);
  const bars: Trading212SimBar[] = [];
  let qPrev = 0;

  for (const row of rows) {
    const price = row.adj_close ?? row.close;
    if (!price || !row.date) continue;
    const ewma = ewmaMap.get(row.date);
    if (!ewma) continue;

    const muBase = Math.log(ewma.y_hat_tp1 / ewma.S_t);
    const sigmaH = ewma.sigma_t != null ? ewma.sigma_t * sqrtH : NaN;
    const zEdge =
      Number.isFinite(muBase) && Number.isFinite(sigmaH) && sigmaH > 0 ? muBase / sigmaH : 0;

    let q = qPrev;
    if (qPrev === 0) {
      if (zEdge >= thresholds.enter) q = 1;
      else if (zEdge <= -thresholds.enter) q = -1;
    } else if (qPrev === 1) {
      if (zEdge <= -thresholds.flip) q = -1;
      else if (zEdge <= thresholds.exit) q = 0;
    } else if (qPrev === -1) {
      if (zEdge >= thresholds.flip) q = 1;
      else if (zEdge >= -thresholds.exit) q = 0;
    }
    qPrev = q;

    let signal: Trading212Signal = "flat";
    if (q > 0) signal = "long";
    else if (q < 0) signal = "short";

    bars.push({ date: row.date, price, signal });
  }

  return bars;
}

export async function optimizeEwmaLambdaCalmar(
  params: EwmaLambdaCalmarParams
): Promise<EwmaLambdaCalmarResult> {
  const symbol = (params.symbol || "").toUpperCase();
  const rangeStart = params.rangeStart;
  if (!symbol) {
    throw new Error("Symbol is required");
  }
  if (!rangeStart) {
    throw new Error("rangeStart is required");
  }

  const coverage = params.coverage ?? 0.95;
  const horizon = Math.max(1, Math.floor(params.horizon ?? 1));
  const initialEquity = params.initialEquity ?? 1000;
  const leverage = params.leverage ?? 5;
  const positionFraction = params.positionFraction ?? 0.25;
  const costBps = params.costBps ?? 0;
  const shrinkFactor = Math.min(1, Math.max(0, params.shrinkFactor ?? 0.5));
  const signalRule = params.signalRule ?? "z";
  const zEnter = params.zEnter ?? 0.3;
  const zExit = params.zExit ?? 0.1;
  const zFlip = params.zFlip ?? 0.6;

  if (signalRule !== "z") {
    throw new Error("Only z signalRule is supported");
  }
  if (coverage <= 0 || coverage >= 1) {
    throw new Error("coverage must be between 0 and 1");
  }
  if (!Number.isFinite(initialEquity) || initialEquity <= 0) {
    throw new Error("initialEquity must be positive");
  }

  const { rows } = await ensureCanonicalOrHistory(symbol, { interval: "1d", minRows: 260 });
  const cleanRows = rows
    .filter((r) => {
      const price = r.adj_close ?? r.close;
      return r.date && price != null && price > 0;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const trainRows = cleanRows.filter((r) => r.date < rangeStart);
  if (trainRows.length === 0) {
    throw new Error(`No historical data found before ${rangeStart}`);
  }

  const trainStart = trainRows[0].date;
  const trainEnd = trainRows[trainRows.length - 1].date;

  const gridResults: EwmaLambdaCalmarResult["grid"] = [];

  for (const lambda of EWMA_LAMBDA_GRID) {
    try {
      const neutral = await runEwmaWalker({
        symbol,
        lambda,
        coverage,
        horizon,
        endDate: trainEnd,
      });
      if (!neutral.points.length) continue;

      const reactionStats = summarizeBucketReturns(neutral.points, horizon);
      const reactionMap: ReactionMapResult = {
        symbol,
        config: {
          lambda,
          coverage,
          horizons: [horizon],
          zBuckets: DEFAULT_Z_BUCKETS,
          trainFraction: 1,
          minTrainObs: neutral.points.length,
        },
        stats: reactionStats,
        meta: {
          trainStart,
          trainEnd,
          testStart: trainEnd,
          testEnd: trainEnd,
          nTrain: neutral.points.length,
          nTest: 0,
        },
      };

      const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, {
        shrinkFactor,
        horizon,
      });

      const biased = await runEwmaWalker({
        symbol,
        lambda,
        coverage,
        horizon,
        endDate: trainEnd,
        tiltConfig,
      });

      const bars = buildZSignalBars(trainRows, biased.points, horizon, {
        enter: zEnter,
        exit: zExit,
        flip: zFlip,
      });
      if (bars.length === 0) continue;

      const simConfig: Trading212CfdConfig = {
        leverage,
        fxFeeRate: 0,
        dailyLongSwapRate: 0,
        dailyShortSwapRate: 0,
        spreadBps: costBps,
        marginCallLevel: 0.45,
        stopOutLevel: 0.25,
        positionFraction,
      };

      const simResult = simulateTrading212Cfd(bars, initialEquity, simConfig);
      const returnPct = simResult.finalEquity / initialEquity - 1;
      const maxDrawdown = simResult.maxDrawdown ?? 0;
      const calmar = maxDrawdown > 0 ? returnPct / maxDrawdown : returnPct;

      if (!Number.isFinite(calmar)) continue;

      gridResults.push({
        lambda,
        calmar,
        returnPct,
        maxDrawdown,
      });
    } catch (err) {
      console.warn("[ewma-lambda-calmar] skipping lambda", lambda, err);
      continue;
    }
  }

  if (gridResults.length === 0) {
    throw new Error("No valid lambda candidates for Calmar search");
  }

  const best = gridResults.reduce((acc, cur) => (cur.calmar > acc.calmar ? cur : acc));
  const useBaseline = best.calmar < 0;

  return {
    lambdaStar: useBaseline ? null : best.lambda,
    calmarScore: useBaseline ? 0 : best.calmar,
    trainSpan: { start: trainStart, end: trainEnd },
    updatedAt: new Date().toISOString(),
    note: useBaseline ? "No-trade baseline selected" : null,
    noTrade: useBaseline,
    grid: gridResults,
  };
}
