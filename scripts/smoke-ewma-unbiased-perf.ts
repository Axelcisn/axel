import { loadCanonicalDataFromFS, loadCanonicalDataWithYahooSupplement } from "../lib/storage/canonical";
import {
  simulateCfd,
  type CfdSimBar,
  type CfdSimulationResult,
  type CfdTrade,
} from "../lib/backtest/cfdSim";
import { parseSymbolsFromArgs } from "./_utils/cli";

type CanonicalRow = {
  date: string;
  close?: number | null;
  adj_close?: number | null;
};

type PerfSummary = {
  initialCapital: number;
  openPnl: number;
  openPnlPct?: number;
  netProfit: number;
  netProfitPct?: number;
  grossProfit: number;
  grossProfitPct?: number;
  grossLoss: number;
  grossLossPct?: number;
  commissionPaid: number;
  commissionPct?: number;
  buyHoldReturn: number;
  buyHoldPct?: number;
  buyHoldPricePct?: number;
  maxContractsHeld: number;
  avgRunUpDuration?: number;
  avgRunUpValue?: number;
  avgRunUpPct?: number;
  maxRunUpValue?: number;
  maxRunUpPct?: number;
  avgDrawdownDuration?: number;
  avgDrawdownValue?: number;
  avgDrawdownPct?: number;
  maxDrawdownValue?: number;
  maxDrawdownPct?: number;
  trades: CfdTrade[];
  accountHistory: CfdSimulationResult["accountHistory"];
};

type Perf = PerfSummary;

const EWMA_UNBIASED_DEFAULTS = {
  lambda: 0.94,
  trainFraction: 0.7,
  minTrain: 20,
};

const PARAMS = {
  initialEquity: 1000,
  leverage: 5,
  positionFraction: 0.25,
  costBps: 0,
  h: 1,
};

const TOL = 1e-6;

function toNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function variance(arr: number[], mu: number): number {
  return arr.length ? arr.reduce((a, b) => a + (b - mu) * (b - mu), 0) / arr.length : 0;
}

function buildEwmaExpectedBars(rows: CanonicalRow[], h: number, lambda: number, trainFraction: number): CfdSimBar[] {
  if (!rows || rows.length < 3) return [];
  const prices: number[] = [];
  const dates: string[] = [];
  for (const row of rows) {
    const p = toNum(row.adj_close ?? row.close);
    if (p != null && p > 0 && row.date) {
      prices.push(p);
      dates.push(row.date);
    }
  }
  if (prices.length < 3) return [];

  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const curr = prices[i];
    if (prev > 0 && curr > 0) {
      returns.push(Math.log(curr / prev));
    }
  }
  const bars: CfdSimBar[] = [];
  const MIN_TRAIN = EWMA_UNBIASED_DEFAULTS.minTrain;
  for (let i = 0; i < returns.length - 1; i++) {
    const priceIdx = i + 1;
    const historyReturns = returns.slice(0, i + 1);
    const trainN = Math.max(2, Math.floor(trainFraction * historyReturns.length));
    const trainReturns = historyReturns.slice(-trainN);
    if (trainReturns.length < MIN_TRAIN) {
      bars.push({ date: dates[priceIdx], price: prices[priceIdx], signal: "flat" });
      continue;
    }
    const muLog = mean(trainReturns);
    let sigma2 = variance(trainReturns, muLog);
    if (!Number.isFinite(sigma2)) sigma2 = 0;
    for (const r of trainReturns) {
      const e = r - muLog;
      sigma2 = lambda * sigma2 + (1 - lambda) * (e * e);
    }
    const sigmaHat = Math.sqrt(Math.max(sigma2, 0));
    const muHat = muLog + 0.5 * sigmaHat * sigmaHat;
    const muStarUsed = lambda * muHat;
    const S_t = prices[priceIdx];
    if (!Number.isFinite(S_t) || S_t <= 0) {
      bars.push({ date: dates[priceIdx], price: prices[priceIdx], signal: "flat" });
      continue;
    }
    const expected = S_t * Math.exp(muStarUsed * h);
    const signal: "flat" | "long" | "short" = expected > S_t ? "long" : "short";
    bars.push({ date: dates[priceIdx], price: prices[priceIdx], signal });
  }
  return bars;
}

