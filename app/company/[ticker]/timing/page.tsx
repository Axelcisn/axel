// cspell:words OHLC Delistings delisted ndist cooldown efron Backtest
'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { IngestionResult, CanonicalRow } from '@/lib/types/canonical';
import { TargetSpec, TargetSpecResult } from '@/lib/types/targetSpec';
import { ForecastRecord } from '@/lib/forecast/types';
import { EventRecord } from '@/lib/events/types';
import { AlertFire } from '@/lib/watchlist/types';
import { RepairRecord } from '@/lib/types/canonical';
import { GbmForecast } from '@/lib/storage/fsStore';
import AlertsCard from '@/components/AlertsCard';
import { QAPanel } from '@/components/QAPanel';
import { EnhancedRepairsPanel } from '@/components/EnhancedRepairsPanel';
import { GbmForecastInspector } from '@/components/GbmForecastInspector';
import { GarchForecastInspector } from '@/components/GarchForecastInspector';
import { RangeForecastInspector } from '@/components/RangeForecastInspector';
import { formatTicker, getAllExchanges, getExchangesByRegion, getExchangeInfo } from '@/lib/utils/formatTicker';
import { parseExchange, normalizeTicker } from '@/lib/utils/parseExchange';
import { CompanyInfo, ExchangeOption } from '@/lib/types/company';
import { useDarkMode } from '@/lib/hooks/useDarkMode';
import { useAutoCleanupForecasts, extractFileIdFromPath } from '@/lib/hooks/useAutoCleanupForecasts';
import { resolveBaseMethod } from '@/lib/forecast/methods';
import { PriceChart, EwmaSummary, EwmaReactionMapDropdownProps, EwmaWalkerPathPoint } from '@/components/PriceChart';
import { useTrendIndicators } from '@/lib/hooks/useTrendIndicators';
import {
  Trading212CfdConfig,
  Trading212SimBar,
  Trading212Signal,
  Trading212SimulationResult,
  Trading212Trade,
  Trading212AccountSnapshot,
  simulateTrading212Cfd,
} from '@/lib/backtest/trading212Cfd';
import {
  fetchT212Trades,
  fetchT212PairedTrades,
  convertSimpleTradesToOverlay,
  mapSymbolToT212Ticker,
  T212SimpleTrade,
  T212PairedTrade,
  PairedTradesSummary,
  RealTradesOverlay,
} from '@/lib/trading212/tradesClient';
import { TickerSearch } from '@/components/TickerSearch';
import { MarketSessionBadge } from '@/components/MarketSessionBadge';
import TrendSection from '@/components/trend/TrendSection';
import useEwmaCrossover from '@/lib/hooks/useEwmaCrossover';

/**
 * Data flow (Timing/Trend):
 * UI controls (Horizon, Coverage, Vol Model, EWMA mode, Window) → local state in this page
 * → request bodies/queries to /api/volatility/[symbol] and EWMA routes (h/coverage/window/model/λ)
 * → server model functions (GBM/GARCH/HAR/Range/ewmaWalker) compute intervals
 * → responses update active/base forecasts and EWMA paths → passed into PriceChart for rendering.
 */

// Badge component interface and implementation
interface BadgeProps {
  label: string;
  status: boolean;
}

function Badge({ label, status }: BadgeProps) {
  return (
    <div className="flex items-center space-x-2">
      <span className="text-sm font-medium">{label}:</span>
      <span className={`px-2 py-1 rounded text-sm ${
        status 
          ? 'bg-green-100 text-green-800' 
          : 'bg-red-100 text-red-800'
      }`}>
        {status ? 'OK' : 'FAIL'}
      </span>
    </div>
  );
}

// Client-side type for gates status
type GateStatus = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

// Result types for pipeline functions
interface VolForecastResult {
  ok: boolean;
  forecast: any | null;   // ForecastRecord-like object
}

interface BaseForecastsResult {
  ok: boolean;
  baseForecastCount: number;
}

// Centralized forecast pipeline status
type ForecastStatus = "idle" | "loading" | "ready" | "error";

// Model score type for recommendations table
interface ModelScoreLite {
  model: string;
  score: number;
  metrics: {
    alpha: number;
    n: number;
    intervalScore: number;
    empiricalCoverage: number;
    coverageError: number;
    avgWidthBp: number;
    kupiecPValue: number;
    ccPValue: number;
    trafficLight: "green" | "yellow" | "red";
  };
  noData?: boolean;             // true when we have no real PI metrics
}

// Enhanced upload validation summary types
interface ValidationSummary {
  ok: boolean;
  mode?: 'replace' | 'incremental'; // Processing mode used
  file: {
    name: string;
    hash: string;
    rows: number;
    sizeBytes: number;
  };
  dateRange: {
    first: string; // YYYY-MM-DD
    last: string;  // YYYY-MM-DD
  };
  validation: {
    ohlcCoherence: { failCount: number };
    missingDays: { 
      consecutiveMax: number; 
      totalMissing: number; 
      blocked: boolean;
      thresholds: { maxConsecutive: number; maxTotal: number };
    };
    duplicates: { count: number };
    corporateActions: { splits: number; dividends: number };
    outliers: { flagged: number };
  };
  provenance: {
    vendor: 'yahoo' | 'bloomberg' | 'refinitiv' | 'unknown';
    mappingId: string;
    processedAt: string; // ISO-8601
  };
}

type TrendEwmaPreset = 'short' | 'medium' | 'long' | 'custom';

interface TimingPageProps {
  params: {
    ticker: string;
  };
}

