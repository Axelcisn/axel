import { ensureCanonicalOrHistory } from "@/lib/storage/canonical";
import { ensureDefaultTargetSpec } from "@/lib/targets/defaultSpec";
import {
  buildEwmaReactionMap,
  buildEwmaTiltConfigFromReactionMap,
  defaultReactionConfig,
} from "@/lib/volatility/ewmaReaction";
import { runEwmaWalker } from "@/lib/volatility/ewmaWalker";
import { CanonicalRow } from "@/lib/types/canonical";
import { Trading212Signal, Trading212SimBar } from "@/lib/backtest/trading212Cfd";
import { parseSymbolsFromArgv } from "./_utils/cli";

const EWMA_LAMBDA = 0.94;
const TRAIN_FRACTION = 0.7;

type SimCostConfig = {
  spreadBps?: number;
  feeBps?: number;
  fxBps?: number;
  slippageBps?: number;
};

const simCostDefaults: SimCostConfig = {
  spreadBps: 5,
  feeBps: 0,
  fxBps: 0,
  slippageBps: 0,
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function estimateDefaultThresholdPct(costs: SimCostConfig): number {
  const spread = costs.spreadBps ?? 0;
  const fee = costs.feeBps ?? 0;
  const fx = costs.fxBps ?? 0;
  const slippage = costs.slippageBps ?? 0;
  const roundTripPct = (2 * (spread + fee + fx + slippage)) / 10000; // bps -> decimal
  const buffered = roundTripPct + 0.0001; // add ~1bp buffer
  const fallback = 0.001; // 0.10%
  const candidate = Number.isFinite(buffered) ? buffered : fallback;
  return clamp(candidate, 0.0002, 0.005); // 2–50 bps
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
  thresholdPct: number
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

    const edge = (ewma.y_hat_tp1 - ewma.S_t) / ewma.S_t; // fractional edge (not percent)
    edges.push(edge);

    let signal: Trading212Signal = "flat";
    if (edge > thresholdPct) {
      signal = "long";
    } else if (edge < -thresholdPct) {
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

function formatPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(4)}%`;
}

async function runForSymbol(symbol: string) {
  const { rows } = await ensureCanonicalOrHistory(symbol, { interval: "1d", minRows: 260 });
  const spec = await ensureDefaultTargetSpec(symbol, {});
  const horizon = spec.h ?? 1;
  const coverage = spec.coverage ?? 0.95;

  const thresholdPct = estimateDefaultThresholdPct(simCostDefaults);

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

  const { bars, edges } = buildBarsFromEwmaPath(simRows, biasedWalk.points, horizon, thresholdPct);
  const absEdges = edges.map((e) => Math.abs(e)).filter((v) => Number.isFinite(v));
  const N = absEdges.length;
  const p50 = quantile(absEdges, 0.5);
  const p90 = quantile(absEdges, 0.9);
  const p95 = quantile(absEdges, 0.95);
  const p99 = quantile(absEdges, 0.99);
  const above = absEdges.filter((e) => e >= thresholdPct).length;
  const fracAbove = N > 0 ? above / N : 0;
  const activeSignals = bars.filter((b) => b.signal !== "flat").length;
  const fracActive = N > 0 ? activeSignals / N : 0;

  console.log(`\n=== ${symbol} ===`);
  console.log(`thresholdFrac=${thresholdPct} thresholdPct=${formatPct(thresholdPct)} samples=${N}`);
  console.log(
    `|edge| quantiles: p50=${formatPct(p50)} p90=${formatPct(p90)} p95=${formatPct(p95)} p99=${formatPct(p99)}`
  );
  console.log(
    `frac(|edge|>=threshold)=${(fracAbove * 100).toFixed(2)}%  signal active rate=${(fracActive * 100).toFixed(2)}%`
  );
}

async function main() {
  const symbols = parseSymbolsFromArgv(process.argv.slice(2), ["ORLY", "BKNG", "UNP"]);
  for (const symbol of symbols) {
    try {
      await runForSymbol(symbol);
    } catch (err) {
      console.error(`Error for ${symbol}:`, err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
