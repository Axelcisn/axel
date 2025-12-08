'use client';

import { useMemo } from 'react';
import usePriceHistory from './usePriceHistory';
import {
  computeEwmaSeries,
  findLastEwmaCrossover,
  type EwmaPoint,
  type EwmaCrossoverEvent,
} from '@/lib/indicators/ewmaCrossover';

export interface UseEwmaCrossoverResult {
  priceSeries: { date: string; close: number }[] | null;
  shortEwma: EwmaPoint[] | null;
  longEwma: EwmaPoint[] | null;
  lastEvent: EwmaCrossoverEvent | null;
  latestShort: number | null;
  latestLong: number | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Fetch price history and compute short/long EWMA series plus last crossover event.
 */
export function useEwmaCrossover(
  symbol: string | undefined,
  shortWindow: number,
  longWindow: number
): UseEwmaCrossoverResult {
  const { data, isLoading, error } = usePriceHistory(symbol);

  const { shortEwma, longEwma, lastEvent, latestShort, latestLong } = useMemo(() => {
    if (!data || data.length === 0) {
      return {
        shortEwma: null,
        longEwma: null,
        lastEvent: null,
        latestShort: null,
        latestLong: null,
      };
    }

    const shortSeries = computeEwmaSeries(data, shortWindow);
    const longSeries = computeEwmaSeries(data, longWindow);

    if (!shortSeries.length || !longSeries.length) {
      return {
        shortEwma: shortSeries.length ? shortSeries : null,
        longEwma: longSeries.length ? longSeries : null,
        lastEvent: null,
        latestShort: shortSeries.length ? shortSeries[shortSeries.length - 1].value : null,
        latestLong: longSeries.length ? longSeries[longSeries.length - 1].value : null,
      };
    }

    const event = findLastEwmaCrossover(shortSeries, longSeries);
    const latestShortValue = shortSeries[shortSeries.length - 1].value;
    const latestLongValue = longSeries[longSeries.length - 1].value;

    return {
      shortEwma: shortSeries,
      longEwma: longSeries,
      lastEvent: event,
      latestShort: latestShortValue,
      latestLong: latestLongValue,
    };
  }, [data, shortWindow, longWindow]);

  return {
    priceSeries: data,
    shortEwma,
    longEwma,
    lastEvent,
    latestShort,
    latestLong,
    isLoading,
    error,
  };
}

export default useEwmaCrossover;
