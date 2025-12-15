import { ensureCanonicalOrHistory } from "@/lib/storage/canonical";
import { ensureDefaultTargetSpec } from "@/lib/targets/defaultSpec";
import {
  buildEwmaReactionMap,
  buildEwmaTiltConfigFromReactionMap,
  defaultReactionConfig,
} from "@/lib/volatility/ewmaReaction";
import { runEwmaWalker } from "@/lib/volatility/ewmaWalker";
import {
  buildBarsFromZEdges,
  computeZEdgeSeries,
  optimizeZHysteresisThresholds,
  type ZHysteresisThresholds,
} from "@/lib/volatility/zWfoOptimize";
import {
  simulateTrading212Cfd,
  type Trading212AccountSnapshot,
  type Trading212CfdConfig,
  type Trading212Trade,
} from "@/lib/backtest/trading212Cfd";
import type { CanonicalRow } from "@/lib/types/canonical";
import { parseSymbolsFromArgv } from "./_utils/cli";

type WindowSummary = {
  pnlAbs: number;
  pnlPct: number;
  maxDrawdown: number;
  trades: number;
  closed: number;
  profitableClosed: number | null;
  pctProfitable: number | null;
  profitFactor: number | null;
  warnings: string[];
};

const DEFAULT_SYMBOLS = ["KO", "PG", "JNJ", "CVX", "PFE", "VZ"] as const;
const DEFAULT_WINDOWS = [63, 126, 252];
const BASE_LAMBDA = 0.94;
const BASE_TRAIN = 0.7;
const MAX_LAMBDA = 0.99;
const MAX_TRAIN = 0.8;
const COVERAGE = 0.95;
const HORIZON = 1;

const tradingConfig: Trading212CfdConfig = {
  leverage: 5,
  fxFeeRate: 0.005,
  dailyLongSwapRate: 0,
  dailyShortSwapRate: 0,
  spreadBps: 0,
  marginCallLevel: 0.45,
  stopOutLevel: 0.25,
  positionFraction: 0.25,
};

function parseWindows(argv: string[]): number[] {
  const arg = argv.find((a) => a.startsWith("--windows="));
  if (!arg) return DEFAULT_WINDOWS;
  const raw = arg.split("=")[1] || "";
  const parts = raw
    .split(/[, ]+/)
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v > 0)
    .map((v) => Math.floor(v));
  return parts.length ? parts : DEFAULT_WINDOWS;
}

function computeAutoZThresholds(
  ewmaPath: { date_tp1: string; y_hat_tp1: number; S_t: number; sigma_t: number }[],
  canonicalRows: CanonicalRow[],
  horizon: number,
  fallbackEnter: number,
  simStartDate?: string | null
): ZHysteresisThresholds | null {
  const exitRatio = 0.3;
  const flipRatio = 2.0;
  const sqrtH = Math.sqrt(horizon);
  const simStart = simStartDate ?? canonicalRows[0]?.date ?? null;
  if (!simStart) {
    const fallback = fallbackEnter;
    return {
      enterLong: fallback,
      enterShort: fallback,
      exitLong: fallback * exitRatio,
      exitShort: fallback * exitRatio,
      flipLong: fallback * flipRatio,
      flipShort: fallback * flipRatio,
    };
  }

  const calibPoints = ewmaPath
    .filter((p) => p.date_tp1 < simStart)
    .sort((a, b) => a.date_tp1.localeCompare(b.date_tp1))
    .slice(-252);

  const zEdges: number[] = [];
  for (const p of calibPoints) {
    const sigmaH = p.sigma_t * sqrtH;
    const muBase = Math.log(p.y_hat_tp1 / p.S_t);
    if (!Number.isFinite(muBase) || !Number.isFinite(sigmaH) || sigmaH <= 0) continue;
    zEdges.push(muBase / sigmaH);
  }

  if (zEdges.length === 0) {
    const fallback = fallbackEnter;
    return {
      enterLong: fallback,
      enterShort: fallback,
      exitLong: fallback * exitRatio,
      exitShort: fallback * exitRatio,
      flipLong: fallback * flipRatio,
      flipShort: fallback * flipRatio,
    };
  }

  const targetQ = 0.9;
  const minSamples = 50;
  const quantile = (arr: number[], q: number): number => {
    if (!arr.length) return NaN;
    const sorted = [...arr].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }
    return sorted[base];
  };

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

