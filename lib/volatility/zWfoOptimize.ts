import { CanonicalRow } from "../types/canonical";
import {
  simulateTrading212Cfd,
  Trading212CfdConfig,
  Trading212SimBar,
} from "../backtest/trading212Cfd";
import { EwmaWalkerPoint } from "./ewmaWalker";

type ZQuantiles = {
  enter: number;
  exit: number;
  flip: number;
};

export type ZHysteresisThresholds = {
  enterLong: number;
  enterShort: number;
  exitLong: number;
  exitShort: number;
  flipLong: number;
  flipShort: number;
};

export type ZFoldSummary = {
  foldStart: string;
  foldEnd: string;
  valStart: string;
  valEnd: string;
  thresholds: ZHysteresisThresholds;
  returnPct: number;
  maxDrawdown: number;
  tradeCount: number;
  closedTrades: number;
  profitFactor: number | null;
  shortOppCount: number;
  score: number;
  shortEntries?: number;
  signalStats?: SignalStats;
  constraints?: {
    flatPct?: number;
    minFlatPct?: number;
    closes?: number;
    minCloses?: number;
    flips?: number;
    flipPct?: number;
    maxFlipPct?: number | null;
  };
};

export type ZWfoResult = {
  best: {
    thresholds: ZHysteresisThresholds;
    quantiles: ZQuantiles;
    meanScore: number;
    folds: number;
    avgTradeCount: number;
    avgShortOppCount: number;
    totalShortEntries?: number;
    applyRecommended: boolean;
    baselineScore: number;
    bestScore: number;
    reason?: string;
  };
  foldSummaries: ZFoldSummary[];
  zEdgeSamples: number;
};

export type OptimizeZOptions = {
  symbol: string;
  horizon: number;
  ewmaPath: Pick<EwmaWalkerPoint, "date_tp1" | "y_hat_tp1" | "S_t" | "sigma_t">[];
  canonicalRows: CanonicalRow[];
  simStartDate?: string | null;
  trainLen: number;
  valLen: number;
  stepLen: number;
  quantilesEnter: number[];
  quantilesExit: number[];
  quantilesFlip: number[];
  tradingConfig: Trading212CfdConfig;
  initialEquity: number;
  minFlatPct?: number;
  minCloses?: number;
  maxFlipPct?: number | null;
  scorePenalty?: {
    flipGamma?: number;
    tradeEta?: number;
  };
};

type ZEdgePoint = {
  date: string;
  price: number;
  zEdge: number;
};

type SignalStats = {
  flatPct: number;
  flips: number;
  opens: number;
  closes: number;
  tradeCount: number;
};

export function summarizeSignalStats(bars: Trading212SimBar[]): SignalStats {
  if (!bars.length) {
    return { flatPct: 0, flips: 0, opens: 0, closes: 0, tradeCount: 0 };
  }
  let flat = 0;
  let flips = 0;
  let opens = 0;
  let closes = 0;
  let tradeCount = 0;
  let prev = bars[0].signal ?? "flat";
  if (prev !== "flat") tradeCount++;
  if (prev === "flat") flat++;
  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i].signal ?? "flat";
    if (cur === "flat") flat++;
    if (prev !== cur) {
      if (prev === "flat" && cur !== "flat") {
        opens++;
        tradeCount++;
      } else if (prev !== "flat" && cur === "flat") {
        closes++;
      } else if (prev !== "flat" && cur !== "flat") {
        flips++;
      }
    }
    prev = cur;
  }
  const flatPct = (flat / bars.length) * 100;
  return { flatPct, flips, opens, closes, tradeCount };
}

function computeAutoThresholds(zEdges: number[], fallbackEnter: number): ZHysteresisThresholds | null {
  if (!zEdges.length) return null;
  const exitRatio = 0.3;
  const flipRatio = 2.0;
  const targetQ = 0.9;
  const minSamples = 50;
  const pos = zEdges.filter((z) => z > 0);
  const neg = zEdges.filter((z) => z < 0).map((z) => -z);
  const absVals = zEdges.map((z) => Math.abs(z));

  const symEnter = quantile(absVals, targetQ);
  const enterLong = pos.length >= minSamples ? quantile(pos, targetQ) : symEnter;
  const enterShort = neg.length >= minSamples ? quantile(neg, targetQ) : symEnter;

  const enterLongFinal = Number.isFinite(enterLong) ? enterLong : fallbackEnter;
  const enterShortFinal = Number.isFinite(enterShort) ? enterShort : enterLongFinal;

  const thresholds: ZHysteresisThresholds = {
    enterLong: enterLongFinal,
    enterShort: enterShortFinal,
    exitLong: enterLongFinal * exitRatio,
    exitShort: enterShortFinal * exitRatio,
    flipLong: enterLongFinal * flipRatio,
    flipShort: enterShortFinal * flipRatio,
  };

  if (!(thresholds.exitLong < thresholds.enterLong && thresholds.enterLong < thresholds.flipLong)) return null;
  if (!(thresholds.exitShort < thresholds.enterShort && thresholds.enterShort < thresholds.flipShort)) return null;

  return thresholds;
}

