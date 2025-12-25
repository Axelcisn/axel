"use client";

import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import {
  ResponsiveContainer,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Bar,
  Cell,
  ComposedChart,
  CartesianGrid,
  ReferenceLine,
  ReferenceDot,
  Line,
} from "recharts";
import { useDarkMode } from "@/lib/hooks/useDarkMode";
import {
  sliceByRange,
  calculateRangePerformance,
  type PriceRange,
} from "@/lib/chart/ranges";
import type { CanonicalRow } from "@/lib/types/canonical";
import { getNextTradingDates, generateFutureTradingDates } from "@/lib/chart/tradingDays";
import { TradeDetailCard, type TradeDetailData } from "@/components/TradeDetailCard";
import type { Trading212AccountSnapshot } from "@/lib/backtest/trading212Cfd";
import { applyActivityMaskToEquitySeries, computeTradeActivityWindow } from "@/lib/backtest/equityActivity";
import type { MomentumScorePoint } from "@/lib/indicators/momentum";
import type { AdxPoint } from "@/lib/indicators/adx";
import type { EwmaPoint } from "@/lib/indicators/ewmaCrossover";

const SYNC_ID = "timing-sync";
const CHART_MARGIN = { top: 8, right: 0, left: 0, bottom: 0 };
const Y_AXIS_WIDTH = 56;
const TOOLTIP_CLASS =
  "rounded-xl border shadow-2xl backdrop-blur-xl bg-slate-800/40 border-slate-600/30 text-slate-100 px-3 py-2.5";
const TOOLTIP_TITLE_CLASS = "text-slate-100 font-semibold";
const TOOLTIP_MUTED_CLASS = "text-slate-300";
const TOOLTIP_HEADER_PADDING = "px-3 py-2";
const TOOLTIP_SECTION_PADDING = "px-3 py-2.5";
const TOOLTIP_COLUMN_CLASS = `${TOOLTIP_SECTION_PADDING} flex-1 min-w-[140px]`;
const TOOLTIP_VALUE_CLASS = "font-mono tabular-nums text-right";
const TOOLTIP_ROW_GAP = "gap-2.5";
const TOOLTIP_ROW_GAP_WIDE = "gap-3";
const RENDER_WARN_LIMIT = 100;

const getBarSizing = (n: number) => {
  // Fill the available category width; zero gap for full-width bars
  return { barCategoryGap: "0%", barGap: 0, maxBarSize: undefined as number | undefined };
};

const CalendarRangeIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
    <rect x="3" y="5" width="18" height="16" rx="2" ry="2" strokeWidth="1.5" />
    <path d="M3 10h18" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M8 3v4" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M16 3v4" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const ChevronDownIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
    <path
      d="M6 9l6 6 6-6"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CheckIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
    <path
      d="M5 13l4 4L19 7"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

type PricePoint = {
  date: string;
  adj_close: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
};

interface ChartPoint {
  date: string;
  value: number | null;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  volumeColor?: string;
  volumeStroke?: string;
  isFuture?: boolean;
  momentumScore?: number;
  adxValue?: number;
  equity?: number | null;
  equityDelta?: number | null;
  selectedPnl?: number | null;
  selectedEquity?: number | null;
  selectedSide?: Trading212AccountSnapshot["side"] | null;
  selectedContracts?: number | null;
  // Forecast band values
  forecastCenter?: number | null;
  forecastLower?: number | null;
  forecastUpper?: number | null;
  forecastBand?: number | null;  // Band width (Upper - Lower) for stacked area rendering
  forecastModelName?: string | null;
  forecastModelMethod?: string | null;
  forecastWindowN?: number | null;
  // GBM parameters
  forecastMuStar?: number | null;
  forecastSigma?: number | null;
  // GARCH parameters
  forecastOmega?: number | null;
  forecastAlpha?: number | null;
  forecastBeta?: number | null;
  forecastAlphaPlusBeta?: number | null;
  forecastUncondVar?: number | null;
  forecastGarchDistribution?: string | null;

  // Trend overlays (simple EWMA pair)
  trendEwmaShort?: number | null;
  trendEwmaLong?: number | null;
};

export interface TrendEwmaPoint {
  date: string;
  value: number;
}

export interface TrendEwmaSignal {
  date: string;
  type: "bullish" | "bearish";
}

const TREND_EWMA_SHORT_COLOR = "#facc15"; // amber/yellow
const TREND_EWMA_LONG_COLOR = "#3b82f6";  // blue

/**
 * Normalize a date-like string into YYYY-MM-DD to keep chart + overlay data aligned.
 */
const normalizeDateString = (value: string): string => {
  if (!value) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString().split("T")[0];
};

interface ForecastOverlayProps {
  activeForecast?: any | null;
  volModel?: string;
  coverage?: number;
  conformalState?: any | null;
}

type VolModel = 'GBM' | 'GARCH' | 'HAR-RV' | 'Range';
type GarchEstimator = 'Normal' | 'Student-t';
type RangeEstimator = 'P' | 'GK' | 'RS' | 'YZ';
export type DateRangePreset =
  | "chart"
  | "1d"
  | "5d"
  | "1m"
  | "3m"
  | "6m"
  | "ytd"
  | "1y"
  | "5y"
  | "all"
  | "custom";
export type SimCompareRangePreset =
  | "chart"
  | "1d"
  | "5d"
  | "1m"
  | "3m"
  | "6m"
  | "ytd"
  | "1y"
  | "5y"
  | "all"
  | "custom";

interface RecommendedModelInfo {
  volModel: VolModel;
  garchEstimator?: GarchEstimator;
  rangeEstimator?: RangeEstimator;
}

interface HorizonCoverageProps {
  h: number;
  coverage: number;
  onHorizonChange: (days: number) => void;
  onCoverageChange: (cov: number) => void;
  isLoading?: boolean;
  volModel?: VolModel;
  onModelChange?: (model: VolModel) => void;
  // GARCH options
  garchEstimator?: GarchEstimator;
  onGarchEstimatorChange?: (est: GarchEstimator) => void;
  // Range options
  rangeEstimator?: RangeEstimator;
  onRangeEstimatorChange?: (est: RangeEstimator) => void;
  // Recommended model (for green highlight + star)
  recommendedModel?: RecommendedModelInfo | null;
  // Model parameters
  windowSize?: number;
  onWindowSizeChange?: (size: number) => void;
  degreesOfFreedom?: number;
  onDegreesOfFreedomChange?: (df: number) => void;
  // GBM parameters
  gbmLambda?: number;
  onGbmLambdaChange?: (lambda: number) => void;
}

/** Trade information from Trading212 simulation */
export interface Trading212TradeInfo {
  entryDate: string;
  exitDate: string;
  side: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  netPnl: number;
  quantity: number;
  margin: number;  // exact margin used for this position (from engine)
  swapFees?: number;  // overnight swap fees for this trade
  grossPnl?: number;  // gross P&L before fees
  signal?: string;  // optional strategy signal label
  runUp?: number;  // optional max favorable excursion in currency
  drawdown?: number;  // optional max adverse excursion in currency (positive number)
}

/** Trade overlay for chart visualization */
export interface Trading212TradeOverlay {
  runId: string;
  label: string;
  color: string;  // hex color for this run
  trades: Trading212TradeInfo[];
  source?: "windowSim" | "globalFallback";
}

export type VolCell = {
  sigma1d?: number;
  lower?: number;
  upper?: number;
  widthPct?: number;
};

export type VolBundle = {
  gbm?: VolCell;
  garchNormal?: VolCell;
  garchStudent?: VolCell;
  harRv?: VolCell;
  rangeParkinson?: VolCell;
  rangeGarmanKlass?: VolCell;
  rangeRogersSatchell?: VolCell;
  rangeYangZhang?: VolCell;
};

export type HorizonForecast = {
  expected?: number;
  lower?: number;
  upper?: number;
  asOfDate?: string;
  mu?: number;
  sigma1d?: number;
};

const formatVolCellValue = (cell?: VolCell): string => {
  if (!cell) return "—";
  if (cell.sigma1d != null && Number.isFinite(cell.sigma1d)) {
    return `${(cell.sigma1d * 100).toFixed(2)}%`;
  }
  if (cell.widthPct != null && Number.isFinite(cell.widthPct)) {
    return `${cell.widthPct.toFixed(2)}%`;
  }
  return "—";
};

const volCellTitle = (cell?: VolCell): string | undefined => {
  if (!cell?.lower || !cell?.upper) return undefined;
  const widthLabel =
    cell.widthPct != null && Number.isFinite(cell.widthPct)
      ? ` (${cell.widthPct.toFixed(2)}%)`
      : "";
  return `${cell.lower.toFixed(2)}–${cell.upper.toFixed(2)}${widthLabel}`;
};

const formatBand = (cell?: VolCell): string | null => {
  if (!cell) return null;
  const { lower, upper } = cell;
  if (lower != null && upper != null && Number.isFinite(lower) && Number.isFinite(upper)) {
    return `(${lower.toFixed(2)}, ${upper.toFixed(2)})`;
  }
  return null;
};

const renderVolCell = (cell?: VolCell, ewmaUnbiasedCell?: VolCell) => {
  const main = formatVolCellValue(cell);
  const band = formatBand(cell);
  
  // Check if volatility model bands are insufficient to contain EWMA Unbiased
  // Red means the volatility model band doesn't adequately cover EWMA Unbiased range
  let lowerInsufficient = false;
  let upperInsufficient = false;
  
  if (cell && ewmaUnbiasedCell && 
      cell.lower != null && cell.upper != null &&
      ewmaUnbiasedCell.lower != null && ewmaUnbiasedCell.upper != null &&
      Number.isFinite(cell.lower) && Number.isFinite(cell.upper) &&
      Number.isFinite(ewmaUnbiasedCell.lower) && Number.isFinite(ewmaUnbiasedCell.upper)) {
    // Red lower if EWMA lower is higher than volatility model lower
    lowerInsufficient = ewmaUnbiasedCell.lower > cell.lower;
    // Red upper if EWMA upper is greater than volatility model upper
    upperInsufficient = ewmaUnbiasedCell.upper > cell.upper;
  }
  
  return (
    <div className="flex flex-col items-end leading-tight tabular-nums">
      <div>{main}</div>
      {band && cell?.lower != null && cell?.upper != null && (
        <div className="text-xs text-muted-foreground">
          (
          <span className={lowerInsufficient ? 'text-red-500 font-semibold' : ''}>
            {cell.lower.toFixed(2)}
          </span>
          {', '}
          <span className={upperInsufficient ? 'text-red-500 font-semibold' : ''}>
            {cell.upper.toFixed(2)}
          </span>
          )
        </div>
      )}
    </div>
  );
};

/** Simulation run summary for comparison table */
export interface SimulationRunSummary {
  id: string; // StrategyKey
  label: string;
  lambda?: number | null;
  trainFraction?: number;
  ewmaExpectedReturnPct?: number;
  returnPct: number;
  maxDrawdown: number;
  tradeCount: number;
  stopOutEvents: number;
  days: number;
  firstDate: string;
  lastDate: string;
  volatility?: VolBundle;
  horizonForecast?: HorizonForecast;
  // Performance metrics
  initialCapital?: number;
  openPnl?: number;
  openPnlPct?: number;
  netProfit?: number;
  netProfitPct?: number;
  netProfitLong?: number;
  netProfitShort?: number;
  grossProfit?: number;
  grossProfitPct?: number;
  grossProfitLong?: number;
  grossProfitShort?: number;
  grossLoss?: number;
  grossLossPct?: number;
  grossLossLong?: number;
  grossLossShort?: number;
  commissionPaid?: number;
  commissionPct?: number;
  buyHoldReturn?: number;
  buyHoldPct?: number;
  buyHoldPricePct?: number;
  maxContractsHeld?: number;
  avgRunUpDuration?: number;
  maxRunUpDuration?: number;
  avgRunUpValue?: number;
  maxRunUpValue?: number;
  avgRunUpPct?: number;
  maxRunUpPct?: number;
  avgDrawdownDuration?: number;
  maxDrawdownDuration?: number;
  avgDrawdownValue?: number;
  maxDrawdownValue?: number;
  avgDrawdownPct?: number;
  maxDrawdownPct?: number;
  maxEquityPeak?: number;
  maxEquityDrawdown?: number;
  maxEquityDrawdownPct?: number;
}

type T212RunId =
  | "ewma-unbiased"
  | "ewma-biased"
  | "ewma-biased-max"
  | "ewma-biased-trend"
  | "ewma-biased-max-trend";
type BaseMode = "unbiased" | "biased" | "max";

interface SimulationMode {
  baseMode: BaseMode;
  withTrend: boolean;
}
export type TrendOverlayState = {
  ewma: boolean;
  momentum: boolean;
  adx: boolean;
};

interface PriceChartProps {
  symbol: string;
  className?: string;
  canonicalRows?: CanonicalRow[] | null;
  horizon?: number;  // Number of trading days to extend (1,2,3,5)
  livePrice?: number | null;  // Current live price from quote (displayed as horizontal line with pill)
  forecastOverlay?: ForecastOverlayProps;
  volSelectionKey?: string;  // Stable key for vol model selection (for transition tracking)
  isVolForecastLoading?: boolean;  // True while volatility forecast is being fetched
  momentumScoreSeries?: MomentumScorePoint[];
  momentumPeriod?: number;
  adxSeries?: AdxPoint[];
  adxPeriod?: number;
  trendOverlays?: TrendOverlayState;
  showTrendEwma?: boolean;
  onToggleEwmaTrend?: (next: boolean) => void;
  ewmaShortWindow?: number;
  ewmaLongWindow?: number;
  ewmaShortSeries?: EwmaPoint[] | null;
  ewmaLongSeries?: EwmaPoint[] | null;
  trendEwmaShort?: TrendEwmaPoint[] | null;
  trendEwmaLong?: TrendEwmaPoint[] | null;
  trendEwmaCrossSignals?: TrendEwmaSignal[] | null;
  horizonCoverage?: HorizonCoverageProps;
  tradeOverlays?: Trading212TradeOverlay[];  // Trade markers to display on chart
  t212AccountHistory?: Trading212AccountSnapshot[] | null;  // Equity curve from Trading212 simulation
  activeT212RunId?: T212RunId | null;  // Currently active T212 run (for Chart toggle)
  onToggleT212Run?: (runId: T212RunId) => void;  // Toggle T212 run visibility
  simulationMode: SimulationMode;
  onChangeSimulationMode?: (mode: SimulationMode) => void;
  t212InitialEquity: number;
  t212Leverage: number;
  t212PositionFraction: number;
  // Fractional threshold (e.g., 0.001 = 0.10%) used for no-trade band
  t212ThresholdFrac: number;
  t212CostBps: number;
  t212ZMode: "auto" | "manual" | "optimize";
  t212SignalRule: "bps" | "z";
  t212ZDisplayThresholds?: {
    enterLong: number;
    enterShort: number;
    exitLong: number;
    exitShort: number;
    flipLong: number;
    flipShort: number;
  } | null;
  t212ZOptimized?: {
    thresholds: {
      enterLong: number;
      enterShort: number;
      exitLong: number;
      exitShort: number;
      flipLong: number;
      flipShort: number;
    };
    quantiles: { enter: number; exit: number; flip: number };
    meanScore: number;
    folds: number;
    avgTradeCount: number;
    avgShortOppCount: number;
    totalShortEntries?: number;
    applyRecommended: boolean;
    baselineScore: number;
    bestScore: number;
    reason?: string;
    selectionTier?: "strict" | "bestEffort" | "fallbackAuto";
    strictPass?: boolean;
    recencyPass?: boolean;
    failedConstraints?: string[];
    recency?: {
      recent?: { opens?: number; flatPct?: number };
      constraints?: {
        minOpensInLast63?: number;
        minFlatPctLast63?: number;
        bars63?: number;
        enforceRecency?: boolean;
      };
    } | null;
  } | null;
  isOptimizingZThresholds?: boolean;
  t212ZOptimizeError?: string | null;
  onApplyOptimizedZThresholds?: () => void;
  onChangeT212InitialEquity?: (v: number) => void;
  onChangeT212Leverage?: (v: number) => void;
  onChangeT212PositionFraction?: (v: number) => void;
  onChangeT212ThresholdPct?: (v: number) => void;
  onChangeT212CostBps?: (v: number) => void;
  onOptimizeZThresholds?: () => void;
  hasMaxRun?: boolean;
  trendWeight?: number | null;
  trendWeightUpdatedAt?: string | null;
  simulationRuns?: SimulationRunSummary[];  // Simulation runs for comparison table in Overview tab
  selectedSimRunId?: string | null;
  onSelectSimulationRun?: (id: string) => void;
  selectedSimByDate?: Record<
    string,
    {
      pnlUsd: number;
      equityUsd: number;
      side?: Trading212AccountSnapshot["side"] | null;
      contracts?: number | null;
    }
  >;
  selectedPnlLabel?: string;
  selectedOverviewStats?: {
    pnlAbs: number | null;
    pnlPct: number | null;
    maxDrawdownAbs: number | null;
    maxDrawdownPct: number | null;
    totalTrades: number | null;
    profitableTrades: number | null;
    pctProfitable: number | null;
    profitFactor: number | null;
    label: string | null;
    asOfDate: string | null;
  } | null;
  simComparePreset?: SimCompareRangePreset;
  visibleWindow?: { start: string; end: string } | null;
  onChangeSimComparePreset?: (p: SimCompareRangePreset) => void;
  onChangeSimCompareCustom?: (start: string, end: string) => void;
  onVisibleWindowChange?: (
    w: { start: string; end: string } | null,
    source: "chart" | "pill" | "dropdown"
  ) => void;
}

const RANGE_OPTIONS: PriceRange[] = [
  "1D",
  "5D", 
  "1M",
  "3M",
  "6M",
  "YTD",
  "1Y",
  "5Y",
  "ALL",
];

