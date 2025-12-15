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
  Trading212SimBar,
  Trading212Signal,
} from "@/lib/backtest/trading212Cfd";
import { CanonicalRow } from "@/lib/types/canonical";
import { parseSymbolsFromArgv } from "./_utils/cli";

type Mode = "unbiased" | "biased" | "biased-max";

const EWMA_LAMBDA = 0.94;
const TRAIN_FRACTION = 0.7;

const CONFIG: Trading212CfdConfig = {
  leverage: 5,
  fxFeeRate: 0.005,
  dailyLongSwapRate: 0,
  dailyShortSwapRate: 0,
  spreadBps: 5,
  marginCallLevel: 0.45,
  stopOutLevel: 0.25,
  positionFraction: 0.25,
};

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
  horizon: number
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
    if (diffPct > 0) signal = "long";
    else if (diffPct < 0) signal = "short";

    bars.push({ date, price, signal });
  }

  return bars;
}

function countEntriesBySide(
  history: ReturnType<typeof simulateTrading212Cfd>["accountHistory"]
): { longEntries: number; shortEntries: number } {
  let prev: "long" | "short" | null = null;
  let longEntries = 0;
  let shortEntries = 0;

  for (let i = 0; i < history.length; i++) {
    const side = history[i].side ?? null;
    if (i === 0 && side) {
      if (side === "long") longEntries++;
      if (side === "short") shortEntries++;
      prev = side;
      continue;
    }
    if (side && side !== prev) {
      if (side === "long") longEntries++;
      if (side === "short") shortEntries++;
    }
    prev = side;
  }

  return { longEntries, shortEntries };
}

async function runMode(
  symbol: string,
  mode: Mode,
  rows: CanonicalRow[],
  horizon: number,
  coverage: number
) {
  const reactionConfig = {
    ...defaultReactionConfig,
    lambda: EWMA_LAMBDA,
    coverage,
    trainFraction: TRAIN_FRACTION,
    horizons: [horizon],
  };

  if (mode === "unbiased") {
    const reactionMap = await buildEwmaReactionMap(symbol, reactionConfig);
    const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor: 0.5, horizon });
    const walk = await runEwmaWalker({ symbol, lambda: EWMA_LAMBDA, coverage, horizon, tiltConfig });
    const startDate = (reactionMap as any).meta?.testStart ?? null;
    const simRows = filterRowsForSim(rows, startDate);
    const bars = buildBarsFromEwmaPath(simRows, walk.points, horizon);
    return simulateTrading212Cfd(bars, 5000, CONFIG);
  }

  // Biased / Biased Max
  const reactionMap = await buildEwmaReactionMap(symbol, reactionConfig);
  let lambda = EWMA_LAMBDA;
  let trainFraction = TRAIN_FRACTION;

  if (mode === "biased-max") {
    // crude optimization: pick best hit-rate lambda/train (reuse summarize helper from ewmaWalker)
    const lambdaGrid = Array.from({ length: 11 }, (_, i) => 0.5 + i * 0.05);
    const trainGrid = Array.from({ length: 9 }, (_, i) => 0.5 + i * 0.05);
    let best: { lambda: number; trainFraction: number; hit: number } | null = null;
    for (const l of lambdaGrid) {
      for (const tf of trainGrid) {
        try {
          const rc = { ...reactionConfig, lambda: l, trainFraction: tf };
          const rm = await buildEwmaReactionMap(symbol, rc);
          const walk = await runEwmaWalker({ symbol, lambda: l, coverage, horizon, tiltConfig: buildEwmaTiltConfigFromReactionMap(rm, { shrinkFactor: 0.5, horizon }) });
          const hit = (walk as any).meta?.directionHitRate ?? 0;
          if (!best || hit > best.hit) {
            best = { lambda: l, trainFraction: tf, hit };
          }
        } catch {
          continue;
        }
      }
    }
    if (best) {
      lambda = best.lambda;
      trainFraction = best.trainFraction;
    }
  }

  const reactionConfigBiased = { ...reactionConfig, lambda, trainFraction };
  const reactionMapBiased = await buildEwmaReactionMap(symbol, reactionConfigBiased);
  const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMapBiased, { shrinkFactor: 0.5, horizon });
  const walk = await runEwmaWalker({ symbol, lambda, coverage, horizon, tiltConfig });
  const startDate = (reactionMapBiased as any).meta?.testStart ?? null;
  const simRows = filterRowsForSim(rows, startDate);
  const bars = buildBarsFromEwmaPath(simRows, walk.points, horizon);
  return simulateTrading212Cfd(bars, 5000, CONFIG);
}

async function runForSymbol(symbol: string) {
  const { rows } = await ensureCanonicalOrHistory(symbol, { interval: "1d", minRows: 260 });
  const spec = await ensureDefaultTargetSpec(symbol, {});
  const horizon = spec.h ?? 1;
  const coverage = spec.coverage ?? 0.95;

  const modes: Mode[] = ["unbiased", "biased", "biased-max"];
  console.log(`\n=== ${symbol} ===`);

  for (const mode of modes) {
    const sim = await runMode(symbol, mode, rows, horizon, coverage);
    const { longEntries, shortEntries } = countEntriesBySide(sim.accountHistory);
    const closedLong = sim.trades.filter((t) => t.side === "long" && t.exitDate).length;
    const closedShort = sim.trades.filter((t) => t.side === "short" && t.exitDate).length;
    console.log(
      `${mode.padEnd(11)} longEntries=${longEntries} shortEntries=${shortEntries} closedLong=${closedLong} closedShort=${closedShort}`
    );
    if (mode !== "unbiased" && longEntries > 0 && shortEntries === 0) {
      console.warn(`WARN [${symbol} ${mode}] no short entries detected.`);
    }
  }
}

async function main() {
  const symbols = parseSymbolsFromArgv(process.argv.slice(2), ["INTU", "NOW", "ISRG", "GILD", "TMO"]);
  for (const symbol of symbols) {
    await runForSymbol(symbol);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