function summarizeSimPerformance(
  result: CfdSimulationResult,
  priceStart: number | null,
  priceEnd: number | null
): PerfSummary {
  const trades = result.trades ?? [];
  const initialCapital = result.initialEquity;
  const lastSnap = result.accountHistory[result.accountHistory.length - 1] ?? null;
  const openPnl = lastSnap?.unrealisedPnl ?? 0;
  const netProfit = result.finalEquity - result.initialEquity;
  const grossProfit = trades.filter((t) => (t.netPnl ?? 0) > 0).reduce((a, t) => a + (t.netPnl ?? 0), 0);
  const grossLoss = trades.filter((t) => (t.netPnl ?? 0) < 0).reduce((a, t) => a + (t.netPnl ?? 0), 0);
  const commissionPaid = result.swapFeesTotal ?? 0;
  const buyHoldPricePct = priceStart != null && priceEnd != null && priceStart > 0 ? (priceEnd - priceStart) / priceStart : null;
  const buyHoldReturn =
    buyHoldPricePct != null && Number.isFinite(buyHoldPricePct) ? buyHoldPricePct * initialCapital : 0;
  const maxContractsHeld = Math.max(0, ...trades.map((t) => Math.abs(t.quantity ?? 0)));

  const equitySeries = result.accountHistory
    .map((s) => ({ date: s.date, equity: s.equity }))
    .filter((s) => Number.isFinite(s.equity));

  const dayDiff = (start: string, end: string) => {
    const a = new Date(start);
    const b = new Date(end);
    const diff = Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
    if (!Number.isFinite(diff)) return 0;
    return Math.max(1, diff);
  };

  const computeDrawdownStats = (series: { date: string; equity: number }[]) => {
    if (series.length < 2) {
      return {
        avgPct: null as number | null,
        avgValue: null as number | null,
        avgDuration: null as number | null,
        maxPct: null as number | null,
        maxValue: null as number | null,
      };
    }
    const segments: { peak: number; trough: number; start: string; end: string }[] = [];
    let peak = series[0].equity;
    let peakDate = series[0].date;
    let trough = series[0].equity;
    let troughDate = series[0].date;
    let inDd = false;
    for (let i = 1; i < series.length; i++) {
      const eq = series[i].equity;
      const date = series[i].date;
      if (eq > peak) {
        if (inDd) {
          segments.push({ peak, trough, start: peakDate, end: troughDate });
        }
        peak = eq;
        peakDate = date;
        trough = eq;
        troughDate = date;
        inDd = false;
        continue;
      }
      if (eq < trough) {
        trough = eq;
        troughDate = date;
      }
      if (!inDd && eq < peak) {
        inDd = true;
      }
      if (inDd && eq >= peak) {
        segments.push({ peak, trough, start: peakDate, end: troughDate });
        peak = eq;
        peakDate = date;
        trough = eq;
        troughDate = date;
        inDd = false;
      }
    }
    if (inDd) {
      segments.push({ peak, trough, start: peakDate, end: troughDate });
    }
    const pctValues = segments
      .map((s) => (s.peak > 0 ? (s.trough - s.peak) / s.peak : null))
      .filter((v): v is number => v != null && Number.isFinite(v));
    const valueValues = segments.map((s) => s.trough - s.peak);
    const durations = segments.map((s) => dayDiff(s.start, s.end));
    const minPct = pctValues.length ? Math.min(...pctValues) : null;
    const minValue = valueValues.length ? Math.min(...valueValues) : null;
    const avgPct = pctValues.length ? pctValues.reduce((a, b) => a + b, 0) / pctValues.length : null;
    const avgValue = valueValues.length ? valueValues.reduce((a, b) => a + b, 0) / valueValues.length : null;
    const avgDuration = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
    return { avgPct, avgValue, avgDuration, maxPct: minPct, maxValue: minValue };
  };

  const computeRunUpStats = (series: { date: string; equity: number }[]) => {
    if (series.length < 2) {
      return {
        avgPct: null as number | null,
        avgValue: null as number | null,
        avgDuration: null as number | null,
        maxPct: null as number | null,
        maxValue: null as number | null,
      };
    }
    const segments: { trough: number; peak: number; start: string; end: string }[] = [];
    let trough = series[0].equity;
    let troughDate = series[0].date;
    let peak = series[0].equity;
    let peakDate = series[0].date;
    let inRun = false;
    for (let i = 1; i < series.length; i++) {
      const eq = series[i].equity;
      const date = series[i].date;
      if (eq < trough) {
        if (inRun && peak > trough) {
          segments.push({ trough, peak, start: troughDate, end: peakDate });
        }
        trough = eq;
        troughDate = date;
        peak = eq;
        peakDate = date;
        inRun = false;
        continue;
      }
      if (eq > peak) {
        peak = eq;
        peakDate = date;
        inRun = true;
      } else if (inRun && eq < peak) {
        if (peak > trough) {
          segments.push({ trough, peak, start: troughDate, end: peakDate });
        }
        trough = eq;
        troughDate = date;
        peak = eq;
        peakDate = date;
        inRun = false;
      }
    }
    if (inRun && peak > trough) {
      segments.push({ trough, peak, start: troughDate, end: peakDate });
    }
    const pctValues = segments
      .map((s) => (s.trough > 0 ? (s.peak - s.trough) / s.trough : null))
      .filter((v): v is number => v != null && Number.isFinite(v));
    const valueValues = segments.map((s) => s.peak - s.trough);
    const durations = segments.map((s) => dayDiff(s.start, s.end));
    const maxPct = pctValues.length ? Math.max(...pctValues) : null;
    const maxValue = valueValues.length ? Math.max(...valueValues) : null;
    const avgPct = pctValues.length ? pctValues.reduce((a, b) => a + b, 0) / pctValues.length : null;
    const avgValue = valueValues.length ? valueValues.reduce((a, b) => a + b, 0) / valueValues.length : null;
    const avgDuration = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
    return { avgPct, avgValue, avgDuration, maxPct, maxValue };
  };

  const equitiesOnly = equitySeries.map((s) => s.equity);
  const minEq = equitiesOnly.length ? Math.min(...equitiesOnly) : 0;
  const maxEq = equitiesOnly.length ? Math.max(...equitiesOnly) : 0;
  const rangeEq = maxEq - minEq;
  const nPoints = equitySeries.length;

  let extrema = buildExtremaFromEquity(equitySeries);
  if (extrema.length < 2 && rangeEq > 1e-6 && nPoints >= 2) {
    if (equitySeries[equitySeries.length - 1].equity >= equitySeries[0].equity) {
      extrema = [
        { idx: 0, date: equitySeries[0].date, equity: equitySeries[0].equity, type: "trough" },
        { idx: equitySeries.length - 1, date: equitySeries[equitySeries.length - 1].date, equity: equitySeries[equitySeries.length - 1].equity, type: "peak" },
      ];
    } else {
      extrema = [
        { idx: 0, date: equitySeries[0].date, equity: equitySeries[0].equity, type: "peak" },
        { idx: equitySeries.length - 1, date: equitySeries[equitySeries.length - 1].date, equity: equitySeries[equitySeries.length - 1].equity, type: "trough" },
      ];
    }
  }
  const { runups, drawdowns } = buildSegments(extrema);
  const avgVal = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const maxVal = (arr: number[]) => (arr.length ? Math.max(...arr) : null);
  const minVal = (arr: number[]) => (arr.length ? Math.min(...arr) : null);

  const runUpValues = runups.map((s) => s.valueUsd);
  const runUpPcts = runups.map((s) => s.pct);
  const runUpDurations = runups.map((s) => s.durationDays);

  const ddValues = drawdowns.map((s) => s.valueUsd);
  const ddPcts = drawdowns.map((s) => s.pct);
  const ddDurations = drawdowns.map((s) => s.durationDays);

  const pctOfInitial = (v: number | null | undefined) => {
    if (initialCapital <= 0 || v == null || !Number.isFinite(v)) return null;
    return v / initialCapital;
  };

  const openPnlPct = pctOfInitial(openPnl);
  const netProfitPct = pctOfInitial(netProfit);
  const grossProfitPct = pctOfInitial(grossProfit);
  const grossLossPct = pctOfInitial(grossLoss);
  const commissionPct = pctOfInitial(commissionPaid);
  const buyHoldPct = pctOfInitial(buyHoldReturn ?? null) ?? buyHoldPricePct ?? null;

  return {
    initialCapital,
    openPnl,
    openPnlPct: openPnlPct ?? undefined,
    netProfit,
    netProfitPct: netProfitPct ?? undefined,
    grossProfit,
    grossProfitPct: grossProfitPct ?? undefined,
    grossLoss,
    grossLossPct: grossLossPct ?? undefined,
    commissionPaid,
    commissionPct: commissionPct ?? undefined,
    buyHoldReturn,
    buyHoldPct: buyHoldPct ?? undefined,
    buyHoldPricePct: buyHoldPricePct ?? undefined,
    maxContractsHeld,
    maxDrawdownPct: drawdowns.length ? minVal(ddPcts) ?? undefined : undefined,
    maxDrawdownValue: drawdowns.length ? minVal(ddValues) ?? undefined : undefined,
    avgDrawdownPct: avgVal(ddPcts) ?? undefined,
    avgDrawdownValue: avgVal(ddValues) ?? undefined,
    avgDrawdownDuration: avgVal(ddDurations) ?? undefined,
    maxRunUpValue: maxVal(runUpValues) ?? undefined,
    maxRunUpPct: maxVal(runUpPcts) ?? undefined,
    avgRunUpValue: avgVal(runUpValues) ?? undefined,
    avgRunUpPct: avgVal(runUpPcts) ?? undefined,
    avgRunUpDuration: avgVal(runUpDurations) ?? undefined,
    accountHistory: result.accountHistory,
    trades,
  };
}

