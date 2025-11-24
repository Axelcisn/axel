// cspell:words OHLC Delistings delisted ndist cooldown efron Backtest
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { IngestionResult } from '@/lib/types/canonical';
import { TargetSpec, TargetSpecResult } from '@/lib/types/targetSpec';
import { ForecastRecord } from '@/lib/forecast/types';
import { EventRecord } from '@/lib/events/types';
import { AlertFire } from '@/lib/watchlist/types';
import { RepairRecord } from '@/lib/types/canonical';
import { GbmForecast } from '@/lib/storage/fsStore';
import AlertsCard from '@/components/AlertsCard';
import { QAPanel } from '@/components/QAPanel';
import { EnhancedRepairsPanel } from '@/components/EnhancedRepairsPanel';
import PriceChart from '@/components/PriceChart';
import { formatTicker, getAllExchanges, getExchangesByRegion, getExchangeInfo } from '@/lib/utils/formatTicker';
import { parseExchange, normalizeTicker } from '@/lib/utils/parseExchange';
import { CompanyInfo, ExchangeOption } from '@/lib/types/company';
import { useDarkMode } from '@/lib/hooks/useDarkMode';
import { resolveBaseMethod } from '@/lib/forecast/methods';

// Client-side type for gates status
type GateStatus = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

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

interface TimingPageProps {
  params: {
    ticker: string;
  };
}

