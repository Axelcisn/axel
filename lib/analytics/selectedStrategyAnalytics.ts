import type { CanonicalRow } from "@/lib/types/canonical";
import type {
  Trading212AccountSnapshot,
  Trading212Trade,
} from "@/lib/backtest/trading212Cfd";

type SelectedSimPoint = {
  pnlUsd: number;
  equityUsd: number;
  side?: Trading212AccountSnapshot["side"] | null;
  contracts?: number | null;
};

type SimulationRunLike = {
  id: string;
  label: string;
  netProfit?: number;
  netProfitLong?: number;
  netProfitShort?: number;
  grossProfit?: number;
  grossLoss?: number;
  grossProfitLong?: number;
  grossLossLong?: number;
  grossProfitShort?: number;
  grossLossShort?: number;
  commissionPaid?: number;
  openPnl?: number;
  buyHoldReturn?: number;
  buyHoldPct?: number;
  maxDrawdownValue?: number;
  maxDrawdownPct?: number;
  stopOutEvents?: number;
  avgRunUpDuration?: number;
  maxRunUpDuration?: number;
  avgRunUpValue?: number;
  maxRunUpValue?: number;
  avgDrawdownDuration?: number;
  maxDrawdownDuration?: number;
  avgDrawdownValue?: number;
  avgDrawdownPct?: number;
};

type ReturnBreakdown = {
  initialCapital: number | null;
  openPnl: number | null;
  netPnl: number | null;
  grossProfit: number | null;
  grossLoss: number | null;
  profitFactor: number | null;
  commission: number | null;
  expectedPayoff: number | null;
};

export type SelectedStrategyAnalytics = {
  strategyId: string | null;
  strategyLabel: string | null;
  overviewCards: {
    pnlAbs: number | null;
    pnlPct: number | null;
    maxDrawdownAbs: number | null;
    maxDrawdownPct: number | null;
    totalTrades: number | null;
    profitableTrades: number | null;
    pctProfitable: number | null;
    profitFactor: number | null;
    label: string | null;
    asOfDate: string | null;
  };
  equitySeries: {
    initialEquity: number;
    strategy: Array<{
      date: string;
      equity: number;
      pnl: number;
      pct: number;
      side?: Trading212AccountSnapshot["side"] | null;
      contracts?: number | null;
    }>;
    buyHold?: Array<{
      date: string;
      valueAbs: number;
      valuePct: number;
    }>;
    excursions?: Array<{
      entryDate: string;
      exitDate: string;
      side: "long" | "short";
      netPnl?: number;
      margin?: number;
    }>;
  };
  performance: {
    profitStructure: {
      grossProfit?: number;
      grossLoss?: number;
      commission?: number;
      netProfit?: number;
    };
    pnlSeries?: Array<{
      date: string;
      strategy: number;
      buyHold?: number | null;
    }>;
    benchmark?: {
      buyHoldAbs?: number | null;
      buyHoldPct?: number | null;
      strategyAbs?: number | null;
      strategyPct?: number | null;
      maxDrawdownAbs?: number | null;
      maxDrawdownPct?: number | null;
      bands?: {
        strategy: {
          min: number | null;
          max: number | null;
          current: number | null;
          minPct: number | null;
          maxPct: number | null;
          currentPct: number | null;
        };
        buyHold: {
          min: number | null;
          max: number | null;
          current: number | null;
          minPct: number | null;
          maxPct: number | null;
          currentPct: number | null;
        };
      };
    };
    returns?: {
      all?: number | null;
      long?: number | null;
      short?: number | null;
    };
    returnBreakdown?: {
      all: ReturnBreakdown;
      long: ReturnBreakdown;
      short: ReturnBreakdown;
    };
    riskAdjusted?: {
      sharpe?: number | null;
      sortino?: number | null;
    };
  };
  trades: {
    histogram: Array<{ bucket: string; count: number }>;
    winLoss: { wins: number; losses: number };
    summary: {
      total: number;
      wins: number;
      losses: number;
      pctProfitable: number | null;
      avgPnl: number | null;
      avgWin: number | null;
      avgLoss: number | null;
      winLossRatio: number | null;
      largestWin: number | null;
      largestLoss: number | null;
      largestWinPct: number | null;
      largestLossPct: number | null;
      avgBars: number | null;
    };
    list: Trading212Trade[];
  };
  capital: {
    accountSizeRequired: number | null;
    returnOnInitial: number | null;
    returnOnRequired: number | null;
    netProfitVsMaxLoss: number | null;
    avgMarginUsed: number | null;
    maxMarginUsed: number | null;
    marginEfficiency: number | null;
    marginCalls: number | null;
  };
  runupsDrawdowns: {
    runUps: {
      avgDuration: number | null;
      maxDuration: number | null;
      avgValue: number | null;
      maxValue: number | null;
    };
    drawdowns: {
      avgDuration: number | null;
      maxDuration: number | null;
      avgValue: number | null;
      maxValue: number | null;
      avgPct: number | null;
      maxPct: number | null;
    };
    intrabar?: {
      maxRunUp?: number | null;
      maxDrawdown?: number | null;
    };
    maxEquityDrawdownReturn: number | null;
  };
  dailyReturns?: Array<{ date: string; return: number }>;
  perf?: SelectedStrategyAnalytics["performance"];
};

