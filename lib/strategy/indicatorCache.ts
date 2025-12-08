import type { SimBar } from './ohlcLoader';
import { computeEwmaSeries } from '@/lib/indicators/ewmaCrossover';
import { computeAdx, type AdxPoint } from '@/lib/indicators/adx';
import {
  computeMomentum,
  type MomentumPoint,
  computeRsi,
  type RsiPoint,
  computeMacd,
  type MacdPoint,
} from '@/lib/indicators/momentum';

export interface IndicatorCache {
  bars: SimBar[];
  fastEwma: { date: string; value: number }[];
  slowEwma: { date: string; value: number }[];
  adxPoints: AdxPoint[];
  momentumPoints: MomentumPoint[];
  rsiPoints: RsiPoint[];
  macdPoints: MacdPoint[];
}

export interface IndicatorCacheParams {
  bars: SimBar[];
  fastWindow: number;
  slowWindow: number;
  momentumPeriod: number;
  rsiPeriod?: number;
  macdShort?: number;
  macdLong?: number;
  macdSignal?: number;
}

/**
 * Build all core indicators once for a given bar set.
 */
export function buildIndicatorCache(params: IndicatorCacheParams): IndicatorCache {
  const {
    bars,
    fastWindow,
    slowWindow,
    momentumPeriod,
    rsiPeriod = 14,
    macdShort = 12,
    macdLong = 26,
    macdSignal = 9,
  } = params;

  const priceRows = bars.map((b) => ({ date: b.date, close: b.close }));

  const fastEwma = computeEwmaSeries(priceRows, fastWindow);
  const slowEwma = computeEwmaSeries(priceRows, slowWindow);

  const adxResult = computeAdx(
    bars.map((b) => ({
      date: b.date,
      high: b.high,
      low: b.low,
      close: b.close,
    })),
    14
  );
  const adxPoints = adxResult.points ?? [];

  const momentumResult = computeMomentum(priceRows, momentumPeriod);
  const momentumPoints = momentumResult.points ?? [];

  const rsiResult = computeRsi(priceRows, rsiPeriod);
  const rsiPoints = rsiResult.points ?? [];

  const macdResult = computeMacd(priceRows, macdShort, macdLong, macdSignal);
  const macdPoints = macdResult.points ?? [];

  return {
    bars,
    fastEwma,
    slowEwma,
    adxPoints,
    momentumPoints,
    rsiPoints,
    macdPoints,
  };
}