export default function TimingPage({ params }: TimingPageProps) {
  // Dark mode hook
  const isDarkMode = useDarkMode();
  
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

  // GBM Forecast state
  const [currentForecast, setCurrentForecast] = useState<GbmForecast | ForecastRecord | null>(null);
  
  // Separate sources so GBM card never shows volatility records
  const [gbmForecast, setGbmForecast] = useState<any | null>(null);
  
  // Volatility forecast state (last volatility model run)
  const [volForecast, setVolForecast] = useState<any | null>(null);

  // Base forecast for conformal (internal, not displayed until conformal is applied)
  const [baseForecast, setBaseForecast] = useState<any | null>(null);

  // Single source for what the "Final Prediction Intervals" card shows
  const [activeForecast, setActiveForecast] = useState<any | null>(null);

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
  const [showMissDetails, setShowMissDetails] = useState(false);

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

  // Handler to apply the recommended model - will be converted to useCallback after runForecastPipeline is defined
  const handleApplyBestModel = () => {
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
    
    // Run pipeline if initialized
    if (!isInitialized) return;
    // Note: runForecastPipeline() call will be added after the function is defined
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
      }
      
      // If no locked forecast found, check if we have a GBM forecast
      if (gbmForecast) {
        console.log('[LoadActiveForecast] Using GBM forecast as active:', gbmForecast.method);
        setActiveForecast(gbmForecast);
        return gbmForecast;
      }

      console.log('[LoadActiveForecast] No active forecast found');
      return null;
    } catch (error) {
      console.error('Failed to load active forecast:', error);
      return null;
    }
  }, [params.ticker, gbmForecast]);

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

  // Clear conformal state when key parameters change to avoid stale data
  // Note: Removed activeBaseMethod to prevent clearing on every forecast change
  useEffect(() => {
    if (!conformalState) return;
    setConformalState(null);
  }, [conformalMode, conformalDomain, conformalCalWindow, conformalState]);

  // Handle generation of base forecasts for conformal prediction
  const handleGenerateBaseForecasts = useCallback(async (): Promise<boolean> => {
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
        return false;
      }

      console.log('[Conformal] Generated base forecasts:', data);
      
      // Show success message briefly
      const successMessage = `Generated ${data.created} new forecasts. ${data.alreadyExisting} already existed.`;
      console.log('[Conformal]', successMessage);
      
      // Refresh the base forecast count to update the panel
      await loadBaseForecastCount();
      await loadModelLine();
      
      // You could also show a temporary success message
      // setConformalError(null); // Clear any previous errors
      
      return true;
    } catch (err) {
      console.error('[Conformal] Generate base forecasts error:', err);
      setConformalError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setIsGeneratingBase(false);
    }
  }, [tickerParam, selectedBaseMethod, conformalCalWindow, conformalDomain, h, coverage, loadBaseForecastCount, loadModelLine]);

  // Conditional base forecast generation - run full pipeline when no forecasts are available
  // Note: Cannot use useCallback here due to runForecastPipeline being defined later
  const onGenerateBaseForecastsClick = async () => {
    // Only proceed if there are no base forecasts available (0 or null)
    if (baseForecastCount !== null && baseForecastCount > 0) {
      console.log('[BaseForecasts] Skipping generation - base forecasts already exist:', baseForecastCount);
      return;
    }
    
    // Guard with isInitialized
    if (!isInitialized) {
      console.log('[BaseForecasts] Skipping - not initialized');
      return;
    }
    
    console.log('[BaseForecasts] Triggering full pipeline - no forecasts available');
    // Note: runForecastPipeline() call will be added after the function is defined
    await handleGenerateBaseForecasts();
  };

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
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate forecast');
      }

      setGbmForecast(data);            // GBM card shows only GBM
      setActiveForecast(data);         // Final PI shows GBM until a vol model is run
      
      // Reload forecasts to get the updated list
      await loadLatestForecast();
      
    } catch (err) {
      setForecastError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsGeneratingForecast(false);
    }
  }, [window, lambdaDrift, coverage, params.ticker, loadLatestForecast]);

  const generateVolatilityForecast = useCallback(async (): Promise<boolean> => {
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
      return false;
    }
    if (!hasData) { 
      console.log("[VOL][handler] early-return", { reason: "insufficient-data" });
      setVolatilityError(`Insufficient history: need ${windowN} days, have ${currentCanonicalCount}.`);
      return false;
    }
    if (!covOK) { 
      console.log("[VOL][handler] early-return", { reason: "coverage-invalid" });
      setVolatilityError("Coverage must be between 50% and 99.9%.");
      return false;
    }
    if (!hasTZ) { 
      console.log("[VOL][handler] early-return", { reason: "no-timezone" });
      setVolatilityError("Exchange timezone missing in Target Spec.");
      return false;
    }
    if (!harAvailable) { 
      console.log("[VOL][handler] early-return", { reason: "har-unavailable" });
      setVolatilityError("Realized-volatility inputs not found (daily/weekly/monthly). HAR-RV requires RV.");
      return false;
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
        windowN: volWindow,
        dist: resolvedDist,
        requestBody: {
          model: selectedModel,
          params: modelParams,
          overwrite: true,
          coverage: persistedCoverage,
          tz: persistedTZ
        }
      });

      const resp = await fetch(`/api/volatility/${encodeURIComponent(tickerParam)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          params: modelParams,
          overwrite: true,
          // Optional: pass through for server logging; server still reads its own spec
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
        return false;
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
      return true;
    } catch (err) {
      setVolatilityError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    } finally {
      setIsGeneratingVolatility(false);
    }
  }, [
    tickerParam,
    volModel,
    garchEstimator,
    rangeEstimator,
    h,
    coverage,
    volWindow,
    garchVarianceTargeting,
    garchDf,
    harUseIntradayRv,
    rangeEwmaLambda,
    gbmWindow,
    gbmLambda,
    canonicalCount,
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

  const applyConformalPrediction = useCallback(async (): Promise<boolean> => {
    // Check validation gates first
    const canProceed = await checkGatesBeforeAction('conformal prediction');
    if (!canProceed) return false;

    // Ensure we have a base forecast to calibrate
    if (!baseForecast) {
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
          base_method: baseMethod,                      // Use selected base method
          horizon: h,                                   // Use current UI horizon
          coverage: selectedCoverage                    // Use current UI coverage
        }),
      });

      const data = await response.json();

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
                base_method: baseMethod,                      // Include base method in retry
                horizon: h,                                   // Include horizon in retry
                coverage: selectedCoverage                    // Include coverage in retry
              }),
            });
            
            const retryData = await retryResponse.json();
            
            if (!retryResponse.ok) {
              throw new Error(retryData.error || 'Failed to apply conformal prediction');
            }
            
            // Use retry data for building final forecast
            const finalData = retryData;
            
            // Build final conformal-adjusted forecast using retry data
            let finalForecast = baseForecast;
            
            // Compute conformal-adjusted bands if we have calibration data
            if (finalData.state?.q_cal !== undefined) {
              try {
                // Extract base bands
                const intervals = baseForecast.intervals || baseForecast.pi || baseForecast;
                const L_base = baseForecast.L_h || intervals.L_h || intervals.L1 || intervals.lower;
                const U_base = baseForecast.U_h || intervals.U_h || intervals.U1 || intervals.upper;
                
                if (L_base !== undefined && U_base !== undefined) {
                  // Compute conformal-adjusted bands in log space
                  const q_cal = finalData.state.q_cal;
                  const center_base = (L_base + U_base) / 2;
                  const yHat = Math.log(center_base);
                  const L_conf = Math.exp(yHat - q_cal);
                  const U_conf = Math.exp(yHat + q_cal);
                  
                  // Create final forecast with conformal bands
                  finalForecast = {
                    ...baseForecast,
                    intervals: {
                      ...intervals,
                      L_conf,
                      U_conf,
                      L_base,
                      U_base
                    },
                    conformal: {
                      q_cal,
                      mode: finalData.state.mode,
                      domain: finalData.state.domain
                    }
                  };
                  
                  console.log('[Conformal] Applied conformal bands:', { L_conf, U_conf });
                }
              } catch (error) {
                console.warn('[Conformal] Failed to compute conformal bands:', error);
                finalForecast = baseForecast; // Fall back to base forecast
              }
            }
            
            // Batch all state updates together to trigger single render
            setConformalState(finalData.state);
            setActiveForecast(finalForecast);
            setCurrentForecast(finalForecast); // Keep for legacy compatibility
            
            // Auto-expand coverage details after successful conformal calibration
            setShowCoverageDetails(true);
            
            console.log('[Conformal] Successfully applied conformal prediction with batched state updates');
            return true;
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

      // Build final conformal-adjusted forecast
      let finalForecast = baseForecast;
      
      // Compute conformal-adjusted bands if we have calibration data
      if (data.state?.q_cal !== undefined) {
        try {
          // Extract base bands
          const intervals = baseForecast.intervals || baseForecast.pi || baseForecast;
          const L_base = baseForecast.L_h || intervals.L_h || intervals.L1 || intervals.lower;
          const U_base = baseForecast.U_h || intervals.U_h || intervals.U1 || intervals.upper;
          
          if (L_base !== undefined && U_base !== undefined) {
            // Compute conformal-adjusted bands in log space
            const q_cal = data.state.q_cal;
            const center_base = (L_base + U_base) / 2;
            const yHat = Math.log(center_base);
            const L_conf = Math.exp(yHat - q_cal);
            const U_conf = Math.exp(yHat + q_cal);
            
            // Create final forecast with conformal bands
            finalForecast = {
              ...baseForecast,
              intervals: {
                ...intervals,
                L_conf,
                U_conf,
                L_base,
                U_base
              },
              conformal: {
                q_cal,
                mode: data.state.mode,
                domain: data.state.domain
              }
            };
            
            console.log('[Conformal] Applied conformal bands:', { L_conf, U_conf });
          }
        } catch (error) {
          console.warn('[Conformal] Failed to compute conformal bands:', error);
          finalForecast = baseForecast; // Fall back to base forecast
        }
      }
      
      // Batch all state updates together to trigger single render
      setConformalState(data.state);
      setActiveForecast(finalForecast);
      setCurrentForecast(finalForecast); // Keep for legacy compatibility

      // Auto-expand coverage details after successful conformal calibration
      setShowCoverageDetails(true);

      console.log('[Conformal] Successfully applied conformal prediction with batched state updates');
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
    checkGatesBeforeAction,
    h,
    coverage,
  ]);

  // Command 2: Add handleUnifiedGenerate orchestrator
  const handleUnifiedGenerate = useCallback(async () => {
    try {
      // 1) First generate/update volatility forecast (GBM / GARCH / HAR / Range)
      const volSuccess = await generateVolatilityForecast();
      if (!volSuccess) return;

      // Wait for the forecast to be loaded and active method to be updated
      await loadLatestForecast();

      // 2) Then ensure base forecasts exist for current method + cal window
      if (baseForecastCount !== null && baseForecastCount < conformalCalWindow) {
        const baseSuccess = await handleGenerateBaseForecasts();
        await loadBaseForecastCount();
        await loadModelLine();
        if (!baseSuccess) return;
      }

      // 3) Finally apply conformal calibration
      await applyConformalPrediction();
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

      // Clear stale state
      setBaseForecastsStale(true);
      setConformalStale(true);
      setCoverageStatsStale(true);
      setBaseForecastCount(null);
      setConformalState(null);

      console.log('[ForecastPipeline] Step 1: Generating volatility forecast');
      // 1) Generate volatility forecast for current volModel/estimator
      const volSuccess = await generateVolatilityForecast();
      if (!volSuccess) {
        setForecastStatus("error");
        return;
      }

      console.log('[ForecastPipeline] Step 2: Generating base forecasts');
      // 2) Generate / refresh base forecasts for conformal (if needed)
      const baseSuccess = await handleGenerateBaseForecasts();
      if (!baseSuccess) {
        setForecastStatus("error");
        return;
      }

      console.log('[ForecastPipeline] Step 3: Applying conformal prediction');
      // 3) Apply conformal prediction to build the final activeForecast
      const conformalSuccess = await applyConformalPrediction();
      if (!conformalSuccess) {
        setForecastStatus("error");
        return;
      }

      // Clear stale flags on success
      setBaseForecastsStale(false);
      setConformalStale(false);
      setCoverageStatsStale(false);

      console.log('[ForecastPipeline] Pipeline complete - setting status to ready');
      setForecastStatus("ready");
    } catch (error) {
      console.error('[ForecastPipeline] Pipeline error:', error);
      setForecastStatus("error");
      setForecastError(error instanceof Error ? error.message : 'Failed to complete forecast pipeline');
    }
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
  ]);

  // Handlers for explicit pipeline triggers
  const handleHorizonChange = useCallback((newH: number) => {
    setH(newH);
    if (!pipelineReady) return;
    runForecastPipeline(); // Trigger pipeline on horizon change
  }, [pipelineReady, runForecastPipeline]);

  const handleCoverageChange = useCallback((newCoverage: number) => {
    setCoverage(newCoverage);
    if (!pipelineReady) return;
    runForecastPipeline(); // Trigger pipeline on coverage change
  }, [pipelineReady, runForecastPipeline]);

  const handleModelChange = useCallback((newModel: 'GBM' | 'GARCH' | 'HAR-RV' | 'Range') => {
    setVolModel(newModel);
    if (!pipelineReady) return;
    runForecastPipeline(); // Trigger pipeline on model change
  }, [pipelineReady, runForecastPipeline]);

  const handleEstimatorChange = useCallback((newEstimator: 'P' | 'GK' | 'RS' | 'YZ') => {
    setRangeEstimator(newEstimator);
    if (!pipelineReady) return;
    runForecastPipeline(); // Trigger pipeline on estimator change
  }, [pipelineReady, runForecastPipeline]);

  const handleGarchEstimatorChange = useCallback((newEstimator: 'Normal' | 'Student-t') => {
    setGarchEstimator(newEstimator);
    if (!pipelineReady) return;
    runForecastPipeline(); // Trigger pipeline on GARCH estimator change
  }, [pipelineReady, runForecastPipeline]);

  // Override the early handleApplyBestModel with the proper implementation that calls the pipeline
  const handleApplyBestModelWithPipeline = useCallback(() => {
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
    
    // Run pipeline only when prerequisites are satisfied
    if (!pipelineReady) return;
    runForecastPipeline();
  }, [recommendedModel, pipelineReady, runForecastPipeline]);

  // Override the early onGenerateBaseForecastsClick with the proper implementation
  const onGenerateBaseForecastsClickWithPipeline = useCallback(async () => {
    // Only proceed if there are no base forecasts available (0 or null)
    if (baseForecastCount !== null && baseForecastCount > 0) {
      console.log('[BaseForecasts] Skipping generation - base forecasts already exist:', baseForecastCount);
      return;
    }
    
    // Guard with pipeline readiness to avoid false errors
    if (!pipelineReady) {
      console.log('[BaseForecasts] Skipping - pipeline not ready');
      return;
    }
    
    console.log('[BaseForecasts] Triggering full pipeline - no forecasts available');
    await runForecastPipeline();
  }, [baseForecastCount, pipelineReady, runForecastPipeline]);

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

  // Auto-save function for horizon and coverage changes
  const autoSaveTargetSpec = async () => {
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
  };

  // Validation
  const isValidH = h >= 1;
  const isValidCoverage = coverage > 0.50 && coverage <= 0.995;
  
  // Compute resolved TZ for Forecast Target save
  const canonicalTZ = uploadResult?.meta?.exchange_tz ?? null;
  const selectedExchange = null; // TODO: Add company state for this
  const resolvedTZ = resolveExchangeTZ({ canonicalTZ, selectedExchange });
  
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
  }, [h, coverage, resolvedTZ, isValidH, isValidCoverage]);

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

  return (
    <div className={`w-full px-[5%] py-6 ${
      isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'
    }`}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className={`text-3xl font-bold ${
            isDarkMode ? 'text-white' : 'text-gray-900'
          }`}>{companyName || companyTicker}</h1>
          <p className={`text-xl ${
            isDarkMode ? 'text-gray-300' : 'text-gray-600'
          }`}>{companyTicker} · {companyExchange}</p>
        </div>
        <div className="flex items-center gap-3">
          {watchlistSuccess && (
            <span className={`text-sm font-medium ${
              isDarkMode ? 'text-green-400' : 'text-green-600'
            }`}>
              ✓ Added to Watchlist
            </span>
          )}
          <button
            onClick={() => setShowUploadModal(true)}
            className={`flex items-center justify-center w-9 h-9 font-medium rounded-full shadow-sm transition-all duration-200 border-2 ${
              isDarkMode 
                ? 'bg-gray-800 hover:bg-gray-700 text-white hover:text-gray-300 border-gray-600 hover:border-gray-500'
                : 'bg-white hover:bg-gray-50 text-black hover:text-gray-700 border-black hover:border-gray-700'
            }`}
            title="Upload Data"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </button>
          <button
            onClick={() => setShowDataQualityModal(true)}
            className={`flex items-center justify-center w-9 h-9 rounded-full shadow-sm transition-all duration-200 border-2 ${
              isDarkMode 
                ? 'bg-gray-800 hover:bg-gray-700 text-white hover:text-gray-300 border-gray-600 hover:border-gray-500'
                : 'bg-white hover:bg-gray-50 text-black hover:text-gray-700 border-black hover:border-gray-700'
            }`}
            title="Data Quality Information"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </button>
          <button
            onClick={addToWatchlist}
            disabled={isAddingToWatchlist || isInWatchlist}
            className={`flex items-center justify-center w-9 h-9 font-medium rounded-full shadow-sm transition-all duration-200 border-2 ${
              isInWatchlist 
                ? isDarkMode
                  ? 'bg-gray-800 text-white border-gray-600 cursor-default'
                  : 'bg-white text-black border-black cursor-default'
                : isDarkMode
                  ? 'bg-gray-800 hover:bg-gray-700 text-white hover:text-gray-300 border-gray-600 hover:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none'
                  : 'bg-white hover:bg-gray-50 text-black hover:text-gray-700 border-black hover:border-gray-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none'
            }`}
            title={isInWatchlist ? 'Already in Watchlist' : 'Add to Watchlist'}
          >
            <span className="text-xl font-bold">{isInWatchlist ? '✓' : '+'}</span>
          </button>
        </div>
      </div>
      
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
          
          {/* Row 1: Horizon and Coverage Controls - Side by Side */}
          <div className="mb-6 grid grid-cols-2 gap-6">
            {/* Column 1: Horizon Controls */}
              <div>
                <label className={`block text-sm font-medium mb-3 ${
                  isDarkMode ? 'text-gray-200' : 'text-gray-700'
                }`}>Horizon {(isGeneratingBase || isApplyingConformal) && (
                  <span className="text-xs text-blue-600 font-normal">(Recomputing bands...)</span>
                )}</label>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 5].map((days) => (
                    <button
                      key={days}
                      onClick={() => handleHorizonChange(days)}
                      disabled={forecastStatus === "loading"}
                      className={`px-3 py-1 text-sm rounded-full transition-colors ${
                        h === days 
                          ? 'bg-blue-600 text-white' 
                          : (forecastStatus === "loading")
                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                            : isDarkMode 
                              ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {days}D
                    </button>
                  ))}
                </div>
              </div>

              {/* Column 2: Coverage Controls */}
              <div>
                <label className={`block text-sm font-medium mb-3 ${
                  isDarkMode ? 'text-gray-200' : 'text-gray-700'
                }`}>Coverage {(isGeneratingBase || isApplyingConformal) && (
                  <span className="text-xs text-blue-600 font-normal">(Recomputing bands...)</span>
                )}</label>
                <div className="flex items-center gap-2">
                  {[0.90, 0.95, 0.99].map((cov) => (
                    <button
                      key={cov}
                      onClick={() => handleCoverageChange(cov)}
                      disabled={forecastStatus === "loading"}
                      className={`px-3 py-1 text-sm rounded-full transition-colors ${
                        coverage === cov 
                          ? 'bg-blue-600 text-white' 
                          : (forecastStatus === "loading")
                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                            : isDarkMode 
                              ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {(cov * 100).toFixed(0)}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Row 2: Volatility Model Section */}
            <div className="mb-6">
              <h4 className={`text-xl font-semibold mb-3 ${
                isDarkMode ? 'text-gray-200' : 'text-gray-800'
              }`}>Volatility Model</h4>
              
              {/* Model Selection */}
              <div className="mb-4">
                <label className={`block text-sm font-medium mb-2 ${
                  isDarkMode ? 'text-gray-200' : 'text-gray-700'
                }`}>Model:</label>
                <div className="flex gap-2 flex-wrap items-center">
                  {['GBM', 'GARCH', 'HAR-RV', 'Range'].map((model) => (
                    <button
                      key={model}
                      onClick={() => handleModelChange(model as any)}
                      className={`px-4 py-2 text-sm rounded-full ${
                        volModel === model 
                          ? 'bg-blue-600 text-white' 
                          : isDarkMode 
                            ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {model === 'GBM' ? 'GBM' : model === 'GARCH' ? 'GARCH (1,1)' : model}
                    </button>
                  ))}
                  
                  {/* (Best) Button */}
                  <button
                    onClick={handleApplyBestModelWithPipeline}
                    disabled={!recommendedModel || isLoadingRecommendations}
                    className={`px-4 py-2 text-sm rounded-full border-2 border-dashed ml-2 transition-all ${
                      !recommendedModel || isLoadingRecommendations
                        ? isDarkMode 
                          ? 'border-gray-600 text-gray-500 cursor-not-allowed opacity-50'
                          : 'border-gray-300 text-gray-400 cursor-not-allowed opacity-50'
                        : isDarkMode
                          ? 'border-emerald-500 text-emerald-400 hover:bg-emerald-500 hover:text-white'
                          : 'border-emerald-600 text-emerald-600 hover:bg-emerald-600 hover:text-white'
                    }`}
                    title={
                      isLoadingRecommendations 
                        ? "Loading recommendation..." 
                        : !recommendedModel 
                          ? "No recommendation available"
                          : `Apply recommended model: ${recommendedModel}`
                    }
                  >
                    {isLoadingRecommendations ? 'Loading...' : '(Best)'}
                  </button>

                  {/* Info Button */}
                  <button
                    onClick={() => setIsModelInfoOpen(true)}
                    disabled={!modelScores || isLoadingRecommendations}
                    className={`p-2 text-sm rounded-full transition-all ${
                      !modelScores || isLoadingRecommendations
                        ? isDarkMode 
                          ? 'text-gray-500 cursor-not-allowed opacity-50'
                          : 'text-gray-400 cursor-not-allowed opacity-50'
                        : isDarkMode
                          ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                    }`}
                    title="Why is this the best?"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10"/>
                      <path d="M9,9h0a3,3,0,0,1,5.12,2.12,3,3,0,0,1-1.7,2.72A1.16,1.16,0,0,0,12,15.09"/>
                      <circle cx="12" cy="18.75" r="0.75"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* Model-Specific Parameters */}
              {(volModel === 'GARCH' || volModel === 'Range') && (
                <div className="mb-4 grid grid-cols-2 gap-4">
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${
                      isDarkMode ? 'text-gray-200' : 'text-gray-700'
                    }`}>
                      {volModel === 'GARCH' ? 'Distribution:' : 'Estimator:'}
                    </label>
                    {volModel === 'GARCH' ? (
                      <select 
                        value={garchEstimator} 
                        onChange={(e) => handleGarchEstimatorChange(e.target.value as any)}
                        className={`w-full p-2 border rounded-md ${
                          isDarkMode 
                            ? 'bg-gray-700 border-gray-600 text-white' 
                            : 'bg-white border-gray-300 text-gray-900'
                        }`}
                      >
                        <option value="Normal">Normal</option>
                        <option value="Student-t">Student-t</option>
                      </select>
                    ) : (
                      <select 
                        value={rangeEstimator} 
                        onChange={(e) => handleEstimatorChange(e.target.value as any)}
                        className={`w-full p-2 border rounded-md ${
                          isDarkMode 
                            ? 'bg-gray-700 border-gray-600 text-white' 
                            : 'bg-white border-gray-300 text-gray-900'
                        }`}
                      >
                        <option value="P">Parkinson</option>
                        <option value="GK">Garman-Klass</option>
                        <option value="RS">Rogers-Satchell</option>
                        <option value="YZ">Yang-Zhang</option>
                      </select>
                    )}
                  </div>
                  {volModel === 'GARCH' && garchEstimator === 'Student-t' && (
                    <div>
                      <label className={`block text-sm font-medium mb-2 ${
                        isDarkMode ? 'text-gray-200' : 'text-gray-700'
                      }`}>Degrees of freedom:</label>
                      <input 
                        type="number" 
                        value={garchDf} 
                        onChange={(e) => setGarchDf(Number(e.target.value))}
                        className={`w-full p-2 border rounded-md ${
                          isDarkMode 
                            ? 'bg-gray-700 border-gray-600 text-white' 
                            : 'bg-white border-gray-300 text-gray-900'
                        }`}
                        min="3"
                        step="1"
                      />
                    </div>
                  )}
                  {volModel === 'Range' && (
                    <div>
                      <label className={`block text-sm font-medium mb-2 ${
                        isDarkMode ? 'text-gray-200' : 'text-gray-700'
                      }`}>EWMA λ:</label>
                      <input 
                        type="number" 
                        value={rangeEwmaLambda} 
                        onChange={(e) => setRangeEwmaLambda(Number(e.target.value))}
                        className={`w-full p-2 border rounded-md ${
                          isDarkMode 
                            ? 'bg-gray-700 border-gray-600 text-white' 
                            : 'bg-white border-gray-300 text-gray-900'
                        }`}
                        min="0.01"
                        max="0.99"
                        step="0.01"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Window Control */}
              <div className="mb-4">
                <label className={`block text-sm font-medium mb-2 ${
                  isDarkMode ? 'text-gray-200' : 'text-gray-700'
                }`}>Window size:</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={volModel === 'GBM' ? gbmWindow : volWindow}
                    onChange={(e) => {
                      const value = parseInt(e.target.value);
                      if (volModel === 'GBM') {
                        setGbmWindow(value);
                      } else {
                        setVolWindow(value);
                      }
                    }}
                    className={`flex-1 px-3 py-2 border rounded-full focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                      isDarkMode 
                        ? 'bg-gray-700 border-gray-600 text-white' 
                        : 'bg-white border-gray-300 text-gray-900'
                    }`}
                    min="1"
                    max="5000"
                  />
                  <button
                    onClick={() => {
                      if (volModel === 'GBM') {
                        setGbmWindow(504);
                      } else {
                        setVolWindow(1000);
                      }
                    }}
                    className={`px-3 py-1 text-sm rounded-full ${
                      isDarkMode 
                        ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                    title="Reset to default"
                  >
                    Reset
                  </button>
                </div>
              </div>

              {/* Error Display */}
              {volatilityError && (
                <p className={`text-sm mb-4 ${
                  isDarkMode ? 'text-red-400' : 'text-red-600'
                }`}>{volatilityError}</p>
              )}
            </div>

            {/* Row 3: Conformal Section */}
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
                  <select 
                    value={conformalCalWindow} 
                    onChange={(e) => setConformalCalWindow(Number(e.target.value))}
                    className={`w-full p-2 border rounded-full ${
                      isDarkMode 
                        ? 'bg-gray-700 border-gray-600 text-white' 
                        : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  >
                    <option value={60}>60 days</option>
                    <option value={125}>125 days</option>
                    <option value={250}>250 days</option>
                    <option value={500}>500 days</option>
                  </select>
                </div>
                
                {/* Generate button as fourth column */}
                <div>
                  <label className={`block text-sm font-medium mb-2 ${
                    isDarkMode ? 'text-gray-200' : 'text-gray-700'
                  }`}>&nbsp;</label>
                  <button
                    onClick={onGenerateBaseForecastsClickWithPipeline}
                    disabled={isGeneratingBase || (baseForecastCount !== null && baseForecastCount > 0)}
                    className={`w-full px-3 py-2 text-sm rounded-full border transition-colors ${
                      isGeneratingBase || (baseForecastCount !== null && baseForecastCount > 0)
                        ? 'bg-gray-100 text-gray-400 border-gray-300 cursor-not-allowed'
                        : isDarkMode 
                          ? 'bg-gray-700 hover:bg-gray-600 text-gray-200 border-gray-600' 
                          : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-300'
                    }`}
                  >
                    {isGeneratingBase 
                      ? `Generating ${conformalCalWindow}-day forecasts...`
                      : (baseForecastCount !== null && baseForecastCount > 0)
                        ? `${baseForecastCount} forecasts available`
                        : `Generate ${conformalCalWindow}-day base forecasts`
                    }
                  </button>
                </div>
              </div>
              
              {/* Base forecast status below the grid */}
              {baseForecastCount !== null && (
                <div className="mb-4 flex items-center gap-2">
                  <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    {baseForecastCount >= conformalCalWindow 
                      ? `✓ ${baseForecastCount} base forecasts available`
                      : `${baseForecastCount} of ${conformalCalWindow} needed`
                    }
                  </p>
                  {baseForecastsStale && (
                    <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full">
                      Stale
                    </span>
                  )}
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
                  
                  {/* Coverage Metrics Grid - 4 Columns */}
                  <div className="grid grid-cols-4 gap-4 mb-4">
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
                      <div className="bg-blue-50 p-3 rounded-full">
                        <div className="text-xs font-medium text-gray-700 mb-2">Calibrated Parameters</div>
                        <div className="text-sm font-mono text-blue-900">
                          q_cal = {conformalState.params.q_cal?.toFixed(6) || 'N/A'}
                        </div>
                        {conformalState.params.alpha && (
                          <div className="text-xs text-gray-600 mt-1">
                            α = {conformalState.params.alpha.toFixed(6)}
                          </div>
                        )}
                        {conformalState.params.delta_L !== undefined && conformalState.params.delta_U !== undefined && (
                          <div className="text-xs text-gray-600 mt-1">
                            δ_L = {conformalState.params.delta_L?.toFixed(6) || 'N/A'}
                          </div>
                        )}
                        {conformalState.params.theta && (
                          <div className="text-xs text-gray-600 mt-1">
                            θ = {conformalState.params.theta.toFixed(6)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="bg-gray-50 p-3 rounded-full text-center">
                        <div className="text-sm text-gray-500">No calibration</div>
                        <div className="text-xs text-gray-400">pending</div>
                      </div>
                    )}
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
                      <h6 className="text-sm font-medium text-gray-700 mb-2">
                        Miss Details ({conformalState.coverage.miss_count} misses)
                      </h6>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border border-gray-200 rounded">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-2 py-1 text-left border-b">Date</th>
                              <th className="px-2 py-1 text-right border-b">Realized</th>
                              <th className="px-2 py-1 text-right border-b">Predicted</th>
                              <th className="px-2 py-1 text-right border-b">L_base</th>
                              <th className="px-2 py-1 text-right border-b">U_base</th>
                              <th className="px-2 py-1 text-center border-b">Type</th>
                              <th className="px-2 py-1 text-right border-b">Magnitude</th>
                            </tr>
                          </thead>
                          <tbody>
                            {conformalState.coverage.miss_details.map((miss: any, idx: number) => (
                              <tr key={`${miss.date}-${idx}`} className="border-b border-gray-100">
                                <td className="px-2 py-1 text-gray-700">{miss.date}</td>
                                <td className="px-2 py-1 text-right font-mono">{miss.realized?.toFixed(4)}</td>
                                <td className="px-2 py-1 text-right font-mono">{miss.y_pred?.toFixed(4)}</td>
                                <td className="px-2 py-1 text-right font-mono text-blue-600">{miss.L_base?.toFixed(4)}</td>
                                <td className="px-2 py-1 text-right font-mono text-blue-600">{miss.U_base?.toFixed(4)}</td>
                                <td className="px-2 py-1 text-center">
                                  <span className={`${miss.miss_type === 'above' ? 'text-red-500' : 'text-orange-500'}`}>
                                    {miss.miss_type === 'above' ? '↑' : '↓'}
                                  </span>
                                </td>
                                <td className="px-2 py-1 text-right font-mono">{miss.miss_magnitude?.toFixed(4)}</td>
                              </tr>
                            ))}
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



            {/* Status Messages */}
            {!targetSpecResult && (
              <p className={`text-sm text-center mt-4 ${
                isDarkMode ? 'text-gray-400' : 'text-gray-500'
              }`}>Please save target specification first</p>
            )}
          </div>
        </div>

      {/* Price Chart Section */}
      <PriceChart 
        symbol={params.ticker} 
        className="mb-8" 
        activeForecast={activeForecast}
        gbmForecast={gbmForecast}
        conformalState={conformalState}
        horizon={h}
        coverage={coverage}
        recommendedModel={recommendedModel}
        isLoadingRecommendations={isLoadingRecommendations}
        forecastStatus={forecastStatus}
      />
      
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
      
      {/* Breakout Card */}
      <div className="mb-8 p-6 border rounded-lg bg-white shadow-sm" data-testid="card-breakout">
        <h2 className="text-xl font-semibold mb-4">Breakout Detection</h2>
        
        {/* Controls */}
        <div className="mb-6 space-y-3">
          <div className="flex gap-3">
            <button
              onClick={detectBreakoutToday}
              disabled={isDetectingBreakout}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            >
              {isDetectingBreakout ? 'Detecting...' : 'Detect Today'}
            </button>
            
            <div className="flex gap-2 items-center">
              <input
                type="date"
                value={breakoutDetectDate}
                onChange={(e) => setBreakoutDetectDate(e.target.value)}
                className="px-3 py-2 border rounded"
              />
              <button
                onClick={detectBreakoutForDate}
                disabled={isDetectingBreakout || !breakoutDetectDate}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                Detect for Date
              </button>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {breakoutError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700">
            {breakoutError}
          </div>
        )}

        {/* Event Display */}
        {latestEvent ? (
          <div className="space-y-4">
            {/* Direction and Basic Info */}
            <div className="p-4 bg-red-50 border border-red-200 rounded-md">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">
                  {latestEvent.direction === 1 ? '↑' : '↓'}
                </span>
                <div>
                  <div className="font-semibold">
                    Breakout {latestEvent.direction === 1 ? 'Up' : 'Down'}
                  </div>
                  <div className="text-sm text-gray-600">
                    {latestEvent.t_date} → {latestEvent.B_date}
                  </div>
                </div>
                {latestEvent.event_open && (
                  <span className="ml-auto px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full">
                    OPEN
                  </span>
                )}
              </div>
            </div>

            {/* Magnitude Chips */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gray-50 p-3 rounded text-center">
                <div className="text-xs text-gray-600">z_B</div>
                <div className="font-mono text-lg">{latestEvent.z_B.toFixed(3)}</div>
              </div>
              <div className="bg-gray-50 p-3 rounded text-center">
                <div className="text-xs text-gray-600">z_excess_B</div>
                <div className="font-mono text-lg">{latestEvent.z_excess_B.toFixed(3)}</div>
              </div>
              <div className="bg-gray-50 p-3 rounded text-center">
                <div className="text-xs text-gray-600">% Outside</div>
                <div className="font-mono text-lg">{(latestEvent.pct_outside_B * 100).toFixed(1)}%</div>
              </div>
              <div className="bg-gray-50 p-3 rounded text-center">
                <div className="text-xs text-gray-600">ndist_B</div>
                <div className="font-mono text-lg">{latestEvent.ndist_B.toFixed(3)}</div>
              </div>
            </div>

            {/* Vol Regime */}
            {latestEvent.vol_regime_percentile !== null && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                <div className="text-sm font-medium text-blue-800">
                  Vol Regime: {(latestEvent.vol_regime_percentile * 100).toFixed(0)}th percentile
                </div>
              </div>
            )}

            {/* Provenance */}
            <div className="p-3 bg-gray-50 rounded-md">
              <div className="text-sm space-y-1">
                <div>
                  <strong>Method:</strong> {latestEvent.method_provenance.base_method}
                  {latestEvent.method_provenance.conformal_mode && ` + Conformal:${latestEvent.method_provenance.conformal_mode}`}
                </div>
                <div>
                  <strong>Coverage:</strong> {(latestEvent.method_provenance.coverage_nominal * 100).toFixed(1)}%
                </div>
                <div>
                  <strong>Critical:</strong> {latestEvent.method_provenance.critical.type} = {latestEvent.method_provenance.critical.value.toFixed(3)}
                  {latestEvent.method_provenance.critical.df && ` (df=${latestEvent.method_provenance.critical.df})`}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-green-50 border border-green-200 rounded-md text-green-700">
            No breakout detected (price inside band)
          </div>
        )}

        {/* Cool-down Status */}
        {cooldownStatus && (
          <div className="mt-4 p-3 bg-gray-50 rounded-md">
            <div className="text-sm">
              <strong>Cool-down (K_inside=3):</strong> {cooldownStatus.ok ? '✅ Pass' : '❌ Fail'}
              {cooldownStatus.reason && ` (${cooldownStatus.reason})`}
              <div className="text-xs text-gray-600 mt-1">
                Consecutive in-band days: {cooldownStatus.inside_count}
              </div>
            </div>
          </div>
        )}

        {/* Formulas Tooltip */}
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-blue-600 hover:text-blue-800">
            📖 Formulas & Rules
          </summary>
          <div className="mt-2 p-3 bg-gray-50 rounded text-xs space-y-1">
            <div><strong>outside_1d</strong> = (S_t+1 &lt; L_1) OR (S_t+1 &gt; U_1)</div>
            <div><strong>z_B</strong> = [ ln(S_t+1) − ( ln(S_t) + mu_star_used ) ] / s_t</div>
            <div><strong>z_excess_B</strong> = |z_B| − c</div>
            <div><strong>pct_outside_B</strong> = (L_1 − S_t+1)/L_1 (down) OR (S_t+1 − U_1)/U_1 (up)</div>
            <div><strong>ndist_B</strong> = | ln(S_t+1) − m_t(1) | / (c * s_t)</div>
            <div><strong>vol_regime_percentile</strong> = Percentile( σ_t+1|t vs trailing 3y )</div>
            <div><strong>Cool-down:</strong> K_inside = 3 in-band days required before a new event.</div>
          </div>
        </details>
      </div>

      {/* Continuation Clock Card */}
      <div className="mb-8 p-6 border rounded-lg bg-white shadow-sm" data-testid="card-continuation-clock">
        <h2 className="text-xl font-semibold mb-4">Continuation Clock</h2>
        
        {/* Controls */}
        <div className="mb-6 space-y-4">
          {/* Stop Rule */}
          <div>
            <label className="block text-sm font-medium mb-2">Stop Rule</label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  name="stopRule"
                  value="re-entry"
                  checked={stopRule === 're-entry'}
                  onChange={(e) => setStopRule(e.target.value as 're-entry')}
                  className="mr-2"
                />
                Re-entry (recommended)
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  name="stopRule"
                  value="sign-flip"
                  checked={stopRule === 'sign-flip'}
                  onChange={(e) => setStopRule(e.target.value as 'sign-flip')}
                  className="mr-2"
                />
                Sign-flip
              </label>
            </div>
          </div>

          {/* k_inside selector (only for re-entry) */}
          {stopRule === 're-entry' && (
            <div>
              <label className="block text-sm font-medium mb-2">k_inside</label>
              <select
                value={kInside}
                onChange={(e) => setKInside(Number(e.target.value) as 1 | 2)}
                className="px-3 py-2 border rounded"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </div>
          )}

          {/* T_max */}
          <div>
            <label className="block text-sm font-medium mb-2">T_max</label>
            <input
              type="number"
              min="1"
              max="100"
              value={tMax}
              onChange={(e) => setTMax(Number(e.target.value))}
              className="px-3 py-2 border rounded w-20"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={tickToday}
              disabled={isTicking}
              className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
            >
              {isTicking ? 'Ticking...' : 'Tick Today'}
            </button>
            
            <div className="flex gap-2 items-center">
              <input
                type="date"
                value={tickDate}
                onChange={(e) => setTickDate(e.target.value)}
                className="px-3 py-2 border rounded"
              />
              <button
                onClick={tickForDate}
                disabled={isTicking || !tickDate}
                className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
              >
                Tick Date
              </button>
            </div>

            <button
              onClick={rescanFromB}
              disabled={isTicking || !latestEvent}
              className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
            >
              Rescan from B
            </button>
          </div>
        </div>

        {/* Error Display */}
        {continuationError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700">
            {continuationError}
          </div>
        )}

        {/* Last Action */}
        {lastContinuationAction && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-blue-700">
            Last action: {lastContinuationAction}
          </div>
        )}

        {/* Event Status Display */}
        {latestEvent ? (
          <div className="space-y-4">
            {latestEvent.event_open ? (
              // Open Event
              <div className="p-4 bg-orange-50 border border-orange-200 rounded-md">
                <div className="font-semibold text-orange-800 mb-2">Event Open - Continuing</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="font-medium">T so far</div>
                    <div className="font-mono text-lg">{latestEvent.at_risk_days || 0}</div>
                  </div>
                  {stopRule === 're-entry' && (
                    <div>
                      <div className="font-medium">In-band streak</div>
                      <div className="font-mono text-lg">{latestEvent.inband_streak || 0}</div>
                    </div>
                  )}
                  <div>
                    <div className="font-medium">Max z_excess</div>
                    <div className="font-mono text-lg">{latestEvent.max_z_excess?.toFixed(3) || '0.000'}</div>
                  </div>
                  <div>
                    <div className="font-medium">Stop Rule</div>
                    <div className="text-sm">{latestEvent.stop_rule || 'Not set'}</div>
                  </div>
                </div>
              </div>
            ) : (
              // Closed Event
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
                <div className="font-semibold text-gray-800 mb-2">
                  Event {latestEvent.censored ? 'Censored' : 'Stopped'}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
                  <div>
                    <div className="font-medium">T</div>
                    <div className="font-mono text-lg">{latestEvent.T || 0}</div>
                  </div>
                  <div>
                    <div className="font-medium">D_stop</div>
                    <div className="font-mono">{latestEvent.D_stop || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="font-medium">Censored</div>
                    <div>{latestEvent.censored ? '✅ Yes' : '❌ No'}</div>
                  </div>
                  <div>
                    <div className="font-medium">Reason</div>
                    <div className="text-xs">{latestEvent.censor_reason || 'Reverted'}</div>
                  </div>
                </div>
                
                {/* KM Tuple */}
                <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                  <div className="font-medium text-blue-800 mb-1">KM Tuple</div>
                  <div className="font-mono text-sm">
                    time_i = {latestEvent.T || 0} ; status_i = {latestEvent.censored ? 0 : 1}
                  </div>
                  <div className="text-xs text-blue-600 mt-1">
                    (1 if reverted, 0 if censored)
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-md text-gray-700">
            No event to track
          </div>
        )}

        {/* Note */}
        <div className="mt-4 p-2 bg-gray-50 rounded text-xs text-gray-600">
          Non-trading days do not increment T; missing data pauses.
        </div>

        {/* Formulas Tooltip */}
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-blue-600 hover:text-blue-800">
            📖 Stop Rules & Formulas
          </summary>
          <div className="mt-2 p-3 bg-gray-50 rounded text-xs space-y-1">
            <div><strong>Stop Rule A (re-entry):</strong> S_D ∈ [L_1(D−1), U_1(D−1)] → T = j − k_inside</div>
            <div><strong>Stop Rule B (sign-flip):</strong> sign( ln(S_D/S_D−1) ) = −d → T = j − 1</div>
            <div><strong>Right-censor:</strong> j hits T_max (Type-I) or end_of_sample</div>
            <div><strong>KM tuple:</strong> time_i = T ; status_i = 1 if reverted else 0</div>
          </div>
        </details>
      </div>



      {/* QA Testing Panel */}
      <QAPanel className="mb-8" />

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