type BuildSelectedAnalyticsParams = {
  selectedSimRunId: string | null;
  selectedOverviewStats: SelectedStrategyAnalytics["overviewCards"] | null;
  simulationRunsSummary: SimulationRunLike[];
  simResult:
    | {
        accountHistory: Trading212AccountSnapshot[];
        initialEquity: number;
        trades: Trading212Trade[];
      }
    | null
    | undefined;
  selectedSimByDate?: Record<string, SelectedSimPoint>;
  canonicalRows?: CanonicalRow[] | null;
  visibleWindow?: { start: string; end: string } | null;
  initialEquityFallback: number;
};

const absOrNull = (v?: number | null) =>
  v == null || !Number.isFinite(v) ? null : Math.abs(v);

const normalizeDate = (value: string | null | undefined): string | null => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split("T")[0];
};

const clampToWindow = (
  date: string,
  window?: { start: string; end: string } | null
): boolean => {
  if (!window) return true;
  if (window.start && date < window.start) return false;
  if (window.end && date > window.end) return false;
  return true;
};

const computeRunUpDrawdownStats = (series: Array<{ date: string; equity: number }>) => {
  if (series.length < 2) {
    return {
      runUps: { avgDuration: null, maxDuration: null, avgValue: null, maxValue: null },
      drawdowns: {
        avgDuration: null,
        maxDuration: null,
        avgValue: null,
        maxValue: null,
        avgPct: null,
        maxPct: null,
      },
    };
  }

  const dayDiff = (a: string, b: string) => {
    const start = new Date(a);
    const end = new Date(b);
    const diff = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (!Number.isFinite(diff)) return 1;
    return Math.max(1, diff);
  };

  let peak = series[0].equity;
  let peakDate = series[0].date;
  let trough = series[0].equity;
  let troughDate = series[0].date;
  const ddSegments: { peak: number; trough: number; duration: number }[] = [];
  const ruSegments: { trough: number; peak: number; duration: number }[] = [];

  for (let i = 1; i < series.length; i++) {
    const point = series[i];
    const { equity, date } = point;

    if (equity > peak) {
      if (trough < peak) {
        ddSegments.push({
          peak,
          trough,
          duration: dayDiff(troughDate, date),
        });
      }
      peak = equity;
      peakDate = date;
      trough = equity;
      troughDate = date;
      continue;
    }

    if (equity < trough) {
      trough = equity;
      troughDate = date;
    }

    if (equity < peak) {
      const duration = dayDiff(peakDate, date);
      ddSegments.push({ peak, trough: equity, duration });
    }

    if (equity > trough) {
      const duration = dayDiff(troughDate, date);
      ruSegments.push({ trough, peak: equity, duration });
    }
  }

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const max = (arr: number[]) => (arr.length ? Math.max(...arr) : null);
  const min = (arr: number[]) => (arr.length ? Math.min(...arr) : null);

  const drawdownValues = ddSegments.map((s) => s.trough - s.peak);
  const drawdownDurations = ddSegments.map((s) => s.duration);
  const drawdownPct = ddSegments
    .map((s) => (s.peak > 0 ? (s.trough - s.peak) / s.peak : null))
    .filter((v): v is number => v != null && Number.isFinite(v));

  const runupValues = ruSegments.map((s) => s.peak - s.trough);
  const runupDurations = ruSegments.map((s) => s.duration);

  return {
    runUps: {
      avgDuration: avg(runupDurations),
      maxDuration: max(runupDurations),
      avgValue: avg(runupValues),
      maxValue: max(runupValues),
    },
    drawdowns: {
      avgDuration: avg(drawdownDurations),
      maxDuration: max(drawdownDurations),
      avgValue: avg(drawdownValues),
      maxValue: min(drawdownValues),
      avgPct: avg(drawdownPct),
      maxPct: min(drawdownPct),
    },
  };
};

