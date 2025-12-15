import { ensureCanonicalOrHistory } from "@/lib/storage/canonical";
import { ensureDefaultTargetSpec } from "@/lib/targets/defaultSpec";
import {
  buildEwmaReactionMap,
  buildEwmaTiltConfigFromReactionMap,
  defaultReactionConfig,
} from "@/lib/volatility/ewmaReaction";
import { EwmaWalkerPoint, runEwmaWalker, summarizeEwmaWalkerResults } from "@/lib/volatility/ewmaWalker";
import {
  simulateTrading212Cfd,
  Trading212CfdConfig,
  Trading212Signal,
  Trading212SimBar,
} from "@/lib/backtest/trading212Cfd";
import { CanonicalRow } from "@/lib/types/canonical";
import { parseSymbolsFromArgv } from "./_utils/cli";

type Window = { start: string; end: string; label: string };

const DEFAULT_SYMBOLS = ["NVDA", "AAPL", "TSLA"];
const WINDOW_DAYS = 30;
const INITIAL_EQUITY = 5000;
const MODES = ["unbiased", "biased", "biased-max"] as const;

const lambdaBase = 0.94;
const trainFractionBase = 0.7;
const shrinkFactor = 0.5;
const thresholdPct = 0;

const T212_CONFIG: Trading212CfdConfig = {
  leverage: 5,
  fxFeeRate: 0.005,
  dailyLongSwapRate: 0,
  dailyShortSwapRate: 0,
  spreadBps: 5,
  marginCallLevel: 0.45,
  stopOutLevel: 0.25,
  positionFraction: 0.25,
};

const normalizeDateString = (value: string | null | undefined): string | null => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split("T")[0];
};

type EwmaRunBundle = {
  walk: { points: EwmaWalkerPoint[] };
  reactionMapTestStart: string | null;
};

function filterRowsForSim(rows: CanonicalRow[], startDate: string | null): CanonicalRow[] {
  if (!startDate) return rows;
  return rows.filter((r) => r.date >= startDate);
}

function buildBarsFromEwmaPath(
  rows: CanonicalRow[],
  path: EwmaWalkerPoint[],
  horizon: number,
  threshold: number
): Trading212SimBar[] {
  const ewmaMap = new Map<string, EwmaWalkerPoint>();
  path.forEach((p) => ewmaMap.set(p.date_tp1, p));

  const bars: Trading212SimBar[] = [];
  for (const row of rows) {
    const price = row.adj_close ?? row.close;
    if (!price || !row.date) continue;
    const ewma = ewmaMap.get(row.date);
    if (!ewma) continue;

    const diffPct = (ewma.y_hat_tp1 - ewma.S_t) / ewma.S_t;
    let signal: Trading212Signal = "flat";
    if (diffPct > threshold) signal = "long";
    else if (diffPct < -threshold) signal = "short";

    bars.push({ date: row.date, price, signal });
  }
  return bars;
}

async function runBiasedWalk(
  symbol: string,
  lambda: number,
  trainFraction: number,
  coverage: number,
  horizon: number,
  shrink: number
): Promise<EwmaRunBundle> {
  const reactionConfig = {
    ...defaultReactionConfig,
    lambda,
    coverage,
    trainFraction,
    horizons: [horizon],
  };
  const reactionMap = await buildEwmaReactionMap(symbol, reactionConfig);
  const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor: shrink, horizon });
  const walk = await runEwmaWalker({ symbol, lambda, coverage, horizon, tiltConfig });
  return { walk, reactionMapTestStart: reactionMap.meta.testStart ?? null };
}

