import { ensureCanonicalOrHistory } from '@/lib/storage/canonical';
import { ensureDefaultTargetSpec } from '@/lib/targets/defaultSpec';
import {
  buildEwmaReactionMap,
  buildEwmaTiltConfigFromReactionMap,
  defaultReactionConfig,
} from '@/lib/volatility/ewmaReaction';
import { runEwmaWalker } from '@/lib/volatility/ewmaWalker';
import {
  simulateTrading212Cfd,
  Trading212CfdConfig,
  Trading212Signal,
  Trading212SimBar,
} from '@/lib/backtest/trading212Cfd';
import { CanonicalRow } from '@/lib/types/canonical';
import { parseSymbolsFromArgv } from './_utils/cli';
import { summarizeTrading212Result } from './_utils/t212Summary';

type Window = { start: string; end: string };

const DEFAULT_SYMBOLS = ['AAPL', 'NVDA'] as const;
type SymbolInput = string | typeof DEFAULT_SYMBOLS[number];

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

function sliceHistoryToWindow(history: ReturnType<typeof simulateTrading212Cfd>['accountHistory'], window: Window) {
  if (!history || history.length === 0) {
    return { slice: [] as typeof history, startIdx: -1, endIdx: -1, prevSideBefore: null as string | null };
  }
  const startIdx = history.findIndex((h) => h.date >= window.start);
  if (startIdx === -1) {
    return { slice: [] as typeof history, startIdx: -1, endIdx: -1, prevSideBefore: null as string | null };
  }
  let endIdx = history.length - 1;
  for (let i = history.length - 1; i >= startIdx; i--) {
    if (history[i].date <= window.end) {
      endIdx = i;
      break;
    }
  }
  if (endIdx < startIdx) {
    return { slice: [] as typeof history, startIdx: -1, endIdx: -1, prevSideBefore: null as string | null };
  }
  const prevSideBefore = startIdx > 0 ? history[startIdx - 1]?.side ?? null : null;
  return { slice: history.slice(startIdx, endIdx + 1), startIdx, endIdx, prevSideBefore };
}

function summarizeWindow(
  result: ReturnType<typeof simulateTrading212Cfd>,
  window: Window
) {
  const { slice, startIdx, prevSideBefore } = sliceHistoryToWindow(result.accountHistory, window);
  if (slice.length === 0) {
    return {
      window,
      days: 0,
      returnPct: 0,
      maxDrawdownPct: 0,
      trades: 0,
    };
  }

  const firstEquity = slice[0].equity ?? 0;
  const lastEquity = slice[slice.length - 1].equity ?? firstEquity;
  const returnPct = firstEquity > 0 ? ((lastEquity / firstEquity) - 1) * 100 : 0;

  let peak = slice[0].equity ?? 0;
  let maxDd = 0;
  for (const pt of slice) {
    const eq = pt.equity ?? peak;
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? (peak - eq) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }

  let openedTrades = 0;
  let prevSide: string | null = prevSideBefore;
  for (const snap of slice) {
    const side = snap.side ?? null;
    if (side && side !== prevSide) openedTrades++;
    prevSide = side;
  }

  const closedTrades = result.trades.filter((t) => {
    const d = t.exitDate ?? t.entryDate ?? "";
    return d >= window.start && d <= window.end;
  }).length;

  return {
    window,
    days: slice.length,
    returnPct,
    maxDrawdownPct: maxDd * 100,
    trades: Math.max(closedTrades, openedTrades),
    firstDate: slice[0].date,
    lastDate: slice[slice.length - 1].date,
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

  const reactionConfig = {
    ...defaultReactionConfig,
    lambda: lambdaBase,
    coverage,
    trainFraction: trainFractionBase,
    horizons: [horizon],
  };
  const reactionMap = await buildEwmaReactionMap(symbol, reactionConfig);
  const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor, horizon });
  const walk = await runEwmaWalker({ symbol, lambda: lambdaBase, coverage, horizon, tiltConfig });

  const testStart = reactionMap.meta.testStart ?? null;
  const filteredRows = testStart ? rows.filter((r) => r.date >= testStart) : rows;
  const bars = buildBarsFromEwmaPath(filteredRows, walk.points, horizon, thresholdPct);
  const simResult = simulateTrading212Cfd(bars, initialEquity, cfdConfig);
  const fullSummary = summarizeTrading212Result(simResult);

  const history = simResult.accountHistory;
  if (!history || history.length === 0) {
    console.warn(`[${symbol}] Empty account history; skipping window checks.`);
    return;
  }
  const fullWindow: Window = { start: history[0].date, end: history[history.length - 1].date };
  const last7Window: Window = { start: history[Math.max(0, history.length - 7)].date, end: fullWindow.end };
  const last30Window: Window = { start: history[Math.max(0, history.length - 30)].date, end: fullWindow.end };
  const last5Window: Window = { start: history[Math.max(0, history.length - 5)].date, end: fullWindow.end };

  const views = [
    { label: 'full', summary: summarizeWindow(simResult, fullWindow) },
    { label: 'last7', summary: summarizeWindow(simResult, last7Window) },
    { label: 'last30', summary: summarizeWindow(simResult, last30Window) },
    { label: 'last5', summary: summarizeWindow(simResult, last5Window) },
  ];

  for (const v of views) {
    const s = v.summary;
    console.log(`${symbol.padEnd(5)} ${v.label.padEnd(6)} ${s.firstDate ?? '—'} → ${s.lastDate ?? '—'} | days=${s.days} | ret=${s.returnPct.toFixed(2)}% | dd=${s.maxDrawdownPct.toFixed(2)}% | trades=${s.trades}`);
  }

  // Sanity warnings
  const s7 = views.find((v) => v.label === 'last7')?.summary;
  const s30 = views.find((v) => v.label === 'last30')?.summary;
  const sfull = views.find((v) => v.label === 'full')?.summary;
  if (s7) {
    if (s7.days > 8 || s7.days <= 1) {
      console.warn(`[WARN] ${symbol} last7 has suspicious day count: ${s7.days}`);
    }
  }
  if (s30 && s7 && s30.days <= s7.days) {
    console.warn(`[WARN] ${symbol} last30 days (${s30.days}) <= last7 days (${s7.days})`);
  }
  if (sfull && s30 && sfull.days <= s30.days) {
    console.warn(`[WARN] ${symbol} full days (${sfull.days}) <= last30 days (${s30.days})`);
  }

  console.log(`[${symbol}] full return ${fullSummary.returnPct.toFixed(2)}%, trades=${fullSummary.trades}`);
}

async function main() {
  const symbols = parseSymbolsFromArgv(process.argv.slice(2), [...DEFAULT_SYMBOLS]);
  for (const s of symbols) {
    await runForSymbol(s);
  }
}

main().catch((err) => {
  console.error('Error in smoke-t212-windowed-view', err);
  process.exit(1);
});