export default function TimingPage({ params }: TimingPageProps) {
  // Dark mode hook
  const isDarkMode = useDarkMode();
  
  // Auto-cleanup hook for generated forecast files
  const { trackGeneratedFile, cleanupTrackedFiles } = useAutoCleanupForecasts(params.ticker);
  
  // Server-confirmed Target Spec (what the API route reads)  
  const [serverTargetSpec, setServerTargetSpec] = useState<any | null>(null);
  const [isLoadingServerSpec, setIsLoadingServerSpec] = useState(false);
  const tickerParam = params.ticker; // NEVER shadow this

  const [uploadResult, setUploadResult] = useState<IngestionResult | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Target Spec state
  const [targetSpecResult, setTargetSpecResult] = useState<TargetSpecResult | null>(null);
  const [h, setH] = useState(1);
  const [coverage, setCoverage] = useState(0.95);
  const [isSavingTarget, setIsSavingTarget] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [trendMomentumPeriod, setTrendMomentumPeriod] = useState(10);
  const [trendShortWindow, setTrendShortWindow] = useState(14);
  const [trendLongWindow, setTrendLongWindow] = useState(50);

  // GBM Forecast state
  const [currentForecast, setCurrentForecast] = useState<GbmForecast | ForecastRecord | null>(null);
  
  // Separate sources so GBM card never shows volatility records
  const [gbmForecast, setGbmForecast] = useState<any | null>(null);
  
  // Volatility forecast state (last volatility model run)
  const [volForecast, setVolForecast] = useState<any | null>(null);

  // Base forecast for conformal (internal, not displayed until conformal is applied)
  const [baseForecast, setBaseForecast] = useState<any | null>(null);

  // Current price state for header display
  const [headerPrice, setHeaderPrice] = useState<{ price: number | null; date: string | null }>({ price: null, date: null });

  // Single source for what the "Final Prediction Intervals" card shows
  const [activeForecast, setActiveForecast] = useState<any | null>(null);
  
  // Track forecast changes for debugging
  const forecastChangeLog = useRef<Array<{timestamp: number, action: string, forecast: any}>>([]);
  const logForecastChange = (action: string, forecast: any) => {
    const entry = {timestamp: Date.now(), action, forecast: forecast ? {method: forecast.method, date_t: forecast.date_t} : null};
    forecastChangeLog.current.push(entry);
    console.log('[FORECAST_CHANGE_LOG]', entry);
    // Keep only last 10 entries
    if (forecastChangeLog.current.length > 10) {
      forecastChangeLog.current = forecastChangeLog.current.slice(-10);
    }
  };
  
  // Wrap setActiveForecast to add logging
  const setActiveForecastWithLogging = useCallback((forecast: any) => {
    logForecastChange('setActiveForecast called', forecast);
    setActiveForecast(forecast);
  }, []);
  
  // Debug: Monitor activeForecast changes for forecast overlay
  useEffect(() => {
    const timestamp = new Date().toISOString();
    console.log(`[FORECAST_OVERLAY_DEBUG] ${timestamp} activeForecast changed:`, {
      hasActiveForecast: !!activeForecast,
      activeForecastKeys: activeForecast ? Object.keys(activeForecast) : null,
      hasIntervals: !!activeForecast?.intervals,
      intervalKeys: activeForecast?.intervals ? Object.keys(activeForecast.intervals) : null,
      hasConformal: !!activeForecast?.conformal,
      method: activeForecast?.method || 'none',
      date_t: activeForecast?.date_t || 'none',
      stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
    });
  }, [activeForecast]);

  const { priceSeries: headerPriceSeries, shortEwma: trendShortEwma, longEwma: trendLongEwma } = useEwmaCrossover(
    params.ticker,
    trendShortWindow,
    trendLongWindow
  );

  // Stable forecast overlay state - use the best available forecast for chart display
  const stableOverlayForecast = useMemo(() => {
    // Priority: activeForecast > currentForecast > gbmForecast
    const forecast = activeForecast || currentForecast || gbmForecast || null;
    
    // Persist to localStorage as backup (only on client side)
    if (forecast) {
      // Use a setTimeout to avoid SSR issues
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(`overlay-forecast-${params.ticker}`, JSON.stringify(forecast));
          } catch (e) {
            // Ignore localStorage errors
          }
        }
      }, 0);
    }
    
    return forecast;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeForecast, currentForecast, gbmForecast, params.ticker]);
  // Note: 'window' is a browser global, not a React dependency

  // Use useState for localStorage fallback to handle SSR properly
  const [storedForecast, setStoredForecast] = useState<any>(null);
  
  // Load stored forecast on client side only
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(`overlay-forecast-${params.ticker}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          setStoredForecast(parsed);
          console.log('[FallbackForecast] Loaded stored forecast from localStorage:', parsed.method, parsed.date_t);
        }
      } catch (e) {
        // Ignore localStorage errors
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.ticker]);
  // Note: 'window' is a browser global, not a React dependency

  // Fallback overlay forecast 
  const fallbackOverlayForecast = useMemo(() => {
    return stableOverlayForecast || storedForecast || null;
  }, [stableOverlayForecast, storedForecast]);

  const [window, setWindow] = useState(504);
  const [lambdaDrift, setLambdaDrift] = useState(0.25);
  const [isGeneratingForecast, setIsGeneratingForecast] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);

  // Volatility Model state
  const [volModel, setVolModel] = useState<'GBM' | 'GARCH' | 'HAR-RV' | 'Range'>('GBM');
  const [garchEstimator, setGarchEstimator] = useState<'Normal' | 'Student-t'>('Normal');
  const [rangeEstimator, setRangeEstimator] = useState<'P' | 'GK' | 'RS' | 'YZ'>('P');
  const [garchVarianceTargeting, setGarchVarianceTargeting] = useState(true);
  const [garchDf, setGarchDf] = useState(8);
  const [harUseIntradayRv, setHarUseIntradayRv] = useState(true);
  const [rangeEwmaLambda, setRangeEwmaLambda] = useState(0.94);
  
  // GBM state for volatility models (separate from standalone GBM card)
  const [gbmWindow, setGbmWindow] = useState<number>(504);
  const [gbmLambda, setGbmLambda] = useState<number>(0);
  
  // Volatility window state - defaults to 1000 for GARCH, can be manually set or synced with GBM
  const [volWindow, setVolWindow] = useState(1000);
  const [volWindowAutoSync, setVolWindowAutoSync] = useState(false); // Default to manual (1000) not auto-sync
  const [rvAvailable, setRvAvailable] = useState<boolean>(false);
  const [isGeneratingVolatility, setIsGeneratingVolatility] = useState(false);
  const [volatilityError, setVolatilityError] = useState<string | null>(null);
  
  // Track when horizon changes but forecast hasn't been regenerated
  const [forecastHorizonMismatch, setForecastHorizonMismatch] = useState(false);

  // EWMA Walker diagnostics state
  type EwmaWalkerPathPoint = {
    date_t: string;
    date_tp1: string;
    S_t: number;
    S_tp1: number;
    y_hat_tp1: number;
    L_tp1: number;
    U_tp1: number;
  };

  const [ewmaSummary, setEwmaSummary] = useState<EwmaSummary | null>(null);
  const [ewmaPath, setEwmaPath] = useState<EwmaWalkerPathPoint[] | null>(null);
  const [isLoadingEwma, setIsLoadingEwma] = useState(false);
  const [ewmaError, setEwmaError] = useState<string | null>(null);

  // EWMA Biased (tilted) state
  const [ewmaBiasedSummary, setEwmaBiasedSummary] = useState<EwmaSummary | null>(null);
  const [ewmaBiasedPath, setEwmaBiasedPath] = useState<EwmaWalkerPathPoint[] | null>(null);
  const [isLoadingEwmaBiased, setIsLoadingEwmaBiased] = useState(false);
  const [ewmaBiasedError, setEwmaBiasedError] = useState<string | null>(null);

  // EWMA Reaction Map state
  type ReactionBucketSummary = {
    bucketId: string;
    horizon: number;
    nObs: number;
    pUp: number;
    meanReturn: number;
    stdReturn: number;
  };

  type ReactionMapSummary = {
    trainStart: string;
    trainEnd: string;
    testStart: string;
    testEnd: string;
    nTrain: number;
    nTest: number;
    buckets: ReactionBucketSummary[];
  };

  const [reactionMapSummary, setReactionMapSummary] = useState<ReactionMapSummary | null>(null);
  const [isLoadingReaction, setIsLoadingReaction] = useState(false);
  const [reactionError, setReactionError] = useState<string | null>(null);
  const [reactionLambda, setReactionLambda] = useState(0.94);
  // Coverage and Horizon for Reaction Map now come from main controls:
  // - coverage (main Timing coverage)
  // - h (main Timing horizon)
  const [reactionTrainFraction, setReactionTrainFraction] = useState(0.7);
  const [reactionMinTrainObs, setReactionMinTrainObs] = useState(500);

  // EWMA Optimization state (Maximize button)
  type EwmaOptimizationCandidate = {
    lambda: number;
    trainFraction: number;
    directionHitRate: number;
    coverage: number;
    intervalScore: number;
    avgWidth: number;
    neutralDirectionHitRate: number;
    neutralIntervalScore: number;
  };

  const [reactionOptimizationBest, setReactionOptimizationBest] = useState<EwmaOptimizationCandidate | null>(null);
  const [reactionOptimizationCandidates, setReactionOptimizationCandidates] = useState<EwmaOptimizationCandidate[]>([]);

  // Neutral baseline for "Rank 0" row in optimization table
  type EwmaOptimizationNeutralSummary = {
    lambda: number;
    directionHitRate: number;
    intervalScore: number;
    coverage: number;
    avgWidth: number;
  };
  const [reactionOptimizationNeutral, setReactionOptimizationNeutral] =
    useState<EwmaOptimizationNeutralSummary | null>(null);

  const [isOptimizingReaction, setIsOptimizingReaction] = useState(false);
  const [isReactionMaximized, setIsReactionMaximized] = useState(false);  // Track if Biased has been optimized
  const [reactionOptimizeError, setReactionOptimizeError] = useState<string | null>(null);
  type EwmaMode = 'unbiased' | 'biased' | 'max';
  const [activeEwmaMode, setActiveEwmaMode] = useState<EwmaMode>('max');

  // Trading212 CFD Simulation state
  const [isCfdEnabled, setIsCfdEnabled] = useState(false);  // CFD simulation toggle
  const [t212DateRange, setT212DateRange] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });  // Date range filter for simulation
  
  // Memoized callback for date range changes to avoid infinite loops
  const handleDateRangeChange = useCallback((start: string | null, end: string | null) => {
    setT212DateRange(prev => {
      // Only update if values actually changed
      if (prev.start === start && prev.end === end) return prev;
      return { start, end };
    });
  }, []);
  
  const [t212InitialEquity, setT212InitialEquity] = useState(5000);
  const [t212Leverage, setT212Leverage] = useState(5);
  const [t212PositionFraction, setT212PositionFraction] = useState(0.25); // 25% default
  const [t212ThresholdPct, setT212ThresholdPct] = useState(0.0); // signal threshold
  const [t212DailyLongSwap, setT212DailyLongSwap] = useState(0);  // can tune later
  const [t212DailyShortSwap, setT212DailyShortSwap] = useState(0);
  const [isRunningT212Sim, setIsRunningT212Sim] = useState(false);
  const [t212Error, setT212Error] = useState<string | null>(null);
  const [t212CanonicalRows, setT212CanonicalRows] = useState<CanonicalRow[] | null>(null);
  const modeToRunId = useCallback((mode: EwmaMode): T212RunId => {
    switch (mode) {
      case 'unbiased':
        return 'ewma-unbiased';
      case 'biased':
        return 'ewma-biased';
      case 'max':
        return 'ewma-biased-max';
    }
  }, []);
  const runIdToMode = useCallback((runId: T212RunId): EwmaMode | null => {
    switch (runId) {
      case 'ewma-unbiased':
        return 'unbiased';
      case 'ewma-biased':
        return 'biased';
      case 'ewma-biased-max':
        return 'max';
      default:
        return null;
    }
  }, []);

  // Trading212 Simulation Runs - multiple scenarios for comparison
  type T212RunId = "ewma-unbiased" | "ewma-biased" | "ewma-biased-max";

  type Trading212SimRun = {
    id: T212RunId;
    label: string;
    signalSource: "unbiased" | "biased";
    result: Trading212SimulationResult;
    lambda?: number;
    trainFraction?: number;
  };

  // Type for trade overlays passed to PriceChart
  type Trading212TradeOverlay = {
    runId: T212RunId;
    label: string;
    color: string; // hex color for this run
    trades: Trading212Trade[];
  };

  const [t212Runs, setT212Runs] = useState<Trading212SimRun[]>([]);
  const [t212CurrentRunId, setT212CurrentRunId] = useState<T212RunId | null>(null);
  const [t212VisibleRunIds, setT212VisibleRunIds] = useState<Set<T212RunId>>(() => new Set());

  // State for real Trading212 trades (from actual account history)
  const [realT212Trades, setRealT212Trades] = useState<T212SimpleTrade[]>([]);
  const [realT212PairedTrades, setRealT212PairedTrades] = useState<T212PairedTrade[]>([]);
  const [realT212Summary, setRealT212Summary] = useState<PairedTradesSummary | null>(null);
  const [realTradesLoading, setRealTradesLoading] = useState(false);
  const [showRealTrades, setShowRealTrades] = useState(true); // Toggle visibility of real trades
  const { momentum: chartMomentum, adx: chartAdx } = useTrendIndicators(params.ticker, { momentumPeriod: trendMomentumPeriod });

  // State for Yahoo Finance sync
  const [isYahooSyncing, setIsYahooSyncing] = useState(false);
  const [yahooSyncError, setYahooSyncError] = useState<string | null>(null);

  // Toggle visibility of a T212 run on the chart (solo mode: only one run visible at a time)
  const toggleT212RunVisibility = useCallback((runId: T212RunId) => {
    // Always force solo selection and sync EWMA mode
    const mappedMode = runIdToMode(runId);
    if (mappedMode) {
      setActiveEwmaMode(mappedMode);
    }
    setT212VisibleRunIds(new Set<T212RunId>([runId]));
  }, [runIdToMode]);

  // Build overlay for real trades (if enabled and available)
  const realTradesOverlay: RealTradesOverlay | null = useMemo(() => {
    if (!showRealTrades || realT212Trades.length === 0) {
      return null;
    }
    return convertSimpleTradesToOverlay(realT212Trades, {
      runId: "real-trades",
      label: "Real Trades",
      color: "#10B981", // emerald-500
    });
  }, [showRealTrades, realT212Trades]);

  // Build trade overlays for visible runs to pass to PriceChart
  const t212TradeOverlays: Trading212TradeOverlay[] = useMemo(() => {
    const runColors: Record<T212RunId, string> = {
      "ewma-unbiased": "#9CA3AF",     // gray-400
      "ewma-biased": "#3B82F6",       // blue-500
      "ewma-biased-max": "#F59E0B",   // amber-500
    };
    const simOverlays = t212Runs
      .filter((run) => t212VisibleRunIds.has(run.id))
      .map((run) => ({
        runId: run.id,
        label: run.label,
        color: runColors[run.id],
        trades: run.result.trades,
      }));
    
    // Include real trades overlay if available and enabled
    if (realTradesOverlay) {
      return [
        ...simOverlays,
        {
          runId: realTradesOverlay.runId as T212RunId, // cast for compatibility
          label: realTradesOverlay.label,
          color: realTradesOverlay.color,
          trades: realTradesOverlay.trades,
        },
      ];
    }
    
    return simOverlays;
  }, [t212Runs, t212VisibleRunIds, realTradesOverlay]);

  // Get the account history for the currently visible T212 run (for equity chart)
  const t212AccountHistory: Trading212AccountSnapshot[] | null = useMemo(() => {
    // Find the first visible run (we only show one at a time in solo mode)
    const visibleRun = t212Runs.find((run) => t212VisibleRunIds.has(run.id));
    return visibleRun?.result.accountHistory ?? null;
  }, [t212Runs, t212VisibleRunIds]);

  // Keep visible run in sync with active EWMA mode and available runs
  useEffect(() => {
    const desiredRunId = modeToRunId(activeEwmaMode);
    const hasDesired = t212Runs.some((r) => r.id === desiredRunId);
    if (hasDesired) {
      setT212VisibleRunIds(new Set<T212RunId>([desiredRunId]));
      return;
    }
    // If desired not available yet but we have runs and none visible, pick the first
    if (t212Runs.length > 0 && t212VisibleRunIds.size === 0) {
      const fallbackId = t212Runs[0].id;
      const fallbackMode = runIdToMode(fallbackId);
      if (fallbackMode) {
        setActiveEwmaMode(fallbackMode);
      }
      setT212VisibleRunIds(new Set<T212RunId>([fallbackId]));
    }
  }, [activeEwmaMode, modeToRunId, runIdToMode, t212Runs, t212VisibleRunIds.size]);

  // Prepare table rows for real T212 paired trades (with holding period)
  const realT212TradeRows = useMemo(() => {
    if (!realT212PairedTrades || realT212PairedTrades.length === 0) return [];

    return realT212PairedTrades.map((t) => {
      // Compute holding period in days if both dates exist
      let holdingDays: number | null = null;
      if (t.entryDate && t.exitDate) {
        const start = new Date(t.entryDate);
        const end = new Date(t.exitDate);
        const diffMs = end.getTime() - start.getTime();
        holdingDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      }

      return {
        ...t,
        holdingDays,
      };
    });
  }, [realT212PairedTrades]);

  // Fetch real Trading212 trades for this symbol on mount
  useEffect(() => {
    const canonicalSymbol = params.ticker.toUpperCase();
    const t212Ticker = mapSymbolToT212Ticker(canonicalSymbol);

    if (!t212Ticker) {
      // No T212 mapping for this symbol
      return;
    }

    let cancelled = false;
    setRealTradesLoading(true);

    // Fetch both raw trades (for overlay) and paired trades (for table)
    Promise.all([
      fetchT212Trades(t212Ticker, { maxPages: 5, pageSize: 100 }),
      fetchT212PairedTrades(t212Ticker, { maxPages: 10, pageSize: 100 }),
    ])
      .then(([rawTrades, pairedResponse]) => {
        if (!cancelled) {
          setRealT212Trades(rawTrades);
          setRealT212PairedTrades(pairedResponse.pairedTrades);
          setRealT212Summary(pairedResponse.summary);
        }
      })
      .catch((err) => {
        console.error("Failed to load Trading212 trades for", t212Ticker, err);
      })
      .finally(() => {
        if (!cancelled) {
          setRealTradesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [params.ticker]);

  // Filter t212Runs by date range for table display
  type FilteredStats = {
    days: number;
    firstDate: string;
    lastDate: string;
    returnPct: number;
    maxDrawdown: number;
    tradeCount: number;
    stopOutEvents: number;
  };
  type T212RunFiltered = Trading212SimRun & { filteredHistory: Trading212AccountSnapshot[]; filteredStats: FilteredStats | null };
  
  const t212RunsFiltered: T212RunFiltered[] = useMemo(() => {
    if (!t212DateRange.start || !t212DateRange.end) {
      // No filter - return runs with null filteredStats (will use original values)
      return t212Runs.map((run) => ({ ...run, filteredHistory: run.result.accountHistory, filteredStats: null }));
    }
    const startDate = t212DateRange.start;
    const endDate = t212DateRange.end;
    return t212Runs.map((run) => {
      const filtered = run.result.accountHistory.filter(
        (snap) => snap.date >= startDate && snap.date <= endDate
      );
      if (filtered.length === 0) {
        return { ...run, filteredHistory: [] as Trading212AccountSnapshot[], filteredStats: null };
      }
      // Recalculate stats for filtered range
      const first = filtered[0];
      const last = filtered[filtered.length - 1];
      const filteredReturn = (last.equity - first.equity) / first.equity;
      // Max drawdown within filtered range
      let peak = first.equity;
      let maxDd = 0;
      for (const snap of filtered) {
        if (snap.equity > peak) peak = snap.equity;
        const dd = (peak - snap.equity) / peak;
        if (dd > maxDd) maxDd = dd;
      }
      // Count trades within date range
      const filteredTrades = run.result.trades.filter(
        (t) => t.entryDate >= startDate && t.entryDate <= endDate
      );
      // Stop-outs can't be tracked per-trade; use 0 for filtered view
      const filteredStopOuts = 0;
      return {
        ...run,
        filteredHistory: filtered,
        filteredStats: {
          days: filtered.length,
          firstDate: first.date,
          lastDate: last.date,
          returnPct: filteredReturn,
          maxDrawdown: maxDd,
          tradeCount: filteredTrades.length,
          stopOutEvents: filteredStopOuts,
        },
      };
    });
  }, [t212Runs, t212DateRange]);

  // Create simulation runs summary for PriceChart Overview tab
  const simulationRunsSummary = useMemo(() => {
    return t212RunsFiltered.map((run) => {
      const r = run.result;
      const stats = run.filteredStats;
      const baseFirstDate = r.firstDate ?? (r.accountHistory.length > 0 ? r.accountHistory[0].date : "—");
      const baseLastDate = r.lastDate ?? (r.accountHistory.length > 0 ? r.accountHistory[r.accountHistory.length - 1].date : "—");
      return {
        id: run.id,
        label: run.label,
        lambda: run.lambda,
        trainFraction: run.trainFraction,
        returnPct: stats ? stats.returnPct : (r.finalEquity - r.initialEquity) / r.initialEquity,
        maxDrawdown: stats ? stats.maxDrawdown : r.maxDrawdown,
        tradeCount: stats ? stats.tradeCount : r.trades.length,
        stopOutEvents: stats ? stats.stopOutEvents : r.stopOutEvents,
        days: stats ? stats.days : r.accountHistory.length,
        firstDate: baseFirstDate,
        lastDate: baseLastDate,
      };
    });
  }, [t212RunsFiltered]);

  // Sync volatility window with GBM window only when auto-sync is enabled and GBM window changes
  useEffect(() => {
    if (volWindowAutoSync) {
      setVolWindow(window);
    }
  }, [window, volWindowAutoSync]);

  // Keep dist consistent with the selected model (legacy compatibility)
  const garchDist = garchEstimator === 'Normal' ? 'normal' : 'student-t';

  // Conformal Prediction state
  const [conformalMode, setConformalMode] = useState<'ICP' | 'ICP-SCALED' | 'CQR' | 'EnbPI' | 'ACI'>('ICP');
  const [conformalDomain, setConformalDomain] = useState<'log' | 'price'>('log');
  const [conformalCalWindow, setConformalCalWindow] = useState(250);
  const [conformalEta, setConformalEta] = useState(0.02);
  const [conformalK, setConformalK] = useState(20);
  const [conformalState, setConformalState] = useState<any>(null);
  const [isApplyingConformal, setIsApplyingConformal] = useState(false);
  const [conformalError, setConformalError] = useState<string | null>(null);
  const [baseForecastCount, setBaseForecastCount] = useState<number | null>(null);
  const [isLoadingBaseForecasts, setIsLoadingBaseForecasts] = useState(false);
  const [showMissDetails, setShowMissDetails] = useState(false); // Changed to false (closed by default)
  const [baseForecastsToGenerate, setBaseForecastsToGenerate] = useState(250); // Default to cal window

  // Model prediction line for the active method
  const [modelLine, setModelLine] = useState<
    Array<{ date: string; model_price: number }> | null
  >(null);

  // Base forecast generation state
  const [isGeneratingBase, setIsGeneratingBase] = useState(false);

  // Stale state tracking for master controls
  const [baseForecastsStale, setBaseForecastsStale] = useState(false);
  const [conformalStale, setConformalStale] = useState(false);
  const [coverageStatsStale, setCoverageStatsStale] = useState(false);

  // Validation Gates state
  const [gatesStatus, setGatesStatus] = useState<GateStatus | null>(null);
  const [isCheckingGates, setIsCheckingGates] = useState(false);

  // Company Registry state
  const [companyTicker, setCompanyTicker] = useState(params.ticker);
  const [companyName, setCompanyName] = useState('');
  const [companyExchange, setCompanyExchange] = useState('NASDAQ');
  const [availableExchanges, setAvailableExchanges] = useState<string[]>([]);
  const [exchangesByRegion, setExchangesByRegion] = useState<Record<string, string[]>>({});
  const [isSavingCompany, setIsSavingCompany] = useState(false);
  const [companySaveSuccess, setCompanySaveSuccess] = useState(false);

  // Initialization state to prevent auto-generation before data is loaded
  const [isInitialized, setIsInitialized] = useState(false);

  // Alerts state
  const [firedAlerts, setFiredAlerts] = useState<AlertFire[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [repairRecords, setRepairRecords] = useState<RepairRecord[]>([]);
  const [isLoadingRepairs, setIsLoadingRepairs] = useState(false);
  
  // Watchlist state
  const [isAddingToWatchlist, setIsAddingToWatchlist] = useState(false);
  const [watchlistSuccess, setWatchlistSuccess] = useState(false);
  const [isInWatchlist, setIsInWatchlist] = useState(false);

  // Breakout Detection state
  const [latestEvent, setLatestEvent] = useState<EventRecord | null>(null);
  const [isDetectingBreakout, setIsDetectingBreakout] = useState(false);
  const [breakoutError, setBreakoutError] = useState<string | null>(null);
  const [breakoutDetectDate, setBreakoutDetectDate] = useState('');
  const [cooldownStatus, setCooldownStatus] = useState<{ok: boolean; inside_count: number; reason?: string} | null>(null);

  // Continuation Clock state
  const [stopRule, setStopRule] = useState<'re-entry' | 'sign-flip'>('re-entry');
  const [kInside, setKInside] = useState<1 | 2>(1);
  const [tMax, setTMax] = useState(20);
  const [isTicking, setIsTicking] = useState(false);
  const [continuationError, setContinuationError] = useState<string | null>(null);
  const [tickDate, setTickDate] = useState('');
  const [lastContinuationAction, setLastContinuationAction] = useState<string | null>(null);

  // Model selection state for recommended defaults
  const [recommendedModel, setRecommendedModel] = useState<string | null>(null);
  const [modelScores, setModelScores] = useState<ModelScoreLite[] | null>(null);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);
  const [isModelInfoOpen, setIsModelInfoOpen] = useState(false);

  // Centralized forecast pipeline status
  const [forecastStatus, setForecastStatus] = useState<ForecastStatus>("idle");

  // Data Contract popover state
  const [showDataContract, setShowDataContract] = useState(false);

  // Validation checklist dropdown state  
  const [showValidationChecklist, setShowValidationChecklist] = useState(false);

  // Validation summary state
  const [validationSummary, setValidationSummary] = useState<ValidationSummary | null>(null);

  // Upload mode and reprocess state
  const [uploadMode, setUploadMode] = useState<'replace' | 'incremental'>('replace');
  const [lastFileHash, setLastFileHash] = useState<string | null>(null);
  const [isReprocessing, setIsReprocessing] = useState(false);

  // Exchange validation warning state (M-4)
  const [exchangeWarning, setExchangeWarning] = useState<{
    show: boolean;
    message: string;
    details: string;
    conflictType?: 'adr' | 'suffix' | 'region' | 'pattern';
  } | null>(null);

  // Provenance ribbon state (M-5)
  const [provenanceData, setProvenanceData] = useState<{
    vendor: string;
    mappingId: string;
    fileHash: string;
    rows: number;
    dateRange: { first: string; last: string };
    processedAt: string;
  } | null>(null);

  // Column mapping state (A-1)
  const [showColumnMapping, setShowColumnMapping] = useState(false);
  const [selectedMapping, setSelectedMapping] = useState<string | null>(null);
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);
  const [columnMappings, setColumnMappings] = useState<Array<{
    id: string;
    name: string;
    vendor: 'yahoo' | 'bloomberg' | 'refinitiv' | 'unknown';
    map: Record<string, string>;
  }>>([]);
  const [customMapping, setCustomMapping] = useState<Record<string, string>>({});
  const [mappingTab, setMappingTab] = useState<'template' | 'custom'>('template');

  // Preview data state (A-2)
  const [previewData, setPreviewData] = useState<{
    head: Array<Record<string, string>>;
    tail: Array<Record<string, string>>;
    gaps: Array<{
      start: string;
      end?: string;
      days: number;
      severity: 'warn' | 'info';
    }>;
  } | null>(null);

  // Repairs & Audit panel state (A-3)
  const [showRepairsPanel, setShowRepairsPanel] = useState(false);

  // Corporate Actions state (A-4)
  const [corporateActionsFile, setCorporateActionsFile] = useState<File | null>(null);
  const [isUploadingCorporateActions, setIsUploadingCorporateActions] = useState(false);
  const [corporateActionsResult, setCorporateActionsResult] = useState<any>(null);
  const [corporateActionsError, setCorporateActionsError] = useState<string | null>(null);
  const [showConflictResolution, setShowConflictResolution] = useState(false);
  const [conflictData, setConflictData] = useState<any>(null);
  const [existingCorporateActions, setExistingCorporateActions] = useState<any[]>([]);

  // Delisting awareness state (A-5)
  const [delistingInfo, setDelistingInfo] = useState<{
    symbol: string;
    status: 'active' | 'delisted' | 'suspended' | 'pending_delisting';
    delistingDate?: string;
    reason?: string;
    exchange: string;
    lastTradingDate?: string;
    warnings: string[];
    manualOverride?: {
      overridden: boolean;
      overrideDate: string;
      overrideReason: string;
      overriddenBy: string;
    };
  } | null>(null);
  const [showDelistingOverride, setShowDelistingOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  // Export functionality state (A-6)
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Data type selector state
  const [dataTypes, setDataTypes] = useState(['Historical Price', 'Dividends']);
  const [selectedDataType, setSelectedDataType] = useState('Historical Price');
  const [showAddDataType, setShowAddDataType] = useState(false);
  const [newDataTypeName, setNewDataTypeName] = useState('');

  // File upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Data Quality modal state
  const [showDataQualityModal, setShowDataQualityModal] = useState(false);

  // Coverage details toggle state
  const [showCoverageDetails, setShowCoverageDetails] = useState(false);

  // Stable accessors to prevent variable shadowing - using server spec
  const resolvedTargetSpec = useMemo(() => targetSpecResult || serverTargetSpec, [targetSpecResult, serverTargetSpec]);
  const persistedCoverage = typeof resolvedTargetSpec?.spec?.coverage === "number" ? resolvedTargetSpec.spec.coverage : null;
  const persistedTZ = resolvedTargetSpec?.spec?.exchange_tz ?? null;
  const canonicalCount = useMemo(() => {
    if (uploadResult?.counts?.canonical) return uploadResult.counts.canonical;
    if (uploadResult?.meta?.rows) return uploadResult.meta.rows;
    return 0;
  }, [uploadResult]);

  // Pipeline prerequisites to avoid premature runs that show false errors
  const pipelineReady = useMemo(() => {
    const hasCoverage = typeof resolvedTargetSpec?.spec?.coverage === "number";
    const hasHorizon = typeof resolvedTargetSpec?.spec?.h === "number";
    const hasTZ = Boolean(resolvedTargetSpec?.spec?.exchange_tz);
    return isInitialized && hasCoverage && hasHorizon && hasTZ && canonicalCount > 0;
  }, [canonicalCount, isInitialized, resolvedTargetSpec]);

  console.log("SERVER_SPEC", serverTargetSpec);
  console.log("[RENDER] Component rendering, serverTargetSpec:", serverTargetSpec);

  // Memoize forecast overlay props to prevent unnecessary re-renders
  const forecastOverlayProps = useMemo(() => ({
    activeForecast: fallbackOverlayForecast,
    volModel,
    coverage,
    conformalState,
  }), [fallbackOverlayForecast, volModel, coverage, conformalState]);

  // Exchange TZ resolver helper
  function resolveExchangeTZ(opts: { canonicalTZ?: string | null; selectedExchange?: string | null }): string | null {
    // Prefer canonical meta (Data Quality already shows this)
    if (opts.canonicalTZ && opts.canonicalTZ.includes("/")) return opts.canonicalTZ;

    // Fallback map by exchange code (minimal — extend if you like)
    const map: Record<string, string> = {
      NASDAQ: "America/New_York",
      NYSE:   "America/New_York", 
      XETRA:  "Europe/Berlin",
      LSE:    "Europe/London"
    };
    const ex = (opts.selectedExchange || "").split(" ")[0].toUpperCase(); // "NASDAQ"
    return map[ex] || null;
  }

  // Load target spec and latest forecast on mount
  useEffect(() => {
    const initializeComponent = async () => {
      console.log('[Init] Starting component initialization for:', params.ticker);
      
      try {
        // Load all initial data
        await Promise.all([
          loadTargetSpec(),
          loadLatestForecast(),
          loadCompanyInfo(),
          loadCurrentPrice(),
          loadExistingCorporateActions(),
          loadDelistingStatus(),
          loadExistingCanonicalData()
        ]);
        
        console.log('[Init] Initial data loading complete');
        
        // Mark as initialized to allow auto-generation
        setIsInitialized(true);
        
      } catch (error) {
        console.error('[Init] Error during component initialization:', error);
        // Still mark as initialized to prevent hanging state
        setIsInitialized(true);
      }
    };

    // Reset initialization flag when ticker changes
    setIsInitialized(false);
    initializeComponent();
  }, [params.ticker]); // eslint-disable-line react-hooks/exhaustive-deps

  // Helper function to parse method string to UI state on client-side
  const parseMethodToUIState = (method: string): {
    volModel: 'GBM' | 'GARCH' | 'HAR-RV' | 'Range';
    garchEstimator?: 'Normal' | 'Student-t';
    rangeEstimator?: 'P' | 'GK' | 'RS' | 'YZ';
  } => {
    switch (method) {
      case "GBM-CC":
        return { volModel: 'GBM' };
      case "GARCH11-N":
        return { volModel: 'GARCH', garchEstimator: 'Normal' };
      case "GARCH11-t":
        return { volModel: 'GARCH', garchEstimator: 'Student-t' };
      case "HAR-RV":
        return { volModel: 'HAR-RV' };
      case "Range-P":
        return { volModel: 'Range', rangeEstimator: 'P' };
      case "Range-GK":
        return { volModel: 'Range', rangeEstimator: 'GK' };
      case "Range-RS":
        return { volModel: 'Range', rangeEstimator: 'RS' };
      case "Range-YZ":
        return { volModel: 'Range', rangeEstimator: 'YZ' };
      default:
        return { volModel: 'GBM' };
    }
  };

  // Load recommended default model on mount
  useEffect(() => {
    const loadRecommendedModel = async () => {
      setIsLoadingRecommendations(true);
      try {
        // Get the recommended default model for this symbol and configuration
        const horizonTrading = targetSpecResult?.spec?.h || 5; // Use target spec horizon or default to 5
        const coverage = targetSpecResult?.spec?.coverage || 0.95; // Use target spec coverage or default to 95%
        
        const urlParams = new URLSearchParams({
          symbol: params.ticker,
          horizonTrading: horizonTrading.toString(),
          coverage: coverage.toString()
        });

        const response = await fetch(`/api/model-selection?${urlParams}`);
        
        if (response.ok) {
          const result = await response.json();
          const defaultModel = result.defaultModel; // Updated field name
          const modelScoresData = result.modelScores; // New field
          
          if (defaultModel) {
            console.log(`Loaded recommended model for ${params.ticker}: ${defaultModel}`);
            setRecommendedModel(defaultModel);
            setModelScores(modelScoresData);
            // Note: We only store the recommendation, not auto-apply it
          } else {
            console.log(`No recommended model found for ${params.ticker}, using defaults`);
            setRecommendedModel(null);
            setModelScores(null);
          }
        } else {
          console.error('Failed to load model recommendations:', response.status, response.statusText);
          setRecommendedModel(null);
          setModelScores(null);
        }
      } catch (error) {
        console.error('Failed to load recommended model:', error);
        setRecommendedModel(null);
        setModelScores(null);
      } finally {
        setIsLoadingRecommendations(false);
      }
    };

    loadRecommendedModel();
  }, [params.ticker, targetSpecResult]); // Re-run when ticker or target spec changes

  const loadExistingCanonicalData = async () => {
    try {
      const response = await fetch(`/api/canonical/${params.ticker}`);
      if (response.ok) {
        const data = await response.json();
        if (data.meta?.rows) {
          // Set a minimal uploadResult if we have existing canonical data
          setUploadResult({
            symbol: params.ticker,
            paths: { raw: '', canonical: '', audit: '' },
            counts: { 
              input: data.meta.rows, 
              canonical: data.meta.rows, 
              invalid: 0,
              missingDays: 0 
            },
            meta: {
              symbol: params.ticker,
              exchange_tz: data.meta.exchange_tz || 'America/New_York',
              calendar_span: { start: data.meta.calendar_span?.start || '', end: data.meta.calendar_span?.end || '' },
              rows: data.meta.rows,
              missing_trading_days: [],
              invalid_rows: 0,
              generated_at: data.meta.generated_at || new Date().toISOString()
            },
            badges: {
              contractOK: true,
              calendarOK: true,
              tzOK: true,
              corpActionsOK: true,
              validationsOK: true,
              repairsCount: 0
            }
          });
        }
      }
    } catch (error) {
      console.log('No existing canonical data found');
    }
  };

  const loadCompanyInfo = async () => {
    try {
      const response = await fetch(`/api/companies?ticker=${params.ticker}`);
      if (response.ok) {
        const company = await response.json();
        setCompanyName(company.name || '');
        // Keep ticker in sync with URL param
        setCompanyTicker(params.ticker);
      }
    } catch (error) {
      console.error('Failed to load company info:', error);
      // Set default ticker from URL
      setCompanyTicker(params.ticker);
    }
  };

  // Fetch current price for header display
  const loadCurrentPrice = async () => {
    try {
      const response = await fetch(`/api/history/${params.ticker}`);
      if (response.ok) {
        const data = await response.json();
        if (data && data.length > 0) {
          const latest = data[data.length - 1];
          const price = latest.adj_close ?? latest.close ?? null;
          setHeaderPrice({ price, date: latest.date });
        }
      }
    } catch (error) {
      console.error('Failed to load current price:', error);
    }
  };

  const loadTargetSpec = async () => {
    try {
      const response = await fetch(`/api/target-spec/${params.ticker}`);
      if (response.ok) {
        const result: TargetSpecResult = await response.json();
        setTargetSpecResult(result);
        setH(result.spec.h);
        setCoverage(result.spec.coverage);
      }
    } catch (error) {
      console.error('Failed to load target spec:', error);
    }
  };

  const loadLatestForecast = useCallback(async () => {
    try {
      const response = await fetch(`/api/forecast/gbm/${params.ticker}`);
      if (response.ok) {
        const forecasts = await response.json();
        // Get the most recent forecast (array is sorted by date_t descending)
        if (forecasts.length > 0) {
          setCurrentForecast(forecasts[0]);
          // Also set as active forecast if no active forecast is currently set
          setActiveForecast((prevActive: any) => prevActive || forecasts[0]);
        }
      } else if (response.status !== 404) {
        console.error('Failed to load forecasts:', response.statusText);
      }
    } catch (error) {
      console.error('Failed to load forecasts:', error);
    }
  }, [params.ticker]);

  // Load latest locked forecast for conformal prediction
  const loadLatestActiveForecast = useCallback(async () => {
    try {
      // Try to load the latest forecast from all methods
      const response = await fetch(`/api/forecast/gbm/${params.ticker}`);
      if (response.ok) {
        const forecasts = await response.json();
        
        // Find the most recent locked forecast
        const latestLocked = forecasts.find((f: any) => f.locked === true);
        if (latestLocked) {
          console.log('[LoadActiveForecast] Found latest locked forecast:', latestLocked.method, latestLocked.date_t);
          setActiveForecast(latestLocked);
          return latestLocked;
        }
        
        // If no locked forecast, use the most recent forecast
        if (forecasts.length > 0) {
          console.log('[LoadActiveForecast] Using most recent forecast:', forecasts[0].method, forecasts[0].date_t);
          setActiveForecast(forecasts[0]);
          return forecasts[0];
        }
      }
      
      // If no API forecasts found, check if we have a GBM forecast in state
      if (gbmForecast) {
        console.log('[LoadActiveForecast] Using GBM forecast from state:', gbmForecast.method);
        setActiveForecast(gbmForecast);
        return gbmForecast;
      }

      console.log('[LoadActiveForecast] No active forecast found');
      return null;
    } catch (error) {
      console.error('Failed to load active forecast:', error);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.ticker]); // gbmForecast intentionally omitted to avoid race conditions with pipeline

  const loadServerTargetSpec = useCallback(async () => {
    try {
      setIsLoadingServerSpec(true);
      const resp = await fetch(`/api/target-spec/${encodeURIComponent(tickerParam)}`, { cache: "no-store" });
      if (!resp.ok) { 
        console.warn(`Failed to load server target spec for ${tickerParam}: ${resp.status}`);
        setServerTargetSpec(null); 
        return; 
      }
      const data = await resp.json();
      console.log(`Loaded server target spec for ${tickerParam}:`, data);
      setServerTargetSpec(data); // Should be { spec: {...}, meta: {...} }
    } catch (error) {
      console.error(`Error loading server target spec for ${tickerParam}:`, error);
      setServerTargetSpec(null);
    } finally {
      setIsLoadingServerSpec(false);
    }
  }, [tickerParam]);

  useEffect(() => { loadServerTargetSpec(); }, [loadServerTargetSpec]);

  // Check RV availability for HAR-RV gating
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/canonical/${encodeURIComponent(tickerParam)}?fields=rv_head`, { cache: 'no-store' });
        const j = await r.json();
        setRvAvailable(Boolean(j?.rv_head && j.rv_head.length > 0));
      } catch { 
        setRvAvailable(false); 
      }
    })();
  }, [tickerParam]);

  // Derive base method from current UI selection instead of active forecast
  const selectedBaseMethod = resolveBaseMethod(volModel, garchEstimator, rangeEstimator);

  // Legacy: still derive active base method for compatibility (can be removed later)
  const activeBaseMethod: string | null = 
    activeForecast?.method ?? 
    gbmForecast?.method ?? 
    'GBM';

  // Load base forecast count with method-awareness
  const loadBaseForecastCount = useCallback(async () => {
    try {
      setIsLoadingBaseForecasts(true);
      
      // Use selected base method from current UI selection with complete parameter set
      const baseMethod = selectedBaseMethod;
      const query = `?base_method=${encodeURIComponent(baseMethod)}&h=${h}&coverage=${coverage}&domain=${conformalDomain}`;
      const resp = await fetch(
        `/api/conformal/head/${encodeURIComponent(tickerParam)}${query}`,
        { cache: 'no-store' }
      );
      
      if (!resp.ok) {
        console.error('[Conformal] head failed', resp.status);
        setBaseForecastCount(0);
        return;
      }
      const data = await resp.json();
      setBaseForecastCount(typeof data.base_forecasts === 'number' ? data.base_forecasts : 0);
    } catch (err) {
      console.error('[Conformal] head error', err);
      setBaseForecastCount(0);
    } finally {
      setIsLoadingBaseForecasts(false);
    }
  }, [tickerParam, selectedBaseMethod, h, coverage, conformalDomain]);

  // Load model line data
  const loadModelLine = useCallback(async () => {
    if (!activeBaseMethod) return;

    try {
      const url = `/api/forecast/model-line/${encodeURIComponent(
        params.ticker
      )}?method=${encodeURIComponent(
        activeBaseMethod
      )}&window=${conformalCalWindow}`;

      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) {
        console.error('Failed to load model line', await resp.text());
        return;
      }

      const json = await resp.json();
      setModelLine(json.data ?? null);
    } catch (err) {
      console.error('Error loading model line', err);
    }
  }, [params.ticker, activeBaseMethod, conformalCalWindow]);

  // Load base forecast count when dependencies change
  useEffect(() => { loadBaseForecastCount(); }, [loadBaseForecastCount]);

  // Load model line when dependencies change
  useEffect(() => { loadModelLine(); }, [loadModelLine]);

  // Load latest active forecast when page loads
  useEffect(() => { loadLatestActiveForecast(); }, [loadLatestActiveForecast]);

  // Auto-set activeForecast from currentForecast if activeForecast is not set
  useEffect(() => {
    if (!activeForecast && currentForecast) {
      const timestamp = new Date().toISOString();
      console.log(`🎯 BROWSER DEBUG [${timestamp}] ⚠️ AutoSetActive from currentForecast:`, {
        currentForecastMethod: currentForecast.method,
        currentForecastDate: currentForecast.date_t,
        stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
      });
      console.log('[AutoSetActive] Setting activeForecast from currentForecast:', currentForecast.method, currentForecast.date_t);
      setActiveForecast(currentForecast);
    }
  }, [activeForecast, currentForecast]);

  // Auto-set activeForecast from gbmForecast if activeForecast is not set
  useEffect(() => {
    if (!activeForecast && gbmForecast) {
      const timestamp = new Date().toISOString();
      console.log(`🎯 BROWSER DEBUG [${timestamp}] ⚠️ AutoSetActive from gbmForecast:`, {
        gbmForecastMethod: gbmForecast.method,
        gbmForecastDate: gbmForecast.date_t,
        stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
      });
      console.log('[AutoSetActive] Setting activeForecast from gbmForecast:', gbmForecast.method, gbmForecast.date_t);
      setActiveForecast(gbmForecast);
    }
  }, [activeForecast, gbmForecast]);

  // 🔍 CRITICAL DEBUG: Monitor activeForecast changes with browser console output
  useEffect(() => {
    const timestamp = new Date().toISOString();
    console.log(`🎯 BROWSER DEBUG [${timestamp}] activeForecast changed:`, {
      hasActiveForecast: !!activeForecast,
      activeForecastKeys: activeForecast ? Object.keys(activeForecast) : 'null',
      method: activeForecast?.method,
      date_t: activeForecast?.date_t,
      hasIntervals: !!activeForecast?.intervals,
      hasConformal: !!activeForecast?.conformal,
      stackTrace: new Error().stack?.split('\n').slice(1, 6).join('\n')
    });
  }, [activeForecast]);

  // Load conformal state
  const loadConformalState = useCallback(async () => {
    try {
      const response = await fetch(`/api/conformal/${encodeURIComponent(params.ticker)}`);
      if (response.ok) {
        const data = await response.json();
        setConformalState(data);
      } else if (response.status !== 404) {
        console.error('Failed to load conformal state:', response.statusText);
      }
    } catch (error) {
      console.error('Failed to load conformal state:', error);
    }
  }, [params.ticker]);

  // Load conformal state on mount and when ticker changes
  useEffect(() => { loadConformalState(); }, [loadConformalState]);

  // Load EWMA Walker diagnostics
  const loadEwmaWalker = useCallback(async () => {
    if (!params?.ticker) return;

    try {
      setIsLoadingEwma(true);
      setEwmaError(null);

      // Build query params including horizon
      const query = new URLSearchParams({
        lambda: '0.94',
        h: String(h),
        coverage: coverage.toString(),
      });

      console.debug("[EWMA] Loading unbiased walker", { symbol: params.ticker, h, coverage });
      const res = await fetch(
        `/api/volatility/ewma/${encodeURIComponent(params.ticker)}?${query.toString()}`
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `EWMA API error ${res.status}`);
      }

      const json = await res.json();

      // Expecting shape like:
      // { points: EwmaWalkerPoint[], piMetrics: {...}, zMean, zStd, directionHitRate, oosForecast }
      const points = json.points || [];
      const m = json.piMetrics || {};
      const oosForecast = json.oosForecast || null;
      const zMean = typeof json.zMean === "number" ? json.zMean : NaN;
      const zStd = typeof json.zStd === "number" ? json.zStd : NaN;
      const directionHitRate =
        typeof json.directionHitRate === "number" ? json.directionHitRate : NaN;

      const coverageValue = typeof m.empiricalCoverage === "number"
        ? m.empiricalCoverage
        : NaN;
      const targetCoverage = typeof m.coverage === "number"
        ? m.coverage
        : NaN;
      const intervalScore = typeof m.intervalScore === "number"
        ? m.intervalScore
        : NaN;
      const avgWidth = typeof m.avgWidth === "number"
        ? m.avgWidth
        : NaN;

      setEwmaSummary({
        coverage: coverageValue,
        targetCoverage,
        intervalScore,
        avgWidth,
        zMean,
        zStd,
        directionHitRate,
        nPoints: points.length,  // Keep as in-sample count only
      });

      // Map to a clean path type for chart overlay
      const mappedPath: EwmaWalkerPathPoint[] = points.map((p: any) => ({
        date_t: p.date_t,
        date_tp1: p.date_tp1,
        S_t: p.S_t,
        S_tp1: p.S_tp1,
        y_hat_tp1: p.y_hat_tp1,
        L_tp1: p.L_tp1,
        U_tp1: p.U_tp1,
      }));

      // Append OOS tail if present (extends EWMA line/band into future)
      if (oosForecast && oosForecast.targetDate) {
        mappedPath.push({
          date_t: oosForecast.originDate,
          date_tp1: oosForecast.targetDate,
          S_t: oosForecast.S_t,
          // No realized price for OOS; use forecast center as placeholder
          S_tp1: oosForecast.y_hat,
          y_hat_tp1: oosForecast.y_hat,
          L_tp1: oosForecast.L,
          U_tp1: oosForecast.U,
        });
      }

      setEwmaPath(mappedPath);
    } catch (err: any) {
      console.error("[EWMA] loadEwmaWalker error", err);
      setEwmaError(err?.message || "Failed to load EWMA walker data.");
      setEwmaSummary(null);
      setEwmaPath(null);
    } finally {
      setIsLoadingEwma(false);
    }
  }, [params?.ticker, h, coverage]);

  // Load EWMA Walker on mount/ticker change/horizon change
  useEffect(() => {
    loadEwmaWalker();
  }, [loadEwmaWalker]);

  // Track if biased EWMA was ever loaded (so we know to auto-refresh on horizon change)
  const biasedEverLoaded = useRef(false);

  // Load EWMA Biased Walker (uses Reaction Map tilt)
  const loadEwmaBiasedWalker = useCallback(async () => {
    if (!params?.ticker) return;

    try {
      setIsLoadingEwmaBiased(true);
      setEwmaBiasedError(null);

      const query = new URLSearchParams({
        lambda: reactionLambda.toString(),
        coverage: coverage.toString(),              // main coverage
        h: String(h),
        trainFraction: reactionTrainFraction.toString(),
        minTrainObs: reactionMinTrainObs.toString(),
        shrinkFactor: "0.5",
      });

      const res = await fetch(
        `/api/volatility/ewma-biased/${encodeURIComponent(params.ticker)}?${query.toString()}`
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `EWMA Biased API error ${res.status}`);
      }

      const json = await res.json();

      if (!json.success) {
        throw new Error(json.error || "Failed to load biased EWMA");
      }

      const {
        points,
        piMetrics,
        zMean,
        zStd,
        directionHitRate,
        oosForecast,
      } = json;

      const m = piMetrics || {};

      setEwmaBiasedSummary({
        coverage: typeof m.empiricalCoverage === "number" ? m.empiricalCoverage : NaN,
        targetCoverage: typeof m.coverage === "number" ? m.coverage : NaN,
        intervalScore: typeof m.intervalScore === "number" ? m.intervalScore : NaN,
        avgWidth: typeof m.avgWidth === "number" ? m.avgWidth : NaN,
        zMean: typeof zMean === "number" ? zMean : NaN,
        zStd: typeof zStd === "number" ? zStd : NaN,
        directionHitRate: typeof directionHitRate === "number" ? directionHitRate : NaN,
        nPoints: points?.length ?? 0,
      });

      const mappedPath: EwmaWalkerPathPoint[] = (points || []).map((p: any) => ({
        date_t: p.date_t,
        date_tp1: p.date_tp1,
        S_t: p.S_t,
        S_tp1: p.S_tp1,
        y_hat_tp1: p.y_hat_tp1,
        L_tp1: p.L_tp1,
        U_tp1: p.U_tp1,
      }));

      // Append OOS tail if present
      if (oosForecast && oosForecast.targetDate) {
        mappedPath.push({
          date_t: oosForecast.originDate,
          date_tp1: oosForecast.targetDate,
          S_t: oosForecast.S_t,
          S_tp1: oosForecast.y_hat,
          y_hat_tp1: oosForecast.y_hat,
          L_tp1: oosForecast.L,
          U_tp1: oosForecast.U,
        });
      }

      setEwmaBiasedPath(mappedPath);
    } catch (err: any) {
      console.error("[EWMA Biased] loadEwmaBiasedWalker error", err);
      setEwmaBiasedError(err?.message || "Failed to load biased EWMA.");
      setEwmaBiasedSummary(null);
      setEwmaBiasedPath(null);
    } finally {
      setIsLoadingEwmaBiased(false);
    }
  }, [params?.ticker, h, reactionLambda, coverage, reactionTrainFraction, reactionMinTrainObs]);

  // Auto-refresh biased EWMA when horizon/coverage changes (only if it was previously loaded)
  useEffect(() => {
    if (biasedEverLoaded.current) {
      loadEwmaBiasedWalker();
    }
  }, [loadEwmaBiasedWalker]);

  // Load EWMA Reaction Map (manual trigger only)
  const loadReactionMap = useCallback(async () => {
    if (!params?.ticker) return;

    try {
      setIsLoadingReaction(true);
      setReactionError(null);

      const query = new URLSearchParams({
        lambda: reactionLambda.toString(),
        coverage: coverage.toString(),              // main coverage
        trainFraction: reactionTrainFraction.toString(),
        minTrainObs: reactionMinTrainObs.toString(),
        horizons: String(h),                        // main horizon
      });

      const res = await fetch(
        `/api/volatility/ewma-reaction/${encodeURIComponent(params.ticker)}?${query.toString()}`,
        { cache: "no-store" }
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `EWMA reaction API error ${res.status}`);
      }

      const json = await res.json();
      
      if (!json.success) {
        throw new Error(json.error || "Failed to build reaction map");
      }

      const result = json.result;

      const buckets: ReactionBucketSummary[] = (result.stats || []).map((s: any) => ({
        bucketId: s.bucketId,
        horizon: s.horizon,
        nObs: s.nObs,
        pUp: s.pUp,
        meanReturn: s.meanReturn,
        stdReturn: s.stdReturn,
      }));

      setReactionMapSummary({
        trainStart: result.meta.trainStart,
        trainEnd: result.meta.trainEnd,
        testStart: result.meta.testStart,
        testEnd: result.meta.testEnd,
        nTrain: result.meta.nTrain,
        nTest: result.meta.nTest,
        buckets,
      });
    } catch (err: any) {
      console.error("[EWMA REACTION] loadReactionMap error", err);
      setReactionError(err?.message || "Failed to load EWMA reaction map.");
      setReactionMapSummary(null);
    } finally {
      setIsLoadingReaction(false);
    }
  }, [params?.ticker, reactionLambda, coverage, h, reactionTrainFraction, reactionMinTrainObs]);

  // Auto-load reaction map and biased EWMA when λ or Train% changes
  // Also load biased EWMA on initial mount for T212 auto-run
  useEffect(() => {
    // Debounce to avoid too many calls while typing
    const timeout = setTimeout(() => {
      loadReactionMap();
      // Always load biased EWMA for T212 auto-population
      loadEwmaBiasedWalker();
      biasedEverLoaded.current = true;
    }, 300);
    return () => clearTimeout(timeout);
  }, [reactionLambda, reactionTrainFraction, loadReactionMap, loadEwmaBiasedWalker]);

  // Core optimization function - runs the optimizer API and updates state
  const runOptimization = useCallback(async (options?: { applyBest?: boolean }) => {
    if (!params?.ticker) return;
    const { applyBest = false } = options ?? {};

    try {
      setIsOptimizingReaction(true);
      setReactionOptimizeError(null);

      const query = new URLSearchParams({
        h: String(h),
        coverage: coverage.toString(),
        shrinkFactor: "0.5",
        minTrainObs: reactionMinTrainObs.toString(),
        // Coarse grid for speed: λ step 0.05, train step 0.05
        lambdaMin: "0.50",
        lambdaMax: "0.99",
        lambdaStep: "0.05",
        trainMin: "0.50",
        trainMax: "0.90",
        trainStep: "0.05",
      });

      const res = await fetch(
        `/api/volatility/ewma-optimize/${encodeURIComponent(params.ticker)}?${query.toString()}`
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Optimize failed: ${res.status} ${text}`);
      }

      const json = await res.json();

      if (!json.success) {
        throw new Error(json.error || "Unknown optimization error");
      }

      const best = json.best as EwmaOptimizationCandidate;
      const candidates = (json.candidates ?? []) as EwmaOptimizationCandidate[];
      const neutral = json.neutralBaseline as EwmaOptimizationNeutralSummary | null;

      // Store best, candidates, and neutral baseline for display
      setReactionOptimizationBest(best);
      setReactionOptimizationCandidates(candidates);
      setReactionOptimizationNeutral(neutral ?? null);

      // Only apply best λ/Train% if explicitly requested (e.g., from Maximize button)
      if (applyBest) {
        setReactionLambda(best.lambda);
        setReactionTrainFraction(best.trainFraction);
        setIsReactionMaximized(true);
        biasedEverLoaded.current = true;
      }
      
      console.log("[EWMA Optimize] Optimization complete:", {
        best: { lambda: best.lambda, trainFraction: best.trainFraction },
        candidatesCount: candidates.length,
        applyBest,
      });
    } catch (err: any) {
      console.error("[EWMA Optimize] error:", err);
      setReactionOptimizeError(err?.message ?? "Failed to optimize EWMA");
    } finally {
      setIsOptimizingReaction(false);
    }
  }, [params?.ticker, h, coverage, reactionMinTrainObs]);

  // Auto-run optimization on initial load when unbiased EWMA is ready
  const hasAutoOptimized = useRef(false);
  useEffect(() => {
    // Only auto-optimize once per ticker, and only when unbiased EWMA is loaded
    if (hasAutoOptimized.current) return;
    if (!ewmaPath || ewmaPath.length === 0) return;
    if (!params?.ticker) return;

    console.log("[EWMA Optimize] Auto-running optimization on page load...");
    hasAutoOptimized.current = true;
    runOptimization({ applyBest: false }); // Don't apply best, just populate candidates
  }, [ewmaPath, params?.ticker, runOptimization]);

  // Reset auto-optimize flag when ticker changes
  useEffect(() => {
    hasAutoOptimized.current = false;
  }, [params?.ticker]);

  // EWMA Maximize button handler - now only toggles biased overlay and applies best config
  const handleMaximizeReaction = useCallback(() => {
    // If we already have optimization results, apply them and show overlay
    if (reactionOptimizationBest) {
      setReactionLambda(reactionOptimizationBest.lambda);
      setReactionTrainFraction(reactionOptimizationBest.trainFraction);
      setIsReactionMaximized(true);
      biasedEverLoaded.current = true;
    } else {
      // Fallback: run optimization if somehow we don't have results yet
      runOptimization({ applyBest: true });
    }
  }, [reactionOptimizationBest, runOptimization]);

  // Click handlers for optimization table rows
  const handleApplyOptimizationCandidate = useCallback(
    (candidate: EwmaOptimizationCandidate) => {
      setReactionLambda(candidate.lambda);
      setReactionTrainFraction(candidate.trainFraction);
      // Auto-reload is triggered by the useEffect watching these state variables
    },
    []
  );

  const handleApplyOptimizationNeutral = useCallback(() => {
    if (!reactionOptimizationNeutral) return;
    // Only λ matters for neutral; keep current Train%
    setReactionLambda(reactionOptimizationNeutral.lambda);
    // Auto-reload is triggered by the useEffect watching reactionLambda
  }, [reactionOptimizationNeutral]);

  // Trading212 CFD Simulation: Build bars from any EWMA path (Unbiased or Biased)
  const buildTrading212SimBarsFromEwmaPath = useCallback((
    canonicalRows: CanonicalRow[],
    ewmaPathArg: EwmaWalkerPathPoint[] | null,
    thresholdPct: number
  ): Trading212SimBar[] => {
    if (!ewmaPathArg) return [];

    // Build lookup from target date to forecast
    const ewmaMap = new Map<string, EwmaWalkerPathPoint>();
    ewmaPathArg.forEach((p) => {
      ewmaMap.set(p.date_tp1, p);
    });

    const bars: Trading212SimBar[] = [];

    for (const row of canonicalRows) {
      const price = row.adj_close ?? row.close;
      if (!price || !row.date) continue;

      const ewma = ewmaMap.get(row.date);
      if (!ewma) continue; // no forecast for this date

      // Compare forecast center vs origin price
      const diffPct = (ewma.y_hat_tp1 - ewma.S_t) / ewma.S_t;
      let signal: Trading212Signal = "flat";
      if (diffPct > thresholdPct) {
        signal = "long";
      } else if (diffPct < -thresholdPct) {
        signal = "short";
      }

      bars.push({
        date: row.date,
        price,
        signal,
      });
    }

    return bars;
  }, []);

  // Trading212 CFD Simulation: Reusable helper to run sim for a specific EWMA source
  const runTrading212SimForSource = useCallback(
    async (
      source: "unbiased" | "biased",
      runId: T212RunId,
      label: string,
      opts?: { autoSelect?: boolean }
    ) => {
      setT212Error(null);
      setIsRunningT212Sim(true);

      try {
        // Fetch canonical rows if not cached
        let rows = t212CanonicalRows;
        if (!rows) {
          const resp = await fetch(`/api/history/${encodeURIComponent(params.ticker)}`);
          if (!resp.ok) {
            throw new Error('Failed to fetch historical data');
          }
          const data = await resp.json();
          rows = data.rows as CanonicalRow[];
          setT212CanonicalRows(rows);
        }

        if (!rows || rows.length === 0) {
          throw new Error('No canonical data available');
        }

        // Choose the EWMA path based on source
        const ewmaPathForSim = source === "biased" ? ewmaBiasedPath : ewmaPath;

        if (!ewmaPathForSim || ewmaPathForSim.length === 0) {
          setT212Error(
            source === "biased"
              ? 'Need EWMA Biased path to run sim. Click "Biased" button first.'
              : 'Need EWMA Unbiased path to run sim.'
          );
          setIsRunningT212Sim(false);
          return;
        }

        // Filter canonical rows to start at Reaction Map Test start (if available)
        const userStart = t212DateRange.start;
        const userEnd = t212DateRange.end;
        const simStartDate = (() => {
          const candidates = [
            userStart,
            reactionMapSummary?.testStart,
            rows[0]?.date ?? null,
          ].filter(Boolean) as string[];
          return candidates.length ? candidates.reduce((a, b) => (a > b ? a : b)) : null;
        })();
        const simEndDate = userEnd ?? rows[rows.length - 1]?.date ?? null;

        let rowsForSim = rows;
        if (simStartDate || simEndDate) {
          rowsForSim = rows.filter((row) => {
            if (!row.date) return false;
            if (simStartDate && row.date < simStartDate) return false;
            if (simEndDate && row.date > simEndDate) return false;
            return true;
          });
        }

        // Debug: Log sim window
        console.log("[T212] Sim window", {
          simStartDate,
          firstRow: rowsForSim[0]?.date,
          lastRow: rowsForSim[rowsForSim.length - 1]?.date,
          n: rowsForSim.length,
        });

        if (!rowsForSim || rowsForSim.length === 0) {
          throw new Error('No canonical rows available for Trading212 sim.');
        }

        const bars = buildTrading212SimBarsFromEwmaPath(
          rowsForSim,
          ewmaPathForSim,
          t212ThresholdPct
        );

        if (bars.length === 0) {
          throw new Error('No overlapping bars between canonical data and EWMA path');
        }

        const config: Trading212CfdConfig = {
          leverage: t212Leverage,
          fxFeeRate: 0.005,
          dailyLongSwapRate: t212DailyLongSwap,
          dailyShortSwapRate: t212DailyShortSwap,
          spreadBps: 5,
          marginCallLevel: 0.45,
          stopOutLevel: 0.25,
          positionFraction: t212PositionFraction,
        };

        const result = simulateTrading212Cfd(bars, t212InitialEquity, config);

        // Debug: Log sim run stored
        console.log("[T212] Sim run stored", {
          runId,
          label,
          source,
          equityStart: t212InitialEquity,
          equityEnd: result.finalEquity,
          trades: result.trades.length,
          stopOuts: result.stopOutEvents,
          maxDrawdown: result.maxDrawdown,
          firstDate: result.accountHistory[0]?.date,
          lastDate: result.accountHistory[result.accountHistory.length - 1]?.date,
        });

        // Store the run in our collection
        // For max runs, use optimizer best values when available; otherwise use current state
        const isMaxRun = runId === "ewma-biased-max";
        const storedLambda = isMaxRun && reactionOptimizationBest
          ? reactionOptimizationBest.lambda
          : reactionLambda;
        const storedTrainFraction = isMaxRun && reactionOptimizationBest
          ? reactionOptimizationBest.trainFraction
          : reactionTrainFraction;
        const signalSource: Trading212SimRun['signalSource'] = source;

        setT212Runs((prev) => {
          const other = prev.filter((r) => r.id !== runId);
          return [
            ...other,
            {
              id: runId,
              label,
              signalSource,
              result,
              lambda: storedLambda,
              trainFraction: storedTrainFraction,
            },
          ];
        });

        if (opts?.autoSelect) {
          setT212CurrentRunId(runId);
        }
      } catch (err: any) {
        console.error('[T212 Sim]', err);
        setT212Error(err?.message ?? 'Failed to run Trading212 simulation.');
      } finally {
        setIsRunningT212Sim(false);
      }
    },
    [
      params.ticker,
      t212CanonicalRows,
      ewmaPath,
      ewmaBiasedPath,
      reactionMapSummary,
      t212ThresholdPct,
      t212Leverage,
      t212DailyLongSwap,
      t212DailyShortSwap,
      t212PositionFraction,
      t212InitialEquity,
      reactionLambda,
      reactionTrainFraction,
      reactionOptimizationBest,
      buildTrading212SimBarsFromEwmaPath,
      t212DateRange,
    ]
  );

  // Handler for clicking Biased EWMA - load EWMA path only, no sim
  const handleLoadBiasedClick = useCallback(() => {
    // Mark that biased EWMA has been requested at least once
    biasedEverLoaded.current = true;

    // If we already have data, nothing else to do
    if (ewmaBiasedPath && ewmaBiasedPath.length > 0) {
      return;
    }

    // Otherwise, load the biased EWMA path
    loadEwmaBiasedWalker();
  }, [ewmaBiasedPath, loadEwmaBiasedWalker]);

  // For Unbiased we usually auto-load on mount, but keep a shim for completeness
  const handleLoadUnbiasedClick = useCallback(() => {
    if (!ewmaPath || ewmaPath.length === 0) {
      loadEwmaWalker();
    }
  }, [ewmaPath, loadEwmaWalker]);

  // Debug: Log T212 table row values whenever runs change
  useEffect(() => {
    if (t212Runs.length === 0) return;
    console.log("[T212] Table rows updated:");
    t212Runs.forEach((run) => {
      const r = run.result;
      const ret = (r.finalEquity - r.initialEquity) / r.initialEquity;
      const maxDdPct = r.maxDrawdown * 100;
      console.log("[T212] Table row", run.id, {
        label: run.label,
        retPct: (ret * 100).toFixed(1) + "%",
        maxDdPct: maxDdPct.toFixed(1) + "%",
        trades: r.trades.length,
        stopOuts: r.stopOutEvents,
        marginCalls: r.marginCallEvents,
        lambda: run.lambda,
        trainFraction: run.trainFraction,
      });
    });
  }, [t212Runs]);

  // Clear T212 runs when CFD is disabled (but keep EWMA overlay selection)
  useEffect(() => {
    if (!isCfdEnabled && t212Runs.length > 0) {
      console.log("[T212] CFD disabled, clearing runs (keeping EWMA overlay selection)");
      setT212Runs([]);
      setT212CurrentRunId(null);
      // Don't clear t212VisibleRunIds - keep EWMA overlay active on chart
    }
  }, [isCfdEnabled, t212Runs.length]);

  // Clear T212 runs when key parameters change to trigger fresh re-computation
  useEffect(() => {
    if (t212Runs.length > 0) {
      setT212Runs([]);
      setT212CurrentRunId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    params?.ticker,
    h,
    coverage,
    reactionLambda,
    reactionTrainFraction,
    t212InitialEquity,
    t212Leverage,
    t212PositionFraction,
    t212ThresholdPct,
    trendShortWindow,
    trendLongWindow,
    trendMomentumPeriod,
  ]);

  // Auto-run T212 sims when CFD is enabled and data is ready
  useEffect(() => {
    console.log("[T212 Auto-Run] Checking conditions:", {
      isCfdEnabled,
      t212RunsLength: t212Runs.length,
      hasEwmaPath: !!ewmaPath && ewmaPath.length > 0,
      hasEwmaBiasedPath: !!ewmaBiasedPath && ewmaBiasedPath.length > 0,
      hasReactionMapSummary: !!reactionMapSummary,
      hasOptimizationBest: !!reactionOptimizationBest,
    });

    // Only run when CFD is enabled
    if (!isCfdEnabled) return;
    
    // Only auto-run when we have no runs and the core model data is ready
    if (t212Runs.length > 0) return;

    // Require:
    // - EWMA Unbiased path
    // - EWMA Biased path (for biased runs)
    // - Reaction Map summary (for consistent test window)
    if (!ewmaPath || ewmaPath.length === 0) return;
    if (!ewmaBiasedPath || ewmaBiasedPath.length === 0) return;
    if (!reactionMapSummary) return;

    console.log("[T212 Auto-Run] All conditions met, running sims...");

    // Baseline runs: Unbiased + Biased
    runTrading212SimForSource("unbiased", "ewma-unbiased", "EWMA Unbiased", {
      autoSelect: false,
    });
    runTrading212SimForSource("biased", "ewma-biased", "EWMA Biased", {
      autoSelect: false,
    });

    // Biased (Max): only if we have an optimisation best config
    if (reactionOptimizationBest) {
      runTrading212SimForSource(
        "biased",
        "ewma-biased-max",
        "EWMA Biased (Max)",
        { autoSelect: false }
      );
    }
  }, [
    isCfdEnabled,
    t212Runs.length,
    ewmaPath,
    ewmaBiasedPath,
    reactionMapSummary,
    reactionOptimizationBest,
    runTrading212SimForSource,
  ]);

  // Add "EWMA Biased (Max)" and "EWMA Trend (Max)" runs when optimization completes (if not already present)
  useEffect(() => {
    // Only add if CFD is enabled
    if (!isCfdEnabled) return;
    
    // Only add if we have optimization results and the run doesn't exist yet
    if (!reactionOptimizationBest) return;
    if (!ewmaBiasedPath || ewmaBiasedPath.length === 0) return;
    if (!reactionMapSummary) return;
    
    // Check if we already have a Biased (Max) run
    const hasMaxRun = t212Runs.some(r => r.id === "ewma-biased-max");
    if (!hasMaxRun) {
      console.log("[T212 Auto-Run] Adding EWMA Biased (Max) after optimization completed...");
      runTrading212SimForSource(
        "biased",
        "ewma-biased-max",
        "EWMA Biased (Max)",
        { autoSelect: false }
      );
    }
  }, [isCfdEnabled, reactionOptimizationBest, ewmaBiasedPath, reactionMapSummary, t212Runs, runTrading212SimForSource]);

  // Debug: Monitor conformal state changes
  useEffect(() => {
    console.log("[CONF] conformalState changed:", conformalState);
  }, [conformalState]);

  // Clear conformal state when key parameters change to avoid stale data
  // Note: Removed activeBaseMethod to prevent clearing on every forecast change
  useEffect(() => {
    console.log("[CONF] Config change detected, clearing conformal state");
    setConformalState(null);
  }, [conformalMode, conformalDomain, conformalCalWindow]);

  // Keep base forecasts to generate in sync with calibration window
  useEffect(() => {
    setBaseForecastsToGenerate(conformalCalWindow);
  }, [conformalCalWindow]);

  // Handle generation of base forecasts for conformal prediction
  const handleGenerateBaseForecasts = useCallback(async (): Promise<BaseForecastsResult> => {
    // Use selected base method from current UI selection
    const baseMethod = selectedBaseMethod;

    console.log('[DEBUG] handleGenerateBaseForecasts called:', {
      selectedBaseMethod,
      baseMethod,
      volModel,
      garchEstimator,
      rangeEstimator,
      targetSpecResult: !!targetSpecResult
    });

    try {
      setIsGeneratingBase(true);
      setConformalError(null);

      console.log('[Conformal] Generating base forecasts:', {
        symbol: tickerParam,
        baseMethod: baseMethod,
        calWindow: conformalCalWindow,
        domain: conformalDomain,
        h,
        coverage
      });

      const response = await fetch(`/api/conformal/generate/${encodeURIComponent(tickerParam)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_method: baseMethod,
          cal_window: conformalCalWindow,
          domain: conformalDomain,
          horizon: h,                               // Add horizon from UI state
          coverage: coverage                        // Add coverage from UI state
        })
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('[Conformal] Generate base forecasts error:', data);
        setConformalError(data.error || data.details || 'Failed to generate base forecasts');
        return { ok: false, baseForecastCount: 0 };
      }

      console.log('[Conformal] Generated base forecasts:', data);
      
      // Track generated file IDs for auto-cleanup
      if (data.generatedFileIds && Array.isArray(data.generatedFileIds)) {
        data.generatedFileIds.forEach((fileId: string) => {
          trackGeneratedFile(fileId);
          console.log('[AutoCleanup] Tracked base forecast file:', fileId);
        });
      }
      
      // Show success message briefly
      const successMessage = `Generated ${data.created} new forecasts. ${data.alreadyExisting} already existed.`;
      console.log('[Conformal]', successMessage);
      
      // Calculate total base forecast count after generation
      const totalCount = (data.created || 0) + (data.alreadyExisting || 0);
      
      // Refresh the base forecast count to update the panel
      await loadBaseForecastCount();
      await loadModelLine();
      
      // You could also show a temporary success message
      // setConformalError(null); // Clear any previous errors
      
      return { ok: true, baseForecastCount: totalCount };
    } catch (err) {
      console.error('[Conformal] Generate base forecasts error:', err);
      setConformalError(err instanceof Error ? err.message : String(err));
      return { ok: false, baseForecastCount: 0 };
    } finally {
      setIsGeneratingBase(false);
    }
  }, [tickerParam, selectedBaseMethod, conformalCalWindow, conformalDomain, h, coverage, loadBaseForecastCount, loadModelLine, volModel, garchEstimator, rangeEstimator, targetSpecResult, trackGeneratedFile]);

  // Generate base forecasts for current configuration (symbol, base method, horizon, coverage, domain)
  const handleGenerateBaseForecastsForCurrentConfig = useCallback(async () => {
    if (!tickerParam) return;
    
    try {
      setIsGeneratingBase(true);
      setConformalError(null);

      const baseMethod = selectedBaseMethod;
      const body = {
        base_method: baseMethod,
        cal_window: baseForecastsToGenerate, // Use user-specified number instead of conformalCalWindow
        domain: conformalDomain,
        horizon: h,
        coverage: coverage
      };

      console.log(`[BASE] Generating base forecasts for current config:`, {
        symbol: tickerParam,
        ...body
      });

      const resp = await fetch(
        `/api/conformal/generate/${encodeURIComponent(tickerParam)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setConformalError(data.error || data.details || "Failed to generate base forecasts.");
        return;
      }

      const data = await resp.json();
      console.log("[BASE] Generated base forecasts successfully:", data);

      // Track generated file IDs for auto-cleanup
      if (data.generatedFileIds && Array.isArray(data.generatedFileIds)) {
        data.generatedFileIds.forEach((fileId: string) => {
          trackGeneratedFile(fileId);
          console.log('[AutoCleanup] Tracked base forecast file (manual):', fileId);
        });
      }

      // Show success info
      if (data.message) {
        console.log("[BASE]", data.message);
      }

      // Refresh the base forecast count so UI shows updated availability
      await loadBaseForecastCount();

    } catch (err: any) {
      console.error("[BASE] Error generating base forecasts", err);
      setConformalError(err?.message || "Failed to generate base forecasts.");
    } finally {
      setIsGeneratingBase(false);
    }
  }, [tickerParam, selectedBaseMethod, baseForecastsToGenerate, conformalDomain, h, coverage, loadBaseForecastCount, trackGeneratedFile]);

  const generateGbmForecast = useCallback(async () => {
    setIsGeneratingForecast(true);
    setForecastError(null);

    try {
      const response = await fetch(`/api/forecast/gbm/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          windowN: window,
          lambdaDrift,
          coverage,
          horizonTrading: h,  // Add horizon parameter
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate forecast');
      }

      setGbmForecast(data);            // GBM card shows only GBM
      
      // Critical: Setting activeForecast from GBM
      const timestamp = new Date().toISOString();
      console.log(`🎯 BROWSER DEBUG [${timestamp}] ✅ SETTING activeForecast in GBM generation:`, {
        dataKeys: data ? Object.keys(data) : null,
        method: data?.method,
        date_t: data?.date_t,
        stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
      });
      setActiveForecast(data);         // Final PI shows GBM until a vol model is run
      
      // Reload forecasts to get the updated list
      await loadLatestForecast();
      
    } catch (err) {
      setForecastError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsGeneratingForecast(false);
    }
  }, [window, lambdaDrift, coverage, h, params.ticker, loadLatestForecast]);

  const generateVolatilityForecast = useCallback(async (): Promise<VolForecastResult> => {
    console.log("[VOL][handler] click", new Date().toISOString());
    console.log("[VOL][handler] click", { time: new Date().toISOString() });
    setVolatilityError(null);

    // Read current values from state instead of depending on them
    const currentTargetSpec = targetSpecResult || serverTargetSpec;
    const persistedCoverage = currentTargetSpec?.spec?.coverage;
    const persistedTZ = currentTargetSpec?.spec?.exchange_tz;
    const currentCanonicalCount = canonicalCount;
    const currentRvAvailable = rvAvailable;

    console.log("[VOL][handler] inputs", {
      volModel,
      garchEstimator,
      rangeEstimator,
      volWindow,
      dist: garchEstimator === 'Normal' ? 'normal' : 'student-t',
      varianceTargeting: garchVarianceTargeting,
      tickerParam,
      persistedCoverage,
      persistedTZ,
      canonicalCount: currentCanonicalCount,
    });

    const hasTargetPersisted = !!persistedCoverage;
    const covOK = hasTargetPersisted ? (persistedCoverage! > 0.50 && persistedCoverage! <= 0.999) : false;

    // Construct the model name for logic checks
    const model = volModel === 'GBM'
      ? 'GBM-CC'
      : volModel === 'GARCH' 
      ? (garchEstimator === 'Student-t' ? 'GARCH11-t' : 'GARCH11-N')
      : volModel === 'HAR-RV' 
      ? 'HAR-RV' 
      : `Range-${rangeEstimator}`;
    const windowN = volModel === 'GBM' ? gbmWindow : volWindow;

    const hasData = currentCanonicalCount >= windowN;
    const hasTZ   = !!persistedTZ;
    const wantsHar = volModel === "HAR-RV";
    const harAvailable = !wantsHar || currentRvAvailable;  // only true if RV exists

    console.log("[VOL][handler] guard", { hasTargetPersisted, hasData, covOK, hasTZ, harAvailable, rvAvailable: currentRvAvailable });

    if (!hasTargetPersisted) { 
      console.log("[VOL][handler] early-return", { reason: "no-target-persisted" });
      const errorMessage = !isInitialized 
        ? 'System is still initializing. Please wait a moment and try again.'
        : 'Target specification not found. Save Forecast Target first by setting Horizon and Coverage values.'; 
      setVolatilityError(errorMessage);
      return { ok: false, forecast: null };
    }
    if (!hasData) { 
      console.log("[VOL][handler] early-return", { reason: "insufficient-data" });
      setVolatilityError(`Insufficient history: need ${windowN} days, have ${currentCanonicalCount}.`);
      return { ok: false, forecast: null };
    }
    if (!covOK) { 
      console.log("[VOL][handler] early-return", { reason: "coverage-invalid" });
      setVolatilityError("Coverage must be between 50% and 99.9%.");
      return { ok: false, forecast: null };
    }
    if (!hasTZ) { 
      console.log("[VOL][handler] early-return", { reason: "no-timezone" });
      setVolatilityError("Exchange timezone missing in Target Spec.");
      return { ok: false, forecast: null };
    }
    if (!harAvailable) {
      console.log("[VOL][handler] early-return", { reason: "har-unavailable" });
      setVolatilityError("Realized-volatility inputs not found (daily/weekly/monthly). HAR-RV requires RV.");
      return { ok: false, forecast: null };
    }

    if (!canonicalCount || canonicalCount <= 0) {
      console.log("[VOL][handler] early-return", { reason: "no-canonical-data" });
      setVolatilityError('No canonical data available. Please upload price history before generating forecasts.');
      return { ok: false, forecast: null };
    }

    setIsGeneratingVolatility(true);

    // Resolve distribution and estimator based on new UI state
    const resolvedDist = volModel === 'GARCH' && garchEstimator === 'Student-t' ? 'student-t' : 'normal';
    const resolvedEstimator = volModel === 'Range' ? rangeEstimator : 'P'; // fallback for non-range models

    // Construct the model name for API
    let selectedModel: string;
    if (volModel === 'GBM') {
      selectedModel = 'GBM-CC';
    } else if (volModel === 'GARCH') {
      selectedModel = garchEstimator === 'Student-t' ? 'GARCH11-t' : 'GARCH11-N';
    } else if (volModel === 'HAR-RV') {
      selectedModel = 'HAR-RV';
    } else { // Range
      selectedModel = `Range-${rangeEstimator}`;
    }

    console.log("[VOL][handler] inputs", { 
      volModel,
      garchEstimator,
      rangeEstimator,
      selectedModel,
      volWindow, 
      dist: resolvedDist, 
      estimator: resolvedEstimator,
      varianceTargeting: garchVarianceTargeting,
      tickerParam, 
      persistedCoverage, 
      persistedTZ 
    });

    try {
      // Build params using resolved values
      let modelParams: any = {};
      
      if (volModel === 'GBM') {
        modelParams.gbm = {
          windowN: gbmWindow,
          lambdaDrift: gbmLambda,
        };
      } else if (volModel === 'GARCH') {
        modelParams.garch = {
          window: volWindow,
          variance_targeting: garchVarianceTargeting,
          dist: resolvedDist,
          ...(resolvedDist === 'student-t' ? { df: garchDf } : {})
        };
      } else if (volModel === 'HAR-RV') {
        modelParams.har = {
          window: volWindow,
          use_intraday_rv: harUseIntradayRv
        };
      } else { // Range
        modelParams.range = {
          estimator: resolvedEstimator,
          window: volWindow,
          ewma_lambda: rangeEwmaLambda
        };
      }

      console.log("[VOL] POST", { model: selectedModel, estimator: resolvedEstimator });

      // Add Range-specific logging
      if (selectedModel?.startsWith('Range-')) {
        const estimator = selectedModel.split('-')[1];
        console.log('[RANGE] POST', { 
          url: `/api/volatility/${encodeURIComponent(tickerParam)}`, 
          model: selectedModel, 
          estimator: estimator 
        });
      }

      console.log("[VOL][handler] POST -> /api/volatility", {
        url: `/api/volatility/${encodeURIComponent(tickerParam)}`,
        model: selectedModel,
        windowN: selectedModel === 'GBM-CC' ? gbmWindow : volWindow,
        dist: resolvedDist,
        requestBody: {
          model: selectedModel,
          params: modelParams,
          overwrite: true,
          horizon: h,
          coverage: persistedCoverage,
          tz: persistedTZ
        }
      });
      console.debug("[VOL] POST payload (UI-driven)", {
        model: selectedModel,
        horizon: h,
        coverage: persistedCoverage,
        windowForModel: selectedModel === 'GBM-CC' ? gbmWindow : volWindow,
        gbmWindow,
        volWindow
      });

      const resp = await fetch(`/api/volatility/${encodeURIComponent(tickerParam)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          params: modelParams,
          overwrite: true,
          // Pass horizon and coverage from UI state
          horizon: h,
          coverage: persistedCoverage,
          tz: persistedTZ
        })
      });

      console.log("[VOL][handler] resp.status =", resp.status);
      console.log("[VOL][handler] resp.headers =", Object.fromEntries(resp.headers.entries()));
      
      if (!resp.ok) {
        // Handle error response with content-type detection
        const contentType = resp.headers.get('content-type') || '';
        
        if (contentType.includes('application/json')) {
          const errorData = await resp.json();
          const errorMessage = errorData.error || errorData.message || JSON.stringify(errorData);
          console.error('[VOL] API error:', errorData);
          console.error('[VOL] Full error details:', errorData);
          const detailedError = errorData.details ? `${errorMessage} - ${errorData.details}` : errorMessage;
          setVolatilityError(detailedError);
        } else {
          // Likely HTML error page from server crash
          const htmlText = await resp.text();
          console.error('[VOL] Server error body:', htmlText);
          setVolatilityError(`Server error ${resp.status}. Check console for details.`);
        }
        return { ok: false, forecast: null };
      }

      const bodyText = await resp.text();
      console.log("[VOL][handler] resp.body =", bodyText);

      const data = JSON.parse(bodyText);
      
      if (volModel === 'GBM') {
        // GBM from Volatility card is our baseline
        setGbmForecast(data);    // feed green cone baseline
        setVolForecast(null);    // GBM is not considered a "vol" model
        setBaseForecast(data);   // Store as base forecast for conformal calibration
      } else {
        // GARCH / HAR / Range
        setVolForecast(data);    // last volatility model run
        setBaseForecast(data);   // Store as base forecast for conformal calibration
        // NOTE: DO NOT touch gbmForecast here – we keep the baseline
      }
      
      // Always update active forecast so chart reflects the latest model selection
      setActiveForecast(data);
      setCurrentForecast(data);        // keep for legacy compatibility if needed elsewhere
      console.log("[VOL][handler] setForecast", { 
        volModel,
        method: data?.method, 
        date: data?.date_t, 
        is_active: data?.is_active,
        gbmUpdated: volModel === 'GBM',
        volUpdated: volModel !== 'GBM'
      });

      // Note: Don't call loadLatestForecast here - pipeline will handle state management
      return { ok: true, forecast: data };
    } catch (err) {
      setVolatilityError(err instanceof Error ? err.message : 'Unknown error');
      return { ok: false, forecast: null };
    } finally {
      setIsGeneratingVolatility(false);
    }
  }, [
    tickerParam,
    volModel,
    garchEstimator,
    rangeEstimator,
    volWindow,
    garchVarianceTargeting,
    garchDf,
    harUseIntradayRv,
    rangeEwmaLambda,
    gbmWindow,
    gbmLambda,
    canonicalCount,
    isInitialized,
    rvAvailable,
    serverTargetSpec,
    targetSpecResult,
    h, // Add horizon as dependency
  ]);

  // Validation Gates Functions
  const checkGatesBeforeAction = useCallback(async (actionName: string): Promise<boolean> => {
    setIsCheckingGates(true);
    try {
      const response = await fetch(`/api/validation/gates/${params.ticker}`);
      if (!response.ok) {
        throw new Error(`Gates API failed: ${response.status}`);
      }
      const gates: GateStatus = await response.json();
      setGatesStatus(gates);
      
      if (!gates.ok) {
        const errorMsg = `Cannot proceed with ${actionName}:\n${gates.errors.join('\n')}`;
        alert(errorMsg);
        return false;
      }
      
      if (gates.warnings.length > 0) {
        const warningMsg = `Warnings for ${actionName}:\n${gates.warnings.join('\n')}\n\nProceed anyway?`;
        return confirm(warningMsg);
      }
      
      return true;
    } catch (err) {
      console.error('Gates check failed:', err);
      const proceedAnyway = confirm(`Gates validation failed (${err}). Proceed anyway?`);
      return proceedAnyway;
    } finally {
      setIsCheckingGates(false);
    }
  }, [params.ticker]);

  const applyConformalPrediction = useCallback(async (
    overrideBaseForecast?: any
  ): Promise<boolean> => {
    // Check validation gates first
    const canProceed = await checkGatesBeforeAction('conformal prediction');
    if (!canProceed) return false;

    // Derive effective base forecast - use override if provided, fallback to state
    const effectiveBaseForecast = overrideBaseForecast ?? baseForecast;

    // Ensure we have a base forecast to calibrate
    if (!effectiveBaseForecast) {
      console.log("[CONF] applyConformalPrediction guard check:", {
        isInitialized,
        hasBaseForecast: !!baseForecast,
        hasOverrideBaseForecast: !!overrideBaseForecast,
        hasEffectiveBaseForecast: !!effectiveBaseForecast,
        baseForecastCount,
        volModel,
        h,
        coverage,
      });
      const errorMessage = !isInitialized 
        ? 'System is still initializing. Please wait a moment and try again.'
        : 'No base forecast found. Please generate a volatility forecast first by clicking on a model button (GBM, GARCH, HAR-RV, or Range).';
      setConformalError(errorMessage);
      return false;
    }

    // Use selected base method from current UI selection
    const baseMethod = selectedBaseMethod;
    const selectedCoverage = coverage;

    setIsApplyingConformal(true);
    setConformalError(null);

    try {
      const conformalParams = {
        mode: conformalMode,
        domain: conformalDomain,
        cal_window: conformalCalWindow,
        ...(conformalMode === 'ACI' ? { eta: conformalEta } : {}),
        ...(conformalMode === 'EnbPI' ? { K: conformalK } : {})
      };

      const response = await fetch(`/api/conformal/${tickerParam}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: tickerParam,
          params: conformalParams,
          base_method: baseMethod,
          horizon: h,
          coverage: selectedCoverage
        }),
      });

      let data = await response.json();

      console.log("[CONF] API response", {
        ok: response.ok,
        hasState: !!data?.state,
        stateKeys: data?.state ? Object.keys(data.state) : null,
        hasCoverage: !!data?.state?.coverage,
        stateObject: data?.state,
        raw: data,
      });

      if (!response.ok) {
        if (response.status === 409 && data.code === 'DOMAIN_CONFLICT') {
          const confirmRecalibrate = confirm(
            `Domain conflict: existing state uses '${data.existing_domain}' but you selected '${data.requested_domain}'. Do you want to force recalibration?`
          );
          
          if (confirmRecalibrate) {
            // Retry with force=true
            const retryResponse = await fetch(`/api/conformal/${params.ticker}?force=true`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                symbol: params.ticker,
                params: conformalParams,
                base_method: baseMethod,
                horizon: h,
                coverage: selectedCoverage
              }),
            });
            
            const retryData = await retryResponse.json();
            
            if (!retryResponse.ok) {
              throw new Error(retryData.error || 'Failed to apply conformal prediction');
            }
            
            data = retryData; // Use retry data for subsequent processing
          } else {
            setConformalError('Operation cancelled: domain conflict not resolved');
            return false;
          }
        } else if (data.error && data.error.includes('Insufficient base forecasts')) {
          // Enhanced error message for insufficient base forecasts
          const match = data.error.match(/need (\d+), have (\d+)/);
          if (match) {
            const [, needed, have] = match;
            const shortage = parseInt(needed) - parseInt(have);
            setConformalError(
              `Insufficient base forecasts: need ${needed}, have ${have}. ` +
              `Generate ${shortage} more base forecasts or reduce calibration window to ${have}.`
            );
          } else {
            setConformalError(
              `${data.error}. Consider generating more base forecasts or reducing the calibration window.`
            );
          }
          return false;
        } else {
          throw new Error(data.error || 'Failed to apply conformal prediction');
        }
      }

      // Extract base bands for conformal adjustment
      const intervals = effectiveBaseForecast.intervals || effectiveBaseForecast.pi || effectiveBaseForecast;
      const L_base = effectiveBaseForecast.L_h || intervals.L_h || intervals.L1 || intervals.lower;
      const U_base = effectiveBaseForecast.U_h || intervals.U_h || intervals.U1 || intervals.upper;

      // Build updated forecast with conformal bands
      let updatedForecast = effectiveBaseForecast;

      if (typeof data.state?.q_cal === "number" && L_base != null && U_base != null) {
        // Compute conformal-adjusted bands in log space
        const center_base = (L_base + U_base) / 2;
        const yHat = Math.log(center_base);
        const L_conf = Math.exp(yHat - data.state.q_cal);
        const U_conf = Math.exp(yHat + data.state.q_cal);

        updatedForecast = {
          ...effectiveBaseForecast,
          intervals: {
            ...intervals,
            L_base,
            U_base,
            L_conf,
            U_conf
          },
          conformal: {
            q_cal: data.state.q_cal,
            mode: data.state.mode,
            domain: data.state.domain,
          },
        };

        console.log('[Conformal] Applied conformal bands:', { L_conf, U_conf });
      } else {
        console.warn('[Conformal] No valid q_cal or base bands, using effectiveBaseForecast as-is');
      }

      // Single atomic commit of all conformal-related state
      // React will batch these setState calls into one render
      console.log("[CONF] About to set conformal state:", data.state);
      setConformalState(data.state);
      console.log("[CONF] Just set conformal state");
      
      // Critical moment: Setting activeForecast with conformal result
      const timestamp = new Date().toISOString();
      console.log(`🎯 BROWSER DEBUG [${timestamp}] ✅ SETTING activeForecast in conformal pipeline:`, {
        updatedForecastKeys: updatedForecast ? Object.keys(updatedForecast) : null,
        hasIntervals: !!updatedForecast?.intervals,
        hasConformal: !!updatedForecast?.conformal,
        method: updatedForecast?.method,
        date_t: updatedForecast?.date_t,
        stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
      });
      setActiveForecast(updatedForecast);
      
      setCurrentForecast(updatedForecast); // Keep for legacy compatibility
      setShowCoverageDetails(true);

      console.log('[Conformal] Successfully applied conformal prediction with atomic state update');
      console.log("[CONF] applyConformalPrediction success", {
        hasConformalState: !!data?.state,
        updatedForecastKeys: updatedForecast ? Object.keys(updatedForecast) : null,
      });
      return true;

    } catch (err) {
      setConformalError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    } finally {
      setIsApplyingConformal(false);
    }
  }, [
    selectedBaseMethod,
    conformalMode,
    conformalDomain,
    conformalCalWindow,
    conformalEta,
    conformalK,
    tickerParam,
    params.ticker,
    baseForecast,  // Changed from activeForecast to baseForecast
    baseForecastCount,  // Add missing dependency
    volModel,  // Add missing dependency  
    checkGatesBeforeAction,
    h,
    coverage,
    isInitialized,
  ]);

  // Command 2: Add handleUnifiedGenerate orchestrator
  const handleUnifiedGenerate = useCallback(async () => {
    try {
      // 1) First generate/update volatility forecast (GBM / GARCH / HAR / Range)
      const volResult = await generateVolatilityForecast();
      if (!volResult.ok || !volResult.forecast) return;

      // Wait for the forecast to be loaded and active method to be updated
      await loadLatestForecast();

      // 2) Then ensure base forecasts exist for current method + cal window
      if (baseForecastCount !== null && baseForecastCount < conformalCalWindow) {
        const baseRes = await handleGenerateBaseForecasts();
        await loadBaseForecastCount();
        await loadModelLine();
        if (!baseRes.ok) return;
      }

      // 3) Finally apply conformal calibration using the fresh forecast
      await applyConformalPrediction(volResult.forecast);
    } catch (err) {
      console.error('[UnifiedGenerate] error', err);
    }
  }, [
    baseForecastCount,
    conformalCalWindow,
    handleGenerateBaseForecasts,
    loadBaseForecastCount,
    loadModelLine,
    generateVolatilityForecast,
    applyConformalPrediction,
    loadLatestForecast,
  ]);

  // Centralized forecast pipeline with status management
  const runForecastPipeline = useCallback(async () => {
    console.log('[ForecastPipeline] Starting pipeline execution:', { h, coverage, volModel, garchEstimator, rangeEstimator });

    if (!pipelineReady) {
      console.log('[ForecastPipeline] Skipping pipeline - prerequisites not ready', {
        pipelineReady,
        isInitialized,
        hasTargetSpec: Boolean(resolvedTargetSpec?.spec),
        hasCoverage: typeof resolvedTargetSpec?.spec?.coverage === 'number',
        hasHorizon: typeof resolvedTargetSpec?.spec?.h === 'number',
        hasTZ: Boolean(resolvedTargetSpec?.spec?.exchange_tz),
        canonicalCount,
      });
      return;
    }

    try {
      setForecastStatus("loading");
      setForecastError(null);
      setConformalError(null);
      setVolatilityError(null);

      // Clear stale state but preserve activeForecast for chart continuity
      setBaseForecastsStale(true);
      setConformalStale(true);
      setCoverageStatsStale(true);
      setBaseForecastCount(null);
      setConformalState(null);
      // Note: NOT clearing activeForecast here - keep existing forecast visible until new one is ready

      console.log('[ForecastPipeline] Step 1: Generating volatility forecast');
      console.log('[PIPE] Step 1 start - generateVolatilityForecast', {
        volModel,
        hasBaseForecastBefore: !!baseForecast
      });
      // 1) Generate volatility forecast for current volModel/estimator
      const volResult = await generateVolatilityForecast();
      console.log('[PIPE] Step 1 result:', { 
        ok: volResult.ok, 
        hasForecast: !!volResult.forecast,
        hasBaseForecastAfter: !!baseForecast 
      });
      if (!volResult.ok || !volResult.forecast) {
        // Step 1 failed - no base forecast available for chart overlay
        console.log('[PIPE] Step 1 failed - no forecast available for chart overlay');
        setForecastStatus("error");
        return;
      }
      const baseForecastObject = volResult.forecast;

      console.log('[ForecastPipeline] Step 2: Generating base forecasts');
      console.log('[PIPE] Step 2 start - handleGenerateBaseForecasts');
      // 2) Generate / refresh base forecasts for conformal (if needed)
      const baseRes = await handleGenerateBaseForecasts();
      console.log('[PIPE] Step 2 result:', { 
        ok: baseRes.ok,
        baseForecastCount: baseRes.baseForecastCount 
      });
      if (!baseRes.ok) {
        // Step 2 failed - use base forecast for chart overlay if available
        const timestamp = new Date().toISOString();
        console.log(`🎯 BROWSER DEBUG [${timestamp}] ⚠️ Step 2 failed - SETTING activeForecast to baseForecastObject:`, {
          baseForecastObjectKeys: baseForecastObject ? Object.keys(baseForecastObject) : null,
          baseResOk: baseRes.ok,
          stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
        });
        console.log('[PIPE] Step 2 failed - using base forecast as activeForecast for chart overlay');
        setActiveForecast(baseForecastObject);
        setForecastStatus("error");
        return;
      }

      console.log('[ForecastPipeline] Step 3: Applying conformal prediction');
      console.log('[PIPE] Step 3 start - applyConformalPrediction with fresh base forecast');
      // 3) Apply conformal prediction using the fresh base forecast object
      const conformalSuccess = await applyConformalPrediction(baseForecastObject);
      console.log('[PIPE] Step 3 result:', { 
        conformalSuccess, 
        hasConformalState: !!conformalState 
      });
      if (!conformalSuccess) {
        // Fallback: Use base forecast for chart overlay even if conformal fails
        const timestamp = new Date().toISOString();
        console.log(`🎯 BROWSER DEBUG [${timestamp}] ⚠️ Conformal failed - SETTING activeForecast to baseForecastObject:`, {
          conformalSuccess,
          baseForecastObjectKeys: baseForecastObject ? Object.keys(baseForecastObject) : null,
          hasConformalState: !!conformalState,
          stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
        });
        console.log('[PIPE] Conformal failed - using base forecast as activeForecast for chart overlay');
        setActiveForecast(baseForecastObject);
        setForecastStatus("error");
        return;
      }

      // Clear stale flags on success
      setBaseForecastsStale(false);
      setConformalStale(false);
      setCoverageStatsStale(false);
      setForecastHorizonMismatch(false); // Clear horizon mismatch flag

      console.log('[ForecastPipeline] Pipeline complete - setting status to ready');
      console.log('[PIPE] Success - activeForecast should now be available for chart overlay');
      
      // Final pipeline success logging
      const timestamp = new Date().toISOString();
      console.log(`🎯 BROWSER DEBUG [${timestamp}] ✅ Pipeline SUCCESS - activeForecast should remain from conformal step:`, {
        hasActiveForecast: !!activeForecast,
        activeForecastMethod: activeForecast?.method,
        activeForecastDate: activeForecast?.date_t,
        stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
      });
      
      setForecastStatus("ready");
    } catch (error) {
      console.error('[ForecastPipeline] Pipeline error:', error);
      
      // Fallback: If we have a base forecast from step 1, use it for chart overlay
      if (baseForecast) {
        const timestamp = new Date().toISOString();
        console.log(`🎯 BROWSER DEBUG [${timestamp}] ⚠️ Pipeline failed - SETTING activeForecast to baseForecast:`, {
          error: error instanceof Error ? error.message : error,
          baseForecastKeys: baseForecast ? Object.keys(baseForecast) : null,
          stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
        });
        console.log('[PIPE] Pipeline failed - using available baseForecast as activeForecast for chart overlay');
        setActiveForecast(baseForecast);
      }
      
      setForecastStatus("error");
      setForecastError(error instanceof Error ? error.message : 'Failed to complete forecast pipeline');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    h,
    coverage,
    volModel,
    garchEstimator,
    rangeEstimator,
    generateVolatilityForecast,
    handleGenerateBaseForecasts,
    applyConformalPrediction,
    pipelineReady,
    isInitialized,
    resolvedTargetSpec,
    canonicalCount,
    baseForecast,
    conformalState,
    // Note: activeForecast intentionally omitted - only used for debug logging, not logic
  ]);

  // Handlers for parameter changes - auto-trigger volatility forecast for Inspector
  const handleHorizonChange = useCallback(async (newH: number) => {
    // Update UI state immediately
    setH(newH);
    
    // Mark that forecast may be stale if we have an active forecast
    if (activeForecast) {
      setForecastHorizonMismatch(true);
    }

    console.log(`[HorizonChange] Updated horizon to h=${newH}. Volatility forecast will auto-update for Inspector.`);
    
    // Auto-triggers volatility forecast via useEffect (for Inspector)
    // Conformal calibration only runs when user clicks "Generate"
  }, [activeForecast]);

  const handleCoverageChange = useCallback((newCoverage: number) => {
    setCoverage(newCoverage);
    // Auto-triggers volatility forecast via useEffect (for Inspector)
    // Conformal calibration only runs when user clicks "Generate"
  }, []);

  const handleModelChange = useCallback((newModel: 'GBM' | 'GARCH' | 'HAR-RV' | 'Range') => {
    setVolModel(newModel);
    // Clear stale overlays so tooltip/chart doesn't show previous model while new one is loading
    setActiveForecast(null);
    setBaseForecast(null);
    setVolForecast(null);
    // Auto-triggers volatility forecast via useEffect (for Inspector)
    // Conformal calibration only runs when user clicks "Generate"
  }, []);

  const handleEstimatorChange = useCallback((newEstimator: 'P' | 'GK' | 'RS' | 'YZ') => {
    setRangeEstimator(newEstimator);
    // Auto-triggers volatility forecast via useEffect (for Inspector)
    // Conformal calibration only runs when user clicks "Generate"
  }, []);

  const handleGarchEstimatorChange = useCallback((newEstimator: 'Normal' | 'Student-t') => {
    setGarchEstimator(newEstimator);
    // Auto-triggers volatility forecast via useEffect (for Inspector)
    // Conformal calibration only runs when user clicks "Generate"
  }, []);

  // Apply recommended model to UI state (no automatic pipeline execution)
  const handleApplyBestModel = useCallback(() => {
    if (!recommendedModel) return;
    const nextState = parseMethodToUIState(recommendedModel);
    if (!nextState) return;
    
    setVolModel(nextState.volModel);
    if (nextState.garchEstimator) {
      setGarchEstimator(nextState.garchEstimator);
    }
    if (nextState.rangeEstimator) {
      setRangeEstimator(nextState.rangeEstimator);
    }
    
    console.log(`Applied recommended model: ${recommendedModel}`);
    // Do not call runForecastPipeline here – user must click Generate.
  }, [recommendedModel]);

  // Override the early onGenerateBaseForecastsClick with the proper implementation
  // Note: This function is deprecated in favor of the main Generate button
  // Kept for UI compatibility but no longer triggers pipeline automatically
  const onGenerateBaseForecastsClick = useCallback(async () => {
    // Only proceed if there are no base forecasts available (0 or null)
    if (baseForecastCount !== null && baseForecastCount > 0) {
      console.log('[BaseForecasts] Skipping generation - base forecasts already exist:', baseForecastCount);
      return;
    }
    
    console.log('[BaseForecasts] Base forecasts needed - use main Generate button to run full pipeline');
    // Do not call runForecastPipeline here – user must click main Generate button.
  }, [baseForecastCount]);

  // Main Generate button - the ONLY entry point to the forecast pipeline
  const handleGenerateClick = useCallback(() => {
    console.log("[GEN] Click Generate", {
      pipelineReady,
      forecastStatus,
      hasBaseForecast: !!baseForecast,
      hasTargetSpec: !!resolvedTargetSpec?.spec,
      targetSpecCoverage: resolvedTargetSpec?.spec?.coverage,
      targetSpecHorizon: resolvedTargetSpec?.spec?.h,
      targetSpecTZ: resolvedTargetSpec?.spec?.exchange_tz,
      canonicalCount,
      isInitialized
    });

    if (!pipelineReady) {
      console.log("[Generate] Pipeline not ready:", {
        isInitialized,
        hasTargetSpec: Boolean(resolvedTargetSpec?.spec),
        hasCoverage: typeof resolvedTargetSpec?.spec?.coverage === "number",
        hasHorizon: typeof resolvedTargetSpec?.spec?.h === "number",
        hasTZ: Boolean(resolvedTargetSpec?.spec?.exchange_tz),
        canonicalCount,
      });
      setForecastError("Please save a valid horizon/coverage first.");
      return;
    }

    if (forecastStatus === "loading") {
      console.log("[Generate] Pipeline already in flight, ignoring click.");
      return;
    }

    console.log("[Generate] Running forecast pipeline with current selections.");
    runForecastPipeline();
  }, [
    pipelineReady,
    isInitialized,
    resolvedTargetSpec,
    canonicalCount,
    forecastStatus,
    runForecastPipeline,
    baseForecast
  ]);

  const saveTargetSpec = async () => {
    setIsSavingTarget(true);
    setTargetError(null);
    setSaveSuccess(false);

    try {
      const response = await fetch(`/api/target-spec/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ h, coverage, exchange_tz: resolvedTZ }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save target spec');
      }

      setTargetSpecResult({ 
        spec: data, 
        meta: { hasTZ: true, source: "canonical" } 
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      
      // Reload server target spec so generate button enables immediately
      await loadServerTargetSpec();
    } catch (err) {
      setTargetError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSavingTarget(false);
    }
  };

  // Validation
  const isValidH = h >= 1;
  const isValidCoverage = coverage > 0.50 && coverage <= 0.995;
  
  // Compute resolved TZ for Forecast Target save
  const canonicalTZ = uploadResult?.meta?.exchange_tz ?? null;
  const selectedExchange = null; // TODO: Add company state for this
  const resolvedTZ = resolveExchangeTZ({ canonicalTZ, selectedExchange });

  // Auto-save function for horizon and coverage changes
  const autoSaveTargetSpec = useCallback(async () => {
    // Only auto-save if we have valid values and resolved timezone
    if (isValidH && isValidCoverage && resolvedTZ && !isSavingTarget) {
      try {
        const response = await fetch(`/api/target-spec/${params.ticker}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ h, coverage, exchange_tz: resolvedTZ }),
        });

        const data = await response.json();

        if (response.ok) {
          setTargetSpecResult({ 
            spec: data, 
            meta: { hasTZ: true, source: "canonical" } 
          });
          // Reload server target spec so generate button enables immediately
          await loadServerTargetSpec();
        }
      } catch (err) {
        // Silently handle auto-save errors to not interrupt user experience
        console.warn('Auto-save failed:', err);
      }
    }
  }, [isValidH, isValidCoverage, resolvedTZ, isSavingTarget, params.ticker, h, coverage, loadServerTargetSpec]);
  
  // Removed handleHorizonCoverageChange - replaced with explicit handlers above

  // Calculate effective horizon in calendar days (weekend/holiday logic)
  const calculateEffectiveHorizon = useCallback((originDate: Date, horizonDays: number): number => {
    const targetDate = new Date(originDate);
    let tradingDaysAdded = 0;
    
    while (tradingDaysAdded < horizonDays) {
      targetDate.setDate(targetDate.getDate() + 1);
      const dayOfWeek = targetDate.getDay();
      
      // Skip weekends (Saturday = 6, Sunday = 0)
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        tradingDaysAdded++;
      }
    }
    
    // Calculate calendar days difference
    const timeDiff = targetDate.getTime() - originDate.getTime();
    const effectiveHorizon = Math.ceil(timeDiff / (1000 * 3600 * 24));
    
    console.log('[HorizonCalc]', {
      originDate: originDate.toISOString().split('T')[0],
      tradingHorizon: horizonDays,
      targetDate: targetDate.toISOString().split('T')[0],
      effectiveHorizon,
      isWeekendSpanning: effectiveHorizon > horizonDays
    });
    
    return effectiveHorizon;
  }, []);

  // Simplified auto-save for horizon/coverage changes (no auto-generation)
  useEffect(() => {
    if (!isValidH || !isValidCoverage || !resolvedTZ) return;
    
    const timeoutId = setTimeout(() => {
      // Only auto-save target spec, don't trigger forecast pipeline
      autoSaveTargetSpec();
      
      // Mark that settings have changed but don't auto-run pipeline
      console.log('[Settings] Horizon or Coverage changed:', { h, coverage });
    }, 500); // Debounce auto-save by 500ms

    return () => clearTimeout(timeoutId);
  }, [h, coverage, resolvedTZ, isValidH, isValidCoverage, autoSaveTargetSpec]);

  // Auto-trigger volatility forecast (for Inspector) when model/parameters change
  // This ONLY updates the base forecast for the Inspector, NOT conformal calibration
  useEffect(() => {
    // Guard: Only run if pipeline is ready (initialized, has target spec, etc.)
    if (!pipelineReady || !isInitialized) {
      console.log('[AutoForecast] Skipping - pipeline not ready');
      return;
    }
    
    // Debounce to avoid rapid-fire API calls during parameter changes
    const timeoutId = setTimeout(async () => {
      console.log('[AutoForecast] Triggering volatility forecast for Inspector:', {
        volModel,
        garchEstimator,
        rangeEstimator,
        h,
        coverage,
        volWindow,
        garchDf,
        rangeEwmaLambda
      });
      
      try {
        // Only generate the volatility forecast (step 1 of pipeline)
        // This updates the Inspector WITHOUT running conformal calibration
        const result = await generateVolatilityForecast();
        
        if (result.ok && result.forecast) {
          console.log('[AutoForecast] Volatility forecast generated successfully');
          // Set as active forecast for chart overlay and Inspector display
          setActiveForecast(result.forecast);
          setBaseForecast(result.forecast);
          // Mark conformal as stale since we have a new base forecast
          setConformalStale(true);
        } else {
          console.log('[AutoForecast] Volatility forecast failed:', result);
        }
      } catch (error) {
        console.error('[AutoForecast] Error generating volatility forecast:', error);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [
    // Trigger on model/parameter changes
    volModel,
    garchEstimator,
    rangeEstimator,
    h,
    coverage,
    volWindow,
    garchDf,
    rangeEwmaLambda,
    // Guard dependencies
    pipelineReady,
    isInitialized,
    generateVolatilityForecast
  ]);

  // Auto-generation effect removed - pipeline now runs only on explicit user actions
  
  // Save button guard (using resolved TZ instead of client spec)
  const canSave = isValidH && isValidCoverage && !!resolvedTZ;

  const handleFileUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    
    if (!selectedFile) {
      setError('Please select a file to upload');
      return;
    }
    
    setIsUploading(true);
    setError(null);
    setUploadWarning(null);
    setValidationSummary(null); // Clear previous validation summary
    // Don't clear parsedRows here - keep them for display while upload continues

    // Parse the file using our robust parser
    const parseFormData = new FormData();
    parseFormData.set('file', selectedFile);

    try {
      // Parse the file first using our robust parser
      const parseResponse = await fetch('/api/upload', {
        method: 'POST',
        body: parseFormData,
      });

      const parseData = await parseResponse.json();

      // Handle the standardized response format
      const parsed = Array.isArray(parseData.rows) ? parseData.rows : [];
      setParsedRows(parsed);
      
      if (!Array.isArray(parseData.rows) || parsed.length === 0) {
        setError(parseData.error ?? "No valid data rows found. Expected columns: Date, Open, High, Low, Close, Adj Close (or Adj. Close), Volume.");
        return;
      } else if (parsed.length < 252) {
        setUploadWarning("Uploads succeed, but GBM PI recommends ≥252 rows for stable results.");
      }

      // Now proceed with the enhanced upload if parsing succeeded
      const formData = new FormData();
      formData.set('file', selectedFile);
      formData.set('symbol', params.ticker); // Default to ticker from URL
      formData.set('mode', uploadMode); // Add upload mode

      // Use the enhanced upload API
      const response = await fetch('/api/upload/enhanced', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        // Handle error responses from enhanced API
        throw new Error(data.error || data.detail || 'Upload failed');
      }

      // Check if this is a validation summary response (success) or error response
      if (data.ok !== undefined || data.success !== false) {
        // This is a ValidationSummaryResponse (data.ok exists) or success response
        setValidationSummary(data);
        
        // Store the file hash for reprocessing
        setLastFileHash(data.file.hash);

        // Extract and store provenance data for the audit ribbon (M-5)
        setProvenanceData({
          vendor: data.provenance.vendor,
          mappingId: data.provenance.mappingId,
          fileHash: data.file.hash,
          rows: data.file.rows,
          dateRange: data.dateRange,
          processedAt: data.provenance.processedAt
        });
        
        // Also set upload result for backward compatibility with existing UI
        setUploadResult({
          symbol: params.ticker,
          paths: { raw: '', canonical: '', audit: '' },
          counts: { 
            input: data.file.rows, 
            canonical: data.file.rows, 
            invalid: data.validation.ohlcCoherence.failCount,
            missingDays: data.validation.missingDays.totalMissing 
          },
          meta: {
            symbol: params.ticker,
            exchange_tz: 'America/New_York',
            calendar_span: { start: data.dateRange.first, end: data.dateRange.last },
            rows: data.file.rows,
            missing_trading_days: [],
            invalid_rows: data.validation.ohlcCoherence.failCount,
            generated_at: data.provenance.processedAt
          },
          badges: {
            contractOK: true,
            calendarOK: !data.validation.missingDays.blocked,
            tzOK: true,
            corpActionsOK: true,
            validationsOK: data.validation.ohlcCoherence.failCount === 0,
            repairsCount: 0
          }
        });

        // Load preview data after successful upload (A-2)
        await loadPreviewData(data.file.hash);
      } else {
        // Fallback to old upload API if enhanced returns different format
        throw new Error('Unexpected response format');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsUploading(false);
    }
  };

  const handleReprocess = async () => {
    if (!lastFileHash) {
      setError('No file to reprocess. Please upload a file first.');
      return;
    }

    setIsReprocessing(true);
    setError(null);
    setValidationSummary(null); // Clear previous validation summary

    try {
      // Send reprocess request with hash and mode
      const response = await fetch('/api/upload/enhanced', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: uploadMode,
          reprocessHash: lastFileHash,
          symbol: params.ticker,
          mappingId: validationSummary?.provenance.mappingId
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Reprocess failed');
      }

      // Handle successful reprocess response
      if (data.ok !== undefined) {
        setValidationSummary(data);

        // Extract and store provenance data for the audit ribbon (M-5)
        setProvenanceData({
          vendor: data.provenance.vendor,
          mappingId: data.provenance.mappingId,
          fileHash: data.file.hash,
          rows: data.file.rows,
          dateRange: data.dateRange,
          processedAt: data.provenance.processedAt
        });
        
        // Update upload result for backward compatibility
        setUploadResult({
          symbol: params.ticker,
          paths: { raw: '', canonical: '', audit: '' },
          counts: { 
            input: data.file.rows, 
            canonical: data.file.rows, 
            invalid: data.validation.ohlcCoherence.failCount,
            missingDays: data.validation.missingDays.totalMissing 
          },
          meta: {
            symbol: params.ticker,
            exchange_tz: 'America/New_York',
            calendar_span: { start: data.dateRange.first, end: data.dateRange.last },
            rows: data.file.rows,
            missing_trading_days: [],
            invalid_rows: data.validation.ohlcCoherence.failCount,
            generated_at: data.provenance.processedAt
          },
          badges: {
            contractOK: true,
            calendarOK: !data.validation.missingDays.blocked,
            tzOK: true,
            corpActionsOK: true,
            validationsOK: data.validation.ohlcCoherence.failCount === 0,
            repairsCount: 0
          }
        });

        // Load preview data after successful reprocess (A-2)
        await loadPreviewData(data.file.hash);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsReprocessing(false);
    }
  };

  // Column Mapping Functions (A-1)
  const loadColumnMappings = async (vendor?: string) => {
    try {
      const url = vendor ? `/api/mappings?vendor=${vendor}` : '/api/mappings';
      const response = await fetch(url);
      if (response.ok) {
        const mappings = await response.json();
        setColumnMappings(mappings);
      }
    } catch (error) {
      console.error('Failed to load column mappings:', error);
    }
  };

  const detectVendorFromFilename = (filename: string): 'yahoo' | 'bloomberg' | 'refinitiv' | 'unknown' => {
    const lower = filename.toLowerCase();
    if (lower.includes('yahoo') || lower.includes('yf_')) return 'yahoo';
    if (lower.includes('bloomberg') || lower.includes('bbg_')) return 'bloomberg';
    if (lower.includes('refinitiv') || lower.includes('ref_')) return 'refinitiv';
    return 'unknown';
  };

  const openColumnMapping = async (file: File) => {
    setDetectedHeaders(['Date', 'Open', 'High', 'Low', 'Close', 'Adj Close', 'Volume']); // Mock headers for now
    const detectedVendor = detectVendorFromFilename(file.name);
    await loadColumnMappings(detectedVendor);
    
    // Auto-select first matching template
    const matching = columnMappings.find(m => m.vendor === detectedVendor);
    if (matching) {
      setSelectedMapping(matching.id);
    }
    
    setShowColumnMapping(true);
  };

  const saveColumnMapping = async (name: string, vendor: string, mapping: Record<string, string>) => {
    try {
      const response = await fetch('/api/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, vendor, map: mapping })
      });
      
      if (response.ok) {
        const saved = await response.json();
        setColumnMappings(prev => [saved, ...prev]);
        setSelectedMapping(saved.id);
        return saved.id;
      }
    } catch (error) {
      console.error('Failed to save mapping:', error);
    }
    return null;
  };

  // Preview Data Functions (A-2)
  const loadPreviewData = async (fileHash?: string) => {
    try {
      const url = fileHash 
        ? `/api/preview/${params.ticker}?hash=${fileHash}`
        : `/api/preview/${params.ticker}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setPreviewData(data);
      }
    } catch (error) {
      console.error('Failed to load preview data:', error);
    }
  };

  // Corporate Actions Functions (A-4)
  const handleCorporateActionsUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!corporateActionsFile) return;

    setIsUploadingCorporateActions(true);
    setCorporateActionsError(null);
    setCorporateActionsResult(null);

    try {
      const formData = new FormData();
      formData.append('file', corporateActionsFile);
      formData.append('symbol', params.ticker);
      formData.append('conflictResolution', 'manual');

      const response = await fetch('/api/corporate-actions', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      if (data.requiresResolution) {
        // Show conflict resolution modal
        setConflictData(data);
        setShowConflictResolution(true);
      } else {
        // Success
        setCorporateActionsResult(data);
        await loadExistingCorporateActions(); // Refresh the list
      }
    } catch (err) {
      setCorporateActionsError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsUploadingCorporateActions(false);
    }
  };

  const resolveConflicts = async (resolutionType: 'overwrite' | 'skip') => {
    if (!conflictData) return;

    setIsUploadingCorporateActions(true);
    try {
      const formData = new FormData();
      formData.append('file', corporateActionsFile!);
      formData.append('symbol', params.ticker);
      formData.append('conflictResolution', resolutionType);

      const response = await fetch('/api/corporate-actions', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Resolution failed');
      }

      setCorporateActionsResult(data);
      setShowConflictResolution(false);
      setConflictData(null);
      await loadExistingCorporateActions(); // Refresh the list
    } catch (err) {
      setCorporateActionsError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsUploadingCorporateActions(false);
    }
  };

  const loadExistingCorporateActions = async () => {
    try {
      const response = await fetch(`/api/corporate-actions?symbol=${params.ticker}`);
      if (response.ok) {
        const data = await response.json();
        setExistingCorporateActions(data.actions || []);
      }
    } catch (error) {
      console.error('Failed to load existing corporate actions:', error);
    }
  };

  // Delisting Awareness Functions (A-5)
  const loadDelistingStatus = async () => {
    try {
      const response = await fetch(`/api/delisting/status?symbol=${params.ticker}`);
      if (response.ok) {
        const data = await response.json();
        setDelistingInfo(data);
      }
    } catch (error) {
      console.error('Failed to load delisting status:', error);
    }
  };

  const applyDelistingOverride = async () => {
    if (!overrideReason.trim()) return;

    try {
      const response = await fetch('/api/delisting/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: params.ticker,
          overrideReason: overrideReason.trim(),
          overriddenBy: 'manual_user' // In real app, this would be current user
        })
      });

      if (response.ok) {
        const data = await response.json();
        setDelistingInfo(data.delistingInfo);
        setShowDelistingOverride(false);
        setOverrideReason('');
      }
    } catch (error) {
      console.error('Failed to apply delisting override:', error);
    }
  };

  // Export Functions (A-6)
  const exportCanonicalCSV = async () => {
    setIsExporting(true);
    setExportError(null);

    try {
      // First check if data is available
      const infoResponse = await fetch('/api/export/canonical', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: params.ticker })
      });

      if (!infoResponse.ok) {
        const errorData = await infoResponse.json();
        throw new Error(errorData.error || 'Failed to check export availability');
      }

      // If data is available, proceed with download
      const downloadUrl = `/api/export/canonical?symbol=${params.ticker}&format=csv`;
      
      // Create a temporary link element to trigger download
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  // Data Type Management Functions
  const addNewDataType = () => {
    if (newDataTypeName.trim() && !dataTypes.includes(newDataTypeName.trim())) {
      setDataTypes(prev => [...prev, newDataTypeName.trim()]);
      setSelectedDataType(newDataTypeName.trim());
      setNewDataTypeName('');
      setShowAddDataType(false);
    }
  };

  const handleDataTypeKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addNewDataType();
    } else if (e.key === 'Escape') {
      setShowAddDataType(false);
      setNewDataTypeName('');
    }
  };

  // Company Registry Functions
  const saveCompanyInfo = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingCompany(true);
    setCompanySaveSuccess(false);

    try {
      const exchangeInfo = getExchangeInfo(companyExchange);
      const formattedTicker = formatTicker(companyTicker, companyExchange);

      const companyData: CompanyInfo = {
        ticker: companyTicker,
        name: companyName,
        exchange: companyExchange,
        exchangeInfo: exchangeInfo ? {
          country: exchangeInfo.country,
          region: exchangeInfo.region,
          currency: exchangeInfo.currency,
          timezone: exchangeInfo.timezone,
          formattedTicker
        } : undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const response = await fetch('/api/companies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(companyData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save company');
      }

      setCompanySaveSuccess(true);
      setTimeout(() => setCompanySaveSuccess(false), 3000);

      // M-4: Check for exchange validation warnings after successful save
      try {
        const validationResponse = await fetch('/api/exchange/validate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ticker: companyTicker,
            exchange: companyExchange,
          }),
        });

        if (validationResponse.ok) {
          const validation = await validationResponse.json();
          if (!validation.isValid && validation.warnings.length > 0) {
            const primaryWarning = validation.warnings[0];
            setExchangeWarning({
              show: true,
              message: primaryWarning.message,
              details: primaryWarning.details,
              conflictType: primaryWarning.type,
            });
          }
        }
      } catch (validationError) {
        console.warn('Exchange validation check failed:', validationError);
        // Don't throw - this is a non-critical warning
      }
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSavingCompany(false);
    }
  };

  // Breakout Detection Functions
  const detectBreakoutToday = async () => {
    // Check validation gates first
    const canProceed = await checkGatesBeforeAction('breakout detection');
    if (!canProceed) return;

    setIsDetectingBreakout(true);
    setBreakoutError(null);

    try {
      const response = await fetch(`/api/events/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode: 'today' }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          setBreakoutError(data.error || 'Cooldown failed or open event exists');
        } else if (response.status === 422) {
          setBreakoutError(data.error || 'Cannot verify today yet');
        } else {
          throw new Error(data.error || 'Detection failed');
        }
        return;
      }

      setLatestEvent(data.created);
      if (data.created) {
        setCooldownStatus({ ok: true, inside_count: 3 });
      }
    } catch (err) {
      setBreakoutError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsDetectingBreakout(false);
    }
  };

  const detectBreakoutForDate = async () => {
    if (!breakoutDetectDate) return;

    // Check validation gates first
    const canProceed = await checkGatesBeforeAction('breakout detection for date');
    if (!canProceed) return;

    setIsDetectingBreakout(true);
    setBreakoutError(null);

    try {
      const response = await fetch(`/api/events/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          mode: 'date', 
          t_date: breakoutDetectDate 
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          setBreakoutError(data.error || 'Cooldown failed or open event exists');
        } else if (response.status === 422) {
          setBreakoutError(data.error || 'Missing data for specified date');
        } else {
          throw new Error(data.error || 'Detection failed');
        }
        return;
      }

      setLatestEvent(data.created);
      if (data.created) {
        setCooldownStatus({ ok: true, inside_count: 3 });
      }
    } catch (err) {
      setBreakoutError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsDetectingBreakout(false);
    }
  };

  // Continuation Clock Functions
  const tickToday = async () => {
    setIsTicking(true);
    setContinuationError(null);

    const today = new Date().toISOString().split('T')[0];

    try {
      const response = await fetch(`/api/continuation/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'tick',
          D_date: today,
          stop_rule: stopRule,
          k_inside: kInside,
          T_max: tMax
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 422) {
          setContinuationError(data.error || 'No open event or missing data');
        } else {
          throw new Error(data.error || 'Tick failed');
        }
        return;
      }

      setLatestEvent(data.updated);
      setLastContinuationAction(data.action);
    } catch (err) {
      setContinuationError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsTicking(false);
    }
  };

  const tickForDate = async () => {
    if (!tickDate) return;

    setIsTicking(true);
    setContinuationError(null);

    try {
      const response = await fetch(`/api/continuation/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'tick',
          D_date: tickDate,
          stop_rule: stopRule,
          k_inside: kInside,
          T_max: tMax
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 422) {
          setContinuationError(data.error || 'No open event or missing data');
        } else {
          throw new Error(data.error || 'Tick failed');
        }
        return;
      }

      setLatestEvent(data.updated);
      setLastContinuationAction(data.action);
    } catch (err) {
      setContinuationError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsTicking(false);
    }
  };

  const rescanFromB = async () => {
    if (!latestEvent) return;

    setIsTicking(true);
    setContinuationError(null);

    try {
      const response = await fetch(`/api/continuation/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'rescan',
          start: latestEvent.B_date,
          stop_rule: stopRule,
          k_inside: kInside,
          T_max: tMax
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 422) {
          setContinuationError(data.error || 'No open event or missing data');
        } else {
          throw new Error(data.error || 'Rescan failed');
        }
        return;
      }

      setLatestEvent(data.updated);
      setLastContinuationAction(data.action);
    } catch (err) {
      setContinuationError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsTicking(false);
    }
  };

  // Load latest event on mount
  useEffect(() => {
    const loadEvent = async () => {
      try {
        const response = await fetch(`/api/events/${params.ticker}?recent=1`);
        if (response.ok) {
          const data = await response.json();
          setLatestEvent(data.event);
        }
      } catch (error) {
        console.error('Failed to load latest event:', error);
      }
    };
    
    loadEvent();
  }, [params.ticker]);

  // Watchlist and Alerts Functions
  const runAlertsNow = async () => {
    setAlertsLoading(true);

    try {
      const response = await fetch('/api/alerts/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ symbols: [params.ticker] }),
      });

      if (response.ok) {
        const data = await response.json();
        setFiredAlerts(data.fired || []);
      }
    } catch (err) {
      console.error('Failed to run alerts:', err);
    } finally {
      setAlertsLoading(false);
    }
  };

  // Check alerts on mount
  useEffect(() => {
    const checkFiredAlerts = async () => {
      setAlertsLoading(true);

      try {
        const response = await fetch('/api/alerts/run');
        if (response.ok) {
          const data = await response.json();
          setFiredAlerts(data.pending || []);
        }
      } catch (err) {
        console.error('Failed to check fired alerts:', err);
      } finally {
        setAlertsLoading(false);
      }
    };

    const checkIfInWatchlist = async () => {
      try {
        // Check if ticker exists in any watchlist data
        const response = await fetch('/api/watchlist');
        if (response.ok) {
          const data = await response.json();
          const rows = data.rows || [];
          const isInList = rows.some((row: any) => row.symbol === params.ticker);
          setIsInWatchlist(isInList);
        } else {
          // If no watchlist data exists yet, check if we should persist from localStorage
          const savedWatchlistState = localStorage.getItem(`watchlist_${params.ticker}`);
          if (savedWatchlistState === 'true') {
            setIsInWatchlist(true);
          }
        }
      } catch (err) {
        console.error('Failed to check watchlist status:', err);
        // Fallback to localStorage if API fails
        const savedWatchlistState = localStorage.getItem(`watchlist_${params.ticker}`);
        if (savedWatchlistState === 'true') {
          setIsInWatchlist(true);
        }
      }
    };

    checkFiredAlerts();
    checkIfInWatchlist();
  }, [params.ticker]);

  // Function to add ticker to watchlist
  const addToWatchlist = async () => {
    setIsAddingToWatchlist(true);
    
    try {
      // Get today's date in YYYY-MM-DD format
      const today = new Date().toISOString().split('T')[0];
      
      const response = await fetch('/api/watchlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          symbols: [params.ticker],
          as_of: today
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to add to watchlist');
      }

      setIsInWatchlist(true);
      setWatchlistSuccess(true);
      
      // Save to localStorage for persistence
      localStorage.setItem(`watchlist_${params.ticker}`, 'true');
      
      // Clear success message after 3 seconds but keep button as "Added"
      setTimeout(() => setWatchlistSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to add to watchlist:', err);
    } finally {
      setIsAddingToWatchlist(false);
    }
  };

  // Function to sync canonical history from Yahoo Finance
  const handleYahooSync = async () => {
    if (!params?.ticker) return;
    const symbol = params.ticker.toUpperCase();
    setIsYahooSyncing(true);
    setYahooSyncError(null);

    try {
      const res = await fetch(`/api/history/sync/${encodeURIComponent(symbol)}`, {
        method: "GET",
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Sync failed: ${res.status} ${res.statusText} ${text}`);
      }

      // After a successful sync, clear the cached canonical rows so they get re-fetched
      setT212CanonicalRows(null);
      
      // Show success briefly (the new data will load when T212 sim is run next)
      console.log(`Yahoo sync complete for ${symbol}`);
    } catch (err: unknown) {
      console.error("Yahoo sync error", err);
      const message = err instanceof Error ? err.message : "Yahoo sync failed";
      setYahooSyncError(message);
    } finally {
      setIsYahooSyncing(false);
    }
  };

  // Load repairs when uploadResult is available
  useEffect(() => {
    const loadRepairsForSymbol = async () => {
      if (!uploadResult) return;
      
      setIsLoadingRepairs(true);
      
      try {
        const response = await fetch(`/api/repairs/${params.ticker}`);
        if (response.ok) {
          const repairs = await response.json();
          setRepairRecords(repairs);
        }
      } catch (err) {
        console.error('Failed to load repairs:', err);
      } finally {
        setIsLoadingRepairs(false);
      }
    };

    loadRepairsForSymbol();
  }, [uploadResult, params.ticker]);

  // Initialize exchange data on mount
  useEffect(() => {
    const initializeExchangeData = async () => {
      try {
        const exchanges = getAllExchanges();
        const regions = getExchangesByRegion();
        setAvailableExchanges(exchanges);
        setExchangesByRegion(regions);
      } catch (error) {
        console.error('Failed to load exchange data:', error);
      }
    };

    initializeExchangeData();
  }, []);

  // Load existing company info when ticker changes
  useEffect(() => {
    const loadCompanyInfo = async () => {
      try {
        const response = await fetch(`/api/companies?ticker=${params.ticker}`);
        if (response.ok) {
          const company: CompanyInfo = await response.json();
          setCompanyName(company.name);
          setCompanyExchange(company.exchange || 'NASDAQ');
        }
      } catch (error) {
        console.error('Failed to load company info:', error);
      }
    };

    if (params.ticker) {
      loadCompanyInfo();
    }
  }, [params.ticker]);

  // Load base forecast count for conformal prediction
  useEffect(() => {
    loadBaseForecastCount();
  }, [params.ticker, loadBaseForecastCount]);

  const tickerDisplay = companyTicker || params.ticker.toUpperCase();
  const logoLetter = tickerDisplay.slice(0, 1);
  const lastClose =
    headerPriceSeries && headerPriceSeries.length > 0
      ? headerPriceSeries[headerPriceSeries.length - 1].close
      : headerPrice.price;
  const prevClose =
    headerPriceSeries && headerPriceSeries.length > 1
      ? headerPriceSeries[headerPriceSeries.length - 2].close
      : null;
  const priceDisplay =
    lastClose != null
      ? lastClose.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—';
  const priceChangeAbs =
    lastClose != null && prevClose != null ? lastClose - prevClose : null;
  const priceChangePct =
    lastClose != null && prevClose != null && prevClose !== 0
      ? ((lastClose - prevClose) / prevClose) * 100
      : null;
  const changeColor =
    priceChangeAbs == null ? 'text-slate-400' : priceChangeAbs >= 0 ? 'text-emerald-400' : 'text-rose-400';
  const changeDisplay =
    priceChangeAbs != null ? `${priceChangeAbs >= 0 ? '+' : ''}${priceChangeAbs.toFixed(2)}` : '—';
  const changePctDisplay =
    priceChangePct != null ? `${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(2)}%` : null;

  const actionButtons = (
    <>
      {/* Upload Data Button */}
      <button
        onClick={() => setShowUploadModal(true)}
        className={`group relative flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200 ${
          isDarkMode
            ? 'text-slate-300 border border-slate-700/70 hover:text-white hover:border-slate-500'
            : 'text-slate-600 border border-slate-200 hover:text-slate-800'
        }`}
        title="Upload Data"
      >
        <svg className="w-5 h-5 transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
      </button>

      {/* Yahoo Finance Sync Button */}
      <div className="relative">
        <button
          onClick={handleYahooSync}
          disabled={isYahooSyncing}
          className={`group relative flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200 ${
            isDarkMode
              ? 'text-slate-300 border border-slate-700/70 hover:text-white hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed'
              : 'text-slate-600 border border-slate-200 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed'
          }`}
          title="Sync from Yahoo Finance"
        >
          {isYahooSyncing ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
            </svg>
          ) : (
            <svg className="w-5 h-5 transition-transform group-hover:scale-110 group-hover:rotate-180 duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
        </button>
        {yahooSyncError && (
          <div className={`absolute top-full right-0 mt-2 px-2 py-1 text-[10px] rounded-md whitespace-nowrap z-10 ${
            isDarkMode ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-red-50 text-red-600 border border-red-200'
          }`}>
            {yahooSyncError}
          </div>
        )}
      </div>

      {/* Data Quality / Help Button */}
      <button
        onClick={() => setShowDataQualityModal(true)}
        className={`group relative flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200 ${
          isDarkMode
            ? 'text-slate-300 border border-slate-700/70 hover:text-white hover:border-slate-500'
            : 'text-slate-600 border border-slate-200 hover:text-slate-800'
        }`}
        title="Data Quality Information"
      >
        <svg className="w-5 h-5 transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.75">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <circle cx="12" cy="17" r="0.5" fill="currentColor"/>
        </svg>
      </button>

      {/* Add to Watchlist Button */}
      <button
        onClick={addToWatchlist}
        disabled={isAddingToWatchlist || isInWatchlist}
        className={`group relative flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200 ${
          isInWatchlist
            ? isDarkMode
              ? 'text-emerald-400 border border-emerald-500/40 cursor-default'
              : 'text-emerald-600 border border-emerald-200 cursor-default'
            : isDarkMode
              ? 'text-slate-300 border border-slate-700/70 hover:text-white hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed'
              : 'text-slate-600 border border-slate-200 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed'
        }`}
        title={isInWatchlist ? 'Already in Watchlist' : 'Add to Watchlist'}
      >
        {isInWatchlist ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-5 h-5 transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.75">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        )}
      </button>
    </>
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 md:px-10 py-6 bg-background text-foreground">
      <div className="grid grid-cols-[auto_1fr_auto] gap-5 items-center mb-8">
        <div className="flex items-center">
          <div className="w-32 h-32 rounded-full bg-gradient-to-br from-orange-500 via-rose-500 to-amber-400 shadow-xl ring-1 ring-white/10 flex items-center justify-center text-3xl font-semibold text-white">
            {logoLetter}
          </div>
        </div>
        <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight text-white">
              {companyName || tickerDisplay}
            </h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-black/40 px-3 py-1 text-slate-200">
                <span className="font-medium">{tickerDisplay}</span>
                <span className="text-slate-500">·</span>
                <span>{companyExchange || 'NASDAQ'}</span>
              </div>
              <MarketSessionBadge symbol={params.ticker} />
            </div>
            <div className="flex flex-wrap items-baseline gap-3">
              <div className="flex items-baseline gap-2">
                <span className="text-5xl md:text-6xl font-semibold text-slate-100 tracking-tight">
                  {priceDisplay}
                </span>
                <span className="text-sm uppercase text-slate-400">USD</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className={`text-xl font-semibold ${changeColor}`}>
                  {changeDisplay}
                </span>
                {changePctDisplay && (
                  <span className={`text-xl font-semibold ${changeColor}`}>
                    {changePctDisplay}
                  </span>
                )}
              </div>
            </div>
            {headerPrice.date && (
              <p className="text-xs text-slate-500">
                At close at {headerPrice.date}
              </p>
            )}
            {watchlistSuccess && (
              <span className={`text-sm font-medium ${
                isDarkMode ? 'text-green-400' : 'text-green-600'
              }`}>
                ✓ Added to Watchlist
              </span>
            )}
        </div>
        <div className="flex items-center gap-2">
          {actionButtons}
        </div>
      </div>
      {/* Price Chart Section */}
      <div className="mb-8">
        {/* Debug: Log what we're passing to PriceChart */}
        {(() => {
          console.log("[Timing] PriceChart props", {
            h,
            volModel,
            coverage,
            hasActiveForecast: !!activeForecast,
            hasCurrentForecast: !!currentForecast,
            hasGbmForecast: !!gbmForecast,
            hasFallbackForecast: !!fallbackOverlayForecast,
            activeForecast,
            fallbackOverlayForecast,
            hasEwmaPath: !!ewmaPath,
            ewmaPathLength: ewmaPath?.length ?? 0,
          });
          return null;
        })()}
        <PriceChart 
          symbol={params.ticker} 
          className="w-full"
          horizon={h}
          forecastOverlay={forecastOverlayProps}
          ewmaPath={ewmaPath}
          ewmaSummary={ewmaSummary}
          ewmaBiasedPath={ewmaBiasedPath}
          ewmaBiasedSummary={ewmaBiasedSummary}
          ewmaShortSeries={trendShortEwma ?? undefined}
          ewmaLongSeries={trendLongEwma ?? undefined}
          ewmaShortWindow={trendShortWindow}
          ewmaLongWindow={trendLongWindow}
          momentumScoreSeries={chartMomentum?.scoreSeries ?? undefined}
          momentumPeriod={chartMomentum?.period ?? trendMomentumPeriod}
          adxPeriod={chartAdx?.period ?? 14}
          adxSeries={chartAdx?.series ?? undefined}
          onLoadEwmaUnbiased={handleLoadUnbiasedClick}
          onLoadEwmaBiased={handleLoadBiasedClick}
          isLoadingEwmaBiased={isLoadingEwmaBiased}
          ewmaReactionMapDropdown={{
            reactionLambda,
            setReactionLambda,
            reactionTrainFraction,
            setReactionTrainFraction,
            onMaximize: handleMaximizeReaction,
            onReset: () => {
              setReactionLambda(0.94);
              setReactionTrainFraction(0.7);
              setIsReactionMaximized(false);
            },
            isLoadingReaction,
            isOptimizingReaction,
            isMaximized: isReactionMaximized,
            hasOptimizationResults: !!reactionOptimizationBest,
          }}
          horizonCoverage={{
            h,
            coverage,
            onHorizonChange: handleHorizonChange,
            onCoverageChange: handleCoverageChange,
            isLoading: forecastStatus === "loading",
            volModel,
            onModelChange: handleModelChange,
            garchEstimator,
            onGarchEstimatorChange: handleGarchEstimatorChange,
            rangeEstimator,
            onRangeEstimatorChange: handleEstimatorChange,
            recommendedModel: recommendedModel ? parseMethodToUIState(recommendedModel) : null,
            windowSize: volModel === 'GBM' ? gbmWindow : volWindow,
            onWindowSizeChange: (n) => {
              if (volModel === 'GBM') {
                setGbmWindow(n);
              } else {
                setVolWindow(n);
              }
            },
            ewmaLambda: rangeEwmaLambda,
            onEwmaLambdaChange: setRangeEwmaLambda,
            degreesOfFreedom: garchDf,
            onDegreesOfFreedomChange: setGarchDf,
            gbmLambda,
            onGbmLambdaChange: setGbmLambda,
          }}
          tradeOverlays={t212TradeOverlays}
          t212AccountHistory={t212AccountHistory}
          activeT212RunId={t212VisibleRunIds.size > 0 ? Array.from(t212VisibleRunIds)[0] : null}
          onToggleT212Run={toggleT212RunVisibility}
          isCfdEnabled={isCfdEnabled}
          onToggleCfd={() => setIsCfdEnabled(prev => !prev)}
          onDateRangeChange={handleDateRangeChange}
          simulationRuns={simulationRunsSummary}
        />
      </div>
      
      {/* GBM Forecast Inspector */}
      <div className="mb-8">
        <GbmForecastInspector
          symbol={tickerParam}
          volModel={volModel}
          horizon={h}
          coverage={coverage}
          activeForecast={activeForecast}
          baseForecast={baseForecast}
          conformalState={conformalState}
          forecastStatus={forecastStatus}
          forecastError={forecastError}
        />
      </div>

      {/* GARCH Forecast Inspector */}
      <div className="mb-8">
        <GarchForecastInspector
          symbol={tickerParam}
          volModel={volModel}
          garchEstimator={garchEstimator}
          horizon={h}
          coverage={coverage}
          activeForecast={activeForecast}
          baseForecast={baseForecast}
          conformalState={conformalState}
          forecastStatus={forecastStatus}
          forecastError={volatilityError}
        />
      </div>

      {/* Range Forecast Inspector */}
      <div className="mb-8">
        <RangeForecastInspector
          symbol={tickerParam}
          volModel={volModel}
          horizon={h}
          coverage={coverage}
          activeForecast={activeForecast}
          baseForecast={baseForecast}
          conformalState={conformalState}
          forecastStatus={forecastStatus}
          volatilityError={volatilityError}
        />
      </div>


      {/* EWMA Reaction Map Card */}
      <div className="mb-8">
        {/* Header */}
        <div className="mb-4">
          <h3 className={`text-lg font-semibold ${
            isDarkMode ? 'text-white' : 'text-gray-900'
          }`}>EWMA Reaction Map</h3>

          {/* Summary info row */}
          {reactionMapSummary && (
            <div className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Train: {reactionMapSummary.trainStart} → {reactionMapSummary.trainEnd} ({reactionMapSummary.nTrain} obs) · 
              Test: {reactionMapSummary.testStart} → {reactionMapSummary.testEnd} ({reactionMapSummary.nTest} obs) ·
              H(d): {h} · Cov%: {Math.round(coverage * 1000) / 10}%
            </div>
          )}
        </div>

        {/* Error Display */}
        {reactionError && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
            {reactionError}
          </div>
        )}

        {/* Two-column layout */}
        {reactionMapSummary && reactionMapSummary.buckets.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            
            {/* Left Column: Bucket Statistics */}
            <div className={`rounded-xl p-4 ${
              isDarkMode 
                ? 'bg-slate-900/60 border border-slate-700/50' 
                : 'bg-gray-50 border border-gray-200'
            }`}>
              <h4 className={`text-sm font-medium mb-3 ${
                isDarkMode ? 'text-slate-300' : 'text-gray-700'
              }`}>Bucket Statistics</h4>

              <div className="overflow-x-auto">
                <table className={`w-full text-[11px] ${isDarkMode ? 'text-slate-300' : 'text-gray-700'}`}>
                  <thead className={`${isDarkMode ? 'text-slate-500' : 'text-gray-500'}`}>
                    <tr className={`border-b ${isDarkMode ? 'border-slate-700/70' : 'border-gray-200'}`}>
                      <th className="py-1.5 pr-2 text-left font-medium">Bucket</th>
                      <th className="py-1.5 px-2 text-right font-medium">h</th>
                      <th className="py-1.5 px-2 text-right font-medium">n</th>
                      <th className="py-1.5 px-2 text-right font-medium">P(Up)</th>
                      <th className="py-1.5 px-2 text-right font-medium">Mean %</th>
                      <th className="py-1.5 pl-2 text-right font-medium">Std %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reactionMapSummary.buckets.map((b) => (
                      <tr 
                        key={`${b.bucketId}-${b.horizon}`}
                        className="transition-colors rounded-lg hover:bg-sky-500/20 cursor-pointer"
                      >
                        <td className="py-2 pl-2 pr-2 font-mono rounded-l-lg">{b.bucketId}</td>
                        <td className="py-2 px-2 text-right">{b.horizon}</td>
                        <td className="py-2 px-2 text-right">{b.nObs}</td>
                        <td className={`py-2 px-2 text-right font-medium ${
                          b.pUp > 0.55 
                            ? 'text-emerald-500' 
                            : b.pUp < 0.45 
                              ? 'text-rose-500' 
                              : isDarkMode ? 'text-slate-400' : 'text-gray-500'
                        }`}>
                          {(b.pUp * 100).toFixed(1)}%
                        </td>
                        <td className={`py-2 px-2 text-right font-mono ${
                          b.meanReturn > 0 
                            ? 'text-emerald-500' 
                            : b.meanReturn < 0 
                              ? 'text-rose-500' 
                              : isDarkMode ? 'text-slate-400' : 'text-gray-500'
                        }`}>
                          {(b.meanReturn * 100).toFixed(2)}
                        </td>
                        <td className="py-2 pl-2 pr-2 text-right font-mono rounded-r-lg">
                          {(b.stdReturn * 100).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right Column: Optimization Results */}
            <div className={`rounded-xl p-4 ${
              isDarkMode 
                ? 'bg-slate-900/60 border border-slate-700/50' 
                : 'bg-gray-50 border border-gray-200'
            }`}>
              <div className="flex items-center justify-between mb-3">
                <h4 className={`text-sm font-medium ${
                  isDarkMode ? 'text-slate-300' : 'text-gray-700'
                }`}>Optimization Candidates</h4>
                {reactionOptimizationBest && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium">
                    Best: {(reactionOptimizationBest.directionHitRate * 100).toFixed(1)}%
                  </span>
                )}
              </div>

              {reactionOptimizationCandidates.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className={`w-full text-[11px] ${isDarkMode ? 'text-slate-300' : 'text-gray-700'}`}>
                    <thead className={`${isDarkMode ? 'text-slate-500' : 'text-gray-500'}`}>
                      <tr className={`border-b ${isDarkMode ? 'border-slate-700/70' : 'border-gray-200'}`}>
                        <th className="py-1.5 pr-2 text-left font-medium">Rank</th>
                        <th className="py-1.5 px-2 text-right font-medium">λ</th>
                        <th className="py-1.5 px-2 text-right font-medium">Train%</th>
                        <th className="py-1.5 px-2 text-right font-medium">Hit%</th>
                        <th className="py-1.5 px-2 text-right font-medium">Cov%</th>
                        <th className="py-1.5 pl-2 text-right font-medium">Int. score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Neutral baseline row */}
                      {reactionOptimizationNeutral && (
                        <tr
                          className="cursor-pointer transition-colors rounded-lg hover:bg-sky-500/20"
                          onClick={handleApplyOptimizationNeutral}
                        >
                          <td className={`py-2 pl-2 pr-2 rounded-l-lg ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>Neutral</td>
                          <td className="py-2 px-2 text-right font-mono">
                            {reactionOptimizationNeutral.lambda.toFixed(2)}
                          </td>
                          <td className={`py-2 px-2 text-right ${isDarkMode ? 'text-slate-600' : 'text-gray-400'}`}>
                            —
                          </td>
                          <td className="py-2 px-2 text-right font-mono">
                            {(reactionOptimizationNeutral.directionHitRate * 100).toFixed(1)}%
                          </td>
                          <td className="py-2 px-2 text-right font-mono">
                            {(reactionOptimizationNeutral.coverage * 100).toFixed(1)}%
                          </td>
                          <td className="py-2 pl-2 pr-2 text-right font-mono rounded-r-lg">
                            {reactionOptimizationNeutral.intervalScore.toFixed(3)}
                          </td>
                        </tr>
                      )}
                      {/* Ranked candidates */}
                      {reactionOptimizationCandidates.slice(0, 4).map((c, idx) => {
                        const isBest =
                          reactionOptimizationBest &&
                          c.lambda === reactionOptimizationBest.lambda &&
                          c.trainFraction === reactionOptimizationBest.trainFraction;

                        // Delta vs neutral
                        const hitDelta = (c.directionHitRate - c.neutralDirectionHitRate) * 100;
                        const isDeltaPositive = hitDelta > 0;
                        const intScoreDelta = c.intervalScore - c.neutralIntervalScore;
                        const isIntDeltaBetter = intScoreDelta < 0; // lower is better

                        return (
                          <tr
                            key={`${c.lambda}-${c.trainFraction}`}
                            className={`cursor-pointer transition-colors rounded-lg hover:bg-sky-500/20 ${isBest ? 'text-amber-400 bg-amber-500/20' : ''}`}
                            onClick={() => handleApplyOptimizationCandidate(c)}
                          >
                            <td className="py-2 pl-2 pr-2 rounded-l-lg">{idx + 1}</td>
                            <td className="py-2 px-2 text-right font-mono">
                              {c.lambda.toFixed(2)}
                            </td>
                            <td className="py-2 px-2 text-right font-mono">
                              {(c.trainFraction * 100).toFixed(0)}%
                            </td>
                            <td className="py-2 px-2 text-right font-mono">
                              {(c.directionHitRate * 100).toFixed(1)}%
                              <span
                                className={`ml-1 text-[9px] ${isDeltaPositive ? 'text-emerald-400' : 'text-rose-400'}`}
                                title="vs neutral"
                              >
                                {isDeltaPositive ? '+' : ''}{hitDelta.toFixed(1)}
                              </span>
                            </td>
                            <td className="py-2 px-2 text-right font-mono">
                              {(c.coverage * 100).toFixed(1)}%
                            </td>
                            <td className="py-2 pl-2 pr-2 text-right font-mono rounded-r-lg">
                              {c.intervalScore.toFixed(3)}
                              <span
                                className={`ml-1 text-[9px] ${isIntDeltaBetter ? 'text-emerald-400' : 'text-rose-400'}`}
                                title="vs neutral"
                              >
                                {intScoreDelta >= 0 ? '+' : ''}{intScoreDelta.toFixed(3)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={`text-center py-6 text-xs ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
                  Click &quot;Maximize&quot; to find optimal λ / Train% combinations
                </div>
              )}

              {/* Optimization error */}
              {reactionOptimizeError && (
                <div className="mt-2 text-[11px] text-red-400">
                  {reactionOptimizeError}
                </div>
              )}
            </div>
          </div>
        ) : !isLoadingReaction && !reactionError && (
          <div className={`text-center py-12 rounded-xl ${
            isDarkMode 
              ? 'bg-slate-900/40 text-slate-500' 
              : 'bg-gray-50 text-gray-400'
          }`}>
            Click &quot;Run&quot; to compute the EWMA Reaction Map
          </div>
        )}
      </div>

      {/* Trend Analysis Section */}
      <TrendSection
        ticker={params.ticker}
        ewmaPath={ewmaPath}
        ewmaSummary={ewmaSummary}
        horizon={h}
        coverage={coverage}
        shortWindowOverride={trendShortWindow}
        longWindowOverride={trendLongWindow}
        onEwmaWindowChange={(short, long) => {
          setTrendShortWindow(short);
          setTrendLongWindow(long);
        }}
        momentumPeriodOverride={trendMomentumPeriod}
        onMomentumPeriodChange={setTrendMomentumPeriod}
      />

      {/* Unified Forecast Bands Card - Full Width */}
      <div className="mb-8">
        <div className={`p-6 border rounded-lg shadow-sm ${
          isDarkMode 
            ? 'bg-gray-800 border-gray-600' 
            : 'bg-white border-gray-200'
        }`} data-testid="card-forecast-bands">
          <h3 className={`text-xl font-semibold mb-4 ${
            isDarkMode ? 'text-white' : 'text-gray-900'
          }`}>Forecast Bands</h3>
          
            {/* Conformal Section */}
            <div className="mb-6">
              <h4 className={`text-xl font-semibold mb-3 ${
                isDarkMode ? 'text-gray-200' : 'text-gray-800'
              }`}>Conformal Calibration</h4>
              
              <div className="grid grid-cols-4 gap-4 mb-4">
                <div>
                  <label className={`block text-sm font-medium mb-2 ${
                    isDarkMode ? 'text-gray-200' : 'text-gray-700'
                  }`}>Mode:</label>
                  <select 
                    value={conformalMode} 
                    onChange={(e) => setConformalMode(e.target.value as any)}
                    className={`w-full p-2 border rounded-full ${
                      isDarkMode 
                        ? 'bg-gray-700 border-gray-600 text-white' 
                        : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  >
                    <option value="ICP">ICP</option>
                    <option value="ICP-SCALED">ICP-scaled</option>
                    <option value="CQR">CQR</option>
                    <option value="EnbPI">EnbPI</option>
                    <option value="ACI">ACI</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-2 ${
                    isDarkMode ? 'text-gray-200' : 'text-gray-700'
                  }`}>Domain:</label>
                  <select 
                    value={conformalDomain} 
                    onChange={(e) => setConformalDomain(e.target.value as 'log' | 'price')}
                    className={`w-full p-2 border rounded-full ${
                      isDarkMode 
                        ? 'bg-gray-700 border-gray-600 text-white' 
                        : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  >
                    <option value="log">Log scale</option>
                    <option value="price">Price scale</option>
                  </select>
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-2 ${
                    isDarkMode ? 'text-gray-200' : 'text-gray-700'
                  }`}>Calibration window:</label>
                  <input
                    type="number"
                    min="1"
                    max="2000"
                    value={conformalCalWindow}
                    onChange={(e) => setConformalCalWindow(Number(e.target.value))}
                    className={`w-full px-3 py-2 text-sm rounded-full border transition-colors focus:outline-none focus:ring-2 ${
                      isDarkMode 
                        ? 'bg-gray-700 text-gray-200 border-gray-600 focus:border-blue-500 focus:ring-blue-500/20' 
                        : 'bg-white text-gray-900 border-gray-300 focus:border-blue-500 focus:ring-blue-500/20'
                    }`}
                    placeholder="Enter days..."
                  />
                </div>
                
                {/* Generate base forecasts input and button as fourth column */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${
                    isDarkMode ? 'text-gray-200' : 'text-gray-700'
                  }`}>Base Forecasts</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      value={baseForecastsToGenerate}
                      onChange={(e) => setBaseForecastsToGenerate(Number(e.target.value))}
                      disabled={isGeneratingBase}
                      className={`flex-1 px-3 py-2 text-sm rounded-full border transition-colors focus:outline-none focus:ring-2 ${
                        isGeneratingBase
                          ? 'bg-gray-100 text-gray-400 border-gray-300 cursor-not-allowed'
                          : isDarkMode 
                            ? 'bg-gray-700 text-gray-200 border-gray-600 focus:border-blue-500 focus:ring-blue-500/20' 
                            : 'bg-white text-gray-900 border-gray-300 focus:border-blue-500 focus:ring-blue-500/20'
                      }`}
                    />
                    <button
                      onClick={handleGenerateBaseForecastsForCurrentConfig}
                      disabled={isGeneratingBase || baseForecastsToGenerate <= 0}
                      className={`px-4 py-2 text-sm font-medium rounded-full border transition-colors focus:outline-none focus:ring-2 whitespace-nowrap ${
                        isGeneratingBase || baseForecastsToGenerate <= 0
                          ? 'bg-gray-100 text-gray-400 border-gray-300 cursor-not-allowed'
                          : isDarkMode 
                            ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600 focus:ring-blue-500/20' 
                            : 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600 focus:ring-blue-500/20'
                      }`}
                    >
                      {isGeneratingBase ? 'Generating...' : 'Generate'}
                    </button>
                  </div>
                </div>
              </div>
              
              {/* Base forecast status below the grid */}
              {baseForecastCount !== null && (
                <div className="mb-4 flex items-center justify-between">
                  <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {baseForecastCount >= conformalCalWindow 
                      ? `✓ ${baseForecastCount} base forecasts available for h=${h}`
                      : baseForecastCount > 0 
                        ? `${baseForecastCount} of ${conformalCalWindow} needed for h=${h}`
                        : `No base forecasts for current configuration (h=${h})`
                    }
                  </p>
                  <div className="flex items-center gap-2">
                    {baseForecastsStale && (
                      <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full">
                        Stale
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Mode-specific parameters */}
              {conformalMode === 'ACI' && (
                <div className="mb-4">
                  <label className={`block text-sm font-medium mb-2 ${
                    isDarkMode ? 'text-gray-200' : 'text-gray-700'
                  }`}>Learning rate η:</label>
                  <input 
                    type="number" 
                    value={conformalEta} 
                    onChange={(e) => setConformalEta(Number(e.target.value))}
                    className={`w-full p-2 border rounded-md ${
                      isDarkMode 
                        ? 'bg-gray-700 border-gray-600 text-white' 
                        : 'bg-white border-gray-300 text-gray-900'
                    }`}
                    min="0.001"
                    step="0.001"
                  />
                  <p className={`text-xs mt-1 ${
                    isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Adaptive adjustment rate</p>
                </div>
              )}

              {conformalMode === 'EnbPI' && (
                <div className="mb-4">
                  <label className={`block text-sm font-medium mb-2 ${
                    isDarkMode ? 'text-gray-200' : 'text-gray-700'
                  }`}>Ensemble size K:</label>
                  <input 
                    type="number" 
                    value={conformalK} 
                    onChange={(e) => setConformalK(Number(e.target.value))}
                    className={`w-full p-2 border rounded-md ${
                      isDarkMode 
                        ? 'bg-gray-700 border-gray-600 text-white' 
                        : 'bg-white border-gray-300 text-gray-900'
                    }`}
                    min="5"
                    step="1"
                  />
                  <p className={`text-xs mt-1 ${
                    isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>Minimum 5, default 20</p>
                </div>
              )}

              {/* Coverage Statistics - Enhanced Section */}
              {conformalState && conformalState.coverage && (
                <div className="mb-4 pt-4 border-t border-gray-200">
                  <h5 className="text-sm font-semibold text-gray-800 mb-3">Coverage Statistics</h5>
                  
                  {/* Coverage Metrics Grid - 5 Columns including Date Range */}
                  <div className="grid grid-cols-5 gap-4 mb-4">
                    <div className="bg-blue-50 p-3 rounded-full text-center">
                      <div className="text-lg font-mono font-bold text-blue-900">
                        {((conformalState.coverage.last60 || 0) * 100).toFixed(1)}%
                      </div>
                      <div className="text-xs text-gray-600">Last 60d</div>
                    </div>
                    <div className="bg-blue-50 p-3 rounded-full text-center">
                      <div className="text-lg font-mono font-bold text-blue-900">
                        {((conformalState.coverage.lastCal || 0) * 100).toFixed(1)}%
                      </div>
                      <div className="text-xs text-gray-600">Cal Window</div>
                    </div>
                    <div className="bg-blue-50 p-3 rounded-full text-center">
                      <div className="text-lg font-mono font-bold text-blue-900">
                        {conformalState.coverage.miss_count || 0}
                      </div>
                      <div className="text-xs text-gray-600">Misses</div>
                    </div>
                    {/* Calibrated Parameters as 4th column */}
                    {conformalState.params && conformalState.params.q_cal !== null ? (
                      <div className="bg-blue-50 p-3 rounded-full text-center">
                        <div className="text-lg font-mono font-bold text-blue-900">
                          {conformalState.params.q_cal?.toFixed(6) || 'N/A'}
                        </div>
                        <div className="text-xs text-gray-600">Calibrated Parameters</div>
                      </div>
                    ) : (
                      <div className="bg-gray-50 p-3 rounded-full text-center">
                        <div className="text-lg font-mono font-bold text-gray-500">—</div>
                        <div className="text-xs text-gray-400">No calibration</div>
                      </div>
                    )}
                    {/* Date Range as 5th column */}
                    <div className="bg-blue-50 p-3 rounded-full text-center">
                      <div className="text-lg font-mono font-bold text-blue-900 leading-tight">
                        {(() => {
                          // Use a fixed last available date (2025-10-10) for now
                          // TODO: In production, this should be dynamically loaded from canonical data
                          const lastAvailableDate = new Date('2025-10-10');
                          const startDate = new Date(lastAvailableDate);
                          startDate.setDate(lastAvailableDate.getDate() - conformalCalWindow);
                          
                          // Format as DD/MM/YY
                          const formatDate = (date: Date) => {
                            const day = String(date.getDate()).padStart(2, '0');
                            const month = String(date.getMonth() + 1).padStart(2, '0');
                            const year = String(date.getFullYear()).slice(-2);
                            return `${day}/${month}/${year}`;
                          };
                          
                          return `${formatDate(startDate)} → ${formatDate(lastAvailableDate)}`;
                        })()}
                      </div>
                      <div className="text-xs text-gray-600">Data Range</div>
                    </div>
                  </div>

                  {/* Hide/Show Details Toggle */}
                  <div className="text-right mb-3">
                    <button
                      onClick={() => setShowCoverageDetails(!showCoverageDetails)}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      {showCoverageDetails ? 'Hide Details' : 'Show Details'}
                    </button>
                  </div>

                  {/* Miss Details Table */}
                  {showCoverageDetails && conformalState.coverage.miss_details && conformalState.coverage.miss_details.length > 0 && (
                    <div className="mb-4">
                      <h6 className={`text-sm font-medium mb-4 ${
                        isDarkMode ? 'text-gray-200' : 'text-gray-700'
                      }`}>
                        Miss Details ({conformalState.coverage.miss_count} misses)
                      </h6>
                      
                      <div className="overflow-x-auto">
                        <table className={`table-auto w-full text-xs border-2 border-gray-300 rounded-xl overflow-hidden ${
                          isDarkMode 
                            ? 'bg-gray-800' 
                            : 'bg-white'
                        }`}>
                          {/* Single header row */}
                          <thead>
                            {/* Group headers */}
                            <tr className={`text-[10px] uppercase tracking-[0.1em] border-b ${
                              isDarkMode 
                                ? 'text-gray-500 border-gray-600 bg-gray-800/60' 
                                : 'text-gray-400 border-border/40 bg-muted/20'
                            }`}>
                              <th className={`px-2 py-1 text-center font-semibold ${
                                isDarkMode 
                                  ? 'bg-sky-900/40 text-sky-200' 
                                  : 'bg-sky-100 text-sky-800'
                              }`} colSpan={4}>Forecast</th>
                              <th className={`px-2 py-1 text-center font-semibold ${
                                isDarkMode 
                                  ? 'text-black' 
                                  : 'text-black'
                              }`} colSpan={2}>Realized</th>
                              <th className={`px-2 py-1 text-center font-semibold ${
                                isDarkMode 
                                  ? 'bg-sky-900/40 text-sky-200' 
                                  : 'bg-sky-100 text-sky-800'
                              }`} colSpan={3}>Analysis</th>
                            </tr>
                            
                            {/* Column headers */}
                            <tr className={`text-[11px] uppercase tracking-[0.08em] border-b ${
                              isDarkMode 
                                ? 'text-gray-400 border-gray-600 bg-gray-700/40' 
                                : 'text-muted-foreground border-border/60 bg-muted/40'
                            }`}>
                              <th className="px-2 py-1.5 text-left whitespace-nowrap">Year</th>
                              <th className="px-2 py-1.5 text-left whitespace-nowrap">Month</th>
                              <th className="px-2 py-1.5 text-left whitespace-nowrap">Day</th>
                              <th className="px-2 py-1.5 text-left whitespace-nowrap">Horizon</th>
                              <th className="px-2 py-1.5 text-left whitespace-nowrap">R.Month</th>
                              <th className="px-2 py-1.5 text-left whitespace-nowrap">R.Day</th>
                              <th className="px-2 py-1.5 text-left w-[220px]">Band</th>
                              <th className="px-2 py-1.5 text-center">Direction</th>
                              <th className="px-2 py-1.5 text-right">Magnitude</th>
                            </tr>
                          </thead>
                          
                          <tbody className={`${
                            isDarkMode ? 'divide-gray-600' : 'divide-border/40'
                          } divide-y`}>
                            {conformalState.coverage.miss_details.map((miss: any, idx: number) => {
                              const predictionDate = miss.date;
                              const realizedDate = miss.realized_date ?? miss.date;
                              const horizonValue = typeof miss.horizon === "number" ? miss.horizon : h ?? 1;
                              const horizonLabel = `${horizonValue}D`;
                              const directionUp = miss.miss_type === "above";

                              // Parse prediction date into Year, Month, Day
                              const predDateParts = predictionDate.split('-');
                              const predYear = predDateParts[0];
                              const predMonthNum = parseInt(predDateParts[1]);
                              const predDay = predDateParts[2];
                              
                              // Parse realized date into Month, Day
                              const realizedDateParts = realizedDate.split('-');
                              const realizedMonthNum = parseInt(realizedDateParts[1]);
                              const realizedDay = realizedDateParts[2];
                              
                              // Month abbreviations
                              const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                                                 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                              const predMonth = monthNames[predMonthNum - 1] || '';
                              const realizedMonth = monthNames[realizedMonthNum - 1] || '';

                              const L = miss.L_base;
                              const U = miss.U_base;
                              const C = miss.y_pred;
                              const R = miss.realized;

                              let realizedOffsetPercent = 50; // default in the middle
                              const OUTSIDE_OFFSET_PCT = 8;   // how far outside the band to place misses

                              if (typeof L === "number" && typeof U === "number" && typeof R === "number" && U !== L) {
                                const t = (R - L) / (U - L); // normalized position relative to band

                                if (t >= 0 && t <= 1) {
                                  // inside band → map to [0,100]%
                                  realizedOffsetPercent = t * 100;
                                } else if (t < 0) {
                                  // below band → place just left of Low
                                  realizedOffsetPercent = -OUTSIDE_OFFSET_PCT;
                                } else {
                                  // above band → place just right of Up
                                  realizedOffsetPercent = 100 + OUTSIDE_OFFSET_PCT;
                                }
                              }

                              return (
                                <tr
                                  key={`${miss.date}-${idx}`}
                                  className={`border-t transition-colors ${
                                    isDarkMode 
                                      ? 'border-gray-600/40 hover:bg-gray-700/40' 
                                      : 'border-border/40 hover:bg-muted/40'
                                  }`}
                                >
                                  {/* Year */}
                                  <td className={`px-2 py-1.5 text-left whitespace-nowrap ${
                                    isDarkMode ? 'text-gray-300' : 'text-foreground'
                                  }`}>
                                    {predYear}
                                  </td>

                                  {/* Month */}
                                  <td className={`px-2 py-1.5 text-left whitespace-nowrap ${
                                    isDarkMode ? 'text-gray-300' : 'text-foreground'
                                  }`}>
                                    {predMonth}
                                  </td>

                                  {/* Day */}
                                  <td className={`px-2 py-1.5 text-left whitespace-nowrap ${
                                    isDarkMode ? 'text-gray-300' : 'text-foreground'
                                  }`}>
                                    {predDay}
                                  </td>

                                  {/* Horizon badge */}
                                  <td className="px-2 py-1.5 whitespace-nowrap">
                                    <div className="flex justify-start">
                                      <span className={`inline-flex items-center rounded-full border px-2 py-[2px] text-[10px] font-medium ${
                                        isDarkMode 
                                          ? 'border-gray-600/60 bg-gray-800 text-gray-300/80' 
                                          : 'border-border/60 bg-background text-foreground/80'
                                      }`}>
                                        {horizonLabel.toLowerCase()}
                                      </span>
                                    </div>
                                  </td>

                                  {/* Realized Month */}
                                  <td className={`px-2 py-1.5 text-left whitespace-nowrap ${
                                    isDarkMode ? 'text-gray-300' : 'text-foreground'
                                  }`}>
                                    {realizedMonth}
                                  </td>

                                  {/* Realized Day */}
                                  <td className={`px-2 py-1.5 text-left whitespace-nowrap ${
                                    isDarkMode ? 'text-gray-300' : 'text-foreground'
                                  }`}>
                                    {realizedDay}
                                  </td>

                                  {/* BAND: simplified text layout with Up/Center/Low + positioned Realized */}
                                  <td className="px-2 py-1.5">
                                    <div className="w-[220px] flex flex-col items-start gap-1 text-[10px] font-mono tabular-nums">
                                      {/* Show Realized above Up if it's a miss above - GREEN */}
                                      {typeof R === "number" && typeof U === "number" && R > U && (
                                        <div className="text-green-600 font-bold">
                                          Realized: {R.toFixed(4)}
                                        </div>
                                      )}
                                      
                                      {/* Up */}
                                      <div className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
                                        Up: {U?.toFixed(4)}
                                      </div>
                                      
                                      {/* Center */}
                                      <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                                        Center: {C?.toFixed(4)}
                                      </div>
                                      
                                      {/* Show Realized in middle if it's within bounds */}
                                      {typeof R === "number" && typeof L === "number" && typeof U === "number" && R >= L && R <= U && (
                                        <div className="text-blue-600 font-bold">
                                          Realized: {R.toFixed(4)}
                                        </div>
                                      )}
                                      
                                      {/* Low */}
                                      <div className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
                                        Low: {L?.toFixed(4)}
                                      </div>
                                      
                                      {/* Show Realized below Low if it's a miss below - RED */}
                                      {typeof R === "number" && typeof L === "number" && R < L && (
                                        <div className="text-red-500 font-bold">
                                          Realized: {R.toFixed(4)}
                                        </div>
                                      )}
                                    </div>
                                  </td>

                                  {/* Direction */}
                                  <td className="px-2 py-1.5 text-center">
                                    <span
                                      className={
                                        "inline-flex items-center justify-center rounded-full px-1.5 py-[1px] text-[12px] font-medium " +
                                        (directionUp
                                          ? "bg-green-100 text-green-600"
                                          : "bg-red-100 text-red-600")
                                      }
                                      title={
                                        directionUp
                                          ? "Realized above upper band"
                                          : "Realized below lower band"
                                      }
                                    >
                                      {directionUp ? "↑" : "↓"}
                                    </span>
                                  </td>

                                  {/* Magnitude */}
                                  <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${
                                    isDarkMode ? 'text-gray-300' : 'text-foreground'
                                  }`}>
                                    {miss.miss_magnitude?.toFixed(4)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* No misses message */}
                  {showCoverageDetails && conformalState.coverage.miss_count === 0 && (
                    <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-center text-sm text-green-700">
                      ✓ No coverage misses detected - perfect calibration performance!
                    </div>
                  )}
                </div>
              )}

              {/* Error Display */}
              {/* Error Display */}
              {conformalError && (
                <div className={`mb-4 p-3 rounded-md border ${
                  isDarkMode 
                    ? 'bg-red-900/20 border-red-700 text-red-300' 
                    : 'bg-red-100 border border-red-300 text-red-700'
                }`}>
                  <p className="font-medium">Error:</p>
                  <p className="text-sm">{conformalError}</p>
                </div>
              )}
            </div>

            {/* Generate Button */}
            <div className="mt-6 flex items-center justify-end gap-4">
              {forecastError && (
                <p className={`text-sm ${
                  isDarkMode ? 'text-red-400' : 'text-red-600'
                }`}>{forecastError}</p>
              )}
              
              {/* Horizon mismatch indicator */}
              {forecastHorizonMismatch && (
                <p className={`text-sm ${
                  isDarkMode ? 'text-amber-400' : 'text-amber-600'
                }`}>⚠️ Horizon changed - click Generate to update forecast</p>
              )}

              
              <button
                type="button"
                onClick={() => {
                  console.log("[GENERATE_BUTTON_CLICKED] Main Generate button clicked!");
                  handleGenerateClick();
                }}
                disabled={!pipelineReady || forecastStatus === "loading"}
                className={`px-6 py-2 rounded-full text-sm font-semibold transition-colors ${
                  !pipelineReady || forecastStatus === "loading"
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : forecastHorizonMismatch
                    ? 'bg-amber-600 text-white hover:bg-amber-700' // Different color when mismatch
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {forecastStatus === "loading" ? "Generating…" : "Generate"}
              </button>
            </div>

            {/* Status Messages */}
            {!targetSpecResult && (
              <p className={`text-sm text-center mt-4 ${
                isDarkMode ? 'text-gray-400' : 'text-gray-500'
              }`}>Please save target specification first</p>
            )}
          </div>
        </div>

      {/* Data Preview Panel (A-2) */}
      {previewData && (
        <div className="mb-8 p-6 border rounded-lg bg-white shadow-sm">
          <h3 className="text-lg font-semibold mb-4">Data Preview</h3>
          
          {/* Head/Tail Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Head Table */}
            <div>
              <h4 className="font-medium text-gray-700 mb-3">First 5 rows</h4>
              <div className="bg-gray-50 p-3 rounded border overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="border-b border-gray-300">
                      <th className="text-left py-1 px-2">Date</th>
                      <th className="text-right py-1 px-2">Open</th>
                      <th className="text-right py-1 px-2">High</th>
                      <th className="text-right py-1 px-2">Low</th>
                      <th className="text-right py-1 px-2">Close</th>
                      <th className="text-right py-1 px-2">Adj</th>
                      <th className="text-right py-1 px-2">Vol</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Array.isArray(previewData.head) ? previewData.head : []).map((row, idx) => (
                      <tr key={idx} className="border-b border-gray-200">
                        <td className="py-1 px-2 text-gray-700">{row.date}</td>
                        <td className="py-1 px-2 text-right text-gray-600">{row.open}</td>
                        <td className="py-1 px-2 text-right text-gray-600">{row.high}</td>
                        <td className="py-1 px-2 text-right text-gray-600">{row.low}</td>
                        <td className="py-1 px-2 text-right text-gray-600">{row.close}</td>
                        <td className="py-1 px-2 text-right text-blue-600">{row.adj_close}</td>
                        <td className="py-1 px-2 text-right text-gray-500">{row.volume}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tail Table */}
            {previewData.tail.length > 0 && (
              <div>
                <h4 className="font-medium text-gray-700 mb-3">Last 5 rows</h4>
                <div className="bg-gray-50 p-3 rounded border overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-gray-300">
                        <th className="text-left py-1 px-2">Date</th>
                        <th className="text-right py-1 px-2">Open</th>
                        <th className="text-right py-1 px-2">High</th>
                        <th className="text-right py-1 px-2">Low</th>
                        <th className="text-right py-1 px-2">Close</th>
                        <th className="text-right py-1 px-2">Adj</th>
                        <th className="text-right py-1 px-2">Vol</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Array.isArray(previewData.tail) ? previewData.tail : []).map((row, idx) => (
                        <tr key={idx} className="border-b border-gray-200">
                          <td className="py-1 px-2 text-gray-700">{row.date}</td>
                          <td className="py-1 px-2 text-right text-gray-600">{row.open}</td>
                          <td className="py-1 px-2 text-right text-gray-600">{row.high}</td>
                          <td className="py-1 px-2 text-right text-gray-600">{row.low}</td>
                          <td className="py-1 px-2 text-right text-gray-600">{row.close}</td>
                          <td className="py-1 px-2 text-right text-blue-600">{row.adj_close}</td>
                          <td className="py-1 px-2 text-right text-gray-500">{row.volume}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Gaps List */}
          {Array.isArray(previewData.gaps) && previewData.gaps.length > 0 && (
            <div>
              <h4 className="font-medium text-gray-700 mb-3">Missing Trading Days</h4>
              <div className="space-y-2">
                {previewData.gaps.map((gap, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-between p-2 rounded text-sm ${
                      gap.severity === 'warn'
                        ? 'bg-amber-50 border border-amber-200 text-amber-800'
                        : 'bg-blue-50 border border-blue-200 text-blue-800'
                    }`}
                  >
                    <span className="font-mono">
                      {gap.end ? `${gap.start} .. ${gap.end}` : gap.start}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      gap.severity === 'warn'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}>
                      ({gap.days} day{gap.days > 1 ? 's' : ''}) [{gap.severity === 'warn' ? 'Warn' : 'Info'}]
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Repairs & Audit Panel (A-3) */}
      <EnhancedRepairsPanel
        symbol={params.ticker}
        isOpen={showRepairsPanel}
        onClose={() => setShowRepairsPanel(false)}
      />

      {/* Data Contract Popover */}
      {showDataContract && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-6 border w-auto max-w-2xl shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-medium text-gray-900">
                  Data Contract
                </h3>
                <button
                  onClick={() => setShowDataContract(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="space-y-4">
                <h4 className="text-md font-medium text-gray-800">Required columns (canonical daily dataset)</h4>
                
                <div className="overflow-x-auto">
                  <table className="min-w-full border border-gray-300">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 border-b">Column</th>
                        <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 border-b">Type & Requirements</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      <tr className="border-b">
                        <td className="px-4 py-2 text-sm font-mono">date</td>
                        <td className="px-4 py-2 text-sm">YYYY-MM-DD, exchange local</td>
                      </tr>
                      <tr className="border-b">
                        <td className="px-4 py-2 text-sm font-mono">open, high, low, close</td>
                        <td className="px-4 py-2 text-sm">split-adjusted, &gt;0</td>
                      </tr>
                      <tr className="border-b">
                        <td className="px-4 py-2 text-sm font-mono">adj_close</td>
                        <td className="px-4 py-2 text-sm">split+dividend adjusted</td>
                      </tr>
                      <tr className="border-b">
                        <td className="px-4 py-2 text-sm font-mono">volume</td>
                        <td className="px-4 py-2 text-sm">int ≥ 0</td>
                      </tr>
                      <tr className="border-b">
                        <td className="px-4 py-2 text-sm font-mono">split_factor</td>
                        <td className="px-4 py-2 text-sm">float</td>
                      </tr>
                      <tr className="border-b">
                        <td className="px-4 py-2 text-sm font-mono">cash_dividend</td>
                        <td className="px-4 py-2 text-sm">float per share</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2 text-sm font-mono">source</td>
                        <td className="px-4 py-2 text-sm">string: vendor+timestamp</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                
                <div className="pt-2">
                  <a
                    href="/api/mapping"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 underline text-sm"
                  >
                    Column Mapping
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Column Mapping Modal (A-1) */}
      {showColumnMapping && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-8 mx-auto p-6 border w-auto max-w-4xl shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-medium text-gray-900">
                  Column Mapping
                </h3>
                <button
                  onClick={() => setShowColumnMapping(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Tab Navigation */}
              <div className="flex mb-6 border-b">
                <button
                  onClick={() => setMappingTab('template')}
                  className={`px-4 py-2 font-medium text-sm ${
                    mappingTab === 'template'
                      ? 'border-b-2 border-blue-600 text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Choose Template
                </button>
                <button
                  onClick={() => setMappingTab('custom')}
                  className={`px-4 py-2 font-medium text-sm ${
                    mappingTab === 'custom'
                      ? 'border-b-2 border-blue-600 text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Create/Edit Mapping
                </button>
              </div>

              {/* Template Tab */}
              {mappingTab === 'template' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Saved Mappings</label>
                    <select
                      value={selectedMapping || ''}
                      onChange={(e) => setSelectedMapping(e.target.value || null)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    >
                      <option value="">Select a mapping template...</option>
                      {columnMappings.map((mapping) => (
                        <option key={mapping.id} value={mapping.id}>
                          {mapping.name} ({mapping.vendor})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Preview selected mapping */}
                  {selectedMapping && (() => {
                    const mapping = columnMappings.find(m => m.id === selectedMapping);
                    return mapping ? (
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-medium mb-2">{mapping.name}</h4>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="font-medium text-gray-700 mb-1">Source Columns:</p>
                            <ul className="space-y-1">
                              {Object.keys(mapping.map).map((source) => (
                                <li key={source} className="text-gray-600">{source}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <p className="font-medium text-gray-700 mb-1">Canonical Fields:</p>
                            <ul className="space-y-1">
                              {Object.values(mapping.map).map((target, idx) => (
                                <li key={idx} className="text-gray-600">{target}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    ) : null;
                  })()}
                </div>
              )}

              {/* Custom Tab */}
              {mappingTab === 'custom' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-6">
                    {/* Left: Detected Headers */}
                    <div>
                      <h4 className="font-medium mb-3 text-gray-700">Detected Headers</h4>
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {detectedHeaders.map((header, idx) => (
                          <div key={idx} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                            <span className="text-sm font-mono text-gray-700">{header}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Right: Canonical Fields */}
                    <div>
                      <h4 className="font-medium mb-3 text-gray-700">Map to Canonical Fields</h4>
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {detectedHeaders.map((header, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-20 truncate">{header}:</span>
                            <select
                              value={customMapping[header] || ''}
                              onChange={(e) => setCustomMapping(prev => {
                                const newMapping = { ...prev };
                                if (e.target.value) {
                                  newMapping[header] = e.target.value;
                                } else {
                                  delete newMapping[header];
                                }
                                return newMapping;
                              })}
                              className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                            >
                              <option value="">-- Skip --</option>
                              <option value="date">date</option>
                              <option value="open">open</option>
                              <option value="high">high</option>
                              <option value="low">low</option>
                              <option value="close">close</option>
                              <option value="adj_close">adj_close</option>
                              <option value="volume">volume</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Save Custom Mapping */}
                  <div className="border-t pt-4">
                    <div className="flex gap-4">
                      <input
                        type="text"
                        placeholder="Template name..."
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                        id="customMappingName"
                      />
                      <select
                        className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                        id="customMappingVendor"
                      >
                        <option value="unknown">Unknown</option>
                        <option value="yahoo">Yahoo</option>
                        <option value="bloomberg">Bloomberg</option>
                        <option value="refinitiv">Refinitiv</option>
                      </select>
                      <button
                        onClick={async () => {
                          const nameInput = document.getElementById('customMappingName') as HTMLInputElement;
                          const vendorSelect = document.getElementById('customMappingVendor') as HTMLSelectElement;
                          if (nameInput.value && Object.keys(customMapping).length > 0) {
                            await saveColumnMapping(nameInput.value, vendorSelect.value, customMapping);
                            nameInput.value = '';
                          }
                        }}
                        className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm"
                      >
                        Save Template
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowColumnMapping(false)}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    // Apply the selected mapping and close modal
                    setShowColumnMapping(false);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Apply Mapping
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Conflict Resolution Modal (A-4) */}
      {showConflictResolution && conflictData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b">
              <h2 className="text-xl font-semibold">Corporate Actions Conflicts</h2>
              <p className="text-gray-600 mt-1">
                {conflictData.conflicts.length} conflicts found. Choose how to resolve them:
              </p>
            </div>
            
            <div className="p-6 max-h-[60vh] overflow-y-auto">
              <div className="space-y-4">
                {conflictData.conflicts.map((conflict: any, idx: number) => (
                  <div key={idx} className="p-4 border rounded-lg bg-gray-50">
                    <div className="text-sm font-medium text-gray-700 mb-3">
                      Conflict #{idx + 1}: {conflict.date} - {conflict.existing.type}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      {/* Existing */}
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                        <div className="text-xs font-medium text-blue-800 mb-2">EXISTING</div>
                        <div className="text-sm">
                          <div><strong>Type:</strong> {conflict.existing.type}</div>
                          <div><strong>Description:</strong> {conflict.existing.description}</div>
                          {conflict.existing.amount && (
                            <div><strong>Amount:</strong> ${conflict.existing.amount}</div>
                          )}
                          {conflict.existing.ratio && (
                            <div><strong>Ratio:</strong> {conflict.existing.ratio}:1</div>
                          )}
                        </div>
                      </div>
                      
                      {/* Incoming */}
                      <div className="p-3 bg-orange-50 border border-orange-200 rounded">
                        <div className="text-xs font-medium text-orange-800 mb-2">INCOMING</div>
                        <div className="text-sm">
                          <div><strong>Type:</strong> {conflict.incoming.type}</div>
                          <div><strong>Description:</strong> {conflict.incoming.description}</div>
                          {conflict.incoming.amount && (
                            <div><strong>Amount:</strong> ${conflict.incoming.amount}</div>
                          )}
                          {conflict.incoming.ratio && (
                            <div><strong>Ratio:</strong> {conflict.incoming.ratio}:1</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="p-6 border-t bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  {conflictData.pendingActions.length} new actions will be added regardless of conflict resolution.
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowConflictResolution(false)}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => resolveConflicts('skip')}
                    disabled={isUploadingCorporateActions}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    Keep Existing
                  </button>
                  <button
                    onClick={() => resolveConflicts('overwrite')}
                    disabled={isUploadingCorporateActions}
                    className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50"
                  >
                    {isUploadingCorporateActions ? 'Processing...' : 'Replace with New'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delisting Override Modal (A-5) */}
      {showDelistingOverride && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full">
            <div className="p-6 border-b">
              <h2 className="text-xl font-semibold">Manual Delisting Override</h2>
              <p className="text-gray-600 mt-1">
                Override the delisting status for {params.ticker} to proceed with analysis.
              </p>
            </div>
            
            <div className="p-6">
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">
                  Reason for Override *
                </label>
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Explain why you're overriding the delisting status (e.g., 'Historical analysis for research purposes', 'Data quality validation needed')"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md h-24 resize-none"
                  maxLength={200}
                />
                <div className="text-xs text-gray-500 mt-1">
                  {overrideReason.length}/200 characters
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
                <div className="flex">
                  <svg className="h-5 w-5 text-yellow-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <div className="text-sm text-yellow-800">
                    <p className="font-medium">Warning</p>
                    <p>Overriding delisting status may affect data quality and analysis results. Use only when necessary and document your reasoning.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="p-6 border-t bg-gray-50 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowDelistingOverride(false);
                  setOverrideReason('');
                }}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={applyDelistingOverride}
                disabled={!overrideReason.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Apply Override
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Data Quality Modal */}
      {showDataQualityModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold">Data Quality</h2>
                <button 
                  onClick={() => setShowDataQualityModal(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {uploadResult ? (
                <>
                  {/* Badges */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                    <Badge
                      label="Contract OK"
                      status={uploadResult.badges.contractOK}
                    />
                    <Badge
                      label="Calendar OK"
                      status={uploadResult.badges.calendarOK}
                    />
                    <Badge
                      label="TZ OK"
                      status={uploadResult.badges.tzOK}
                    />
                    <Badge
                      label="Corporate Actions OK"
                      status={uploadResult.badges.corpActionsOK}
                    />
                    <Badge
                      label="Validations OK"
                      status={uploadResult.badges.validationsOK}
                    />
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium">Repairs:</span>
                      <span className={`px-2 py-1 rounded text-sm ${
                        uploadResult.badges.repairsCount === 0 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {uploadResult.badges.repairsCount}
                      </span>
                    </div>
                  </div>

                  {/* Counts */}
                  <div className="mb-6">
                    <h3 className="text-lg font-medium mb-2">Summary</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">Input rows:</span>
                        <span className="ml-2 font-medium">{uploadResult.counts.input}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Canonical rows:</span>
                        <span className="ml-2 font-medium">{uploadResult.counts.canonical}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Invalid rows:</span>
                        <span className="ml-2 font-medium">{uploadResult.counts.invalid}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Missing days:</span>
                        <span className="ml-2 font-medium">{uploadResult.counts.missingDays}</span>
                      </div>
                    </div>
                  </div>

                  {/* Details */}
                  <details className="mb-4">
                    <summary className="cursor-pointer text-blue-600 hover:text-blue-800 font-medium">
                      View Details
                    </summary>
                    <div className="mt-4 space-y-4 text-sm">
                      <div>
                        <h4 className="font-medium">Metadata</h4>
                        <p>Symbol: {uploadResult.meta.symbol}</p>
                        <p>Exchange: {uploadResult.meta.exchange}</p>
                        <p>Timezone: {uploadResult.meta.exchange_tz}</p>
                        <p>Date Range: {uploadResult.meta.calendar_span.start} to {uploadResult.meta.calendar_span.end}</p>
                      </div>
                      
                      {uploadResult.meta.missing_trading_days.length > 0 && (
                        <div>
                          <h4 className="font-medium">Missing Trading Days</h4>
                          <p className="text-gray-600">
                            {uploadResult.meta.missing_trading_days.slice(0, 10).join(', ')}
                            {uploadResult.meta.missing_trading_days.length > 10 && '...'}
                          </p>
                        </div>
                      )}
                      
                      <div>
                        <h4 className="font-medium">Files Generated</h4>
                        <div className="space-y-1 text-xs text-gray-600">
                          <p>Raw: {uploadResult.paths.raw}</p>
                          <p>Canonical: {uploadResult.paths.canonical}</p>
                          <p>Audit: {uploadResult.paths.audit}</p>
                        </div>
                      </div>

                      {/* Repairs Section */}
                      {uploadResult.badges.repairsCount > 0 && (
                        <div>
                          <h4 className="font-medium">Repairs ({uploadResult.badges.repairsCount})</h4>
                          {isLoadingRepairs ? (
                            <p className="text-gray-500 text-xs">Loading repairs...</p>
                          ) : repairRecords.length > 0 ? (
                            <div className="space-y-1 text-xs">
                              {repairRecords.slice(0, 10).map((repair, idx) => (
                                <div key={idx} className="bg-yellow-50 p-2 rounded border">
                                  <p><strong>{repair.date}</strong> - {repair.field}</p>
                                  <p className="text-gray-600">{repair.oldValue} → {repair.newValue}</p>
                                  <p className="text-xs text-gray-500">{repair.reason}</p>
                                </div>
                              ))}
                              {repairRecords.length > 10 && (
                                <p className="text-gray-500">+ {repairRecords.length - 10} more repairs</p>
                              )}
                              <div className="mt-2">
                                <a 
                                  href={uploadResult.paths.audit} 
                                  className="text-blue-600 hover:text-blue-800 text-xs"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  📄 View full repairs log
                                </a>
                              </div>
                            </div>
                          ) : (
                            <p className="text-gray-500 text-xs">No repair records found</p>
                          )}
                        </div>
                      )}
                    </div>
                  </details>

                  {/* Methods */}
                  <details>
                    <summary className="cursor-pointer text-blue-600 hover:text-blue-800 font-medium">
                      Methods & Formulas
                    </summary>
                    <div className="mt-4 text-sm bg-gray-50 p-4 rounded">
                      <p><strong>Log returns:</strong> r_t = ln(adj_close_t / adj_close_{'{t−1}'})</p>
                      <p><strong>OHLC coherence:</strong> high ≥ max(open, close), low ≤ min(open, close), low ≤ high</p>
                      <p><strong>Calendar check:</strong> no gaps vs exchange calendar (weekday approximation for now)</p>
                      <p><strong>Delistings:</strong> keep history; mark delisted=true if applicable</p>
                    </div>
                  </details>
                </>
              ) : (
                <div className="text-center text-gray-500 py-8">
                  <p>No data quality information available.</p>
                  <p className="text-sm mt-2">Upload data first to see quality metrics.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upload Data Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b bg-white sticky top-0 z-10">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">Upload Data</h2>
                  <p className="text-gray-600 text-sm mt-1">
                    Upload and process historical price data for {params.ticker}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowUploadModal(false);
                    // Reset upload state when closing modal
                    setSelectedFile(null);
                    setParsedRows([]);
                    setError(null);
                    setUploadWarning(null);
                    setValidationSummary(null);
                  }}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div className="p-6">
              {/* Provenance Ribbon (M-5) - Audit trail information */}
              {provenanceData && (
                <div className="mb-6 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded text-xs text-indigo-700 font-mono">
                  <div className="font-medium mb-1">Current Data Source</div>
                  Vendor: {provenanceData.vendor} • Mapping: {provenanceData.mappingId} • File: {provenanceData.fileHash.substring(0, 7)} • Rows: {provenanceData.rows.toLocaleString()} • Range: {provenanceData.dateRange.first}→{provenanceData.dateRange.last} • Imported: {new Date(provenanceData.processedAt).toLocaleString()}
                </div>
              )}
              
              {/* Company Information Form */}
              <form onSubmit={saveCompanyInfo} className="mb-6 p-4 bg-gray-50 rounded-lg">
                <h3 className="text-lg font-medium mb-3">Company Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="modal-companyTicker" className="block text-sm font-medium mb-2">
                      Ticker *
                    </label>
                    <input
                      type="text"
                      id="modal-companyTicker"
                      name="companyTicker"
                      value={companyTicker}
                      onChange={(e) => setCompanyTicker(e.target.value.toUpperCase())}
                      required
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md uppercase"
                      placeholder="e.g., AAPL"
                    />
                  </div>
                  <div>
                    <label htmlFor="modal-companyName" className="block text-sm font-medium mb-2">
                      Company Name *
                    </label>
                    <input
                      type="text"
                      id="modal-companyName"
                      name="companyName"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      required
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="e.g., Apple Inc."
                    />
                  </div>
                  <div>
                    <label htmlFor="modal-companyExchange" className="block text-sm font-medium mb-2">
                      Exchange *
                    </label>
                    <select
                      id="modal-companyExchange"
                      name="companyExchange"
                      value={companyExchange}
                      onChange={(e) => setCompanyExchange(e.target.value)}
                      required
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md"
                    >
                      <option value="">Select Exchange</option>
                      {Object.entries(exchangesByRegion).map(([region, exchanges]) => (
                        <optgroup key={region} label={region}>
                          {exchanges.map((exchange) => {
                            const exchangeInfo = getExchangeInfo(exchange);
                            return (
                              <option key={exchange} value={exchange}>
                                {exchange} ({exchangeInfo?.country} - {exchangeInfo?.currency})
                              </option>
                            );
                          })}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-4">
                  <button
                    type="submit"
                    disabled={isSavingCompany || !companyTicker || !companyName || !companyExchange}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSavingCompany ? 'Saving...' : 'Save Company'}
                  </button>
                  {companySaveSuccess && (
                    <span className="text-green-600 text-sm font-medium">✓ Company saved successfully!</span>
                  )}
                </div>
              </form>

              {/* M-4: Exchange Validation Warning Banner */}
              {exchangeWarning?.show && (
                <div className="mb-6 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                  <div className="flex items-start">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-orange-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3 flex-1">
                      <h3 className="text-sm font-medium text-orange-800">
                        Exchange Validation Warning
                      </h3>
                      <div className="mt-2 text-sm text-orange-700">
                        <p>{exchangeWarning.message}</p>
                        {exchangeWarning.details && (
                          <p className="mt-1 text-orange-600">{exchangeWarning.details}</p>
                        )}
                      </div>
                      <div className="mt-4 flex gap-3">
                        <button
                          onClick={() => setExchangeWarning(null)}
                          className="text-sm bg-orange-100 text-orange-800 px-3 py-1 rounded hover:bg-orange-200"
                        >
                          Proceed anyway
                        </button>
                        <button
                          onClick={() => {
                            setExchangeWarning(null);
                            // Focus on exchange dropdown for user to fix
                            document.getElementById('modal-companyExchange')?.focus();
                          }}
                          className="text-sm bg-orange-600 text-white px-3 py-1 rounded hover:bg-orange-700"
                        >
                          Fix exchange
                        </button>
                      </div>
                    </div>
                    <div className="ml-auto pl-3">
                      <button
                        onClick={() => setExchangeWarning(null)}
                        className="text-orange-400 hover:text-orange-600"
                      >
                        <span className="sr-only">Dismiss</span>
                        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Delisting Awareness Indicator (A-5) */}
              {delistingInfo && delistingInfo.status !== 'active' && (
                <div className={`mb-6 p-4 border rounded-lg ${
                  delistingInfo.status === 'delisted' 
                    ? 'bg-red-50 border-red-200' 
                    : delistingInfo.status === 'suspended'
                      ? 'bg-yellow-50 border-yellow-200'
                      : 'bg-orange-50 border-orange-200'
                }`}>
                  <div className="flex items-start">
                    <div className="flex-shrink-0">
                      <svg className={`h-5 w-5 mt-0.5 ${
                        delistingInfo.status === 'delisted' 
                          ? 'text-red-400' 
                          : delistingInfo.status === 'suspended'
                            ? 'text-yellow-400'
                            : 'text-orange-400'
                      }`} fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3 flex-1">
                      <h3 className={`text-sm font-medium ${
                        delistingInfo.status === 'delisted' 
                          ? 'text-red-800' 
                          : delistingInfo.status === 'suspended'
                            ? 'text-yellow-800'
                            : 'text-orange-800'
                      }`}>
                        {delistingInfo.status === 'delisted' 
                          ? 'Delisted Security' 
                          : delistingInfo.status === 'suspended'
                            ? 'Trading Suspended'
                            : 'Pending Delisting'}
                      </h3>
                      <div className={`mt-2 text-sm ${
                        delistingInfo.status === 'delisted' 
                          ? 'text-red-700' 
                          : delistingInfo.status === 'suspended'
                            ? 'text-yellow-700'
                            : 'text-orange-700'
                      }`}>
                        {delistingInfo.reason && <p className="mb-2">{delistingInfo.reason}</p>}
                        {delistingInfo.delistingDate && (
                          <p className="mb-2"><strong>Delisted:</strong> {delistingInfo.delistingDate}</p>
                        )}
                        {delistingInfo.lastTradingDate && (
                          <p className="mb-2"><strong>Last Trading Date:</strong> {delistingInfo.lastTradingDate}</p>
                        )}
                        
                        {/* Warnings */}
                        {delistingInfo.warnings.length > 0 && (
                          <div className="mt-3">
                            <p className="font-medium mb-1">Important Notes:</p>
                            <ul className="list-disc list-inside space-y-1">
                              {delistingInfo.warnings.map((warning, idx) => (
                                <li key={idx} className="text-xs">{warning}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Manual Override Info */}
                        {delistingInfo.manualOverride && (
                          <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded">
                            <p className="text-xs font-medium text-blue-800">Manual Override Active</p>
                            <p className="text-xs text-blue-700">
                              <strong>Date:</strong> {delistingInfo.manualOverride.overrideDate} | 
                              <strong> Reason:</strong> {delistingInfo.manualOverride.overrideReason}
                            </p>
                          </div>
                        )}
                      </div>
                      
                      {/* Action Buttons */}
                      {!delistingInfo.manualOverride && (
                        <div className="mt-4 flex gap-3">
                          <button
                            onClick={() => setShowDelistingOverride(true)}
                            className="text-sm bg-blue-600 text-white px-3 py-1 rounded-full hover:bg-blue-700"
                          >
                            Apply Manual Override
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* File Upload Form */}
              <form onSubmit={handleFileUpload} className="space-y-4">
                <h3 className="text-lg font-medium">Upload Data File (Excel or CSV)</h3>
                
                {/* Data Type Selection */}
                <div>
                  <label className="block text-sm font-medium mb-3">Data Type</label>
                  <div className="flex gap-2 items-center">
                    <select
                      value={selectedDataType}
                      onChange={(e) => setSelectedDataType(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
                    >
                      {dataTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setShowAddDataType(true)}
                      className="px-3 py-2 bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 text-sm"
                      title="Add new data type"
                    >
                      (+)
                    </button>
                  </div>
                  
                  {/* Add New Data Type Input */}
                  {showAddDataType && (
                    <div className="mt-3 flex gap-2">
                      <input
                        type="text"
                        value={newDataTypeName}
                        onChange={(e) => setNewDataTypeName(e.target.value)}
                        onKeyDown={handleDataTypeKeyPress}
                        placeholder="Enter new data type name"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={addNewDataType}
                        disabled={!newDataTypeName.trim()}
                        className="px-3 py-2 bg-green-600 text-white rounded-full hover:bg-green-700 disabled:opacity-50 text-sm"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddDataType(false);
                          setNewDataTypeName('');
                        }}
                        className="px-3 py-2 bg-gray-300 text-gray-700 rounded-full hover:bg-gray-400 text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                
                {/* Upload Mode Selection */}
                <div>
                  <label className="block text-sm font-medium mb-3">Processing Mode</label>
                  <div className="flex gap-4">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="uploadMode"
                        value="replace"
                        checked={uploadMode === 'replace'}
                        onChange={(e) => setUploadMode(e.target.value as 'replace')}
                        className="mr-2"
                      />
                      <span className="text-sm">
                        <strong>Replace</strong> - Overwrite existing data completely
                      </span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="uploadMode"
                        value="incremental"
                        checked={uploadMode === 'incremental'}
                        onChange={(e) => setUploadMode(e.target.value as 'incremental')}
                        className="mr-2"
                      />
                      <span className="text-sm">
                        <strong>Incremental</strong> - Append new dates, skip overlaps
                      </span>
                    </label>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-3">
                    <input
                      type="file"
                      id="modal-file"
                      name="file"
                      accept=".xlsx,.csv"
                      required
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setSelectedFile(file);
                      }}
                    />
                    <label 
                      htmlFor="modal-file"
                      className="inline-flex items-center px-4 py-2 bg-blue-50 text-blue-700 text-sm font-semibold rounded-full border-0 hover:bg-blue-100 cursor-pointer"
                    >
                      {selectedFile ? 'Change File' : 'Choose File'}
                    </label>
                    {selectedFile && (
                      <span className="text-sm text-gray-600">
                        {selectedFile.name}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <button
                    type="submit"
                    disabled={isUploading || isReprocessing}
                    className="px-6 py-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isUploading ? 'Processing...' : 'Upload & Process'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDataContract(true)}
                    className="ml-3 px-4 py-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-full transition-colors"
                  >
                    View Data Contract
                  </button>
                </div>
              </form>
              
              {/* File Parse Success Indicator */}
              {Array.isArray(parsedRows) && parsedRows.length > 0 && (
                <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
                  <h4 className="font-medium text-green-800 mb-2">File Parsed Successfully!</h4>
                  <div className="text-sm text-green-700">
                    Found <strong>{parsedRows.length} valid rows</strong> with Date and Adj Close columns.
                    {parsedRows.length >= 252 ? (
                      <span className="text-green-600"> ✓ Meets minimum requirement (252+ rows)</span>
                    ) : (
                      <span className="text-orange-600"> ⚠ Below minimum requirement ({252 - parsedRows.length} more rows needed)</span>
                    )}
                  </div>
                  <div className="mt-2 text-xs text-green-600">
                    Date range: {parsedRows?.[0]?.date || 'N/A'} → {parsedRows?.[parsedRows.length - 1]?.date || 'N/A'}
                  </div>
                </div>
              )}
              
              {error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-red-600">{error}</p>
                </div>
              )}

              {/* Upload Warning Banner */}
              {uploadWarning && (
                <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
                  <p className="text-yellow-800">{uploadWarning}</p>
                </div>
              )}

              {/* Validation Summary Panel */}
              {validationSummary && (
                <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-md">
                  <h4 className="text-md font-medium mb-3 text-gray-900">Upload Summary</h4>
                  
                  {/* File Info */}
                  <div className="mb-4 text-sm">
                    <div className="flex items-center gap-4 mb-2">
                      <span className="font-medium">File:</span>
                      <span className="text-gray-700">{validationSummary.file.name}</span>
                      <span className="text-gray-500">({validationSummary.file.rows.toLocaleString()} rows)</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-medium">Date Range:</span>
                      <span className="text-gray-700">{validationSummary.dateRange.first} to {validationSummary.dateRange.last}</span>
                    </div>
                  </div>

                  {/* Validation Badges - simplified for modal view */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                    <div className={`p-2 rounded text-center ${
                      validationSummary.validation.ohlcCoherence.failCount === 0 
                        ? 'bg-green-100 border border-green-300' 
                        : 'bg-red-100 border border-red-300'
                    }`}>
                      <div className={`text-xs font-medium ${
                        validationSummary.validation.ohlcCoherence.failCount === 0 
                          ? 'text-green-800' 
                          : 'text-red-800'
                      }`}>
                        OHLC Coherence
                      </div>
                      <div className={`text-sm ${
                        validationSummary.validation.ohlcCoherence.failCount === 0 
                          ? 'text-green-700' 
                          : 'text-red-700'
                      }`}>
                        {validationSummary.validation.ohlcCoherence.failCount === 0 ? 'Pass' : `${validationSummary.validation.ohlcCoherence.failCount} fails`}
                      </div>
                    </div>

                    <div className={`p-2 rounded text-center ${
                      validationSummary.validation.missingDays.blocked
                        ? 'bg-red-100 border border-red-300' 
                        : validationSummary.validation.missingDays.totalMissing > 0
                          ? 'bg-amber-100 border border-amber-300'
                          : 'bg-green-100 border border-green-300'
                    }`}>
                      <div className={`text-xs font-medium ${
                        validationSummary.validation.missingDays.blocked
                          ? 'text-red-800' 
                          : validationSummary.validation.missingDays.totalMissing > 0
                            ? 'text-amber-800'
                            : 'text-green-800'
                      }`}>
                        Missing Days
                      </div>
                      <div className={`text-sm ${
                        validationSummary.validation.missingDays.blocked
                          ? 'text-red-700' 
                          : validationSummary.validation.missingDays.totalMissing > 0
                            ? 'text-amber-700'
                            : 'text-green-700'
                      }`}>
                        {validationSummary.validation.missingDays.totalMissing} missing
                      </div>
                    </div>

                    <div className={`p-2 rounded text-center ${
                      validationSummary.validation.duplicates.count === 0 
                        ? 'bg-green-100 border border-green-300' 
                        : 'bg-amber-100 border border-amber-300'
                    }`}>
                      <div className={`text-xs font-medium ${
                        validationSummary.validation.duplicates.count === 0 
                          ? 'text-green-800' 
                          : 'text-amber-800'
                      }`}>
                        Duplicates
                      </div>
                      <div className={`text-sm ${
                        validationSummary.validation.duplicates.count === 0 
                          ? 'text-green-700' 
                          : 'text-amber-700'
                      }`}>
                        {validationSummary.validation.duplicates.count} found
                      </div>
                    </div>
                  </div>

                  {/* Provenance */}
                  <div className="text-xs text-gray-600 border-t pt-2">
                    <span className="font-medium">Mode:</span> {validationSummary.mode || 'unknown'} • 
                    <span className="font-medium ml-2">Vendor:</span> {validationSummary.provenance.vendor} • 
                    <span className="font-medium ml-2">Processed:</span> {new Date(validationSummary.provenance.processedAt).toLocaleString()}
                  </div>

                  {/* Action buttons */}
                  <div className="mt-3 flex justify-end gap-3">
                    <button
                      onClick={exportCanonicalCSV}
                      disabled={isExporting}
                      className="px-4 py-2 bg-green-600 text-white text-sm rounded-full hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                      {isExporting ? 'Exporting...' : 'Export CSV'}
                    </button>
                    <button
                      onClick={() => {
                        setShowRepairsPanel(true);
                        setShowUploadModal(false); // Close modal when opening repairs panel
                      }}
                      className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-full hover:bg-indigo-700 transition-colors"
                    >
                      View Audit Trail
                    </button>
                  </div>

                  {/* Blocked Warning */}
                  {validationSummary.validation.missingDays.blocked && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
                      <div className="flex items-center">
                        <svg className="w-5 h-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="text-sm font-medium text-red-800">
                          Too many missing days ({validationSummary.validation.missingDays.totalMissing}) - downstream analysis blocked
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* Export Error Display (A-6) */}
              {exportError && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                  <div className="flex items-center">
                    <svg className="w-5 h-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <span className="text-sm font-medium text-red-800">Export Failed</span>
                      <p className="text-sm text-red-700">{exportError}</p>
                    </div>
                    <button
                      onClick={() => setExportError(null)}
                      className="ml-auto text-red-400 hover:text-red-600"
                    >
                      <span className="sr-only">Dismiss</span>
                      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Model Comparison Modal */}
      {isModelInfoOpen && modelScores && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className={`rounded-xl shadow-xl p-6 max-w-6xl w-full mx-4 max-h-[90vh] overflow-auto ${
            isDarkMode ? 'bg-gray-800' : 'bg-white'
          }`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-semibold ${
                isDarkMode ? 'text-gray-200' : 'text-gray-900'
              }`}>
                Model comparison for {params.ticker} – {targetSpecResult?.spec?.h || 5}D / {((targetSpecResult?.spec?.coverage || 0.95) * 100).toFixed(0)}%
              </h3>
              <button 
                onClick={() => setIsModelInfoOpen(false)}
                className={`p-2 rounded-full transition-colors ${
                  isDarkMode
                    ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200'
                    : 'hover:bg-gray-100 text-gray-600 hover:text-gray-900'
                }`}
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className={`min-w-full text-xs ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
                <thead className={`border-b ${isDarkMode ? 'border-gray-600 text-gray-400' : 'border-gray-200 text-gray-600'}`}>
                  <tr>
                    <th className="py-3 px-3 text-left">Model</th>
                    <th className="py-3 px-3 text-right">Score</th>
                    <th className="py-3 px-3 text-right">Interval Score</th>
                    <th className="py-3 px-3 text-right">Coverage</th>
                    <th className="py-3 px-3 text-right">Width (bp)</th>
                    <th className="py-3 px-3 text-right">POF p</th>
                    <th className="py-3 px-3 text-right">CC p</th>
                    <th className="py-3 px-3 text-center">Zone</th>
                  </tr>
                </thead>
                <tbody>
                  {modelScores
                    .slice()
                    .sort((a, b) => a.score - b.score)
                    .map(ms => {
                      const { model, score, metrics, noData } = ms;
                      const hasData = !noData &&
                        Number.isFinite(metrics.intervalScore) &&
                        Number.isFinite(metrics.empiricalCoverage) &&
                        Number.isFinite(metrics.avgWidthBp);
                      
                      const isBest = recommendedModel && model === recommendedModel;
                      const zoneClass =
                        metrics.trafficLight === "green"
                          ? "text-green-600"
                          : metrics.trafficLight === "yellow"
                          ? "text-amber-500"
                          : "text-red-600";

                      return (
                        <tr 
                          key={model} 
                          className={`border-b ${
                            isDarkMode ? 'border-gray-700' : 'border-gray-100'
                          } ${
                            isBest 
                              ? isDarkMode 
                                ? "bg-green-950/30" 
                                : "bg-green-50/60" 
                              : ""
                          }`}
                        >
                          <td className="py-2 px-3 font-medium">
                            {isBest && <span className="text-green-600 mr-1">★</span>}
                            {model}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {hasData ? score.toFixed(2) : "–"}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {hasData ? metrics.intervalScore.toFixed(3) : "No backtest"}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {hasData ? `${(metrics.empiricalCoverage * 100).toFixed(1)}%` : "–"}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {hasData ? metrics.avgWidthBp.toFixed(0) : "–"}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {hasData && Number.isFinite(metrics.kupiecPValue)
                              ? metrics.kupiecPValue.toFixed(2)
                              : "–"}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {hasData && Number.isFinite(metrics.ccPValue)
                              ? metrics.ccPValue.toFixed(2)
                              : "–"}
                          </td>
                          <td className="py-2 px-3 text-center font-medium">
                            {hasData ? (
                              <span className={zoneClass}>{metrics.trafficLight}</span>
                            ) : (
                              <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>no data</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            <div className={`mt-4 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              <p>• Lower scores are better. ★ indicates the recommended model.</p>
              <p>• Models with &quot;No backtest&quot; are shown for completeness but are not considered for the Best recommendation.</p>
              <p>• Interval Score: Proper scoring rule for prediction intervals (lower better)</p>
              <p>• Coverage: Empirical coverage vs nominal {((targetSpecResult?.spec?.coverage || 0.95) * 100).toFixed(0)}%</p>
              <p>• POF/CC p: Kupiec proportion of failures and Christoffersen conditional coverage test p-values</p>
              <p>• Zone: VaR traffic light (green = good, yellow = acceptable, red = concerning)</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