async function optimizeBiasedConfig(
  symbol: string,
  coverage: number,
  horizon: number,
  shrink: number
): Promise<{ lambda: number; trainFraction: number }> {
  const lambdaGrid = Array.from({ length: 11 }, (_, i) => 0.5 + i * 0.05); // 0.50..1.00
  const trainGrid = Array.from({ length: 9 }, (_, i) => 0.5 + i * 0.05); // 0.50..0.90

  let best: { lambda: number; trainFraction: number; hit: number } | null = null;

  for (const lambda of lambdaGrid) {
    for (const trainFraction of trainGrid) {
      try {
        const reactionConfig = {
          ...defaultReactionConfig,
          lambda,
          coverage,
          trainFraction,
          horizons: [horizon],
        };
        const reactionMap = await buildEwmaReactionMap(symbol, reactionConfig);
        const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor: shrink, horizon });
        const walk = await runEwmaWalker({ symbol, lambda, coverage, horizon, tiltConfig });
        const summary = summarizeEwmaWalkerResults(walk);
        if (!best || summary.directionHitRate > best.hit) {
          best = { lambda, trainFraction, hit: summary.directionHitRate };
        }
      } catch {
        continue;
      }
    }
  }

  return best
    ? { lambda: best.lambda, trainFraction: best.trainFraction }
    : { lambda: lambdaBase, trainFraction: trainFractionBase };
}

function computeWindows(history: ReturnType<typeof simulateTrading212Cfd>["accountHistory"]): Window[] {
  if (!history || history.length === 0) return [];
  const start = history[0].date;
  const end = history[history.length - 1].date;
  const last30StartIdx = Math.max(0, history.length - WINDOW_DAYS);
  const last30Start = history[last30StartIdx]?.date ?? start;
  return [
    { start: last30Start, end, label: `last${WINDOW_DAYS}` },
    { start, end, label: "full" },
  ];
}

function sliceHistoryToWindow(
  history: ReturnType<typeof simulateTrading212Cfd>["accountHistory"],
  window: Window | null
) {
  if (!history || history.length === 0) {
    return { slice: [] as typeof history, prevSideBefore: null as string | null };
  }
  if (!window) {
    return { slice: history, prevSideBefore: null as string | null };
  }
  const startIdx = history.findIndex((h) => h.date >= window.start);
  if (startIdx === -1) {
    return { slice: [] as typeof history, prevSideBefore: null as string | null };
  }
  let endIdx = history.length - 1;
  for (let i = history.length - 1; i >= startIdx; i--) {
    if (history[i].date <= window.end) {
      endIdx = i;
      break;
    }
  }
  if (endIdx < startIdx) {
    return { slice: [] as typeof history, prevSideBefore: null as string | null };
  }
  const prevSideBefore = startIdx > 0 ? history[startIdx - 1]?.side ?? null : null;
  return { slice: history.slice(startIdx, endIdx + 1), prevSideBefore };
}

type WindowSummary = {
  windowLabel: string;
  start: string | null;
  end: string | null;
  days: number;
  pnlAbs: number | null;
  pnlPct: number | null;
  maxDrawdownAbs: number | null;
  maxDrawdownPct: number | null;
  totalTrades: number;
  openedTrades: number;
  closedTrades: number;
  profitableClosed: number;
  pctProfitableClosed: number | null;
  profitFactor: number | null;
  overlappingTrades: number;
  hasExposureInWindow: boolean;
  warnings: string[];
};

