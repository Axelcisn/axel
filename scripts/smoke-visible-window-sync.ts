import { ensureCanonicalOrHistory } from "@/lib/storage/canonical";
import { ensureDefaultTargetSpec } from "@/lib/targets/defaultSpec";
import {
  buildEwmaReactionMap,
  buildEwmaTiltConfigFromReactionMap,
  defaultReactionConfig,
} from "@/lib/volatility/ewmaReaction";
import { runEwmaWalker, EwmaWalkerPoint } from "@/lib/volatility/ewmaWalker";
import {
  simulateTrading212Cfd,
  Trading212CfdConfig,
  Trading212Signal,
  Trading212SimBar,
} from "@/lib/backtest/trading212Cfd";
import { CanonicalRow } from "@/lib/types/canonical";
import { parseSymbolsFromArgv } from "./_utils/cli";

const DEFAULT_SYMBOLS = ["AAPL", "NVDA"] as const;

type SymbolInput = string | (typeof DEFAULT_SYMBOLS)[number];

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
  thresholdPct: number
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
    if (diffPct > thresholdPct) signal = "long";
    else if (diffPct < -thresholdPct) signal = "short";

    bars.push({ date: row.date, price, signal });
  }
  return bars;
}

async function runBiasedWalk(
  symbol: string,
  horizon: number,
  coverage: number
): Promise<EwmaRunBundle> {
  const reactionConfig = {
    ...defaultReactionConfig,
    lambda: 0.94,
    coverage,
    trainFraction: 0.7,
    horizons: [horizon],
  };
  const reactionMap = await buildEwmaReactionMap(symbol, reactionConfig);
  const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor: 0.5, horizon });
  const walk = await runEwmaWalker({
    symbol,
    lambda: reactionConfig.lambda,
    coverage: reactionConfig.coverage,
    horizon,
    tiltConfig,
  });
  return { walk, reactionMapTestStart: reactionMap.meta.testStart ?? null };
}

function assertStrictlyIncreasing(dates: string[], symbol: string) {
  for (let i = 1; i < dates.length; i++) {
    if (dates[i] <= dates[i - 1]) {
      throw new Error(`[${symbol}] syncedDates not strictly increasing at index ${i}: ${dates[i - 1]} -> ${dates[i]}`);
    }
  }
}

function normalizeRows(rows: CanonicalRow[]): CanonicalRow[] {
  return [...rows]
    .filter((r) => !!r.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((row, idx, arr) => idx === 0 || row.date !== arr[idx - 1]?.date);
}

async function runForSymbol(symbol: SymbolInput) {
  const tick = String(symbol);
  const { rows, meta } = await ensureCanonicalOrHistory(tick, { minRows: 30, interval: "1d" });
  const sortedRows = normalizeRows(rows);
  if (sortedRows.length === 0) {
    throw new Error(`[${tick}] no canonical rows available`);
  }

  const windowRows = sortedRows.slice(-7);
  const syncedDates = windowRows.map((r) => r.date);
  const window = {
    start: syncedDates[0],
    end: syncedDates[syncedDates.length - 1],
  };

  assertStrictlyIncreasing(syncedDates, tick);

  const spec = await ensureDefaultTargetSpec(tick, {});
  const horizon = spec.h ?? 1;
  const coverage = spec.coverage ?? 0.95;
  const run = await runBiasedWalk(tick, horizon, coverage);
  const rowsForSim = filterRowsForSim(sortedRows, run.reactionMapTestStart);

  const bars = buildBarsFromEwmaPath(rowsForSim, run.walk.points, horizon, 0);
  const cfdConfig: Trading212CfdConfig = {
    leverage: 5,
    fxFeeRate: 0.005,
    dailyLongSwapRate: 0,
    dailyShortSwapRate: 0,
    spreadBps: 5,
    marginCallLevel: 0.45,
    stopOutLevel: 0.25,
    positionFraction: 0.25,
  };
  const sim = simulateTrading212Cfd(bars, 5000, cfdConfig);
  const simSlice = sim.accountHistory.filter(
    (snap) => snap.date >= window.start && snap.date <= window.end
  );
  const equityMap = new Map<string, number>();
  simSlice.forEach((snap) => {
    if (snap.date && typeof snap.equity === "number" && Number.isFinite(snap.equity)) {
      equityMap.set(snap.date, snap.equity);
    }
  });
  const alignedEquity = syncedDates.map((date) => ({
    date,
    equity: equityMap.get(date) ?? null,
  }));

  if (alignedEquity.length !== syncedDates.length) {
    throw new Error(`[${tick}] aligned equity length mismatch (${alignedEquity.length} vs ${syncedDates.length})`);
  }
  if (syncedDates[0] !== window.start || syncedDates[syncedDates.length - 1] !== window.end) {
    throw new Error(`[${tick}] window mismatch ${window.start} -> ${window.end} vs synced ${syncedDates[0]} -> ${syncedDates[syncedDates.length - 1]}`);
  }

  console.log({
    symbol: tick,
    tz: meta.exchange_tz,
    priceRows: sortedRows.length,
    syncedLen: syncedDates.length,
    simSliceLen: simSlice.length,
    firstDate: window.start,
    lastDate: window.end,
  });
}

async function main() {
  const symbols = parseSymbolsFromArgv(process.argv.slice(2), [...DEFAULT_SYMBOLS]);
  for (const symbol of symbols) {
    await runForSymbol(symbol);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
