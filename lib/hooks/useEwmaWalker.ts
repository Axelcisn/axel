'use client';

import { useEffect, useState } from 'react';

export interface EwmaWalkerPoint {
  date_t: string;
  date_tp1: string;
  S_t: number;
  S_tp1: number | null;
  y_hat_tp1: number;
  L_tp1: number;
  U_tp1: number;
  sigma_t?: number;
}

export interface EwmaPiMetrics {
  empiricalCoverage: number;
  coverage: number;
  intervalScore: number;
  avgWidth: number;
  nPoints: number;
}

export interface EwmaSummary {
  piMetrics: EwmaPiMetrics;
  zMean: number;
  zStd: number;
  directionHitRate: number;
}

export interface UseEwmaWalkerOptions {
  lambda?: number;
  horizon?: number;   // h
  coverage?: number;
}

interface UseEwmaWalkerResult {
  path: EwmaWalkerPoint[] | null;
  summary: EwmaSummary | null;
  oosForecast: EwmaWalkerPoint | null;
  isLoading: boolean;
  error: string | null;
}

export function useEwmaWalker(
  symbol: string | undefined,
  options?: UseEwmaWalkerOptions
): UseEwmaWalkerResult {
  const lambda = options?.lambda ?? 0.94;
  const horizon = options?.horizon ?? 1;
  const coverage = options?.coverage ?? 0.95;

  const [path, setPath] = useState<EwmaWalkerPoint[] | null>(null);
  const [summary, setSummary] = useState<EwmaSummary | null>(null);
  const [oosForecast, setOosForecast] = useState<EwmaWalkerPoint | null>(null);
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

        const qs = new URLSearchParams({
          lambda: lambda.toString(),
          h: horizon.toString(),
          coverage: coverage.toString(),
        });

        const res = await fetch(
          `/api/volatility/ewma/${encodeURIComponent(symbolStr)}?${qs.toString()}`,
          { signal }
        );

        if (!res.ok) {
          throw new Error(`EWMA request failed with status ${res.status}`);
        }

        const data = await res.json();

        if (!data?.success) {
          throw new Error(data?.error || 'EWMA request failed');
        }

        setPath(data.points ?? null);

        const piMetrics: EwmaPiMetrics | null = data.piMetrics
          ? {
              empiricalCoverage: data.piMetrics.empiricalCoverage,
              coverage: data.piMetrics.coverage,
              intervalScore: data.piMetrics.intervalScore,
              avgWidth: data.piMetrics.avgWidth,
              nPoints: data.piMetrics.nPoints,
            }
          : null;

        setSummary(
          piMetrics
            ? {
                piMetrics,
                zMean: data.zMean ?? 0,
                zStd: data.zStd ?? 1,
                directionHitRate: data.directionHitRate ?? 0,
              }
            : null
        );

        if (data.oosForecast) {
          setOosForecast({
            date_t: data.oosForecast.originDate,
            date_tp1: data.oosForecast.targetDate,
            S_t: data.oosForecast.S_t,
            S_tp1: null,
            y_hat_tp1: data.oosForecast.y_hat,
            L_tp1: data.oosForecast.L,
            U_tp1: data.oosForecast.U,
            sigma_t: data.oosForecast.sigma_t,
          });
        } else {
          setOosForecast(null);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setError(err?.message || 'Failed to load EWMA');
      } finally {
        setIsLoading(false);
      }
    }

    load();

    return () => controller.abort();
  }, [symbol, lambda, horizon, coverage]);

  return { path, summary, oosForecast, isLoading, error };
}

export default useEwmaWalker;
