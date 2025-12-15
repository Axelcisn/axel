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
  label: string;
  initialEquity: number;
  leverage: number;
  positionFraction: number;
  threshold: number;
};

const BASE_CASE: SimCase = {
  label: "A-baseline",
  initialEquity: 5000,
  leverage: 5,
  positionFraction: 0.25,
  threshold: 0,
};

const VARIANT_CASE: SimCase = {
  label: "B-variant",
  initialEquity: 10000,
  leverage: 2,
  positionFraction: 0.1,
  threshold: 0,
};

const THRESHOLD_CASE: SimCase = {
  label: "C-threshold",
  initialEquity: 5000,
  leverage: 5,
  positionFraction: 0.25,
  threshold: 0.5,
};

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

function computeProfitFactor(trades: ReturnType<typeof simulateTrading212Cfd>["trades"]): number | null {
  const closed = trades.filter((t) => t.exitDate);
  if (closed.length === 0) return null;
  const grossProfit = closed.filter((t) => (t.netPnl ?? 0) > 0).reduce((a, t) => a + (t.netPnl ?? 0), 0);
  const grossLoss = Math.abs(closed.filter((t) => (t.netPnl ?? 0) < 0).reduce((a, t) => a + (t.netPnl ?? 0), 0));
  if (grossLoss === 0) return grossProfit > 0 ? Infinity : null;
  return grossProfit / grossLoss;
}

async function runForSymbol(symbol: string) {
  const { rows } = await ensureCanonicalOrHistory(symbol, { interval: "1d", minRows: 260 });
  const spec = await ensureDefaultTargetSpec(symbol, {});
  const horizon = spec.h ?? 1;
  const coverage = spec.coverage ?? 0.95;

  // Build biased EWMA walk
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

  const baseConfig: Trading212CfdConfig = {
    leverage: EWMA_LAMBDA, // placeholder, overridden per-case
    fxFeeRate: 0.005,
    dailyLongSwapRate: 0,
    dailyShortSwapRate: 0,
    spreadBps: SPREAD_BPS,
    marginCallLevel: 0.45,
    stopOutLevel: 0.25,
    positionFraction: 0.25, // overridden per-case
  };

  const cases = [BASE_CASE, VARIANT_CASE, THRESHOLD_CASE];

  console.log(`\n=== ${symbol} ===`);

  let baselineTradesSignature: string | null = null;

  for (const c of cases) {
    const bars = buildBarsFromEwmaPath(simRows, biasedWalk.points, horizon, c.threshold);
    const config: Trading212CfdConfig = {
      ...baseConfig,
      leverage: c.leverage,
      positionFraction: c.positionFraction,
    };
    const result = simulateTrading212Cfd(bars, c.initialEquity, config);
    const summary = summarizeTrading212Result(result);
    const profitFactor = computeProfitFactor(result.trades);
    const tradesSignature = `${result.trades.length}:${summary.trades}`;
    if (c.label === "A-baseline") {
      baselineTradesSignature = tradesSignature;
    }

    console.log(
      `${c.label.padEnd(11)} init=${c.initialEquity.toFixed(0)} lev=${c.leverage.toFixed(
        1
      )} pos%=${(c.positionFraction * 100).toFixed(1)} th=${c.threshold.toFixed(3)} ` +
        `final=${summary.finalEquity.toFixed(2)} returnPct=${(summary.returnPct * 100).toFixed(
          2
        )}% maxDD=${summary.maxDrawdownPct != null ? (summary.maxDrawdownPct * 100).toFixed(2) : "—"}% ` +
        `trades=${summary.trades} closed=${result.trades.length} pf=${profitFactor == null ? "—" : profitFactor === Infinity ? "∞" : profitFactor.toFixed(3)}`
    );

    if (c.label === "B-variant") {
      const scale = summary.finalEquity / c.initialEquity;
      console.log(
        `  note: finalEquity/initialEquity scale=${scale.toFixed(
          3
        )} (should be near baseline scale if only equity changes; leverage/pos% make it diverge).`
      );
    }

    if (c.label === "C-threshold" && baselineTradesSignature) {
      if (tradesSignature === baselineTradesSignature) {
        console.log("  biasThreshold appears not wired into the simulation signals (no trade count change).");
      } else {
        console.log("  biasThreshold affected signals/trades.");
      }
    }
  }
}

async function main() {
  const symbols = parseSymbolsFromArgv(process.argv.slice(2), ["NVDA", "AAPL"]);
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