const PriceChartInner: React.FC<PriceChartProps> = ({
  symbol,
  className,
  canonicalRows,
  horizon,
  livePrice,
  momentumScoreSeries,
  momentumPeriod,
  adxSeries,
  adxPeriod,
  trendOverlays,
  showTrendEwma: showTrendEwmaProp,
  onToggleEwmaTrend,
  ewmaShortWindow,
  ewmaLongWindow,
  ewmaShortSeries,
  ewmaLongSeries,
  trendEwmaShort,
  trendEwmaLong,
  trendEwmaCrossSignals,
  horizonCoverage,
  t212InitialEquity,
  t212Leverage,
  t212PositionFraction,
  t212ThresholdFrac,
  t212CostBps,
  t212ZMode,
  t212SignalRule,
  t212ZDisplayThresholds,
  t212ZOptimized,
  isOptimizingZThresholds,
  t212ZOptimizeError,
  onApplyOptimizedZThresholds,
  onChangeT212InitialEquity,
  onChangeT212Leverage,
  onChangeT212PositionFraction,
  onChangeT212ThresholdPct,
  onChangeT212CostBps,
  onOptimizeZThresholds,
  tradeOverlays,
  t212AccountHistory,
  activeT212RunId,
  onToggleT212Run,
  simulationMode,
  onChangeSimulationMode,
  hasMaxRun = true,
  trendWeight = null,
  trendWeightUpdatedAt = null,
  simulationRuns,
  selectedSimRunId,
  onSelectSimulationRun,
  selectedSimByDate,
  selectedPnlLabel,
  selectedOverviewStats,
  simComparePreset,
  visibleWindow,
  onChangeSimComparePreset,
  onChangeSimCompareCustom,
  onVisibleWindowChange,
}) => {
  const isDarkMode = useDarkMode();
  const h = horizon ?? 1;
  const momentumSeries = useMemo(() => momentumScoreSeries ?? [], [momentumScoreSeries]);
  const adxSeriesSafe = useMemo(() => adxSeries ?? [], [adxSeries]);
  const hasMomentumScore = momentumSeries.length > 0;
  const hasMomentumScorePane = hasMomentumScore || adxSeriesSafe.length > 0;
  const showTrendEwma = trendOverlays?.ewma ?? (showTrendEwmaProp ?? true);
  const trendShortSeries = useMemo(() => trendEwmaShort ?? ewmaShortSeries ?? null, [ewmaShortSeries, trendEwmaShort]);
  const trendLongSeries = useMemo(() => trendEwmaLong ?? ewmaLongSeries ?? null, [ewmaLongSeries, trendEwmaLong]);
  const trendEwmaShortMap = useMemo(() => {
    const map = new Map<string, number>();
    (trendShortSeries ?? []).forEach((p) => {
      if (!Number.isFinite(p.value)) return;
      map.set(normalizeDateString(p.date), p.value);
    });
    return map;
  }, [trendShortSeries]);
  const trendEwmaLongMap = useMemo(() => {
    const map = new Map<string, number>();
    (trendLongSeries ?? []).forEach((p) => {
      if (!Number.isFinite(p.value)) return;
      map.set(normalizeDateString(p.date), p.value);
    });
    return map;
  }, [trendLongSeries]);

  const selectedPnlByDate = useMemo(() => {
    if (!selectedSimByDate) return undefined;
    const map: Record<string, number> = {};
    Object.entries(selectedSimByDate).forEach(([k, v]) => {
      if (v && Number.isFinite(v.pnlUsd)) {
        map[normalizeDateString(k)] = v.pnlUsd;
      }
    });
    return map;
  }, [selectedSimByDate]);

  // Model dropdown states
  const [showGarchDropdown, setShowGarchDropdown] = useState(false);
  const [showRangeDropdown, setShowRangeDropdown] = useState(true);
  
  // Model Settings dropdown state (⋯ button next to Model)
  const [showModelSettingsDropdown, setShowModelSettingsDropdown] = useState(false);
  const modelSettingsDropdownRef = useRef<HTMLDivElement>(null);
  
  // Main Settings dropdown state (consolidated settings button next to List of trades)
  const [showMainSettingsDropdown, setShowMainSettingsDropdown] = useState(false);
  const mainSettingsDropdownRef = useRef<HTMLDivElement>(null);

  // Simulation Settings dropdown state
  const simRangeDropdownRef = useRef<HTMLDivElement>(null);
  const simRangeButtonRef = useRef<HTMLButtonElement>(null);
  const [simRangeMenuWidth, setSimRangeMenuWidth] = useState<number | null>(null);
  const [equityInput, setEquityInput] = useState<string>(() => `${t212InitialEquity}`);
  const [positionPctInput, setPositionPctInput] = useState<string>(() => `${(t212PositionFraction ?? 0) * 100}`);
  const [thresholdInput, setThresholdInput] = useState<string>(() => `${t212ThresholdFrac * 10000}`);
  const [costInput, setCostInput] = useState<string>(() => `${t212CostBps}`);
  const [confirmApplyOptimized, setConfirmApplyOptimized] = useState(false);

  useEffect(() => {
    setEquityInput(`${t212InitialEquity}`);
  }, [t212InitialEquity]);

  useEffect(() => {
    setPositionPctInput(`${(t212PositionFraction ?? 0) * 100}`);
  }, [t212PositionFraction]);

  useEffect(() => {
    setThresholdInput(`${t212ThresholdFrac * 10000}`);
  }, [t212ThresholdFrac]);

  useEffect(() => {
    setCostInput(`${t212CostBps}`);
  }, [t212CostBps]);

  useEffect(() => {
    setConfirmApplyOptimized(false);
  }, [t212ZOptimized, t212ZMode]);

  useEffect(() => {
    if (!confirmApplyOptimized) return;
    const timer = setTimeout(() => setConfirmApplyOptimized(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmApplyOptimized]);

  const commitInitialEquity = useCallback(
    (val: string) => {
      const num = Number(val);
      if (!Number.isFinite(num) || num < 0) {
        setEquityInput(`${t212InitialEquity}`);
        return;
      }
      const clamped = Math.min(1_000_000, num);
      onChangeT212InitialEquity?.(clamped);
      setEquityInput(`${clamped}`);
    },
    [onChangeT212InitialEquity, t212InitialEquity]
  );

  const commitPositionPct = useCallback(
    (val: string) => {
      const num = Number(val);
      if (!Number.isFinite(num) || num < 0) {
        setPositionPctInput(`${(t212PositionFraction ?? 0) * 100}`);
        return;
      }
      const clampedPct = Math.min(100, num);
      const fraction = clampedPct / 100;
      onChangeT212PositionFraction?.(fraction);
      setPositionPctInput(`${clampedPct}`);
    },
    [onChangeT212PositionFraction, t212PositionFraction]
  );

  const commitThreshold = useCallback(
    (val: string) => {
      const num = Number(val);
      if (!Number.isFinite(num)) {
        setThresholdInput(`${t212ThresholdFrac * 10000}`);
        return;
      }
      const clampedBps = Math.min(500, Math.max(0, num));
      const frac = clampedBps / 10000;
      onChangeT212ThresholdPct?.(frac);
      setThresholdInput(`${clampedBps}`);
    },
    [onChangeT212ThresholdPct, t212ThresholdFrac]
  );

  const commitCost = useCallback(
    (val: string) => {
      const num = Number(val);
      if (!Number.isFinite(num)) {
        setCostInput(`${t212CostBps}`);
        return;
      }
      const clamped = Math.max(0, Math.min(500, num));
      onChangeT212CostBps?.(clamped);
      setCostInput(`${clamped}`);
    },
    [onChangeT212CostBps, t212CostBps]
  );

  const formatScoreDisplay = useCallback((value: number) => {
    const isFiniteScore = Number.isFinite(value);
    return {
      text: isFiniteScore ? value.toFixed(3) : "—",
      title: isFiniteScore ? undefined : "Undefined (0 drawdown or invalid denominator)",
    };
  }, []);

  const handleApplyOptimizedClick = useCallback(() => {
    if (!t212ZOptimized || !onApplyOptimizedZThresholds || isOptimizingZThresholds) return;
    const { thresholds, applyRecommended } = t212ZOptimized;
    const orderingValid =
      thresholds.exitLong < thresholds.enterLong &&
      thresholds.enterLong < thresholds.flipLong &&
      thresholds.exitShort < thresholds.enterShort &&
      thresholds.enterShort < thresholds.flipShort;
    if (!orderingValid) return;

    if (!applyRecommended && !confirmApplyOptimized) {
      setConfirmApplyOptimized(true);
      return;
    }

    onApplyOptimizedZThresholds();
    setConfirmApplyOptimized(false);
  }, [confirmApplyOptimized, isOptimizingZThresholds, onApplyOptimizedZThresholds, t212ZOptimized]);

  const optimizedOrderingValid = useMemo(() => {
    if (!t212ZOptimized) return false;
    const { thresholds } = t212ZOptimized;
    return (
      thresholds.exitLong < thresholds.enterLong &&
      thresholds.enterLong < thresholds.flipLong &&
      thresholds.exitShort < thresholds.enterShort &&
      thresholds.enterShort < thresholds.flipShort
    );
  }, [t212ZOptimized]);

  const optimizedBaselineScore = useMemo(
    () => (t212ZOptimized ? formatScoreDisplay(t212ZOptimized.baselineScore) : null),
    [formatScoreDisplay, t212ZOptimized]
  );
  const optimizedBestScore = useMemo(
    () => (t212ZOptimized ? formatScoreDisplay(t212ZOptimized.bestScore) : null),
    [formatScoreDisplay, t212ZOptimized]
  );

  const optimizedApplyLabel = useMemo(() => {
    if (!t212ZOptimized) return "Apply";
    if (t212ZOptimized.applyRecommended) return "Apply recommended";
    return confirmApplyOptimized ? "Click again to apply" : "Apply anyway";
  }, [confirmApplyOptimized, t212ZOptimized]);

  const optimizedApplyDisabled =
    !t212ZOptimized || !optimizedOrderingValid || isOptimizingZThresholds || !onApplyOptimizedZThresholds;

  const optimizedSelectionTier = t212ZOptimized?.selectionTier ?? "strict";
  const optimizedStrictPass = !!t212ZOptimized?.strictPass;
  const optimizedRecencyPass = !!t212ZOptimized?.recencyPass;
  const optimizedFailedConstraints = t212ZOptimized?.failedConstraints ?? [];
  const optimizedRecencyRules = useMemo(() => {
    const constraints = t212ZOptimized?.recency?.constraints;
    return {
      minOpens: constraints?.minOpensInLast63 ?? 1,
      minFlatPct: constraints?.minFlatPctLast63 ?? 1,
      bars63: constraints?.bars63 ?? 63,
      enforceRecency: constraints?.enforceRecency !== false,
    };
  }, [t212ZOptimized?.recency?.constraints]);

  const optimizedReasonLabel = useMemo(() => {
    if (!t212ZOptimized?.reason) return null;
    if (optimizedSelectionTier === "strict") {
      if (t212ZOptimized.reason === "bestScore<=baselineScore" || t212ZOptimized.reason === "bestScore<=0") {
        return { label: "Perf note", text: t212ZOptimized.reason };
      }
      return { label: "Reason", text: t212ZOptimized.reason };
    }
    return { label: "Fallback reason", text: t212ZOptimized.reason };
  }, [optimizedSelectionTier, t212ZOptimized?.reason]);

  const [showSimRangeMenu, setShowSimRangeMenu] = useState(false);
  const [customSimRangeStart, setCustomSimRangeStart] = useState<string>(visibleWindow?.start ?? "");
  const [customSimRangeEnd, setCustomSimRangeEnd] = useState<string>(visibleWindow?.end ?? "");
  
  // Click outside to close Model settings dropdown
  useEffect(() => {
    if (!showModelSettingsDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (modelSettingsDropdownRef.current && !modelSettingsDropdownRef.current.contains(e.target as Node)) {
        setShowModelSettingsDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showModelSettingsDropdown]);
  
  useEffect(() => {
    if (!showSimRangeMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (simRangeDropdownRef.current && !simRangeDropdownRef.current.contains(e.target as Node)) {
        setShowSimRangeMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSimRangeMenu]);

  useEffect(() => {
    if (!showSimRangeMenu) return;
    const updateWidth = () => {
      const w = simRangeButtonRef.current?.getBoundingClientRect().width;
      if (w && Number.isFinite(w)) {
        setSimRangeMenuWidth(w);
      }
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [showSimRangeMenu]);

  const [fullData, setFullData] = useState<PricePoint[]>([]);
  const [selectedRange, setSelectedRange] = useState<PriceRange>("1M");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Auto-sync state for handling missing canonical history
  const [isSyncingHistory, setIsSyncingHistory] = useState(false);
  const [hasTriedSync, setHasTriedSync] = useState(false);
  
  
  // Zoom state - tracks how many days to show from the end
  const [zoomDays, setZoomDays] = useState<number | null>(null);

  // Index-based view window over fullData.
  // When both are null, we fall back to the legacy range + zoomDays logic.
  const [viewStartIdx, setViewStartIdx] = useState<number | null>(null);
  const [viewEndIdx, setViewEndIdx] = useState<number | null>(null);
  
  // Trade detail card state - when a trade marker is clicked
  const [selectedTrade, setSelectedTrade] = useState<TradeDetailData | null>(null);
  
  // Ref to hold the latest chart click handler (avoids stale closure in useMemo)
  const chartClickHandlerRef = useRef<((state: any) => void) | null>(null);

  // Last hovered index in fullData (used as zoom anchor)
  const hoveredIndexRef = useRef<number | null>(null);

  // Ref to the chart container div
  const chartContainerRef = useRef<HTMLDivElement | null>(null);

  // React state used for UI only (show/hide zoom overlay)
  const [isChartHovered, setIsChartHovered] = useState(false);
  const renderCounterRef = useRef(0);
  const renderStartRef = useRef<number | null>(null);

  if (process.env.NODE_ENV !== "production") {
    if (renderStartRef.current == null) {
      renderStartRef.current = performance.now();
    }
    renderCounterRef.current += 1;
    if (renderCounterRef.current > RENDER_WARN_LIMIT) {
      const elapsedMs = performance.now() - (renderStartRef.current ?? performance.now());
      console.warn("[PriceChart] render loop warning", {
        count: renderCounterRef.current,
        elapsedMs: Math.round(elapsedMs),
        symbol,
        selectedRange,
      });
      renderCounterRef.current = 0;
      renderStartRef.current = performance.now();
    }
  }

  // Drag-panning refs
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef<number | null>(null);
  const dragStartWindowRef = useRef<{ start: number; end: number } | null>(null);

  // Shared hover state and smoothing for crosshair alignment
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const pendingHoverIndexRef = useRef<number | null>(null);
  const hoverRafRef = useRef<number | null>(null);

  // Reset view + range state when ticker changes
  useEffect(() => {
    setSelectedRange("1M");
    setZoomDays(null);
    setViewStartIdx(null);
    setViewEndIdx(null);
  }, [symbol]);

  useEffect(() => {
    if (visibleWindow) {
      setCustomSimRangeStart(visibleWindow.start);
      setCustomSimRangeEnd(visibleWindow.end);
    }
  }, [visibleWindow]);

  // Insights tab state (TradingView-style)
  type InsightTab =
    | "Overview"
    | "Performance"
    | "Trades analysis"
    | "Risk/performance ratios"
    | "List of trades";
  const [activeInsightTab, setActiveInsightTab] = useState<InsightTab>("Overview");

  // Position lines state (Long/Short)
  type PositionType = 'long' | 'short' | null;
  const [activePosition, setActivePosition] = useState<PositionType>(null);

  const [positionPriceInput, setPositionPriceInput] = useState<string>('');
  const [longPrice, setLongPrice] = useState<number | null>(null);
  const [shortPrice, setShortPrice] = useState<number | null>(null);

  // Build canonical date list from fullData
  const allDates = React.useMemo(
    () => fullData.map((p) => p.date),
    [fullData]
  );

  const normalizedVisibleWindow = useMemo(
    () =>
      visibleWindow
        ? {
            start: normalizeDateString(visibleWindow.start),
            end: normalizeDateString(visibleWindow.end),
          }
        : null,
    [visibleWindow]
  );

  const commitWindowFromIndices = useCallback(
    (startIdx: number, endIdx: number, source: "chart" | "pill" | "dropdown") => {
      if (fullData.length === 0) return;
      const clampedStart = Math.max(0, Math.min(startIdx, fullData.length - 1));
      const clampedEnd = Math.max(clampedStart, Math.min(endIdx, fullData.length - 1));
      const startDate = fullData[clampedStart]?.date;
      const endDate = fullData[clampedEnd]?.date;
      if (!startDate || !endDate) return;

      setViewStartIdx(clampedStart);
      setViewEndIdx(clampedEnd);
      onVisibleWindowChange?.(
        { start: normalizeDateString(startDate), end: normalizeDateString(endDate) },
        source
      );
    },
    [fullData, onVisibleWindowChange]
  );

  const clampWindowToDates = useCallback(
    (startDate: string, endDate: string) => {
      if (fullData.length === 0) return null;
      const normalizedStart = normalizeDateString(startDate);
      const normalizedEnd = normalizeDateString(endDate);

      const startIdx = fullData.findIndex((p) => p.date >= normalizedStart);
      let endIdx = -1;
      for (let i = fullData.length - 1; i >= 0; i--) {
        if (fullData[i].date <= normalizedEnd) {
          endIdx = i;
          break;
        }
      }
      if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return null;
      return { startIdx, endIdx };
    },
    [fullData]
  );

  const simRangeLabel = useMemo(
    () => formatRangeLabel(visibleWindow ?? null),
    [visibleWindow]
  );

  const quickRangePresets: Array<{ id: SimCompareRangePreset; label: string; spanFull?: boolean }> = [
    { id: "1d", label: "1D" },
    { id: "5d", label: "5D" },
    { id: "1m", label: "1M" },
    { id: "3m", label: "3M" },
    { id: "6m", label: "6M" },
    { id: "ytd", label: "YTD" },
    { id: "1y", label: "1Y" },
    { id: "5y", label: "5Y" },
    { id: "all", label: "ALL", spanFull: true },
  ];

  const handleSimRangePreset = useCallback(
    (preset: SimCompareRangePreset) => {
      onChangeSimComparePreset?.(preset);
      setShowSimRangeMenu(false);

      if (preset === "chart") {
        if (normalizedVisibleWindow) {
          const indices = clampWindowToDates(
            normalizedVisibleWindow.start,
            normalizedVisibleWindow.end
          );
          if (indices) {
            commitWindowFromIndices(indices.startIdx, indices.endIdx, "dropdown");
          }
        } else if (fullData.length > 0) {
          const [startIdx, endIdx] = computeDefaultWindowForRange(fullData, selectedRange);
          commitWindowFromIndices(startIdx, endIdx, "dropdown");
        }
        return;
      }

      if (preset === "all" && fullData.length > 0) {
        commitWindowFromIndices(0, fullData.length - 1, "dropdown");
        return;
      }

      if (preset === "custom") {
        if (customSimRangeStart && customSimRangeEnd) {
          const indices = clampWindowToDates(customSimRangeStart, customSimRangeEnd);
          if (indices) {
            commitWindowFromIndices(indices.startIdx, indices.endIdx, "dropdown");
          }
        }
        return;
      }

      const priceRangePresetMap: Partial<Record<SimCompareRangePreset, PriceRange>> = {
        "1d": "1D",
        "5d": "5D",
        "1m": "1M",
        "3m": "3M",
        "6m": "6M",
        ytd: "YTD",
        "1y": "1Y",
        "5y": "5Y",
      };
      const mappedRange = priceRangePresetMap[preset];
      if (mappedRange && fullData.length > 0) {
        setSelectedRange(mappedRange);
        const [startIdx, endIdx] = computeDefaultWindowForRange(fullData, mappedRange);
        commitWindowFromIndices(startIdx, endIdx, "dropdown");
        return;
      }
    },
    [
      clampWindowToDates,
      commitWindowFromIndices,
      customSimRangeEnd,
      customSimRangeStart,
      fullData,
      normalizedVisibleWindow,
      onChangeSimComparePreset,
      selectedRange,
    ]
  );

  const handleApplyCustomRange = useCallback(() => {
    if (!customSimRangeStart || !customSimRangeEnd) return;
    onChangeSimCompareCustom?.(customSimRangeStart, customSimRangeEnd);
    onChangeSimComparePreset?.("custom");
    const indices = clampWindowToDates(customSimRangeStart, customSimRangeEnd);
    if (indices) {
      commitWindowFromIndices(indices.startIdx, indices.endIdx, "dropdown");
    }
    setShowSimRangeMenu(false);
  }, [
    clampWindowToDates,
    commitWindowFromIndices,
    customSimRangeEnd,
    customSimRangeStart,
    onChangeSimCompareCustom,
    onChangeSimComparePreset,
  ]);

  useEffect(() => {
    if (normalizedVisibleWindow || fullData.length === 0) return;
    const [startIdx, endIdx] = computeDefaultWindowForRange(fullData, selectedRange);
    const startDate = fullData[startIdx]?.date;
    const endDate = fullData[endIdx]?.date;
    if (!startDate || !endDate) return;
    setViewStartIdx(startIdx);
    setViewEndIdx(endIdx);
    onVisibleWindowChange?.(
      { start: normalizeDateString(startDate), end: normalizeDateString(endDate) },
      "chart"
    );
  }, [fullData, normalizedVisibleWindow, onVisibleWindowChange, selectedRange]);

  useEffect(() => {
    if (!normalizedVisibleWindow || fullData.length === 0) return;
    const startIdx = fullData.findIndex((p) => p.date >= normalizedVisibleWindow.start);
    let endIdx = -1;
    for (let i = fullData.length - 1; i >= 0; i--) {
      if (fullData[i].date <= normalizedVisibleWindow.end) {
        endIdx = i;
        break;
      }
    }
    if (startIdx !== -1 && endIdx !== -1 && endIdx >= startIdx) {
      if (startIdx !== viewStartIdx || endIdx !== viewEndIdx) {
        setViewStartIdx(startIdx);
        setViewEndIdx(endIdx);
      }
    }
  }, [fullData, normalizedVisibleWindow, viewEndIdx, viewStartIdx]);

  const activeSimWindow = useMemo(() => normalizedVisibleWindow, [normalizedVisibleWindow]);

  // Helper to parse rows into PricePoint[]
  const parseRowsToPoints = useCallback((rows: any[]): PricePoint[] => {
    const sorted = rows
      .filter((row: any) => row.valid !== false)
      .map((row: any) => ({
        date: row.date,
        adj_close:
          typeof row.adj_close === "number"
            ? row.adj_close
            : typeof row.close === "number"
            ? row.close
            : NaN,
        open: typeof row.open === "number" ? row.open : undefined,
        high: typeof row.high === "number" ? row.high : undefined,
        low: typeof row.low === "number" ? row.low : undefined,
        close: typeof row.close === "number" ? row.close : undefined,
        volume: typeof row.volume === "number" ? row.volume : undefined,
      }))
      .filter((p: PricePoint) => !isNaN(p.adj_close))
      .sort((a: PricePoint, b: PricePoint) => a.date.localeCompare(b.date));

    // Drop duplicate dates to avoid Recharts/category glitches and EWMA instability
    return sorted.filter(
      (p, idx, arr) => idx === 0 || p.date !== arr[idx - 1].date
    );
  }, []);

  // Use canonical rows from parent when provided to avoid duplicate fetching
  useEffect(() => {
    if (canonicalRows === undefined) return;
    if (canonicalRows === null) {
      setLoading(true);
      return;
    }
    const points = parseRowsToPoints(canonicalRows);
    setFullData(points);
    setLoading(false);
    setError(null);
  }, [canonicalRows, parseRowsToPoints]);

  // Fetch full history with auto-sync for missing symbols
  useEffect(() => {
    // If caller supplies canonical rows, skip internal fetch
    if (canonicalRows !== undefined) {
      return;
    }

    let cancelled = false;

    const loadHistoryWithAutoSync = async () => {
      setLoading(true);
      setError(null);
      setHasTriedSync(false);

      // Build URL with interval param
  const interval = "1d";
  const historyUrl = `/api/history/${encodeURIComponent(symbol)}?interval=${interval}`;

      try {
        const res = await fetch(historyUrl, { cache: "no-store" });

        if (res.ok) {
          const json = await res.json();
          const rows = Array.isArray(json.rows) ? json.rows : [];
          const points = parseRowsToPoints(rows);

          // Check if the loaded data matches the requested interval
          const storedInterval = json.meta?.interval;
          if (storedInterval && storedInterval !== interval) {
            // Mismatch - trigger sync for the new interval
            if (!cancelled) {
              setHasTriedSync(true);
              setIsSyncingHistory(true);
            }

            const syncUrl = `/api/history/sync/${encodeURIComponent(symbol)}?interval=${interval}`;
            const syncRes = await fetch(syncUrl, { method: "GET" });

            if (!cancelled) {
              setIsSyncingHistory(false);
            }

            if (!syncRes.ok) {
              if (!cancelled) {
                let errorMessage = `Failed to sync ${interval} history for ${symbol}`;
                try {
                  const syncErr = await syncRes.json();
                  if (syncErr.error === "yahoo_not_found") {
                    errorMessage = `Symbol "${symbol}" not found on Yahoo Finance`;
                  } else if (syncErr.error === "yahoo_failed") {
                    errorMessage = "Yahoo Finance is temporarily unavailable. Please try again later.";
                  }
                } catch {
                  // Fallback to generic message
                }
                setError(errorMessage);
                setLoading(false);
              }
              return;
            }

            // Re-fetch after sync
            const res2 = await fetch(historyUrl, { cache: "no-store" });
            if (!res2.ok) {
              if (!cancelled) {
                setError(`Failed to load history after sync (${res2.status})`);
                setLoading(false);
              }
              return;
            }

            const json2 = await res2.json();
            const rows2 = Array.isArray(json2.rows) ? json2.rows : [];
            const points2 = parseRowsToPoints(rows2);

            if (!cancelled) {
              setFullData(points2);
              setLoading(false);
            }
            return;
          }

          if (!cancelled) {
            setFullData(points);
            setLoading(false);
          }
          return;
        }

        // Handle 404 -> auto sync via Yahoo
        if (res.status === 404) {
          if (!cancelled) {
            setHasTriedSync(true);
            setIsSyncingHistory(true);
          }

          const syncUrl = `/api/history/sync/${encodeURIComponent(symbol)}?interval=${interval}`;
          const syncRes = await fetch(syncUrl, { method: "GET" });

          if (!cancelled) {
            setIsSyncingHistory(false);
          }

          if (!syncRes.ok) {
            if (!cancelled) {
              // Parse structured error from sync endpoint
              let errorMessage = `Failed to sync history for ${symbol}`;
              try {
                const syncErr = await syncRes.json();
                if (syncErr.error === "yahoo_not_found") {
                  errorMessage = `Symbol "${symbol}" not found on Yahoo Finance`;
                } else if (syncErr.error === "yahoo_failed") {
                  errorMessage = "Yahoo Finance is temporarily unavailable. Please try again later.";
                }
              } catch {
                // Fallback to generic message
              }
              setError(errorMessage);
              setLoading(false);
            }
            return;
          }

          // After successful sync, re-fetch history
          const res2 = await fetch(historyUrl, { cache: "no-store" });

          if (!res2.ok) {
            if (!cancelled) {
              setError(`Failed to load history after sync (${res2.status})`);
              setLoading(false);
            }
            return;
          }

          const json2 = await res2.json();
          const rows2 = Array.isArray(json2.rows) ? json2.rows : [];
          const points2 = parseRowsToPoints(rows2);

          if (!cancelled) {
            setFullData(points2);
            setLoading(false);
          }
          return;
        }

        // Any other non-OK status: treat as error
        if (!cancelled) {
          setError(`Failed to load history (${res.status})`);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("PriceChart history load error:", err);
          setError(err instanceof Error ? err.message : "Failed to load history");
          setLoading(false);
          setIsSyncingHistory(false);
        }
      }
    };

    loadHistoryWithAutoSync();

    return () => {
      cancelled = true;
    };
  }, [canonicalRows, parseRowsToPoints, symbol]);

  // Initialize or reset the view window whenever fullData or the selected range changes.
  // This ensures that after a ticker change (new fullData), the chart always shows the
  // correct base window for the current range (e.g. last 1M / 6M / YTD), instead of
  // inheriting indices from the previous symbol.
  useEffect(() => {
    if (fullData.length === 0) {
      setViewStartIdx(null);
      setViewEndIdx(null);
      return;
    }

    const [start, end] = computeDefaultWindowForRange(fullData, selectedRange);
    setViewStartIdx(start);
    setViewEndIdx(end);
  }, [fullData, selectedRange]);

  // Minimum number of bars we allow in the window when zoomed in
  const MIN_WINDOW_BARS = 7;

  // Helper: get current visible window (start/end indices) and base range window
  function getCurrentWindow(
    data: PricePoint[],
    range: PriceRange,
    startIdx: number | null,
    endIdx: number | null
  ) {
    const total = data.length;
    if (total === 0) return null;

    const visibleIndices = normalizedVisibleWindow
      ? clampWindowToDates(normalizedVisibleWindow.start, normalizedVisibleWindow.end)
      : null;
    const [baseStart, baseEnd] = visibleIndices
      ? [visibleIndices.startIdx, visibleIndices.endIdx]
      : computeDefaultWindowForRange(data, range);
    const currentStart = startIdx ?? baseStart;
    const currentEnd = endIdx ?? baseEnd;

    let start = Math.max(baseStart, Math.min(currentStart, baseEnd));
    let end = Math.max(baseStart, Math.min(currentEnd, baseEnd));

    if (end < start) {
      end = start;
    }

    return { baseStart, baseEnd, start, end };
  }

  // Helper: apply a bar offset to pan the window (used by drag panning)
  const applyPanOffset = (offsetBars: number) => {
    const total = fullData.length;
    if (total === 0 || offsetBars === 0) return;

    const win = getCurrentWindow(fullData, selectedRange, viewStartIdx, viewEndIdx);
    if (!win) return;

    const { baseStart, baseEnd, start, end } = win;
    const windowSize = end - start + 1;

    let newStart = start + offsetBars;
    let newEnd = end + offsetBars;

    if (newStart < baseStart) {
      newStart = baseStart;
      newEnd = newStart + windowSize - 1;
    }
    if (newEnd > baseEnd) {
      newEnd = baseEnd;
      newStart = newEnd - windowSize + 1;
    }

    commitWindowFromIndices(newStart, newEnd, "chart");
  };

  // Zoom In: shrink window around hovered index (or center)
  const zoomIn = useCallback(() => {
    const total = fullData.length;
    if (total === 0) return;

    const win = getCurrentWindow(fullData, selectedRange, viewStartIdx, viewEndIdx);
    if (!win) return;

    const { baseStart, baseEnd, start, end } = win;
    const windowSize = end - start + 1;
    if (windowSize <= MIN_WINDOW_BARS) return;

    // Anchor: hovered index in fullData, or center of current window
    const anchorIdx =
      hoveredIndexRef.current != null
        ? hoveredIndexRef.current
        : Math.floor((start + end) / 2);

    const factor = 1 / 1.5; // shrink by ~1.5x
    const newSize = Math.max(MIN_WINDOW_BARS, Math.floor(windowSize * factor));
    const half = Math.floor(newSize / 2);

    let newStart = anchorIdx - half;
    let newEnd = newStart + newSize - 1;

    // Clamp to base window
    if (newStart < baseStart) {
      newStart = baseStart;
      newEnd = newStart + newSize - 1;
    }
    if (newEnd > baseEnd) {
      newEnd = baseEnd;
      newStart = newEnd - newSize + 1;
    }

    commitWindowFromIndices(newStart, newEnd, "chart");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitWindowFromIndices, fullData, selectedRange, viewStartIdx, viewEndIdx]);

  // Zoom Out: expand window around hovered index (or center)
  const zoomOut = useCallback(() => {
    const total = fullData.length;
    if (total === 0) return;

    const win = getCurrentWindow(fullData, selectedRange, viewStartIdx, viewEndIdx);
    if (!win) return;

    const { baseStart, baseEnd, start, end } = win;
    const baseSize = baseEnd - baseStart + 1;
    const windowSize = end - start + 1;

    if (windowSize >= baseSize) {
      // Already at base window – reset any overrides
      commitWindowFromIndices(baseStart, baseEnd, "chart");
      return;
    }

    const anchorIdx =
      hoveredIndexRef.current != null
        ? hoveredIndexRef.current
        : Math.floor((start + end) / 2);

    const factor = 1.5; // expand by ~1.5x
    const newSize = Math.min(baseSize, Math.floor(windowSize * factor));
    const half = Math.floor(newSize / 2);

    let newStart = anchorIdx - half;
    let newEnd = newStart + newSize - 1;

    if (newStart < baseStart) {
      newStart = baseStart;
      newEnd = newStart + newSize - 1;
    }
    if (newEnd > baseEnd) {
      newEnd = baseEnd;
      newStart = newEnd - newSize + 1;
    }

    commitWindowFromIndices(newStart, newEnd, "chart");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitWindowFromIndices, fullData, selectedRange, viewStartIdx, viewEndIdx]);

  // Pan left/right by ~30% of current window size
  const panStepFraction = 0.3;

  const panLeft = useCallback(() => {
    const total = fullData.length;
    if (total === 0) return;

    const win = getCurrentWindow(fullData, selectedRange, viewStartIdx, viewEndIdx);
    if (!win) return;

    const { baseStart, baseEnd, start, end } = win;
    const windowSize = end - start + 1;
    const step = Math.max(1, Math.floor(windowSize * panStepFraction));

    let newStart = Math.max(baseStart, start - step);
    let newEnd = newStart + windowSize - 1;

    if (newEnd > baseEnd) {
      newEnd = baseEnd;
      newStart = newEnd - windowSize + 1;
    }

    commitWindowFromIndices(newStart, newEnd, "chart");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitWindowFromIndices, fullData, selectedRange, viewStartIdx, viewEndIdx]);

  const panRight = useCallback(() => {
    const total = fullData.length;
    if (total === 0) return;

    const win = getCurrentWindow(fullData, selectedRange, viewStartIdx, viewEndIdx);
    if (!win) return;

    const { baseStart, baseEnd, start, end } = win;
    const windowSize = end - start + 1;
    const step = Math.max(1, Math.floor(windowSize * panStepFraction));

    let newEnd = Math.min(baseEnd, end + step);
    let newStart = newEnd - windowSize + 1;

    if (newStart < baseStart) {
      newStart = baseStart;
      newEnd = newStart + windowSize - 1;
    }

    commitWindowFromIndices(newStart, newEnd, "chart");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitWindowFromIndices, fullData, selectedRange, viewStartIdx, viewEndIdx]);

  // Reset view to base window for current range
  const resetViewWindow = useCallback(() => {
    if (fullData.length === 0) return;
    if (normalizedVisibleWindow) {
      const indices = clampWindowToDates(normalizedVisibleWindow.start, normalizedVisibleWindow.end);
      if (indices) {
        commitWindowFromIndices(indices.startIdx, indices.endIdx, "chart");
        return;
      }
    }
    const [startIdx, endIdx] = computeDefaultWindowForRange(fullData, selectedRange);
    commitWindowFromIndices(startIdx, endIdx, "chart");
  }, [clampWindowToDates, commitWindowFromIndices, fullData, normalizedVisibleWindow, selectedRange]);

  // Compute visual cues for button states
  const currentWindow = getCurrentWindow(fullData, selectedRange, viewStartIdx, viewEndIdx);
  const canZoomIn =
    currentWindow != null &&
    currentWindow.end - currentWindow.start + 1 > MIN_WINDOW_BARS;

  const baseSize = currentWindow ? currentWindow.baseEnd - currentWindow.baseStart + 1 : 0;
  const windowSize = currentWindow ? currentWindow.end - currentWindow.start + 1 : 0;

  const canZoomOut = currentWindow != null && windowSize < baseSize;
  const canPanLeft = currentWindow != null && currentWindow.start > currentWindow.baseStart;
  const canPanRight = currentWindow != null && currentWindow.end < currentWindow.baseEnd;
  const isZoomed =
    currentWindow != null &&
    (currentWindow.start !== currentWindow.baseStart ||
      currentWindow.end !== currentWindow.baseEnd);

  // Helper: compute default [start, end] window for a given range
  function computeDefaultWindowForRange(
    allRows: PricePoint[],
    range: PriceRange
  ): [number, number] {
    const n = allRows.length;
    if (n === 0) return [0, -1]; // empty

    // For most ranges, we mirror sliceByRange's behaviour (last N bars).
    const clampLast = (count: number) => {
      const len = Math.min(count, n);
      const start = Math.max(0, n - len);
      const end = n - 1;
      return [start, end] as [number, number];
    };

    switch (range) {
      case "ALL":
        return [0, n - 1];
      case "1D":
        return clampLast(1);
      case "5D":
        return clampLast(5);
      case "1M":
        return clampLast(21);
      case "3M":
        return clampLast(63);
      case "6M":
        return clampLast(126);
      case "1Y":
        return clampLast(252);
      case "5Y":
        return clampLast(1260);
      case "YTD": {
        const lastDate = allRows[n - 1].date;
        const yearOfLastDate = new Date(lastDate).getFullYear();
        const yearStart = `${yearOfLastDate}-01-01`;
        const start = allRows.findIndex((row) => row.date >= yearStart);
        if (start === -1) return [0, n - 1];
        return [start, n - 1];
      }
      default:
        return [0, n - 1];
    }
  }

  // Compute range data and performance
  const { rangeData, perfByRange } = useMemo(() => {
    if (fullData.length === 0) {
      return {
        rangeData: [],
        perfByRange: {} as Record<PriceRange, number | null>,
      };
    }

    // Calculate performance for all ranges
    const perfMap: Record<PriceRange, number | null> = {} as any;
    for (const range of RANGE_OPTIONS) {
      const sliced = sliceByRange(fullData, range);
      const perfResult = calculateRangePerformance(sliced);
      perfMap[range] = perfResult?.percentage ?? null;
    }

    const windowStart = normalizedVisibleWindow?.start ?? null;
    const windowEnd = normalizedVisibleWindow?.end ?? null;

    let rangeData: PricePoint[];

    if (windowStart && windowEnd) {
      rangeData = fullData.filter((p) => p.date >= windowStart && p.date <= windowEnd);
    } else if (
      viewStartIdx !== null &&
      viewEndIdx !== null &&
      viewStartIdx >= 0 &&
      viewEndIdx >= viewStartIdx &&
      viewStartIdx < fullData.length
    ) {
      const clampedEnd = Math.min(viewEndIdx, fullData.length - 1);
      rangeData = fullData.slice(viewStartIdx, clampedEnd + 1);
    } else if (zoomDays !== null) {
      const baseRangeData = sliceByRange(fullData, selectedRange);
      rangeData = baseRangeData.slice(-zoomDays);
    } else {
      rangeData = sliceByRange(fullData, selectedRange);
    }

    return {
      rangeData,
      perfByRange: perfMap,
    };
  }, [fullData, normalizedVisibleWindow, selectedRange, viewEndIdx, viewStartIdx, zoomDays]);

  const syncedDates = useMemo(
    () => rangeData.map((p) => normalizeDateString(p.date)),
    [rangeData]
  );
  const syncedDateSet = useMemo(() => new Set(syncedDates), [syncedDates]);

  // Derive last date and future dates
  const lastPoint = rangeData.length > 0 ? rangeData[rangeData.length - 1] : undefined;
  const lastDateStr = lastPoint?.date ?? null;

  const futureDates = React.useMemo(() => {
    if (!lastDateStr || h <= 0) return [];
    
    // First try to find future dates in historical data (for backtesting scenarios)
    const historicalFuture = getNextTradingDates(lastDateStr, h, allDates);
    if (historicalFuture.length > 0) {
      return historicalFuture;
    }
    
    // If no historical future dates, generate them (for real-time scenarios)
    const generatedFuture = generateFutureTradingDates(lastDateStr, h);
    return generatedFuture;
  }, [lastDateStr, allDates, h]);

  const momentumMap = useMemo(() => {
    const map = new Map<string, number>();
    momentumSeries.forEach((p) => {
      if (!Number.isFinite(p.score)) return;
      map.set(normalizeDateString(p.date), p.score);
    });
    return map;
  }, [momentumSeries]);

  const adxMap = useMemo(() => {
    const map = new Map<string, number>();
    adxSeriesSafe.forEach((p) => {
      if (!Number.isFinite(p.adx)) return;
      map.set(normalizeDateString(p.date), p.adx);
    });
    return map;
  }, [adxSeriesSafe]);

  const priceByDate = useMemo(() => {
    const map = new Map<string, PricePoint>();
    rangeData.forEach((p) => map.set(normalizeDateString(p.date), p));
    return map;
  }, [rangeData]);

  // Create chartData aligned to the visible window (no future placeholders)
  const chartData: ChartPoint[] = React.useMemo(() => {
    return syncedDates.map((date) => {
      const p = priceByDate.get(date);
      const open = p?.open;
      const close = p?.close;
      const high = p?.high;
      const low = p?.low;
      const adjClose = p?.adj_close;
      const volume = p?.volume;
      const isBullish = close != null && open != null ? close > open : false;

      return {
        date,
        value: adjClose ?? null,
        open,
        high,
        low,
        close,
        volume,
        trendEwmaShort: trendEwmaShortMap.get(date) ?? null,
        trendEwmaLong: trendEwmaLongMap.get(date) ?? null,
        momentumScore: momentumMap.get(date),
        adxValue: adxMap.get(date),
        volumeColor: isBullish ? "rgba(52, 211, 153, 0.35)" : "rgba(251, 113, 133, 0.35)",
        volumeStroke: isBullish ? "rgba(16, 185, 129, 0.8)" : "rgba(244, 63, 94, 0.8)",
        isFuture: false as const,
      };
    });
  }, [
    adxMap,
    trendEwmaLongMap,
    trendEwmaShortMap,
    momentumMap,
    priceByDate,
    syncedDates,
  ]);

  const renderTrendArrow = useCallback((props: any): React.ReactElement => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null || !payload) return <g />;
    if (payload.type === 'bullish') {
      return (
        <g>
          <polygon points={`${cx},${cy - 8} ${cx - 4},${cy} ${cx + 4},${cy}`} fill="#22c55e" />
        </g>
      );
    }
    if (payload.type === 'bearish') {
      return (
        <g>
          <polygon points={`${cx},${cy + 8} ${cx - 4},${cy} ${cx + 4},${cy}`} fill="#ef4444" />
        </g>
      );
    }
    return <g />;
  }, []);

  const trendCrossPoints = useMemo(() => {
    if (!trendEwmaCrossSignals || trendEwmaCrossSignals.length === 0) return [];
    return trendEwmaCrossSignals
      .map((signal) => {
        const date = normalizeDateString(signal.date);
        const price = priceByDate.get(date)?.close ?? null;
        if (price == null) return null;
        return { x: date, y: price, type: signal.type };
      })
      .filter(
        (p): p is { x: string; y: number; type: "bullish" | "bearish" } => p != null
      );
  }, [priceByDate, trendEwmaCrossSignals]);

  const chartHasTrendEwmaShort = useMemo(
    () => chartData.some((p) => p.trendEwmaShort != null),
    [chartData]
  );
  const chartHasTrendEwmaLong = useMemo(
    () => chartData.some((p) => p.trendEwmaLong != null),
    [chartData]
  );
  const hasTrendEwmaData = chartHasTrendEwmaShort || chartHasTrendEwmaLong;

  // Trend overlays are merged directly into chartData; keep alias for downstream code
  const chartDataWithEwma = chartData;

  // Find last chart points
  const lastChartPoint = chartDataWithEwma[chartDataWithEwma.length - 1];
  const lastHistoricalPoint =
    chartDataWithEwma.slice().reverse().find((p) => p.close != null) || null;

  // Default price for position lines (previous close)
  const defaultPositionPrice = lastHistoricalPoint?.close ?? null;

  // Handler to toggle Long/Short position (on/off behavior)
  const handlePositionClick = useCallback((type: 'long' | 'short') => {
    if (activePosition === type) {
      // Clicking same button again - toggle OFF (remove the line)
      if (type === 'long') {
        setLongPrice(null);
      } else {
        setShortPrice(null);
      }
      setActivePosition(null);
      setPositionPriceInput('');
    } else {
      // Switching to new position type or activating
      setActivePosition(type);
      // Set default price if input is empty
      if (defaultPositionPrice != null) {
        setPositionPriceInput(defaultPositionPrice.toFixed(2));
        if (type === 'long') {
          setLongPrice(defaultPositionPrice);
        } else {
          setShortPrice(defaultPositionPrice);
        }
      }
    }
  }, [activePosition, defaultPositionPrice]);

  // Handler for price input change
  // Handler for price input change - only update display, not the line
  const handlePositionPriceChange = useCallback((value: string) => {
    // Allow empty string, numbers, and decimals only
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setPositionPriceInput(value);
      // Don't update the line immediately - wait for blur or Enter
    }
  }, []);

  // Handler to commit the price change (on blur or Enter)
  const handlePositionPriceCommit = useCallback(() => {
    const numValue = parseFloat(positionPriceInput);
    if (!isNaN(numValue) && numValue > 0) {
      if (activePosition === 'long') {
        setLongPrice(numValue);
      } else if (activePosition === 'short') {
        setShortPrice(numValue);
      }
    } else if (positionPriceInput === '') {
      // Empty input = remove the line
      if (activePosition === 'long') {
        setLongPrice(null);
      } else if (activePosition === 'short') {
        setShortPrice(null);
      }
    }
  }, [positionPriceInput, activePosition]);

  // Handler for Enter key press
  const handlePositionPriceKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handlePositionPriceCommit();
      (e.target as HTMLInputElement).blur();
    }
  }, [handlePositionPriceCommit]);

  // Sync price input when position changes
  useEffect(() => {
    if (activePosition === 'long' && longPrice != null) {
      setPositionPriceInput(longPrice.toFixed(2));
    } else if (activePosition === 'short' && shortPrice != null) {
      setPositionPriceInput(shortPrice.toFixed(2));
    } else if (activePosition && defaultPositionPrice != null) {
      // Set default price when activating for first time
      setPositionPriceInput(defaultPositionPrice.toFixed(2));
      if (activePosition === 'long') {
        setLongPrice(defaultPositionPrice);
      } else {
        setShortPrice(defaultPositionPrice);
      }
    }
  }, [activePosition, longPrice, shortPrice, defaultPositionPrice]);

  const chartDataWithForecastBand = chartData;

  // Compute Y-axis domain from the chart dataset (price + trend EWMA overlays)
  // CRITICAL: Never use 0-based fallbacks - always base on actual price data
  const priceYDomain = useMemo(() => {
    const values: number[] = [];
    
    // Scan all price-related fields, prioritizing close/value (always present) then forecast/EWMA
    chartDataWithForecastBand.forEach(p => {
      // Priority 1: Core price fields (close, value/adj_close, high, low) - ALWAYS present
      if (p.close != null && Number.isFinite(p.close) && p.close > 0) values.push(p.close);
      if (p.value != null && Number.isFinite(p.value) && p.value > 0) values.push(p.value);
      if (p.high != null && Number.isFinite(p.high) && p.high > 0) values.push(p.high);
      if (p.low != null && Number.isFinite(p.low) && p.low > 0) values.push(p.low);
      
      // Priority 2: Forecast band (only if present and positive)
      if (p.forecastCenter != null && Number.isFinite(p.forecastCenter) && p.forecastCenter > 0) values.push(p.forecastCenter);
      if (p.forecastLower != null && Number.isFinite(p.forecastLower) && p.forecastLower > 0) values.push(p.forecastLower);
      if (p.forecastUpper != null && Number.isFinite(p.forecastUpper) && p.forecastUpper > 0) values.push(p.forecastUpper);
      
      // Priority 3: EWMA overlays (only if enabled)
      if (showTrendEwma) {
        if (p.trendEwmaShort != null && Number.isFinite(p.trendEwmaShort) && p.trendEwmaShort > 0) values.push(p.trendEwmaShort);
        if (p.trendEwmaLong != null && Number.isFinite(p.trendEwmaLong) && p.trendEwmaLong > 0) values.push(p.trendEwmaLong);
      }
    });
    
    // If no valid values found, use last known price as fallback (NEVER use 0-based domain)
    if (values.length === 0 && lastHistoricalPoint) {
      const fallbackPrice = lastHistoricalPoint.close ?? lastHistoricalPoint.value ?? 100;
      // Return tight range around last price
      return [fallbackPrice * 0.95, fallbackPrice * 1.05];
    }
    
    // Final safety: if still no values and no lastHistoricalPoint, use a reasonable default
    if (values.length === 0) {
      console.warn('[PRICE-DOMAIN] No valid price values found, using default range');
      return [90, 110];
    }
    
    const min = Math.min(...values);
    const max = Math.max(...values);
    
    // Guard: if min/max are invalid or non-positive, fall back to last price
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) {
      if (lastHistoricalPoint) {
        const fallbackPrice = lastHistoricalPoint.close ?? lastHistoricalPoint.value ?? 100;
        return [fallbackPrice * 0.95, fallbackPrice * 1.05];
      }
      return [90, 110];
    }
    
    // Add 3% padding for better visibility
    const padding = (max - min) * 0.03;
    
    return [min - padding, max + padding];
  }, [chartDataWithForecastBand, lastHistoricalPoint, showTrendEwma]);

  const priceYMinValue = useMemo(() => {
    return Array.isArray(priceYDomain) && typeof priceYDomain[0] === "number"
      ? priceYDomain[0]
      : undefined;
  }, [priceYDomain]);

  const priceYMaxValue = useMemo(() => {
    return Array.isArray(priceYDomain) && typeof priceYDomain[1] === "number"
      ? priceYDomain[1]
      : undefined;
  }, [priceYDomain]);
  const normalizedAccountHistory = useMemo<Trading212AccountSnapshot[]>(() => {
    const hist = t212AccountHistory ?? [];
    return hist
      .map((snap) => ({
        ...snap,
        date: normalizeDateString(snap.date ?? ""),
        side: snap.side ?? null,
      }))
      .filter((snap) => snap.date)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [t212AccountHistory]);
  const windowedAccountHistory = useMemo(() => {
    if (normalizedAccountHistory.length === 0) {
      return { history: [] as Trading212AccountSnapshot[], prevSideBefore: null as Trading212AccountSnapshot["side"] | null };
    }
    if (!activeSimWindow) {
      return { history: normalizedAccountHistory, prevSideBefore: null as Trading212AccountSnapshot["side"] | null };
    }
    const { start, end } = activeSimWindow;
    const startIdx = normalizedAccountHistory.findIndex((snap) => snap.date >= start);
    if (startIdx === -1) {
      return { history: [] as Trading212AccountSnapshot[], prevSideBefore: null as Trading212AccountSnapshot["side"] | null };
    }
    let endIdx = normalizedAccountHistory.length - 1;
    for (let i = normalizedAccountHistory.length - 1; i >= startIdx; i--) {
      if (normalizedAccountHistory[i].date <= end) {
        endIdx = i;
        break;
      }
    }
    if (endIdx < startIdx) {
      return { history: [] as Trading212AccountSnapshot[], prevSideBefore: null as Trading212AccountSnapshot["side"] | null };
    }
    const slice = normalizedAccountHistory.slice(startIdx, endIdx + 1);
    const prevSideBefore =
      startIdx > 0 ? normalizedAccountHistory[startIdx - 1]?.side ?? null : null;
    return { history: slice, prevSideBefore };
  }, [activeSimWindow, normalizedAccountHistory]);

  // === Unified Chart Data with Equity ===
  const chartDataWithEquity = useMemo(() => {
    if (!normalizedAccountHistory || normalizedAccountHistory.length === 0) {
      return chartDataWithForecastBand;
    }

    const equityMap = new Map<string, number>();
    for (const snap of normalizedAccountHistory) {
      const key = normalizeDateString(snap.date ?? "");
      if (key && typeof snap.equity === "number" && Number.isFinite(snap.equity)) {
        equityMap.set(key, snap.equity);
      }
    }

    if (equityMap.size === 0) {
      return chartDataWithForecastBand;
    }

    let lastEquity: number | null = null;

    return chartDataWithForecastBand.map((pt) => {
      const key = normalizeDateString(pt.date ?? "");
      const direct = key ? equityMap.get(key) ?? null : null;
      const selectedPoint = key && selectedSimByDate ? selectedSimByDate[key] : undefined;
      const selectedPnl = selectedPoint?.pnlUsd;
      const selectedEquity = selectedPoint?.equityUsd;
      const selectedSide = selectedPoint?.side ?? null;
      const selectedContracts =
        selectedPoint && Number.isFinite(selectedPoint.contracts ?? null)
          ? (selectedPoint.contracts as number)
          : null;
      const sideWithContracts =
        selectedSide ??
        (selectedContracts != null && selectedContracts !== 0
          ? selectedContracts > 0
            ? ("long" as const)
            : ("short" as const)
          : null);
      if (direct != null) {
        lastEquity = direct;
      }
      return {
        ...pt,
        equity: direct ?? lastEquity,
        selectedPnl: selectedPnl != null && Number.isFinite(selectedPnl) ? selectedPnl : undefined,
        selectedEquity:
          selectedEquity != null && Number.isFinite(selectedEquity) ? selectedEquity : undefined,
        selectedSide: sideWithContracts,
        selectedContracts,
      };
    });
  }, [chartDataWithForecastBand, normalizedAccountHistory, selectedSimByDate]);

  const chartDataWithEquityWindowed = useMemo(() => {
    if (!activeSimWindow) return chartDataWithEquity;
    const { start, end } = activeSimWindow;
    return chartDataWithEquity.filter((pt) => pt.date && pt.date >= start && pt.date <= end);
  }, [activeSimWindow, chartDataWithEquity]);

  useEffect(() => {
    const invalidCloseCount = chartData.filter(
      (p) => p.close == null || !Number.isFinite(p.close as number)
    ).length;
    const invalidTrendShort = chartData.filter(
      (p) => p.trendEwmaShort != null && !Number.isFinite(p.trendEwmaShort)
    ).length;
    const invalidTrendLong = chartData.filter(
      (p) => p.trendEwmaLong != null && !Number.isFinite(p.trendEwmaLong)
    ).length;

    console.log("[PriceChart] chart data lengths", {
      range: selectedRange,
      showTrendEwma,
      chartData: chartData.length,
      chartDataWithEwma: chartDataWithEwma.length,
      chartDataWithForecastBand: chartDataWithForecastBand.length,
      chartDataWithEquity: chartDataWithEquity.length,
      hasTrendEwmaData,
      chartHasTrendEwmaShort,
      chartHasTrendEwmaLong,
      priceYDomain,
      priceYMinValue,
      priceYMaxValue,
      invalidCloseCount,
      invalidTrendShort,
      invalidTrendLong,
    });

    if (typeof window !== "undefined") {
      (window as any).__priceChartDebug = {
        selectedRange,
        showTrendEwma,
        chartData,
        chartDataWithEwma,
        chartDataWithForecastBand,
        chartDataWithEquity,
        priceYDomain,
        priceYMinValue,
        priceYMaxValue,
        hasTrendEwmaData,
        chartHasTrendEwmaShort,
        chartHasTrendEwmaLong,
      };
    }
  }, [
    chartData,
    chartDataWithEwma,
    chartDataWithForecastBand,
    chartDataWithEquity,
    chartHasTrendEwmaLong,
    chartHasTrendEwmaShort,
    hasTrendEwmaData,
    priceYDomain,
    priceYMaxValue,
    priceYMinValue,
    selectedRange,
    showTrendEwma,
  ]);

  // Filtered equity data for Overview stats (full history when date-range dropdown is disabled)
  const filteredEquityData = useMemo(() => {
    return chartDataWithEquityWindowed;
  }, [chartDataWithEquityWindowed]);

  const hoveredDate =
    hoverIndex != null && hoverIndex >= 0 && hoverIndex < chartDataWithEquityWindowed.length
      ? chartDataWithEquityWindowed[hoverIndex].date
      : null;

  const hasEquityData = useMemo(() => {
    return chartDataWithEquityWindowed.some((pt) => pt.equity != null);
  }, [chartDataWithEquityWindowed]);

  // Equity deltas for histogram (uses windowed data for chart)
  const equityPanelData = useMemo(() => {
    return chartDataWithEquityWindowed.map((pt, idx) => {
      const prev = idx > 0 ? chartDataWithEquityWindowed[idx - 1].equity : pt.equity;
      const delta = pt.equity != null && prev != null ? pt.equity - prev : null;
      return { ...pt, equityDelta: delta };
    });
  }, [chartDataWithEquityWindowed]);

  // Filtered equity panel data for Overview stats (respects date range selection)
  const filteredEquityPanelData = useMemo(() => {
    return filteredEquityData.map((pt, idx) => {
      const prev = idx > 0 ? filteredEquityData[idx - 1].equity : pt.equity;
      const delta = pt.equity != null && prev != null ? pt.equity - prev : null;
      return { ...pt, equityDelta: delta };
    });
  }, [filteredEquityData]);

  // Dedicated Simulation equity series, sourced directly from t212AccountHistory (decoupled from EWMA/price data)
  const simulationEquityData = useMemo(() => {
    const history = windowedAccountHistory.history;
    const { activityStartDate, activityEndDate } = computeTradeActivityWindow(
      history,
      windowedAccountHistory.prevSideBefore ?? null
    );
    if (syncedDates.length === 0) return [];

    const snapshotMap = new Map<string, Trading212AccountSnapshot>();
    if (history && history.length > 0) {
      history.forEach((pt) => {
        const date = pt.date ? normalizeDateString(pt.date) : null;
        if (date) {
          snapshotMap.set(date, pt);
        }
      });
    }

    let lastEquity: number | null = null;
    let lastMarginUsed: number | null = null;
    let lastFreeMargin: number | null = null;

    const aligned = syncedDates.map((date, idx) => {
      const snap = snapshotMap.get(date);
      const selectedPoint = selectedSimByDate ? selectedSimByDate[date] : undefined;
      const equity =
        selectedPoint?.equityUsd != null && Number.isFinite(selectedPoint.equityUsd)
          ? selectedPoint.equityUsd
          : snap?.equity != null
            ? snap.equity
            : lastEquity;
      const marginUsed =
        snap?.marginUsed != null
          ? snap.marginUsed
          : lastMarginUsed != null
            ? lastMarginUsed
            : 0;
      const freeMargin =
        snap?.freeMargin != null
          ? snap.freeMargin
          : equity != null
            ? equity - marginUsed
            : lastFreeMargin;
      const prevEquity = idx > 0 ? lastEquity : equity;
      const equityDelta =
        equity != null && prevEquity != null ? equity - prevEquity : null;
      const selectedPnl =
        selectedPoint?.pnlUsd != null && Number.isFinite(selectedPoint.pnlUsd)
          ? selectedPoint.pnlUsd
          : selectedPnlByDate && Number.isFinite(selectedPnlByDate[date])
            ? selectedPnlByDate[date]
            : undefined;
      const selectedEquityVal =
        selectedPoint?.equityUsd != null && Number.isFinite(selectedPoint.equityUsd)
          ? selectedPoint.equityUsd
          : undefined;
      const selectedContractsVal =
        selectedPoint && Number.isFinite(selectedPoint.contracts ?? null)
          ? (selectedPoint.contracts as number)
          : Number.isFinite(snap?.quantity) && snap?.quantity != null
            ? snap.quantity
            : null;
      const selectedSideVal = selectedPoint?.side ?? snap?.side ?? null;
      const sideWithContracts =
        selectedSideVal ??
        (selectedContractsVal != null && selectedContractsVal !== 0
          ? selectedContractsVal > 0
            ? ("long" as const)
            : ("short" as const)
          : null);
      if (equity != null) {
        lastEquity = equity;
      }
      if (marginUsed != null) {
        lastMarginUsed = marginUsed;
      }
      if (freeMargin != null) {
        lastFreeMargin = freeMargin;
      }
      return {
        date,
        equity,
        equityDelta,
        marginUsed,
        freeMargin,
        selectedPnl: Number.isFinite(selectedPnl as number) ? (selectedPnl as number) : undefined,
        selectedEquity: selectedEquityVal,
        selectedSide: sideWithContracts,
        selectedContracts: selectedContractsVal,
      };
    });

    return applyActivityMaskToEquitySeries(aligned, activityStartDate, activityEndDate);
  }, [syncedDates, windowedAccountHistory, selectedSimByDate, selectedPnlByDate]);

  useEffect(() => {
    console.log("[SELECTED RUN]", selectedSimRunId);
  }, [selectedSimRunId]);

  useEffect(() => {
    const nSel = simulationEquityData.reduce(
      (a, p) => a + (Number.isFinite((p as any).selectedPnl) ? 1 : 0),
      0
    );
    const firstSel = simulationEquityData.find((p) => Number.isFinite((p as any).selectedPnl));
    console.log("[CHART SEL]", { nSel, first: firstSel });
  }, [simulationEquityData]);
  const simViewLength = simulationEquityData.length;
  const carryInBlocksWindowSim = useMemo(() => {
    if (!activeSimWindow) return false;
    const prevSideBefore = windowedAccountHistory.prevSideBefore ?? null;
    if (prevSideBefore == null) return false;
    if (windowedAccountHistory.history.length === 0) return true;
    let prevSide: Trading212AccountSnapshot["side"] | null = prevSideBefore;
    for (const snap of windowedAccountHistory.history) {
      const side = snap.side ?? null;
      if (prevSide === null && side != null) {
        return false;
      }
      prevSide = side;
    }
    return true;
  }, [activeSimWindow, windowedAccountHistory]);
  const equityFullyMasked = useMemo(
    () => simulationEquityData.length > 0 && simulationEquityData.every((pt) => pt.equity == null),
    [simulationEquityData]
  );
  const showCarryInNotice = carryInBlocksWindowSim && equityFullyMasked;
  type SimTickStyle = "md" | "mmyy" | "yyyy";
  const formatSimDate = useCallback((value: string, style: SimTickStyle) => {
    if (!value) return "";
    const dateObj = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(dateObj.getTime())) return value;
    if (style === "yyyy") return dateObj.getUTCFullYear().toString();
    if (style === "mmyy") {
      return dateObj.toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
        timeZone: "UTC",
      });
    }
    return dateObj.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }, []);
  const simTickConfig = useMemo(() => {
    const N = simViewLength;
    if (N <= 0) return { interval: 0, style: "md" as SimTickStyle };
    if (N <= 10) return { interval: 0, style: "md" as SimTickStyle };
    if (N <= 40) return { interval: Math.max(1, Math.ceil(N / 8) - 1), style: "md" as SimTickStyle };
    if (N <= 120) return { interval: Math.max(1, Math.ceil(N / 8) - 1), style: "md" as SimTickStyle };
    if (N <= 260) return { interval: Math.max(1, Math.ceil(N / 8) - 1), style: "mmyy" as SimTickStyle };
    if (N <= 520) return { interval: Math.max(1, Math.ceil(N / 10)), style: "mmyy" as SimTickStyle };
    return { interval: Math.max(1, Math.ceil(N / 16)), style: "yyyy" as SimTickStyle };
  }, [simViewLength]);
  const simTickFormatter = useCallback(
    (value: string) => formatSimDate(value, simTickConfig.style),
    [formatSimDate, simTickConfig.style]
  );
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const N = simViewLength;
    const sampleTicks =
      N > 0
        ? [
            simulationEquityData[0]?.date,
            simulationEquityData[Math.floor(N / 2)]?.date,
            simulationEquityData[N - 1]?.date,
          ]
        : [];
    console.log("[AXIS][SIM-EQUITY]", {
      panel: "simEquity",
      N,
      interval: simTickConfig.interval,
      sampleTicks,
    });
  }, [simTickConfig.interval, simViewLength, simulationEquityData]);
  const sharedBarSizing = useMemo(() => getBarSizing(syncedDates.length || simViewLength || chartDataWithEquity.length || 0), [chartDataWithEquity.length, simViewLength, syncedDates.length]);
  const simShowDots = simViewLength > 0 && simViewLength <= 25;
  const equityYDomain = useMemo(() => {
    const equities = simulationEquityData
      .map((d) => d.equity)
      .filter((e): e is number => e !== null && e !== undefined);

    if (equities.length === 0) return [0, 100];

    const min = Math.min(...equities);
    const max = Math.max(...equities);
    const span = max - min;
    const basePad = span === 0 ? Math.abs(max || 1) * 0.02 : span * 0.05;
    const padding = Math.max(basePad, Math.abs(max) * 0.002, 1);

    const lower = min - padding;
    const upper = max + padding;
    return [lower, upper];
  }, [simulationEquityData]);

  useEffect(() => {
    console.log('[SIM-CHART] data source', {
      simulationMode,
      activeT212RunId,
      equityPanelSample: equityPanelData.slice(0, 3),
      filteredEquityPanelSample: filteredEquityPanelData.slice(0, 3),
      priceChartSample: chartDataWithForecastBand.slice(0, 3),
      simulationEquitySample: simulationEquityData.slice(0, 3),
    });
  }, [
    simulationMode,
    activeT212RunId,
    equityPanelData,
    filteredEquityPanelData,
    chartDataWithForecastBand,
    simulationEquityData,
  ]);

  const equityDeltaDomain = useMemo<[number, number]>(() => {
    const deltas = simulationEquityData
      .map((d) => d.equityDelta)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (deltas.length === 0) return [-1, 1];
    const absMax = Math.max(...deltas.map((v) => Math.abs(v)));
    const pad = absMax * 0.2 || 1;
    return [-(absMax + pad), absMax + pad];
  }, [simulationEquityData]);

  // Risk/return metrics from equity series
  const riskMetrics = useMemo(() => {
    const series = equityPanelData
      .filter((p) => p.equity != null && Number.isFinite(p.equity))
      .map((p) => p.equity as number);
    
    if (series.length < 2) {
      return {
        sharpeRatio: null,
        sortinoRatio: null,
      };
    }

    const returns: number[] = [];
    for (let i = 1; i < series.length; i++) {
      if (series[i - 1] > 0) {
        returns.push(series[i] / series[i - 1] - 1);
      }
    }

    if (returns.length === 0) {
      return {
        sharpeRatio: null,
        sortinoRatio: null,
      };
    }

    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, r) => a + Math.pow(r - meanReturn, 2), 0) / returns.length;
    const stdReturn = Math.sqrt(variance);

    const negativeReturns = returns.filter((r) => r < 0);
    const downsideVariance =
      negativeReturns.length > 0
        ? negativeReturns.reduce((a, r) => a + Math.pow(r, 2), 0) / negativeReturns.length
        : 0;
    const downsideDeviation = Math.sqrt(downsideVariance);

    const sharpeRatio = stdReturn > 0 ? (meanReturn / stdReturn) * Math.sqrt(252) : null;
    const sortinoRatio = downsideDeviation > 0 ? (meanReturn / downsideDeviation) * Math.sqrt(252) : null;

    return {
      sharpeRatio,
      sortinoRatio,
    };
  }, [equityPanelData]);

  // Fast lookup helpers for equity series (filtered by date range)
  const equityLookup = useMemo(() => {
    const byDate = new Map<string, number>();
    const series: number[] = [];
    filteredEquityData.forEach((pt) => {
      if (pt.date && pt.equity != null && Number.isFinite(pt.equity)) {
        byDate.set(pt.date, pt.equity);
        series.push(pt.equity);
      }
    });
    return {
      byDate,
      firstEquity: series.length ? series[0] : null,
      lastEquity: series.length ? series[series.length - 1] : null,
    };
  }, [filteredEquityData]);

  const equityStatsBase = useMemo(() => {
    // Use filtered data for Overview stats
    const series = filteredEquityData
      .map((p) => p.equity)
      .filter((v): v is number => v != null && Number.isFinite(v));

    if (series.length === 0) {
      return {
        baseEquity: null,
        maxDrawdownAbs: null,
        maxDrawdownPct: null,
      };
    }

    const baseEquity = series[0];
    let peak = series[0];
    let maxDrawdown = 0;
    let peakAtMaxDrawdown = series[0];
    for (const value of series) {
      if (value > peak) peak = value;
      const dd = (peak - value) / peak;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        peakAtMaxDrawdown = peak;
      }
    }
    const maxDrawdownAbs = peakAtMaxDrawdown * maxDrawdown;

    return {
      baseEquity,
      maxDrawdownAbs,
      maxDrawdownPct: maxDrawdown,
    };
  }, [filteredEquityData]);

  // Overview metrics (hover-aware P&L)
  const equitySummary = useMemo(() => {
    const { baseEquity, maxDrawdownAbs, maxDrawdownPct } = equityStatsBase;
    const lastEquity = equityLookup.lastEquity;

    if (baseEquity == null || lastEquity == null) {
      return {
        baseEquity: null,
        currentEquity: null,
        pnlAbs: null,
        pnlPct: null,
        maxDrawdownAbs: null,
        maxDrawdownPct: null,
      };
    }

    const currentEquity = (() => {
      if (!hoveredDate) return lastEquity;
      return equityLookup.byDate.get(hoveredDate) ?? lastEquity;
    })();

    const pnlAbs = currentEquity - baseEquity;
    const pnlPct = baseEquity !== 0 ? pnlAbs / baseEquity : null;

    return {
      baseEquity,
      currentEquity,
      pnlAbs,
      pnlPct,
      maxDrawdownAbs: maxDrawdownAbs != null ? Math.abs(maxDrawdownAbs) : null,
      maxDrawdownPct: maxDrawdownPct != null ? Math.abs(maxDrawdownPct) : null,
    };
  }, [equityStatsBase, equityLookup, hoveredDate]);

  const summaryTrades = useMemo(() => {
    const overlaysForStats =
      tradeOverlays?.filter((o) => o.source !== "globalFallback") ?? [];
    const trades = overlaysForStats.flatMap((o) => o.trades ?? [])?.filter(Boolean) ?? [];
    if (!activeSimWindow) return trades;
    const { start, end } = activeSimWindow;
    return trades.filter((t) => {
      const entry = t.entryDate ? normalizeDateString(t.entryDate) : null;
      const exit = t.exitDate ? normalizeDateString(t.exitDate) : null;
      if (!entry) return false;
      const tradeStart = entry;
      const tradeEnd = exit ?? "9999-12-31";
      return tradeStart <= end && tradeEnd >= start;
    });
  }, [activeSimWindow, tradeOverlays]);

  // Flatten all trades once for downstream tables
  const flattenedTrades = useMemo(() => summaryTrades, [summaryTrades]);

  // Formatting helpers for the insight tables
  const formatUsd = (v: number | null | undefined, opts?: { sign?: boolean; precision?: number }) => {
    if (v == null || !Number.isFinite(v)) return "—";
    const sign = opts?.sign ? (v > 0 ? "+" : v < 0 ? "−" : "") : "";
    const precision = opts?.precision ?? 2;
    return `${sign}$${Math.abs(v).toFixed(precision)}`;
  };

  const formatPct = (v: number | null | undefined, opts?: { precision?: number }) => {
    if (v == null || !Number.isFinite(v)) return "";
    const precision = opts?.precision ?? 2;
    return `${(v * 100).toFixed(precision)}%`;
  };

  // Comprehensive trade summary for all tabs (windowed to visibleWindow when provided)
  const tradeSummary = useMemo(() => {
    const allTrades = summaryTrades;
    const history = windowedAccountHistory.history;
    const windowStart = activeSimWindow?.start ?? null;
    const windowEnd = activeSimWindow?.end ?? null;
    const longTrades = allTrades.filter((t) => t.side === "long");
    const shortTrades = allTrades.filter((t) => t.side === "short");
    
    const closedTrades = allTrades.filter((t) => {
      if (!t.exitDate) return false;
      if (!windowStart || !windowEnd) return true;
      const exit = normalizeDateString(t.exitDate);
      return exit >= windowStart && exit <= windowEnd;
    });
    const closedTradesCount = closedTrades.length;
    let openedTrades = 0;
    let prevSide: Trading212AccountSnapshot["side"] | null = windowedAccountHistory.prevSideBefore ?? null;
    for (const snap of history) {
      if (snap.side && snap.side !== prevSide) {
        openedTrades++;
      }
      prevSide = snap.side;
    }
    const hasExposureInWindow = history.some((h) => h.side != null);
    const activeAtStart = history.length > 0 && history[0].side != null;
    const positionSegments = openedTrades + (activeAtStart ? 1 : 0);
    const totalTrades = Math.max(
      closedTradesCount,
      positionSegments,
      allTrades.length,
      hasExposureInWindow ? 1 : 0
    );
    const totalLong = longTrades.length;
    const totalShort = shortTrades.length;
    
    // Check for open position (trade with no exit date or exit date in future)
    const openTrades = allTrades.filter((t) => !t.exitDate);
    const totalOpen = openTrades.length;
    const openLong = openTrades.filter((t) => t.side === "long").length;
    const openShort = openTrades.filter((t) => t.side === "short").length;
    
    const closedLong = closedTrades.filter((t) => t.side === "long");
    const closedShort = closedTrades.filter((t) => t.side === "short");
    
    // Winning/losing trades
    const winningTrades = closedTrades.filter((t) => (t.netPnl ?? 0) > 0);
    const losingTrades = closedTrades.filter((t) => (t.netPnl ?? 0) < 0);
    const winningLong = closedLong.filter((t) => (t.netPnl ?? 0) > 0);
    const losingLong = closedLong.filter((t) => (t.netPnl ?? 0) < 0);
    const winningShort = closedShort.filter((t) => (t.netPnl ?? 0) > 0);
    const losingShort = closedShort.filter((t) => (t.netPnl ?? 0) < 0);
    
    const profitableTrades = winningTrades.length;
    const profitableLong = winningLong.length;
    const profitableShort = winningShort.length;
    
    // Percent profitable
    const pctProfitable = closedTradesCount > 0 ? (winningTrades.length / closedTradesCount) * 100 : null;
    const pctProfitableLong = closedLong.length > 0 ? (winningLong.length / closedLong.length) * 100 : null;
    const pctProfitableShort = closedShort.length > 0 ? (winningShort.length / closedShort.length) * 100 : null;
    
    // Gross profit & loss
    const grossProfit = closedTrades.filter((t) => (t.netPnl ?? 0) > 0).reduce((a, t) => a + (t.netPnl ?? 0), 0);
    const grossLoss = Math.abs(closedTrades.filter((t) => (t.netPnl ?? 0) < 0).reduce((a, t) => a + (t.netPnl ?? 0), 0));
    const grossProfitLong = closedLong.filter((t) => (t.netPnl ?? 0) > 0).reduce((a, t) => a + (t.netPnl ?? 0), 0);
    const grossLossLong = Math.abs(closedLong.filter((t) => (t.netPnl ?? 0) < 0).reduce((a, t) => a + (t.netPnl ?? 0), 0));
    const grossProfitShort = closedShort.filter((t) => (t.netPnl ?? 0) > 0).reduce((a, t) => a + (t.netPnl ?? 0), 0);
    const grossLossShort = Math.abs(closedShort.filter((t) => (t.netPnl ?? 0) < 0).reduce((a, t) => a + (t.netPnl ?? 0), 0));
    
    // Net profit
    const netProfit = closedTrades.reduce((a, t) => a + (t.netPnl ?? 0), 0);
    const netProfitLong = closedLong.reduce((a, t) => a + (t.netPnl ?? 0), 0);
    const netProfitShort = closedShort.reduce((a, t) => a + (t.netPnl ?? 0), 0);
    
    // Profit factor
    const profitFactor =
      closedTradesCount === 0
        ? null
        : grossLoss === 0
          ? grossProfit > 0
            ? Infinity
            : null
          : grossProfit / grossLoss;
    const profitFactorLong =
      closedLong.length === 0
        ? null
        : grossLossLong === 0
          ? grossProfitLong > 0
            ? Infinity
            : null
          : grossProfitLong / grossLossLong;
    const profitFactorShort =
      closedShort.length === 0
        ? null
        : grossLossShort === 0
          ? grossProfitShort > 0
            ? Infinity
            : null
          : grossProfitShort / grossLossShort;
    
    // Avg P&L
    const avgPnl = closedTrades.length > 0 ? netProfit / closedTrades.length : 0;
    const avgPnlLong = closedLong.length > 0 ? netProfitLong / closedLong.length : 0;
    const avgPnlShort = closedShort.length > 0 ? netProfitShort / closedShort.length : 0;
    
    // Avg winning/losing trade
    const avgWin = winningTrades.length > 0 ? winningTrades.reduce((a, t) => a + (t.netPnl ?? 0), 0) / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? Math.abs(losingTrades.reduce((a, t) => a + (t.netPnl ?? 0), 0) / losingTrades.length) : 0;
    const avgWinLong = winningLong.length > 0 ? winningLong.reduce((a, t) => a + (t.netPnl ?? 0), 0) / winningLong.length : 0;
    const avgLossLong = losingLong.length > 0 ? Math.abs(losingLong.reduce((a, t) => a + (t.netPnl ?? 0), 0) / losingLong.length) : 0;
    const avgWinShort = winningShort.length > 0 ? winningShort.reduce((a, t) => a + (t.netPnl ?? 0), 0) / winningShort.length : 0;
    const avgLossShort = losingShort.length > 0 ? Math.abs(losingShort.reduce((a, t) => a + (t.netPnl ?? 0), 0) / losingShort.length) : 0;
    
    // Ratio avg win / avg loss
    const ratioWinLoss = avgLoss > 0 ? avgWin / avgLoss : 0;
    const ratioWinLossLong = avgLossLong > 0 ? avgWinLong / avgLossLong : 0;
    const ratioWinLossShort = avgLossShort > 0 ? avgWinShort / avgLossShort : 0;
    
    // Largest winning/losing trade
    const largestWin = winningTrades.length > 0 ? Math.max(...winningTrades.map((t) => t.netPnl ?? 0)) : 0;
    const largestLoss = losingTrades.length > 0 ? Math.abs(Math.min(...losingTrades.map((t) => t.netPnl ?? 0))) : 0;
    const largestWinLong = winningLong.length > 0 ? Math.max(...winningLong.map((t) => t.netPnl ?? 0)) : 0;
    const largestLossLong = losingLong.length > 0 ? Math.abs(Math.min(...losingLong.map((t) => t.netPnl ?? 0))) : 0;
    const largestWinShort = winningShort.length > 0 ? Math.max(...winningShort.map((t) => t.netPnl ?? 0)) : 0;
    const largestLossShort = losingShort.length > 0 ? Math.abs(Math.min(...losingShort.map((t) => t.netPnl ?? 0))) : 0;
    
    // Trade duration (in days) - calculate from entry/exit dates
    const getDurationDays = (t: Trading212TradeInfo) => {
      if (!t.entryDate || !t.exitDate) return 0;
      const entry = new Date(t.entryDate);
      const exit = new Date(t.exitDate);
      return Math.round((exit.getTime() - entry.getTime()) / (1000 * 60 * 60 * 24));
    };
    
    const durations = closedTrades.map(getDurationDays).filter((d) => d > 0);
    const avgBarsInTrades = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    
    const winningDurations = winningTrades.map(getDurationDays).filter((d) => d > 0);
    const avgBarsInWinning = winningDurations.length > 0 ? winningDurations.reduce((a, b) => a + b, 0) / winningDurations.length : 0;
    
    const losingDurations = losingTrades.map(getDurationDays).filter((d) => d > 0);
    const avgBarsInLosing = losingDurations.length > 0 ? losingDurations.reduce((a, b) => a + b, 0) / losingDurations.length : 0;
    
    // Initial capital (from first account snapshot if available)
    const initialCapital = history.length > 0 ? history[0].equity : 0;
    
    // Open P&L (unrealized from last snapshot)
    const lastSnapshot = history.length > 0 ? history[history.length - 1] : null;
    const openPnl = lastSnapshot?.unrealisedPnl ?? 0;
    
    // Swap fees total
    const swapFeesTotal = closedTrades.reduce((a, t) => a + (t.swapFees ?? 0), 0);
    
    if (process.env.NODE_ENV !== "production") {
      console.log("[SIM][TRADE-SUMMARY]", {
        closedTradesCount,
        openedTrades,
        totalTrades,
        hasOpenPosition: !!lastSnapshot?.side,
      });
    }

    return {
      // Overview
      totalTrades,
      closedTradesCount,
      profitableTrades,
      profitFactor,
      
      // Performance
      initialCapital,
      openPnl,
      netProfit,
      netProfitLong,
      netProfitShort,
      grossProfit,
      grossLoss,
      grossProfitLong,
      grossLossLong,
      grossProfitShort,
      grossLossShort,
      swapFeesTotal,
      
      // Trades analysis
      totalLong,
      totalShort,
      totalOpen,
      openLong,
      openShort,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winningLong: winningLong.length,
      losingLong: losingLong.length,
      winningShort: winningShort.length,
      losingShort: losingShort.length,
      pctProfitable,
      pctProfitableLong,
      pctProfitableShort,
      avgPnl,
      avgPnlLong,
      avgPnlShort,
      avgWin,
      avgLoss,
      avgWinLong,
      avgLossLong,
      avgWinShort,
      avgLossShort,
      ratioWinLoss,
      ratioWinLossLong,
      ratioWinLossShort,
      largestWin,
      largestLoss,
      largestWinLong,
      largestLossLong,
      largestWinShort,
      largestLossShort,
      avgBarsInTrades,
      avgBarsInWinning,
      avgBarsInLosing,
      
      // Risk/performance ratios
      profitFactorLong,
      profitFactorShort,
      
      // Raw trades for List of trades
      allTrades: allTrades.sort((a, b) => {
        // Sort by entry date descending (newest first)
        const dateA = a.entryDate || "";
        const dateB = b.entryDate || "";
        return dateB.localeCompare(dateA);
      }),
    };
  }, [activeSimWindow, summaryTrades, windowedAccountHistory]);

  const overviewStats = useMemo(() => {
    if (selectedOverviewStats) {
      return {
        pnlAbs: selectedOverviewStats.pnlAbs ?? equitySummary.pnlAbs,
        pnlPct: selectedOverviewStats.pnlPct ?? equitySummary.pnlPct,
        maxDrawdownAbs:
          selectedOverviewStats.maxDrawdownAbs ?? equitySummary.maxDrawdownAbs,
        maxDrawdownPct:
          selectedOverviewStats.maxDrawdownPct ?? equitySummary.maxDrawdownPct,
        totalTrades:
          selectedOverviewStats.totalTrades ?? tradeSummary.totalTrades ?? 0,
        profitableTrades:
          selectedOverviewStats.profitableTrades ?? tradeSummary.profitableTrades ?? 0,
        pctProfitable:
          selectedOverviewStats.pctProfitable ?? tradeSummary.pctProfitable ?? null,
        profitFactor:
          selectedOverviewStats.profitFactor ?? tradeSummary.profitFactor ?? null,
        label: selectedOverviewStats.label,
        asOfDate: selectedOverviewStats.asOfDate,
      };
    }
    return {
      pnlAbs: equitySummary.pnlAbs,
      pnlPct: equitySummary.pnlPct,
      maxDrawdownAbs: equitySummary.maxDrawdownAbs,
      maxDrawdownPct: equitySummary.maxDrawdownPct,
      totalTrades: tradeSummary.totalTrades ?? 0,
      profitableTrades: tradeSummary.profitableTrades ?? 0,
      pctProfitable: tradeSummary.pctProfitable ?? null,
      profitFactor: tradeSummary.profitFactor ?? null,
      label: null,
      asOfDate: hoveredDate ?? null,
    };
  }, [equitySummary, hoveredDate, selectedOverviewStats, tradeSummary]);

  useEffect(() => {
      console.log('[UI] Simulation header metrics', {
        simulationMode,
        equitySummary: {
          pnlAbs: equitySummary.pnlAbs,
          pnlPct: equitySummary.pnlPct,
          maxDrawdownAbs: equitySummary.maxDrawdownAbs,
          maxDrawdownPct: equitySummary.maxDrawdownPct,
        },
        tradeSummary: {
          totalTrades: tradeSummary.totalTrades,
          profitableTrades: tradeSummary.profitableTrades,
          closedTradesCount: tradeSummary.closedTradesCount,
          profitFactor: tradeSummary.profitFactor,
          closedTradesCountLog: tradeSummary.closedTradesCount,
          openedTradesLog: tradeSummary.totalTrades - tradeSummary.closedTradesCount,
        },
      });
  }, [simulationMode, equitySummary, tradeSummary]);

  // Additional derived stats for the insight tabs (buy & hold, size, risk ratios)
  const insightStats = useMemo(() => {
    const priceSeries = chartDataWithEquity.filter((p) => p.close != null);
    const firstPrice = priceSeries[0]?.close ?? null;
    const lastPrice = priceSeries[priceSeries.length - 1]?.close ?? null;

    const buyHoldPct =
      firstPrice != null && lastPrice != null && firstPrice !== 0
        ? (lastPrice - firstPrice) / firstPrice
        : null;
    const buyHoldAbs =
      buyHoldPct != null && tradeSummary.initialCapital != null
        ? tradeSummary.initialCapital * buyHoldPct
        : null;

    const maxContractsHeld = Math.max(
      0,
      ...flattenedTrades.map((t) => {
        const qty = t.quantity ?? 0;
        return Number.isFinite(qty) ? Math.abs(qty) : 0;
      })
    );

    const riskRatios = {
      sharpe: riskMetrics.sharpeRatio,
      sortino: riskMetrics.sortinoRatio,
      profitFactorAll: tradeSummary.profitFactor ?? null,
      profitFactorLong: tradeSummary.profitFactorLong ?? null,
      profitFactorShort: tradeSummary.profitFactorShort ?? null,
      marginCalls: 0,
    };

    return { buyHoldAbs, buyHoldPct, maxContractsHeld, riskRatios };
  }, [chartDataWithEquity, flattenedTrades, riskMetrics, tradeSummary]);

  // Equity run-up / drawdown stats (value + duration)
  const performanceSeriesStats = useMemo(() => {
    const series = chartDataWithEquity
      .filter((p) => p.equity != null && Number.isFinite(p.equity as number) && p.date)
      .map((p) => ({ equity: p.equity as number, date: new Date(p.date as string) }))
      .filter((p) => !Number.isNaN(p.date.getTime()))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    if (series.length < 2) {
      return {
        avgRunUpDuration: null,
        maxRunUpDuration: null,
        avgDrawdownDuration: null,
        maxDrawdownDuration: null,
        avgRunUpValue: null,
        maxRunUpValue: null,
        avgDrawdownValue: null,
        maxDrawdownValue: equityStatsBase.maxDrawdownAbs ?? null,
      };
    }

    const dayDiff = (prev: { date: Date }, curr: { date: Date }) => {
      const diff = Math.max(1, Math.round((curr.date.getTime() - prev.date.getTime()) / (1000 * 60 * 60 * 24)));
      return Number.isFinite(diff) ? diff : 1;
    };

    let upLen = 0;
    let upVal = 0;
    let downLen = 0;
    let downVal = 0;
    const upLens: number[] = [];
    const upVals: number[] = [];
    const downLens: number[] = [];
    const downVals: number[] = [];

    for (let i = 1; i < series.length; i++) {
      const d = series[i].equity - series[i - 1].equity;
      const span = dayDiff(series[i - 1], series[i]);
      if (d > 0) {
        upLen += span;
        upVal += d;
        if (downLen > 0) {
          downLens.push(downLen);
          downVals.push(downVal);
          downLen = 0;
          downVal = 0;
        }
      } else if (d < 0) {
        downLen += span;
        downVal += Math.abs(d);
        if (upLen > 0) {
          upLens.push(upLen);
          upVals.push(upVal);
          upLen = 0;
          upVal = 0;
        }
      } else {
        // flat day ends streaks
        if (upLen > 0) {
          upLens.push(upLen);
          upVals.push(upVal);
          upLen = 0;
          upVal = 0;
        }
        if (downLen > 0) {
          downLens.push(downLen);
          downVals.push(downVal);
          downLen = 0;
          downVal = 0;
        }
      }
    }
    if (upLen > 0) {
      upLens.push(upLen);
      upVals.push(upVal);
    }
    if (downLen > 0) {
      downLens.push(downLen);
      downVals.push(downVal);
    }

    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    const max = (arr: number[]) => (arr.length ? Math.max(...arr) : null);

    return {
      avgRunUpDuration: avg(upLens),
      maxRunUpDuration: max(upLens),
      avgDrawdownDuration: avg(downLens),
      maxDrawdownDuration: max(downLens),
      avgRunUpValue: avg(upVals),
      maxRunUpValue: max(upVals),
      avgDrawdownValue: avg(downVals),
      maxDrawdownValue: equityStatsBase.maxDrawdownAbs ?? max(downVals) ?? null,
    };
  }, [chartDataWithEquity, equityStatsBase.maxDrawdownAbs]);

  // Helpers for the performance table
  const perfInitialEquity = tradeSummary.initialCapital ?? equityStatsBase.baseEquity ?? 0;
  const pctOfPerfInitial = (v: number | null | undefined) => {
    if (perfInitialEquity <= 0 || v == null || typeof v !== "number" || !Number.isFinite(v)) return "—";
    return formatPct(v / perfInitialEquity);
  };
  const durationLabel = (v: number | null | undefined) => {
    if (v == null || typeof v !== "number" || !Number.isFinite(v)) return "—";
    return `${Math.round(v)} days`;
  };
  const perfAvgDrawdownValue = performanceSeriesStats.avgDrawdownValue != null ? -performanceSeriesStats.avgDrawdownValue : null;
  const perfMaxDrawdownValue = performanceSeriesStats.maxDrawdownValue != null ? -performanceSeriesStats.maxDrawdownValue : null;

  // Derivations for List of trades table (net P&L %, cumulative P&L, excursions)
  const tradeTableRows = useMemo(() => {
    const initial = perfInitialEquity > 0 ? perfInitialEquity : null;
    let cumulative = 0;
    return tradeSummary.allTrades.map((trade, idx) => {
      const tradeNum = tradeSummary.allTrades.length - idx;
      const basis = (trade.entryPrice ?? 0) * (trade.quantity ?? 0);
      const pnlAbs = trade.netPnl ?? 0;
      const pnlPct = basis ? pnlAbs / basis : null;
      cumulative += pnlAbs;
      const cumulativePct = initial ? cumulative / initial : null;
      const runUpAbs = trade.runUp ?? null;
      const runUpPct = runUpAbs != null && basis ? runUpAbs / basis : null;
      const drawdownAbs = trade.drawdown != null ? -Math.abs(trade.drawdown) : null;
      const drawdownPct = drawdownAbs != null && basis ? drawdownAbs / basis : null;
      return {
        trade,
        tradeNum,
        pnlAbs,
        pnlPct,
        cumulativeAbs: cumulative,
        cumulativePct,
        basis,
        runUpAbs,
        runUpPct,
        drawdownAbs,
        drawdownPct,
      };
    });
  }, [perfInitialEquity, tradeSummary.allTrades]);

  // === Trade Marker Types and Data ===
  type TradeMarkerType = 'entry' | 'exit' | 'pair';

  interface TradeMarker {
    date: string;
    type: TradeMarkerType;
    side: 'long' | 'short';
    runId: string;
    label: string;
    color: string;
    netPnl?: number;
    margin?: number;
    // Additional fields for detail card
    entryDate?: string;
    entryPrice?: number;
    exitDate?: string;
    exitPrice?: number;
    entrySide?: 'long' | 'short';
    exitSide?: 'long' | 'short';
  }

  const getTrianglePath = (
    cx: number,
    cy: number,
    dir: 'up' | 'down',
    width = 10,
    height = 8
  ) => {
    const halfW = width / 2;
    const halfH = height / 2;

    if (dir === 'up') {
      return [
        `M ${cx} ${cy - halfH}`, // tip
        `L ${cx - halfW} ${cy + halfH}`,
        `L ${cx + halfW} ${cy + halfH}`,
        'Z',
      ].join(' ');
    }

    // down
    return [
      `M ${cx} ${cy + halfH}`, // tip
      `L ${cx - halfW} ${cy - halfH}`,
      `L ${cx + halfW} ${cy - halfH}`,
      'Z',
    ].join(' ');
  };

  const TradeTriangleMarker: React.FC<{
    cx?: number;
    cy?: number;
    dir: 'up' | 'down';
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    width?: number;
    height?: number;
  }> = ({
    cx,
    cy,
    dir,
    fill = 'transparent',
    stroke = 'none',
    strokeWidth = 1.5,
    width = 10,
    height = 8,
  }) => {
    if (cx == null || cy == null) return null;
    const d = getTrianglePath(cx, cy, dir, width, height);
    return (
      <path
        d={d}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    );
  };

  // Custom shape for same-day open/close marker (stacked triangles)
  const PairTradeMarkerShape: React.FC<any> = (props) => {
    const { cx, cy, marker, isDarkMode: isDark } = props as {
      cx: number;
      cy: number;
      marker: TradeMarker;
      isDarkMode: boolean;
    };

    if (cx == null || cy == null || !marker) return null;

    const entrySide = marker.entrySide ?? marker.side;
    const exitSide = marker.exitSide ?? marker.side;

    const longFill = 'rgba(34, 197, 94, 1)';
    const shortFill = 'rgba(248, 113, 113, 1)';

    const entryFill = entrySide === 'short' ? shortFill : longFill;
    const exitStroke = exitSide === 'short' ? 'rgba(248, 113, 113, 0.9)' : 'rgba(34, 197, 94, 0.9)';
    const exitFill = isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(248, 250, 252, 0.95)';

    const offsetY = 7;
    const width = 10;
    const height = 8;

    const exitPath = getTrianglePath(cx, cy - offsetY, 'down', width, height);
    const entryPath = getTrianglePath(cx, cy + offsetY, 'up', width, height);

    return (
      <g>
        <path
          d={exitPath}
          fill={exitFill}
          stroke={exitStroke}
          strokeWidth={2}
          strokeLinejoin="round"
        />
        <path
          d={entryPath}
          fill={entryFill}
          stroke="transparent"
          strokeWidth={0}
          strokeLinejoin="round"
        />
        {/* Generous hover target */}
        <circle cx={cx} cy={cy} r={12} fill="transparent" pointerEvents="all" />
      </g>
    );
  };

  // Type for tooltip events (opens AND closes)
  type Trading212TooltipEventType = 'open' | 'close';

  interface Trading212TooltipEvent {
    type: Trading212TooltipEventType;
    runId: string;
    runLabel: string;
    source?: "windowSim" | "globalFallback";
    side: 'long' | 'short';
    entryDate: string;
    entryPrice: number;
    exitDate?: string;
    exitPrice?: number;
    netPnl?: number;
    margin?: number;
  }

  // Build flat array of trade markers from overlays
  // Uses event grouping to avoid duplicate dots when exit+entry happen on same day
  const tradeMarkers = useMemo<TradeMarker[]>(() => {
    if (!tradeOverlays || tradeOverlays.length === 0) return [];

    type RawEvent = {
      date: string;
      type: 'entry' | 'exit';
      side: 'long' | 'short';
      runId: string;
      label: string;
      color: string;
      netPnl?: number;
      margin?: number;
    };

    // date+runId -> events on that day for that run
    const eventsByKey = new Map<string, RawEvent[]>();

    for (const overlay of tradeOverlays) {
      const color = overlay.color ?? '#A855F7';

      for (const trade of overlay.trades) {
        const entryDate = normalizeDateString(trade.entryDate);
        const exitDate = normalizeDateString(trade.exitDate);

        const base = {
          side: trade.side,
          runId: overlay.runId,
          label: overlay.label,
          color,
          margin: trade.margin,
        };

        const entryKey = `${overlay.runId}|${entryDate}`;
        const exitKey = `${overlay.runId}|${exitDate}`;

        const entryEvents = eventsByKey.get(entryKey) ?? [];
        entryEvents.push({ date: entryDate, type: 'entry', ...base });
        eventsByKey.set(entryKey, entryEvents);

        const exitEvents = eventsByKey.get(exitKey) ?? [];
        exitEvents.push({
          date: exitDate,
          type: 'exit',
          netPnl: trade.netPnl,
          ...base,
        });
        eventsByKey.set(exitKey, exitEvents);
      }
    }

    const markers: TradeMarker[] = [];

    // Turn events into actual markers
    eventsByKey.forEach((events) => {
      const hasEntry = events.some((e) => e.type === 'entry');
      const hasExit = events.some((e) => e.type === 'exit');

      if (hasEntry && hasExit) {
        const entryEvent = events.find((e) => e.type === 'entry') as RawEvent;
        const exitEvent = events.find((e) => e.type === 'exit') as RawEvent;

        markers.push({
          date: entryEvent.date,
          type: 'pair',
          side: entryEvent.side ?? exitEvent.side,
          runId: entryEvent.runId,
          label: entryEvent.label,
          color: entryEvent.color,
          netPnl: exitEvent.netPnl ?? entryEvent.netPnl,
          margin: exitEvent.margin ?? entryEvent.margin,
          entrySide: entryEvent.side,
          exitSide: exitEvent.side,
        });
        return;
      }

      // Only entries OR only exits on this day → render individually
      events.forEach((e: RawEvent) => {
        markers.push({
          date: e.date,
          type: e.type,
          side: e.side,
          runId: e.runId,
          label: e.label,
          color: e.color,
          netPnl: e.netPnl,
          margin: e.margin,
        });
      });
    });

    return markers;
  }, [tradeOverlays]);

  // Map from date -> array of events (opens AND closes) for tooltip display
  const trading212EventsByDate = useMemo(() => {
    const map = new Map<string, Trading212TooltipEvent[]>();

    if (!tradeOverlays || tradeOverlays.length === 0) return map;

    for (const overlay of tradeOverlays) {
      for (const trade of overlay.trades) {
        const entryDate = normalizeDateString(trade.entryDate);
        const exitDate = normalizeDateString(trade.exitDate);

        const base = {
          runId: overlay.runId,
          runLabel: overlay.label,
          source: overlay.source,
          side: trade.side,
        };

        // Open event
        const openEvents = map.get(entryDate) ?? [];
        openEvents.push({
          type: 'open',
          entryDate,
          entryPrice: trade.entryPrice,
          ...base,
        });
        map.set(entryDate, openEvents);

        // Close event
        const closeEvents = map.get(exitDate) ?? [];
        closeEvents.push({
          type: 'close',
          entryDate,
          entryPrice: trade.entryPrice,
          exitDate,
          exitPrice: trade.exitPrice,
          netPnl: trade.netPnl,
          margin: trade.margin,
          ...base,
        });
        map.set(exitDate, closeEvents);
      }
    }

    return map;
  }, [tradeOverlays]);

  // Map from date -> close price for ReferenceDot Y positioning
  const dateToClose = useMemo(() => {
    const map = new Map<string, number>();
    chartDataWithForecastBand.forEach((pt) => {
      if (pt.date && pt.close != null) {
        map.set(pt.date, pt.close);
      }
    });
    return map;
  }, [chartDataWithForecastBand]);

  // Map from date -> index in fullData (for zoom anchoring)
  const dateToIndex = useMemo(() => {
    const map = new Map<string, number>();
    fullData.forEach((pt, idx) => {
      if (pt.date) {
        map.set(normalizeDateString(pt.date), idx);
      }
    });
    return map;
  }, [fullData]);

  // Map from date -> index in current chart data for fast hover updates
  const dateToChartIndex = useMemo(() => {
    const map = new Map<string, number>();
    chartDataWithEquity.forEach((pt, idx) => {
      if (pt.date) {
        map.set(pt.date, idx);
      }
    });
    return map;
  }, [chartDataWithEquity]);

  // Hover sync helpers (price + equity)
  const applyHoverFromRechartsState = useCallback(
    (state: any) => {
      if (!state || chartDataWithEquity.length === 0) {
        pendingHoverIndexRef.current = null;
        if (hoverRafRef.current != null) {
          cancelAnimationFrame(hoverRafRef.current);
          hoverRafRef.current = null;
        }
        setHoverIndex(null);
        hoveredIndexRef.current = null;
        return;
      }

      const idxFromTooltip =
        typeof state.activeTooltipIndex === "number"
          ? state.activeTooltipIndex
          : null;

      let idx = idxFromTooltip;
      const label = state.activeLabel as string | undefined;
      if (idx == null || idx < 0 || idx >= chartDataWithEquity.length) {
        idx = label ? dateToChartIndex.get(label) ?? -1 : -1;
      }

      if (idx == null || idx < 0 || idx >= chartDataWithEquity.length) {
        return;
      }

      if (idx === hoveredIndexRef.current && idx === hoverIndex) {
        return;
      }

      pendingHoverIndexRef.current = idx;
      if (hoverRafRef.current == null) {
        hoverRafRef.current = requestAnimationFrame(() => {
          hoverRafRef.current = null;
          if (pendingHoverIndexRef.current == null) return;
          const next = pendingHoverIndexRef.current;
          setHoverIndex(next);
          const fullIdx = label ? dateToIndex.get(label) ?? next : next;
          hoveredIndexRef.current = fullIdx;
        });
      }
    },
    [chartDataWithEquity, dateToChartIndex, hoverIndex, dateToIndex]
  );

  const handleChartMouseLeave = useCallback(() => {
    pendingHoverIndexRef.current = null;
    if (hoverRafRef.current != null) {
      cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = null;
    }
    setHoverIndex(null);
    hoveredIndexRef.current = null;
  }, []);

  // Helper to get Y coordinate for a trade marker
  // Entry markers get a small offset so they're visible even on same-day trades
  const getMarkerY = useCallback((marker: TradeMarker): number | undefined => {
    const close = dateToClose.get(marker.date);
    if (close == null) return undefined;

    // Small cosmetic offset for entries so they are visible even if exit is same-day
    if (marker.type === 'entry') {
      return close * 0.997; // ~0.3% below the line
    }

    return close; // exits sit exactly on the close price
  }, [dateToClose]);

  // Update the chart click handler ref whenever dependencies change
  // This ensures the onClick in useMemo always has access to current values
  useEffect(() => {
    chartClickHandlerRef.current = (state: any) => {
      if (!state) return;

      // Prefer activeLabel (what Recharts provides on click)
      const date: string | undefined =
        (state.activeLabel as string | undefined) ??
        state.activePayload?.[0]?.payload?.date;

      if (!date) return;

      // Look up all Trading212 events for this date
      const events = trading212EventsByDate?.get(date) ?? [];
      if (events.length === 0) return;

      // Prefer a 'close' event for the banner; if none, fall back to first event
      const primaryClose = events.find((e) => e.type === "close") ?? events[0];

      // For days with only opens, treat exit as equal to entry
      const exitDate = primaryClose.exitDate ?? date;
      const exitPrice = primaryClose.exitPrice ?? primaryClose.entryPrice;

      const detail: TradeDetailData = {
        runId: primaryClose.runId,
        runLabel: primaryClose.runLabel,
        side: primaryClose.side,
        entryDate: primaryClose.entryDate,
        entryPrice: primaryClose.entryPrice,
        exitDate,
        exitPrice,
        netPnl: primaryClose.netPnl ?? 0,
        margin: primaryClose.margin ?? 0,
        ticker: symbol,
        date,
        events,
      };

      setSelectedTrade(detail);
    };
  }, [trading212EventsByDate, symbol]);

  // Determine line color from current range performance
  const latestRangePerf = perfByRange[selectedRange];
  const isPositive = latestRangePerf != null ? latestRangePerf >= 0 : undefined;
  const lineColor = isPositive === false ? "#ef4444" : "#22c55e"; // Vibrant red or green with glow

  const chartFrameClasses = "relative w-full overflow-hidden rounded-3xl";

  const chartBg = chartFrameClasses;
  const containerClasses = `${className ?? ""} w-full`;

  // Memoized chart element to prevent re-renders when dropdown states change
  const memoizedChartElement = useMemo(() => {
    if (loading || error) return null;

    const chartDataForRender =
      chartDataWithEquity.length > 0
        ? chartDataWithEquity
        : chartDataWithForecastBand.length > 0
          ? chartDataWithForecastBand
          : chartDataWithEwma.length > 0
            ? chartDataWithEwma
            : chartData;

    if (!chartDataForRender || chartDataForRender.length === 0) return null;

    if (process.env.NODE_ENV !== "production") {
      console.log("[PriceChart] fullData window", {
        len: fullData.length,
        firstDate: fullData[0]?.date,
        lastDate: fullData[fullData.length - 1]?.date,
      });
    }

    console.log(
      "[PriceChart] data length:",
      chartDataForRender?.length,
      "sample:",
      chartDataForRender?.slice(0, 3),
      "range:",
      selectedRange,
      "showTrendEwma:",
      showTrendEwma
    );

    return (
      <div className="relative">
        {/* Volatility Model Info Badge - REMOVED as requested */}
        
        {/* Combined Price and Volume Chart */}
        <div
          ref={chartContainerRef}
          className="relative w-full"
          style={{ cursor: isDraggingRef.current ? 'grabbing' : 'grab' }}
          onMouseEnter={() => {
            setIsChartHovered(true);
          }}
          onMouseLeave={() => {
            setIsChartHovered(false);
            // Cancel dragging when leaving chart area
            isDraggingRef.current = false;
            dragStartXRef.current = null;
            dragStartWindowRef.current = null;
          }}
          onMouseDown={(e) => {
            if (fullData.length === 0) return;

            // Start drag
            isDraggingRef.current = true;
            dragStartXRef.current = e.clientX;

            const win = getCurrentWindow(fullData, selectedRange, viewStartIdx, viewEndIdx);
            if (win) {
              dragStartWindowRef.current = { start: win.start, end: win.end };
            } else {
              dragStartWindowRef.current = null;
            }

            // Prevent text selection during drag
            e.preventDefault();
          }}
          onMouseUp={() => {
            isDraggingRef.current = false;
            dragStartXRef.current = null;
            dragStartWindowRef.current = null;
          }}
          onMouseMove={(e) => {
            if (!isDraggingRef.current || !dragStartWindowRef.current) return;
            if (!chartContainerRef.current) return;

            const rect = chartContainerRef.current.getBoundingClientRect();
            const windowSize =
              dragStartWindowRef.current.end - dragStartWindowRef.current.start + 1;
            if (windowSize <= 0 || rect.width <= 0) return;

            const dxPixels = e.clientX - (dragStartXRef.current ?? e.clientX);
            const pixelsPerBar = rect.width / windowSize;
            if (!pixelsPerBar || !isFinite(pixelsPerBar)) return;

            const barOffset = Math.round(-dxPixels / pixelsPerBar);
            if (barOffset !== 0) {
              applyPanOffset(barOffset);
              // Update drag start to current position for continuous dragging
              dragStartXRef.current = e.clientX;
            dragStartWindowRef.current = {
              start: dragStartWindowRef.current.start + barOffset,
              end: dragStartWindowRef.current.end + barOffset,
            };
          }
        }}
        >
          <ResponsiveContainer 
            width="100%" 
            height={500}
            >
            <ComposedChart
              data={chartDataForRender}
              margin={CHART_MARGIN}
              syncId={SYNC_ID}
              barCategoryGap={sharedBarSizing.barCategoryGap}
              barGap={sharedBarSizing.barGap}
              onClick={(state: any) => {
                chartClickHandlerRef.current?.(state);
              }}
              onMouseMove={applyHoverFromRechartsState}
              onMouseLeave={handleChartMouseLeave}
            >
                <defs>
                  <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lineColor} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="momentumScoreFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
                  </linearGradient>
                  {/* Trend EWMA short (yellow) glow filter */}
                  <filter id="trendEwmaShortGlow" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="3" result="blur"/>
                    <feFlood floodColor="#fbbf24" floodOpacity="0.6" result="color"/>
                    <feComposite in="color" in2="blur" operator="in" result="shadow"/>
                    <feMerge>
                      <feMergeNode in="shadow"/>
                      <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                  </filter>
                  {/* Trend EWMA long (blue) glow filter */}
                  <filter id="trendEwmaLongGlow" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="3" result="blur"/>
                    <feFlood floodColor="#3b82f6" floodOpacity="0.6" result="color"/>
                    <feComposite in="color" in2="blur" operator="in" result="shadow"/>
                    <feMerge>
                      <feMergeNode in="shadow"/>
                      <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                  </filter>
                  {/* Glowing red filter for price line (negative performance) */}
                  <filter id="priceLineGlowRed" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="3" result="blur"/>
                    <feFlood floodColor="#ef4444" floodOpacity="0.7" result="color"/>
                    <feComposite in="color" in2="blur" operator="in" result="shadow"/>
                    <feMerge>
                      <feMergeNode in="shadow"/>
                      <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                  </filter>
                  {/* Glowing green filter for price line (positive performance) */}
                  <filter id="priceLineGlowGreen" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="3" result="blur"/>
                    <feFlood floodColor="#22c55e" floodOpacity="0.7" result="color"/>
                    <feComposite in="color" in2="blur" operator="in" result="shadow"/>
                    <feMerge>
                      <feMergeNode in="shadow"/>
                      <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                  </filter>
                  {/* Legacy glow filter - kept for backward compatibility */}
                  <filter id="priceLineGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="2.5" result="blur"/>
                    <feFlood floodColor="#22c55e" floodOpacity="0.5" result="color"/>
                    <feComposite in="color" in2="blur" operator="in" result="shadow"/>
                    <feMerge>
                      <feMergeNode in="shadow"/>
                      <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                  </filter>
                  {/* Soft blur filter for volume bars */}
                  <filter id="volumeBlur" x="-10%" y="-10%" width="120%" height="120%">
                    <feGaussianBlur stdDeviation="0.8" result="blur"/>
                    <feMerge>
                      <feMergeNode in="blur"/>
                      <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                  </filter>
                </defs>

            <XAxis
              dataKey="date"
              type="category"
              allowDuplicatedCategory={false}
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              minTickGap={50}
              padding={{ left: 0, right: 0 }}
              interval="preserveStartEnd"
              tick={{
                fontSize: 10,
                fill: isDarkMode ? "rgba(148, 163, 184, 0.7)" : "rgba(75, 85, 99, 0.7)",
              }}
              tickFormatter={formatXAxisDate}
            />
            
            {/* Price Y-Axis */}
          <YAxis
            yAxisId="price"
            orientation="right"
            axisLine={false}
            tickLine={false}
            tickMargin={8}
            width={Y_AXIS_WIDTH}
            tick={{
              fontSize: 10,
              fill: isDarkMode ? "rgba(148, 163, 184, 0.9)" : "rgba(75, 85, 99, 0.9)",
            }}
            domain={priceYDomain}
            tickFormatter={(v: number) => v.toFixed(0)}
          />
            
            {/* Volume Y-Axis (positioned at bottom) */}
            <YAxis
              yAxisId="volume"
              orientation="right"
              axisLine={false}
              tickLine={false}
              tick={false}
              width={0}
              domain={[0, (dataMax: number) => dataMax * 15]}
            />

            <Tooltip
              content={(tooltipProps) => (
                <PriceTooltip
                  {...tooltipProps}
                  isDarkMode={isDarkMode}
                  horizon={h}
                  trading212EventsByDate={trading212EventsByDate}
                  ewmaShortWindow={ewmaShortWindow}
                  ewmaLongWindow={ewmaLongWindow}
                />
              )}
              cursor={false}
              animationDuration={0}
              isAnimationActive={false}
            />
            
            {/* Live Price Reference Line - horizontal dotted line with price pill */}
            {livePrice != null && (
              <ReferenceLine
                y={livePrice}
                yAxisId="price"
                stroke="#F87171"
                strokeDasharray="3 3"
                strokeWidth={1}
                ifOverflow="extendDomain"
                label={{
                  position: "right",
                  content: ({ viewBox }: any) => {
                    // viewBox for horizontal line: { x, y, width, height }
                    const { x, y, width } = viewBox;
                    const text = `$${livePrice.toFixed(2)}`;
                    const pillWidth = 48;
                    const pillHeight = 16;
                    // Position pill at the right edge where the dotted line ends
                    const pillX = (x || 0) + (width || 0) - pillWidth - 6;
                    const pillY = y - pillHeight / 2;
                    return (
                      <g>
                        <rect
                          x={pillX}
                          y={pillY}
                          width={pillWidth}
                          height={pillHeight}
                          rx={3}
                          ry={3}
                          fill="#F87171"
                          fillOpacity={0.75}
                          stroke="#EF4444"
                          strokeWidth={1}
                          strokeOpacity={0.8}
                        />
                        <text
                          x={pillX + pillWidth / 2}
                          y={pillY + pillHeight / 2}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="#FFFFFF"
                          fontSize={10}
                          fontWeight={600}
                        >
                          {text}
                        </text>
                      </g>
                    );
                  },
                }}
              />
            )}
            
            {/* Long Position Reference Line - Blue */}
            {longPrice != null && (
              <ReferenceLine
                y={longPrice}
                yAxisId="price"
                stroke="#3B82F6"
                strokeDasharray="3 3"
                strokeWidth={1}
                ifOverflow="extendDomain"
                label={{
                  position: "right",
                  content: ({ viewBox }: any) => {
                    const { x, y, width } = viewBox;
                    const text = `$${longPrice.toFixed(2)}`;
                    const pillWidth = 48;
                    const pillHeight = 16;
                    const pillX = (x || 0) + (width || 0) - pillWidth - 6;
                    const pillY = y - pillHeight / 2;
                    return (
                      <g>
                        {/* Glow effect */}
                        <rect
                          x={pillX - 2}
                          y={pillY - 2}
                          width={pillWidth + 4}
                          height={pillHeight + 4}
                          rx={5}
                          ry={5}
                          fill="#3B82F6"
                          fillOpacity={0.25}
                        />
                        <rect
                          x={pillX}
                          y={pillY}
                          width={pillWidth}
                          height={pillHeight}
                          rx={3}
                          ry={3}
                          fill="#3B82F6"
                          fillOpacity={0.75}
                          stroke="#3B82F6"
                          strokeWidth={1}
                          strokeOpacity={0.8}
                        />
                        <text
                          x={pillX + pillWidth / 2}
                          y={pillY + pillHeight / 2}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="#FFFFFF"
                          fontSize={10}
                          fontWeight={600}
                        >
                          {text}
                        </text>
                      </g>
                    );
                  },
                }}
              />
            )}
            
            {/* Short Position Reference Line - Red */}
            {shortPrice != null && (
              <ReferenceLine
                y={shortPrice}
                yAxisId="price"
                stroke="#EF4444"
                strokeDasharray="3 3"
                strokeWidth={1}
                ifOverflow="extendDomain"
                label={{
                  position: "right",
                  content: ({ viewBox }: any) => {
                    const { x, y, width } = viewBox;
                    const text = `$${shortPrice.toFixed(2)}`;
                    const pillWidth = 48;
                    const pillHeight = 16;
                    const pillX = (x || 0) + (width || 0) - pillWidth - 6;
                    const pillY = y - pillHeight / 2;
                    return (
                      <g>
                        {/* Glow effect */}
                        <rect
                          x={pillX - 2}
                          y={pillY - 2}
                          width={pillWidth + 4}
                          height={pillHeight + 4}
                          rx={5}
                          ry={5}
                          fill="#EF4444"
                          fillOpacity={0.25}
                        />
                        <rect
                          x={pillX}
                          y={pillY}
                          width={pillWidth}
                          height={pillHeight}
                          rx={3}
                          ry={3}
                          fill="#EF4444"
                          fillOpacity={0.75}
                          stroke="#EF4444"
                          strokeWidth={1}
                          strokeOpacity={0.8}
                        />
                        <text
                          x={pillX + pillWidth / 2}
                          y={pillY + pillHeight / 2}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="#FFFFFF"
                          fontSize={10}
                          fontWeight={600}
                        >
                          {text}
                        </text>
                      </g>
                    );
                  },
                }}
              />
            )}
            
            {/* TEMP: Test dot at last historical point */}
            {lastHistoricalPoint && lastHistoricalPoint.close != null && (
              <ReferenceDot
                x={lastHistoricalPoint.date}
                y={lastHistoricalPoint.close}
                yAxisId="price"
                r={4}
                fill="orange"
                stroke="#0F172A"
                strokeWidth={1}
              />
            )}
            
            {/* Future boundary line */}
            {futureDates.length > 0 && (
              <ReferenceLine
                x={futureDates[0]}
                stroke={isDarkMode ? "rgba(148, 163, 184, 0.6)" : "rgba(107, 114, 128, 0.6)"}
                strokeDasharray="4 2"
                strokeWidth={1.5}
              />
            )}
            
            {/* Price Line - based on Close price */}
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="close"
              stroke={lineColor}
              strokeWidth={2}
              dot={false}
              activeDot={<AnimatedPriceDot stroke={lineColor} />}
              connectNulls={true}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={isPositive === false ? "url(#priceLineGlowRed)" : "url(#priceLineGlowGreen)"}
              isAnimationActive={false}
            />

            {/* Trend EWMA overlays (toggle-controlled) */}
            {showTrendEwma && chartHasTrendEwmaShort && (
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="trendEwmaShort"
                stroke={TREND_EWMA_SHORT_COLOR}
                strokeWidth={1.6}
                strokeOpacity={0.9}
                dot={false}
                connectNulls
                strokeLinecap="round"
                strokeLinejoin="round"
                isAnimationActive={false}
                filter="url(#trendEwmaShortGlow)"
              />
            )}
            {showTrendEwma && chartHasTrendEwmaLong && (
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="trendEwmaLong"
                stroke={TREND_EWMA_LONG_COLOR}
                strokeWidth={1.6}
                strokeOpacity={0.9}
                dot={false}
                connectNulls
                strokeLinecap="round"
                strokeLinejoin="round"
                isAnimationActive={false}
                filter="url(#trendEwmaLongGlow)"
              />
            )}

            {/* Trend cross triangles - DISABLED for debugging
            {showTrendEwma && trendCrossPoints.length > 0 && (
              <Scatter
                yAxisId="price"
                data={trendCrossPoints}
                dataKey="y"
                name="TrendCross"
                shape={renderTrendArrow}
                isAnimationActive={false}
              />
            )}
            */}
            
            {/* Volume Bars - bottom with modern emerald/rose colors and borders */}
            <Bar
              yAxisId="volume"
              dataKey="volume"
              fill="#666"
              radius={[2, 2, 0, 0]}
              maxBarSize={sharedBarSizing.maxBarSize}
            >
              {chartDataWithEquity.map((entry, index) => (
                <Cell 
                  key={`vol-${entry.date}-${index}`}
                  fill={entry.volumeColor || "rgba(100, 100, 100, 0.4)"} 
                  stroke={entry.volumeStroke || "rgba(100, 100, 100, 0.6)"}
                  strokeWidth={1}
                />
              ))}
            </Bar>
            
            {/* Trading212 Trade Markers using ReferenceDot for perfect alignment */}
            {tradeMarkers.map((m, idx) => {
              const y = getMarkerY(m);
              if (y == null) return null;

              const markerKey = `trade-${m.runId}-${m.type}-${m.date}-${idx}`;
              const commonProps = {
                x: m.date,
                y,
                yAxisId: "price" as const,
              };

              // Special case: same-day pair glyph (●──●)
              if (m.type === 'pair') {
                return (
                  <ReferenceDot
                    key={markerKey}
                    {...commonProps}
                    r={0}
                    shape={(dotProps: any) => (
                      <PairTradeMarkerShape
                        {...dotProps}
                        marker={m}
                        isDarkMode={isDarkMode}
                      />
                    )}
                  />
                );
              }

              // Standard entry/exit triangles
              const isEntry = m.type === 'entry';
              const isLong = m.side === 'long';

              // Color scheme:
              // Entry long: solid green dot
              // Entry short: solid red dot
              // Exit long: black core with green border
              // Exit short: black core with red border
              let fill: string;
              let stroke: string;

              if (isEntry && isLong) {
                fill = 'rgba(34, 197, 94, 1)';     // solid green
                stroke = 'transparent';
              } else if (isEntry && !isLong) {
                fill = 'rgba(248, 113, 113, 1)';   // solid red
                stroke = 'transparent';
              } else if (!isEntry && isLong) {
                fill = 'rgba(15, 23, 42, 1)';      // black core
                stroke = 'rgba(34, 197, 94, 0.9)'; // green border
              } else {
                // exit & short
                fill = 'rgba(15, 23, 42, 1)';       // black core
                stroke = 'rgba(248, 113, 113, 0.9)'; // red border
              }

              const r = isEntry ? 4 : 5;

              return (
                <ReferenceDot
                  key={markerKey}
                  {...commonProps}
                  r={r}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={1.5}
                  shape={(dotProps: any) => (
                    <TradeTriangleMarker
                      {...dotProps}
                      dir={isEntry ? 'up' : 'down'}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={isEntry ? 1.2 : 1.8}
                    />
                  )}
                />
              );
            })}

            {hoveredDate && priceYMinValue != null && priceYMaxValue != null && (() => {
              const hoverRefLineProps = {
                key: "hover-refline",
                x: hoveredDate,
                yAxisId: "price",
                segment: [
                  { x: hoveredDate, y: priceYMinValue },
                  { x: hoveredDate, y: priceYMaxValue },
                ],
                stroke: "#ffffff",
                strokeWidth: 2.2,
                strokeOpacity: 1,
                ifOverflow: "visible",
                isAnimationActive: false,
                animationDuration: 0,
              } as any;
              return <ReferenceLine {...hoverRefLineProps} />;
            })()}
            </ComposedChart>
          </ResponsiveContainer>

          {hasMomentumScorePane && (
            <div className="mt-4">
              <ResponsiveContainer width="100%" height={180}>
                <ComposedChart
                  data={chartDataWithEquity}
                  margin={{ ...CHART_MARGIN, top: 12, bottom: 12 }}
                  syncId={SYNC_ID}
                  barCategoryGap="0%"
                  barGap={0}
                  onMouseMove={applyHoverFromRechartsState}
                  onMouseLeave={handleChartMouseLeave}
                >
                  <defs>
                    <linearGradient id="momentumScoreFillPane" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>

                  <XAxis
                    dataKey="date"
                    type="category"
                    allowDuplicatedCategory={false}
                    scale="band"
                    axisLine={false}
                    tickLine={false}
                    tickMargin={8}
                    minTickGap={24}
                    padding={{ left: 0, right: 0 }}
                    tick={{
                      fontSize: 10,
                      fill: isDarkMode ? "rgba(148, 163, 184, 0.7)" : "rgba(75, 85, 99, 0.7)",
                    }}
                    tickFormatter={formatXAxisDate}
                    hide
                  />
                  <YAxis
                    yAxisId="momentum"
                    domain={[0, 100]}
                    orientation="right"
                    axisLine={false}
                    tickLine={false}
                    tickMargin={8}
                    ticks={[0, 25, 50, 75, 100]}
                    padding={{ top: 4, bottom: 8 }}
                    tick={{ fontSize: 10, fill: isDarkMode ? "#9ca3af" : "#6b7280" }}
                    width={Y_AXIS_WIDTH}
                  />
                  <YAxis
                    yAxisId="momentum-volume"
                    orientation="right"
                    width={0}
                    axisLine={false}
                    tickLine={false}
                    tick={false}
                    domain={[0, 1]}
                  />

                  <ReferenceLine
                    key="momentum-neutral"
                    yAxisId="momentum"
                    y={50}
                    stroke="#4b5563"
                    strokeDasharray="3 3"
                    label={{
                      value: "50 (neutral)",
                      fill: "#9ca3af",
                      position: "insideRight",
                      fontSize: 10,
                    }}
                  />
                  <ReferenceLine
                    key="momentum-lower"
                    yAxisId="momentum"
                    y={25}
                    stroke="#4b5563"
                    strokeDasharray="2 2"
                    ifOverflow="extendDomain"
                  />
                  <ReferenceLine
                    key="momentum-upper"
                    yAxisId="momentum"
                    y={75}
                    stroke="#4b5563"
                    strokeDasharray="2 2"
                    ifOverflow="extendDomain"
                  />
                  <ReferenceLine
                    key="momentum-zero"
                    yAxisId="momentum"
                    y={0}
                    stroke="#4b5563"
                    strokeDasharray="2 2"
                    ifOverflow="extendDomain"
                  />
                  <ReferenceLine
                    key="momentum-hundred"
                    yAxisId="momentum"
                    y={100}
                    stroke="#4b5563"
                    strokeDasharray="2 2"
                    ifOverflow="extendDomain"
                  />

                  <Tooltip
                    cursor={false}
                    animationDuration={0}
                    isAnimationActive={false}
                    content={
                      <MomentumTooltip
                        momentumPeriod={momentumPeriod}
                        adxPeriod={adxPeriod}
                      />
                    }
                  />

                  <Area
                    type="monotone"
                    dataKey="momentumScore"
                    yAxisId="momentum"
                    stroke="#22c55e"
                    strokeWidth={1.4}
                    fill="url(#momentumScoreFillPane)"
                    fillOpacity={0.25}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />

                  {adxSeriesSafe.length > 0 && (
                    <Line
                      type="monotone"
                      dataKey="adxValue"
                      yAxisId="momentum"
                      stroke="#a855f7"
                      strokeWidth={1.4}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls
                    />
                  )}

                  {hoveredDate && (
                    <ReferenceLine
                      key="momentum-hover-crosshair"
                      x={hoveredDate}
                      yAxisId="momentum"
                      segment={[
                        { x: hoveredDate, y: 0 },
                        { x: hoveredDate, y: 100 },
                      ]}
                      stroke="#ffffff"
                      strokeWidth={2.2}
                      strokeOpacity={1}
                      ifOverflow="visible"
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Hover Overlay Controls - Apple Liquid Glass style */}
          <div 
            className={`
              absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 
              px-1 py-1
              pointer-events-none
              ${isChartHovered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}
            `}
          >
            {/* Pan Left */}
            <button
              onClick={panLeft}
              disabled={!canPanLeft || loading || fullData.length === 0}
              className={`
                pointer-events-auto
                w-10 h-10 rounded-full text-lg font-extralight transition-all duration-200 flex items-center justify-center
                backdrop-blur-3xl
                ${isDarkMode 
                  ? 'bg-transparent hover:bg-white/[0.04] active:bg-white/[0.08] text-white hover:text-white border border-white/[0.05] hover:border-white/[0.12] shadow-[0_2px_16px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.02)] hover:shadow-[0_4px_24px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.06)] disabled:opacity-20'
                  : 'bg-transparent hover:bg-white/20 active:bg-white/35 text-black hover:text-black border border-black/[0.05] hover:border-black/[0.12] shadow-[0_2px_16px_rgba(0,0,0,0.03),inset_0_1px_0_rgba(255,255,255,0.3)] hover:shadow-[0_4px_24px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.5)] disabled:opacity-30'
                }
                disabled:cursor-not-allowed active:scale-95
              `}
              title="Pan left"
            >
              ‹
            </button>

            {/* Zoom Out */}
            <button
              onClick={zoomOut}
              disabled={!canZoomOut || loading || fullData.length === 0}
              className={`
                pointer-events-auto
                w-10 h-10 rounded-full text-lg font-extralight transition-all duration-200 flex items-center justify-center
                backdrop-blur-3xl
                ${isDarkMode 
                  ? 'bg-transparent hover:bg-white/[0.04] active:bg-white/[0.08] text-white hover:text-white border border-white/[0.05] hover:border-white/[0.12] shadow-[0_2px_16px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.02)] hover:shadow-[0_4px_24px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.06)] disabled:opacity-20'
                  : 'bg-transparent hover:bg-white/20 active:bg-white/35 text-black hover:text-black border border-black/[0.05] hover:border-black/[0.12] shadow-[0_2px_16px_rgba(0,0,0,0.03),inset_0_1px_0_rgba(255,255,255,0.3)] hover:shadow-[0_4px_24px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.5)] disabled:opacity-30'
                }
                disabled:cursor-not-allowed active:scale-95
              `}
              title="Zoom out"
            >
              −
            </button>

            {/* Reset */}
            <button
              onClick={resetViewWindow}
              disabled={!isZoomed || loading || fullData.length === 0}
              className={`
                pointer-events-auto
                w-10 h-10 rounded-full text-base font-extralight transition-all duration-200 flex items-center justify-center
                backdrop-blur-3xl
                ${isDarkMode 
                  ? 'bg-transparent hover:bg-white/[0.04] active:bg-white/[0.08] text-white hover:text-white border border-white/[0.05] hover:border-white/[0.12] shadow-[0_2px_16px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.02)] hover:shadow-[0_4px_24px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.06)] disabled:opacity-20'
                  : 'bg-transparent hover:bg-white/20 active:bg-white/35 text-black hover:text-black border border-black/[0.05] hover:border-black/[0.12] shadow-[0_2px_16px_rgba(0,0,0,0.03),inset_0_1px_0_rgba(255,255,255,0.3)] hover:shadow-[0_4px_24px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.5)] disabled:opacity-30'
                }
                disabled:cursor-not-allowed active:scale-95
              `}
              title="Reset zoom"
            >
              ⟳
            </button>

            {/* Zoom In */}
            <button
              onClick={zoomIn}
              disabled={!canZoomIn || loading || fullData.length === 0}
              className={`
                pointer-events-auto
                w-10 h-10 rounded-full text-lg font-extralight transition-all duration-200 flex items-center justify-center
                backdrop-blur-3xl
                ${isDarkMode 
                  ? 'bg-transparent hover:bg-white/[0.04] active:bg-white/[0.08] text-white hover:text-white border border-white/[0.05] hover:border-white/[0.12] shadow-[0_2px_16px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.02)] hover:shadow-[0_4px_24px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.06)] disabled:opacity-20'
                  : 'bg-transparent hover:bg-white/20 active:bg-white/35 text-black hover:text-black border border-black/[0.05] hover:border-black/[0.12] shadow-[0_2px_16px_rgba(0,0,0,0.03),inset_0_1px_0_rgba(255,255,255,0.3)] hover:shadow-[0_4px_24px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.5)] disabled:opacity-30'
                }
                disabled:cursor-not-allowed active:scale-95
              `}
              title="Zoom in"
            >
              +
            </button>

            {/* Pan Right */}
            <button
              onClick={panRight}
              disabled={!canPanRight || loading || fullData.length === 0}
              className={`
                pointer-events-auto
                w-10 h-10 rounded-full text-lg font-extralight transition-all duration-200 flex items-center justify-center
                backdrop-blur-3xl
                ${isDarkMode 
                  ? 'bg-transparent hover:bg-white/[0.04] active:bg-white/[0.08] text-white hover:text-white border border-white/[0.05] hover:border-white/[0.12] shadow-[0_2px_16px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.02)] hover:shadow-[0_4px_24px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.06)] disabled:opacity-20'
                  : 'bg-transparent hover:bg-white/20 active:bg-white/35 text-black hover:text-black border border-black/[0.05] hover:border-black/[0.12] shadow-[0_2px_16px_rgba(0,0,0,0.03),inset_0_1px_0_rgba(255,255,255,0.3)] hover:shadow-[0_4px_24px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.5)] disabled:opacity-30'
                }
                disabled:cursor-not-allowed active:scale-95
              `}
              title="Pan right"
            >
              ›
            </button>
          </div>
        </div>
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    chartDataWithEquity,
    chartDataWithForecastBand,
    chartDataWithEwma,
    chartData,
    lineColor,
    isDarkMode,
    priceYDomain,
    h,
    lastHistoricalPoint,
    futureDates,
    tradeMarkers,
    getMarkerY,
    trading212EventsByDate,
    dateToClose,
    // Overlay controls dependencies
    isChartHovered,
    canPanLeft,
    canPanRight,
    canZoomIn,
    canZoomOut,
    isZoomed,
    loading,
    fullData.length,
    panLeft,
    panRight,
    zoomIn,
    zoomOut,
    resetViewWindow,
    hoveredDate,
    showTrendEwma,
    hasTrendEwmaData,
    chartHasTrendEwmaShort,
    chartHasTrendEwmaLong,
    trendCrossPoints,
    renderTrendArrow,
    hasMomentumScore,
    momentumPeriod,
    selectedRange,
  ]);

  return (
    <div className={containerClasses}>
      {/* Range Selector + Position Controls - independent row below controls */}
      {perfByRange && (
        <div className="mt-7 mb-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative" ref={simRangeDropdownRef}>
              <button
                type="button"
                ref={simRangeButtonRef}
                onClick={() => setShowSimRangeMenu((v) => !v)}
                className={`
                  flex items-center gap-2 px-2 py-1 rounded-md transition border
                  ${isDarkMode
                    ? "text-white/80 hover:text-white hover:bg-white/5 border-slate-700/50"
                    : "text-slate-700 hover:text-slate-900 hover:bg-slate-100 border-gray-200"
                  }
                `}
              >
                <CalendarRangeIcon className="w-4 h-4" />
                <span className="font-mono text-xs">
                  {simRangeLabel || "Select range"}
                </span>
                <ChevronDownIcon className="w-3 h-3 opacity-70" />
              </button>
              {showSimRangeMenu && (
                <div
                  className={`absolute right-0 mt-2 w-full max-h-[420px] overflow-auto rounded-xl border shadow-2xl backdrop-blur-xl z-20 ${
                    isDarkMode
                      ? "bg-transparent border-slate-700/70 shadow-black/40"
                      : "bg-transparent border-gray-200 shadow-slate-400/40"
                  }`}
                  style={simRangeMenuWidth ? { width: simRangeMenuWidth } : undefined}
                >
                  <div className={`px-3 py-2 text-[11px] font-semibold ${isDarkMode ? "text-slate-200" : "text-gray-800"}`}>
                    Date range
                  </div>

                  <div className="px-3 pb-3">
                    <div className="grid grid-cols-2 gap-2">
                      {quickRangePresets.map((opt) => {
                        const isSelected = simComparePreset === opt.id;
                        const baseClasses = isSelected
                          ? isDarkMode
                            ? "bg-emerald-600/90 text-white ring-1 ring-emerald-300"
                            : "bg-emerald-500/90 text-white ring-1 ring-emerald-200"
                          : isDarkMode
                            ? "text-slate-200 hover:bg-slate-800/70"
                            : "text-gray-800 hover:bg-gray-50";
                        return (
                          <button
                            key={opt.id}
                            className={`relative rounded-lg px-2 py-1 text-[11px] font-semibold transition text-left ${baseClasses} ${opt.spanFull ? "col-span-2" : ""}`}
                            onClick={() => handleSimRangePreset(opt.id)}
                          >
                            <span>{opt.label}</span>
                            {isSelected && (
                              <CheckIcon className="w-4 h-4 absolute right-2 top-1/2 -translate-y-1/2" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className={isDarkMode ? "border-t border-slate-800/60" : "border-t border-gray-200"} />
                  <div className="px-3 py-3 space-y-2">
                    <div className={`text-[11px] font-semibold ${isDarkMode ? "text-slate-200" : "text-gray-800"}`}>
                      Custom date range
                    </div>
                    <div className="grid grid-cols-[auto_auto_auto] items-center gap-2">
                      <input
                        type="date"
                        value={customSimRangeStart}
                        onChange={(e) => setCustomSimRangeStart(e.target.value)}
                        className={`w-[100px] min-w-[95px] rounded-md border px-2 py-1 text-[11px] ${
                          isDarkMode
                            ? "bg-slate-900 border-slate-700 text-slate-100"
                            : "bg-white border-gray-300 text-gray-700"
                        }`}
                      />
                      <span className={isDarkMode ? "text-slate-500 text-[10px]" : "text-gray-500 text-[10px]"}>to</span>
                      <input
                        type="date"
                        value={customSimRangeEnd}
                        onChange={(e) => setCustomSimRangeEnd(e.target.value)}
                        className={`w-[100px] min-w-[95px] rounded-md border px-2 py-1 text-[11px] ${
                          isDarkMode
                            ? "bg-slate-900 border-slate-700 text-slate-100"
                            : "bg-white border-gray-300 text-gray-700"
                        }`}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={!customSimRangeStart || !customSimRangeEnd}
                      onClick={handleApplyCustomRange}
                      className={`w-full rounded-full px-3 py-2 text-[11px] font-semibold transition ${
                        !customSimRangeStart || !customSimRangeEnd
                          ? isDarkMode
                            ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                            : "bg-gray-100 text-gray-400 cursor-not-allowed"
                          : isDarkMode
                            ? "bg-emerald-600 text-white hover:bg-emerald-500"
                            : "bg-emerald-500 text-white hover:bg-emerald-600"
                      }`}
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Long/Short Position Controls */}
          <div className="flex items-center gap-2">
            {/* Long Button - Blue */}
            <button
              type="button"
              onClick={() => handlePositionClick('long')}
              className={`
                px-3 py-0.5 text-xs font-medium transition-all rounded-full border
                ${activePosition === 'long'
                  ? 'bg-blue-500/20 text-blue-400 border-blue-400/50'
                  : isDarkMode
                    ? 'text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 border-gray-600 hover:border-blue-400/50'
                    : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50 border-gray-300 hover:border-blue-400'
                }
              `}
            >
              Long
            </button>
            
            {/* Price Input Box */}
            <input
              type="text"
              value={positionPriceInput}
              onChange={(e) => handlePositionPriceChange(e.target.value)}
              onBlur={handlePositionPriceCommit}
              onKeyDown={handlePositionPriceKeyDown}
              placeholder={defaultPositionPrice?.toFixed(2) ?? '0.00'}
              disabled={!activePosition}
              className={`
                w-20 px-2 py-0.5 text-xs font-medium text-center rounded-md border transition-all
                ${activePosition
                  ? activePosition === 'long'
                    ? isDarkMode
                      ? 'bg-gray-800 text-blue-400 border-blue-400/40 placeholder-gray-600 focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30'
                      : 'bg-white text-blue-700 border-blue-300 placeholder-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-200'
                    : isDarkMode
                      ? 'bg-gray-800 text-red-400 border-red-400/40 placeholder-gray-600 focus:border-red-400 focus:ring-1 focus:ring-red-400/30'
                      : 'bg-white text-red-700 border-red-300 placeholder-gray-400 focus:border-red-500 focus:ring-1 focus:ring-red-200'
                  : isDarkMode
                    ? 'bg-gray-800/50 text-gray-600 border-gray-700 cursor-not-allowed'
                    : 'bg-gray-100 text-gray-400 border-gray-300 cursor-not-allowed'
                }
              `}
            />
            
            {/* Short Button - Red */}
            <button
              type="button"
              onClick={() => handlePositionClick('short')}
              className={`
                px-3 py-0.5 text-xs font-medium transition-all rounded-full border
                ${activePosition === 'short'
                  ? 'bg-red-500/20 text-red-400 border-red-400/50'
                  : isDarkMode
                    ? 'text-gray-400 hover:text-red-400 hover:bg-red-500/10 border-gray-600 hover:border-red-400/50'
                    : 'text-gray-500 hover:text-red-600 hover:bg-red-50 border-gray-300 hover:border-red-400'
                }
              `}
            >
              Short
            </button>
          </div>
        </div>
      )}
      
      {/* Chart Area */}
      <div className={chartBg}>
        {loading ? (
          <div className="flex h-[400px] items-center justify-center">
            <div className="flex flex-col items-center space-y-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></div>
              <div className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                {isSyncingHistory ? 'Syncing history from Yahoo…' : 'Loading chart...'}
              </div>
            </div>
          </div>
        ) : error ? (
          <div className={`flex h-[400px] flex-col items-center justify-center gap-2 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
            <div className="text-xs">{error}</div>
            {hasTriedSync && (
              <div className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                Could not find or sync historical data for this symbol.
              </div>
            )}
          </div>
        ) : chartDataWithEwma.length === 0 ? (
          <div className={`flex h-[400px] items-center justify-center text-xs ${isDarkMode ? 'text-muted-foreground' : 'text-gray-500'}`}>
            No historical data available.
          </div>
        ) : (
          <>
            {memoizedChartElement}
          </>
        )}
      </div>

      
      {true && (
        <div className="mt-6">
          {/* Header Row: Insight Pills (left) + Date Range (right) */}
          <div className="flex items-center justify-between mb-4">
            {/* Insight Pills */}
            <div className="flex flex-wrap gap-2 items-center">
              {["Overview", "Trades analysis", "Risk/performance ratios", "List of trades"].map((tab) => {
                const isActive = tab === activeInsightTab;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveInsightTab(tab as any)}
                    className={`
                      px-3.5 py-1.5 rounded-full text-xs font-medium transition-all
                      ${isActive
                        ? isDarkMode
                          ? "bg-white text-slate-900 shadow"
                          : "bg-slate-900 text-white shadow"
                        : isDarkMode
                          ? "bg-slate-800/70 text-slate-200 hover:bg-slate-700/80"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }
                    `}
                  >
                    {tab}
                  </button>
                );
              })}
              
              {/* Settings Button */}
              {horizonCoverage && (
                <div className="relative ml-1" ref={mainSettingsDropdownRef}>
                  <button
                    onClick={() => setShowMainSettingsDropdown(!showMainSettingsDropdown)}
                    className={`
                      w-7 h-7 flex items-center justify-center text-base rounded-full transition-colors border
                      ${showMainSettingsDropdown
                        ? isDarkMode 
                          ? 'border-blue-400 bg-blue-900/30 text-white' 
                          : 'border-blue-500 bg-blue-50 text-gray-900'
                        : isDarkMode 
                          ? 'border-gray-500 text-gray-300 hover:border-gray-400 hover:bg-gray-800/50' 
                          : 'border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-100'
                      }
                    `}
                    title="Settings"
                  >
                    ⋯
                  </button>
                  
                  {/* Settings Dropdown */}
                  {showMainSettingsDropdown && (
                    <div 
                      className={`
                        absolute top-full left-0 mt-2 z-50 w-72 px-3 py-3 rounded-xl shadow-2xl backdrop-blur-xl border
                        ${isDarkMode 
                          ? 'bg-gray-900/95 border-gray-600/30' 
                          : 'bg-white/95 border-gray-300/50'
                        }
                      `}
                    >
                      <div className="space-y-3">
                        {/* Horizon */}
                        <div>
                          <div className={`text-[10px] font-semibold mb-1.5 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            Horizon
                          </div>
                          <div className="flex gap-1.5">
                            {[1, 2, 3, 5].map((days) => (
                              <button
                                key={days}
                                onClick={() => horizonCoverage.onHorizonChange(days)}
                                disabled={horizonCoverage.isLoading}
                                className={`flex-1 py-1 text-xs rounded-lg transition-colors ${
                                  horizonCoverage.h === days 
                                    ? 'bg-blue-600 text-white font-medium' 
                                    : horizonCoverage.isLoading
                                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                      : isDarkMode 
                                        ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                              >
                                {days}D
                              </button>
                            ))}
                          </div>
                        </div>
                        
                        {/* Coverage */}
                        <div>
                          <div className={`text-[10px] font-semibold mb-1.5 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            Coverage
                          </div>
                          <div className="flex gap-1.5">
                            {[0.90, 0.95, 0.99].map((cov) => (
                              <button
                                key={cov}
                                onClick={() => horizonCoverage.onCoverageChange(cov)}
                                disabled={horizonCoverage.isLoading}
                                className={`flex-1 py-1 text-xs rounded-lg transition-colors ${
                                  horizonCoverage.coverage === cov 
                                    ? 'bg-blue-600 text-white font-medium' 
                                    : horizonCoverage.isLoading
                                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                      : isDarkMode 
                                        ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                              >
                                {(cov * 100).toFixed(0)}%
                              </button>
                            ))}
                          </div>
                        </div>
                        
                        {/* Volatility Model Settings */}
                        <div>
                          <div className={`text-[10px] font-semibold mb-1.5 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            Volatility Model
                          </div>
                          
                          {/* Model Selection Buttons */}
                          {horizonCoverage.volModel && horizonCoverage.onModelChange && (
                            <div className="flex gap-1.5 mb-2">
                              {/* GBM Button */}
                              {(() => {
                                const isSelected = horizonCoverage.volModel === 'GBM';
                                const isBest = horizonCoverage.recommendedModel?.volModel === 'GBM';
                                return (
                                  <button
                                    onClick={() => horizonCoverage.onModelChange!('GBM')}
                                    disabled={horizonCoverage.isLoading}
                                    className={`flex-1 py-1 text-xs rounded-lg transition-colors ${
                                      isSelected 
                                        ? isBest
                                          ? 'bg-emerald-600 text-white font-medium'
                                          : 'bg-blue-600 text-white font-medium' 
                                        : horizonCoverage.isLoading
                                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                          : isBest
                                            ? isDarkMode 
                                              ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-600 hover:bg-emerald-800/50'
                                              : 'bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100'
                                            : isDarkMode 
                                              ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                  >
                                    GBM
                                  </button>
                                );
                              })()}
                              
                              {/* GARCH Button */}
                              {(() => {
                                const isSelected = horizonCoverage.volModel === 'GARCH';
                                const isBest = horizonCoverage.recommendedModel?.volModel === 'GARCH';
                                return (
                                  <button
                                    onClick={() => horizonCoverage.onModelChange!('GARCH')}
                                    disabled={horizonCoverage.isLoading}
                                    className={`flex-1 py-1 text-xs rounded-lg transition-colors ${
                                      isSelected 
                                        ? isBest
                                          ? 'bg-emerald-600 text-white font-medium'
                                          : 'bg-blue-600 text-white font-medium' 
                                        : horizonCoverage.isLoading
                                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                          : isBest
                                            ? isDarkMode 
                                              ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-600 hover:bg-emerald-800/50'
                                              : 'bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100'
                                            : isDarkMode 
                                              ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                  >
                                    GARCH
                                  </button>
                                );
                              })()}
                              
                              {/* HAR-RV Button */}
                              {(() => {
                                const isSelected = horizonCoverage.volModel === 'HAR-RV';
                                const isBest = horizonCoverage.recommendedModel?.volModel === 'HAR-RV';
                                return (
                                  <button
                                    onClick={() => horizonCoverage.onModelChange!('HAR-RV')}
                                    disabled={horizonCoverage.isLoading}
                                    className={`flex-1 py-1 text-xs rounded-lg transition-colors ${
                                      isSelected 
                                        ? isBest
                                          ? 'bg-emerald-600 text-white font-medium'
                                          : 'bg-blue-600 text-white font-medium' 
                                        : horizonCoverage.isLoading
                                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                          : isBest
                                            ? isDarkMode 
                                              ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-600 hover:bg-emerald-800/50'
                                              : 'bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100'
                                            : isDarkMode 
                                              ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                  >
                                    HAR-RV
                                  </button>
                                );
                              })()}
                              
                              {/* Range Button */}
                              {(() => {
                                const isSelected = horizonCoverage.volModel === 'Range';
                                const isBest = horizonCoverage.recommendedModel?.volModel === 'Range';
                                return (
                                  <button
                                    onClick={() => horizonCoverage.onModelChange!('Range')}
                                    disabled={horizonCoverage.isLoading}
                                    className={`flex-1 py-1 text-xs rounded-lg transition-colors ${
                                      isSelected 
                                        ? isBest
                                          ? 'bg-emerald-600 text-white font-medium'
                                          : 'bg-blue-600 text-white font-medium' 
                                        : horizonCoverage.isLoading
                                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                          : isBest
                                            ? isDarkMode 
                                              ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-600 hover:bg-emerald-800/50'
                                              : 'bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100'
                                            : isDarkMode 
                                              ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                  >
                                    Range
                                  </button>
                                );
                              })()}
                            </div>
                          )}
                          
                          <div className={`space-y-1.5 px-2.5 py-1.5 rounded-lg ${isDarkMode ? 'bg-gray-800/50' : 'bg-gray-50'}`}>
                            {/* Window - always shown */}
                            {horizonCoverage.onWindowSizeChange && (
                              <div className="flex items-center justify-between gap-3">
                                <span className={`text-[10px] ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Window</span>
                                <input
                                  type="number"
                                  min={50}
                                  max={5000}
                                  step={50}
                                  value={horizonCoverage.windowSize ?? 1000}
                                  onChange={(e) => horizonCoverage.onWindowSizeChange!(parseInt(e.target.value) || 1000)}
                                  disabled={horizonCoverage.isLoading}
                                  className={`w-16 bg-transparent border-b text-right font-mono tabular-nums outline-none text-[10px] ${
                                    isDarkMode 
                                      ? 'border-gray-600 text-white focus:border-blue-500' 
                                      : 'border-gray-300 text-gray-900 focus:border-blue-500'
                                  }`}
                                />
                              </div>
                            )}
                            
                            <div className="flex items-center justify-between gap-3">
                              <span
                                className={`text-[10px] ${isDarkMode ? 'text-gray-400' : 'text-gray-500'} whitespace-nowrap`}
                                title="Entry spread cost in basis points. 1 bp = 0.01%."
                              >
                                Cost (bps)
                              </span>
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  max={500}
                                  step={1}
                                  value={costInput}
                                  onChange={(e) => setCostInput(e.target.value)}
                                  onBlur={(e) => commitCost(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      commitCost((e.target as HTMLInputElement).value);
                                    }
                                  }}
                                  className={`w-14 bg-transparent border-b text-right font-mono tabular-nums outline-none text-[10px] ${
                                    isDarkMode 
                                      ? 'border-gray-600 text-white focus:border-amber-500' 
                                      : 'border-gray-300 text-gray-900 focus:border-amber-500'
                                  }`}
                                />
                                <span className={`text-[10px] ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>bps</span>
                              </div>
                            </div>
                            {/* GBM Lambda - only for GBM */}
                            {horizonCoverage.volModel === 'GBM' && horizonCoverage.onGbmLambdaChange && (
                              <div className="flex items-center justify-between gap-3">
                                <span className={`text-[10px] ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>λ Drift</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={1}
                                  step={0.01}
                                  value={horizonCoverage.gbmLambda ?? 0}
                                  onChange={(e) => horizonCoverage.onGbmLambdaChange!(parseFloat(e.target.value) || 0)}
                                  disabled={horizonCoverage.isLoading}
                                  className={`w-16 bg-transparent border-b text-right font-mono tabular-nums outline-none text-[10px] ${
                                    isDarkMode 
                                      ? 'border-gray-600 text-white focus:border-blue-500' 
                                      : 'border-gray-300 text-gray-900 focus:border-blue-500'
                                  }`}
                                />
                              </div>
                            )}

                            {/* DoF - only for GARCH Student-t */}
                            {horizonCoverage.volModel === 'GARCH' && horizonCoverage.garchEstimator === 'Student-t' && horizonCoverage.onDegreesOfFreedomChange && (
                              <div className="flex items-center justify-between gap-3">
                                <span className={`text-[10px] ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>DoF</span>
                                <input
                                  type="number"
                                  min={3}
                                  max={30}
                                  step={0.5}
                                  value={horizonCoverage.degreesOfFreedom ?? 5}
                                  onChange={(e) => horizonCoverage.onDegreesOfFreedomChange!(parseFloat(e.target.value) || 5)}
                                  disabled={horizonCoverage.isLoading}
                                  className={`w-16 bg-transparent border-b text-right font-mono tabular-nums outline-none text-[10px] ${
                                    isDarkMode 
                                      ? 'border-gray-600 text-white focus:border-blue-500' 
                                      : 'border-gray-300 text-gray-900 focus:border-blue-500'
                                  }`}
                                />
                              </div>
                            )}

                          </div>
                        </div>
                        
                        {/* Simulation Settings */}
                        <div>
                          <div className={`text-[10px] font-semibold mb-1.5 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            Simulation
                          </div>
                          
                          <div className={`space-y-1.5 px-2.5 py-1.5 rounded-lg ${isDarkMode ? 'bg-gray-800/50' : 'bg-gray-50'}`}>
                            {/* Initial Equity */}
                            <div className="flex items-center justify-between gap-3">
                              <span className={`text-[10px] ${isDarkMode ? 'text-gray-400' : 'text-gray-500'} whitespace-nowrap`}>Initial equity</span>
                              <input
                                type="number"
                                min={0}
                                max={1000000}
                                step={100}
                                value={equityInput}
                                onChange={(e) => setEquityInput(e.target.value)}
                                onBlur={(e) => commitInitialEquity(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    commitInitialEquity((e.target as HTMLInputElement).value);
                                  }
                                }}
                                className={`w-16 bg-transparent border-b text-right font-mono tabular-nums outline-none text-[10px] ${
                                  isDarkMode 
                                    ? 'border-gray-600 text-white focus:border-amber-500' 
                                    : 'border-gray-300 text-gray-900 focus:border-amber-500'
                                }`}
                              />
                            </div>
                            
                            {/* Leverage */}
                            <div className="flex items-center justify-between gap-3">
                              <span className={`text-[10px] ${isDarkMode ? 'text-gray-400' : 'text-gray-500'} whitespace-nowrap`}>Leverage</span>
                              <input
                                type="number"
                                min={1}
                                max={100}
                                step={1}
                                value={t212Leverage}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  if (Number.isFinite(val) && val >= 1) {
                                    onChangeT212Leverage?.(Math.min(100, val));
                                  }
                                }}
                                className={`w-12 bg-transparent border-b text-right font-mono tabular-nums outline-none text-[10px] ${
                                  isDarkMode 
                                    ? 'border-gray-600 text-white focus:border-amber-500' 
                                    : 'border-gray-300 text-gray-900 focus:border-amber-500'
                                }`}
                              />
                            </div>
                            
                            {/* Position % */}
                            <div className="flex items-center justify-between gap-3">
                              <span className={`text-[10px] ${isDarkMode ? 'text-gray-400' : 'text-gray-500'} whitespace-nowrap`}>Position %</span>
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={0.5}
                                  value={positionPctInput}
                                  onChange={(e) => setPositionPctInput(e.target.value)}
                                  onBlur={(e) => commitPositionPct(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      commitPositionPct((e.target as HTMLInputElement).value);
                                    }
                                  }}
                                  className={`w-14 bg-transparent border-b text-right font-mono tabular-nums outline-none text-[10px] ${
                                    isDarkMode 
                                      ? 'border-gray-600 text-white focus:border-amber-500' 
                                      : 'border-gray-300 text-gray-900 focus:border-amber-500'
                                  }`}
                                />
                                <span className={`text-[10px] ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>%</span>
                              </div>
                            </div>
                            
                            {/* Signal Type */}
                            <div className="flex items-center justify-between gap-3">
                              <span className={`text-[10px] ${isDarkMode ? 'text-gray-400' : 'text-gray-500'} whitespace-nowrap`}>Signal</span>
                              <div className={`px-2.5 py-0.5 rounded-full text-[9px] font-semibold ${
                                isDarkMode ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-700'
                              }`}>
                                Z
                              </div>
                            </div>
                            
                            {/* Z Thresholds */}
                            {t212SignalRule === 'z' && (
                              <>
                                <div className="flex items-center justify-between gap-3">
                                  <span className={`text-[10px] ${isDarkMode ? 'text-gray-400' : 'text-gray-500'} whitespace-nowrap`}>Enter (L / S)</span>
                                  <span className="font-mono tabular-nums text-right text-[10px]">
                                    {t212ZDisplayThresholds
                                      ? `${t212ZDisplayThresholds.enterLong.toFixed(3)} / ${t212ZDisplayThresholds.enterShort.toFixed(3)}`
                                      : '—'}
                                  </span>
                                </div>
                                
                                <div className="flex items-center justify-between gap-3">
                                  <span className={`text-[10px] ${isDarkMode ? 'text-gray-400' : 'text-gray-500'} whitespace-nowrap`}>Exit (L / S)</span>
                                  <span className="font-mono tabular-nums text-right text-[10px]">
                                    {t212ZDisplayThresholds
                                      ? `${t212ZDisplayThresholds.exitLong.toFixed(3)} / ${t212ZDisplayThresholds.exitShort.toFixed(3)}`
                                      : '—'}
                                  </span>
                                </div>
                                
                                <div className="flex items-center justify-between gap-3">
                                  <span className={`text-[10px] ${isDarkMode ? 'text-gray-400' : 'text-gray-500'} whitespace-nowrap`}>Flip (L / S)</span>
                                  <span className="font-mono tabular-nums text-right text-[10px]">
                                    {t212ZDisplayThresholds
                                      ? `${t212ZDisplayThresholds.flipLong.toFixed(3)} / ${t212ZDisplayThresholds.flipShort.toFixed(3)}`
                                      : '—'}
                                  </span>
                                </div>
                              </>
                            )}
                            
                            {/* BPS Threshold (if using bps signal rule) */}
                            {t212SignalRule === 'bps' && (
                              <div className="flex items-center justify-between gap-3">
                                <span
                                  className={`text-[10px] ${isDarkMode ? 'text-gray-400' : 'text-gray-500'} whitespace-nowrap`}
                                  title="Minimum |edge| to trade (no-trade band). 1 bp = 0.01%."
                                >
                                  Threshold
                                </span>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min={0}
                                    max={500}
                                    step={1}
                                    value={thresholdInput}
                                    onChange={(e) => setThresholdInput(e.target.value)}
                                    onBlur={(e) => commitThreshold(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        commitThreshold((e.target as HTMLInputElement).value);
                                      }
                                    }}
                                    className={`w-14 bg-transparent border-b text-right font-mono tabular-nums outline-none text-[10px] ${
                                      isDarkMode 
                                        ? 'border-gray-600 text-white focus:border-amber-500' 
                                        : 'border-gray-300 text-gray-900 focus:border-amber-500'
                                    }`}
                                  />
                                  <span className={`text-[10px] ${isDarkMode ? "text-gray-400" : "text-gray-500"}`}>bps</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>

          {/* Overview Tab - Stats + Equity Chart */}
          {activeInsightTab === "Overview" && (
            <div className="flex flex-col gap-6">
              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                {/* Total P&L */}
                <div className="flex flex-col gap-1">
                  <div className="text-sm">
                    <span className={isDarkMode ? "text-white" : "text-slate-900"}>Total P&L</span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className={`text-xs font-mono ${overviewStats.pnlAbs != null && overviewStats.pnlAbs >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {overviewStats.pnlAbs != null ? `${overviewStats.pnlAbs >= 0 ? "+" : ""}${overviewStats.pnlAbs.toFixed(2)}` : "—"}
                    </span>
                    <span className={`text-xs ${overviewStats.pnlPct != null && overviewStats.pnlPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {overviewStats.pnlPct != null ? `${(overviewStats.pnlPct * 100).toFixed(2)}%` : ""}
                    </span>
                  </div>
                  <div className={isDarkMode ? "text-xs text-slate-500" : "text-xs text-slate-500"}>
                    {hoveredDate ? `At ${hoveredDate}` : overviewStats.asOfDate ? `As of ${overviewStats.asOfDate}` : "Today"}
                  </div>
                </div>

                {/* Max equity drawdown */}
                <div className="flex flex-col gap-1">
                  <div className="text-sm">
                    <span className={isDarkMode ? "text-white" : "text-slate-900"}>Max equity drawdown</span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-xs font-mono text-slate-400">
                      {overviewStats.maxDrawdownAbs != null ? `${overviewStats.maxDrawdownAbs.toFixed(2)}` : "—"}
                    </span>
                    <span className="text-xs text-slate-500">
                      {overviewStats.maxDrawdownPct != null ? `${(overviewStats.maxDrawdownPct * 100).toFixed(2)}%` : ""}
                    </span>
                  </div>
                </div>

                {/* Total trades */}
                <div className="flex flex-col gap-1">
                  <div className="text-sm">
                    <span className={isDarkMode ? "text-white" : "text-slate-900"}>Total trades</span>
                  </div>
                  <div className="mt-1 text-xs font-mono text-slate-400">
                    {overviewStats.totalTrades || 0}
                  </div>
                </div>

                {/* Profitable trades */}
                <div className="flex flex-col gap-1">
                  <div className="text-sm">
                    <span className={isDarkMode ? "text-white" : "text-slate-900"}>Profitable trades</span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-xs font-mono text-slate-400">
                      {overviewStats.profitableTrades || 0}
                    </span>
                    <span className="text-xs text-slate-500">
                      {overviewStats.pctProfitable != null
                        ? `${overviewStats.pctProfitable.toFixed(1)}%`
                        : "—"}
                    </span>
                  </div>
                </div>

                {/* Profit factor */}
                <div className="flex flex-col gap-1">
                  <div className="text-sm">
                    <span className={isDarkMode ? "text-white" : "text-slate-900"}>Profit factor</span>
                  </div>
                  <div className="mt-1 text-xs font-mono text-slate-400">
                    {overviewStats.profitFactor == null
                      ? "—"
                      : overviewStats.profitFactor === Infinity
                      ? "∞"
                      : overviewStats.profitFactor.toFixed(2)}
                  </div>
                </div>
              </div>

              {showCarryInNotice && (
                <div
                  className={`text-xs rounded-md px-3 py-2 border ${
                    isDarkMode
                      ? "border-amber-500/40 bg-amber-500/5 text-amber-200"
                      : "border-amber-200 bg-amber-50 text-amber-700"
                  }`}
                >
                  No clean restart in this range (position already open at range start). Move the range start earlier or choose a period with a fresh entry.
                </div>
              )}

              {/* Equity Chart inside Overview tab */}
              <div className={chartFrameClasses}>
                {simulationEquityData.length < 2 ? (
                  <div className={`h-[220px] flex items-center justify-center text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    Not enough points in the selected range to render the simulation chart.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart
                    data={simulationEquityData}
                    margin={CHART_MARGIN}
                    syncId={SYNC_ID}
                    onMouseMove={applyHoverFromRechartsState}
                    onMouseLeave={handleChartMouseLeave}
                    barCategoryGap={sharedBarSizing.barCategoryGap}
                    barGap={sharedBarSizing.barGap}
                  >
                      <CartesianGrid
                        stroke={isDarkMode ? "rgba(148, 163, 184, 0.07)" : "rgba(100, 116, 139, 0.12)"}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="date"
                        type="category"
                        allowDuplicatedCategory={false}
                        axisLine={false}
                        tickLine={false}
                        tickMargin={8}
                        padding={{ left: 12, right: 12 }}
                        minTickGap={16}
                        interval={simTickConfig.interval as any}
                        tick={{
                          fill: isDarkMode ? '#9CA3AF' : '#6B7280',
                          fontSize: simViewLength <= 10 ? 11 : 10,
                        }}
                        tickFormatter={simTickFormatter}
                      />
                      <YAxis
                        yAxisId="equity"
                        domain={equityYDomain}
                        orientation="right"
                        width={Y_AXIS_WIDTH}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: isDarkMode ? '#9CA3AF' : '#6B7280', fontSize: 10 }}
                        tickFormatter={(value: number) => {
                          if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
                          return value.toFixed(0);
                        }}
                      />
                      {selectedPnlByDate && Object.keys(selectedPnlByDate).length > 0 && (
                        <YAxis
                          yAxisId="pnl"
                          type="number"
                          domain={['auto', 'auto']}
                          orientation="left"
                          width={Y_AXIS_WIDTH}
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: isDarkMode ? '#9CA3AF' : '#6B7280', fontSize: 10 }}
                          allowDataOverflow
                          tickFormatter={(value: number) => {
                            if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
                            return value.toFixed(0);
                          }}
                        />
                      )}
                      <YAxis yAxisId="delta" domain={equityDeltaDomain} hide />
                      <Tooltip
                        cursor={false}
                        animationDuration={0}
                        isAnimationActive={false}
                        content={() => {
                          if (!hoveredDate) return null;
                          const point = simulationEquityData.find((p) => p.date === hoveredDate);
                          if (!point) return null;
                          if (point.equity == null) {
                            return (
                              <div className={`${TOOLTIP_CLASS} text-[11px]`}>
                                No active position in this range.
                              </div>
                            );
                          }

                          const deltaStr =
                            point.equityDelta != null
                              ? `${point.equityDelta >= 0 ? "+" : ""}${point.equityDelta.toFixed(2)}`
                              : "—";
                          const usedMargin =
                            point.marginUsed != null && Number.isFinite(point.marginUsed)
                              ? point.marginUsed
                              : null;
                          const freeMargin =
                            point.freeMargin != null && Number.isFinite(point.freeMargin)
                              ? point.freeMargin
                              : point.equity != null && usedMargin != null
                                ? point.equity - usedMargin
                                : null;

                          return (
                            <div className={`${TOOLTIP_CLASS} space-y-1.5`}>
                              <div className={`text-xs ${TOOLTIP_TITLE_CLASS}`}>
                                {hoveredDate} · Simulation
                              </div>
                              <div className="text-[11px] space-y-0.5">
                                <div className={`${TOOLTIP_MUTED_CLASS}`}>
                                  Equity <span className="font-mono text-emerald-400 font-semibold">${point.equity.toFixed(2)}</span>
                                </div>
                                {freeMargin != null && (
                                  <div className={`${TOOLTIP_MUTED_CLASS}`}>
                                    Free margin <span className="font-mono">${freeMargin.toFixed(2)}</span>
                                  </div>
                                )}
                                {usedMargin != null && (
                                  <div className={`${TOOLTIP_MUTED_CLASS}`}>
                                    Used margin <span className="font-mono">${usedMargin.toFixed(2)}</span>
                                  </div>
                                )}
                                <div className={`${TOOLTIP_MUTED_CLASS}`}>
                                  Δ Day{" "}
                                  <span
                                    className={`font-mono font-semibold ${
                                      point.equityDelta != null && point.equityDelta >= 0
                                        ? "text-emerald-300"
                                        : "text-rose-300"
                                    }`}
                                  >
                                    {deltaStr}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        }}
                      />

                      {hoveredDate && (
                        <ReferenceLine
                          key="equity-hover-crosshair"
                          x={hoveredDate}
                          stroke={isDarkMode ? "#FFFFFF" : "rgba(148, 163, 184, 0.35)"}
                          strokeWidth={1}
                          strokeDasharray="4 2"
                        />
                      )}

                      <ReferenceLine
                        key="equity-zero-line"
                        y={0}
                        yAxisId="delta"
                        stroke={isDarkMode ? "rgba(148, 163, 184, 0.4)" : "rgba(100, 116, 139, 0.5)"}
                        strokeDasharray="3 3"
                        strokeWidth={1}
                      />

                      <Bar
                        yAxisId="delta"
                        dataKey="equityDelta"
                        radius={[2, 2, 0, 0]}
                        isAnimationActive={false}
                        maxBarSize={sharedBarSizing.maxBarSize}
                      >
                        {simulationEquityData.map((entry, index) => {
                          const positive = (entry.equityDelta ?? 0) >= 0;
                          return (
                            <Cell
                              key={`eq-bar-${entry.date}-${index}`}
                              fill={
                                positive
                                  ? "rgba(52, 211, 153, 0.35)"
                                  : "rgba(251, 113, 133, 0.35)"
                              }
                              stroke={
                                positive
                                  ? "rgba(16, 185, 129, 0.8)"
                                  : "rgba(244, 63, 94, 0.8)"
                              }
                              strokeWidth={1}
                            />
                          );
                        })}
                      </Bar>

                      {selectedPnlByDate && Object.keys(selectedPnlByDate).length > 0 && (
                        <Bar
                          yAxisId="pnl"
                          dataKey="selectedPnl"
                          radius={[2, 2, 0, 0]}
                          isAnimationActive={false}
                          maxBarSize={sharedBarSizing.maxBarSize}
                        >
                          {simulationEquityData.map((entry, index) => {
                            const positive = (entry.selectedPnl ?? 0) >= 0;
                            return (
                              <Cell
                                key={`pnl-bar-${entry.date}-${index}`}
                                fill={
                                  positive
                                    ? "rgba(52, 211, 153, 0.35)"
                                    : "rgba(251, 113, 133, 0.35)"
                                }
                                stroke={
                                  positive
                                    ? "rgba(16, 185, 129, 0.8)"
                                    : "rgba(244, 63, 94, 0.8)"
                                }
                                strokeWidth={1}
                              />
                            );
                          })}
                        </Bar>
                      )}

                      <Line
                        yAxisId="equity"
                        type="monotone"
                        dataKey="equity"
                        stroke={isDarkMode ? "#38bdf8" : "#0ea5e9"}
                        strokeWidth={2}
                        dot={simShowDots ? { r: simViewLength <= 10 ? 3 : 2 } : false}
                        activeDot={simShowDots ? { r: 4, strokeWidth: 2, fill: isDarkMode ? "#38bdf8" : "#0ea5e9", stroke: isDarkMode ? "#0f172a" : "#f8fafc" } : false}
                        isAnimationActive={false}
                        connectNulls={false}
                      />
                      {selectedPnlByDate && Object.keys(selectedPnlByDate).length > 0 && (
                        <Line
                          yAxisId="pnl"
                          type="monotone"
                          dataKey="selectedPnl"
                          name={`P&L: ${selectedPnlLabel ?? "Selected"}`}
                          stroke={isDarkMode ? "#f59e0b" : "#d97706"}
                          strokeWidth={2}
                          strokeDasharray="6 3"
                          dot={false}
                          isAnimationActive={false}
                          connectNulls
                        />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Simulation Comparison Table */}
              {simulationRuns && simulationRuns.length > 0 && (
                <div className="w-full -mt-4">
                  <h4
                    className={`text-[11px] font-semibold mb-2 ${
                      isDarkMode ? "text-slate-300" : "text-gray-700"
                    }`}
                  >
                    Simulation Comparison
                  </h4>
                  
                  {/* Common simulation info - outside table */}
                  {simulationRuns.length > 0 && (
                    <div className={`mb-3 flex gap-6 text-[10px] ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                      <div>
                        <span className="font-medium">Days:</span> <span className="font-mono ml-1">{simulationRuns[0].days}</span>
                      </div>
                      <div>
                        <span className="font-medium">First Date:</span> <span className="font-mono ml-1">{simulationRuns[0].firstDate}</span>
                      </div>
                      <div>
                        <span className="font-medium">Last Date:</span> <span className="font-mono ml-1">{simulationRuns[0].lastDate}</span>
                      </div>
                    </div>
                  )}
                  
                  <div className={`p-4 rounded-xl border ${
                    isDarkMode 
                      ? 'bg-transparent border-slate-700/50' 
                      : 'bg-transparent border-gray-200'
                  }`}>
                    <div className="overflow-x-auto">
                      <table className={`min-w-full text-[11px] ${isDarkMode ? 'text-slate-200' : 'text-gray-700'}`}>
                        <thead className={`${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                          <tr className={`border-b-2 ${isDarkMode ? 'border-slate-600' : 'border-gray-300'}`}>
                            <th className="py-2 pr-4 text-left font-semibold w-40"></th>
                            {simulationRuns.map((run) => (
                              <th key={run.id} className={`py-2 px-4 text-center font-semibold border-l ${isDarkMode ? 'border-slate-700' : 'border-gray-200'}`}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    console.log("[HEADER CLICK]", run.id);
                                    onSelectSimulationRun?.(run.id);
                                  }}
                                  aria-pressed={run.id === selectedSimRunId}
                                  className={`w-full rounded-md px-2 py-1 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                                    isDarkMode
                                      ? 'focus-visible:outline-sky-400/80'
                                      : 'focus-visible:outline-sky-500/80'
                                  } ${
                                    run.id === selectedSimRunId
                                      ? isDarkMode
                                        ? 'bg-slate-700/60 text-white underline decoration-emerald-400'
                                        : 'bg-gray-100 text-gray-900 underline decoration-emerald-600'
                                      : isDarkMode
                                        ? 'text-slate-200 hover:bg-slate-800/60'
                                        : 'text-gray-700 hover:bg-gray-100'
                                  }`}
                                >
                                  {run.label}
                                </button>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {/* === PARAMETERS SECTION === */}
                          <tr className={`${isDarkMode ? 'bg-slate-800/50' : 'bg-gray-100/70'}`}>
                            <td colSpan={simulationRuns.length + 1} className="py-1.5 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                              Parameters
                            </td>
                          </tr>
                          
                          {/* Lambda row */}
                          <tr className={`border-b ${isDarkMode ? 'border-slate-800/40 hover:bg-slate-800/30' : 'border-gray-100 hover:bg-gray-50'}`}>
                            <td className="py-2 pr-4 pl-3 text-slate-400">Lambda (λ)</td>
                            {simulationRuns.map((run) => (
                              <td key={run.id} className={`py-2 px-4 text-right font-mono tabular-nums border-l ${isDarkMode ? 'border-slate-800/40' : 'border-gray-100'}`}>
                                {run.lambda != null ? run.lambda.toFixed(2) : "—"}
                              </td>
                            ))}
                          </tr>
                          
                          {/* Train% row */}
                          <tr className={`border-b ${isDarkMode ? 'border-slate-800/40 hover:bg-slate-800/30' : 'border-gray-100 hover:bg-gray-50'}`}>
                            <td className="py-2 pr-4 pl-3 text-slate-400">Train Split</td>
                            {simulationRuns.map((run) => (
                              <td key={run.id} className={`py-2 px-4 text-right font-mono tabular-nums border-l ${isDarkMode ? 'border-slate-800/40' : 'border-gray-100'}`}>
                                {run.trainFraction != null ? `${(run.trainFraction * 100).toFixed(0)}%` : "—"}
                              </td>
                            ))}
                          </tr>

                          {/* === FORECAST SECTION === */}
                          <tr className={`${isDarkMode ? 'bg-slate-800/50' : 'bg-gray-100/70'}`}>
                            <td colSpan={simulationRuns.length + 1} className="py-1.5 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                              Forecast
                            </td>
                          </tr>
                          
                          {/* Expected row */}
                          <tr className={`border-b ${isDarkMode ? 'border-slate-800/40 hover:bg-slate-800/30' : 'border-gray-100 hover:bg-gray-50'}`}>
                            <td className="py-2 pr-4 pl-3 text-slate-400">Expected Price</td>
                            {simulationRuns.map((run) => {
                              const hf = run.horizonForecast;
                              const hasExp = hf?.expected != null && Number.isFinite(hf.expected);
                              return (
                                <td key={run.id} className={`py-2 px-4 text-right font-mono tabular-nums border-l ${isDarkMode ? 'border-slate-800/40' : 'border-gray-100'}`}>
                                  {hasExp ? `$${hf!.expected!.toFixed(2)}` : "—"}
                                </td>
                              );
                            })}
                          </tr>
                          
                          {/* Confidence Bands row */}
                          <tr className={`border-b ${isDarkMode ? 'border-slate-800/40 hover:bg-slate-800/30' : 'border-gray-100 hover:bg-gray-50'}`}>
                            <td className="py-2 pr-4 pl-3 text-slate-400">95% CI Bands</td>
                            {simulationRuns.map((run) => {
                              const hf = run.horizonForecast;
                              const hasBand = hf?.lower != null && hf?.upper != null && Number.isFinite(hf.lower!) && Number.isFinite(hf.upper!);
                              return (
                                <td key={run.id} className={`py-2 px-4 text-right font-mono tabular-nums border-l ${isDarkMode ? 'border-slate-800/40' : 'border-gray-100'}`}>
                                  {hasBand ? (
                                    <span className="text-slate-400">
                                      <span className="text-rose-400">${hf!.lower!.toFixed(2)}</span>
                                      <span className="mx-1">–</span>
                                      <span className="text-emerald-400">${hf!.upper!.toFixed(2)}</span>
                                    </span>
                                  ) : "—"}
                                </td>
                              );
                            })}
                          </tr>

                          {/* === VOLATILITY MODELS SECTION === */}
                          <tr className={`${isDarkMode ? 'bg-slate-800/50' : 'bg-gray-100/70'}`}>
                            <td colSpan={simulationRuns.length + 1} className="py-1.5 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                              Volatility Models
                            </td>
                          </tr>
                          
                          {/* GBM row */}
                          <tr className={`border-b ${isDarkMode ? 'border-slate-800/40 hover:bg-slate-800/30' : 'border-gray-100 hover:bg-gray-50'}`}>
                            <td className="py-2 pr-4 pl-3 text-slate-400">GBM</td>
                            {simulationRuns.map((run) => {
                              const ewmaUnbiasedBands = run.horizonForecast;
                              const ewmaCell = ewmaUnbiasedBands ? {
                                lower: ewmaUnbiasedBands.lower,
                                upper: ewmaUnbiasedBands.upper
                              } as VolCell : undefined;
                              return (
                                <td
                                  key={run.id}
                                  className={`py-2 px-4 text-right font-mono tabular-nums border-l ${isDarkMode ? 'border-slate-800/40' : 'border-gray-100'}`}
                                  title={volCellTitle(run.volatility?.gbm)}
                                >
                                  {renderVolCell(run.volatility?.gbm, ewmaCell)}
                                </td>
                              );
                            })}
                          </tr>
                          
                          {/* GARCH Normal row */}
                          <tr className={`border-b ${isDarkMode ? 'border-slate-800/40 hover:bg-slate-800/30' : 'border-gray-100 hover:bg-gray-50'}`}>
                            <td className="py-2 pr-4 pl-3 text-slate-400">GARCH Normal</td>
                            {simulationRuns.map((run) => {
                              const ewmaUnbiasedBands = run.horizonForecast;
                              const ewmaCell = ewmaUnbiasedBands ? {
                                lower: ewmaUnbiasedBands.lower,
                                upper: ewmaUnbiasedBands.upper
                              } as VolCell : undefined;
                              return (
                                <td
                                  key={run.id}
                                  className={`py-2 px-4 text-right font-mono tabular-nums border-l ${isDarkMode ? 'border-slate-800/40' : 'border-gray-100'}`}
                                  title={volCellTitle(run.volatility?.garchNormal)}
                                >
                                  {renderVolCell(run.volatility?.garchNormal, ewmaCell)}
                                </td>
                              );
                            })}
                          </tr>
                          
                          {/* GARCH Student row */}
                          <tr className={`border-b ${isDarkMode ? 'border-slate-800/40 hover:bg-slate-800/30' : 'border-gray-100 hover:bg-gray-50'}`}>
                            <td className="py-2 pr-4 pl-3 text-slate-400">GARCH Student-t</td>
                            {simulationRuns.map((run) => {
                              const ewmaUnbiasedBands = run.horizonForecast;
                              const ewmaCell = ewmaUnbiasedBands ? {
                                lower: ewmaUnbiasedBands.lower,
                                upper: ewmaUnbiasedBands.upper
                              } as VolCell : undefined;
                              return (
                                <td
                                  key={run.id}
                                  className={`py-2 px-4 text-right font-mono tabular-nums border-l ${isDarkMode ? 'border-slate-800/40' : 'border-gray-100'}`}
                                  title={volCellTitle(run.volatility?.garchStudent)}
                                >
                                  {renderVolCell(run.volatility?.garchStudent, ewmaCell)}
                                </td>
                              );
                            })}
                          </tr>
                          
                          {/* HAR-RV row */}
                          <tr className={`border-b ${isDarkMode ? 'border-slate-800/40 hover:bg-slate-800/30' : 'border-gray-100 hover:bg-gray-50'}`}>
                            <td className="py-2 pr-4 pl-3 text-slate-400">HAR-RV</td>
                            {simulationRuns.map((run) => {
                              const ewmaUnbiasedBands = run.horizonForecast;
                              const ewmaCell = ewmaUnbiasedBands ? {
                                lower: ewmaUnbiasedBands.lower,
                                upper: ewmaUnbiasedBands.upper
                              } as VolCell : undefined;
                              return (
                                <td
                                  key={run.id}
                                  className={`py-2 px-4 text-right font-mono tabular-nums border-l ${isDarkMode ? 'border-slate-800/40' : 'border-gray-100'}`}
                                  title={volCellTitle(run.volatility?.harRv)}
                                >
                                  {renderVolCell(run.volatility?.harRv, ewmaCell)}
                                </td>
                              );
                            })}
                          </tr>

                          {/* === RANGE ESTIMATORS SECTION === */}
                          <tr className={`${isDarkMode ? 'bg-slate-800/50' : 'bg-gray-100/70'}`}>
                            <td colSpan={simulationRuns.length + 1} className="py-1.5 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                              Range Estimators
                            </td>
                          </tr>
                          
                          {/* Parkinson row */}
                          <tr className={`border-b ${isDarkMode ? 'border-slate-800/40 hover:bg-slate-800/30' : 'border-gray-100 hover:bg-gray-50'}`}>
                            <td className="py-2 pr-4 pl-3 text-slate-400">Parkinson</td>
                            {simulationRuns.map((run) => {
                              const ewmaUnbiasedBands = run.horizonForecast;
                              const ewmaCell = ewmaUnbiasedBands ? {
                                lower: ewmaUnbiasedBands.lower,
                                upper: ewmaUnbiasedBands.upper
                              } as VolCell : undefined;
                              return (
                                <td
                                  key={run.id}
                                  className={`py-2 px-4 text-right font-mono tabular-nums border-l ${isDarkMode ? 'border-slate-800/40' : 'border-gray-100'}`}
                                  title={volCellTitle(run.volatility?.rangeParkinson)}
                                >
                                  {renderVolCell(run.volatility?.rangeParkinson, ewmaCell)}
                                </td>
                              );
                            })}
                          </tr>
                          
                          {/* Garman-Klass row */}
                          <tr className={`border-b ${isDarkMode ? 'border-slate-800/40 hover:bg-slate-800/30' : 'border-gray-100 hover:bg-gray-50'}`}>
                            <td className="py-2 pr-4 pl-3 text-slate-400">Garman-Klass</td>
                            {simulationRuns.map((run) => {
                              const ewmaUnbiasedBands = run.horizonForecast;
                              const ewmaCell = ewmaUnbiasedBands ? {
                                lower: ewmaUnbiasedBands.lower,
                                upper: ewmaUnbiasedBands.upper
                              } as VolCell : undefined;
                              return (
                                <td
                                  key={run.id}
                                  className={`py-2 px-4 text-right font-mono tabular-nums border-l ${isDarkMode ? 'border-slate-800/40' : 'border-gray-100'}`}
                                  title={volCellTitle(run.volatility?.rangeGarmanKlass)}
                                >
                                  {renderVolCell(run.volatility?.rangeGarmanKlass, ewmaCell)}
                                </td>
                              );
                            })}
                          </tr>
                          
                          {/* Rogers-Satchell row */}
                          <tr className={`border-b ${isDarkMode ? 'border-slate-800/40 hover:bg-slate-800/30' : 'border-gray-100 hover:bg-gray-50'}`}>
                            <td className="py-2 pr-4 pl-3 text-slate-400">Rogers-Satchell</td>
                            {simulationRuns.map((run) => {
                              const ewmaUnbiasedBands = run.horizonForecast;
                              const ewmaCell = ewmaUnbiasedBands ? {
                                lower: ewmaUnbiasedBands.lower,
                                upper: ewmaUnbiasedBands.upper
                              } as VolCell : undefined;
                              return (
                                <td
                                  key={run.id}
                                  className={`py-2 px-4 text-right font-mono tabular-nums border-l ${isDarkMode ? 'border-slate-800/40' : 'border-gray-100'}`}
                                  title={volCellTitle(run.volatility?.rangeRogersSatchell)}
                                >
                                  {renderVolCell(run.volatility?.rangeRogersSatchell, ewmaCell)}
                                </td>
                              );
                            })}
                          </tr>
                          
                          {/* Yang-Zhang row */}
                          <tr className={`border-b ${isDarkMode ? 'border-slate-800/40 hover:bg-slate-800/30' : 'border-gray-100 hover:bg-gray-50'}`}>
                            <td className="py-2 pr-4 pl-3 text-slate-400">Yang-Zhang</td>
                            {simulationRuns.map((run) => {
                              const ewmaUnbiasedBands = run.horizonForecast;
                              const ewmaCell = ewmaUnbiasedBands ? {
                                lower: ewmaUnbiasedBands.lower,
                                upper: ewmaUnbiasedBands.upper
                              } as VolCell : undefined;
                              return (
                                <td
                                  key={run.id}
                                  className={`py-2 px-4 text-right font-mono tabular-nums border-l ${isDarkMode ? 'border-slate-800/40' : 'border-gray-100'}`}
                                  title={volCellTitle(run.volatility?.rangeYangZhang)}
                                >
                                  {renderVolCell(run.volatility?.rangeYangZhang, ewmaCell)}
                                </td>
                              );
                            })}
                          </tr>

                          {/* === PERFORMANCE SECTION === */}
                          <tr className={`${isDarkMode ? 'bg-slate-800/50' : 'bg-gray-100/70'}`}>
                            <td colSpan={simulationRuns.length + 1} className="py-1.5 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                              Performance
                            </td>
                          </tr>

                          {/* Initial Capital */}
                          <tr className={`border-b ${isDarkMode ? 'border-slate-800/40 hover:bg-slate-800/30' : 'border-gray-100 hover:bg-gray-50'}`}>
                            <td className="py-2 pr-4 pl-3 text-slate-400">Initial Capital</td>
                            {simulationRuns.map((run) => (
                              <td key={run.id} className={`py-2 px-4 text-right font-mono tabular-nums border-l ${isDarkMode ? 'border-slate-800/40' : 'border-gray-100'}`}>
                                {run.initialCapital != null ? formatUsd(run.initialCapital) : "—"}
                              </td>
                            ))}
                          </tr>

                          {/* Net Profit */}
                          <tr className={`border-b ${isDarkMode ? 'border-slate-800/40 hover:bg-slate-800/30' : 'border-gray-100 hover:bg-gray-50'}`}>
                            <td className="py-2 pr-4 pl-3 text-slate-400">Net Profit</td>
                            {simulationRuns.map((run) => (
                              <td key={run.id} className={`py-2 px-4 text-right font-mono tabular-nums border-l ${isDarkMode ? 'border-slate-800/40' : 'border-gray-100'} ${
                                run.netProfit != null && run.netProfit >= 0 ? 'text-emerald-400' : run.netProfit != null ? 'text-rose-400' : ''
                              }`}>
                                {run.netProfit != null ? formatUsd(run.netProfit, { sign: true }) : "—"}
                              </td>
                            ))}
                          </tr>

                          {/* Gross Profit */}
                          <tr className={`border-b ${isDarkMode ? 'border-slate-800/40 hover:bg-slate-800/30' : 'border-gray-100 hover:bg-gray-50'}`}>
                            <td className="py-2 pr-4 pl-3 text-slate-400">Gross Profit</td>
                            {simulationRuns.map((run) => (
                              <td key={run.id} className={`py-2 px-4 text-right font-mono tabular-nums border-l text-emerald-400 ${isDarkMode ? 'border-slate-800/40' : 'border-gray-100'}`}>
                                {run.grossProfit != null ? formatUsd(run.grossProfit) : "—"}
                              </td>
                            ))}
                          </tr>

                          {/* Gross Loss */}
                          <tr className={`border-b ${isDarkMode ? 'border-slate-800/40 hover:bg-slate-800/30' : 'border-gray-100 hover:bg-gray-50'}`}>
                            <td className="py-2 pr-4 pl-3 text-slate-400">Gross Loss</td>
                            {simulationRuns.map((run) => (
                              <td key={run.id} className={`py-2 px-4 text-right font-mono tabular-nums border-l text-rose-400 ${isDarkMode ? 'border-slate-800/40' : 'border-gray-100'}`}>
                                {run.grossLoss != null ? formatUsd(Math.abs(run.grossLoss)) : "—"}
                              </td>
                            ))}
                          </tr>

                          {/* Max Equity Drawdown */}
                          <tr className={`border-b ${isDarkMode ? 'border-slate-800/40 hover:bg-slate-800/30' : 'border-gray-100 hover:bg-gray-50'}`}>
                            <td className="py-2 pr-4 pl-3 text-slate-400">Max Equity Drawdown</td>
                            {simulationRuns.map((run) => (
                              <td key={run.id} className={`py-2 px-4 text-right font-mono tabular-nums border-l text-rose-400 ${isDarkMode ? 'border-slate-800/40' : 'border-gray-100'}`}>
                                {run.maxDrawdownValue != null ? formatUsd(run.maxDrawdownValue, { sign: true }) : "—"}
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Performance Tab - REMOVED, content moved to Overview */}

          {/* Trades Analysis Tab */}
          {activeInsightTab === "Trades analysis" && (
            <div className={`rounded-2xl border ${isDarkMode ? "border-slate-700/60 bg-slate-900/70" : "border-slate-200 bg-white"}`}>
              <table className="w-full text-xs">
                <thead>
                  <tr className={isDarkMode ? "border-b border-slate-700/50" : "border-b border-slate-200"}>
                    <th className={`text-left py-3 px-4 font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Metric</th>
                    <th className={`text-right py-3 px-4 font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>All</th>
                    <th className={`text-right py-3 px-4 font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Long</th>
                    <th className={`text-right py-3 px-4 font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Short</th>
                  </tr>
                </thead>
                <tbody className={isDarkMode ? "text-slate-200" : "text-slate-700"}>
                  <tr className={isDarkMode ? "border-b border-slate-800/50" : "border-b border-slate-100"}>
                    <td className="py-2.5 px-4">Total trades</td>
                    <td className="text-right py-2.5 px-4 font-mono">{tradeSummary.totalTrades}</td>
                    <td className="text-right py-2.5 px-4 font-mono">{tradeSummary.totalLong}</td>
                    <td className="text-right py-2.5 px-4 font-mono">{tradeSummary.totalShort}</td>
                  </tr>
                  <tr className={isDarkMode ? "border-b border-slate-800/50" : "border-b border-slate-100"}>
                    <td className="py-2.5 px-4">Total open trades</td>
                    <td className="text-right py-2.5 px-4 font-mono">{tradeSummary.totalOpen}</td>
                    <td className="text-right py-2.5 px-4 font-mono">{tradeSummary.openLong}</td>
                    <td className="text-right py-2.5 px-4 font-mono">{tradeSummary.openShort}</td>
                  </tr>
                  <tr className={isDarkMode ? "border-b border-slate-800/50" : "border-b border-slate-100"}>
                    <td className="py-2.5 px-4">Winning trades</td>
                    <td className="text-right py-2.5 px-4 font-mono">{tradeSummary.winningTrades}</td>
                    <td className="text-right py-2.5 px-4 font-mono">{tradeSummary.winningLong}</td>
                    <td className="text-right py-2.5 px-4 font-mono">{tradeSummary.winningShort}</td>
                  </tr>
                  <tr className={isDarkMode ? "border-b border-slate-800/50" : "border-b border-slate-100"}>
                    <td className="py-2.5 px-4">Losing trades</td>
                    <td className="text-right py-2.5 px-4 font-mono">{tradeSummary.losingTrades}</td>
                    <td className="text-right py-2.5 px-4 font-mono">{tradeSummary.losingLong}</td>
                    <td className="text-right py-2.5 px-4 font-mono">{tradeSummary.losingShort}</td>
                  </tr>
                  <tr className={isDarkMode ? "border-b border-slate-800/50" : "border-b border-slate-100"}>
                    <td className="py-2.5 px-4">Percent profitable</td>
                    <td className="text-right py-2.5 px-4 font-mono">
                      {tradeSummary.pctProfitable != null ? `${tradeSummary.pctProfitable.toFixed(2)}%` : "—"}
                    </td>
                    <td className="text-right py-2.5 px-4 font-mono">
                      {tradeSummary.pctProfitableLong != null ? `${tradeSummary.pctProfitableLong.toFixed(2)}%` : "—"}
                    </td>
                    <td className="text-right py-2.5 px-4 font-mono">
                      {tradeSummary.pctProfitableShort != null ? `${tradeSummary.pctProfitableShort.toFixed(2)}%` : "—"}
                    </td>
                  </tr>
                  <tr className={isDarkMode ? "border-b border-slate-800/50" : "border-b border-slate-100"}>
                    <td className="py-2.5 px-4">Avg P&L</td>
                    <td className={`text-right py-2.5 px-4 font-mono ${tradeSummary.avgPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {tradeSummary.avgPnl.toFixed(2)} <span className="text-xs text-slate-500">USD</span>
                    </td>
                    <td className={`text-right py-2.5 px-4 font-mono ${tradeSummary.avgPnlLong >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {tradeSummary.avgPnlLong.toFixed(2)} <span className="text-xs text-slate-500">USD</span>
                    </td>
                    <td className={`text-right py-2.5 px-4 font-mono ${tradeSummary.avgPnlShort >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {tradeSummary.avgPnlShort.toFixed(2)} <span className="text-xs text-slate-500">USD</span>
                    </td>
                  </tr>
                  <tr className={isDarkMode ? "border-b border-slate-800/50" : "border-b border-slate-100"}>
                    <td className="py-2.5 px-4">Avg winning trade</td>
                    <td className="text-right py-2.5 px-4 font-mono text-emerald-400">{tradeSummary.avgWin.toFixed(2)} <span className="text-xs text-slate-500">USD</span></td>
                    <td className="text-right py-2.5 px-4 font-mono text-emerald-400">{tradeSummary.avgWinLong.toFixed(2)} <span className="text-xs text-slate-500">USD</span></td>
                    <td className="text-right py-2.5 px-4 font-mono text-emerald-400">{tradeSummary.avgWinShort.toFixed(2)} <span className="text-xs text-slate-500">USD</span></td>
                  </tr>
                  <tr className={isDarkMode ? "border-b border-slate-800/50" : "border-b border-slate-100"}>
                    <td className="py-2.5 px-4">Avg losing trade</td>
                    <td className="text-right py-2.5 px-4 font-mono text-rose-400">{tradeSummary.avgLoss.toFixed(2)} <span className="text-xs text-slate-500">USD</span></td>
                    <td className="text-right py-2.5 px-4 font-mono text-rose-400">{tradeSummary.avgLossLong.toFixed(2)} <span className="text-xs text-slate-500">USD</span></td>
                    <td className="text-right py-2.5 px-4 font-mono text-rose-400">{tradeSummary.avgLossShort.toFixed(2)} <span className="text-xs text-slate-500">USD</span></td>
                  </tr>
                  <tr className={isDarkMode ? "border-b border-slate-800/50" : "border-b border-slate-100"}>
                    <td className="py-2.5 px-4">Ratio avg win / avg loss</td>
                    <td className="text-right py-2.5 px-4 font-mono">{tradeSummary.ratioWinLoss.toFixed(3)}</td>
                    <td className="text-right py-2.5 px-4 font-mono">{tradeSummary.ratioWinLossLong.toFixed(3)}</td>
                    <td className="text-right py-2.5 px-4 font-mono">{tradeSummary.ratioWinLossShort.toFixed(3)}</td>
                  </tr>
                  <tr className={isDarkMode ? "border-b border-slate-800/50" : "border-b border-slate-100"}>
                    <td className="py-2.5 px-4">Largest winning trade</td>
                    <td className="text-right py-2.5 px-4 font-mono text-emerald-400">{tradeSummary.largestWin.toFixed(2)} <span className="text-xs text-slate-500">USD</span></td>
                    <td className="text-right py-2.5 px-4 font-mono text-emerald-400">{tradeSummary.largestWinLong.toFixed(2)} <span className="text-xs text-slate-500">USD</span></td>
                    <td className="text-right py-2.5 px-4 font-mono text-emerald-400">{tradeSummary.largestWinShort.toFixed(2)} <span className="text-xs text-slate-500">USD</span></td>
                  </tr>
                  <tr className={isDarkMode ? "border-b border-slate-800/50" : "border-b border-slate-100"}>
                    <td className="py-2.5 px-4">Largest losing trade</td>
                    <td className="text-right py-2.5 px-4 font-mono text-rose-400">{tradeSummary.largestLoss.toFixed(2)} <span className="text-xs text-slate-500">USD</span></td>
                    <td className="text-right py-2.5 px-4 font-mono text-rose-400">{tradeSummary.largestLossLong.toFixed(2)} <span className="text-xs text-slate-500">USD</span></td>
                    <td className="text-right py-2.5 px-4 font-mono text-rose-400">{tradeSummary.largestLossShort.toFixed(2)} <span className="text-xs text-slate-500">USD</span></td>
                  </tr>
                  <tr className={isDarkMode ? "border-b border-slate-800/50" : "border-b border-slate-100"}>
                    <td className="py-2.5 px-4">Avg # bars in trades</td>
                    <td className="text-right py-2.5 px-4 font-mono">{Math.round(tradeSummary.avgBarsInTrades)}</td>
                    <td className="text-right py-2.5 px-4 font-mono">{Math.round(tradeSummary.avgBarsInTrades)}</td>
                    <td className="text-right py-2.5 px-4 font-mono">{Math.round(tradeSummary.avgBarsInTrades)}</td>
                  </tr>
                  <tr className={isDarkMode ? "border-b border-slate-800/50" : "border-b border-slate-100"}>
                    <td className="py-2.5 px-4">Avg # bars in winning trades</td>
                    <td className="text-right py-2.5 px-4 font-mono">{Math.round(tradeSummary.avgBarsInWinning)}</td>
                    <td className="text-right py-2.5 px-4 font-mono">{Math.round(tradeSummary.avgBarsInWinning)}</td>
                    <td className="text-right py-2.5 px-4 font-mono">{Math.round(tradeSummary.avgBarsInWinning)}</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4">Avg # bars in losing trades</td>
                    <td className="text-right py-2.5 px-4 font-mono">{Math.round(tradeSummary.avgBarsInLosing)}</td>
                    <td className="text-right py-2.5 px-4 font-mono">{Math.round(tradeSummary.avgBarsInLosing)}</td>
                    <td className="text-right py-2.5 px-4 font-mono">{Math.round(tradeSummary.avgBarsInLosing)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Risk/Performance Ratios Tab */}
          {activeInsightTab === "Risk/performance ratios" && (
            <div className={`rounded-2xl border ${isDarkMode ? "border-slate-700/60 bg-slate-900/70" : "border-slate-200 bg-white"}`}>
              <table className="w-full text-xs">
                <thead>
                  <tr className={isDarkMode ? "border-b border-slate-700/50" : "border-b border-slate-200"}>
                    <th className={`text-left py-3 px-4 font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Metric</th>
                    <th className={`text-right py-3 px-4 font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>All</th>
                    <th className={`text-right py-3 px-4 font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Long</th>
                    <th className={`text-right py-3 px-4 font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Short</th>
                  </tr>
                </thead>
                <tbody className={isDarkMode ? "text-slate-200" : "text-slate-700"}>
                  <tr className={isDarkMode ? "border-b border-slate-800/50" : "border-b border-slate-100"}>
                    <td className="py-2.5 px-4">Profit factor</td>
                    <td className="text-right py-2.5 px-4 font-mono">
                      {insightStats.riskRatios.profitFactorAll == null ? "—" : insightStats.riskRatios.profitFactorAll === Infinity ? "∞" : insightStats.riskRatios.profitFactorAll.toFixed(3)}
                    </td>
                    <td className="text-right py-2.5 px-4 font-mono">
                      {insightStats.riskRatios.profitFactorLong == null ? "—" : insightStats.riskRatios.profitFactorLong === Infinity ? "∞" : insightStats.riskRatios.profitFactorLong.toFixed(3)}
                    </td>
                    <td className="text-right py-2.5 px-4 font-mono">
                      {insightStats.riskRatios.profitFactorShort == null ? "—" : insightStats.riskRatios.profitFactorShort === Infinity ? "∞" : insightStats.riskRatios.profitFactorShort.toFixed(3)}
                    </td>
                  </tr>
                  <tr className={isDarkMode ? "border-b border-slate-800/50" : "border-b border-slate-100"}>
                    <td className="py-2.5 px-4">Sharpe ratio</td>
                    <td className="text-right py-2.5 px-4 font-mono">{insightStats.riskRatios.sharpe != null ? insightStats.riskRatios.sharpe.toFixed(3) : "—"}</td>
                    <td className="text-right py-2.5 px-4 font-mono"></td>
                    <td className="text-right py-2.5 px-4 font-mono"></td>
                  </tr>
                  <tr className={isDarkMode ? "border-b border-slate-800/50" : "border-b border-slate-100"}>
                    <td className="py-2.5 px-4">Sortino ratio</td>
                    <td className="text-right py-2.5 px-4 font-mono">{insightStats.riskRatios.sortino != null ? insightStats.riskRatios.sortino.toFixed(3) : "—"}</td>
                    <td className="text-right py-2.5 px-4 font-mono"></td>
                    <td className="text-right py-2.5 px-4 font-mono"></td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-4">Margin calls</td>
                    <td className="text-right py-2.5 px-4 font-mono">{insightStats.riskRatios.marginCalls}</td>
                    <td className="text-right py-2.5 px-4 font-mono">{insightStats.riskRatios.marginCalls}</td>
                    <td className="text-right py-2.5 px-4 font-mono">{insightStats.riskRatios.marginCalls}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* List of Trades Tab */}
          {activeInsightTab === "List of trades" && (
            <div className={`rounded-2xl border overflow-hidden ${isDarkMode ? "border-slate-700/60 bg-slate-900/70" : "border-slate-200 bg-white"}`}>
              <div className="max-h-[500px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className={`sticky top-0 ${isDarkMode ? "bg-slate-900" : "bg-white"}`}>
                    <tr className={isDarkMode ? "border-b border-slate-700/50" : "border-b border-slate-200"}>
                      <th className={`text-left py-3 px-3 font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Trade #</th>
                      <th className={`text-left py-3 px-3 font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Type</th>
                      <th className={`text-left py-3 px-3 font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Date/Time</th>
                      <th className={`text-left py-3 px-3 font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Signal</th>
                      <th className={`text-right py-3 px-3 font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Price</th>
                      <th className={`text-right py-3 px-3 font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Position size</th>
                      <th className={`text-right py-3 px-3 font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Net P&L</th>
                      <th className={`text-right py-3 px-3 font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Run-up</th>
                      <th className={`text-right py-3 px-3 font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Drawdown</th>
                      <th className={`text-right py-3 px-3 font-medium ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Cumulative P&L</th>
                    </tr>
                  </thead>
                  <tbody className={isDarkMode ? "text-slate-200" : "text-slate-700"}>
                    {tradeTableRows.map((row, idx) => {
                      const { trade, tradeNum, pnlAbs, pnlPct, cumulativeAbs, cumulativePct, basis } = row;
                      const pnlPositive = (pnlAbs ?? 0) >= 0;
                      const runUpAbs = trade.runUp ?? null;
                      const runUpPct = runUpAbs != null ? (basis ? runUpAbs / basis : null) : null;
                      const drawdownAbs = trade.drawdown != null ? -Math.abs(trade.drawdown) : null;
                      const drawdownPct = trade.drawdown != null ? (basis ? -Math.abs(trade.drawdown) / basis : null) : null;
                      const qtyDisplay =
                        trade.quantity != null && Number.isFinite(trade.quantity) ? trade.quantity.toFixed(2) : "—";
                      const formatCompactUsd = (v: number | null | undefined) => {
                        if (v == null || !Number.isFinite(v)) return "—";
                        return Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(v);
                      };
                      return (
                        <React.Fragment key={`trade-${idx}`}>
                          {/* Exit row */}
                          <tr className={isDarkMode ? "border-b border-slate-800/30" : "border-b border-slate-50"}>
                            <td className="py-3 px-3" rowSpan={2}>
                              <span className="font-mono">{tradeNum}</span>{" "}
                              <span className={trade.side === "long" ? "text-emerald-400" : "text-rose-400"}>
                                {trade.side === "long" ? "Long" : "Short"}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-slate-400">Exit</td>
                            <td className="py-3 px-3">{trade.exitDate || "Open"}</td>
                            <td className="py-3 px-3 text-slate-400">Open</td>
                            <td className="text-right py-3 px-3 font-mono">{trade.exitPrice?.toFixed(2) || "—"} <span className="text-xs text-slate-500">USD</span></td>
                            <td className="text-right py-3 px-3 font-mono">{qtyDisplay}</td>
                            <td className={`text-right py-3 px-3 font-mono ${pnlPositive ? "text-emerald-400" : "text-rose-400"}`}>
                              {formatUsd(pnlAbs, { sign: true })} <span className="text-xs text-slate-500">USD</span>
                              <div className={`text-xs ${pnlPositive ? "text-emerald-300" : "text-rose-300"}`}>{formatPct(pnlPct)}</div>
                            </td>
                            <td className={`text-right py-3 px-3 font-mono ${isDarkMode ? "text-slate-200" : "text-slate-700"}`}>
                              {formatUsd(runUpAbs)} <span className="text-xs text-slate-500">USD</span>
                              <div className={`text-xs ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>{formatPct(runUpPct)}</div>
                            </td>
                            <td className={`text-right py-3 px-3 font-mono ${isDarkMode ? "text-slate-200" : "text-slate-700"}`}>
                              {formatUsd(drawdownAbs, { sign: true })} <span className="text-xs text-slate-500">USD</span>
                              <div className={`text-xs ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>{formatPct(drawdownPct)}</div>
                            </td>
                            <td className={`text-right py-3 px-3 font-mono ${cumulativeAbs >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                              {formatUsd(cumulativeAbs, { sign: true })} <span className="text-xs text-slate-500">USD</span>
                              <div className={`text-xs ${cumulativeAbs >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{formatPct(cumulativePct)}</div>
                            </td>
                          </tr>
                          {/* Entry row */}
                          <tr className={isDarkMode ? "border-b border-slate-800/50" : "border-b border-slate-100"}>
                            <td className="py-3 px-3 text-slate-400">Entry</td>
                            <td className="py-3 px-3">{trade.entryDate}</td>
                            <td className="py-3 px-3">{trade.signal || "—"}</td>
                            <td className="text-right py-3 px-3 font-mono">{trade.entryPrice?.toFixed(2) || "—"} <span className="text-xs text-slate-500">USD</span></td>
                            <td className="text-right py-3 px-3 font-mono">{formatCompactUsd(basis)} <span className="text-xs text-slate-500">USD</span></td>
                            <td className="text-right py-3 px-3 font-mono text-slate-500">—</td>
                            <td className="text-right py-3 px-3 font-mono text-slate-500">—</td>
                            <td className="text-right py-3 px-3 font-mono text-slate-500">—</td>
                            <td className="text-right py-3 px-3 font-mono text-slate-500">—</td>
                          </tr>
                        </React.Fragment>
                      );
                    })}
                    {tradeSummary.allTrades.length === 0 && (
                      <tr>
                        <td colSpan={10} className="py-8 text-center text-slate-500">No trades to display</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Trade Detail Card - shown when a trade marker is clicked */}
      {selectedTrade && (
        <TradeDetailCard
          trade={selectedTrade}
          isDarkMode={isDarkMode}
          onClose={() => setSelectedTrade(null)}
        />
      )}
    </div>
  );
};

// Memoize PriceChart to prevent re-renders from parent state changes
// (e.g., T212 table updates) that don't affect chart props
export const PriceChart = React.memo(PriceChartInner);

interface MomentumTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string | number;
  momentumPeriod?: number;
  adxPeriod?: number;
}

const MomentumTooltip: React.FC<MomentumTooltipProps> = ({
  active,
  payload,
  momentumPeriod,
  adxPeriod,
}) => {
  if (!active || !payload || payload.length === 0) return null;

  const data = payload[0]?.payload;
  const score: number | undefined = data?.momentumScore;
  const adxValue: number | undefined = data?.adxValue;

  if (score == null || momentumPeriod == null) return null;

  let zoneLabel = "Neutral (30–70)";
  let zoneClass = "text-slate-300";

  if (score >= 70) {
    zoneLabel = "Overbought (≥70)";
    zoneClass = "text-amber-300";
  } else if (score <= 30) {
    zoneLabel = "Oversold (≤30)";
    zoneClass = "text-sky-300";
  }

  let adxBandLabel = "—";
  let adxBandClass = "text-slate-300";

  if (adxValue != null) {
    if (adxValue < 20) {
      adxBandLabel = "Weak (<20)";
      adxBandClass = "text-slate-300";
    } else if (adxValue < 40) {
      adxBandLabel = "Normal (20–40)";
      adxBandClass = "text-emerald-300";
    } else if (adxValue < 60) {
      adxBandLabel = "Strong (40–60)";
      adxBandClass = "text-emerald-400";
    } else {
      adxBandLabel = "Very Strong (≥60)";
      adxBandClass = "text-amber-300";
    }
  }

  return (
    <div className={`${TOOLTIP_CLASS} text-[11px] text-white/80 space-y-1.5`}>
      <div className={`${TOOLTIP_TITLE_CLASS} text-xs`}>Momentum ({momentumPeriod}D)</div>
      <div className="flex items-baseline justify-between">
        <span className={TOOLTIP_MUTED_CLASS}>Score</span>
        <span className="font-mono text-white">{score.toFixed(0)}</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className={TOOLTIP_MUTED_CLASS}>Zone</span>
        <span className={`font-mono ${zoneClass}`}>{zoneLabel}</span>
      </div>

      {adxPeriod && adxValue != null && (
        <div className="pt-2 border-t border-white/10 space-y-1">
          <div className={`${TOOLTIP_TITLE_CLASS} text-[11px]`}>ADX ({adxPeriod}D)</div>
          <div className="flex items-baseline justify-between">
            <span className={TOOLTIP_MUTED_CLASS}>Value</span>
            <span className="font-mono text-white">{adxValue.toFixed(1)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className={TOOLTIP_MUTED_CLASS}>Strength</span>
            <span className={`font-mono ${adxBandClass}`}>
              {adxBandLabel}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

interface PriceTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: readonly { 
    value: number;
    payload: any; // Can be ChartPoint or scatter marker data
  }[];
  isDarkMode?: boolean;
  horizon?: number;
  trading212EventsByDate?: Map<string, {
    type: 'open' | 'close';
    runLabel: string;
    source?: "windowSim" | "globalFallback";
    side: 'long' | 'short';
    entryDate: string;
    entryPrice: number;
    exitDate?: string;
    exitPrice?: number;
    netPnl?: number;
    margin?: number;
  }[]>;
  ewmaShortWindow?: number;
  ewmaLongWindow?: number;
}

// Type for trade marker in tooltip (legacy - keeping for backwards compat)
type TradeMarkerPointForTooltip = {
  index: number;
  price: number;
  type: 'entry' | 'exit';
  side: 'long' | 'short';
  runId: string;
  label: string;
  color: string;
  netPnl?: number;
  margin?: number;
  quantity?: number;
};

/** Format a date string as short format (e.g., "Jun 3") */
const formatDateShort = (dateStr: string | null | undefined): string | null => {
  if (!dateStr) return null;
  try {
    const d = new Date(`${dateStr}T00:00:00Z`);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  } catch {
    return dateStr;
  }
};

const formatDateLong = (dateStr: string | null | undefined): string | null => {
  if (!dateStr) return null;
  try {
    const d = new Date(`${dateStr}T00:00:00Z`);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return dateStr;
  }
};

const formatRangeLabel = (window: { start: string; end: string } | null | undefined): string => {
  if (!window) return "Select range";
  const start = formatDateLong(window.start) ?? window.start;
  const end = formatDateLong(window.end) ?? window.end;
  return `${start} — ${end}`;
};

const PriceTooltip: React.FC<PriceTooltipProps> = ({
  active,
  label,
  payload,
  isDarkMode = true,
  horizon = 1,
  trading212EventsByDate,
  ewmaShortWindow,
  ewmaLongWindow,
}) => {
  if (!active || !payload || !payload.length || !label) return null;
  
  // Normalize label to string for date lookups
  const labelStr = typeof label === 'string' ? label : String(label);
  
  // Find the main chart data (first payload that has 'date' field - not scatter data)
  const chartPayload = payload.find(p => p.payload && 'date' in p.payload);
  const data = chartPayload?.payload ?? payload[0].payload;
  const shortValue = data.trendEwmaShort ?? null;
  const longValue = data.trendEwmaLong ?? null;
  
  // Check if this is a future/forecast-only point (no historical price, only forecast data)
  const isFuturePoint = data.isFuture === true;
  const hasForecastData = isFuturePoint && (data.forecastCenter != null || data.forecastLower != null || data.forecastUpper != null);
  const formatPrice = (v: number | null) => (v != null ? v.toFixed(2) : '—');
  const formatDelta = (v: number | null | undefined) => {
    if (v == null || Number.isNaN(v)) return '—';
    return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  };
  let trendLabel = 'Neutral';
  let trendClass = isDarkMode ? 'text-slate-300' : 'text-gray-600';

  if (shortValue != null && longValue != null) {
    if (shortValue > longValue) {
      trendLabel = 'Bullish';
      trendClass = 'text-emerald-400';
    } else if (shortValue < longValue) {
      trendLabel = 'Bearish';
      trendClass = 'text-rose-400';
    }
  }
  
  // Get model name for forecast display
  const modelFriendly = data.forecastModelName || 'Model';
  const modelWindow = data.forecastWindowN ?? null;
  const modelHeader = modelFriendly;
  
  // Get Trading212 events for this date from the map (opens AND closes)
  const t212Events = trading212EventsByDate?.get(labelStr) ?? [];
  const t212HasGlobalFallbackMarkers = t212Events.some((e) => e.source === "globalFallback");
  
  // Legacy: Extract trade markers from scatter payload (for backwards compat)
  const tradeMarkers: TradeMarkerPointForTooltip[] = (payload ?? [])
    .map((p) => p.payload?.marker as TradeMarkerPointForTooltip | undefined)
    .filter((m): m is TradeMarkerPointForTooltip => m != null);
  
  return (
    <div className={`rounded-xl border shadow-2xl backdrop-blur-xl ${
      isDarkMode 
        ? 'bg-slate-800/40 border-slate-600/30 text-slate-100'
        : 'bg-white/60 border-gray-200/50 text-gray-900'
    }`}>
      {/* Date Header */}
      <div className={`${TOOLTIP_HEADER_PADDING} border-b ${
        isDarkMode ? 'border-slate-600/30' : 'border-gray-200/50'
      }`}>
        <div className={`text-[11px] font-semibold tracking-wide ${
          isDarkMode ? 'text-slate-200' : 'text-gray-700'
        }`}>
          {formatTooltipDate(labelStr)}
        </div>
      </div>
      
      <div className={`flex ${isDarkMode ? 'divide-x divide-slate-600/30' : 'divide-x divide-gray-200/50'}`}>
        {/* Model Forecast Section - Blue themed (only for future forecast points) */}
        {hasForecastData && (
          <div className={TOOLTIP_COLUMN_CLASS}>
            {/* Section Header */}
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`text-[9px] font-semibold uppercase tracking-wider ${
                isDarkMode ? 'text-blue-400' : 'text-blue-600'
              }`}>
                {modelHeader}
              </span>
            </div>
            
            <div className="space-y-0.5 text-[10px]">
              {/* Window (N) */}
              <div className={`flex justify-between ${TOOLTIP_ROW_GAP}`}>
                <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>N</span>
                <span className={`font-mono tabular-nums ${isDarkMode ? 'text-blue-300/70' : 'text-blue-600'}`}>
                  {modelWindow != null ? modelWindow.toLocaleString() : '–'}
                </span>
              </div>
              {/* Model Forecast (center) */}
              {data.forecastCenter != null && (
                <div className={`flex justify-between ${TOOLTIP_ROW_GAP}`}>
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>Forecast</span>
                  <span className={`font-mono tabular-nums font-medium ${isDarkMode ? 'text-blue-300' : 'text-blue-700'}`}>
                    ${data.forecastCenter.toFixed(2)}
                  </span>
                </div>
              )}
              {data.forecastUpper != null && (
                <div className={`flex justify-between ${TOOLTIP_ROW_GAP}`}>
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>Upper</span>
                  <span className={`font-mono tabular-nums ${isDarkMode ? 'text-blue-300/70' : 'text-blue-600'}`}>
                    ${data.forecastUpper.toFixed(2)}
                  </span>
                </div>
              )}
              {data.forecastLower != null && (
                <div className={`flex justify-between ${TOOLTIP_ROW_GAP}`}>
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>Lower</span>
                  <span className={`font-mono tabular-nums ${isDarkMode ? 'text-blue-300/70' : 'text-blue-600'}`}>
                    ${data.forecastLower.toFixed(2)}
                  </span>
                </div>
              )}
              {/* μ* and σ parameters */}
              {data.forecastMuStar != null && (
                <div className={`flex justify-between ${TOOLTIP_ROW_GAP}`}>
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>μ*</span>
                  <span className={`font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.forecastMuStar.toExponential(2)}
                  </span>
                </div>
              )}
              {data.forecastSigma != null && (
                <div className={`flex justify-between ${TOOLTIP_ROW_GAP}`}>
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>σ</span>
                  <span className={`font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.forecastSigma.toFixed(4)}
                  </span>
                </div>
              )}
              {/* GARCH volatility parameters */}
              {data.forecastOmega != null && (
                <div className={`flex justify-between ${TOOLTIP_ROW_GAP}`}>
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>ω</span>
                  <span className={`font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.forecastOmega.toExponential(2)}
                  </span>
                </div>
              )}
              {data.forecastAlpha != null && (
                <div className={`flex justify-between ${TOOLTIP_ROW_GAP}`}>
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>α</span>
                  <span className={`font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.forecastAlpha.toFixed(4)}
                  </span>
                </div>
              )}
              {data.forecastBeta != null && (
                <div className={`flex justify-between ${TOOLTIP_ROW_GAP}`}>
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>β</span>
                  <span className={`font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.forecastBeta.toFixed(4)}
                  </span>
                </div>
              )}
              {data.forecastAlphaPlusBeta != null && (
                <div className={`flex justify-between ${TOOLTIP_ROW_GAP}`}>
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>α+β</span>
                  <span className={`font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.forecastAlphaPlusBeta.toFixed(4)}
                  </span>
                </div>
              )}
              {data.forecastUncondVar != null && (
                <div className={`flex justify-between ${TOOLTIP_ROW_GAP}`}>
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>σ²∞</span>
                  <span className={`font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.forecastUncondVar.toExponential(2)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* OHLCV Data - only show for historical points */}
        {!isFuturePoint && (data.open || data.high || data.low || data.close || data.volume) && (
          <div className={TOOLTIP_COLUMN_CLASS}>
            <div className={`text-[9px] font-semibold uppercase tracking-wider mb-1 ${
              isDarkMode ? 'text-slate-400' : 'text-gray-500'
            }`}>
              OHLCV
            </div>
            <div className="space-y-1 text-[10px]">
              {data.open && (
                <div className={`flex items-baseline justify-between ${TOOLTIP_ROW_GAP}`}>
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>Open</span>
                  <span className={`${TOOLTIP_VALUE_CLASS} ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>${data.open.toFixed(2)}</span>
                </div>
              )}
              {data.high && (
                <div className={`flex items-baseline justify-between ${TOOLTIP_ROW_GAP}`}>
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>High</span>
                  <span className={`${TOOLTIP_VALUE_CLASS} ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>${data.high.toFixed(2)}</span>
                </div>
              )}
              {data.low && (
                <div className={`flex items-baseline justify-between ${TOOLTIP_ROW_GAP}`}>
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>Low</span>
                  <span className={`${TOOLTIP_VALUE_CLASS} ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>${data.low.toFixed(2)}</span>
                </div>
              )}
              {data.close && (
                <div className={`flex items-baseline justify-between ${TOOLTIP_ROW_GAP}`}>
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>Close</span>
                  <span className={`${TOOLTIP_VALUE_CLASS} font-medium ${
                    data.open && data.close > data.open
                      ? 'text-emerald-400'
                      : data.open && data.close < data.open
                        ? 'text-rose-400'
                        : isDarkMode ? 'text-slate-400' : 'text-gray-500'
                  }`}>${data.close.toFixed(2)}</span>
                </div>
              )}
              {data.volume && (
                <div className={`flex items-baseline justify-between ${TOOLTIP_ROW_GAP}`}>
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>Vol</span>
                  <span className={`${TOOLTIP_VALUE_CLASS} ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>{formatVolumeAbbreviated(data.volume)}</span>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* EWMA Trend Section */}
        {(data.trendEwmaShort != null || data.trendEwmaLong != null) && (
          <div className={TOOLTIP_COLUMN_CLASS}>
            {/* Section Header */}
            <div className="mb-1">
              <span className={`text-[9px] font-semibold uppercase tracking-wider ${
                isDarkMode ? 'text-yellow-400' : 'text-yellow-600'
              }`}>
                EWMA Trend
              </span>
            </div>
            
            {/* Single column layout */}
            <div className="text-[9px] space-y-0.5">
              {/* Short EWMA (yellow) */}
              <div className={`flex justify-between ${TOOLTIP_ROW_GAP_WIDE}`}>
                <span className={isDarkMode ? 'text-slate-200' : 'text-gray-700'}>Short EWMA</span>
                <span className={`font-mono tabular-nums font-bold ${isDarkMode ? 'text-yellow-300' : 'text-yellow-700'}`}>
                  {data.trendEwmaShort != null ? data.trendEwmaShort.toFixed(2) : '—'}
                </span>
              </div>
              {/* Long EWMA (blue) */}
              <div className={`flex justify-between ${TOOLTIP_ROW_GAP_WIDE}`}>
                <span className={isDarkMode ? 'text-slate-200' : 'text-gray-700'}>Long EWMA</span>
                <span className={`font-mono tabular-nums font-bold ${isDarkMode ? 'text-blue-300' : 'text-blue-700'}`}>
                  {data.trendEwmaLong != null ? data.trendEwmaLong.toFixed(2) : '—'}
                </span>
              </div>
              {/* Signal - Bullish when short > long, Bearish when short < long */}
              {data.trendEwmaShort != null && data.trendEwmaLong != null && (
                <div className={`flex justify-between ${TOOLTIP_ROW_GAP_WIDE}`}>
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>Signal</span>
                  <span className={`font-mono tabular-nums font-semibold ${
                    data.trendEwmaShort > data.trendEwmaLong 
                      ? 'text-emerald-400' 
                      : 'text-rose-400'
                  }`}>
                    {data.trendEwmaShort > data.trendEwmaLong ? 'Bullish' : 'Bearish'}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* Trading212 Events Section (opens AND closes) */}
        {t212Events.length > 0 && (
          <div className={TOOLTIP_COLUMN_CLASS}>
            {/* Section Header - no dot, renamed to Trade */}
            <div className="mb-1">
              <span className={`text-[9px] font-semibold uppercase tracking-wider ${
                isDarkMode ? 'text-sky-400' : 'text-sky-600'
              }`}>
                Trade
              </span>
              {t212HasGlobalFallbackMarkers && (
                <div className={`mt-1 text-[9px] ${isDarkMode ? "text-slate-400" : "text-gray-500"}`}>
                  Markers from global run (strict restart blocked)
                </div>
              )}
            </div>
            
            <div className="space-y-1 text-[10px]">
              {t212Events.map((e, idx) => {
                const isShort = e.side === 'short';
                const openLabel = e.side === 'long' ? 'Open Long' : 'Open Short';
                const exitLabel = e.side === 'long' ? 'Exit Long' : 'Exit Short';

                if (e.type === 'open') {
                  // Open event - just show the open line
                  return (
                    <div key={idx} className={`flex justify-between ${TOOLTIP_ROW_GAP_WIDE}`}>
                      <span className="flex items-center gap-1 text-slate-300">
                        <span
                          className={
                            'inline-flex h-2 w-2 rounded-full ' +
                            (isShort ? 'bg-rose-400' : 'bg-emerald-400')
                          }
                        />
                        {openLabel}
                      </span>
                      <span className="font-mono tabular-nums text-slate-200">
                        ${e.entryPrice.toFixed(2)}
                      </span>
                    </div>
                  );
                }

                // Close event - show Open + Exit + P&L for the closed position
                const pnl = e.netPnl ?? 0;
                const pct = e.margin ? (pnl / e.margin) * 100 : 0;
                const isGain = pnl >= 0;

                // Format entry date as Day-Month (e.g. "07-Apr")
                const formatDayMonth = (dateStr: string) => {
                  const d = new Date(dateStr + 'T00:00:00Z');
                  const day = d.getUTCDate().toString().padStart(2, '0');
                  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
                  return `${day}-${month}`;
                };

                return (
                  <div key={idx} className="flex flex-col space-y-0.5">
                    {/* Open row for this CLOSED position */}
                    <div className={`flex justify-between ${TOOLTIP_ROW_GAP_WIDE}`}>
                      <span className="flex items-center gap-1 text-slate-300">
                        <span
                          className={
                            'inline-flex h-2 w-2 rounded-full ' +
                            (isShort ? 'bg-rose-400' : 'bg-emerald-400')
                          }
                        />
                        {openLabel}
                      </span>
                      <span className="font-mono tabular-nums text-slate-200">
                        ${e.entryPrice.toFixed(2)}
                      </span>
                    </div>

                    {/* Exit row */}
                    <div className={`flex justify-between ${TOOLTIP_ROW_GAP_WIDE}`}>
                      <span className="flex items-center gap-1 text-slate-300">
                        <span
                          className={
                            'inline-flex h-2 w-2 rounded-full border-2 bg-slate-900 ' +
                            (isShort ? 'border-rose-400' : 'border-emerald-400')
                          }
                        />
                        {exitLabel}
                      </span>
                      <span className="font-mono tabular-nums text-slate-200">
                        ${e.exitPrice?.toFixed(2) ?? '—'}
                      </span>
                    </div>

                    {/* P&L row - dollar amount */}
                    <div className={`flex justify-between ${TOOLTIP_ROW_GAP_WIDE} ml-3`}>
                      <span className={isDarkMode ? 'text-slate-400' : 'text-gray-400'}>P&amp;L</span>
                      <span
                        className={
                          'font-mono tabular-nums font-medium ' +
                          (isGain ? 'text-emerald-400' : 'text-rose-400')
                        }
                      >
                        {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
                      </span>
                    </div>

                    {/* P&L percentage row - below the dollar amount */}
                    {e.margin != null && (
                      <div className="flex justify-end ml-3">
                        <span
                          className={
                            'font-mono tabular-nums text-[8px] ' +
                            (isGain ? 'text-emerald-400/80' : 'text-rose-400/80')
                          }
                        >
                          ({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function formatXAxisDate(label: string): string {
  const d = new Date(label + "T00:00:00Z");
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };
  return d.toLocaleDateString(undefined, opts);
}

function formatVolumeAbbreviated(volume: number): string {
  if (volume >= 1000000) {
    // Convert to millions with 2 decimals
    const millions = volume / 1000000;
    return `${Math.round(millions * 100) / 100}M`;
  } else if (volume >= 1000) {
    // Convert to thousands with 2 decimals  
    const thousands = volume / 1000;
    return `${Math.round(thousands * 100) / 100}K`;
  } else {
    // Less than 1000, show as is
    return Math.round(volume).toString();
  }
}

function formatTooltipDate(label: string): string {
  const d = new Date(label + "T00:00:00Z");
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "2-digit",
  };
  return d.toLocaleDateString(undefined, opts);
}

// X-axis tick that centers the label under its bar using the band size/offset provided by Recharts
function CenteredDateTick({
  x = 0,
  y = 0,
  payload,
  isDarkMode,
  width,
  visibleTicksCount,
}: {
  x?: number;
  y?: number;
  payload?: any;
  isDarkMode: boolean;
  width?: number;
  visibleTicksCount?: number;
}) {
  // Calculate the offset to center under the bar
  // The x position from Recharts is at the tick mark (between bars)
  // We need to shift it to the center of the bar
  const offset = payload?.offset ?? 0;
  
  const label = payload?.value ? formatXAxisDate(payload.value) : "";

  return (
    <text
      x={x + offset}
      y={y + 4}
      textAnchor="middle"
      fontSize={10}
      fill={isDarkMode ? "rgba(148, 163, 184, 0.7)" : "rgba(75, 85, 99, 0.7)"}
    >
      {label}
    </text>
  );
}

function VolumeTooltip({ active, payload, label }: any) {
  const isDark = useDarkMode();
  
  if (active && payload && payload.length && payload[0].payload) {
    const { volume, open, close } = payload[0].payload;
    const trend = close > open ? 'bullish' : 'bearish';
    const trendColor = close > open ? '#22c55e' : '#ef4444';
    
    return (
      <div className={`
        p-3 border rounded-md shadow-lg
        ${isDark ? 'bg-gray-800 border-gray-600 text-white' : 'bg-white border-gray-200 text-gray-900'}
      `}>
        <p className="text-sm font-medium mb-1">{formatTooltipDate(label)}</p>
        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-2">
            <span>Volume:</span>
            <span className="font-medium">
              {new Intl.NumberFormat().format(volume)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span>Trend:</span>
            <span 
              className="font-medium capitalize" 
              style={{ color: trendColor }}
            >
              {trend}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// Custom animated dot for price line (green for positive, red for negative)
const AnimatedPriceDot = (props: any) => {
  const { cx, cy, payload, stroke } = props;
  
  // Don't render dot for future/null points
  if (!payload || payload.isFuture || payload.value == null) return null;
  if (cx === undefined || cy === undefined) return null;
  
  // Use the stroke color from the Line component (red or green based on performance)
  const dotColor = stroke || "#22c55e";
  const isRed = dotColor.toLowerCase().includes("ef4444") || dotColor.toLowerCase().includes("f44");
  const glowColor = isRed ? "239, 68, 68" : "34, 197, 94"; // RGB values for glow
  
  return (
    <circle
      cx={cx}
      cy={cy}
      r={3.5}
      fill={dotColor}
      stroke="rgba(255, 255, 255, 0.9)"
      strokeWidth={1.5}
      style={{
        filter: `drop-shadow(0 0 4px rgba(${glowColor}, 0.6)) drop-shadow(0 0 2px rgba(${glowColor}, 0.4))`,
      }}
    />
  );
};
