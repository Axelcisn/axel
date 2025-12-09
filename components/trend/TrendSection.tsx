'use client';

import { useState, useEffect, useCallback } from 'react';
import { useDarkMode } from '@/lib/hooks/useDarkMode';
import { useTrendIndicators } from '@/lib/hooks/useTrendIndicators';
import useEwmaCrossover, { type UseEwmaCrossoverResult } from '@/lib/hooks/useEwmaCrossover';

// Tab type for trend analysis
type TrendTab = 'traditional' | 'ml' | 'ai';

// EWMA crossover preset type
type EwmaPreset = 'short' | 'medium' | 'long' | 'custom';

// EWMA Walker path point type (matches PriceChart export)
interface EwmaWalkerPathPoint {
  date_t: string;
  date_tp1: string;
  S_t: number;
  S_tp1: number;
  y_hat_tp1: number;
  L_tp1: number;
  U_tp1: number;
  sigma_t: number;
}

// EWMA Summary stats
interface EwmaSummary {
  coverage: number;
  targetCoverage: number;
  intervalScore: number;
  avgWidth: number;
  zMean: number;
  zStd: number;
  directionHitRate: number;
  nPoints: number;
}

// Trend classification result
interface TrendClassification {
  regime: 'up' | 'down' | 'sideways';
  strengthScore: number;
  latestPrice: number;
  ewmaCenter: number;
  pricePctFromEwma: number;
  recentMomentum: number; // avg return over lookback
}

interface TrendSectionProps {
  ticker: string;
  /** Pass existing EWMA data from parent to avoid redundant fetches */
  ewmaPath?: EwmaWalkerPathPoint[] | null;
  ewmaSummary?: EwmaSummary | null;
  /** Current horizon from parent */
  horizon?: number;
  /** Current coverage from parent */
  coverage?: number;
  /** Optional controlled EWMA windows for Trend chart overlays */
  shortWindowOverride?: number;
  longWindowOverride?: number;
  onEwmaWindowChange?: (shortWindow: number, longWindow: number, preset: EwmaPreset) => void;
  /** Optional controlled momentum period */
  momentumPeriodOverride?: number;
  onMomentumPeriodChange?: (period: number) => void;
  /** Optional EWMA crossover data to avoid duplicate fetches */
  ewmaCrossoverOverride?: Partial<UseEwmaCrossoverResult>;
  trendWeight?: number | null;
  trendWeightUpdatedAt?: string | null;
}

/**
 * Classify trend based on EWMA path
 */
function classifyTrend(
  ewmaPath: EwmaWalkerPathPoint[],
  options: { lookbackDays?: number; threshold?: number } = {}
): TrendClassification | null {
  const { lookbackDays = 10, threshold = 0.003 } = options;

  if (!ewmaPath || ewmaPath.length < 2) return null;

  // Get the latest point (last in array)
  const latest = ewmaPath[ewmaPath.length - 1];
  const latestPrice = latest.S_tp1 || latest.S_t;
  const ewmaCenter = latest.y_hat_tp1;

  // Price position relative to EWMA
  const pricePctFromEwma = (latestPrice - ewmaCenter) / ewmaCenter;

  // Calculate recent momentum (average return over lookback)
  const recentPoints = ewmaPath.slice(-lookbackDays);
  let totalReturn = 0;
  for (let i = 1; i < recentPoints.length; i++) {
    const prev = recentPoints[i - 1].S_t;
    const curr = recentPoints[i].S_t;
    if (prev > 0) {
      totalReturn += (curr - prev) / prev;
    }
  }
  const recentMomentum = recentPoints.length > 1 ? totalReturn / (recentPoints.length - 1) : 0;

  // Classify regime
  let regime: 'up' | 'down' | 'sideways';
  if (recentMomentum > threshold && pricePctFromEwma > 0) {
    regime = 'up';
  } else if (recentMomentum < -threshold && pricePctFromEwma < 0) {
    regime = 'down';
  } else {
    regime = 'sideways';
  }

  // Strength score: magnitude of momentum relative to threshold
  const strengthScore = Math.min(Math.abs(recentMomentum) / threshold, 2);

  return {
    regime,
    strengthScore,
    latestPrice,
    ewmaCenter,
    pricePctFromEwma,
    recentMomentum,
  };
}

