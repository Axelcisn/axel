'use client';

import { useEffect, useState } from 'react';
import type {
  MomentumPoint,
  MomentumScorePoint,
  MomentumZone,
  MomentumRegime,
  MomentumZeroCross,
  MomentumMode,
  RocMetrics,
  RsiMetrics,
  MacdMetrics,
} from '@/lib/indicators/momentum';
import {
  buildMomentumScoreSeries,
  classifyMomentumRegime,
  findLastMomentumZeroCross,
  momentumPctToScore,
  momentumZoneFromScore,
  computeRocZScore,
  classifyRocRegime,
  computeRsi,
  classifyRsiRegime,
  rsiBand,
  findLastRsiCenterCross,
  findLastRsiBandCross,
  computeMacd,
  classifyMacdRegime,
  findLastMacdSignalCross,
  findLastMacdCenterCross,
  classifyMacdHistSlope,
} from '@/lib/indicators/momentum';
import {
  findLatestDivergence,
  type DivergenceSignal,
  type SeriesPoint,
} from '@/lib/indicators/divergence';
import type {
  AdxPoint,
  AdxTrendStrength,
  AdxRegime,
  AdxSlope,
  AdxThresholdCross,
  AdxExtremeState,
} from '@/lib/indicators/adx';
import {
  classifyAdxRegime,
  computeAdxSlope,
  findLastAdxThresholdCross,
  computeAdxExtremeState,
} from '@/lib/indicators/adx';

export interface UseTrendIndicatorsOptions {
  momentumPeriod?: number;
  adxPeriod?: number;
  macdShortWindow?: number;
  macdLongWindow?: number;
}

export interface UseTrendMomentum {
  mode: MomentumMode;
  latest: MomentumPoint | null;
  period: number;
  series: MomentumPoint[] | null;
  score: number | null;
  zone: MomentumZone | null;
  regime: MomentumRegime | null;
  scoreSeries: MomentumScorePoint[] | null;
  lastZeroCross: MomentumZeroCross | null;
  roc: RocMetrics | null;
  rsi: RsiMetrics | null;
  macd: MacdMetrics | null;
  rocDivergence: DivergenceSignal | null;
  rsiDivergence: DivergenceSignal | null;
  macdDivergence: DivergenceSignal | null;
}

