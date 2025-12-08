/**
 * EWMA Trend / Trend (Max) smoke test
 * - Synthetic trending vs range series
 * - Lightweight real-symbol run using naive biased signals
 */
import { buildIndicatorCache } from '@/lib/strategy/indicatorCache';
import { loadSimBars, type SimBar } from '@/lib/strategy/ohlcLoader';
import {
  runEwmaTrend,
  runEwmaTrendMax,
} from '@/lib/strategy/ewmaTrend';
import { Trading212Signal } from '@/lib/backtest/trading212Cfd';
import { classifyAdxTradingRegime, classifyMomentumDirection, classifyTrendDirection, type MomentumMode } from '@/lib/strategy/trendRules';

type TrendSmokeSummary = {
  longPct: number;
  shortPct: number;
  entries: number;
};

function makeUptrendBars(): SimBar[] {
  const bars: SimBar[] = [];
  let price = 100;
  for (let i = 0; i < 200; i++) {
    const date = `2025-01-${String(i + 1).padStart(2, '0')}`;
    price += 0.5; // steady climb
    bars.push({
      date,
      open: price - 0.2,
      high: price + 0.3,
      low: price - 0.5,
      close: price,
      volume: 1_000_000,
    });
  }
  return bars;
}

function makeFlatBars(): SimBar[] {
  const bars: SimBar[] = [];
  let price = 100;
  for (let i = 0; i < 200; i++) {
    const date = `2025-02-${String(i + 1).padStart(2, '0')}`;
    const noise = ((i % 5) - 2) * 0.02; // tiny wiggle
    price += noise;
    bars.push({
      date,
      open: price - 0.05,
      high: price + 0.1,
      low: price - 0.1,
      close: price,
      volume: 800_000,
    });
  }
  return bars;
}

function countSummary(signals: Trading212Signal[]): TrendSmokeSummary {
  let long = 0;
  let short = 0;
  let entries = 0;
  let prev: Trading212Signal | null = null;
  for (const s of signals) {
    if (s === 'long') long++;
    else if (s === 'short') short++;
    if (prev !== s) {
      entries++;
      prev = s;
    }
  }
  return {
    longPct: signals.length ? (long / signals.length) * 100 : 0,
    shortPct: signals.length ? (short / signals.length) * 100 : 0,
    entries,
  };
}

function logTrendFilters(bars: SimBar[], indicators: ReturnType<typeof buildIndicatorCache>, mode: MomentumMode, label: string) {
  const fast = new Map(indicators.fastEwma.map((p) => [p.date, p.value]));
  const slow = new Map(indicators.slowEwma.map((p) => [p.date, p.value]));
  const adxMap = new Map(indicators.adxPoints.map((p) => [p.date, p.adx]));
  const rocMap = new Map(indicators.momentumPoints.map((p) => [p.date, p.momentumPct]));
  const rsiMap = new Map(indicators.rsiPoints.map((p) => [p.date, p.rsi]));
  const macdLineMap = new Map(indicators.macdPoints.map((p) => [p.date, p.macdLine]));
  const macdSignalMap = new Map(indicators.macdPoints.map((p) => [p.date, p.signal]));

  let trendUp = 0;
  let adxTrending = 0;
  let momBull = 0;

  for (const bar of bars) {
    const trend = classifyTrendDirection(fast.get(bar.date), slow.get(bar.date), bar.close);
    const adxRegime = classifyAdxTradingRegime(adxMap.get(bar.date));
    const momDir = classifyMomentumDirection(
      mode,
      rocMap.get(bar.date),
      rsiMap.get(bar.date),
      macdLineMap.get(bar.date),
      macdSignalMap.get(bar.date)
    );
    if (trend === 'UP') trendUp++;
    if (adxRegime === 'TRENDING') adxTrending++;
    if (momDir === 'BULL') momBull++;
  }

  const n = bars.length || 1;
  console.log(`[Filters:${label}] TrendUP ${(trendUp / n * 100).toFixed(1)}% | ADX TRENDING ${(adxTrending / n * 100).toFixed(1)}% | MOM BULL ${(momBull / n * 100).toFixed(1)}%`);
}