export default function TrendSection({
  ticker,
  ewmaPath: externalEwmaPath,
  ewmaSummary: externalEwmaSummary,
  horizon = 1,
  coverage = 0.95,
  shortWindowOverride,
  longWindowOverride,
  onEwmaWindowChange,
  momentumPeriodOverride,
  onMomentumPeriodChange,
  ewmaCrossoverOverride,
  trendWeight,
  trendWeightUpdatedAt,
}: TrendSectionProps) {
  const isDarkMode = useDarkMode();

  // Tab state
  const [activeTab, setActiveTab] = useState<TrendTab>('traditional');
  const [momentumPeriod, setMomentumPeriod] = useState<number>(momentumPeriodOverride ?? 10);
  const [adxPeriod, setAdxPeriod] = useState<number>(14);

  // EWMA crossover preset state
  const [ewmaPreset, setEwmaPreset] = useState<EwmaPreset>('medium');
  const [shortWindow, setShortWindow] = useState<number>(shortWindowOverride ?? 14);   // default medium-term short
  const [longWindow, setLongWindow] = useState<number>(longWindowOverride ?? 50);     // default medium-term long

  const inferPreset = (s: number, l: number): EwmaPreset => {
    if (s === 5 && l === 20) return 'short';
    if (s === 14 && l === 50) return 'medium';
    if (s === 50 && l === 200) return 'long';
    return 'custom';
  };

  // Sync controlled overrides from parent (if provided)
  useEffect(() => {
    if (shortWindowOverride != null && shortWindowOverride !== shortWindow) {
      setShortWindow(shortWindowOverride);
      setEwmaPreset(inferPreset(shortWindowOverride, longWindow));
    }
  }, [shortWindowOverride, shortWindow, longWindow]);

  useEffect(() => {
    if (longWindowOverride != null && longWindowOverride !== longWindow) {
      setLongWindow(longWindowOverride);
      setEwmaPreset(inferPreset(shortWindow, longWindowOverride));
    }
  }, [longWindowOverride, longWindow, shortWindow]);

  useEffect(() => {
    if (momentumPeriodOverride != null && momentumPeriodOverride !== momentumPeriod) {
      setMomentumPeriod(momentumPeriodOverride);
    }
  }, [momentumPeriodOverride, momentumPeriod]);

  // Helper to apply preset values
  function applyEwmaPreset(preset: EwmaPreset) {
    let nextShort = shortWindow;
    let nextLong = longWindow;

    if (preset === 'short') {
      nextShort = 5;
      nextLong = 20;
    } else if (preset === 'medium') {
      nextShort = 14;
      nextLong = 50;
    } else if (preset === 'long') {
      nextShort = 50;
      nextLong = 200;
    }
    // 'custom' preset keeps current values
    setEwmaPreset(preset);
    setShortWindow(nextShort);
    setLongWindow(nextLong);
    onEwmaWindowChange?.(nextShort, nextLong, preset);
  }

  // Local state for EWMA data if not passed from parent
  const [localEwmaPath, setLocalEwmaPath] = useState<EwmaWalkerPathPoint[] | null>(null);
  const [localEwmaSummary, setLocalEwmaSummary] = useState<EwmaSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use external data if provided, otherwise use local
  const ewmaPath = externalEwmaPath ?? localEwmaPath;
  const ewmaSummary = externalEwmaSummary ?? localEwmaSummary;

  // Fetch Momentum & ADX indicators
  const {
    momentum,
    adx,
    isLoading: indicatorsLoading,
    error: indicatorsError,
  } = useTrendIndicators(ticker, {
    momentumPeriod,
    adxPeriod,
    macdShortWindow: 12,
    macdLongWindow: 26,
  });

  const shouldFetchEwmaCrossover = !ewmaCrossoverOverride;
  const ewmaCrossover = useEwmaCrossover(
    shouldFetchEwmaCrossover ? ticker : undefined,
    shortWindow,
    longWindow
  );

  const priceSeries = ewmaCrossoverOverride?.priceSeries ?? ewmaCrossover.priceSeries;
  const shortEwma = ewmaCrossoverOverride?.shortEwma ?? ewmaCrossover.shortEwma;
  const longEwma = ewmaCrossoverOverride?.longEwma ?? ewmaCrossover.longEwma;
  const lastEvent = ewmaCrossoverOverride?.lastEvent ?? ewmaCrossover.lastEvent;
  const latestShort = ewmaCrossoverOverride?.latestShort ?? ewmaCrossover.latestShort;
  const latestLong = ewmaCrossoverOverride?.latestLong ?? ewmaCrossover.latestLong;
  const gapStats = ewmaCrossoverOverride?.gapStats ?? ewmaCrossover.gapStats;
  const ewmaCrossoverLoading =
    ewmaCrossoverOverride?.isLoading ?? ewmaCrossover.isLoading;
  const ewmaCrossoverError = ewmaCrossoverOverride?.error ?? ewmaCrossover.error;

  // Combined loading/error states
  const isLoadingAny = isLoading || indicatorsLoading || ewmaCrossoverLoading;
  const combinedError = error || indicatorsError || ewmaCrossoverError;

  const rocMetrics = momentum?.roc ?? null;
  const rsiMetrics = momentum?.rsi ?? null;
  const macdMetrics = momentum?.macd ?? null;
  const rocDivergence = momentum?.rocDivergence ?? null;
  const rsiDivergence = momentum?.rsiDivergence ?? null;
  const macdDivergence = momentum?.macdDivergence ?? null;

  // Fetch EWMA data if not provided externally
  const fetchEwmaData = useCallback(async () => {
    if (externalEwmaPath) return; // Don't fetch if parent provides data

    setIsLoading(true);
    setError(null);

    try {
      const query = new URLSearchParams({
        lambda: '0.94',
        h: String(horizon),
        coverage: coverage.toString(),
      });

      const res = await fetch(`/api/volatility/ewma/${encodeURIComponent(ticker)}?${query.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to load EWMA data: ${res.status}`);
      }

      const json = await res.json();
      const points = json.points || [];
      const m = json.piMetrics || {};

      // Map to path format
      const mappedPath: EwmaWalkerPathPoint[] = points.map((p: any) => ({
        date_t: p.date_t,
        date_tp1: p.date_tp1,
        S_t: p.S_t,
        S_tp1: p.S_tp1,
        y_hat_tp1: p.y_hat_tp1,
        L_tp1: p.L_tp1,
        U_tp1: p.U_tp1,
        sigma_t: p.sigma_t,
      }));

      // Append OOS forecast if available
      if (json.oosForecast?.targetDate) {
        mappedPath.push({
          date_t: json.oosForecast.originDate,
          date_tp1: json.oosForecast.targetDate,
          S_t: json.oosForecast.S_t,
          S_tp1: json.oosForecast.y_hat,
          y_hat_tp1: json.oosForecast.y_hat,
          L_tp1: json.oosForecast.L,
          U_tp1: json.oosForecast.U,
          sigma_t: json.oosForecast.sigma_t,
        });
      }

      setLocalEwmaPath(mappedPath);
      setLocalEwmaSummary({
        coverage: m.empiricalCoverage ?? NaN,
        targetCoverage: m.coverage ?? NaN,
        intervalScore: m.intervalScore ?? NaN,
        avgWidth: m.avgWidth ?? NaN,
        zMean: json.zMean ?? NaN,
        zStd: json.zStd ?? NaN,
        directionHitRate: json.directionHitRate ?? NaN,
        nPoints: points.length,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trend data');
    } finally {
      setIsLoading(false);
    }
  }, [ticker, horizon, coverage, externalEwmaPath]);

  // Load data on mount if not provided externally
  useEffect(() => {
    if (!externalEwmaPath) {
      fetchEwmaData();
    }
  }, [fetchEwmaData, externalEwmaPath]);

  // Compute trend classification
  const trendClassification = ewmaPath ? classifyTrend(ewmaPath) : null;

  // Regime display helpers
  const getRegimeIcon = (regime: 'up' | 'down' | 'sideways') => {
    switch (regime) {
      case 'up':
        return '▲';
      case 'down':
        return '▼';
      default:
        return '◆';
    }
  };

  const getRegimeColor = (regime: 'up' | 'down' | 'sideways') => {
    switch (regime) {
      case 'up':
        return 'text-emerald-500';
      case 'down':
        return 'text-rose-500';
      default:
        return isDarkMode ? 'text-slate-400' : 'text-gray-500';
    }
  };

  const getRegimeLabel = (regime: 'up' | 'down' | 'sideways') => {
    switch (regime) {
      case 'up':
        return 'Uptrend';
      case 'down':
        return 'Downtrend';
      default:
        return 'Sideways';
    }
  };

  return (
    <div className="mb-4">
      {/* Header with Tabs */}
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              Trend Analysis
            </h3>
          </div>
          
          {/* Tab Navigation */}
          <div className={`flex items-center gap-1 rounded-full p-1 ${
            isDarkMode ? 'bg-slate-800/50' : 'bg-gray-100'
          }`}>
            {(['traditional', 'ml', 'ai'] as TrendTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`
                  px-2.5 py-1 text-xs font-medium rounded-full transition-all
                  ${activeTab === tab
                    ? isDarkMode 
                      ? 'bg-slate-700 text-white shadow-sm' 
                      : 'bg-white text-gray-900 shadow-sm'
                    : isDarkMode
                      ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }
                `}
              >
                {tab === 'traditional' ? 'Traditional' : tab.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Traditional Tab Content */}
      {activeTab === 'traditional' && (
        <>
          {/* Error display */}
          {combinedError && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
              {combinedError}
            </div>
          )}

          {/* Loading state */}
          {isLoadingAny && (
            <div className={`text-center py-8 rounded-xl ${
              isDarkMode ? 'bg-slate-900/40 text-slate-500' : 'bg-gray-50 text-gray-400'
            }`}>
              Loading trend data...
            </div>
          )}

          {/* Content */}
          {!isLoadingAny && ewmaPath && ewmaPath.length > 0 && trendClassification && (
            <>
              {/* Three Indicator Cards Grid */}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                
                {/* ═══════════════════════════════════════════════════════════════
                    EWMA TREND CARD (Enhanced with crossover presets)
                    Variables used:
                    - trendClassification.regime / strengthScore (primary metric)
                    - trendClassification.latestPrice, ewmaCenter, pricePctFromEwma
                    - ewmaSummary.coverage, targetCoverage, directionHitRate
                    - shortWindow, longWindow, ewmaPreset (local state)
                ═══════════════════════════════════════════════════════════════ */}
                {(() => {
                  // Derived label for crossover-based trend wording
                  const ewmaRegimeLabel =
                    trendClassification?.regime === 'up'
                      ? 'Uptrend'
                      : trendClassification?.regime === 'down'
                      ? 'Downtrend'
                      : trendClassification?.regime === 'sideways'
                      ? 'Sideways'
                      : '—';

                  const shortEwmaValue = latestShort ?? trendClassification?.ewmaCenter ?? null;
                  const longEwmaValue = latestLong ?? trendClassification?.ewmaCenter ?? null;
                  const biasBase = longEwmaValue ?? trendClassification.ewmaCenter;
                  const priceBiasPct = biasBase
                    ? (trendClassification.latestPrice - biasBase) / biasBase
                    : trendClassification.pricePctFromEwma;

                  const formatPrice = (v: number | null) =>
                    v != null ? `$${v.toFixed(2)}` : '—';

                  return (
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 sm:p-5">
                      {/* Header Row 1: Title + Tooltip + Trend Badge */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2.5">
                          <div>
                            {/* Title with info tooltip */}
                            <div className="relative group flex items-center gap-1">
                              <h4 className="text-sm font-semibold text-white">EWMA Trend</h4>
                              <span className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-400 cursor-help">
                                i
                              </span>
                              <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-72 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-slate-200 shadow-lg group-hover:block">
                                <p className="mb-1">
                                  A moving average smooths price over a chosen period to reveal the underlying trend.
                                  We use an <span className="font-semibold">Exponentially Weighted Moving Average (EWMA)</span>,
                                  which gives more weight to recent prices so it reacts faster than a simple moving average.
                                </p>
                                <p className="mb-1">
                                  Short EWMAs (e.g. 5–20 days) respond quickly but can be noisy, while long EWMAs
                                  (e.g. 50–200 days) move slower but give more reliable signals.
                                </p>
                                <p>
                                  Crossovers between short and long EWMAs are <span className="font-semibold">lagging</span>:
                                  they confirm trends after they have begun and can give false signals in choppy, sideways markets.
                                </p>
                              </div>
                            </div>
                            <p className="text-[10px] text-slate-500">H(d): {horizon} · λ: 0.94</p>
                            {trendWeight != null ? (
                              <p
                                className="text-[10px] text-slate-500"
                                title="Trend Weight is the estimated contribution of the EWMA Trend signal to the forecast, calibrated from historical data."
                              >
                                Trend Weight:{' '}
                                <span className="text-slate-200">
                                  {trendWeight.toFixed(3)}
                                </span>
                                {trendWeightUpdatedAt ? (
                                  <span className="ml-1 text-[10px] text-slate-500">
                                    (updated {trendWeightUpdatedAt})
                                  </span>
                                ) : null}
                              </p>
                            ) : (
                              <p className="text-[10px] text-slate-500">
                                Trend Weight: <span className="text-slate-400">not available</span>
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Trend badge: Bullish / Bearish / Sideways */}
                        {(() => {
                          const tol = 1e-6;
                          const s = latestShort ?? shortEwma?.[shortEwma.length - 1]?.value ?? null;
                          const l = latestLong ?? longEwma?.[longEwma.length - 1]?.value ?? null;
                          let trendLabel: 'Bullish' | 'Bearish' | 'Sideways' = 'Sideways';
                          if (s != null && l != null) {
                            if (s > l + tol) trendLabel = 'Bullish';
                            else if (s < l - tol) trendLabel = 'Bearish';
                          } else if (trendClassification?.regime === 'up') {
                            trendLabel = 'Bullish';
                          } else if (trendClassification?.regime === 'down') {
                            trendLabel = 'Bearish';
                          }

                          const badgeClasses =
                            trendLabel === 'Bullish'
                              ? 'px-2 py-1 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400'
                              : trendLabel === 'Bearish'
                              ? 'px-2 py-1 rounded-full text-[10px] font-medium bg-rose-500/10 text-rose-400'
                              : 'px-2 py-1 rounded-full text-[10px] font-medium bg-slate-500/10 text-slate-400';

                          return <span className={badgeClasses}>{trendLabel}</span>;
                        })()}
                      </div>

                      {/* Header Row 2: Presets + Window Selectors */}
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2">
                        {/* Preset buttons */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {[
                            { id: 'short', label: 'Short-term' },
                            { id: 'medium', label: 'Medium-term' },
                            { id: 'long', label: 'Long-term' },
                          ].map(preset => (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => applyEwmaPreset(preset.id as EwmaPreset)}
                              className={`rounded-full px-2.5 py-1 border text-[11px] transition-colors ${
                                ewmaPreset === preset.id
                                  ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                                  : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                              }`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>

                        {/* Window selectors */}
                        <div className="flex items-center gap-2 text-[11px]">
                          <label className="flex items-center gap-1 text-slate-400">
                            <span>Short</span>
                            <select
                            value={shortWindow}
                            onChange={e => {
                                const next = Number(e.target.value) || shortWindow;
                                setShortWindow(next);
                                setEwmaPreset('custom');
                                onEwmaWindowChange?.(next, longWindow, 'custom');
                              }}
                              className="rounded-md border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-100 focus:outline-none focus:border-slate-500"
                            >
                              {[5, 10, 14, 20, 30, 50].map(v => (
                                <option key={v} value={v}>
                                  {v}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex items-center gap-1 text-slate-400">
                            <span>Long</span>
                            <select
                              value={longWindow}
                              onChange={e => {
                                const next = Number(e.target.value) || longWindow;
                                setLongWindow(next);
                                setEwmaPreset('custom');
                                onEwmaWindowChange?.(shortWindow, next, 'custom');
                              }}
                              className="rounded-md border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-100 focus:outline-none focus:border-slate-500"
                            >
                              {[20, 30, 50, 100, 200].map(v => (
                                <option key={v} value={v}>
                                  {v}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </div>
                      {/* (Trend description removed per user request) */}

                      {/* Last Crossover Info Block */}
                      {(() => {
                        const isGoldenDeathPair = shortWindow === 50 && longWindow === 200;
                        let crossoverLabel = '—';

                        if (lastEvent) {
                          const dir = lastEvent.direction;
                          if (isGoldenDeathPair && dir === 'bullish') {
                            crossoverLabel = 'Golden Cross';
                          } else if (isGoldenDeathPair && dir === 'bearish') {
                            crossoverLabel = 'Death Cross';
                          } else if (dir === 'bullish') {
                            crossoverLabel = 'Bullish crossover';
                          } else if (dir === 'bearish') {
                            crossoverLabel = 'Bearish crossover';
                          }
                        }

                        return (
                          <div className="mb-4 py-3 text-xs">
                            <div className="flex items-baseline justify-between">
                              <span className="text-slate-400">Last crossover</span>
                              <span className="font-mono text-slate-100">
                                {lastEvent ? lastEvent.date : '—'}
                                {lastEvent && lastEvent.daysAgo > 0 ? ` (${lastEvent.daysAgo}d ago)` : ''}
                              </span>
                            </div>
                            <div className="mt-1 flex items-baseline justify-between">
                              <span className="flex items-center gap-1 text-slate-400">
                                Type
                                <span className="relative group flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300">
                                  i
                                  <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-72 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-slate-200 shadow-lg group-hover:block">
                                    A bullish crossover happens when the short EWMA crosses above the long EWMA (trend turning up). A bearish crossover is the opposite. A Golden Cross is the special bullish crossover of 50 vs 200 periods; a Death Cross is the bearish 50 vs 200 crossover.
                                  </div>
                                </span>
                              </span>
                              <span className="text-slate-200">
                                {crossoverLabel}
                              </span>
                            </div>
                            {isGoldenDeathPair && !lastEvent && (
                              <p className="mt-2 text-[10px] text-slate-500">
                                50/200 pair: Golden Cross (bullish) or Death Cross (bearish)
                              </p>
                            )}
                          </div>
                        );
                      })()}

                      {/* Secondary Metrics */}
                      <dl className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <dt className="text-slate-500">Latest Price</dt>
                          <dd className="font-mono text-white">${trendClassification.latestPrice.toFixed(2)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-slate-400">Short EWMA ({shortWindow})</dt>
                          <dd className="font-mono text-slate-100">{formatPrice(shortEwmaValue)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-slate-400">Long EWMA ({longWindow})</dt>
                          <dd className="font-mono text-slate-100">{formatPrice(longEwmaValue)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-slate-500">Deviation</dt>
                          <dd className={`font-mono font-medium ${
                            priceBiasPct > 0 
                              ? 'text-emerald-400' 
                              : priceBiasPct < 0 
                                ? 'text-rose-400' 
                                : 'text-slate-400'
                          }`}>
                            {priceBiasPct >= 0 ? '+' : ''}
                            {(priceBiasPct * 100).toFixed(2)}%
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between">
                          <dt className="flex items-center gap-1 text-slate-400">
                            Level
                            <span className="relative group flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300">
                              i
                              <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-64 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-slate-200 shadow-lg group-hover:block">
                                Level measures how far the short and long EWMA are from each other compared to their recent history. Direction (bullish/bearish) comes from short minus long. The value in σ shows how unusual the current gap is: positive = larger than normal, negative = smaller than normal.
                              </div>
                            </span>
                          </dt>
                          <dd className="font-mono text-right text-slate-100">
                            {gapStats ? (
                              <>
                                <span
                                  className={
                                    gapStats.direction === 'bullish'
                                      ? 'text-emerald-400'
                                      : gapStats.direction === 'bearish'
                                        ? 'text-rose-400'
                                        : 'text-slate-300'
                                  }
                                >
                                  {gapStats.direction === 'bullish'
                                    ? 'Bullish'
                                    : gapStats.direction === 'bearish'
                                      ? 'Bearish'
                                      : 'Flat'}
                                </span>
                                <span className="ml-1 text-slate-400">
                                  (
                                  {gapStats.zScore >= 0 ? '+' : ''}
                                  {gapStats.zScore.toFixed(2)}σ
                                  {gapStats.slope === 'strengthening'
                                    ? ', strengthening'
                                    : gapStats.slope === 'fading'
                                      ? ', fading'
                                      : ''}
                                  )
                                </span>
                              </>
                            ) : (
                              '—'
                            )}
                          </dd>
                        </div>
                      </dl>

                    </div>
                  );
                })()}

                {/* ═══════════════════════════════════════════════════════════════
                    PRICE MOMENTUM CARD
                    Variables used:
                    - momentum.latest.momentumPct (primary metric)
                    - momentum.latest.momentum (absolute $ change)
                    - momentum.period (lookback)
                    - trendClassification.recentMomentum (EWMA-based recent return)
                ═══════════════════════════════════════════════════════════════ */}
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 md:p-6">
                  {(() => {
                    const latestMomentum = momentum?.latest ?? null;
                    const momentumPct = latestMomentum ? latestMomentum.momentumPct * 100 : null;
                    const momentumAbs = latestMomentum ? latestMomentum.momentum : null;
                    const score = momentum?.score ?? null;
                    const zone = momentum?.zone ?? null;
                    const regime = momentum?.regime ?? null;
                    const zeroCross = momentum?.lastZeroCross ?? null;

                    const formatPct = (v: number | null) =>
                      v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—';
                    const formatSignedCurrency = (v: number | null) =>
                      v != null ? `${v >= 0 ? '+' : ''}$${v.toFixed(2)}` : '—';
                    const formatScore = (v: number | null) =>
                      v != null ? v.toFixed(0) : '—';

                    const regimeLabel = (() => {
                      switch (regime) {
                        case 'strong_up':
                          return 'Strong Upward';
                        case 'up':
                          return 'Upward';
                        case 'strong_down':
                          return 'Strong Downward';
                        case 'down':
                          return 'Downward';
                        default:
                          return 'Flat / Neutral';
                      }
                    })();

                    const regimeColor =
                      regime === 'strong_up' || regime === 'up'
                        ? 'text-emerald-400'
                        : regime === 'strong_down' || regime === 'down'
                          ? 'text-rose-400'
                          : 'text-slate-300';

                    const regimeBadge =
                      regime === 'strong_up' || regime === 'up'
                        ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
                        : regime === 'strong_down' || regime === 'down'
                          ? 'border-rose-500/60 bg-rose-500/10 text-rose-300'
                          : 'border-slate-600 bg-slate-800 text-slate-300';

                    const zoneLabel =
                      zone === 'overbought'
                        ? 'Overbought (≥70)'
                        : zone === 'oversold'
                          ? 'Oversold (≤30)'
                          : 'Neutral (30–70)';

                    const zoneColor =
                      zone === 'overbought'
                        ? 'text-amber-400'
                        : zone === 'oversold'
                          ? 'text-sky-400'
                          : 'text-slate-300';

                    return (
                      <>
                        {/* Header */}
                        <div className="mb-5">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="relative group flex items-center gap-1">
                                <h4 className="text-sm font-semibold text-white">Price Momentum</h4>
                                <span className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-400 cursor-help">
                                  i
                                </span>
                                <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-80 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-slate-200 shadow-lg group-hover:block">
                                  <p className="mb-1">
                                    Momentum measures the <span className="font-semibold">rate of price change</span>—how fast and forcefully price is moving.
                                    Positive momentum means recent gains dominate; negative momentum means recent losses dominate.
                                  </p>
                                  <p className="mb-1">
                                    We compute momentum as the change (and % change) over a chosen look-back and map it to a 0–100 oscillator with overbought/oversold zones.
                                  </p>
                                  <p>
                                    Momentum can give early warnings and timing signals, but it also produces false or premature alerts in choppy markets, so it’s best used together with the EWMA trend card.
                                  </p>
                                </div>
                              </div>
                              {/* Removed inline lookback descriptor to simplify header per request */}
                            </div>
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium ${regimeBadge}`}>
                              {regimeLabel}
                            </span>
                          </div>

                          {/* Lookback buttons */}
                          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                            {[5, 10, 14, 30].map((p) => (
                              <button
                                key={p}
                                type="button"
                                onClick={() => {
                                  setMomentumPeriod(p);
                                  onMomentumPeriodChange?.(p);
                                }}
                                className={`rounded-full px-2.5 py-1 border text-[11px] transition-colors ${
                                  momentumPeriod === p
                                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                                    : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                                }`}
                              >
                                {p}d
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Metrics */}
                        <div className="mt-4">
                          <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-y-2.5 text-xs">
                            <div className="contents">
                              <dt className="text-slate-400">Momentum ({momentum?.period ?? momentumPeriod}D)</dt>
                              <dd className={`font-mono ${
                                momentumAbs != null
                                  ? momentumAbs > 0
                                    ? 'text-emerald-400'
                                    : momentumAbs < 0
                                      ? 'text-rose-400'
                                      : 'text-slate-300'
                                  : 'text-slate-600'
                              }`}>
                                {formatSignedCurrency(momentumAbs)}
                              </dd>
                            </div>
                            <div className="contents">
                              <dt className="text-slate-400">ROC ({momentum?.period ?? momentumPeriod}D)</dt>
                              <dd className={`font-mono ${
                                momentumPct != null
                                  ? momentumPct > 0
                                    ? 'text-emerald-400'
                                    : momentumPct < 0
                                      ? 'text-rose-400'
                                      : 'text-slate-300'
                                  : 'text-slate-600'
                              }`}>
                                {formatPct(momentumPct)}
                              </dd>
                            </div>
                            <div className="contents">
                              <dt className="text-slate-400">Momentum Score</dt>
                              <dd className="font-mono text-slate-200">
                                {formatScore(score)}
                              </dd>
                            </div>
                            <div className="contents">
                              <dt className="text-slate-400">Zone</dt>
                              <dd className={`font-mono ${zoneColor}`}>
                                {zoneLabel}
                              </dd>
                            </div>
                            <div className="contents">
                              <dt className="text-slate-400">Current Close</dt>
                              <dd className="font-mono text-slate-300">
                                {latestMomentum ? `$${latestMomentum.close.toFixed(2)}` : '—'}
                              </dd>
                            </div>
                            <div className="contents">
                              <dt className="text-slate-400">Recent EWMA Momentum</dt>
                              <dd className={`font-mono font-medium ${
                                trendClassification.recentMomentum > 0 
                                  ? 'text-emerald-400' 
                                  : trendClassification.recentMomentum < 0 
                                    ? 'text-rose-400' 
                                    : 'text-slate-400'
                              }`}>
                                {trendClassification.recentMomentum >= 0 ? '+' : ''}
                                {(trendClassification.recentMomentum * 100).toFixed(2)}%
                              </dd>
                            </div>
                          </dl>
                        </div>

                        {/* Signals (single-column, below Momentum Regime) - no border/background */}
                        <div className="mb-4">
                          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                            Signals
                          </h4>
                          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-y-1.5 text-xs">
                            <span className="text-slate-400">Zero-cross</span>
                            <span className="font-mono text-slate-100 text-right">
                              {zeroCross
                                ? `${zeroCross.direction === 'neg_to_pos' ? 'Positive' : 'Negative'} (${zeroCross.barsAgo} bars ago)`
                                : '—'}
                            </span>
                            
                            {/* ROC Divergence */}
                            {rocDivergence && (
                              <>
                                <span className="text-slate-400">ROC</span>
                                <span className="font-mono text-right">
                                  <span
                                    className={
                                      rocDivergence.type === 'bullish' ? 'text-emerald-400' : 'text-rose-400'
                                    }
                                  >
                                    {rocDivergence.type === 'bullish' ? 'Bullish' : 'Bearish'} ({rocDivergence.barsAgo} bars ago)
                                  </span>
                                </span>
                              </>
                            )}
                            
                            {/* RSI Divergence */}
                            {rsiDivergence && (
                              <>
                                <span className="text-slate-400">RSI</span>
                                <span className="font-mono text-right">
                                  <span
                                    className={
                                      rsiDivergence.type === 'bullish' ? 'text-emerald-400' : 'text-rose-400'
                                    }
                                  >
                                    {rsiDivergence.type === 'bullish' ? 'Bullish' : 'Bearish'} ({rsiDivergence.barsAgo} bars ago)
                                  </span>
                                </span>
                              </>
                            )}
                            
                            {/* MACD Divergence */}
                            {macdDivergence && (
                              <>
                                <span className="text-slate-400">MACD</span>
                                <span className="font-mono text-right">
                                  <span
                                    className={
                                      macdDivergence.type === 'bullish' ? 'text-emerald-400' : 'text-rose-400'
                                    }
                                  >
                                    {macdDivergence.type === 'bullish' ? 'Bullish' : 'Bearish'} ({macdDivergence.barsAgo} bars ago)
                                  </span>
                                </span>
                              </>
                            )}
                            
                            {/* ROC */}
                            <div className="mt-2 flex items-center gap-1.5 text-slate-400">
                              <span>ROC</span>
                              <span className="group relative inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300">
                                i
                                <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-64 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-slate-200 shadow-lg group-hover:block">
                                  ROC measures the percentage change over the selected look-back. ROC = Pₜ / Pₜ₋ₙ − 1. Above 0 implies bullish bias; below 0 bearish. We normalize ROC by its volatility to classify neutral vs strong moves.
                                </div>
                              </span>
                            </div>
                            <span className="font-mono text-right">
                              {rocMetrics ? (
                                <>
                                  <span
                                    className={
                                      rocMetrics.regime === 'strong_up' || rocMetrics.regime === 'up'
                                        ? 'text-emerald-400'
                                        : rocMetrics.regime === 'strong_down' || rocMetrics.regime === 'down'
                                          ? 'text-rose-400'
                                          : 'text-slate-300'
                                    }
                                  >
                                    {rocMetrics.regime === 'strong_up'
                                      ? 'Strong Upward'
                                      : rocMetrics.regime === 'up'
                                        ? 'Upward'
                                        : rocMetrics.regime === 'strong_down'
                                          ? 'Strong Downward'
                                          : rocMetrics.regime === 'down'
                                            ? 'Downward'
                                            : 'Neutral'}
                                  </span>
                                  {Number.isFinite(rocMetrics.zScore) && (
                                    <span className="ml-1 text-slate-400">
                                      ({rocMetrics.zScore >= 0 ? '+' : ''}
                                      {rocMetrics.zScore.toFixed(2)}σ)
                                    </span>
                                  )}
                                </>
                              ) : (
                                '—'
                              )}
                            </span>
                            {/* RSI */}
                            <div className="flex items-center gap-1.5 text-slate-400">
                              <span>RSI (14)</span>
                              <span className="group relative inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300">
                                i
                                <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-72 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-slate-200 shadow-lg group-hover:block">
                                  RSI is Wilder&apos;s 0–100 oscillator of gains vs losses over the last 14 bars. Above 70 is overbought, below 30 oversold, and 50 is the centerline. Crossing above 50 confirms bullish momentum; crossing below 50 confirms bearish momentum.
                                </div>
                              </span>
                            </div>
                            <span className="font-mono text-right">
                              {rsiMetrics ? (
                                <>
                                  <span
                                    className={
                                      rsiMetrics.band === 'overbought'
                                        ? 'text-amber-300'
                                        : rsiMetrics.band === 'oversold'
                                          ? 'text-sky-300'
                                          : 'text-slate-300'
                                    }
                                  >
                                    {rsiMetrics.band === 'overbought'
                                      ? 'Overbought'
                                      : rsiMetrics.band === 'oversold'
                                        ? 'Oversold'
                                        : 'Neutral'}
                                  </span>
                                  <span className="ml-1 text-slate-400">
                                    ({rsiMetrics.rsi.toFixed(1)})
                                  </span>
                                </>
                              ) : (
                                '—'
                              )}
                            </span>
                            {/* MACD */}
                            <div className="flex items-center gap-1.5 text-slate-400">
                              <span>MACD (12,26,9)</span>
                              <span className="group relative inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300">
                                i
                                <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-72 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-slate-200 shadow-lg group-hover:block">
                                  MACD compares the 12- and 26-period EMAs of price. MACD above 0 implies a bullish bias, below 0 a bearish bias. The signal line is a 9-period EMA of MACD; crossovers are timing signals. We normalize MACD by price (≈ % distance between the two EMAs) to classify neutral vs strong moves.
                                </div>
                              </span>
                            </div>
                            <span className="font-mono text-right">
                              {macdMetrics ? (
                                <>
                                  <span
                                    className={
                                      macdMetrics.regime === 'strong_up' || macdMetrics.regime === 'up'
                                        ? 'text-emerald-400'
                                        : macdMetrics.regime === 'strong_down' || macdMetrics.regime === 'down'
                                          ? 'text-rose-400'
                                          : 'text-slate-300'
                                    }
                                  >
                                    {macdMetrics.regime === 'strong_up'
                                      ? 'Strong Upward'
                                      : macdMetrics.regime === 'up'
                                        ? 'Upward'
                                        : macdMetrics.regime === 'strong_down'
                                          ? 'Strong Downward'
                                          : macdMetrics.regime === 'down'
                                            ? 'Downward'
                                            : 'Neutral'}
                                  </span>
                                  <span className="ml-1 text-slate-400">
                                    (norm {macdMetrics.macdNorm >= 0 ? '+' : ''}
                                    {(macdMetrics.macdNorm * 100).toFixed(2)}%)
                                  </span>
                                </>
                              ) : (
                                '—'
                              )}
                            </span>
                          </div>
                        </div>

                      </>
                    );
                  })()}
                </div>

                {/* ═══════════════════════════════════════════════════════════════
                    ADX (TREND STRENGTH) CARD
                    Variables used:
                    - adx.latest.adx (primary metric)
                    - adx.trendStrength (strength band label)
                    - adx.latest.plusDI, minusDI
                    - adx.period
                ═══════════════════════════════════════════════════════════════ */}
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-5 md:p-6">
                  {(() => {
                    const adxValue = adx?.latest?.adx ?? null;
                    const adxRegime = adx?.regime ?? null;
                    const adxSlope = adx?.slope ?? null;
                    const adxThresholdCross = adx?.lastThresholdCross ?? null;
                    const adxExtreme = adx?.extreme ?? null;

                    const adxPillLabel =
                      adx?.regime === 'range'
                        ? 'Range'
                        : adx?.regime === 'threshold_zone'
                          ? 'Threshold'
                          : adx?.regime === 'strong'
                            ? 'Strong'
                            : adx?.regime === 'very_strong'
                              ? 'Very strong'
                              : adx?.regime === 'extreme'
                                ? 'Extreme'
                                : adx?.regime === 'climax'
                                  ? 'Climax'
                                  : '—';

                    const regimeLabel = (() => {
                      switch (adxRegime) {
                        case 'range':
                          return 'Range / No strong trend';
                        case 'threshold_zone':
                          return 'Threshold zone (trend forming/fading)';
                        case 'strong':
                          return 'Strong trend';
                        case 'very_strong':
                          return 'Very strong trend';
                        case 'extreme':
                          return 'Extreme trend';
                        case 'climax':
                          return 'Overextended / climax trend';
                        default:
                          return '—';
                      }
                    })();

                    const regimeColor =
                      adxRegime === 'strong' || adxRegime === 'very_strong'
                        ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/60'
                        : adxRegime === 'extreme' || adxRegime === 'climax'
                          ? 'text-violet-300 bg-violet-500/10 border-violet-500/60'
                          : adxRegime === 'threshold_zone'
                            ? 'text-amber-300 bg-amber-500/10 border-amber-500/60'
                            : 'text-slate-300 bg-slate-800 border-slate-600';

                    const infoCopy = (
                      <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-80 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-slate-200 shadow-lg group-hover:block">
                        <p className="mb-1">
                          ADX measures <span className="font-semibold">trend strength, not direction</span>. It is built from Wilder&apos;s Directional Movement system (+DI/-DI) and ranges from 0 to 100.
                        </p>
                        <p className="mb-1">
                          Values below ~20 indicate a flat, choppy market; above ~25 a trending environment; 40–50+ means a very strong trend.
                        </p>
                        <p>
                          ADX rising = trend strength increasing; ADX falling = trend weakening (even if price still drifts up or down). We use ADX as a filter: only trust EWMA/Momentum trend signals when ADX is high enough.
                        </p>
                      </div>
                    );

                    return (
                      <>
                        {/* Header */}
                        <div className="mb-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="relative group flex items-center gap-1">
                                <h4 className="text-sm font-semibold text-white">Trend Strength (ADX)</h4>
                                <span className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-400 cursor-help">
                                  i
                                </span>
                                {infoCopy}
                              </div>
                            </div>
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium ${regimeColor}`}>
                              {adxPillLabel}
                            </span>
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                            {[7, 14, 21, 28].map((p) => (
                              <button
                                key={p}
                                type="button"
                                onClick={() => setAdxPeriod(p)}
                                className={`rounded-full px-2.5 py-1 border text-[11px] transition-colors ${
                                  adxPeriod === p
                                    ? 'border-violet-500 bg-violet-500/10 text-violet-300'
                                    : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                                }`}
                              >
                                {p}d
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Metrics */}
                        <div className="mt-4">
                          <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-y-2.5 text-xs">
                            <div className="contents">
                              <dt className="text-slate-400">ADX ({adx?.period ?? adxPeriod}D)</dt>
                              <dd className="font-mono text-slate-100">
                                {adxValue != null ? adxValue.toFixed(1) : '—'}
                              </dd>
                            </div>
                            <div className="contents">
                              <dt className="text-slate-400">ADX change ({adxSlope?.window ?? 5} bars)</dt>
                              <dd className="font-mono text-slate-100">
                                {adxSlope?.change != null
                                  ? `${adxSlope.change >= 0 ? '+' : ''}${adxSlope.change.toFixed(1)}`
                                  : '—'}
                              </dd>
                            </div>
                            <div className="contents">
                              <dt className="text-slate-400">+DI ({adx?.period ?? adxPeriod}D)</dt>
                              <dd className="font-mono text-emerald-400">
                                {adx?.latest ? adx.latest.plusDI.toFixed(1) : '—'}
                              </dd>
                            </div>
                            <div className="contents">
                              <dt className="text-slate-400">-DI ({adx?.period ?? adxPeriod}D)</dt>
                              <dd className="font-mono text-rose-400">
                                {adx?.latest ? adx.latest.minusDI.toFixed(1) : '—'}
                              </dd>
                            </div>
                            <div className="contents">
                              <dt className="flex items-center gap-1 text-slate-400">
                                DMI Direction
                                <span className="relative group flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300">
                                  i
                                  <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-64 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-slate-200 shadow-lg group-hover:block">
                                    Uptrend when +DI &gt; −DI, downtrend when −DI &gt; +DI.
                                  </div>
                                </span>
                              </dt>
                              <dd className="font-mono">
                                {adx?.latest
                                  ? adx.latest.plusDI > adx.latest.minusDI
                                    ? <span className="text-emerald-400">Uptrend</span>
                                    : <span className="text-rose-400">Downtrend</span>
                                  : '—'}
                              </dd>
                            </div>
                          </dl>
                        </div>

                        {/* Signals (single-column, below regime) - no border/background */}
                        <div className="mb-4">
                          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                            Signals
                          </h4>
                          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-y-1.5 text-xs">
                            <span className="flex items-center gap-1 text-slate-400">
                              Environment
                              <span className="relative group flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300">
                                i
                                <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-72 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-slate-200 shadow-lg group-hover:block">
                                  Trending when ADX is at or above 25. Below that the market is range-bound / non-trending and breakouts are less reliable.
                                </div>
                              </span>
                            </span>
                            <span className="font-mono text-slate-100 text-right max-w-[260px] leading-snug">
                              {adxValue == null ? '—' : adxValue >= 25 ? 'Trending' : 'Range-bound'}
                            </span>
                            <span className="text-slate-400">Threshold (25)</span>
                            <span className="font-mono text-slate-100 text-right">
                              {adxValue == null ? '—' : adxValue >= 25 ? 'Above' : 'Below'}
                            </span>
                            <span className="text-slate-400">ADX slope</span>
                            <span className="font-mono text-slate-100 text-right">
                              {adxSlope
                                ? adxSlope.direction === 'rising'
                                  ? 'Rising (strength increasing)'
                                  : adxSlope.direction === 'falling'
                                    ? 'Falling (trend weakening)'
                                    : 'Flat'
                                : '—'}
                            </span>
                            <span className="flex items-center gap-1 text-slate-400">
                              Last threshold cross
                              <span className="relative group flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300">
                                i
                                <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-64 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-slate-200 shadow-lg group-hover:block">
                                  Last cross above/below 25; value shows how many bars ago.
                                </div>
                              </span>
                            </span>
                            <span className="font-mono text-slate-100 text-right">
                              {adxThresholdCross ? `${adxThresholdCross.barsAgo} bars ago` : '—'}
                            </span>
                            <span className="flex items-center gap-1 text-slate-400">
                              Extreme state
                              <span className="relative group flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[10px] text-slate-300">
                                i
                                <div className="pointer-events-none absolute left-0 top-full z-10 mt-1 hidden w-64 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-[11px] text-slate-200 shadow-lg group-hover:block">
                                  Extreme now shows peak ADX if currently extreme; otherwise last peak.
                                </div>
                              </span>
                            </span>
                            <span className="font-mono text-slate-100 text-right max-w-[260px] leading-snug">
                              {adxExtreme
                                ? `${adxExtreme.peakAdx.toFixed(1)} on ${adxExtreme.peakDate}`
                                : 'None'}
                            </span>
                          </div>
                        </div>

                      </>
                    );
                  })()}
                </div>

              </div>
            </>
          )}

          {/* Empty state */}
          {!isLoadingAny && !combinedError && (!ewmaPath || ewmaPath.length === 0) && (
            <div className={`text-center py-8 rounded-xl ${
              isDarkMode ? 'bg-slate-900/40 text-slate-500' : 'bg-gray-50 text-gray-400'
            }`}>
              No EWMA data available for trend analysis
            </div>
          )}
        </>
      )}

      {/* ML Tab Content */}
      {activeTab === 'ml' && (
        <div className={`rounded-xl p-6 ${
          isDarkMode 
            ? 'bg-slate-900/60 border border-slate-700/50' 
            : 'bg-gray-50 border border-gray-200'
        }`}>
          <div className="text-center">
            <h4 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-slate-200' : 'text-gray-800'}`}>
              ML-Based Trend Analysis
            </h4>
            <p className={`text-sm mb-4 ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
              Machine learning models for trend detection coming soon.
            </p>
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs ${
              isDarkMode ? 'bg-slate-800 text-slate-400' : 'bg-gray-200 text-gray-500'
            }`}>
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Under Development
            </div>
          </div>
        </div>
      )}

      {/* AI Tab Content */}
      {activeTab === 'ai' && (
        <div className={`rounded-xl p-6 ${
          isDarkMode 
            ? 'bg-slate-900/60 border border-slate-700/50' 
            : 'bg-gray-50 border border-gray-200'
        }`}>
          <div className="text-center">
            <h4 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-slate-200' : 'text-gray-800'}`}>
              AI-Powered Trend Insights
            </h4>
            <p className={`text-sm mb-4 ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
              LLM-based trend reasoning and market commentary coming soon.
            </p>
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs ${
              isDarkMode ? 'bg-slate-800 text-slate-400' : 'bg-gray-200 text-gray-500'
            }`}>
              <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
              Under Development
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
