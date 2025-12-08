import type { AdxPoint } from '@/lib/indicators/adx';
import type { MomentumMode as UiMomentumMode } from '@/lib/indicators/momentum';

export type TrendDirection = 'UP' | 'DOWN' | 'SIDEWAYS';

export type AdxTradingRegime = 'RANGE' | 'THRESHOLD' | 'TRENDING';

export type MomentumMode = 'roc' | 'rsi' | 'macd';
export type MomentumDirection = 'BULL' | 'BEAR' | 'NEUTRAL';

export interface TrendFilterInputs {
  trend: TrendDirection;
  adxRegime: AdxTradingRegime;
  momDir: MomentumDirection;
}

/**
 * Classify trend direction based on fast/slow EWMA and price relative to slow.
 */
export function classifyTrendDirection(
  fastMA: number | null | undefined,
  slowMA: number | null | undefined,
  price: number | null | undefined
): TrendDirection {
  if (
    fastMA == null ||
    slowMA == null ||
    price == null ||
    !Number.isFinite(fastMA) ||
    !Number.isFinite(slowMA) ||
    !Number.isFinite(price)
  ) {
    return 'SIDEWAYS';
  }

  if (fastMA > slowMA && price > slowMA) {
    return 'UP';
  }

  if (fastMA < slowMA && price < slowMA) {
    return 'DOWN';
  }

  return 'SIDEWAYS';
}

/**
 * Simplified ADX regime for trading filters.
 */
export function classifyAdxTradingRegime(adxValue: number | null | undefined): AdxTradingRegime {
  if (adxValue == null || !Number.isFinite(adxValue)) {
    return 'RANGE';
  }

  const v = adxValue;

  if (v < 20) return 'RANGE';
  if (v < 25) return 'THRESHOLD';
  return 'TRENDING';
}

/**
 * Classify momentum direction from ROC/RSI/MACD.
 */
export function classifyMomentumDirection(
  mode: MomentumMode,
  rocValue: number | null | undefined,
  rsiValue: number | null | undefined,
  macdLine: number | null | undefined,
  macdSignal: number | null | undefined
): MomentumDirection {
  switch (mode) {
    case 'roc': {
      if (rocValue == null || !Number.isFinite(rocValue)) return 'NEUTRAL';
      if (rocValue > 0) return 'BULL';
      if (rocValue < 0) return 'BEAR';
      return 'NEUTRAL';
    }
    case 'rsi': {
      if (rsiValue == null || !Number.isFinite(rsiValue)) return 'NEUTRAL';
      const r = rsiValue;
      if (r >= 60) return 'BULL';
      if (r <= 40) return 'BEAR';
      return 'NEUTRAL';
    }
    case 'macd': {
      if (
        macdLine == null ||
        macdSignal == null ||
        !Number.isFinite(macdLine) ||
        !Number.isFinite(macdSignal)
      ) {
        return 'NEUTRAL';
      }

      if (macdLine > 0 && macdLine > macdSignal) {
        return 'BULL';
      }

      if (macdLine < 0 && macdLine < macdSignal) {
        return 'BEAR';
      }

      return 'NEUTRAL';
    }
    default:
      return 'NEUTRAL';
  }
}

/**
 * Entry filters for trend strategies.
 */
export function canEnterLong(filters: TrendFilterInputs): boolean {
  return filters.trend === 'UP' && filters.adxRegime === 'TRENDING' && filters.momDir === 'BULL';
}

export function canEnterShort(filters: TrendFilterInputs): boolean {
  return filters.trend === 'DOWN' && filters.adxRegime === 'TRENDING' && filters.momDir === 'BEAR';
}

/**
 * Exit filters (tier 1, symmetric).
 */
export function shouldExitLong(filters: TrendFilterInputs): boolean {
  return filters.trend !== 'UP' || filters.adxRegime === 'RANGE' || filters.momDir === 'BEAR';
}

export function shouldExitShort(filters: TrendFilterInputs): boolean {
  return filters.trend !== 'DOWN' || filters.adxRegime === 'RANGE' || filters.momDir === 'BULL';
}