function computeMaxDrawdown(equity: number[]): number {
  if (!equity.length) return 0;
  let peak = equity[0];
  let maxDd = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

function countTradeSegments(history: Trading212AccountSnapshot[]): number {
  if (!history.length) return 0;
  let prevSide: Trading212AccountSnapshot["side"] | null = null;
  let count = 0;
  for (const snap of history) {
    if (snap.side !== prevSide && (snap.side === "long" || snap.side === "short")) {
      count++;
    }
    prevSide = snap.side;
  }
  return count;
}

function summarizeWindow(
  windowedHistory: Trading212AccountSnapshot[],
  trades: Trading212Trade[]
): WindowSummary {
  const warnings: string[] = [];
  if (windowedHistory.length === 0) {
    return {
      pnlAbs: 0,
      pnlPct: 0,
      maxDrawdown: 0,
      trades: 0,
      closed: 0,
      profitableClosed: null,
      pctProfitable: null,
      profitFactor: null,
      warnings: ["No history in window"],
    };
  }

  const first = windowedHistory[0];
  const last = windowedHistory[windowedHistory.length - 1];
  const pnlAbs = last.equity - first.equity;
  const pnlPct = first.equity > 0 ? (last.equity - first.equity) / first.equity : 0;

  const equities = windowedHistory.map((h) => h.equity);
  const maxDrawdown = computeMaxDrawdown(equities);

  const tradesInWindow = trades.filter((t) => t.exitDate && t.exitDate >= first.date && t.exitDate <= last.date);
  const closed = tradesInWindow.length;
  const profitableClosed = closed > 0 ? tradesInWindow.filter((t) => (t.netPnl ?? 0) > 0).length : null;
  const pctProfitable = closed > 0 && profitableClosed != null ? profitableClosed / closed : null;
  let profitFactor: number | null = null;
  if (closed > 0) {
    const grossProfit = tradesInWindow
      .filter((t) => (t.netPnl ?? 0) > 0)
      .reduce((acc, t) => acc + (t.netPnl ?? 0), 0);
    const grossLoss = Math.abs(
      tradesInWindow.filter((t) => (t.netPnl ?? 0) < 0).reduce((acc, t) => acc + (t.netPnl ?? 0), 0)
    );
    profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Infinity : null) : grossProfit / grossLoss;
  }

  const segments = countTradeSegments(windowedHistory);
  if (segments === 0 && Math.abs(pnlAbs) > 1e-8) {
    warnings.push("P&L without trades; check window alignment.");
  }

  return {
    pnlAbs,
    pnlPct,
    maxDrawdown,
    trades: segments,
    closed: closed ?? 0,
    profitableClosed,
    pctProfitable,
    profitFactor,
    warnings,
  };
}