function summarizeWindow(
  result: ReturnType<typeof simulateTrading212Cfd>,
  window: Window | null
): WindowSummary {
  const { slice, prevSideBefore } = sliceHistoryToWindow(result.accountHistory, window);
  const start = slice.length > 0 ? slice[0].date ?? null : window?.start ?? null;
  const end = slice.length > 0 ? slice[slice.length - 1].date ?? null : window?.end ?? null;
  const days = slice.length;

  const warnings: string[] = [];

  const equitySeries = slice.map((s) => s.equity).filter((v): v is number => v != null && Number.isFinite(v));
  const baseEquity = equitySeries.length > 0 ? equitySeries[0] : null;
  const lastEquity = equitySeries.length > 0 ? equitySeries[equitySeries.length - 1] : null;
  const pnlAbs = baseEquity != null && lastEquity != null ? lastEquity - baseEquity : null;
  const pnlPct = baseEquity != null && baseEquity !== 0 && pnlAbs != null ? pnlAbs / baseEquity : null;

  let maxDrawdownPct: number | null = null;
  let maxDrawdownAbs: number | null = null;
  if (equitySeries.length > 0) {
    let peak = equitySeries[0];
    let maxDd = 0;
    for (const value of equitySeries) {
      if (value > peak) peak = value;
      const dd = peak > 0 ? (peak - value) / peak : 0;
      if (dd > maxDd) maxDd = dd;
    }
    maxDrawdownPct = maxDd;
    maxDrawdownAbs = peak * maxDd;
  }

  const windowStart = window?.start ?? null;
  const windowEnd = window?.end ?? null;
  const overlapTrades = (result.trades ?? []).filter((t) => {
    if (!windowStart || !windowEnd) return true;
    const entry = normalizeDateString(t.entryDate);
    const exit = normalizeDateString(t.exitDate);
    if (!entry) return false;
    const tradeStart = entry;
    const tradeEnd = exit ?? "9999-12-31";
    return tradeStart <= windowEnd && tradeEnd >= windowStart;
  });

  const closedTrades = overlapTrades.filter((t) => {
    if (!t.exitDate) return false;
    if (!windowStart || !windowEnd) return true;
    const exit = normalizeDateString(t.exitDate);
    if (!exit) return false;
    return exit >= windowStart && exit <= windowEnd;
  });

  let openedTrades = 0;
  let prevSide = prevSideBefore;
  for (const snap of slice) {
    const side = snap.side ?? null;
    if (side && side !== prevSide) {
      openedTrades++;
    }
    prevSide = side;
  }

  const hasExposureInWindow = slice.some((s) => s.side != null);
  const activeAtStart = slice.length > 0 && slice[0].side != null;
  const positionSegments = openedTrades + (activeAtStart ? 1 : 0);
  const totalTrades = Math.max(
    closedTrades.length,
    positionSegments,
    overlapTrades.length,
    hasExposureInWindow ? 1 : 0
  );
  const profitableClosed = closedTrades.filter((t) => (t.netPnl ?? 0) > 0).length;
  const pctProfitableClosed =
    closedTrades.length > 0 ? (profitableClosed / closedTrades.length) * 100 : null;

  const grossProfit = closedTrades
    .filter((t) => (t.netPnl ?? 0) > 0)
    .reduce((a, t) => a + (t.netPnl ?? 0), 0);
  const grossLoss = Math.abs(
    closedTrades.filter((t) => (t.netPnl ?? 0) < 0).reduce((a, t) => a + (t.netPnl ?? 0), 0)
  );
  const profitFactor =
    closedTrades.length === 0
      ? null
      : grossLoss === 0
        ? grossProfit > 0
          ? Infinity
          : null
        : grossProfit / grossLoss;

  if (closedTrades.length === 0) {
    if (pctProfitableClosed != null) warnings.push("pctProfitableClosed should be null with no closed trades");
    if (profitFactor != null) warnings.push("profitFactor should be null with no closed trades");
  }
  if (pnlAbs != null && pnlAbs !== 0 && totalTrades === 0) {
    if (hasExposureInWindow) {
      warnings.push("Non-zero P&L with exposure but zero totalTrades");
    } else {
      warnings.push("Non-zero P&L with zero totalTrades and no exposure");
    }
  }
  if (totalTrades < closedTrades.length) {
    warnings.push("totalTrades < closedTrades (should be >=)");
  }

  return {
    windowLabel: window?.label ?? "full",
    start,
    end,
    days,
    pnlAbs,
    pnlPct,
    maxDrawdownAbs,
    maxDrawdownPct,
    totalTrades,
    openedTrades,
    closedTrades: closedTrades.length,
    profitableClosed,
    pctProfitableClosed,
    profitFactor,
    overlappingTrades: overlapTrades.length,
    hasExposureInWindow,
    warnings,
  };
}

