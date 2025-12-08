import type { Trading212Signal, Trading212Trade } from '@/lib/backtest/trading212Cfd';
import type { IndicatorCache } from './indicatorCache';
import type { SimBar } from './ohlcLoader';
import {
  classifyTrendDirection,
  classifyAdxTradingRegime,
  classifyMomentumDirection,
  canEnterLong,
  canEnterShort,
  shouldExitLong,
  shouldExitShort,
  type MomentumMode,
  type TrendFilterInputs,
} from './trendRules';

export interface StrategyContext {
  bars: SimBar[];
  indicators: IndicatorCache;
}

export interface StrategyStats {
  returnPct?: number;
  maxDrawdown?: number;
  tradeCount?: number;
  stopOutEvents?: number;
}

export interface StrategyResult {
  positions: number[];
  signals: Trading212Signal[];
  trades?: Trading212Trade[];
  stats?: StrategyStats;
}

export interface EwmaTrendParams {
  symbol: string;
  momentumMode: MomentumMode;
  fastWindow: number;
  slowWindow: number;
  momentumPeriod: number;
}

type IndicatorMaps = {
  fast: Map<string, number>;
  slow: Map<string, number>;
  adx: Map<string, number>;
  momentum: Map<string, number>;
  rsi: Map<string, number>;
  macdLine: Map<string, number>;
  macdSignal: Map<string, number>;
};

function buildIndicatorMaps(indicators: IndicatorCache): IndicatorMaps {
  const fast = new Map<string, number>();
  const slow = new Map<string, number>();
  const adx = new Map<string, number>();
  const momentum = new Map<string, number>();
  const rsi = new Map<string, number>();
  const macdLine = new Map<string, number>();
  const macdSignal = new Map<string, number>();

  indicators.fastEwma.forEach((p) => fast.set(p.date, p.value));
  indicators.slowEwma.forEach((p) => slow.set(p.date, p.value));
  indicators.adxPoints.forEach((p) => adx.set(p.date, p.adx));
  indicators.momentumPoints.forEach((p) => momentum.set(p.date, p.momentumPct));
  indicators.rsiPoints.forEach((p) => rsi.set(p.date, p.rsi));
  indicators.macdPoints.forEach((p) => {
    macdLine.set(p.date, p.macdLine);
    macdSignal.set(p.date, p.signal);
  });

  return { fast, slow, adx, momentum, rsi, macdLine, macdSignal };
}

function trendFiltersForDate(
  date: string,
  bar: SimBar,
  maps: IndicatorMaps,
  momentumMode: MomentumMode
): TrendFilterInputs {
  const fast = maps.fast.get(date);
  const slow = maps.slow.get(date);
  const adx = maps.adx.get(date);
  const roc = maps.momentum.get(date);
  const rsi = maps.rsi.get(date);
  const macdLine = maps.macdLine.get(date);
  const macdSignal = maps.macdSignal.get(date);

  const trend = classifyTrendDirection(fast, slow, bar.close);
  const adxRegime = classifyAdxTradingRegime(adx);
  const momDir = classifyMomentumDirection(momentumMode, roc, rsi, macdLine, macdSignal);

  return { trend, adxRegime, momDir };
}

function normalizeSignal(signal: Trading212Signal | null | undefined): Trading212Signal {
  if (signal === 'long' || signal === 'short') return signal;
  return 'flat';
}

function positionToSignal(position: number): Trading212Signal {
  if (position > 0) return 'long';
  if (position < 0) return 'short';
  return 'flat';
}

function runEwmaTrendWithSignals(
  bars: SimBar[],
  indicators: IndicatorCache,
  baseSignals: Trading212Signal[],
  params: EwmaTrendParams
): StrategyResult {
  const maps = buildIndicatorMaps(indicators);
  const positions: number[] = [];
  const signals: Trading212Signal[] = [];

  let currentPos = 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const baseSignal = normalizeSignal(baseSignals[i]);
    const filters = trendFiltersForDate(bar.date, bar, maps, params.momentumMode);

    let desiredPos = currentPos;

    if (currentPos === 1 && shouldExitLong(filters)) {
      desiredPos = 0;
    } else if (currentPos === -1 && shouldExitShort(filters)) {
      desiredPos = 0;
    }

    if (baseSignal === 'long' && desiredPos <= 0 && canEnterLong(filters)) {
      desiredPos = 1;
    } else if (baseSignal === 'short' && desiredPos >= 0 && canEnterShort(filters)) {
      desiredPos = -1;
    }

    positions.push(desiredPos);
    signals.push(positionToSignal(desiredPos));
    currentPos = desiredPos;
  }

  return { positions, signals };
}

export function runEwmaTrend(
  bars: SimBar[],
  indicators: IndicatorCache,
  biasedSignalSeries: Trading212Signal[],
  params: EwmaTrendParams
): StrategyResult {
  return runEwmaTrendWithSignals(bars, indicators, biasedSignalSeries, params);
}

export function runEwmaTrendMax(
  bars: SimBar[],
  indicators: IndicatorCache,
  biasedMaxSignalSeries: Trading212Signal[],
  params: EwmaTrendParams
): StrategyResult {
  return runEwmaTrendWithSignals(bars, indicators, biasedMaxSignalSeries, params);
}
