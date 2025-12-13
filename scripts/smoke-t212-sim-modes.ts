import { ensureCanonicalOrHistory } from '@/lib/storage/canonical';
import { ensureDefaultTargetSpec } from '@/lib/targets/defaultSpec';
import {
  buildEwmaReactionMap,
  buildEwmaTiltConfigFromReactionMap,
  defaultReactionConfig,
} from '@/lib/volatility/ewmaReaction';
import {
  EwmaWalkerPoint,
  runEwmaWalker,
  summarizeEwmaWalkerResults,
} from '@/lib/volatility/ewmaWalker';
import {
  simulateTrading212Cfd,
  Trading212CfdConfig,
  Trading212Signal,
  Trading212SimBar,
} from '@/lib/backtest/trading212Cfd';
import { CanonicalRow } from '@/lib/types/canonical';

const DEFAULT_SYMBOLS = ['CRM', 'NKE', 'ORCL', 'ABNB', 'TSM'] as const;

type SymbolInput = string | typeof DEFAULT_SYMBOLS[number];

type EwmaRunBundle = {
  walk: { points: EwmaWalkerPoint[] };
  reactionMapTestStart: string | null;
};

function parseSymbols(argv: string[]): SymbolInput[] {
  return argv.length ? argv : [...DEFAULT_SYMBOLS];
}

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
    let signal: Trading212Signal = 'flat';
    if (diffPct > thresholdPct) signal = 'long';
    else if (diffPct < -thresholdPct) signal = 'short';

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
  shrinkFactor: number
): Promise<EwmaRunBundle> {
  const reactionConfig = {
    ...defaultReactionConfig,
    lambda,
    coverage,
    trainFraction,
    horizons: [horizon],
  };
  const reactionMap = await buildEwmaReactionMap(symbol, reactionConfig);
  const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor, horizon });
  const walk = await runEwmaWalker({ symbol, lambda, coverage, horizon, tiltConfig });
  return { walk, reactionMapTestStart: reactionMap.meta.testStart ?? null };
}

async function optimizeBiasedConfig(
  symbol: string,
  coverage: number,
  horizon: number,
  shrinkFactor: number
): Promise<{ lambda: number; trainFraction: number }> {
  const lambdaGrid = Array.from({ length: 11 }, (_, i) => 0.5 + i * 0.05); // 0.50..1.00 (inclusive-ish)
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
        const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor, horizon });
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
    : { lambda: 0.94, trainFraction: 0.7 };
}

function countEntriesFromHistory(
  history: ReturnType<typeof simulateTrading212Cfd>['accountHistory']
): number {
  let entries = 0;
  let prevSide: string | null = null;
  for (const h of history) {
    const side = h.side;
    if (side && (!prevSide || side !== prevSide)) {
      entries++;
    }
    prevSide = side;
  }
  return entries;
}

function summarizeSim(result: ReturnType<typeof simulateTrading212Cfd>) {
  const ret = (result.finalEquity - result.initialEquity) / result.initialEquity;
  const wins = result.trades.filter((t) => t.netPnl > 0).length;
  const closedTrades = result.trades.length;
  const openedTrades = countEntriesFromHistory(result.accountHistory);
  const trades = Math.max(closedTrades, openedTrades);
  const winRate = closedTrades ? wins / closedTrades : 0;
  return {
    returnPct: ret,
    maxDrawdown: result.maxDrawdown,
    trades,
    winRate,
  };
}

