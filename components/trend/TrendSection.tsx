'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
  horizon?: number;
  coverage?: number;
  shortWindowOverride?: number;
  longWindowOverride?: number;
  onEwmaWindowChange?: (
    shortWindow: number,
    longWindow: number,
    preset: EwmaPreset
  ) => void;
  momentumPeriodOverride?: number;
  onMomentumPeriodChange?: (period: number) => void;
  ewmaCrossoverOverride?: any;
  trendWeight?: number | null;
  trendWeightUpdatedAt?: string | null;
  // Legacy props for backward compatibility
  ewmaPath?: EwmaWalkerPathPoint[];
  ewmaSummary?: EwmaSummary;
  isLoadingEwma?: boolean;
  ewmaError?: string | null;
}

export default function TrendSection({
  ticker,
  horizon = 1,
  coverage,
  shortWindowOverride,
  longWindowOverride,
  onEwmaWindowChange,
  momentumPeriodOverride,
  onMomentumPeriodChange,
  ewmaCrossoverOverride,
  trendWeight: trendWeightProp,
  trendWeightUpdatedAt: trendWeightUpdatedAtProp,
  // Legacy props
  ewmaPath,
  ewmaSummary,
  isLoadingEwma,
  ewmaError,
}: TrendSectionProps) {
  const isDarkMode = useDarkMode();
  
  // Tabs & UI state
  const [activeTab, setActiveTab] = useState<TrendTab>('traditional');
  
  // Collapsible cards state
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  
  // EWMA Crossover state
  const [shortWindow, setShortWindow] = useState<number>(shortWindowOverride || 10);
  const [longWindow, setLongWindow] = useState<number>(longWindowOverride || 50);
  const [ewmaPreset, setEwmaPreset] = useState<EwmaPreset>('medium');
  const [showEwmaSettings, setShowEwmaSettings] = useState(false);
  
  // ADX state
  const [adxPeriod, setAdxPeriod] = useState<number>(14);
  
  // Use trend indicators hooks
  const {
    adx,
    isLoading: isLoadingTrendIndicators,
    error: trendError,
  } = useTrendIndicators(ticker, { adxPeriod });
  
  // Use EWMA crossover
  const ewmaCrossover = useEwmaCrossover(ticker, shortWindow, longWindow);
  
  // Extract EWMA trend data
  const trendWeight = trendWeightProp;
  const trendWeightUpdatedAt = trendWeightUpdatedAtProp;
  
  // Compute signal from EWMA crossover data
  const ewmaSignal = useMemo(() => {
    if (!ewmaCrossover.latestShort || !ewmaCrossover.latestLong) return 'neutral';
    return ewmaCrossover.latestShort > ewmaCrossover.latestLong ? 'bullish' : 'bearish';
  }, [ewmaCrossover.latestShort, ewmaCrossover.latestLong]);
  
  // Combined loading and error states
  const isLoadingAny = Boolean(
    isLoadingEwma || 
    isLoadingTrendIndicators ||
    ewmaCrossover.isLoading
  );
  
  const combinedError = ewmaError || trendError || ewmaCrossover.error;

  // Handle EWMA preset changes
  const handleEwmaPresetChange = useCallback(
    (preset: EwmaPreset) => {
      let short: number, long: number;
      switch (preset) {
        case 'short':
          short = 5;
          long = 20;
          break;
        case 'medium':
          short = 10;
          long = 50;
          break;
        case 'long':
          short = 20;
          long = 100;
          break;
        default:
          return; // custom - keep current values
      }
      
      setShortWindow(short);
      setLongWindow(long);
      setEwmaPreset(preset);
      onEwmaWindowChange?.(short, long, preset);
    },
    [onEwmaWindowChange]
  );

  // Tab configuration
  const tabs = [
    { key: 'traditional' as const, label: 'Traditional' },
    { key: 'ml' as const, label: 'ML' },
    { key: 'ai' as const, label: 'AI' },
  ];

  const handleCardClick = (cardId: string) => {
    setExpandedCard(expandedCard === cardId ? null : cardId);
  };

  return (
    <div className="mt-8">
      {/* Header */}
      <div className="mb-6">
        <h3 className={`text-xl font-semibold mb-3 ${
          isDarkMode ? 'text-slate-100' : 'text-gray-900'
        }`}>
          Trend Analysis
        </h3>
        
        {/* Tab Navigation */}
        <div className="flex space-x-1 mb-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === tab.key
                  ? isDarkMode
                    ? 'bg-slate-700 text-slate-100'
                    : 'bg-gray-200 text-gray-900'
                  : isDarkMode
                    ? 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Traditional Tab Content */}
      {activeTab === 'traditional' && (
        <div className="space-y-4 relative">
          {/* Loading indicator */}
          {isLoadingAny && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <div className="w-4 h-4 border-2 border-slate-600 border-t-slate-400 rounded-full animate-spin" />
              Loading trend data...
            </div>
          )}

          {/* Error display */}
          {combinedError && (
            <div className="p-4 rounded-lg border border-red-500/20 bg-red-500/5">
              <p className="text-red-400 text-sm">
                Error loading trend data: {combinedError}
              </p>
            </div>
          )}

          {/* EWMA Trend Card */}
          <div className="relative">
            <div
              onClick={() => handleCardClick('ewma-trend')}
              className="cursor-pointer rounded-2xl border border-slate-800 bg-transparent p-5 md:p-6 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-semibold text-white mb-3">EWMA Trend</h4>
                  {expandedCard !== 'ewma-trend' && (
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-slate-400">Short: {shortWindow}D</span>
                      <span className="text-slate-400">Long: {longWindow}D</span>
                      <span className={`px-2 py-1 rounded-full border text-xs font-medium ${
                        ewmaSignal === 'bullish' 
                          ? 'border-emerald-500/50 text-emerald-300 bg-emerald-500/10'
                          : ewmaSignal === 'bearish'
                          ? 'border-red-500/50 text-red-300 bg-red-500/10'
                          : 'border-slate-600 text-slate-400 bg-slate-800/50'
                      }`}>
                        {ewmaSignal === 'bullish' ? 'Bullish' : ewmaSignal === 'bearish' ? 'Bearish' : 'Neutral'}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowEwmaSettings(true);
                    }}
                    className="text-slate-400 hover:text-white transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>
                  <svg 
                    className={`w-4 h-4 text-slate-400 transition-transform ${expandedCard === 'ewma-trend' ? 'rotate-180' : ''}`} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>

            {/* EWMA Expanded Content */}
            {expandedCard === 'ewma-trend' && (
              <div className="absolute top-full left-0 right-0 z-10 mt-2 rounded-2xl border border-slate-800 bg-slate-950/95 backdrop-blur-sm p-6 shadow-2xl">
                <div className="space-y-4">
                  {/* EWMA Presets */}
                  <div className="flex flex-wrap gap-2">
                    {(['short', 'medium', 'long'] as const).map((preset) => (
                      <button
                        key={preset}
                        onClick={() => handleEwmaPresetChange(preset)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                          ewmaPreset === preset
                            ? 'bg-violet-500/20 text-violet-300 border border-violet-500/50'
                            : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-500 hover:text-slate-200'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>

                  {/* EWMA Metrics */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <dt className="text-xs text-slate-400">Short EWMA ({shortWindow}D)</dt>
                      <dd className="text-sm font-mono text-slate-100">
                        {ewmaCrossover.latestShort?.toFixed(2) || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">Long EWMA ({longWindow}D)</dt>
                      <dd className="text-sm font-mono text-slate-100">
                        {ewmaCrossover.latestLong?.toFixed(2) || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">Signal</dt>
                      <dd className={`text-sm font-medium ${
                        ewmaSignal === 'bullish' 
                          ? 'text-emerald-400'
                          : ewmaSignal === 'bearish'
                          ? 'text-red-400'
                          : 'text-slate-400'
                      }`}>
                        {ewmaSignal === 'bullish' ? 'Bullish' : ewmaSignal === 'bearish' ? 'Bearish' : 'Neutral'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">Last Cross</dt>
                      <dd className="text-sm font-mono text-slate-100">
                        {ewmaCrossover.lastEvent?.date || '—'}
                      </dd>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Price Momentum Card */}
          <div className="relative">
            <div
              onClick={() => handleCardClick('price-momentum')}
              className="cursor-pointer rounded-2xl border border-slate-800 bg-transparent p-5 md:p-6 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-white">Price Momentum</h4>
                <svg 
                  className={`w-4 h-4 text-slate-400 transition-transform ${expandedCard === 'price-momentum' ? 'rotate-180' : ''}`} 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              
              {expandedCard !== 'price-momentum' && (
                <div className="mt-3 flex items-center gap-4 text-xs">
                  <span className="text-slate-400">
                    Coming soon
                  </span>
                  <span className="px-2 py-1 rounded-full border border-slate-600 text-slate-400 bg-slate-800/50">
                    Under Development
                  </span>
                </div>
              )}
            </div>

            {/* Price Momentum Expanded Content */}
            {expandedCard === 'price-momentum' && (
              <div className="absolute top-full left-0 right-0 z-10 mt-2 rounded-2xl border border-slate-800 bg-slate-950/95 backdrop-blur-sm p-6 shadow-2xl">
                <div className="space-y-4">
                  <div className="text-center py-8">
                    <p className="text-slate-400 mb-2">Momentum oscillator coming soon</p>
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs bg-slate-800 text-slate-400">
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                      Under Development
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ADX Trend Strength Card */}
          <div className="relative">
            <div
              onClick={() => handleCardClick('adx-strength')}
              className="cursor-pointer rounded-2xl border border-slate-800 bg-transparent p-5 md:p-6 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-white">Trend Strength (ADX)</h4>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded-full border text-xs ${
                    adx?.regime === 'strong' || adx?.regime === 'very_strong'
                      ? 'border-emerald-500/50 text-emerald-300 bg-emerald-500/10'
                      : adx?.regime === 'extreme' || adx?.regime === 'climax'
                      ? 'border-violet-500/50 text-violet-300 bg-violet-500/10'
                      : adx?.regime === 'threshold_zone'
                      ? 'border-amber-500/50 text-amber-300 bg-amber-500/10'
                      : 'border-slate-600 text-slate-400 bg-slate-800/50'
                  }`}>
                    {adx?.regime === 'range' ? 'Range' :
                     adx?.regime === 'threshold_zone' ? 'Threshold' :
                     adx?.regime === 'strong' ? 'Strong' :
                     adx?.regime === 'very_strong' ? 'Very strong' :
                     adx?.regime === 'extreme' ? 'Extreme' :
                     adx?.regime === 'climax' ? 'Climax' : '—'}
                  </span>
                  <svg 
                    className={`w-4 h-4 text-slate-400 transition-transform ${expandedCard === 'adx-strength' ? 'rotate-180' : ''}`} 
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
              
              {expandedCard !== 'adx-strength' && (
                <div className="mt-3 flex items-center gap-4 text-xs">
                  <span className="text-slate-400">
                    ADX: {adx?.latest?.adx?.toFixed(1) || '—'}
                  </span>
                  <span className="text-slate-400">
                    Period: {adx?.period ?? adxPeriod}D
                  </span>
                </div>
              )}
            </div>

            {/* ADX Expanded Content */}
            {expandedCard === 'adx-strength' && (
              <div className="absolute top-full left-0 right-0 z-10 mt-2 rounded-2xl border border-slate-800 bg-slate-950/95 backdrop-blur-sm p-6 shadow-2xl">
                <div className="space-y-4">
                  {/* ADX Period Selection */}
                  <div className="flex flex-wrap gap-2">
                    {[7, 14, 21, 28].map((period) => (
                      <button
                        key={period}
                        onClick={() => setAdxPeriod(period)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                          adxPeriod === period
                            ? 'bg-violet-500/20 text-violet-300 border border-violet-500/50'
                            : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-500 hover:text-slate-200'
                        }`}
                      >
                        {period}d
                      </button>
                    ))}
                  </div>

                  {/* ADX Metrics */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <dt className="text-xs text-slate-400">ADX ({adx?.period ?? adxPeriod}D)</dt>
                      <dd className="text-sm font-mono text-slate-100">
                        {adx?.latest?.adx?.toFixed(1) || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">+DI</dt>
                      <dd className="text-sm font-mono text-emerald-400">
                        {adx?.latest?.plusDI?.toFixed(1) || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">-DI</dt>
                      <dd className="text-sm font-mono text-rose-400">
                        {adx?.latest?.minusDI?.toFixed(1) || '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-400">Direction</dt>
                      <dd className="text-sm font-medium">
                        {adx?.latest ? (
                          adx.latest.plusDI > adx.latest.minusDI ? (
                            <span className="text-emerald-400">Uptrend</span>
                          ) : (
                            <span className="text-rose-400">Downtrend</span>
                          )
                        ) : '—'}
                      </dd>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Empty state */}
          {!isLoadingAny && !combinedError && (!ewmaPath || ewmaPath.length === 0) && (
            <div className={`text-center py-8 rounded-xl border ${
              isDarkMode ? 'bg-transparent text-slate-500 border-slate-800/50' : 'bg-transparent text-gray-500 border-gray-200'
            }`}>
              No EWMA data available for trend analysis
            </div>
          )}
        </div>
      )}

      {/* ML Tab Content */}
      {activeTab === 'ml' && (
        <div className={`rounded-xl p-6 border ${
          isDarkMode 
            ? 'bg-transparent border-slate-700/50' 
            : 'bg-transparent border-gray-200'
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
        <div className={`rounded-xl p-6 border ${
          isDarkMode 
            ? 'bg-transparent border-slate-700/50' 
            : 'bg-transparent border-gray-200'
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

      {/* EWMA Settings Modal */}
      {showEwmaSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 w-80 max-w-sm mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">EWMA Settings</h3>
              <button
                onClick={() => setShowEwmaSettings(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="space-y-4">
              {/* Info section */}
              <div className="bg-slate-800/50 rounded-md p-3 text-xs text-slate-400 border border-slate-700/50">
                <div className="space-y-1">
                  <div>H(d): {horizon} · λ: 0.94</div>
                  {trendWeight != null && trendWeightUpdatedAt && (
                    <div>
                      Trend Weight: {(trendWeight as number).toFixed(3)} (updated {trendWeightUpdatedAt})
                    </div>
                  )}
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Short Window
                </label>
                <select
                  value={shortWindow}
                  onChange={e => {
                    const next = Number(e.target.value) || shortWindow;
                    setShortWindow(next);
                    setEwmaPreset('custom');
                    onEwmaWindowChange?.(next, longWindow, 'custom');
                  }}
                  className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 focus:outline-none focus:border-slate-500"
                >
                  {[5, 10, 14, 20, 30, 50].map(v => (
                    <option key={v} value={v}>
                      {v} days
                    </option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Long Window
                </label>
                <select
                  value={longWindow}
                  onChange={e => {
                    const next = Number(e.target.value) || longWindow;
                    setLongWindow(next);
                    setEwmaPreset('custom');
                    onEwmaWindowChange?.(shortWindow, next, 'custom');
                  }}
                  className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-slate-100 focus:outline-none focus:border-slate-500"
                >
                  {[20, 30, 50, 100, 200].map(v => (
                    <option key={v} value={v}>
                      {v} days
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowEwmaSettings(false)}
                  className="px-4 py-2 text-sm border border-slate-600 text-slate-300 rounded-md hover:bg-slate-800 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}