const toHistogram = (values: number[], binCount: number) => {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return [{ bucket: `${min.toFixed(2)}`, count: values.length }];
  }
  const width = (max - min) / binCount;
  const buckets = Array(binCount)
    .fill(0)
    .map((_, idx) => ({
      bucket: `${(min + idx * width).toFixed(2)} – ${(min + (idx + 1) * width).toFixed(2)}`,
      count: 0,
    }));
  values.forEach((v) => {
    let idx = Math.floor((v - min) / width);
    if (idx >= binCount) idx = binCount - 1;
    buckets[idx].count += 1;
  });
  return buckets;
};

export function buildSelectedStrategyAnalytics({
  selectedSimRunId,
  selectedOverviewStats,
  simulationRunsSummary,
  simResult,
  selectedSimByDate,
  canonicalRows,
  visibleWindow,
  initialEquityFallback,
}: BuildSelectedAnalyticsParams): SelectedStrategyAnalytics | null {
  if (!selectedSimRunId || !simResult) return null;
  const runSummary = simulationRunsSummary.find((r) => r.id === selectedSimRunId);
  const initialEquity = Number.isFinite(simResult.initialEquity)
    ? simResult.initialEquity
    : initialEquityFallback;
  const grossLossAbs = absOrNull(runSummary?.grossLoss);
  const grossLossLongAbs = absOrNull(runSummary?.grossLossLong);
  const grossLossShortAbs = absOrNull(runSummary?.grossLossShort);
  const commissionAbs = absOrNull(runSummary?.commissionPaid);

  const strategySeries = (() => {
    if (selectedSimByDate && Object.keys(selectedSimByDate).length > 0) {
      return Object.entries(selectedSimByDate)
        .filter(([date]) => !!date && clampToWindow(date, visibleWindow))
        .map(([date, point]) => {
          const equity = point.equityUsd;
          const pnl = point.pnlUsd;
          const pct = initialEquity > 0 ? pnl / initialEquity : 0;
          return {
            date,
            equity,
            pnl,
            pct,
            side: point.side ?? null,
            contracts: point.contracts ?? null,
          };
        })
        .filter((p) => p.equity != null && Number.isFinite(p.equity))
        .sort((a, b) => a.date.localeCompare(b.date));
    }
    return simResult.accountHistory
      .map((snap) => ({
        date: normalizeDate(snap.date),
        equity: snap.equity,
        pnl: snap.equity - initialEquity,
        pct: initialEquity > 0 ? (snap.equity - initialEquity) / initialEquity : 0,
        side: snap.side,
        contracts: snap.quantity,
      }))
      .filter((p) => p.date && clampToWindow(p.date, visibleWindow))
      .filter((p) => p.equity != null && Number.isFinite(p.equity))
      .map((p) => ({ ...p, date: p.date as string }))
      .sort((a, b) => a.date.localeCompare(b.date));
  })();

  const buyHoldSeries = (() => {
    if (!canonicalRows || canonicalRows.length === 0) return undefined;
    const filtered = canonicalRows
      .filter((row) => row.date && clampToWindow(row.date, visibleWindow))
      .map((row) => ({ date: row.date, price: row.adj_close ?? row.close }))
      .filter((row) => row.price != null && Number.isFinite(row.price as number));
    if (filtered.length < 2) return undefined;
    const start = filtered[0].price as number;
    if (!start || start <= 0) return undefined;
    return filtered.map((row) => {
      const pct = (row.price! - start) / start;
      return {
        date: row.date,
        valueAbs: pct * initialEquity,
        valuePct: pct,
      };
    });
  })();

  const pnlSeries = strategySeries.map((p) => ({ date: p.date, strategy: p.pnl }));
  const buyHoldByDate = new Map((buyHoldSeries ?? []).map((p) => [p.date, p.valueAbs]));
  const combinedPnlSeries = pnlSeries.map((p) => ({
    date: p.date,
    strategy: p.strategy,
    buyHold: buyHoldByDate.get(p.date) ?? null,
  }));

  const excursions =
    simResult.trades?.map((trade) => ({
      entryDate: trade.entryDate,
      exitDate: trade.exitDate,
      side: trade.side,
      netPnl: trade.netPnl,
      margin: trade.margin,
    })) ?? [];

  const trades = simResult.trades ?? [];
  const wins = trades.filter((t) => (t.netPnl ?? 0) > 0);
  const losses = trades.filter((t) => (t.netPnl ?? 0) < 0);
  const longTrades = trades.filter((t) => t.side === "long");
  const shortTrades = trades.filter((t) => t.side === "short");

  const lastPoint = strategySeries[strategySeries.length - 1] ?? null;
  const overviewCards =
    selectedOverviewStats ??
    ({
      pnlAbs: lastPoint ? lastPoint.pnl : null,
      pnlPct: lastPoint ? lastPoint.pct : null,
      maxDrawdownAbs: runSummary?.maxDrawdownValue ?? null,
      maxDrawdownPct: runSummary?.maxDrawdownPct ?? null,
      totalTrades: simResult.trades?.length ?? null,
      profitableTrades:
        simResult.trades?.filter((t) => (t.netPnl ?? 0) > 0).length ?? null,
      pctProfitable:
        simResult.trades && simResult.trades.length > 0
          ? (wins.length / simResult.trades.length) * 100
          : null,
      profitFactor:
        grossLossAbs != null && grossLossAbs > 0 && runSummary?.grossProfit != null
          ? runSummary.grossProfit / grossLossAbs
          : null,
      label: runSummary?.label ?? null,
      asOfDate: lastPoint?.date ?? null,
    } as SelectedStrategyAnalytics["overviewCards"]);

  const profitStructure = {
    grossProfit: runSummary?.grossProfit,
    grossLoss: grossLossAbs ?? undefined,
    commission: commissionAbs ?? undefined,
    netProfit:
      runSummary?.netProfit ??
      (lastPoint ? lastPoint.pnl + initialEquity - initialEquity : undefined),
  };

  const dailyReturns = (() => {
    const series = strategySeries
      .filter((p) => p.equity != null && Number.isFinite(p.equity))
      .sort((a, b) => a.date.localeCompare(b.date));
    const returns: Array<{ date: string; return: number }> = [];
    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1].equity;
      const curr = series[i].equity;
      if (prev > 0 && curr > 0) {
        returns.push({ date: series[i].date, return: curr / prev - 1 });
      }
    }
    return returns;
  })();

  const riskAdjusted = (() => {
    if (!dailyReturns.length) return { sharpe: null, sortino: null };
    const values = dailyReturns.map((d) => d.return);
    const mean =
      values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((acc, r) => acc + (r - mean) * (r - mean), 0) / values.length;
    const std = variance > 0 ? Math.sqrt(variance) : 0;
    // Downside deviation with full-sample denominator (MAR = 0)
    const downsideVar =
      values.reduce((acc, r) => {
        const d = Math.min(0, r);  // only downside contributes
        return acc + d * d;
      }, 0) / values.length;
    const downsideStd = downsideVar > 0 ? Math.sqrt(downsideVar) : 0;
    const scale = Math.sqrt(252);
    const sharpe = std > 0 ? (mean / std) * scale : null;
    const sortino = downsideStd > 0 ? (mean / downsideStd) * scale : null;
    return { sharpe, sortino };
  })();

  const returns = {
    all:
      runSummary?.netProfit != null && initialEquity
        ? runSummary.netProfit / initialEquity
        : null,
    long:
      runSummary?.netProfitLong != null && initialEquity
        ? runSummary.netProfitLong / initialEquity
        : null,
    short:
      runSummary?.netProfitShort != null && initialEquity
        ? runSummary.netProfitShort / initialEquity
        : null,
  };

  const totalPnl = trades.reduce((a, t) => a + (t.netPnl ?? 0), 0);
  const avgPnl = trades.length ? totalPnl / trades.length : null;
  const avgWin = wins.length
    ? wins.reduce((a, t) => a + (t.netPnl ?? 0), 0) / wins.length
    : null;
  const avgLoss = losses.length
    ? losses.reduce((a, t) => a + Math.abs(t.netPnl ?? 0), 0) / losses.length
    : null;
  const winLossRatio =
    avgLoss && avgLoss > 0 && avgWin != null ? avgWin / avgLoss : null;
  const largestWin =
    wins.length > 0 ? Math.max(...wins.map((t) => t.netPnl ?? 0)) : null;
  const largestLoss =
    losses.length > 0 ? Math.min(...losses.map((t) => t.netPnl ?? 0)) : null;
  const histogramValues = trades.map((t) => t.netPnl ?? 0).filter(Number.isFinite);
  const histogram = toHistogram(
    histogramValues,
    Math.min(12, Math.max(6, Math.ceil(Math.sqrt(Math.max(1, trades.length)))))
  );

  const computeDurationBars = (t: Trading212Trade) => {
    if (!t.entryDate || !t.exitDate) return null;
    const start = new Date(t.entryDate);
    const end = new Date(t.exitDate);
    const diff = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return Number.isFinite(diff) ? Math.max(0, diff) : null;
  };
  const avgBars = (() => {
    const durations = trades
      .map(computeDurationBars)
      .filter((d): d is number => d != null);
    if (!durations.length) return null;
    return durations.reduce((a, b) => a + b, 0) / durations.length;
  })();

  const profitFactor =
    grossLossAbs != null && grossLossAbs > 0 && runSummary?.grossProfit != null
      ? runSummary.grossProfit / grossLossAbs
      : null;

  const returnBreakdown: SelectedStrategyAnalytics["performance"]["returnBreakdown"] = {
    all: {
      initialCapital: initialEquity,
      openPnl: runSummary?.openPnl ?? null,
      netPnl: runSummary?.netProfit ?? null,
      grossProfit: runSummary?.grossProfit ?? null,
      grossLoss: grossLossAbs,
      profitFactor,
      commission: commissionAbs,
      expectedPayoff: trades.length ? totalPnl / trades.length : null,
    },
    long: {
      initialCapital: initialEquity,
      openPnl: null,
      netPnl: runSummary?.netProfitLong ?? null,
      grossProfit: runSummary?.grossProfitLong ?? null,
      grossLoss: grossLossLongAbs,
      profitFactor:
        grossLossLongAbs != null &&
        grossLossLongAbs > 0 &&
        runSummary?.grossProfitLong != null
          ? runSummary.grossProfitLong / grossLossLongAbs
          : null,
      commission: commissionAbs,
      expectedPayoff:
        longTrades.length && runSummary?.netProfitLong != null
          ? runSummary.netProfitLong / longTrades.length
          : null,
    },
    short: {
      initialCapital: initialEquity,
      openPnl: null,
      netPnl: runSummary?.netProfitShort ?? null,
      grossProfit: runSummary?.grossProfitShort ?? null,
      grossLoss: grossLossShortAbs,
      profitFactor:
        grossLossShortAbs != null &&
        grossLossShortAbs > 0 &&
        runSummary?.grossProfitShort != null
          ? runSummary.grossProfitShort / grossLossShortAbs
          : null,
      commission: commissionAbs,
      expectedPayoff:
        shortTrades.length && runSummary?.netProfitShort != null
          ? runSummary.netProfitShort / shortTrades.length
          : null,
    },
  };

  const capital = (() => {
    const margins = simResult.accountHistory
      .map((snap) => snap.marginUsed)
      .filter((m) => Number.isFinite(m)) as number[];
    const avgMarginUsed = margins.length
      ? margins.reduce((a, b) => a + b, 0) / margins.length
      : null;
    const maxMarginUsed = margins.length ? Math.max(...margins) : null;
    const accountSizeRequired = maxMarginUsed ?? initialEquity;
    const netProfit = runSummary?.netProfit ?? totalPnl ?? null;
    const returnOnInitial =
      netProfit != null && initialEquity ? netProfit / initialEquity : null;
    const returnOnRequired =
      netProfit != null && accountSizeRequired
        ? netProfit / accountSizeRequired
        : null;
    const netProfitVsMaxLoss =
      netProfit != null && largestLoss != null && largestLoss !== 0
        ? netProfit / Math.abs(largestLoss)
        : null;
    const marginEfficiency =
      avgMarginUsed && avgMarginUsed > 0 && netProfit != null
        ? netProfit / avgMarginUsed
        : null;
    const marginCalls =
      typeof runSummary?.stopOutEvents === "number" ? runSummary.stopOutEvents : null;
    return {
      accountSizeRequired,
      returnOnInitial,
      returnOnRequired,
      netProfitVsMaxLoss,
      avgMarginUsed,
      maxMarginUsed,
      marginEfficiency,
      marginCalls,
    };
  })();

  const runupDd = computeRunUpDrawdownStats(
    strategySeries.map((p) => ({ date: p.date, equity: p.equity }))
  );

  const intrabarMaxRunUp =
    trades.length > 0
      ? trades.reduce((max, t) => {
          const v = t.runUp;
          if (v == null || !Number.isFinite(v)) return max;
          return max == null ? v : Math.max(max, v);
        }, null as number | null)
      : null;

  const intrabarMaxDrawdown =
    trades.length > 0
      ? trades.reduce((max, t) => {
          const v = t.drawdown;
          if (v == null || !Number.isFinite(v)) return max;
          return max == null ? v : Math.max(max, v);
        }, null as number | null)
      : null;

  const runupsDrawdowns = {
    runUps: {
      avgDuration: runSummary?.avgRunUpDuration ?? runupDd.runUps.avgDuration ?? null,
      maxDuration: runSummary?.maxRunUpDuration ?? runupDd.runUps.maxDuration ?? null,
      avgValue: runSummary?.avgRunUpValue ?? runupDd.runUps.avgValue ?? null,
      maxValue: runSummary?.maxRunUpValue ?? runupDd.runUps.maxValue ?? null,
    },
    drawdowns: {
      avgDuration: runSummary?.avgDrawdownDuration ?? runupDd.drawdowns.avgDuration ?? null,
      maxDuration: runSummary?.maxDrawdownDuration ?? runupDd.drawdowns.maxDuration ?? null,
      avgValue: runSummary?.avgDrawdownValue ?? runupDd.drawdowns.avgValue ?? null,
      maxValue: runSummary?.maxDrawdownValue ?? runupDd.drawdowns.maxValue ?? null,
      avgPct: runSummary?.avgDrawdownPct ?? runupDd.drawdowns.avgPct ?? null,
      maxPct: runSummary?.maxDrawdownPct ?? runupDd.drawdowns.maxPct ?? null,
    },
    intrabar: {
      maxRunUp: intrabarMaxRunUp,
      maxDrawdown: intrabarMaxDrawdown,
    },
    maxEquityDrawdownReturn:
      runSummary?.maxDrawdownValue != null && initialEquity
        ? runSummary.maxDrawdownValue / initialEquity
        : runupDd.drawdowns.maxPct ?? null,
  };

  const bandStats = (
    values: Array<{ value: number; date?: string }> | null | undefined
  ) => {
    if (!values || values.length === 0) {
      return { min: null, max: null, current: null, minPct: null, maxPct: null, currentPct: null };
    }
    const nums = values.map((v) => v.value).filter((v) => Number.isFinite(v)) as number[];
    if (!nums.length) {
      return { min: null, max: null, current: null, minPct: null, maxPct: null, currentPct: null };
    }
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const current = values[values.length - 1].value;
    const toPct = (v: number | null) =>
      v != null && initialEquity ? v / initialEquity : null;
    return {
      min,
      max,
      current,
      minPct: toPct(min),
      maxPct: toPct(max),
      currentPct: toPct(current),
    };
  };

  const strategyBand = bandStats(pnlSeries.map((p) => ({ value: p.strategy, date: p.date })));
  const buyHoldBand = bandStats(
    buyHoldSeries?.map((p) => ({ value: p.valueAbs, date: p.date }))
  );

  return {
    strategyId: selectedSimRunId,
    strategyLabel: runSummary?.label ?? null,
    overviewCards,
    equitySeries: {
      initialEquity,
      strategy: strategySeries,
      buyHold: buyHoldSeries,
      excursions,
    },
    performance: {
      profitStructure,
      pnlSeries: combinedPnlSeries,
      benchmark: {
        buyHoldAbs:
          runSummary?.buyHoldReturn ??
          (buyHoldSeries && buyHoldSeries.length
            ? buyHoldSeries[buyHoldSeries.length - 1].valueAbs
            : null),
        buyHoldPct:
          runSummary?.buyHoldPct ??
          (buyHoldSeries && buyHoldSeries.length
            ? buyHoldSeries[buyHoldSeries.length - 1].valuePct
            : null),
        strategyAbs: runSummary?.netProfit ?? lastPoint?.pnl ?? null,
        strategyPct:
          runSummary?.netProfit != null && initialEquity
            ? runSummary.netProfit / initialEquity
            : lastPoint?.pct ?? null,
        maxDrawdownAbs: runSummary?.maxDrawdownValue ?? null,
        maxDrawdownPct: runSummary?.maxDrawdownPct ?? null,
        bands: {
          strategy: strategyBand,
          buyHold: buyHoldBand,
        },
      },
      returns,
      returnBreakdown,
      riskAdjusted,
    },
    trades: {
      histogram,
      winLoss: { wins: wins.length, losses: losses.length },
      summary: {
        total: trades.length,
        wins: wins.length,
        losses: losses.length,
        pctProfitable: trades.length > 0 ? (wins.length / trades.length) * 100 : null,
        avgPnl,
        avgWin,
        avgLoss,
        winLossRatio,
        largestWin,
        largestLoss,
        largestWinPct:
          largestWin != null && initialEquity ? largestWin / initialEquity : null,
        largestLossPct:
          largestLoss != null && initialEquity ? largestLoss / initialEquity : null,
        avgBars,
      },
      list: trades,
    },
    capital,
    runupsDrawdowns,
    dailyReturns,
    perf: {
      profitStructure,
      pnlSeries: combinedPnlSeries,
      benchmark: {
        buyHoldAbs:
          runSummary?.buyHoldReturn ??
          (buyHoldSeries && buyHoldSeries.length
            ? buyHoldSeries[buyHoldSeries.length - 1].valueAbs
            : null),
        buyHoldPct:
          runSummary?.buyHoldPct ??
          (buyHoldSeries && buyHoldSeries.length
            ? buyHoldSeries[buyHoldSeries.length - 1].valuePct
            : null),
        strategyAbs: runSummary?.netProfit ?? lastPoint?.pnl ?? null,
        strategyPct:
          runSummary?.netProfit != null && initialEquity
            ? runSummary.netProfit / initialEquity
            : lastPoint?.pct ?? null,
        maxDrawdownAbs: runSummary?.maxDrawdownValue ?? null,
        maxDrawdownPct: runSummary?.maxDrawdownPct ?? null,
        bands: {
          strategy: strategyBand,
          buyHold: buyHoldBand,
        },
      },
      returns,
      returnBreakdown,
      riskAdjusted,
    },
  };
}
