'use client';

import { useState, useEffect, useCallback } from 'react';
import { useDarkMode } from '@/lib/hooks/useDarkMode';
import { useTrendIndicators } from '@/lib/hooks/useTrendIndicators';

// Tab type for trend analysis
type TrendTab = 'traditional' | 'ml' | 'ai';

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
}: TrendSectionProps) {
  const isDarkMode = useDarkMode();

  // Tab state
  const [activeTab, setActiveTab] = useState<TrendTab>('traditional');

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
    momentumPeriod: 10,
    adxPeriod: 14,
  });

  // Combined loading/error states
  const isLoadingAny = isLoading || indicatorsLoading;
  const combinedError = error || indicatorsError;

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
          <div className={`flex items-center gap-1 rounded-lg p-1 ${
            isDarkMode ? 'bg-slate-800/50' : 'bg-gray-100'
          }`}>
            {(['traditional', 'ml', 'ai'] as TrendTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`
                  px-3 py-1.5 text-xs font-medium rounded-md transition-all
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
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-500'}>Momentum(10):</span>
                  {momentum?.latest ? (
                    <span className={`font-mono font-medium ${
                      momentum.latest.momentumPct > 0 
                        ? 'text-emerald-500' 
                        : momentum.latest.momentumPct < 0 
                          ? 'text-rose-500' 
                          : isDarkMode ? 'text-slate-300' : 'text-gray-600'
                    }`}>
                      {momentum.latest.momentumPct >= 0 ? '+' : ''}{momentum.latest.momentumPct.toFixed(2)}%
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

              {/* Cards Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              
              {/* Regime Card */}
              <div className={`rounded-xl p-4 ${
                isDarkMode 
                  ? 'bg-slate-900/60 border border-slate-700/50' 
                  : 'bg-gray-50 border border-gray-200'
              }`}>
                <h4 className={`text-xs font-medium mb-3 uppercase tracking-wide ${
                  isDarkMode ? 'text-slate-500' : 'text-gray-500'
                }`}>Current Regime</h4>
                
                <div className="flex items-center gap-3">
                  <span className={`text-3xl ${getRegimeColor(trendClassification.regime)}`}>
                    {getRegimeIcon(trendClassification.regime)}
                  </span>
                  <div>
                    <div className={`text-xl font-semibold ${getRegimeColor(trendClassification.regime)}`}>
                      {getRegimeLabel(trendClassification.regime)}
                    </div>
                    <div className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
                      Strength: {(trendClassification.strengthScore * 50).toFixed(0)}%
                    </div>
                  </div>
                </div>
              </div>

              {/* Price vs EWMA Card */}
              <div className={`rounded-xl p-4 ${
                isDarkMode 
                  ? 'bg-slate-900/60 border border-slate-700/50' 
                  : 'bg-gray-50 border border-gray-200'
              }`}>
                <h4 className={`text-xs font-medium mb-3 uppercase tracking-wide ${
                  isDarkMode ? 'text-slate-500' : 'text-gray-500'
                }`}>Price vs EWMA</h4>
                
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>
                      Latest Price
                    </span>
                    <span className={`font-mono font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      ${trendClassification.latestPrice.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>
                      EWMA Center
                    </span>
                    <span className={`font-mono ${isDarkMode ? 'text-slate-300' : 'text-gray-700'}`}>
                      ${trendClassification.ewmaCenter.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>
                      Deviation
                    </span>
                    <span className={`font-mono font-medium ${
                      trendClassification.pricePctFromEwma > 0 
                        ? 'text-emerald-500' 
                        : trendClassification.pricePctFromEwma < 0 
                          ? 'text-rose-500' 
                          : isDarkMode ? 'text-slate-400' : 'text-gray-500'
                    }`}>
                      {trendClassification.pricePctFromEwma >= 0 ? '+' : ''}
                      {(trendClassification.pricePctFromEwma * 100).toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* EWMA Stats Card */}
              <div className={`rounded-xl p-4 ${
                isDarkMode 
                  ? 'bg-slate-900/60 border border-slate-700/50' 
                  : 'bg-gray-50 border border-gray-200'
              }`}>
                <h4 className={`text-xs font-medium mb-3 uppercase tracking-wide ${
                  isDarkMode ? 'text-slate-500' : 'text-gray-500'
                }`}>EWMA Statistics</h4>
                
                <div className="space-y-2">
                  {ewmaSummary && (
                    <>
                      <div className="flex justify-between items-center">
                        <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>
                          Coverage
                        </span>
                        <span className={`font-mono ${
                          Math.abs(ewmaSummary.coverage - ewmaSummary.targetCoverage) < 0.02
                            ? 'text-emerald-500'
                            : 'text-amber-500'
                        }`}>
                          {(ewmaSummary.coverage * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>
                          Direction Hit Rate
                        </span>
                        <span className={`font-mono ${
                          ewmaSummary.directionHitRate > 0.52
                            ? 'text-emerald-500'
                            : ewmaSummary.directionHitRate < 0.48
                              ? 'text-rose-500'
                              : isDarkMode ? 'text-slate-300' : 'text-gray-700'
                        }`}>
                          {(ewmaSummary.directionHitRate * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>
                          Interval Score
                        </span>
                        <span className={`font-mono ${isDarkMode ? 'text-slate-300' : 'text-gray-700'}`}>
                          {ewmaSummary.intervalScore.toFixed(3)}
                        </span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between items-center">
                    <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>
                      Recent Momentum
                    </span>
                    <span className={`font-mono font-medium ${
                      trendClassification.recentMomentum > 0 
                        ? 'text-emerald-500' 
                        : trendClassification.recentMomentum < 0 
                          ? 'text-rose-500' 
                          : isDarkMode ? 'text-slate-400' : 'text-gray-500'
                    }`}>
                      {trendClassification.recentMomentum >= 0 ? '+' : ''}
                      {(trendClassification.recentMomentum * 100).toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Momentum & ADX Card */}
              <div className={`rounded-xl p-4 ${
                isDarkMode 
                  ? 'bg-slate-900/60 border border-slate-700/50' 
                  : 'bg-gray-50 border border-gray-200'
              }`}>
                <h4 className={`text-xs font-medium mb-3 uppercase tracking-wide ${
                  isDarkMode ? 'text-slate-500' : 'text-gray-500'
                }`}>Momentum & ADX</h4>
                
                <div className="space-y-2">
                  {/* Momentum */}
                  <div className="flex justify-between items-center">
                    <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>
                      Momentum (10d)
                    </span>
                    {momentum?.latest ? (
                      <span className={`font-mono font-medium ${
                        momentum.latest.momentumPct > 0 
                          ? 'text-emerald-500' 
                          : momentum.latest.momentumPct < 0 
                            ? 'text-rose-500' 
                            : isDarkMode ? 'text-slate-300' : 'text-gray-600'
                      }`}>
                        {momentum.latest.momentumPct >= 0 ? '+' : ''}{momentum.latest.momentumPct.toFixed(2)}%
                      </span>
                    ) : (
                      <span className={`font-mono ${isDarkMode ? 'text-slate-600' : 'text-gray-400'}`}>—</span>
                    )}
                  </div>

                  {/* ADX Value */}
                  <div className="flex justify-between items-center">
                    <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>
                      ADX (14d)
                    </span>
                    {adx?.latest ? (
                      <span className={`font-mono font-medium ${
                        adx.latest.adx >= 40 
                          ? 'text-emerald-500' 
                          : adx.latest.adx >= 20 
                            ? isDarkMode ? 'text-slate-200' : 'text-gray-700'
                            : isDarkMode ? 'text-slate-500' : 'text-gray-400'
                      }`}>
                        {adx.latest.adx.toFixed(1)}
                      </span>
                    ) : (
                      <span className={`font-mono ${isDarkMode ? 'text-slate-600' : 'text-gray-400'}`}>—</span>
                    )}
                  </div>

                  {/* +DI / -DI */}
                  <div className="flex justify-between items-center">
                    <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>
                      +DI / -DI
                    </span>
                    {adx?.latest ? (
                      <span className="font-mono">
                        <span className="text-emerald-500">{adx.latest.plusDI.toFixed(1)}</span>
                        <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}> / </span>
                        <span className="text-rose-500">{adx.latest.minusDI.toFixed(1)}</span>
                      </span>
                    ) : (
                      <span className={`font-mono ${isDarkMode ? 'text-slate-600' : 'text-gray-400'}`}>—</span>
                    )}
                  </div>

                  {/* Trend Strength Badge */}
                  <div className="flex justify-between items-center">
                    <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>
                      Trend Strength
                    </span>
                    {adx?.trendStrength ? (
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${
                        adx.trendStrength === 'very-strong' 
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : adx.trendStrength === 'strong'
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : adx.trendStrength === 'normal'
                              ? isDarkMode ? 'bg-slate-700 text-slate-300' : 'bg-gray-200 text-gray-600'
                              : isDarkMode ? 'bg-slate-800 text-slate-500' : 'bg-gray-100 text-gray-400'
                      }`}>
                        {adx.trendStrength.replace('-', ' ')}
                      </span>
                    ) : (
                      <span className={`font-mono ${isDarkMode ? 'text-slate-600' : 'text-gray-400'}`}>—</span>
                    )}
                  </div>
                </div>
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