export interface UseTrendIndicatorsResult {
  momentum: UseTrendMomentum | null;
  adx: {
    latest: AdxPoint | null;
    period: number;
    trendStrength: AdxTrendStrength | null;
    series: AdxPoint[] | null;
    regime: AdxRegime | null;
    slope: AdxSlope | null;
    lastThresholdCross: AdxThresholdCross | null;
    extreme: AdxExtremeState | null;
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
  const macdShortWindow = options?.macdShortWindow ?? 12;
  const macdLongWindow = options?.macdLongWindow ?? 26;

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
        let rocMetrics: RocMetrics | null = null;
        let rsiMetrics: RsiMetrics | null = null;
        let macdMetrics: MacdMetrics | null = null;
        let rocDivergence: DivergenceSignal | null = null;
        let rsiDivergence: DivergenceSignal | null = null;
        let macdDivergence: DivergenceSignal | null = null;

        if (latest && Number.isFinite(latest.momentumPct)) {
          score = momentumPctToScore(latest.momentumPct);
          zone = momentumZoneFromScore(score);
          regime = classifyMomentumRegime(latest.momentumPct);
        }

        if (momentumPoints.length > 0) {
          scoreSeries = buildMomentumScoreSeries(momentumPoints);
          lastZeroCross = findLastMomentumZeroCross(momentumPoints);
        }

        // ROC metrics (z-score, regime, extremes)
        if (latest && Number.isFinite(latest.momentumPct)) {
          const { zScore } = computeRocZScore(momentumPoints);
          const rocRegime = classifyRocRegime(latest.momentumPct, zScore);
          let extreme: RocMetrics['extreme'] = 'none';
          if (Math.abs(zScore) >= 2) {
            extreme = zScore > 0 ? 'positive' : 'negative';
          }
          rocMetrics = {
            roc: latest.momentumPct,
            zScore,
            regime: rocRegime,
            zeroCross: lastZeroCross
              ? {
                  direction: lastZeroCross.direction === 'neg_to_pos' ? 'up' : 'down',
                  barsAgo: lastZeroCross.barsAgo,
                }
              : undefined,
            extreme,
          };
        }

        const priceRows = momentumPoints.map((p) => ({ date: p.date, close: p.close }));
        const priceSeries: SeriesPoint[] = priceRows.map((r) => ({ date: r.date, value: r.close }));

        // RSI (default 14)
        const { points: rsiPoints, latest: rsiLatest } = computeRsi(priceRows, 14);
        if (rsiLatest) {
          const rsiRegime = classifyRsiRegime(rsiLatest.rsi);
          const band = rsiBand(rsiLatest.rsi);
          const centerCross = findLastRsiCenterCross(rsiPoints);
          const bandCross = findLastRsiBandCross(rsiPoints);
          rsiMetrics = {
            rsi: rsiLatest.rsi,
            regime: rsiRegime,
            band,
            centerCross,
            bandCross,
          };
        }

        // MACD (12/26/9)
        const { points: macdPoints, latest: macdLatest } = computeMacd(priceRows, macdShortWindow, macdLongWindow, 9);
        if (macdLatest) {
          const macdRegime = classifyMacdRegime(macdLatest.macdLine, macdLatest.macdNorm);
          const signalCross = findLastMacdSignalCross(macdPoints);
          const centerCross = findLastMacdCenterCross(macdPoints);
          const histSlope = classifyMacdHistSlope(macdPoints);
          macdMetrics = {
            macdLine: macdLatest.macdLine,
            signal: macdLatest.signal,
            hist: macdLatest.hist,
            macdNorm: macdLatest.macdNorm,
            regime: macdRegime,
            signalCross,
            centerCross,
            histSlope,
          };
        }

        // Divergence detection (price vs oscillator)
        const rocSeries: SeriesPoint[] = momentumPoints.map((p) => ({ date: p.date, value: p.momentumPct }));
        if (rocSeries.length) {
          rocDivergence = findLatestDivergence(priceSeries, rocSeries);
        }

        const rsiSeries: SeriesPoint[] = rsiPoints.map((p) => ({ date: p.date, value: p.rsi }));
        if (rsiSeries.length) {
          rsiDivergence = findLatestDivergence(priceSeries, rsiSeries);
        }

        const macdSeries: SeriesPoint[] = macdPoints.map((p) => ({ date: p.date, value: p.macdLine }));
        if (macdSeries.length) {
          macdDivergence = findLatestDivergence(priceSeries, macdSeries);
        }

        setMomentum({
          mode: 'roc',
          latest,
          period,
          series: momentumPoints.length ? momentumPoints : null,
          score,
          zone,
          regime,
          scoreSeries,
          lastZeroCross,
          roc: rocMetrics,
          rsi: rsiMetrics,
          macd: macdMetrics,
          rocDivergence,
          rsiDivergence,
          macdDivergence,
        });

        const adxPoints = (adxJson.points ?? []) as AdxPoint[];
        const adxLatest = adxJson.latest ?? null;
        const adxPeriodValue = adxJson.period ?? adxPeriod;
        const adxStrength = (adxJson.trendStrength ?? null) as AdxTrendStrength | null;

        let adxRegime: AdxRegime | null = null;
        let adxSlope: AdxSlope | null = null;
        let adxThresholdCross: AdxThresholdCross | null = null;
        let adxExtreme: AdxExtremeState | null = null;

        if (adxLatest && Number.isFinite(adxLatest.adx)) {
          adxRegime = classifyAdxRegime(adxLatest.adx);
        }

        if (adxPoints.length > 0) {
          adxSlope = computeAdxSlope(adxPoints);
          adxThresholdCross = findLastAdxThresholdCross(adxPoints);
          adxExtreme = computeAdxExtremeState(adxPoints);
        }

        setAdx({
          latest: adxLatest,
          period: adxPeriodValue,
          trendStrength: adxStrength,
          series: adxPoints.length ? adxPoints : null,
          regime: adxRegime,
          slope: adxSlope,
          lastThresholdCross: adxThresholdCross,
          extreme: adxExtreme,
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