async function runForSymbol(symbol: SymbolInput) {
  console.log(`\n=== ${symbol} ===`);
  const { rows, meta } = await ensureCanonicalOrHistory(symbol, { minRows: 260, interval: '1d' });
  console.log(`Rows: ${rows.length}, tz: ${meta.exchange_tz}`);

  const spec = await ensureDefaultTargetSpec(symbol, {});
  const horizon = spec.h ?? 1;
  const coverage = spec.coverage ?? 0.95;
  const lambdaBase = 0.94;
  const trainFractionBase = 0.7;
  const shrinkFactor = 0.5;
  const thresholdPct = 0;
  const initialEquity = 5000;

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

  // Unbiased walk
  const neutralWalk = await runEwmaWalker({ symbol, lambda: lambdaBase, coverage, horizon });
  const unbiasedBars = buildBarsFromEwmaPath(rows, neutralWalk.points, horizon, thresholdPct);
  const unbiasedSim = simulateTrading212Cfd(unbiasedBars, initialEquity, cfdConfig);
  const unbiasedSummary = summarizeSim(unbiasedSim);

  // Biased walk (base)
  const biased = await runBiasedWalk(
    symbol,
    lambdaBase,
    trainFractionBase,
    coverage,
    horizon,
    shrinkFactor
  );
  const biasedRows = filterRowsForSim(rows, biased.reactionMapTestStart);
  const biasedBars = buildBarsFromEwmaPath(biasedRows, biased.walk.points, horizon, thresholdPct);
  const biasedSim = simulateTrading212Cfd(biasedBars, initialEquity, cfdConfig);
  const biasedSummary = summarizeSim(biasedSim);
  if (biasedSummary.trades === 0 && Math.abs(biasedSummary.returnPct) > 1e-6) {
    console.warn(
      `[SANITY] ${symbol} biased: non-zero return with zero trades; check bars/run wiring (bars=${biasedBars.length})`
    );
  }

  // Biased (Max)
  const best = await optimizeBiasedConfig(symbol, coverage, horizon, shrinkFactor);
  const biasedMax = await runBiasedWalk(
    symbol,
    best.lambda,
    best.trainFraction,
    coverage,
    horizon,
    shrinkFactor
  );
  const biasedMaxRows = filterRowsForSim(rows, biasedMax.reactionMapTestStart);
  const biasedMaxBars = buildBarsFromEwmaPath(
    biasedMaxRows,
    biasedMax.walk.points,
    horizon,
    thresholdPct
  );
  const biasedMaxSim = simulateTrading212Cfd(biasedMaxBars, initialEquity, cfdConfig);
  const biasedMaxSummary = summarizeSim(biasedMaxSim);
  if (biasedMaxSummary.trades === 0 && Math.abs(biasedMaxSummary.returnPct) > 1e-6) {
    console.warn(
      `[SANITY] ${symbol} biased-max: non-zero return with zero trades; check bars/run wiring (bars=${biasedMaxBars.length})`
    );
  }

  const formatPct = (v: number) => `${(v * 100).toFixed(2)}%`;

  console.log({
    mode: 'unbiased',
    returnPct: formatPct(unbiasedSummary.returnPct),
    maxDrawdownPct: formatPct(unbiasedSummary.maxDrawdown),
    trades: unbiasedSummary.trades,
    winRate: formatPct(unbiasedSummary.winRate),
  });

  console.log({
    mode: 'biased',
    lambda: lambdaBase,
    trainFraction: trainFractionBase,
    returnPct: formatPct(biasedSummary.returnPct),
    maxDrawdownPct: formatPct(biasedSummary.maxDrawdown),
    trades: biasedSummary.trades,
    winRate: formatPct(biasedSummary.winRate),
  });

  console.log({
    mode: 'biased-max',
    lambda: best.lambda,
    trainFraction: best.trainFraction,
    returnPct: formatPct(biasedMaxSummary.returnPct),
    maxDrawdownPct: formatPct(biasedMaxSummary.maxDrawdown),
    trades: biasedMaxSummary.trades,
    winRate: formatPct(biasedMaxSummary.winRate),
  });
}

async function main() {
  const symbols = parseSymbols(process.argv.slice(2));
  for (const s of symbols) {
    try {
      await runForSymbol(s);
    } catch (err) {
      console.error(`Error for ${s}:`, err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
