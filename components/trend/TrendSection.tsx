'use client';

import { useState, useEffect, useCallback } from 'react';
import { useDarkMode } from '@/lib/hooks/useDarkMode';
import { useTrendIndicators } from '@/lib/hooks/useTrendIndicators';
import useEwmaCrossover from '@/lib/hooks/useEwmaCrossover';

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
}: TrendSectionProps) {
  const isDarkMode = useDarkMode();

  // Tab state
  const [activeTab, setActiveTab] = useState<TrendTab>('traditional');
  const [momentumPeriod, setMomentumPeriod] = useState<number>(momentumPeriodOverride ?? 10);

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
    adxPeriod: 14,
  });

  const {
    priceSeries,
    shortEwma,
    longEwma,
    lastEvent,
    latestShort,
    latestLong,
    isLoading: ewmaCrossoverLoading,
    error: ewmaCrossoverError,
  } = useEwmaCrossover(ticker, shortWindow, longWindow);

  // Combined loading/error states
  const isLoadingAny = isLoading || indicatorsLoading || ewmaCrossoverLoading;
  const combinedError = error || indicatorsError || ewmaCrossoverError;

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
    <div className="mb-8">
      {/* Header with Tabs */}
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              Trend Analysis
            </h3>
            <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {activeTab === 'traditional' && `EWMA-based trend classification · H(d): ${horizon} · λ: 0.94`}
              {activeTab === 'ml' && 'Machine learning trend detection'}
              {activeTab === 'ai' && 'AI-powered trend insights'}
            </p>
          </div>
          
          {/* Tab Navigation */}
          <div className={`flex items-center gap-3 rounded-full p-1 ${
            isDarkMode ? 'bg-slate-800/50' : 'bg-gray-100'
          }`}>
            {(['traditional', 'ml', 'ai'] as TrendTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`
                  px-3 py-1.5 text-xs font-medium rounded-full transition-all
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
              {/* Indicator Status Bar */}
              <div className={`mb-4 px-4 py-2 rounded-lg flex flex-wrap items-center gap-4 text-xs ${
                isDarkMode ? 'bg-slate-800/50 border border-slate-700/50' : 'bg-gray-100 border border-gray-200'
              }`}>
                {/* Momentum summary */}
                <div className="flex items-center gap-2">
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-500'}>
                    Momentum({momentum?.period ?? momentumPeriod}):
                  </span>
                  {momentum?.latest ? (
                    <span className={`font-mono font-medium ${
                      momentum.latest.momentumPct > 0 
                        ? 'text-emerald-500' 
                        : momentum.latest.momentumPct < 0 
                          ? 'text-rose-500' 
                          : isDarkMode ? 'text-slate-300' : 'text-gray-600'
                    }`}>
                      {momentum.latest.momentumPct >= 0 ? '+' : ''}
                      {(momentum.latest.momentumPct * 100).toFixed(2)}%
                    </span>
                  ) : (
                    <span className={isDarkMode ? 'text-slate-600' : 'text-gray-400'}>—</span>
                  )}
                </div>

                {/* ADX summary */}
                <div className="flex items-center gap-2">
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-500'}>ADX(14):</span>
                  {adx?.latest ? (
                    <>
                      <span className={`font-mono font-medium ${
                        adx.latest.adx >= 40 
                          ? 'text-emerald-500' 
                          : adx.latest.adx >= 20 
                            ? isDarkMode ? 'text-slate-200' : 'text-gray-700'
                            : isDarkMode ? 'text-slate-500' : 'text-gray-400'
                      }`}>
                        {adx.latest.adx.toFixed(1)}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${
                        adx.trendStrength === 'very-strong' 
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : adx.trendStrength === 'strong'
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : adx.trendStrength === 'normal'
                              ? isDarkMode ? 'bg-slate-700 text-slate-300' : 'bg-gray-200 text-gray-600'
                              : isDarkMode ? 'bg-slate-800 text-slate-500' : 'bg-gray-100 text-gray-400'
                      }`}>
                        {adx.trendStrength?.replace('-', ' ')}
                      </span>
                    </>
                  ) : (
                    <span className={isDarkMode ? 'text-slate-600' : 'text-gray-400'}>—</span>
                  )}
                </div>

                {/* DI direction */}
                {adx?.latest && (
                  <div className="flex items-center gap-2">
                    <span className={isDarkMode ? 'text-slate-500' : 'text-gray-500'}>Direction:</span>
                    <span className={`font-medium ${
                      adx.latest.plusDI > adx.latest.minusDI ? 'text-emerald-500' : 'text-rose-500'
                    }`}>
                      {adx.latest.plusDI > adx.latest.minusDI ? '+DI > -DI (Bullish)' : '-DI > +DI (Bearish)'}
                    </span>
                  </div>
                )}
              </div>

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
                          </div>
                        </div>

                        {/* Trend badge: Bullish / Bearish / Neutral */}
                        {(() => {
                          const trendLabel =
                            trendClassification?.regime === 'up'
                              ? 'Bullish'
                              : trendClassification?.regime === 'down'
                              ? 'Bearish'
                              : 'Neutral';

                          const badgeClasses =
                            trendClassification?.regime === 'up'
                              ? 'px-2 py-1 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400'
                              : trendClassification?.regime === 'down'
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
                            crossoverLabel = 'Golden Cross (bullish)';
                          } else if (isGoldenDeathPair && dir === 'bearish') {
                            crossoverLabel = 'Death Cross (bearish)';
                          } else if (dir === 'bullish') {
                            crossoverLabel = 'Bullish crossover (short above long)';
                          } else if (dir === 'bearish') {
                            crossoverLabel = 'Bearish crossover (short below long)';
                          }
                        } else if (isGoldenDeathPair) {
                          crossoverLabel = '50/200 pair: Golden Cross (bullish) or Death Cross (bearish)';
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
                              <span className="text-slate-400">Type</span>
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
                        {ewmaSummary && (
                          <>
                            <div className="flex justify-between">
                              <dt className="text-slate-500">Coverage ({(ewmaSummary.targetCoverage * 100).toFixed(0)}%)</dt>
                              <dd className={`font-mono ${
                                Math.abs(ewmaSummary.coverage - ewmaSummary.targetCoverage) < 0.02
                                  ? 'text-emerald-400'
                                  : 'text-amber-400'
                              }`}>
                                {(ewmaSummary.coverage * 100).toFixed(1)}%
                              </dd>
                            </div>
                            <div className="flex justify-between">
                              <dt className="text-slate-500">Direction Hit Rate</dt>
                              <dd className={`font-mono ${
                                ewmaSummary.directionHitRate > 0.52
                                  ? 'text-emerald-400'
                                  : ewmaSummary.directionHitRate < 0.48
                                    ? 'text-rose-400'
                                    : 'text-slate-300'
                              }`}>
                                {(ewmaSummary.directionHitRate * 100).toFixed(1)}%
                              </dd>
                            </div>
                          </>
                        )}
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
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-6">
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
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center gap-2.5">
                            <span className={`w-3 h-3 rounded-sm ${
                              momentumPct != null && momentumPct > 0
                                ? 'bg-emerald-500'
                                : momentumPct != null && momentumPct < 0
                                  ? 'bg-rose-500'
                                  : 'bg-slate-500'
                            }`} />
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
                              <p className="text-[10px] text-slate-500">Lookback: {momentum?.period ?? momentumPeriod}d · Mode: Price change (Δ over n periods)</p>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                            {[5, 10, 14, 30].map((p) => (
                              <button
                                key={p}
                                type="button"
                                onClick={() => {
                                  setMomentumPeriod(p);
                                  onMomentumPeriodChange?.(p);
                                }}
                                className={`rounded-full px-2 py-1 border ${
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

                        {/* Primary Regime Block */}
                        <div className="mb-4">
                          <p className="text-xs text-slate-400">Momentum regime</p>
                          <p className={`mt-1 text-xl font-semibold ${regimeColor}`}>
                            {regimeLabel}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-1">
                            {latestMomentum
                              ? `${momentum?.period ?? momentumPeriod}D momentum is ${formatSignedCurrency(momentumAbs)} (${formatPct(momentumPct)}) → ${
                                  regimeLabel === 'Flat / Neutral'
                                    ? 'momentum is near the center line.'
                                    : regimeLabel.toLowerCase() + ' price thrust.'
                                }`
                              : 'Not enough data to compute momentum.'}
                          </p>
                        </div>

                        {/* Metrics + Signals */}
                        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)] text-xs sm:text-sm">
                          <dl className="space-y-2">
                            <div className="flex justify-between">
                              <dt className="text-slate-500">Momentum ({momentum?.period ?? momentumPeriod}D)</dt>
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
                            <div className="flex justify-between">
                              <dt className="text-slate-500">ROC ({momentum?.period ?? momentumPeriod}D)</dt>
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
                            <div className="flex justify-between">
                              <dt className="text-slate-500">Momentum Score</dt>
                              <dd className="font-mono text-slate-200">
                                {formatScore(score)}
                              </dd>
                            </div>
                            <div className="flex justify-between">
                              <dt className="text-slate-500">Zone</dt>
                              <dd className={`font-mono ${zoneColor}`}>
                                {zoneLabel}
                              </dd>
                            </div>
                            <div className="flex justify-between">
                              <dt className="text-slate-500">Current Close</dt>
                              <dd className="font-mono text-slate-300">
                                {latestMomentum ? `$${latestMomentum.close.toFixed(2)}` : '—'}
                              </dd>
                            </div>
                            <div className="flex justify-between">
                              <dt className="text-slate-500">Recent EWMA Momentum</dt>
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

                          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 sm:p-4">
                            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                              Signals
                            </h4>
                            <div className="space-y-1.5">
                              <div className="flex items-baseline justify-between">
                                <span className="text-slate-400">Zero-cross</span>
                                <span className="font-mono text-slate-100">
                                  {zeroCross
                                    ? `${zeroCross.direction === 'neg_to_pos' ? 'Negative → Positive' : 'Positive → Negative'} (${zeroCross.barsAgo} bars ago)`
                                    : '—'}
                                </span>
                              </div>
                              <div className="flex items-baseline justify-between">
                                <span className="text-slate-400">Band</span>
                                <span className="font-mono text-slate-100">
                                  {zoneLabel}
                                </span>
                              </div>
                              <div className="flex items-baseline justify-between">
                                <span className="text-slate-400">Divergence</span>
                                <span className="font-mono text-slate-300">
                                  None detected (TODO)
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <p className="mt-2 text-[10px] text-slate-500">
                          Momentum score is mapped to 0–100 with <span className="font-semibold">50</span> as the neutral
                          center line (30/70 as oversold/overbought bands).
                        </p>
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
                <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 sm:p-5">
                  {/* Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-3 h-3 rounded-sm ${
                        adx?.trendStrength === 'very-strong' || adx?.trendStrength === 'strong'
                          ? 'bg-emerald-500'
                          : adx?.trendStrength === 'normal'
                            ? 'bg-amber-500'
                            : 'bg-slate-500'
                      }`} />
                      <div>
                        <h4 className="text-sm font-semibold text-white">Trend Strength (ADX)</h4>
                        <p className="text-[10px] text-slate-500">Period: {adx?.period ?? 14}</p>
                      </div>
                    </div>
                    {/* Strength pill */}
                    {adx?.trendStrength ? (
                      <span className={`px-2 py-1 rounded-full text-[10px] font-medium uppercase ${
                        adx.trendStrength === 'very-strong'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : adx.trendStrength === 'strong'
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : adx.trendStrength === 'normal'
                              ? 'bg-amber-500/10 text-amber-400'
                              : 'bg-slate-700 text-slate-400'
                      }`}>
                        {adx.trendStrength.replace('-', ' ')}
                      </span>
                    ) : (
                      <span className="px-2 py-1 rounded-full text-[10px] font-medium bg-slate-800 text-slate-500">
                        N/A
                      </span>
                    )}
                  </div>

                  {/* Primary Metric */}
                  <div className="mb-4">
                    {adx?.latest ? (
                      <>
                        <div className={`text-2xl font-bold font-mono ${
                          adx.latest.adx >= 40 
                            ? 'text-emerald-400' 
                            : adx.latest.adx >= 20 
                              ? 'text-amber-400'
                              : 'text-slate-400'
                        }`}>
                          {adx.latest.adx.toFixed(1)}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {adx.latest.adx >= 60 
                            ? 'Extremely strong trend'
                            : adx.latest.adx >= 40 
                              ? 'Very strong trend'
                              : adx.latest.adx >= 20 
                                ? 'Moderate trend strength'
                                : 'Rangebound / low-strength trend'}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-2xl font-bold text-slate-600">—</div>
                        <div className="text-xs text-slate-600 mt-0.5">No data</div>
                      </>
                    )}
                  </div>

                  {/* Secondary Metrics */}
                  <dl className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <dt className="text-slate-500">+DI / -DI</dt>
                      <dd className="font-mono">
                        {adx?.latest ? (
                          <>
                            <span className="text-emerald-400">{adx.latest.plusDI.toFixed(1)}</span>
                            <span className="text-slate-600"> / </span>
                            <span className="text-rose-400">{adx.latest.minusDI.toFixed(1)}</span>
                          </>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Direction</dt>
                      <dd className={`font-medium ${
                        adx?.latest
                          ? adx.latest.plusDI > adx.latest.minusDI 
                            ? 'text-emerald-400' 
                            : 'text-rose-400'
                          : 'text-slate-600'
                      }`}>
                        {adx?.latest
                          ? adx.latest.plusDI > adx.latest.minusDI
                            ? '+DI > -DI (Bullish)'
                            : '-DI > +DI (Bearish)'
                          : '—'}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Strength Band</dt>
                      <dd className="text-slate-300">
                        {adx?.trendStrength === 'very-strong'
                          ? 'Very Strong (≥60)'
                          : adx?.trendStrength === 'strong'
                            ? 'Strong (40–60)'
                            : adx?.trendStrength === 'normal'
                              ? 'Normal (20–40)'
                              : adx?.trendStrength === 'weak'
                                ? 'Weak (<20)'
                                : '—'}
                      </dd>
                    </div>
                  </dl>
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