function formatUsd(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function formatPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}${Math.abs(v).toFixed(2)}%`;
}

function formatPf(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v === Infinity) return "∞";
  return v.toFixed(3);
}

async function runForSymbol(symbol: string) {
  const { rows } = await ensureCanonicalOrHistory(symbol, { interval: "1d", minRows: 260 });
  const spec = await ensureDefaultTargetSpec(symbol, {});
  const horizon = spec.h ?? 1;
  const coverage = spec.coverage ?? 0.95;

  // Unbiased
  const neutralWalk = await runEwmaWalker({ symbol, lambda: lambdaBase, coverage, horizon });
  const unbiasedBars = buildBarsFromEwmaPath(rows, neutralWalk.points, horizon, thresholdPct);
  const unbiasedSim = simulateTrading212Cfd(unbiasedBars, INITIAL_EQUITY, T212_CONFIG);

  // Biased (base)
  const biasedRun = await runBiasedWalk(symbol, lambdaBase, trainFractionBase, coverage, horizon, shrinkFactor);
  const biasedRows = filterRowsForSim(rows, biasedRun.reactionMapTestStart);
  const biasedBars = buildBarsFromEwmaPath(biasedRows, biasedRun.walk.points, horizon, thresholdPct);
  const biasedSim = simulateTrading212Cfd(biasedBars, INITIAL_EQUITY, T212_CONFIG);

  // Biased (Max)
  const best = await optimizeBiasedConfig(symbol, coverage, horizon, shrinkFactor);
  const biasedMaxRun = await runBiasedWalk(symbol, best.lambda, best.trainFraction, coverage, horizon, shrinkFactor);
  const biasedMaxRows = filterRowsForSim(rows, biasedMaxRun.reactionMapTestStart);
  const biasedMaxBars = buildBarsFromEwmaPath(biasedMaxRows, biasedMaxRun.walk.points, horizon, thresholdPct);
  const biasedMaxSim = simulateTrading212Cfd(biasedMaxBars, INITIAL_EQUITY, T212_CONFIG);

  const modeRuns: Record<typeof MODES[number], { sim: ReturnType<typeof simulateTrading212Cfd>; lambda?: number; trainFraction?: number }> = {
    unbiased: { sim: unbiasedSim },
    biased: { sim: biasedSim, lambda: lambdaBase, trainFraction: trainFractionBase },
    "biased-max": { sim: biasedMaxSim, lambda: best.lambda, trainFraction: best.trainFraction },
  };

  console.log(`\n=== ${symbol} ===`);

  for (const mode of MODES) {
    const { sim, lambda, trainFraction } = modeRuns[mode];
    const windows = computeWindows(sim.accountHistory);
    if (windows.length === 0) {
      console.log(`${mode.padEnd(11)} no history`);
      continue;
    }

    for (const window of windows) {
      const summary = summarizeWindow(sim, window);
      const lambdaInfo =
        mode === "unbiased"
          ? ""
          : ` λ=${lambda?.toFixed(2) ?? "—"} train=${trainFraction != null ? trainFraction.toFixed(2) : "—"}`;
      const pctProfitable =
        summary.pctProfitableClosed == null
          ? "—"
          : `${summary.pctProfitableClosed.toFixed(2)}%`;
      const ddPctStr = summary.maxDrawdownPct != null ? formatPct(summary.maxDrawdownPct * 100) : "—";
      const pnlPctStr = summary.pnlPct != null ? formatPct(summary.pnlPct * 100) : "—";

      console.log(
        `${mode.padEnd(11)} [${window.label} ${summary.start}..${summary.end} days=${summary.days}] ` +
          `pnl=${formatUsd(summary.pnlAbs)} (${pnlPctStr})  dd=${formatUsd(summary.maxDrawdownAbs)} (${ddPctStr})  ` +
          `trades=${summary.totalTrades} closed=${summary.closedTrades} prof=${summary.profitableClosed} (${pctProfitable}) pf=${formatPf(summary.profitFactor)}${lambdaInfo}`
      );
      summary.warnings.forEach((w) => console.warn(`WARN [${symbol} ${mode} ${window.label}] ${w}`));
    }
  }
}

async function main() {
  const symbols = parseSymbolsFromArgv(process.argv.slice(2), DEFAULT_SYMBOLS);
  for (const symbol of symbols) {
    try {
      await runForSymbol(symbol);
    } catch (err) {
      console.error(`Error running ${symbol}:`, err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
