'use client';

import { useEffect, useState } from 'react';
import type {
  MomentumPoint,
  MomentumScorePoint,
  MomentumZone,
  MomentumRegime,
  MomentumZeroCross,
} from '@/lib/indicators/momentum';
import {
  buildMomentumScoreSeries,
  classifyMomentumRegime,
  findLastMomentumZeroCross,
  momentumPctToScore,
  momentumZoneFromScore,
} from '@/lib/indicators/momentum';
import type { AdxPoint, AdxTrendStrength } from '@/lib/indicators/adx';

export interface UseTrendIndicatorsOptions {
  momentumPeriod?: number;
  adxPeriod?: number;
}

export interface UseTrendIndicatorsResult {
  momentum: {
    latest: MomentumPoint | null;
    period: number;
    series: MomentumPoint[] | null;
    score: number | null;
    zone: MomentumZone | null;
    regime: MomentumRegime | null;
    scoreSeries: MomentumScorePoint[] | null;
    lastZeroCross: MomentumZeroCross | null;
  } | null;
  adx: {
    latest: AdxPoint | null;
    period: number;
    trendStrength: AdxTrendStrength | null;
  } | null;
  isLoading: boolean;
  error: string | null;
}

export function useTrendIndicators(
  symbol: string | undefined,
  options?: UseTrendIndicatorsOptions
): UseTrendIndicatorsResult {
  const momentumPeriod = options?.momentumPeriod ?? 10;
  const adxPeriod = options?.adxPeriod ?? 14;

  const [momentum, setMomentum] = useState<UseTrendIndicatorsResult['momentum']>(null);
  const [adx, setAdx] = useState<UseTrendIndicatorsResult['adx']>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;

    const controller = new AbortController();
    const { signal } = controller;
    const symbolStr = symbol; // Capture for closure

    async function load() {
      try {
        setIsLoading(true);
        setError(null);

        const [momentumRes, adxRes] = await Promise.all([
          fetch(
            `/api/indicators/momentum/${encodeURIComponent(symbolStr)}?period=${momentumPeriod}`,
            { signal }
          ),
          fetch(
            `/api/indicators/adx/${encodeURIComponent(symbolStr)}?period=${adxPeriod}`,
            { signal }
          ),
        ]);

        if (!momentumRes.ok) {
          throw new Error(`Momentum request failed: ${momentumRes.status}`);
        }
        if (!adxRes.ok) {
          throw new Error(`ADX request failed: ${adxRes.status}`);
        }

        const momentumJson = await momentumRes.json();
        const adxJson = await adxRes.json();

        // Check for explicit failure (success === false)
        // This allows older responses without the flag to still work
        if (momentumJson.success === false) {
          throw new Error(momentumJson.error || 'Momentum request failed');
        }
        if (adxJson.success === false) {
          throw new Error(adxJson.error || 'ADX request failed');
        }

        const momentumPoints = (momentumJson.points ?? []) as MomentumPoint[];
        const latest = momentumJson.latest ?? null;
        const period = momentumJson.period ?? momentumPeriod;

        let score: number | null = null;
        let zone: MomentumZone | null = null;
        let regime: MomentumRegime | null = null;
        let scoreSeries: MomentumScorePoint[] | null = null;
        let lastZeroCross: MomentumZeroCross | null = null;

        if (latest && Number.isFinite(latest.momentumPct)) {
          score = momentumPctToScore(latest.momentumPct);
          zone = momentumZoneFromScore(score);
          regime = classifyMomentumRegime(latest.momentumPct);
        }

        if (momentumPoints.length > 0) {
          scoreSeries = buildMomentumScoreSeries(momentumPoints);
          lastZeroCross = findLastMomentumZeroCross(momentumPoints);
        }

        setMomentum({
          latest,
          period,
          series: momentumPoints.length ? momentumPoints : null,
          score,
          zone,
          regime,
          scoreSeries,
          lastZeroCross,
        });

        setAdx({
          latest: adxJson.latest ?? null,
          period: adxJson.period ?? adxPeriod,
          trendStrength: adxJson.trendStrength ?? null,
        });
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setError(err?.message || 'Failed to load indicators');
        setMomentum(null);
        setAdx(null);
      } finally {
        setIsLoading(false);
      }
    }

    load();

    return () => controller.abort();
  }, [symbol, momentumPeriod, adxPeriod]);

  return { momentum, adx, isLoading, error };
}

export default useTrendIndicators;