async function testSynthetic(): Promise<boolean> {
  console.log("\n[Synthetic] Building synthetic uptrend and flat series...");
  const upBars = makeUptrendBars();
  const flatBars = makeFlatBars();

  const upIndicators = buildIndicatorCache({
    bars: upBars,
    fastWindow: 14,
    slowWindow: 50,
    momentumPeriod: 10,
  });
  const flatIndicators = buildIndicatorCache({
    bars: flatBars,
    fastWindow: 14,
    slowWindow: 50,
    momentumPeriod: 10,
  });

  const biasedSignals = new Array<Trading212Signal>(upBars.length).fill('long');

  const upResult = runEwmaTrend(upBars, upIndicators, biasedSignals, {
    symbol: 'SYN_UP',
    momentumMode: 'roc',
    fastWindow: 14,
    slowWindow: 50,
    momentumPeriod: 10,
  });
  // Smoke run for Trend (Max) on same data
  runEwmaTrendMax(upBars, upIndicators, biasedSignals, {
    symbol: 'SYN_UP',
    momentumMode: 'roc',
    fastWindow: 14,
    slowWindow: 50,
    momentumPeriod: 10,
  });

  const flatResult = runEwmaTrend(flatBars, flatIndicators, biasedSignals, {
    symbol: 'SYN_FLAT',
    momentumMode: 'roc',
    fastWindow: 14,
    slowWindow: 50,
    momentumPeriod: 10,
  });

  const upSummary = countSummary(upResult.signals);
  const flatSummary = countSummary(flatResult.signals);

  logTrendFilters(upBars, upIndicators, 'roc', 'Up');
  logTrendFilters(flatBars, flatIndicators, 'roc', 'Flat');

  console.log(`[Synthetic] Uptrend: ${upSummary.longPct.toFixed(1)}% long, entries=${upSummary.entries}`);
  console.log(`[Synthetic] Flat: ${flatSummary.longPct.toFixed(1)}% long, entries=${flatSummary.entries}`);

  const upOk = upSummary.longPct > 60;
  const flatOk = flatSummary.longPct < 20;
  if (!upOk || !flatOk) {
    console.warn(`[Synthetic] Warning: expected strong separation (upOk=${upOk}, flatOk=${flatOk})`);
  }
  return upOk && flatOk;
}

async function testRealSymbol(symbol: string): Promise<void> {
  console.log(`\n[Real] Loading ${symbol}...`);
  const bars = await loadSimBars(symbol);
  const indicators = buildIndicatorCache({
    bars,
    fastWindow: 14,
    slowWindow: 50,
    momentumPeriod: 10,
  });

  const fastMap = new Map(indicators.fastEwma.map((p) => [p.date, p.value]));
  const slowMap = new Map(indicators.slowEwma.map((p) => [p.date, p.value]));

  const biasedSignals: Trading212Signal[] = bars.map((bar) => {
    const fast = fastMap.get(bar.date);
    const slow = slowMap.get(bar.date);
    if (fast == null || slow == null || !Number.isFinite(fast) || !Number.isFinite(slow)) {
      return 'flat';
    }
    return fast > slow ? 'long' : 'short';
  });

  const trend = runEwmaTrend(bars, indicators, biasedSignals, {
    symbol,
    momentumMode: 'roc',
    fastWindow: 14,
    slowWindow: 50,
    momentumPeriod: 10,
  });
  const trendMax = runEwmaTrendMax(bars, indicators, biasedSignals, {
    symbol,
    momentumMode: 'roc',
    fastWindow: 14,
    slowWindow: 50,
    momentumPeriod: 10,
  });

  const naiveSummary = countSummary(biasedSignals);
  const trendSummary = countSummary(trend.signals);
  const trendMaxSummary = countSummary(trendMax.signals);

  console.log(
    `[${symbol}] naive longs=${naiveSummary.longPct.toFixed(1)}% shorts=${naiveSummary.shortPct.toFixed(1)}% entries=${naiveSummary.entries}`
  );
  console.log(
    `[${symbol}] trend longs=${trendSummary.longPct.toFixed(1)}% shorts=${trendSummary.shortPct.toFixed(1)}% entries=${trendSummary.entries}`
  );
  console.log(
    `[${symbol}] trendMax longs=${trendMaxSummary.longPct.toFixed(1)}% shorts=${trendMaxSummary.shortPct.toFixed(1)}% entries=${trendMaxSummary.entries}`
  );
}

async function main() {
  const symbol = process.argv[2] || 'TSLA';

  const syntheticOk = await testSynthetic();
  await testRealSymbol(symbol);

  const allOk = syntheticOk;
  console.log(`[RESULT] EWMA Trend smoke: ${allOk ? 'PASS' : 'FAIL'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