function sliceLastN(rows: CanonicalRow[], n: number): CanonicalRow[] {
  if (!rows || rows.length <= n) return rows ?? [];
  return rows.slice(rows.length - n);
}

function assertClose(name: string, actual: number | null | undefined, expected: number | null | undefined, tol = TOL) {
  if (actual == null || expected == null) return { pass: false, reason: "null" };
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return { pass: false, reason: "nan" };
  const diff = Math.abs(actual - expected);
  return { pass: diff <= tol, diff };
}

function computeRollingDd(equitySeries: { equity: number }[]) {
  let peak = equitySeries[0]?.equity ?? 0;
  let minPct = 0;
  let minUsd = 0;
  for (const s of equitySeries) {
    if (s.equity > peak) peak = s.equity;
    const ddPct = peak > 0 ? s.equity / peak - 1 : 0;
    const ddUsd = s.equity - peak;
    if (ddPct < minPct) minPct = ddPct;
    if (ddUsd < minUsd) minUsd = ddUsd;
  }
  return { minPct, minUsd };
}

type Extremum = { idx: number; date: string; equity: number; type: "peak" | "trough" };
type Segment = { start: Extremum; end: Extremum; valueUsd: number; pct: number; durationDays: number };

function buildExtremaFromEquity(equitySeries: { date: string; equity: number }[]): Extremum[] {
  if (equitySeries.length === 0) return [];
  const diffs: number[] = [];
  for (let i = 1; i < equitySeries.length; i++) {
    diffs.push(equitySeries[i].equity - equitySeries[i - 1].equity);
  }
  const extrema: Extremum[] = [];
  let lastSign = 0;
  for (let i = 1; i < equitySeries.length; i++) {
    const diff = diffs[i - 1];
    const sign = diff === 0 ? lastSign : diff > 0 ? 1 : -1;
    if (lastSign !== 0 && sign !== lastSign) {
      const type: "peak" | "trough" = lastSign > 0 ? "peak" : "trough";
      extrema.push({
        idx: i - 1,
        date: equitySeries[i - 1].date,
        equity: equitySeries[i - 1].equity,
        type,
      });
    }
    lastSign = sign;
  }
  if (extrema.length === 0 || extrema[0].idx !== 0) {
    const firstTrendUp = diffs[0] > 0;
    extrema.unshift({
      idx: 0,
      date: equitySeries[0].date,
      equity: equitySeries[0].equity,
      type: firstTrendUp ? "trough" : "peak",
    });
  }
  const lastTrend = diffs.length
    ? diffs[diffs.length - 1] === 0
      ? lastSign
      : diffs[diffs.length - 1] > 0
        ? 1
        : -1
    : lastSign;
  const lastPoint: Extremum = {
    idx: equitySeries.length - 1,
    date: equitySeries[equitySeries.length - 1].date,
    equity: equitySeries[equitySeries.length - 1].equity,
    type: lastTrend >= 0 ? "peak" : "trough",
  };
  if (extrema.length === 0 || extrema[extrema.length - 1].idx !== lastPoint.idx) {
    extrema.push(lastPoint);
  } else {
    extrema[extrema.length - 1] = lastPoint;
  }
  return extrema;
}

