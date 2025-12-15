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

type SimCase = {
  label: "A" | "B" | "C" | "D";
  initialEquity: number;
  leverage: number;
  positionFraction: number;
  thresholdPct: number;
  note?: string;
};

const CASES: SimCase[] = [
  { label: "A", initialEquity: 5000, leverage: 5, positionFraction: 0.25, thresholdPct: 0 },
  { label: "B", initialEquity: 10000, leverage: 5, positionFraction: 0.25, thresholdPct: 0, note: "capital scaling only" },
  { label: "C", initialEquity: 5000, leverage: 2, positionFraction: 0.1, thresholdPct: 0, note: "risk settings change" },
  { label: "D", initialEquity: 5000, leverage: 5, positionFraction: 0.25, thresholdPct: 0.5, note: "threshold change" },
];

const EWMA_LAMBDA = 0.94;
const TRAIN_FRACTION = 0.7;
const SPREAD_BPS = 5;

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
): Trading212SimBar[] {
  const ewmaMap = new Map<string, { S_t: number; y_hat_tp1: number }>();
  path.forEach((p) => ewmaMap.set(p.date_tp1, { S_t: p.S_t, y_hat_tp1: p.y_hat_tp1 }));

  const bars: Trading212SimBar[] = [];
  for (const row of rows) {
    const price = row.adj_close ?? row.close;
    const date = normalizeDateString(row.date);
    if (!date || !price) continue;
    const ewma = ewmaMap.get(date);
    if (!ewma) continue;

    const diffPct = (ewma.y_hat_tp1 - ewma.S_t) / ewma.S_t;
    let signal: Trading212Signal = "flat";
    if (diffPct > thresholdPct) signal = "long";
    else if (diffPct < -thresholdPct) signal = "short";

    bars.push({ date, price, signal });
  }
  return bars;
}

function formatPct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
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

  console.log(`\n=== ${symbol} ===`);

  const results: Record<SimCase["label"], { trades: number; returnPct: number; finalEquity: number; maxDrawdownPct: number | null; closedTrades: number; profitFactor: number | null }> = {} as any;

  for (const c of CASES) {
    const bars = buildBarsFromEwmaPath(simRows, biasedWalk.points, horizon, c.thresholdPct);
    const config: Trading212CfdConfig = {
      leverage: c.leverage,
      fxFeeRate: 0.005,
      dailyLongSwapRate: 0,
      dailyShortSwapRate: 0,
      spreadBps: SPREAD_BPS,
      marginCallLevel: 0.45,
      stopOutLevel: 0.25,
      positionFraction: c.positionFraction,
    };
    const sim = simulateTrading212Cfd(bars, c.initialEquity, config);
    const summary = summarizeTrading212Result(sim);
    const pf = (() => {
      const closed = sim.trades.filter((t) => t.exitDate);
      if (closed.length === 0) return null;
      const grossProfit = closed.filter((t) => (t.netPnl ?? 0) > 0).reduce((a, t) => a + (t.netPnl ?? 0), 0);
      const grossLoss = Math.abs(closed.filter((t) => (t.netPnl ?? 0) < 0).reduce((a, t) => a + (t.netPnl ?? 0), 0));
      if (grossLoss === 0) return grossProfit > 0 ? Infinity : null;
      return grossProfit / grossLoss;
    })();

    results[c.label] = {
      trades: summary.trades,
      returnPct: summary.returnPct,
      finalEquity: summary.finalEquity,
      maxDrawdownPct: summary.maxDrawdownPct,
      closedTrades: sim.trades.length,
      profitFactor: pf,
    };

    console.log(
      `${c.label}: init=${c.initialEquity.toFixed(0)} lev=${c.leverage.toFixed(1)} pos=${(c.positionFraction * 100).toFixed(1)}% th=${c.thresholdPct.toFixed(
        3
      )} final=${summary.finalEquity.toFixed(2)} return=${formatPct(summary.returnPct)} maxDD=${formatPct(summary.maxDrawdownPct)} trades=${summary.trades} closed=${sim.trades.length} pf=${formatPf(
        pf
      )}${c.note ? ` (${c.note})` : ""}`
    );
  }

  // Checks/warnings
  const A = results["A"];
  const B = results["B"];
  const C = results["C"];
  const D = results["D"];

  if (A && B) {
    const pctDiff = Math.abs((B.returnPct - A.returnPct) * 100);
    const ratio = B.finalEquity / A.finalEquity;
    if (pctDiff > 0.5) {
      console.warn(`WARN [${symbol}] Case B returnPct differs from A by ${pctDiff.toFixed(2)}% (expected ~same).`);
    }
    if (ratio < 1.9 || ratio > 2.1) {
      console.warn(`WARN [${symbol}] Case B finalEquity ratio=${ratio.toFixed(3)} (expected ~2x).`);
    }
    if (B.trades !== A.trades) {
      console.warn(`WARN [${symbol}] Case B trades differ from A (A=${A.trades}, B=${B.trades}).`);
    }
  }

  if (A && C) {
    if (C.trades !== A.trades) {
      console.warn(`WARN [${symbol}] Case C trades differ from A (expected same signals). A=${A.trades} C=${C.trades}`);
    }
  }

  if (A && D) {
    if (D.trades === A.trades) {
      console.warn(`WARN [${symbol}] Case D trades match A (threshold may not affect signals for this symbol).`);
    }
  }
}

async function main() {
  const symbols = parseSymbolsFromArgv(process.argv.slice(2), ["NVDA", "AAPL", "TSLA"]);
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