function quantile(values: number[], q: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function deriveThresholds(zEdges: number[], qs: ZQuantiles): ZHysteresisThresholds | null {
  if (zEdges.length === 0) return null;
  const pos = zEdges.filter((z) => z > 0);
  const neg = zEdges.filter((z) => z < 0).map((z) => -z);
  const absVals = zEdges.map((z) => Math.abs(z));

  const enterL = pos.length ? quantile(pos, qs.enter) : quantile(absVals, qs.enter);
  const enterS = neg.length ? quantile(neg, qs.enter) : quantile(absVals, qs.enter);
  const exitL = pos.length ? quantile(pos, qs.exit) : quantile(absVals, qs.exit);
  const exitS = neg.length ? quantile(neg, qs.exit) : quantile(absVals, qs.exit);
  const flipL = pos.length ? quantile(pos, qs.flip) : quantile(absVals, qs.flip);
  const flipS = neg.length ? quantile(neg, qs.flip) : quantile(absVals, qs.flip);

  const parts = [enterL, enterS, exitL, exitS, flipL, flipS];
  if (!parts.every((v) => Number.isFinite(v) && v > 0)) {
    return null;
  }

  if (!(exitL < enterL && enterL < flipL)) return null;
  if (!(exitS < enterS && enterS < flipS)) return null;

  return {
    enterLong: enterL,
    enterShort: enterS,
    exitLong: exitL,
    exitShort: exitS,
    flipLong: flipL,
    flipShort: flipS,
  };
}

function computeEndState(zSeries: number[], thresholds: ZHysteresisThresholds, qPrev: number): number {
  let q = qPrev;
  for (const z of zSeries) {
    if (q === 0) {
      if (z >= thresholds.enterLong) q = 1;
      else if (z <= -thresholds.enterShort) q = -1;
    } else if (q === 1) {
      if (z <= -thresholds.flipShort) q = -1;
      else if (z <= thresholds.exitLong) q = 0;
    } else if (q === -1) {
      if (z >= thresholds.flipLong) q = 1;
      else if (z >= -thresholds.exitShort) q = 0;
    }
  }
  return q;
}

export function buildBarsFromZEdges(
  series: ZEdgePoint[],
  thresholds: ZHysteresisThresholds,
  qPrevStart = 0
): { bars: Trading212SimBar[]; qPrevEnd: number; shortOppCount: number; shortEntries: number } {
  const bars: Trading212SimBar[] = [];
  let qPrev = qPrevStart;
  let shortOppCount = 0;
  let shortEntries = 0;

  for (const point of series) {
    const { date, price, zEdge } = point;
    if (!Number.isFinite(price) || price <= 0) continue;

    let q = qPrev;
    if (qPrev === 0) {
      if (zEdge >= thresholds.enterLong) q = 1;
      else if (zEdge <= -thresholds.enterShort) q = -1;
    } else if (qPrev === 1) {
      if (zEdge <= -thresholds.flipShort) q = -1;
      else if (zEdge <= thresholds.exitLong) q = 0;
    } else if (qPrev === -1) {
      if (zEdge >= thresholds.flipLong) q = 1;
      else if (zEdge >= -thresholds.exitShort) q = 0;
    }

    qPrev = q;
    if (zEdge <= -thresholds.enterShort) {
      shortOppCount++;
    }

    let signal: Trading212SimBar["signal"] = "flat";
    if (q > 0) signal = "long";
    else if (q < 0) signal = "short";

    if (signal === "short" && (bars.length === 0 || bars[bars.length - 1].signal !== "short")) {
      shortEntries++;
    }

    bars.push({ date, price, signal });
  }

  return { bars, qPrevEnd: qPrev, shortOppCount, shortEntries };
}

function profitFactor(trades: ReturnType<typeof simulateTrading212Cfd>["trades"]): number | null {
  const closed = trades.filter((t) => t.exitDate);
  if (closed.length === 0) return null;
  const grossProfit = closed
    .filter((t) => (t.netPnl ?? 0) > 0)
    .reduce((a, t) => a + (t.netPnl ?? 0), 0);
  const grossLoss = Math.abs(
    closed.filter((t) => (t.netPnl ?? 0) < 0).reduce((a, t) => a + (t.netPnl ?? 0), 0)
  );
  if (grossLoss === 0) return grossProfit > 0 ? Infinity : null;
  return grossProfit / grossLoss;
}

function countTradeSegments(history: ReturnType<typeof simulateTrading212Cfd>["accountHistory"]): number {
  if (!history.length) return 0;
  let prevSide: typeof history[number]["side"] = null;
  let count = 0;
  for (const snap of history) {
    if (snap.side !== prevSide) {
      if (snap.side === "long" || snap.side === "short") {
        count++;
      }
    }
    prevSide = snap.side;
  }
  return count;
}

export function computeZEdgeSeries(
  canonicalRows: CanonicalRow[],
  ewmaPath: Pick<EwmaWalkerPoint, "date_tp1" | "y_hat_tp1" | "S_t" | "sigma_t">[],
  horizon: number,
  simStartDate?: string | null
): ZEdgePoint[] {
  const sqrtH = Math.sqrt(horizon);
  const ewmaMap = new Map<string, { y_hat_tp1: number; S_t: number; sigma_t: number }>();
  ewmaPath.forEach((p) => {
    ewmaMap.set(p.date_tp1, { y_hat_tp1: p.y_hat_tp1, S_t: p.S_t, sigma_t: p.sigma_t });
  });

  return canonicalRows
    .filter((row) => row.date && (!simStartDate || row.date >= simStartDate))
    .map((row) => {
      const price = row.adj_close ?? row.close;
      const ewma = row.date ? ewmaMap.get(row.date) : undefined;
      if (!price || !ewma) return null;

      const sigmaH = ewma.sigma_t * sqrtH;
      const muBase = Math.log(ewma.y_hat_tp1 / ewma.S_t);
      const zEdge =
        Number.isFinite(muBase) && Number.isFinite(sigmaH) && sigmaH > 0 ? muBase / sigmaH : NaN;

      if (!Number.isFinite(zEdge)) return null;

      return { date: row.date, price, zEdge };
    })
    .filter((p): p is ZEdgePoint => !!p)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function optimizeZHysteresisThresholds(options: OptimizeZOptions): Promise<ZWfoResult> {
  const {
    symbol,
    horizon,
    ewmaPath,
    canonicalRows,
    simStartDate,
    trainLen,
    valLen,
    stepLen,
    quantilesEnter,
    quantilesExit,
    quantilesFlip,
    tradingConfig,
    initialEquity,
    minFlatPct = 2,
    minCloses = 1,
    maxFlipPct = null,
    scorePenalty,
  } = options;

  const gamma = scorePenalty?.flipGamma ?? 0.0;
  const eta = scorePenalty?.tradeEta ?? 0.0;

  const zSeries = computeZEdgeSeries(canonicalRows, ewmaPath, horizon, simStartDate);
  if (zSeries.length === 0) {
    throw new Error(`No zEdge observations available for ${symbol}`);
  }

  const startIdx = 0;
  const endIdx = zSeries.length - 1;
  const folds: Array<{ train: ZEdgePoint[]; val: ZEdgePoint[] }> = [];

  for (
    let idx = startIdx;
    idx + trainLen + valLen - 1 <= endIdx;
    idx += stepLen
  ) {
    const train = zSeries.slice(idx, idx + trainLen);
    const val = zSeries.slice(idx + trainLen, idx + trainLen + valLen);
    if (train.length < trainLen || val.length < valLen) continue;
    folds.push({ train, val });
  }

  if (!folds.length) {
    throw new Error("No valid walk-forward folds constructed (check window lengths)");
  }

  const evaluateFold = (
    train: ZEdgePoint[],
    val: ZEdgePoint[],
    thresholds: ZHysteresisThresholds,
    expectedTail: number
  ): (ZFoldSummary & { shortEntries: number }) | null => {
    const trainZ = train.map((p) => p.zEdge);
    const qPrevTrainEnd = computeEndState(trainZ, thresholds, 0);
    const { bars, shortOppCount, shortEntries } = buildBarsFromZEdges(val, thresholds, qPrevTrainEnd);
    const sigStats = summarizeSignalStats(bars);

    // Hard constraints on flat time, closes, flips (if provided)
    const flipPct = bars.length ? (sigStats.flips / bars.length) * 100 : 0;
    if (sigStats.flatPct < minFlatPct) return null;
    if (sigStats.closes < minCloses) return null;
    if (maxFlipPct != null && flipPct > maxFlipPct) return null;

    if (shortOppCount < expectedTail) return null;
    const simResult = simulateTrading212Cfd(bars, initialEquity, tradingConfig);
    const tradeCount = countTradeSegments(simResult.accountHistory);
    if (tradeCount < 1) return null;

    const returnPct =
      simResult.initialEquity > 0
        ? (simResult.finalEquity - simResult.initialEquity) / simResult.initialEquity
        : 0;
    const maxDrawdown = simResult.maxDrawdown ?? 0;
    const pf = profitFactor(simResult.trades);
    const maxDdPct = maxDrawdown;
    let score = maxDdPct > 0 ? returnPct / maxDdPct : returnPct;
    if (gamma > 0) {
      score -= gamma * sigStats.flips;
    }
    if (eta > 0) {
      score -= eta * sigStats.tradeCount;
    }

    return {
      foldStart: train[0].date,
      foldEnd: train[train.length - 1].date,
      valStart: val[0].date,
      valEnd: val[val.length - 1].date,
      thresholds,
      returnPct,
      maxDrawdown,
      tradeCount,
      closedTrades: simResult.trades.length,
      profitFactor: pf,
      shortOppCount,
      score,
      shortEntries,
    signalStats: sigStats,
    constraints: {
      flatPct: sigStats.flatPct,
      minFlatPct,
      closes: sigStats.closes,
      minCloses,
      flips: sigStats.flips,
      flipPct,
      maxFlipPct,
    },
    };
  };

  const baselineSummaries: Array<ZFoldSummary & { shortEntries: number }> = [];
  for (const fold of folds) {
    const trainZ = fold.train.map((p) => p.zEdge);
    const autoThresholds = computeAutoThresholds(trainZ, 0.3);
    if (!autoThresholds) continue;
    const expectedTail = Math.max(1, Math.ceil(0.5 * (1 - 0.9) * valLen)); // auto uses qEnter=0.9
    const summary = evaluateFold(fold.train, fold.val, autoThresholds, expectedTail);
    if (summary) {
      baselineSummaries.push(summary);
    }
  }

  const baselineValidFolds = baselineSummaries.length;
  const baselineShortEntries = baselineSummaries.reduce((s, f) => s + (f.shortEntries ?? 0), 0);
  const baselineScore =
    baselineValidFolds > 0 && baselineShortEntries >= 1
      ? baselineSummaries.reduce((s, f) => s + f.score, 0) / baselineValidFolds
      : -Infinity;

  const sortedUnique = (values: number[]) =>
    Array.from(new Set(values.filter((v) => Number.isFinite(v)))).sort((a, b) => a - b);

  type Candidate = {
    thresholds: ZHysteresisThresholds;
    quantiles: ZQuantiles;
    meanScore: number;
    avgTradeCount: number;
    avgShortOppCount: number;
    foldSummaries: ZFoldSummary[];
    validFolds: number;
    totalShortEntries: number;
  };

  const selectBestEffort = (candidates: Candidate[]): Candidate | null => {
    if (!candidates.length) return null;
    const sorted = [...candidates].sort((a, b) => {
      if (b.validFolds !== a.validFolds) return b.validFolds - a.validFolds;
      if (b.avgShortOppCount !== a.avgShortOppCount) return b.avgShortOppCount - a.avgShortOppCount;
      return b.meanScore - a.meanScore;
    });
    return sorted[0] ?? null;
  };

  const buildGrid = (enterList: number[]) => {
    const grid: ZQuantiles[] = [];
    for (const qe of enterList) {
      for (const qx of quantilesExit) {
        for (const qf of quantilesFlip) {
          grid.push({ enter: qe, exit: qx, flip: qf });
        }
      }
    }
    return grid;
  };

  const baseEnter = sortedUnique(quantilesEnter);
  const expandedEnter = sortedUnique([...baseEnter, 0.7, 0.75]);

  const tryGrids = [buildGrid(baseEnter), buildGrid(expandedEnter)];

  let bestCandidate: Candidate | null = null;
  let bestEffort: Candidate | null = null;

  for (let pass = 0; pass < tryGrids.length; pass++) {
    const quantileGrid = tryGrids[pass];

    for (const qs of quantileGrid) {
      if (!(qs.exit < qs.enter && qs.enter < qs.flip)) {
        continue;
      }

      const foldSummaries: ZFoldSummary[] = [];
      let validFolds = 0;
      let scoreSum = 0;
      let tradesSum = 0;
      let shortOppSum = 0;
      let totalShortEntries = 0;

      for (const fold of folds) {
        const trainZ = fold.train.map((p) => p.zEdge);
        const thresholds = deriveThresholds(trainZ, qs);
        if (!thresholds) continue;

        const expectedTail = Math.max(1, Math.ceil(0.5 * (1 - qs.enter) * valLen));

        const summary = evaluateFold(fold.train, fold.val, thresholds, expectedTail) as
          | (ZFoldSummary & { shortEntries: number })
          | null;
        if (!summary) continue;

        validFolds++;
        scoreSum += summary.score;
        tradesSum += summary.tradeCount;
        shortOppSum += summary.shortOppCount;
        totalShortEntries += summary.shortEntries;
        foldSummaries.push({ ...summary });
      }

      if (validFolds === 0) continue;

    const meanScore = scoreSum / validFolds;
    const avgTradeCount = tradesSum / validFolds;
    const avgShortOppCount = shortOppSum / validFolds;

    const fullThresholds = deriveThresholds(
        zSeries.map((p) => p.zEdge),
        qs
      );
      if (!fullThresholds) continue;

      if (validFolds === 0) {
        const candidate: Candidate = {
          thresholds: fullThresholds,
          quantiles: qs,
          meanScore: -Infinity,
          avgTradeCount: 0,
          avgShortOppCount: 0,
          foldSummaries: [],
          validFolds: 0,
          totalShortEntries: 0,
        };
        bestEffort = bestEffort ? selectBestEffort([bestEffort, candidate]) : candidate;
        continue;
      }

      const candidate: Candidate = {
        thresholds: fullThresholds,
        quantiles: qs,
        meanScore,
        avgTradeCount,
        avgShortOppCount,
        foldSummaries,
        validFolds,
        totalShortEntries,
      };

      if (!bestEffort) {
        bestEffort = candidate;
      } else {
        bestEffort = selectBestEffort([bestEffort, candidate]);
      }

      if ((!bestCandidate || meanScore > bestCandidate.meanScore) && totalShortEntries >= 1) {
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) break;
  }

  if (!bestCandidate) {
    let fallback = bestEffort;
    if (!fallback) {
      const zEdgesFull = zSeries.map((p) => p.zEdge);
      const autoThresholds = computeAutoThresholds(zEdgesFull, 0.3);
      if (autoThresholds) {
        fallback = {
          thresholds: autoThresholds,
          quantiles: { enter: 0.9, exit: 0.5, flip: 0.95 },
          meanScore: -Infinity,
          avgTradeCount: 0,
          avgShortOppCount: 0,
          foldSummaries: [],
          validFolds: 0,
          totalShortEntries: 0,
        };
      }
    }
    if (!fallback) {
      throw new Error("No candidate thresholds satisfied fold constraints");
    }

    return {
      best: {
        thresholds: fallback.thresholds,
        quantiles: fallback.quantiles,
        meanScore: fallback.meanScore,
        folds: fallback.foldSummaries.length,
        avgTradeCount: fallback.avgTradeCount,
        avgShortOppCount: fallback.avgShortOppCount,
        applyRecommended: false,
        baselineScore,
        bestScore: fallback.meanScore,
        reason: "noCandidateStrict; bestEffortReturned",
      },
      foldSummaries: fallback.foldSummaries,
      zEdgeSamples: zSeries.length,
    };
  }

  const bestScore = bestCandidate.meanScore;
  const baselineScoreFinal = baselineScore === -Infinity ? -Infinity : baselineScore;
  const applyRecommended = bestScore > baselineScoreFinal && bestScore > 0;
  let reason: string | undefined;
  if (!applyRecommended) {
    if (bestScore <= 0) {
      reason = "bestScore<=0";
    } else if (bestScore <= baselineScoreFinal) {
      reason = "bestScore<=baselineScore";
    }
  }

  return {
      best: {
        thresholds: bestCandidate.thresholds,
        quantiles: bestCandidate.quantiles,
        meanScore: bestCandidate.meanScore,
        folds: bestCandidate.foldSummaries.length,
        avgTradeCount: bestCandidate.avgTradeCount,
        avgShortOppCount: bestCandidate.avgShortOppCount,
        totalShortEntries: bestCandidate.totalShortEntries,
        applyRecommended,
        baselineScore: baselineScoreFinal,
        bestScore,
        reason,
      },
    foldSummaries: bestCandidate.foldSummaries,
    zEdgeSamples: zSeries.length,
  };
}
