import { ensureCanonicalOrHistory } from "@/lib/storage/canonical";
import { ensureDefaultTargetSpec } from "@/lib/targets/defaultSpec";
import {
  buildEwmaReactionMap,
  buildEwmaTiltConfigFromReactionMap,
  defaultReactionConfig,
} from "@/lib/volatility/ewmaReaction";
import { runEwmaWalker } from "@/lib/volatility/ewmaWalker";
import {
  simulateTrading212Cfd,
  Trading212CfdConfig,
  Trading212Signal,
  Trading212SimBar,
} from "@/lib/backtest/trading212Cfd";
import { CanonicalRow } from "@/lib/types/canonical";
import { parseSymbolsFromArgv } from "./_utils/cli";
import { summarizeTrading212Result } from "./_utils/t212Summary";

const EWMA_LAMBDA = 0.94;
const TRAIN_FRACTION = 0.7;

const DEFAULT_THRESHOLDS = [
  0,
  0.00002,
  0.00005,
  0.0001,
  0.0002,
  0.0005,
  0.001,
  0.0015,
  0.002,
  0.005,
] as const;

function parseThresholds(argv: string[]): number[] {
  const arg = argv.find((a) => a.startsWith("--thresholds="));
  if (!arg) return [...DEFAULT_THRESHOLDS];
  const raw = arg.split("=")[1] ?? "";
  return raw
    .split(/[, ]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

function normalizeDateString(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split("T")[0];
}

function filterRowsForSim(rows: CanonicalRow[], startDate: string | null): CanonicalRow[] {
  if (!startDate) return rows;
  return rows.filter((r) => r.date >= startDate);
}

function buildBarsFromEwmaPath(
  rows: CanonicalRow[],
  path: { date_tp1: string; S_t: number; y_hat_tp1: number }[],
  horizon: number,
  thresholdFrac: number
): { bars: Trading212SimBar[]; edges: number[] } {
  const ewmaMap = new Map<string, { S_t: number; y_hat_tp1: number }>();
  path.forEach((p) => ewmaMap.set(p.date_tp1, { S_t: p.S_t, y_hat_tp1: p.y_hat_tp1 }));

  const bars: Trading212SimBar[] = [];
  const edges: number[] = [];

  for (const row of rows) {
    const price = row.adj_close ?? row.close;
    const date = normalizeDateString(row.date);
    if (!date || !price) continue;
    const ewma = ewmaMap.get(date);
    if (!ewma) continue;

    const edgeFrac = (ewma.y_hat_tp1 - ewma.S_t) / ewma.S_t;
    edges.push(edgeFrac);

    let signal: Trading212Signal = "flat";
    if (edgeFrac > thresholdFrac) {
      signal = "long";
    } else if (edgeFrac < -thresholdFrac) {
      signal = "short";
    }

    bars.push({ date, price, signal });
  }

  return { bars, edges };
}

function quantile(data: number[], q: number): number | null {
  if (data.length === 0) return null;
  const sorted = [...data].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

function formatPct(v: number | null | undefined, decimals = 4) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(decimals)}%`;
}

function formatPf(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v === Infinity) return "∞";
  return v.toFixed(3);
}

async function runForSymbol(symbol: string, thresholds: number[]) {
  const { rows } = await ensureCanonicalOrHistory(symbol, { interval: "1d", minRows: 260 });
  const spec = await ensureDefaultTargetSpec(symbol, {});
  const horizon = spec.h ?? 1;
  const coverage = spec.coverage ?? 0.95;

  const reactionConfig = {
    ...defaultReactionConfig,
    lambda: EWMA_LAMBDA,
    coverage,
    trainFraction: TRAIN_FRACTION,
    horizons: [horizon],
  };
  const reactionMap = await buildEwmaReactionMap(symbol, reactionConfig);
  const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor: 0.5, horizon });
  const biasedWalk = await runEwmaWalker({ symbol, lambda: EWMA_LAMBDA, coverage, horizon, tiltConfig });
  const startDate = reactionMap.meta.testStart ?? null;
  const simRows = filterRowsForSim(rows, startDate);

  // Precompute absolute edges
  const allEdges: number[] = [];
  const ewmaMap = new Map<string, { S_t: number; y_hat_tp1: number }>();
  biasedWalk.points.forEach((p) => ewmaMap.set(p.date_tp1, { S_t: p.S_t, y_hat_tp1: p.y_hat_tp1 }));
  for (const row of simRows) {
    const price = row.adj_close ?? row.close;
    if (!price || !row.date) continue;
    const ewma = ewmaMap.get(row.date);
    if (!ewma) continue;
    const edgeFrac = (ewma.y_hat_tp1 - ewma.S_t) / ewma.S_t;
    allEdges.push(Math.abs(edgeFrac));
  }
  const N = allEdges.length;
  const p50 = quantile(allEdges, 0.5);
  const p90 = quantile(allEdges, 0.9);
  const p95 = quantile(allEdges, 0.95);
  const p99 = quantile(allEdges, 0.99);

  console.log(`\n=== ${symbol} ===`);
  console.log(
    `absEdge quantiles: p50=${formatPct(p50)} p90=${formatPct(p90)} p95=${formatPct(p95)} p99=${formatPct(p99)}`
  );
  console.log("threshold sweep:");
  console.log("bps    act%   frac>=th%  trades  closed  ret%    maxDD%  pf");

  let prevActivation: number | null = null;

  for (const th of thresholds) {
    const { bars, edges } = buildBarsFromEwmaPath(simRows, biasedWalk.points, horizon, th);
    const absEdges = edges.map((e) => Math.abs(e)).filter((v) => Number.isFinite(v));
    const above = absEdges.filter((e) => e >= th).length;
    const fracAbove = absEdges.length > 0 ? above / absEdges.length : 0;
    const active = bars.filter((b) => b.signal !== "flat").length;
    const activationRate = bars.length > 0 ? active / bars.length : 0;

    const config: Trading212CfdConfig = {
      leverage: 5,
      fxFeeRate: 0.005,
      dailyLongSwapRate: 0,
      dailyShortSwapRate: 0,
      spreadBps: 5,
      marginCallLevel: 0.45,
      stopOutLevel: 0.25,
      positionFraction: 0.25,
    };
    const sim = simulateTrading212Cfd(bars, 5000, config);
    const summary = summarizeTrading212Result(sim);

    const pf = (() => {
      const closed = sim.trades.filter((t) => t.exitDate);
      if (closed.length === 0) return null;
      const gp = closed.filter((t) => (t.netPnl ?? 0) > 0).reduce((a, t) => a + (t.netPnl ?? 0), 0);
      const gl = Math.abs(closed.filter((t) => (t.netPnl ?? 0) < 0).reduce((a, t) => a + (t.netPnl ?? 0), 0));
      if (gl === 0) return gp > 0 ? Infinity : null;
      return gp / gl;
    })();

    const bps = (th * 10000).toFixed(1);
    console.log(
      `${bps.padEnd(6)} ${ (activationRate*100).toFixed(2).padStart(6)} ${ (fracAbove*100).toFixed(2).padStart(10)} ${String(summary.trades).padStart(7)} ${String(sim.trades.length).padStart(7)} ${formatPct(summary.returnPct, 2).padStart(8)} ${formatPct(summary.maxDrawdownPct, 2).padStart(8)} ${formatPf(pf).padStart(6)}`
    );

    if (Math.abs(activationRate - fracAbove) > 0.01) {
      console.warn(
        `WARN [${symbol}] activationRate (${activationRate.toFixed(4)}) differs from fracAbove (${fracAbove.toFixed(
          4
        )}) at threshold ${th}`
      );
    }
    if (prevActivation != null && activationRate > prevActivation + 1e-6) {
      console.warn(`WARN [${symbol}] activation increased when threshold increased (prev=${prevActivation}, now=${activationRate}, th=${th})`);
    }
    prevActivation = activationRate;
  }
}

async function main() {
  const thresholds = parseThresholds(process.argv.slice(2));
  const symbols = parseSymbolsFromArgv(process.argv.slice(2), ["LOW", "NOC", "AMGN", "RTX", "LIN", "MDT"]);
  for (const symbol of symbols) {
    try {
      await runForSymbol(symbol, thresholds);
    } catch (err) {
      console.error(`Error for ${symbol}:`, err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