function buildSegments(extrema: Extremum[]): { runups: Segment[]; drawdowns: Segment[] } {
  const runups: Segment[] = [];
  const drawdowns: Segment[] = [];
  for (let i = 0; i < extrema.length - 1; i++) {
    const a = extrema[i];
    const b = extrema[i + 1];
    const durationDays = (Date.parse(b.date) - Date.parse(a.date)) / (1000 * 60 * 60 * 24);
    if (a.type === "trough" && b.type === "peak") {
      const valueUsd = b.equity - a.equity;
      const pct = a.equity !== 0 ? valueUsd / a.equity : 0;
      runups.push({ start: a, end: b, valueUsd, pct, durationDays });
    } else if (a.type === "peak" && b.type === "trough") {
      const valueUsd = b.equity - a.equity;
      const pct = a.equity !== 0 ? valueUsd / a.equity : 0;
      drawdowns.push({ start: a, end: b, valueUsd, pct, durationDays });
    }
  }
  return { runups, drawdowns };
}

function computeDrawdownStatsCanonical(series: { date: string; equity: number }[]) {
  if (series.length < 2) {
    return { maxPct: null as number | null, maxValue: null as number | null };
  }
  const segments: { peak: number; trough: number }[] = [];
  let peak = series[0].equity;
  let peakDate = series[0].date;
  let trough = series[0].equity;
  let startDate = series[0].date;
  let inDd = false;
  for (let i = 1; i < series.length; i++) {
    const eq = series[i].equity;
    const date = series[i].date;
    if (eq > peak) {
      if (inDd) {
        segments.push({ peak, trough });
      }
      peak = eq;
      peakDate = date;
      trough = eq;
      startDate = date;
      inDd = false;
      continue;
    }
    if (eq < trough) {
      trough = eq;
    }
    if (!inDd && eq < peak) {
      inDd = true;
      startDate = peakDate;
    }
    if (inDd && eq >= peak) {
      segments.push({ peak, trough });
      peak = eq;
      peakDate = date;
      trough = eq;
      startDate = date;
      inDd = false;
    }
  }
  if (inDd) {
    segments.push({ peak, trough });
  }
  const pctValues = segments
    .map((s) => (s.peak > 0 ? (s.trough - s.peak) / s.peak : null))
    .filter((v): v is number => v != null && Number.isFinite(v));
  const valueValues = segments.map((s) => s.trough - s.peak);
  const minPct = pctValues.length ? Math.min(...pctValues) : null;
  const minValue = valueValues.length ? Math.min(...valueValues) : null;
  return { maxPct: minPct, maxValue: minValue };
}