function formatPct(value: number | null, decimals = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(decimals)}%`;
}

function formatPf(value: number | null): string {
  if (value == null) return "—";
  if (!Number.isFinite(value)) return "∞";
  return value.toFixed(2);
}

function formatCount(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(1);
}

async function runForSymbol(symbol: string, windows: number[]) {
  const sym = symbol.toUpperCase();
  const { rows } = await ensureCanonicalOrHistory(sym, { interval: "1d", minRows: 400 });
  const spec = await ensureDefaultTargetSpec(sym, {});
  const horizon = spec.h ?? HORIZON;
  const coverage = spec.coverage ?? COVERAGE;

  const reactionConfigBase = {
    ...defaultReactionConfig,
    lambda: BASE_LAMBDA,
    coverage,
    trainFraction: BASE_TRAIN,
    horizons: [horizon],
  };
  const reactionMapBase = await buildEwmaReactionMap(sym, reactionConfigBase);
  const tiltBase = buildEwmaTiltConfigFromReactionMap(reactionMapBase, { shrinkFactor: 0.5, horizon });
  const ewmaBase = await runEwmaWalker({ symbol: sym, lambda: BASE_LAMBDA, coverage, horizon, tiltConfig: tiltBase });

  const reactionConfigMax = {
    ...defaultReactionConfig,
    lambda: MAX_LAMBDA,
    coverage,
    trainFraction: MAX_TRAIN,
    horizons: [horizon],
  };
  const reactionMapMax = await buildEwmaReactionMap(sym, reactionConfigMax);
  const tiltMax = buildEwmaTiltConfigFromReactionMap(reactionMapMax, { shrinkFactor: 0.5, horizon });
  const ewmaMax = await runEwmaWalker({ symbol: sym, lambda: MAX_LAMBDA, coverage, horizon, tiltConfig: tiltMax });

  const simStartBase = reactionMapBase.meta.testStart ?? null;

  const optimizeResult = await optimizeZHysteresisThresholds({
    symbol: sym,
    horizon,
    ewmaPath: ewmaBase.points,
    canonicalRows: rows,
    simStartDate: simStartBase,
    trainLen: 252,
    valLen: 63,
    stepLen: 63,
    quantilesEnter: [0.8, 0.85, 0.9, 0.95],
    quantilesExit: [0.4, 0.5, 0.6, 0.7],
    quantilesFlip: [0.95, 0.97, 0.99],
    tradingConfig,
    initialEquity: 5000,
  });

  const zSeriesBase = computeZEdgeSeries(rows, ewmaBase.points, horizon, simStartBase);
  const zSeriesMax = computeZEdgeSeries(rows, ewmaMax.points, horizon, reactionMapMax.meta.testStart ?? null);

  let thresholdsSource: "OPTIMIZED" | "AUTO" = "OPTIMIZED";
  let thresholds: ZHysteresisThresholds | null = optimizeResult.best.applyRecommended
    ? optimizeResult.best.thresholds
    : null;
  if (!thresholds) {
    thresholds = computeAutoZThresholds(ewmaBase.points, rows, horizon, 0.3, simStartBase);
    thresholdsSource = "AUTO";
  }

  if (!thresholds) {
    throw new Error(`[${sym}] No thresholds available after optimization fallback.`);
  }

  const barsBase = buildBarsFromZEdges(zSeriesBase, thresholds, 0).bars;
  const barsMax = buildBarsFromZEdges(zSeriesMax, thresholds, 0).bars;

  const simBase = simulateTrading212Cfd(barsBase, 5000, tradingConfig);
  const simMax = simulateTrading212Cfd(barsMax, 5000, tradingConfig);

  const summarize = (history: Trading212AccountSnapshot[], trades: Trading212Trade[], windowSize: number) => {
    const slice = history.slice(-windowSize);
    const warnings: string[] = [];
    if (slice.length < windowSize) {
      warnings.push(`Window ${windowSize} shorter than requested (${slice.length})`);
    }
    const summary = summarizeWindow(slice, trades);
    summary.warnings.push(...warnings);
    return summary;
  };

  const windowSummariesBase = new Map<number, WindowSummary>();
  const windowSummariesMax = new Map<number, WindowSummary>();
  for (const w of windows) {
    windowSummariesBase.set(w, summarize(simBase.accountHistory, simBase.trades, w));
    windowSummariesMax.set(w, summarize(simMax.accountHistory, simMax.trades, w));
  }

  console.log(`\n=== ${sym} ===`);
  console.log(
    `zOptimize: applyRecommended=${optimizeResult.best.applyRecommended} reason=${optimizeResult.best.reason ?? "—"} using=${thresholdsSource} baseline=${Number.isFinite(optimizeResult.best.baselineScore) ? optimizeResult.best.baselineScore.toFixed(3) : "—"} best=${Number.isFinite(optimizeResult.best.bestScore) ? optimizeResult.best.bestScore.toFixed(3) : "—"}`
  );
  const printRow = (label: string, summaries: Map<number, WindowSummary>) => {
    console.log(label);
    for (const w of windows) {
      const s = summaries.get(w)!;
      const warnText = s.warnings.length ? ` WARN: ${s.warnings.join("; ")}` : "";
      const profCount = s.profitableClosed != null && s.closed > 0 ? `${s.profitableClosed}/${s.closed}` : "—";
      console.log(
        `  ${String(w).padEnd(3)}: pnl=${s.pnlAbs.toFixed(2)} (${formatPct(s.pnlPct)}) dd=${formatPct(s.maxDrawdown)} trades=${s.trades} closed=${s.closed} prof=${profCount} pf=${formatPf(s.profitFactor)}${warnText}`
      );
    }
  };

  printRow("Biased:", windowSummariesBase);
  printRow("Biased-Max:", windowSummariesMax);
}

async function main() {
  const symbols = parseSymbolsFromArgv(process.argv.slice(2), DEFAULT_SYMBOLS as unknown as string[]);
  const windows = parseWindows(process.argv.slice(2));

  for (const sym of symbols) {
    await runForSymbol(sym, windows);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