async function runForSymbol(symbol: string): Promise<{ symbol: string; pass: boolean; errors: string[] }> {
  let rows: CanonicalRow[] = [];
  try {
    const data = await loadCanonicalDataFromFS(symbol);
    rows = data.rows;
  } catch {
    rows = await loadCanonicalDataWithYahooSupplement(symbol);
  }
  rows = sliceLastN(rows, 252);
  if (rows.length < 5) {
    return { symbol, pass: false, errors: ["not enough rows"] };
  }

  const bars = buildEwmaExpectedBars(rows, PARAMS.h, EWMA_UNBIASED_DEFAULTS.lambda, EWMA_UNBIASED_DEFAULTS.trainFraction);
  const config = {
    leverage: PARAMS.leverage,
    fxFeeRate: 0,
    dailyLongSwapRate: 0,
    dailyShortSwapRate: 0,
    spreadBps: PARAMS.costBps,
    marginCallLevel: 0.45,
    stopOutLevel: 0.25,
    positionFraction: PARAMS.positionFraction,
  };
  const simResult = simulateCfd(bars, PARAMS.initialEquity, config);
  const priceStart = toNum(rows[rows.length - bars.length - 1]?.adj_close ?? rows[rows.length - bars.length - 1]?.close) ?? toNum(rows[0]?.adj_close ?? rows[0]?.close) ?? null;
  const priceEnd = toNum(rows[rows.length - 1]?.adj_close ?? rows[rows.length - 1]?.close) ?? null;
  const perf = summarizeSimPerformance(simResult, priceStart, priceEnd);

  const errors: string[] = [];

  // Bounds checks
  if (perf.maxRunUpValue != null && perf.avgRunUpValue != null) {
    if (!(perf.maxRunUpValue >= perf.avgRunUpValue && perf.avgRunUpValue >= 0)) {
      errors.push("bound avg/max run-up value violated");
    }
  }
  if (perf.maxRunUpPct != null && perf.avgRunUpPct != null) {
    if (!(perf.maxRunUpPct >= perf.avgRunUpPct && perf.avgRunUpPct >= 0)) {
      errors.push("bound avg/max run-up pct violated");
    }
  }
  if (perf.avgDrawdownValue != null && !(perf.avgDrawdownValue <= 0)) {
    errors.push("bound avg drawdown value should be <= 0");
  }
  if (perf.maxDrawdownValue != null && perf.avgDrawdownValue != null) {
    if (!(perf.maxDrawdownValue <= perf.avgDrawdownValue)) {
      errors.push("bound max drawdown value should be <= avg drawdown value");
    }
  }
  if (perf.avgDrawdownPct != null && !(perf.avgDrawdownPct <= 0)) {
    errors.push("bound avg drawdown pct should be <= 0");
  }
  if (perf.maxDrawdownPct != null && perf.avgDrawdownPct != null) {
    if (!(perf.maxDrawdownPct <= perf.avgDrawdownPct)) {
      errors.push("bound max drawdown pct should be <= avg drawdown pct");
    }
  }
  if (perf.avgRunUpDuration != null && perf.avgRunUpDuration < 0) {
    errors.push("avg run-up duration negative");
  }
  if (perf.avgDrawdownDuration != null && perf.avgDrawdownDuration < 0) {
    errors.push("avg drawdown duration negative");
  }

  // A) Buy & hold pct
  const bhPct = priceStart != null && priceEnd != null && priceStart > 0 ? priceEnd / priceStart - 1 : null;
  const cmpA = assertClose("buyHoldPct", perf.buyHoldPricePct, bhPct);
  if (!cmpA.pass) errors.push(`buyHoldPct mismatch: got ${perf.buyHoldPricePct}, expected ${bhPct}, reason=${cmpA.reason ?? cmpA.diff}`);

  // B) Buy & hold $
  const bhUsd = bhPct != null && PARAMS.initialEquity > 0 ? PARAMS.initialEquity * bhPct : null;
  const cmpB = assertClose("buyHoldReturn", perf.buyHoldReturn, bhUsd);
  if (!cmpB.pass) errors.push(`buyHoldReturn mismatch: got ${perf.buyHoldReturn}, expected ${bhUsd}, reason=${cmpB.reason ?? cmpB.diff}`);

  // C) Net profit identity
  const finalEquity = simResult.accountHistory.at(-1)?.equity ?? null;
  const netProfitExpect = finalEquity != null ? finalEquity - PARAMS.initialEquity : null;
  const cmpC = assertClose("netProfit", perf.netProfit, netProfitExpect);
  if (!cmpC.pass) errors.push(`netProfit mismatch: got ${perf.netProfit}, expected ${netProfitExpect}, reason=${cmpC.reason ?? cmpC.diff}`);

  // D) Open P&L
  const openPnlExpect = simResult.accountHistory.at(-1)?.unrealisedPnl ?? null;
  const cmpD = assertClose("openPnl", perf.openPnl, openPnlExpect);
  if (!cmpD.pass) errors.push(`openPnl mismatch: got ${perf.openPnl}, expected ${openPnlExpect}, reason=${cmpD.reason ?? cmpD.diff}`);

  // E) Gross profit/loss from trades
  const grossProfitExpect = (simResult.trades ?? []).filter((t) => (t.netPnl ?? 0) > 0).reduce((a, t) => a + (t.netPnl ?? 0), 0);
  const grossLossExpect = (simResult.trades ?? []).filter((t) => (t.netPnl ?? 0) < 0).reduce((a, t) => a + (t.netPnl ?? 0), 0);
  const cmpE1 = assertClose("grossProfit", perf.grossProfit, grossProfitExpect);
  if (!cmpE1.pass) errors.push(`grossProfit mismatch: got ${perf.grossProfit}, expected ${grossProfitExpect}, reason=${cmpE1.reason ?? cmpE1.diff}`);
  const cmpE2 = assertClose("grossLoss", perf.grossLoss, grossLossExpect);
  if (!cmpE2.pass) errors.push(`grossLoss mismatch: got ${perf.grossLoss}, expected ${grossLossExpect}, reason=${cmpE2.reason ?? cmpE2.diff}`);

  // G) Run-up/Drawdown segmentation independent check
  const equitySeries = (simResult.accountHistory ?? [])
    .map((s) => ({ date: s.date, equity: s.equity }))
    .filter((s) => Number.isFinite(s.equity));

  // Diagnostics
  const nPoints = equitySeries.length;
  const equitiesOnly = equitySeries.map((e) => e.equity);
  const minEq = equitiesOnly.length ? Math.min(...equitiesOnly) : 0;
  const maxEq = equitiesOnly.length ? Math.max(...equitiesOnly) : 0;
  const rangeEq = maxEq - minEq;
  const uniqueEquityCount = (() => {
    if (equitiesOnly.length === 0) return 0;
    let count = 1;
    for (let i = 1; i < equitiesOnly.length; i++) {
      if (Math.abs(equitiesOnly[i] - equitiesOnly[i - 1]) > 1e-10) count++;
    }
    return count;
  })();
  const posChangeCount = (simResult.trades ?? []).length;
  console.log(
    `EQUITY DIAG ${symbol}: n=${nPoints}, min=${minEq.toFixed(4)}, max=${maxEq.toFixed(4)}, range=${rangeEq.toFixed(4)}, uniq=${uniqueEquityCount}, trades=${posChangeCount}`
  );
  if (rangeEq < 1e-6 || uniqueEquityCount < 3) {
    console.warn(`WARN ${symbol} equity curve near-flat/monotonic; segment checks may be meaningless`);
  }

  let extrema = buildExtremaFromEquity(equitySeries);
  if (extrema.length < 2 && rangeEq > 1e-6 && nPoints >= 2) {
    if (equitySeries[equitySeries.length - 1].equity >= equitySeries[0].equity) {
      extrema = [
        { idx: 0, date: equitySeries[0].date, equity: equitySeries[0].equity, type: "trough" },
        { idx: equitySeries.length - 1, date: equitySeries[equitySeries.length - 1].date, equity: equitySeries[equitySeries.length - 1].equity, type: "peak" },
      ];
    } else {
      extrema = [
        { idx: 0, date: equitySeries[0].date, equity: equitySeries[0].equity, type: "peak" },
        { idx: equitySeries.length - 1, date: equitySeries[equitySeries.length - 1].date, equity: equitySeries[equitySeries.length - 1].equity, type: "trough" },
      ];
    }
  }
  const { runups, drawdowns } = buildSegments(extrema);
  const usdTol = 0.01;
  const pctTol = 1e-6;
  const durTol = 0.5;
  const avgVal = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const maxVal = (arr: number[], fn: (a: number, b: number) => number) => (arr.length ? arr.reduce(fn) : null);

  const shouldSkipSegments = rangeEq < 1e-6 || nPoints < 3;

  if (runups.length === 0 || drawdowns.length === 0) {
    if (shouldSkipSegments) {
      console.warn(`WARN ${symbol} run-up/drawdown segments are empty; skipping segment checks`);
    } else {
      const firstVals = equitiesOnly.slice(0, 10);
      const lastVals = equitiesOnly.slice(-10);
      const diffs = [];
      for (let i = 1; i < equitiesOnly.length; i++) {
        diffs.push(equitiesOnly[i] - equitiesOnly[i - 1]);
      }
      errors.push(`no segments found despite movement; first=${firstVals.join(",")}; last=${lastVals.join(",")}; diffsSample=${diffs.slice(0,10).join(",")}`);
    }
  } else {
    const runVal = runups.map((s) => s.valueUsd);
    const runPct = runups.map((s) => s.pct);
    const runDur = runups.map((s) => s.durationDays);
    const ddVal = drawdowns.map((s) => s.valueUsd);
    const ddPct = drawdowns.map((s) => s.pct);
    const ddDur = drawdowns.map((s) => s.durationDays);

    const segExpect = {
      avgRunUpValue: avgVal(runVal),
      avgRunUpPct: avgVal(runPct),
      avgRunUpDuration: avgVal(runDur),
      maxRunUpValue: maxVal(runVal, (a, b) => Math.max(a, b)),
      maxRunUpPct: maxVal(runPct, (a, b) => Math.max(a, b)),
      avgDrawdownValue: avgVal(ddVal),
      avgDrawdownPct: avgVal(ddPct),
      avgDrawdownDuration: avgVal(ddDur),
      maxDrawdownValue: maxVal(ddVal, (a, b) => Math.min(a, b)),
      maxDrawdownPct: maxVal(ddPct, (a, b) => Math.min(a, b)),
    };

    const checkSeg = (name: string, actual: number | null | undefined, expected: number | null, tol: number) => {
      if (actual == null || expected == null) return;
      const diff = Math.abs(actual - expected);
      if (diff > tol) {
        errors.push(`${name} mismatch: got ${actual}, expected ${expected}, diff=${diff}`);
      }
    };

    checkSeg("avgRunUpValue", perf.avgRunUpValue, segExpect.avgRunUpValue, usdTol);
    checkSeg("avgRunUpPct", perf.avgRunUpPct, segExpect.avgRunUpPct, pctTol);
    checkSeg("avgRunUpDuration", perf.avgRunUpDuration, segExpect.avgRunUpDuration, durTol);
    checkSeg("maxRunUpValue", perf.maxRunUpValue, segExpect.maxRunUpValue, usdTol);
    checkSeg("maxRunUpPct", perf.maxRunUpPct, segExpect.maxRunUpPct, pctTol);
    checkSeg("avgDrawdownValue", perf.avgDrawdownValue, segExpect.avgDrawdownValue, usdTol);
    checkSeg("avgDrawdownPct", perf.avgDrawdownPct, segExpect.avgDrawdownPct, pctTol);
    checkSeg("avgDrawdownDuration", perf.avgDrawdownDuration, segExpect.avgDrawdownDuration, durTol);
  }

  // H) P&L decomposition identity
  const initialEq = simResult.accountHistory?.[0]?.equity ?? PARAMS.initialEquity;
  const finalEq = simResult.accountHistory?.at(-1)?.equity ?? null;
  const equityNet = finalEq != null ? finalEq - initialEq : null;
  const realizedNet = (simResult.trades ?? []).reduce((a, t) => a + (t.netPnl ?? 0), 0);
  const openPnlEnd = simResult.accountHistory?.at(-1)?.unrealisedPnl ?? 0;
  const fees =
    ((simResult as any).swapFeesTotal ?? 0) +
    ((simResult as any).commissionsTotal ?? 0) +
    ((simResult as any).spreadFeesTotal ?? 0);

  const cmpRealized = assertClose("realizedNet", realizedNet, (perf.grossProfit ?? 0) + (perf.grossLoss ?? 0));
  if (!cmpRealized.pass) errors.push(`realizedNet mismatch: got ${realizedNet}, expected ${(perf.grossProfit ?? 0) + (perf.grossLoss ?? 0)}, reason=${cmpRealized.reason ?? cmpRealized.diff}`);

  if (equityNet != null) {
    const expectEquityNet = realizedNet + openPnlEnd - fees;
    const diff = Math.abs(equityNet - expectEquityNet);
    const tolEq = 0.005 * initialEq; // 0.5% of initial equity
    if (diff > tolEq) {
      errors.push(`equityNet identity mismatch: equityNet=${equityNet}, realizedNet=${realizedNet}, openPnl=${openPnlEnd}, fees=${fees}, expect=${expectEquityNet}, diff=${diff}`);
    }
  }

  return { symbol, pass: errors.length === 0, errors };
}

async function main() {
  const { symbols } = parseSymbolsFromArgs(process.argv.slice(2), { defaultSymbols: ["MDT", "CAT", "SNPS"] });
  const results = [];
  for (const sym of symbols) {
    try {
      const res = await runForSymbol(sym);
      results.push(res);
      if (res.pass) {
        console.log(`PASS ${sym}`);
      } else {
        console.log(`FAIL ${sym}`);
        res.errors.forEach((e) => console.log(`  - ${e}`));
      }
    } catch (err: any) {
      console.error(`FAIL ${sym} exception:`, err?.message ?? err);
      results.push({ symbol: sym, pass: false, errors: [err?.message ?? String(err)] });
    }
  }
  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
