"use client";

import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  Cell,
  ComposedChart,
  ReferenceLine,
  ReferenceDot,
  Line,
} from "recharts";
import { useDarkMode } from "@/lib/hooks/useDarkMode";
import {
  sliceByRange,
  calculateRangePerformance,
  getRangeLabel,
  type PriceRange,
} from "@/lib/chart/ranges";
import { getNextTradingDates, generateFutureTradingDates } from "@/lib/chart/tradingDays";
import { TradeDetailCard, type TradeDetailData } from "@/components/TradeDetailCard";

// Helper function to calculate target date (Date t+h) accounting for business days
function calculateTargetDate(dateT: string | null, horizon: number): string | null {
  if (!dateT) return null;
  
  try {
    const date = new Date(dateT);
    if (isNaN(date.getTime())) return null;
    
    let businessDaysAdded = 0;
    let currentDate = new Date(date);
    
    while (businessDaysAdded < horizon) {
      currentDate.setDate(currentDate.getDate() + 1);
      const dayOfWeek = currentDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
      
      // Count only business days (Monday = 1 to Friday = 5)
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        businessDaysAdded++;
      }
    }
    
    // Format as YYYY-MM-DD
    return currentDate.toISOString().split('T')[0];
  } catch (error) {
    return null;
  }
}

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
  isFuture?: boolean;
  // Forecast band values
  forecastCenter?: number | null;
  forecastLower?: number | null;
  forecastUpper?: number | null;
  forecastModelName?: string | null;

  // === EWMA Unbiased ===
  // Past H-day forecast: made at t-H, targeting t (the hovered date)
  ewma_past_forecast?: number | null;
  ewma_past_lower?: number | null;
  ewma_past_upper?: number | null;
  ewma_past_origin_date?: string | null;  // t-H
  ewma_past_target_date?: string | null;  // t
  ewma_past_realized?: number | null;     // close(t) for error

  // Current H-day forecast: made at t, targeting t+H
  ewma_future_forecast?: number | null;
  ewma_future_lower?: number | null;
  ewma_future_upper?: number | null;
  ewma_future_origin_date?: string | null; // t
  ewma_future_target_date?: string | null; // t+H

  // Keep legacy fields for rendering lines/bands
  ewma_forecast?: number | null;
  ewma_lower?: number | null;
  ewma_upper?: number | null;
  ewma_origin_date?: string | null;
  ewma_realized?: number | null;

  // === EWMA Biased ===
  ewma_biased_past_forecast?: number | null;
  ewma_biased_past_lower?: number | null;
  ewma_biased_past_upper?: number | null;
  ewma_biased_past_origin_date?: string | null;
  ewma_biased_past_target_date?: string | null;
  ewma_biased_past_realized?: number | null;

  ewma_biased_future_forecast?: number | null;
  ewma_biased_future_lower?: number | null;
  ewma_biased_future_upper?: number | null;
  ewma_biased_future_origin_date?: string | null;
  ewma_biased_future_target_date?: string | null;

  ewma_biased_forecast?: number | null;
  ewma_biased_lower?: number | null;
  ewma_biased_upper?: number | null;
  ewma_biased_origin_date?: string | null;
  ewma_biased_realized?: number | null;
};

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

/** EWMA Walker path point for chart overlay */
export interface EwmaWalkerPathPoint {
  date_t: string;
  date_tp1: string;
  S_t: number;
  S_tp1: number;
  y_hat_tp1: number;
  L_tp1: number;
  U_tp1: number;
}

type VolModel = 'GBM' | 'GARCH' | 'HAR-RV' | 'Range';
type GarchEstimator = 'Normal' | 'Student-t';
type RangeEstimator = 'P' | 'GK' | 'RS' | 'YZ';

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
  ewmaLambda?: number;
  onEwmaLambdaChange?: (lambda: number) => void;
  degreesOfFreedom?: number;
  onDegreesOfFreedomChange?: (df: number) => void;
  // GBM parameters
  gbmLambda?: number;
  onGbmLambdaChange?: (lambda: number) => void;
}

/** EWMA Walker summary statistics for hover card */
export interface EwmaSummary {
  coverage: number;
  targetCoverage: number;
  intervalScore: number;
  avgWidth: number;
  zMean: number;
  zStd: number;
  directionHitRate: number;
  nPoints: number;
}

/** Props for EWMA Reaction Map dropdown controls */
export interface EwmaReactionMapDropdownProps {
  reactionLambda: number;
  setReactionLambda: (v: number) => void;
  reactionTrainFraction: number;
  setReactionTrainFraction: (v: number) => void;
  onMaximize: () => void;
  onReset: () => void;  // Reset callback to clear maximized state
  isLoadingReaction: boolean;
  isOptimizingReaction: boolean;
  isMaximized: boolean;  // Whether the biased EWMA has been optimized
  hasOptimizationResults: boolean;  // Whether optimization results are available to apply
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
}

/** Trade overlay for chart visualization */
export interface Trading212TradeOverlay {
  runId: string;
  label: string;
  color: string;  // hex color for this run
  trades: Trading212TradeInfo[];
}

interface PriceChartProps {
  symbol: string;
  className?: string;
  horizon?: number;  // Number of trading days to extend (1,2,3,5)
  forecastOverlay?: ForecastOverlayProps;
  ewmaPath?: EwmaWalkerPathPoint[] | null;
  ewmaSummary?: EwmaSummary | null;
  ewmaBiasedPath?: EwmaWalkerPathPoint[] | null;
  ewmaBiasedSummary?: EwmaSummary | null;
  onLoadEwmaUnbiased?: () => void;
  onLoadEwmaBiased?: () => void;
  isLoadingEwmaBiased?: boolean;
  ewmaReactionMapDropdown?: EwmaReactionMapDropdownProps;  // Dropdown controls for (⋯) button
  horizonCoverage?: HorizonCoverageProps;
  tradeOverlays?: Trading212TradeOverlay[];  // Trade markers to display on chart
}

const RANGE_OPTIONS: PriceRange[] = [
  "1D",
  "5D", 
  "1M",
  "6M",
  "YTD",
  "1Y",
  "5Y",
  "ALL",
];

export const PriceChart: React.FC<PriceChartProps> = ({
  symbol,
  className,
  horizon,
  forecastOverlay,
  ewmaPath,
  ewmaSummary,
  ewmaBiasedPath,
  ewmaBiasedSummary,
  onLoadEwmaUnbiased,
  onLoadEwmaBiased,
  isLoadingEwmaBiased,
  ewmaReactionMapDropdown,
  horizonCoverage,
  tradeOverlays,
}) => {
  const isDarkMode = useDarkMode();
  const h = horizon ?? 1;
  
  // EWMA overlay toggles
  const [showEwmaOverlay, setShowEwmaOverlay] = useState(false);
  const [showEwmaBiasedOverlay, setShowEwmaBiasedOverlay] = useState(false);
  
  // Model dropdown states
  const [showGarchDropdown, setShowGarchDropdown] = useState(false);
  const [showRangeDropdown, setShowRangeDropdown] = useState(false);
  
  // EWMA Settings dropdown state
  const [showEwmaSettingsDropdown, setShowEwmaSettingsDropdown] = useState(false);
  const ewmaSettingsDropdownRef = useRef<HTMLDivElement>(null);
  
  // Model Settings dropdown state (⋯ button next to Model)
  const [showModelSettingsDropdown, setShowModelSettingsDropdown] = useState(false);
  const modelSettingsDropdownRef = useRef<HTMLDivElement>(null);
  
  // Click outside to close EWMA settings dropdown
  useEffect(() => {
    if (!showEwmaSettingsDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ewmaSettingsDropdownRef.current && !ewmaSettingsDropdownRef.current.contains(e.target as Node)) {
        setShowEwmaSettingsDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEwmaSettingsDropdown]);
  
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
  
  // Determine whether the current overlay is in log domain
  const isLogDomain =
    forecastOverlay?.conformalState &&
    typeof forecastOverlay.conformalState === "object" &&
    forecastOverlay.conformalState.domain === "log";
  
  const [fullData, setFullData] = useState<PricePoint[]>([]);
  const [selectedRange, setSelectedRange] = useState<PriceRange>("1M");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Zoom state - tracks how many days to show from the end
  const [zoomDays, setZoomDays] = useState<number | null>(null);
  
  // Trade detail card state - when a trade marker is clicked
  const [selectedTrade, setSelectedTrade] = useState<TradeDetailData | null>(null);
  
  // Track currently hovered date for chart click handling
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);

  // Build canonical date list from fullData
  const allDates = React.useMemo(
    () => fullData.map((p) => p.date),
    [fullData]
  );

  // Fetch full history once
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/history/${encodeURIComponent(symbol)}`);
        if (!res.ok) {
          throw new Error(`Failed to load history (${res.status})`);
        }
        const json = await res.json();
        const rows = Array.isArray(json.rows) ? json.rows : [];

        const points: PricePoint[] = rows
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

        if (!cancelled) {
          setFullData(points);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("PriceChart load error:", err);
          setError(err instanceof Error ? err.message : "Load failed");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // Zoom functions
  const zoomIn = () => {
    if (fullData.length === 0) return;
    
    // Get base range data first
    const baseRangeData = sliceByRange(fullData, selectedRange);
    const baseDays = baseRangeData.length;
    
    const currentDays = zoomDays || baseDays;
    const newDays = Math.max(7, Math.floor(currentDays * 0.5)); // Zoom in by 50%, minimum 7 days
    setZoomDays(newDays);
  };

  const zoomOut = () => {
    if (fullData.length === 0) return;
    
    // Get base range data first
    const baseRangeData = sliceByRange(fullData, selectedRange);
    const baseDays = baseRangeData.length;
    
    const currentDays = zoomDays || baseDays;
    const newDays = Math.min(baseDays, Math.floor(currentDays * 2)); // Zoom out by 2x
    
    if (newDays >= baseDays) {
      setZoomDays(null); // Reset to full range
    } else {
      setZoomDays(newDays);
    }
  };

  // Reset zoom when changing ranges manually
  const handleRangeChange = (range: PriceRange) => {
    setSelectedRange(range);
    setZoomDays(null);
  };

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

    // Get data for selected range or zoom
    let rangeData: PricePoint[];
    if (zoomDays !== null) {
      // Use zoom: get the base range first, then take last N days from it
      const baseRangeData = sliceByRange(fullData, selectedRange);
      rangeData = baseRangeData.slice(-zoomDays);
    } else {
      // Use normal range selection
      rangeData = sliceByRange(fullData, selectedRange);
    }

    return {
      rangeData,
      perfByRange: perfMap,
    };
  }, [fullData, selectedRange, zoomDays]);

  // Derive last date and future dates
  const lastPoint = rangeData[rangeData.length - 1];
  const lastDateStr = lastPoint?.date;

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

  // Create extended chartData with future placeholders
  const chartData: ChartPoint[] = React.useMemo(() => {
    // Historical portion: same as rangeData, but mark as not future
    const base = rangeData.map((p) => ({
      date: p.date,
      value: p.adj_close,
      open: p.open,
      high: p.high,
      low: p.low,
      close: p.close,
      volume: p.volume,
      // Determine volume color based on price movement
      volumeColor: (p.close && p.open && p.close > p.open) ? "#22c55e" : "#ef4444", // green if bullish, red if bearish
      isFuture: false as const,
    }));

    // Calculate target date for forecast overlay if we have forecast data
    let forecastTargetDate: string | null = null;
    if (forecastOverlay?.activeForecast) {
      const af = forecastOverlay.activeForecast;
      const forecastDateT = af.date_t || af.target_date || af.date;
      if (forecastDateT && h) {
        forecastTargetDate = calculateTargetDate(forecastDateT, h);
      }
    }

    // Combine future dates from horizon and forecast target
    let allFutureDates = [...futureDates];
    
    // Ensure forecast target date is included
    if (forecastTargetDate && !allFutureDates.includes(forecastTargetDate)) {
      allFutureDates.push(forecastTargetDate);
      allFutureDates.sort(); // Keep dates sorted
    }

    if (!allFutureDates.length) return base;

    // Future placeholders: extend X-axis; line stops because value=null
    const futurePoints = allFutureDates.map((d) => ({
      date: d,
      value: null,
      volume: undefined,
      isFuture: true as const,
    }));

    return [...base, ...futurePoints];
  }, [rangeData, futureDates, h, forecastOverlay?.activeForecast]);

  // Merge EWMA forecast paths (neutral and biased) into chartData for overlay
  const chartDataWithEwma = useMemo(() => {
    const showNeutral = showEwmaOverlay && ewmaPath && ewmaPath.length > 0;
    const showBiased = showEwmaBiasedOverlay && ewmaBiasedPath && ewmaBiasedPath.length > 0;
    
    if (!showNeutral && !showBiased) {
      return chartData;
    }

    // Build maps of date_tp1 -> EWMA values (forecast, lower, upper)
    // The EWMA walker forecasts FOR date_tp1 (target date, t+h) using data available at date_t
    // So we plot y_hat_tp1 at date_tp1 (the h-step target date)
    
    // Past map: key = target date (t), value = forecast made at t-H
    const ewmaPastMap = new Map<
      string,
      { forecast: number; lower: number; upper: number; originDate: string; targetDate: string; realized: number }
    >();

    // Future map: key = origin date (t), value = forecast made at t for t+H
    const ewmaFutureMap = new Map<
      string,
      { forecast: number; lower: number; upper: number; originDate: string; targetDate: string }
    >();

    if (showNeutral && ewmaPath) {
      ewmaPath.forEach(point => {
        const targetDate = normalizeDateString(point.date_tp1);
        const originDate = normalizeDateString(point.date_t);

        // Past: we view this as the H-day forecast *for* targetDate
        ewmaPastMap.set(targetDate, {
          forecast: point.y_hat_tp1,
          lower: point.L_tp1,
          upper: point.U_tp1,
          originDate: originDate,
          targetDate,
          realized: point.S_tp1,
        });

        // Future: we can also see this as "from originDate to targetDate"
        // keying by originDate gives us the forecast t -> t+H
        ewmaFutureMap.set(originDate, {
          forecast: point.y_hat_tp1,
          lower: point.L_tp1,
          upper: point.U_tp1,
          originDate,
          targetDate,
        });
      });
    }

    // Biased EWMA maps
    const ewmaBiasedPastMap = new Map<
      string,
      { forecast: number; lower: number; upper: number; originDate: string; targetDate: string; realized: number }
    >();
    const ewmaBiasedFutureMap = new Map<
      string,
      { forecast: number; lower: number; upper: number; originDate: string; targetDate: string }
    >();

    if (showBiased && ewmaBiasedPath) {
      ewmaBiasedPath.forEach(point => {
        const targetDate = normalizeDateString(point.date_tp1);
        const originDate = normalizeDateString(point.date_t);

        ewmaBiasedPastMap.set(targetDate, {
          forecast: point.y_hat_tp1,
          lower: point.L_tp1,
          upper: point.U_tp1,
          originDate,
          targetDate,
          realized: point.S_tp1,
        });

        ewmaBiasedFutureMap.set(originDate, {
          forecast: point.y_hat_tp1,
          lower: point.L_tp1,
          upper: point.U_tp1,
          originDate,
          targetDate,
        });
      });
    }

    // Build a sorted list of all forecasts by origin date for finding "latest unrealized" forecast
    const allEwmaForecasts = showNeutral && ewmaPath 
      ? ewmaPath.map(point => ({
          originDate: normalizeDateString(point.date_t),
          targetDate: normalizeDateString(point.date_tp1),
          forecast: point.y_hat_tp1,
          lower: point.L_tp1,
          upper: point.U_tp1,
        })).sort((a, b) => a.originDate.localeCompare(b.originDate))
      : [];

    const allEwmaBiasedForecasts = showBiased && ewmaBiasedPath
      ? ewmaBiasedPath.map(point => ({
          originDate: normalizeDateString(point.date_t),
          targetDate: normalizeDateString(point.date_tp1),
          forecast: point.y_hat_tp1,
          lower: point.L_tp1,
          upper: point.U_tp1,
        })).sort((a, b) => a.originDate.localeCompare(b.originDate))
      : [];

    // Helper to find the most recent forecast made ON or BEFORE currentDate whose target is > currentDate
    const findCurrentUnrealizedForecast = (
      forecasts: typeof allEwmaForecasts,
      currentDate: string
    ) => {
      // Find forecasts where:
      // 1. originDate <= currentDate (made on or before the hovered date)
      // 2. targetDate > currentDate (not yet realized)
      // Return the one with the latest originDate (most recent forecast made up to this date)
      let best: typeof forecasts[0] | null = null;
      for (const f of forecasts) {
        if (f.originDate <= currentDate && f.targetDate > currentDate) {
          if (!best || f.originDate > best.originDate) {
            best = f;
          }
        }
      }
      return best;
    };

    // Add EWMA fields to chartData points
    const result: ChartPoint[] = chartData.map(point => {
      const chartDate = normalizeDateString(point.date);
      
      const past = ewmaPastMap.get(chartDate);
      const future = ewmaFutureMap.get(chartDate);
      const biasedPast = ewmaBiasedPastMap.get(chartDate);
      const biasedFuture = ewmaBiasedFutureMap.get(chartDate);

      // For the "future" column, if no forecast was made ON this date,
      // find the most recent forecast made on or before this date whose target is still unrealized
      const unrealizedEwma = !future ? findCurrentUnrealizedForecast(allEwmaForecasts, chartDate) : null;
      const unrealizedBiased = !biasedFuture ? findCurrentUnrealizedForecast(allEwmaBiasedForecasts, chartDate) : null;

      const effectiveFuture = future || (unrealizedEwma ? {
        forecast: unrealizedEwma.forecast,
        lower: unrealizedEwma.lower,
        upper: unrealizedEwma.upper,
        originDate: unrealizedEwma.originDate,
        targetDate: unrealizedEwma.targetDate,
      } : null);

      const effectiveBiasedFuture = biasedFuture || (unrealizedBiased ? {
        forecast: unrealizedBiased.forecast,
        lower: unrealizedBiased.lower,
        upper: unrealizedBiased.upper,
        originDate: unrealizedBiased.originDate,
        targetDate: unrealizedBiased.targetDate,
      } : null);

      return {
        ...point,

        // Unbiased EWMA - past H-day forecast (t-H -> t)
        ewma_past_forecast: past?.forecast ?? null,
        ewma_past_lower: past?.lower ?? null,
        ewma_past_upper: past?.upper ?? null,
        ewma_past_origin_date: past?.originDate ?? null,
        ewma_past_target_date: past?.targetDate ?? null,
        ewma_past_realized: past?.realized ?? null,

        // Unbiased EWMA - current H-day forecast (t -> t+H, or latest unrealized)
        ewma_future_forecast: effectiveFuture?.forecast ?? null,
        ewma_future_lower: effectiveFuture?.lower ?? null,
        ewma_future_upper: effectiveFuture?.upper ?? null,
        ewma_future_origin_date: effectiveFuture?.originDate ?? null,
        ewma_future_target_date: effectiveFuture?.targetDate ?? null,

        // Keep legacy fields pointing to "past" so existing lines/bands keep working
        ewma_forecast: past?.forecast ?? null,
        ewma_lower: past?.lower ?? null,
        ewma_upper: past?.upper ?? null,
        ewma_origin_date: past?.originDate ?? null,
        ewma_realized: past?.realized ?? null,

        // Biased EWMA - past
        ewma_biased_past_forecast: biasedPast?.forecast ?? null,
        ewma_biased_past_lower: biasedPast?.lower ?? null,
        ewma_biased_past_upper: biasedPast?.upper ?? null,
        ewma_biased_past_origin_date: biasedPast?.originDate ?? null,
        ewma_biased_past_target_date: biasedPast?.targetDate ?? null,
        ewma_biased_past_realized: biasedPast?.realized ?? null,

        // Biased EWMA - future (or latest unrealized)
        ewma_biased_future_forecast: effectiveBiasedFuture?.forecast ?? null,
        ewma_biased_future_lower: effectiveBiasedFuture?.lower ?? null,
        ewma_biased_future_upper: effectiveBiasedFuture?.upper ?? null,
        ewma_biased_future_origin_date: effectiveBiasedFuture?.originDate ?? null,
        ewma_biased_future_target_date: effectiveBiasedFuture?.targetDate ?? null,

        // Legacy biased fields
        ewma_biased_forecast: biasedPast?.forecast ?? null,
        ewma_biased_lower: biasedPast?.lower ?? null,
        ewma_biased_upper: biasedPast?.upper ?? null,
        ewma_biased_origin_date: biasedPast?.originDate ?? null,
        ewma_biased_realized: biasedPast?.realized ?? null,
      };
    });

    // Helper function to interpolate gaps for a given set of fields
    const interpolateGaps = (
      data: ChartPoint[],
      forecastKey: 'ewma_forecast' | 'ewma_biased_forecast',
      lowerKey: 'ewma_lower' | 'ewma_biased_lower',
      upperKey: 'ewma_upper' | 'ewma_biased_upper'
    ) => {
      for (let i = 0; i < data.length; i++) {
        if (data[i][forecastKey] != null) continue;

        const gapStartIndex = i - 1;
        if (gapStartIndex < 0 || data[gapStartIndex][forecastKey] == null) {
          continue;
        }

        let gapEndIndex = i;
        while (
          gapEndIndex < data.length &&
          data[gapEndIndex][forecastKey] == null
        ) {
          gapEndIndex++;
        }

        if (gapEndIndex >= data.length || data[gapEndIndex][forecastKey] == null) {
          break;
        }

        const prev = data[gapStartIndex];
        const next = data[gapEndIndex];
        const totalSteps = gapEndIndex - gapStartIndex;

        for (let step = 1; step < totalSteps; step++) {
          const idx = gapStartIndex + step;
          const t = step / totalSteps;

          const prevLower = prev[lowerKey];
          const nextLower = next[lowerKey];
          const interpolatedLower: number | null =
            prevLower != null && nextLower != null
              ? prevLower + t * (nextLower - prevLower)
              : null;
              
          const prevUpper = prev[upperKey];
          const nextUpper = next[upperKey];
          const interpolatedUpper: number | null =
            prevUpper != null && nextUpper != null
              ? prevUpper + t * (nextUpper - prevUpper)
              : null;

          const prevForecast = prev[forecastKey]!;
          const nextForecast = next[forecastKey]!;

          data[idx] = {
            ...data[idx],
            [forecastKey]: prevForecast + t * (nextForecast - prevForecast),
            [lowerKey]: interpolatedLower,
            [upperKey]: interpolatedUpper,
          };
        }

        i = gapEndIndex;
      }
    };

    // Interpolate gaps for neutral EWMA
    if (showNeutral) {
      interpolateGaps(result, 'ewma_forecast', 'ewma_lower', 'ewma_upper');
    }
    
    // Interpolate gaps for biased EWMA
    if (showBiased) {
      interpolateGaps(result, 'ewma_biased_forecast', 'ewma_biased_lower', 'ewma_biased_upper');
    }

    return result;
  }, [chartData, ewmaPath, showEwmaOverlay, ewmaBiasedPath, showEwmaBiasedOverlay]);

  // Find last chart points
  const lastChartPoint = chartDataWithEwma[chartDataWithEwma.length - 1];
  const lastHistoricalPoint =
    chartDataWithEwma.slice().reverse().find((p) => p.close != null) || null;

  // Extract forecast band from activeForecast (if any)
  let overlayDate: string | null = null;
  let overlayCenter: number | null = null;
  let overlayLower: number | null = null;
  let overlayUpper: number | null = null;

  const af = forecastOverlay?.activeForecast;

  if (af && chartData.length > 0) {
    // 1) Calculate target date (Date t+h) using business days
    const forecastDateT = af.date_t || af.target_date || af.date;
    
    // Use horizon from forecast data if available, fallback to UI horizon
    // This prevents dots from disappearing when horizon changes but forecast hasn't updated yet
    const forecastHorizon = af.horizonTrading || af.h || af.target?.h;
    const horizonValue = forecastHorizon || h || 1;
    
    // Calculate the target date (t+h) accounting for business days
    const targetDate = calculateTargetDate(forecastDateT, horizonValue);
    const lastPoint = chartData[chartData.length - 1];
    
    // Use the target date if available, otherwise fall back to last chart date
    overlayDate = targetDate || (lastPoint?.date ?? null);

    // 2) Extract center and band exactly like the Inspector does

    const intervals =
      (af.intervals && typeof af.intervals === "object" ? af.intervals : null) ||
      (af.pi && typeof af.pi === "object" ? af.pi : null) ||
      {};

    const topLevelL = typeof af.L_h === "number" ? af.L_h : undefined;
    const topLevelU = typeof af.U_h === "number" ? af.U_h : undefined;

    const L_conf =
      typeof (intervals as any).L_conf === "number"
        ? (intervals as any).L_conf
        : undefined;
    const U_conf =
      typeof (intervals as any).U_conf === "number"
        ? (intervals as any).U_conf
        : undefined;

    const L_base =
      typeof (intervals as any).L_h === "number"
        ? (intervals as any).L_h
        : topLevelL;
    const U_base =
      typeof (intervals as any).U_h === "number"
        ? (intervals as any).U_h
        : topLevelU;

    const L = L_conf ?? L_base;
    const U = U_conf ?? U_base;

    const yHatRaw =
      typeof (af as any).y_hat === "number"
        ? (af as any).y_hat
        : typeof (af as any).yHat === "number"
        ? (af as any).yHat
        : typeof (af as any).center === "number"
        ? (af as any).center
        : typeof (af as any).S_t === "number"
        ? (af as any).S_t
        : null;

    // 3) Transform from log if needed
    const expSafe = (v: number | null) =>
      v != null && Number.isFinite(v) ? Math.exp(v) : null;

    if (isLogDomain) {
      overlayCenter = expSafe(yHatRaw);
      overlayLower =
        typeof L === "number" && Number.isFinite(L) ? Math.exp(L) : null;
      overlayUpper =
        typeof U === "number" && Number.isFinite(U) ? Math.exp(U) : null;
    } else {
      overlayCenter =
        typeof yHatRaw === "number" && Number.isFinite(yHatRaw)
          ? yHatRaw
          : null;
      overlayLower =
        typeof L === "number" && Number.isFinite(L) ? L : null;
      overlayUpper =
        typeof U === "number" && Number.isFinite(U) ? U : null;
    }
  }

  // Get model name for forecast overlay
  const forecastModelName = forecastOverlay?.volModel || horizonCoverage?.volModel || 'Model';

  // Create chart data with forecast band for rendering the connecting lines and filled area
  const chartDataWithForecastBand = useMemo(() => {
    // Start with the EWMA-merged data
    let data = [...chartDataWithEwma];
    
    // If we have forecast overlay data, add band values to relevant points
    if (overlayDate && overlayCenter != null && lastHistoricalPoint) {
      const lastHistDate = lastHistoricalPoint.date;
      const lastHistValue = lastHistoricalPoint.close;
      
      // Check if overlayDate exists in data
      const overlayDateExists = data.some(p => p.date === overlayDate);
      
      // If overlayDate doesn't exist in data, add it
      if (!overlayDateExists) {
        data = [...data, {
          date: overlayDate,
          value: null,
          isFuture: true,
          forecastCenter: overlayCenter,
          forecastLower: overlayLower,
          forecastUpper: overlayUpper,
          forecastModelName,
        }];
        // Sort by date to maintain order
        data.sort((a, b) => a.date.localeCompare(b.date));
      }
      
      // Find the indices of the last historical point and the overlay date
      const lastHistIndex = data.findIndex(p => p.date === lastHistDate);
      const overlayIndex = data.findIndex(p => p.date === overlayDate);
      
      // Update all points from lastHistDate to overlayDate with interpolated values
      // This ensures the line/area renders continuously
      if (lastHistIndex >= 0 && overlayIndex > lastHistIndex && lastHistValue != null) {
        const totalSteps = overlayIndex - lastHistIndex;
        
        data = data.map((point, idx) => {
          // Last historical point: start of the band (same as close price)
          if (idx === lastHistIndex) {
            return {
              ...point,
              forecastCenter: lastHistValue,
              forecastLower: lastHistValue,
              forecastUpper: lastHistValue,
              forecastModelName,
            };
          }
          
          // Overlay date: the forecast values
          if (idx === overlayIndex) {
            return {
              ...point,
              forecastCenter: overlayCenter,
              forecastLower: overlayLower,
              forecastUpper: overlayUpper,
              forecastModelName,
            };
          }
          
          // Intermediate points: linearly interpolate between start and end
          if (idx > lastHistIndex && idx < overlayIndex) {
            const t = (idx - lastHistIndex) / totalSteps; // 0 to 1
            return {
              ...point,
              forecastCenter: lastHistValue + t * (overlayCenter - lastHistValue),
              forecastLower: overlayLower != null ? lastHistValue + t * (overlayLower - lastHistValue) : null,
              forecastUpper: overlayUpper != null ? lastHistValue + t * (overlayUpper - lastHistValue) : null,
              forecastModelName,
            };
          }
          
          return point;
        });
      }
    }
    
    return data;
  }, [chartDataWithEwma, overlayDate, overlayCenter, overlayLower, overlayUpper, lastHistoricalPoint, forecastModelName]);

  // Compute Y-axis domain that includes EWMA values when overlay is active
  const priceYDomain = useMemo(() => {
    const values: number[] = [];
    
    chartDataWithForecastBand.forEach(p => {
      if (p.close != null) values.push(p.close);
      if (p.forecastCenter != null) values.push(p.forecastCenter);
      if (p.forecastLower != null) values.push(p.forecastLower);
      if (p.forecastUpper != null) values.push(p.forecastUpper);
      // Include EWMA values in domain calculation
      if (showEwmaOverlay) {
        if (p.ewma_forecast != null) values.push(p.ewma_forecast);
        if (p.ewma_lower != null) values.push(p.ewma_lower);
        if (p.ewma_upper != null) values.push(p.ewma_upper);
      }
    });
    
    if (values.length === 0) return ["dataMin", "dataMax"];
    
    const min = Math.min(...values);
    const max = Math.max(...values);
    // Add 2% padding
    const padding = (max - min) * 0.02;
    
    return [min - padding, max + padding];
  }, [chartDataWithForecastBand, showEwmaOverlay]);

  // Stable reference for ewma maximized state
  const ewmaIsMaximized = ewmaReactionMapDropdown?.isMaximized ?? false;

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
  }

  // Custom shape for open/close trade marker (pair glyph: ●──●)
  const PairTradeMarkerShape: React.FC<any> = (props) => {
    const { cx, cy, marker, isDarkMode: isDark } = props as {
      cx: number;
      cy: number;
      marker: TradeMarker;
      isDarkMode: boolean;
    };

    if (!marker) return null;

    const isLong = marker.side === 'long';

    // Line color is theme-based (white in dark mode, black in light mode)
    const lineColor = isDark
      ? 'rgba(255, 255, 255, 0.9)'
      : 'rgba(15, 23, 42, 0.9)';

    const longFill = 'rgba(34, 197, 94, 1)';
    const shortFill = 'rgba(248, 113, 113, 1)';
    const sideColor = isLong ? longFill : shortFill;

    const offset = 8; // wider glyph

    return (
      <g>
        {/* Horizontal connector */}
        <line
          x1={cx - offset}
          y1={cy}
          x2={cx + offset}
          y2={cy}
          stroke={lineColor}
          strokeWidth={2}
          strokeLinecap="round"
        />
        {/* Left dot: Open (solid) */}
        <circle
          cx={cx - offset}
          cy={cy}
          r={3.5}
          fill={sideColor}
        />
        {/* Right dot: Exit (ring) */}
        <circle
          cx={cx + offset}
          cy={cy}
          r={4}
          fill={isDark ? 'rgba(15, 23, 42, 1)' : 'rgba(248, 250, 252, 1)'}
          stroke={sideColor}
          strokeWidth={1.8}
        />
      </g>
    );
  };

  // Type for tooltip events (opens AND closes)
  type Trading212TooltipEventType = 'open' | 'close';

  interface Trading212TooltipEvent {
    type: Trading212TooltipEventType;
    runLabel: string;
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
      if (events.length === 1) {
        // Single action on this day for this run
        const e = events[0];
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
      } else if (events.length === 2) {
        // Two actions on same day (e.g. exit + new entry) → use a 'pair' glyph
        const [e1, e2] = events;
        const pairSide = e2.side;

        markers.push({
          date: e2.date,
          type: 'pair',
          side: pairSide,
          runId: e2.runId,
          label: e2.label,
          color: e2.color,
          netPnl: e1.netPnl ?? e2.netPnl,
          margin: e2.margin,
        });
      } else {
        // Fallback: more than 2 actions → render individually
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
      }
    });

    console.log('[PriceChart] tradeMarkers:', markers.length, 'markers');
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
          runLabel: overlay.label,
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

  // Handle chart click - opens trade detail card if there's a close event on hovered date
  const handleChartClick = useCallback(() => {
    if (!hoveredDate) return;
    
    const events = trading212EventsByDate?.get(hoveredDate) ?? [];
    const closeEvent = events.find(e => e.type === 'close');
    
    if (closeEvent && closeEvent.exitDate && closeEvent.exitPrice != null) {
      setSelectedTrade({
        side: closeEvent.side,
        entryDate: closeEvent.entryDate,
        entryPrice: closeEvent.entryPrice,
        exitDate: closeEvent.exitDate,
        exitPrice: closeEvent.exitPrice,
        netPnl: closeEvent.netPnl ?? 0,
        margin: closeEvent.margin ?? 0,
        runId: '',
        runLabel: closeEvent.runLabel,
        ticker: symbol,
      });
    }
  }, [hoveredDate, trading212EventsByDate, symbol]);

  // Determine line color from current range performance
  const latestRangePerf = perfByRange[selectedRange];
  const isPositive = latestRangePerf != null ? latestRangePerf >= 0 : undefined;
  const lineColor = isPositive === false ? "#F97373" : "#22D3EE"; // Glowing cyan-blue

  const chartBg = "w-full";
  const containerClasses = (className ?? "") + " w-full";

  // Memoized chart element to prevent re-renders when dropdown states change
  const memoizedChartElement = useMemo(() => {
    if (loading || error || chartDataWithEwma.length === 0) return null;
    
    // Debug logging for trade markers
    console.log('[PriceChart] Render - chartDataWithForecastBand:', chartDataWithForecastBand.length, 'points');
    console.log('[PriceChart] Render - tradeMarkers:', tradeMarkers.length, 'markers');
    
    return (
      <div className="relative">
        {/* Enhanced CSS Animations for forecast band */}
        <style>{`
          /* Smooth dot entrance with scale and glow */
          @keyframes dotPopIn {
            0% {
              opacity: 0;
              transform: scale(0);
            }
            50% {
              opacity: 1;
              transform: scale(1.3);
            }
            70% {
              transform: scale(0.9);
            }
            100% {
              opacity: 1;
              transform: scale(1);
            }
          }
          
          /* Subtle breathing glow for dots */
          @keyframes dotGlow {
            0%, 100% {
              filter: drop-shadow(0 0 2px rgba(59, 130, 246, 0.5));
            }
            50% {
              filter: drop-shadow(0 0 8px rgba(59, 130, 246, 0.8));
            }
          }
          
          /* Shimmer effect for area fill */
          @keyframes areaShimmer {
            0% {
              opacity: 0;
              clip-path: inset(0 100% 0 0);
            }
            100% {
              opacity: 1;
              clip-path: inset(0 0 0 0);
            }
          }
          
          /* Reference line fade in */
          @keyframes refLineFade {
            0% {
              opacity: 0;
              stroke-dashoffset: 100;
            }
            100% {
              opacity: 1;
              stroke-dashoffset: 0;
            }
          }
          
          .forecast-dot-animated {
            transform-origin: center;
            animation: dotPopIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
                       dotGlow 3s ease-in-out infinite 0.5s;
          }
          
          .forecast-dot-center {
            animation-delay: 0.2s, 0.7s;
          }
          
          .forecast-dot-upper {
            animation-delay: 0.35s, 0.85s;
          }
          
          .forecast-dot-lower {
            animation-delay: 0.5s, 1s;
          }
          
          .recharts-area-area {
            animation: areaShimmer 0.8s ease-out forwards;
          }
          
          .forecast-ref-line {
            stroke-dasharray: 100;
            animation: refLineFade 0.6s ease-out forwards;
          }
        `}</style>
        {/* Combined Price and Volume Chart - wrapped for click handling */}
        <div 
          onClick={handleChartClick}
          onMouseLeave={() => setHoveredDate(null)}
          style={{ cursor: hoveredDate && trading212EventsByDate?.get(hoveredDate)?.some(e => e.type === 'close') ? 'pointer' : 'default' }}
        >
        <ResponsiveContainer width="100%" height={500}>
          <ComposedChart
            data={chartDataWithForecastBand}
            margin={{ top: 20, right: 0, left: 0, bottom: 20 }}
            onMouseMove={(state: any) => {
              // Track hovered date for click handling
              if (state && state.activePayload && state.activePayload.length > 0) {
                const date = state.activePayload[0]?.payload?.date;
                if (date && date !== hoveredDate) {
                  setHoveredDate(date);
                }
              }
            }}
            onMouseLeave={() => setHoveredDate(null)}
          >
            <defs>
              <linearGradient
                id="priceFill"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor={lineColor}
                  stopOpacity={0.5}
                />
                <stop
                  offset="100%"
                  stopColor={lineColor}
                  stopOpacity={0}
                />
              </linearGradient>
              {/* Forecast band gradient fill - smooth horizontal gradient */}
              <linearGradient
                id="forecastBandFill"
                x1="0"
                y1="0"
                x2="1"
                y2="0"
              >
                <stop
                  offset="0%"
                  stopColor="#3B82F6"
                  stopOpacity={0.08}
                />
                <stop
                  offset="40%"
                  stopColor="#60A5FA"
                  stopOpacity={0.25}
                />
                <stop
                  offset="100%"
                  stopColor="#93C5FD"
                  stopOpacity={0.4}
                />
              </linearGradient>
              {/* Subtle glow filter for forecast lines */}
              <filter id="forecastGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2" result="blur"/>
                <feFlood floodColor="#3B82F6" floodOpacity="0.3" result="color"/>
                <feComposite in="color" in2="blur" operator="in" result="shadow"/>
                <feMerge>
                  <feMergeNode in="shadow"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
              {/* Gradient for forecast center line */}
              <linearGradient id="forecastCenterGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.8}/>
                <stop offset="100%" stopColor="#60A5FA" stopOpacity={1}/>
              </linearGradient>
              {/* Gradient for forecast bound lines */}
              <linearGradient id="forecastBoundGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.4}/>
                <stop offset="100%" stopColor="#93C5FD" stopOpacity={0.8}/>
              </linearGradient>
              {/* EWMA line glow filter */}
              <filter id="ewmaGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2" result="blur"/>
                <feFlood floodColor="#A855F7" floodOpacity="0.4" result="color"/>
                <feComposite in="color" in2="blur" operator="in" result="shadow"/>
                <feMerge>
                  <feMergeNode in="shadow"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
              {/* EWMA band gradient fill - soft purple */}
              <linearGradient
                id="ewmaBandFill"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor="#A855F7"
                  stopOpacity={0.25}
                />
                <stop
                  offset="50%"
                  stopColor="#A855F7"
                  stopOpacity={0.15}
                />
                <stop
                  offset="100%"
                  stopColor="#A855F7"
                  stopOpacity={0.25}
                />
              </linearGradient>
              {/* EWMA Biased band gradient fill - amber/orange for contrast */}
              <linearGradient
                id="ewmaBiasedBandFill"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor="#F59E0B"
                  stopOpacity={0.25}
                />
                <stop
                  offset="50%"
                  stopColor="#F59E0B"
                  stopOpacity={0.15}
                />
                <stop
                  offset="100%"
                  stopColor="#F59E0B"
                  stopOpacity={0.25}
                />
              </linearGradient>
              {/* Glow filter for biased EWMA line */}
              <filter id="ewmaBiasedGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="blur"/>
                <feFlood floodColor="#F59E0B" floodOpacity="0.4" result="color"/>
                <feComposite in="color" in2="blur" operator="in" result="shadow"/>
                <feMerge>
                  <feMergeNode in="shadow"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
              {/* Glowing blue filter for price line */}
              <filter id="priceLineGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.5" result="blur"/>
                <feFlood floodColor="#22D3EE" floodOpacity="0.5" result="color"/>
                <feComposite in="color" in2="blur" operator="in" result="shadow"/>
                <feMerge>
                  <feMergeNode in="shadow"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>

            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              minTickGap={24}
              tick={{
                fontSize: 10,
                fill: isDarkMode ? "rgba(148, 163, 184, 0.7)" : "rgba(75, 85, 99, 0.7)",
              }}
              tickFormatter={formatXAxisDate}
              domain={['dataMin', 'dataMax']}
            />
            
            {/* Price Y-Axis */}
            <YAxis
              yAxisId="price"
              orientation="right"
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              width={45}
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
                />
              )}
              animationDuration={0}
              cursor={{
                stroke: isDarkMode ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)",
                strokeWidth: 1,
              }}
            />
            
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
            
            {/* Forecast band overlay at t+h */}
            {overlayDate && overlayCenter != null && (
              <>
                {/* Vertical line at forecast date */}
                <ReferenceLine
                  x={overlayDate}
                  stroke={isDarkMode ? "rgba(59, 130, 246, 0.5)" : "rgba(59, 130, 246, 0.4)"}
                  strokeDasharray="6 4"
                  strokeWidth={1.5}
                  className="forecast-ref-line"
                />

                {/* Center forecast dot - larger and more prominent */}
                <ReferenceDot
                  x={overlayDate}
                  y={overlayCenter}
                  yAxisId="price"
                  r={6}
                  fill={isDarkMode ? "#3B82F6" : "#2563EB"}
                  stroke={isDarkMode ? "#1E293B" : "#FFFFFF"}
                  strokeWidth={2.5}
                  className="forecast-dot-animated forecast-dot-center"
                />

                {/* Lower / Upper band markers as glowing dots */}
                {overlayLower != null && (
                  <ReferenceDot
                    x={overlayDate}
                    y={overlayLower}
                    yAxisId="price"
                    r={5}
                    fill={isDarkMode ? "#22D3EE" : "#06B6D4"}
                    stroke={isDarkMode ? "#1E293B" : "#FFFFFF"}
                    strokeWidth={2}
                    className="forecast-dot-animated forecast-dot-lower"
                  />
                )}
                {overlayUpper != null && (
                  <ReferenceDot
                    x={overlayDate}
                    y={overlayUpper}
                    yAxisId="price"
                    r={5}
                    fill={isDarkMode ? "#22D3EE" : "#06B6D4"}
                    stroke={isDarkMode ? "#1E293B" : "#FFFFFF"}
                    strokeWidth={2}
                    className="forecast-dot-animated forecast-dot-upper"
                  />
                )}
              </>
            )}
            
            {/* Forecast Band - Upper boundary filled to bottom, then Lower boundary masks it */}
            {overlayLower != null && overlayUpper != null && (
              <>
                {/* Upper band - fills from upper to lower using stacking */}
                <Area
                  yAxisId="price"
                  type="linear"
                  dataKey="forecastUpper"
                  stroke="transparent"
                  fill="url(#forecastBandFill)"
                  fillOpacity={1}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
                {/* Lower band - masks out the area below lower */}
                <Area
                  yAxisId="price"
                  type="linear"
                  dataKey="forecastLower"
                  stroke="transparent"
                  fill={isDarkMode ? "#0F172A" : "#FFFFFF"}
                  fillOpacity={1}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
              </>
            )}
            
            {/* Forecast Lower Line - with glow effect */}
            {overlayLower != null && (
              <Line
                yAxisId="price"
                type="linear"
                dataKey="forecastLower"
                stroke="#60A5FA"
                strokeWidth={2}
                strokeOpacity={0.85}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls={false}
                filter="url(#forecastGlow)"
              />
            )}
            
            {/* Forecast Center Line - primary with stronger glow */}
            {overlayCenter != null && (
              <Line
                yAxisId="price"
                type="linear"
                dataKey="forecastCenter"
                stroke="#3B82F6"
                strokeWidth={2.5}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls={false}
                filter="url(#forecastGlow)"
              />
            )}
            
            {/* Forecast Upper Line - with glow effect */}
            {overlayUpper != null && (
              <Line
                yAxisId="price"
                type="linear"
                dataKey="forecastUpper"
                stroke="#60A5FA"
                strokeWidth={2}
                strokeOpacity={0.85}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                connectNulls={false}
                filter="url(#forecastGlow)"
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
              activeDot={<AnimatedPriceDot />}
              connectNulls={true}
              filter="url(#priceLineGlow)"
            />
            
            {/* Volume Bars - bottom 25% */}
            <Bar
              yAxisId="volume"
              dataKey="volume"
              fill="#666"
            >
              {chartDataWithForecastBand.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.volumeColor || "#666"} />
              ))}
            </Bar>
            
            {/* EWMA Band - Upper boundary area */}
            {showEwmaOverlay && (
              <Area
                yAxisId="price"
                type="monotone"
                dataKey="ewma_upper"
                stroke="rgba(168, 85, 247, 0.3)"
                strokeWidth={1}
                fill="url(#ewmaBandFill)"
                fillOpacity={1}
                dot={false}
                activeDot={false}
                connectNulls={true}
                isAnimationActive={false}
              />
            )}
            
            {/* EWMA Band - Lower boundary masks the upper area */}
            {showEwmaOverlay && (
              <Area
                yAxisId="price"
                type="monotone"
                dataKey="ewma_lower"
                stroke="rgba(168, 85, 247, 0.3)"
                strokeWidth={1}
                fill={isDarkMode ? "#0f172a" : "#ffffff"}
                fillOpacity={1}
                dot={false}
                activeDot={false}
                connectNulls={true}
                isAnimationActive={false}
              />
            )}
            
            {/* EWMA Forecast Path Overlay - Center Line */}
            {showEwmaOverlay && (
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="ewma_forecast"
                stroke="#A855F7"
                strokeWidth={2.5}
                dot={false}
                activeDot={<AnimatedEwmaDot />}
                connectNulls={true}
                isAnimationActive={false}
                filter="url(#ewmaGlow)"
              />
            )}
            
            {/* EWMA Biased Band - Upper boundary area */}
            {showEwmaBiasedOverlay && (
              <Area
                yAxisId="price"
                type="monotone"
                dataKey="ewma_biased_upper"
                stroke={ewmaIsMaximized ? "rgba(249, 115, 22, 0.4)" : "rgba(245, 158, 11, 0.3)"}
                strokeWidth={1}
                fill="url(#ewmaBiasedBandFill)"
                fillOpacity={1}
                dot={false}
                activeDot={false}
                connectNulls={true}
                isAnimationActive={false}
              />
            )}
            
            {/* EWMA Biased Band - Lower boundary masks the upper area */}
            {showEwmaBiasedOverlay && (
              <Area
                yAxisId="price"
                type="monotone"
                dataKey="ewma_biased_lower"
                stroke={ewmaIsMaximized ? "rgba(249, 115, 22, 0.4)" : "rgba(245, 158, 11, 0.3)"}
                strokeWidth={1}
                fill={isDarkMode ? "#0f172a" : "#ffffff"}
                fillOpacity={1}
                dot={false}
                activeDot={false}
                connectNulls={true}
                isAnimationActive={false}
              />
            )}
            
            {/* EWMA Biased Forecast Path Overlay - Center Line */}
            {showEwmaBiasedOverlay && (
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="ewma_biased_forecast"
                stroke={ewmaIsMaximized ? "#F97316" : "#F59E0B"}
                strokeWidth={2.5}
                dot={false}
                activeDot={createAnimatedEwmaBiasedDot({ isMaximized: ewmaIsMaximized })}
                connectNulls={true}
                isAnimationActive={false}
                filter="url(#ewmaBiasedGlow)"
              />
            )}
            
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
                      />
                    )}
                  />
                );
              }

              // Standard entry/exit dots
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
                />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
        </div>
      </div>
    );
  }, [
    chartDataWithForecastBand,
    lineColor,
    isDarkMode,
    priceYDomain,
    h,
    lastHistoricalPoint,
    futureDates,
    overlayDate,
    overlayCenter,
    overlayLower,
    overlayUpper,
    showEwmaOverlay,
    showEwmaBiasedOverlay,
    ewmaIsMaximized,
    tradeMarkers,
    getMarkerY,
    trading212EventsByDate,
    dateToClose,
    handleChartClick,
    hoveredDate,
  ]);

  return (
    <div className={containerClasses}>
      {/* Controls Row: Horizon/Coverage on left, Zoom/EWMA on right */}
      <div className="flex justify-between items-center mb-2">
        {/* Left side: Horizon and Coverage */}
        {horizonCoverage && (
          <div className="flex items-start gap-4">
            {/* Horizon */}
            <div className="flex flex-col gap-0.5">
              <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Horizon</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 5].map((days) => (
                  <button
                    key={days}
                    onClick={() => horizonCoverage.onHorizonChange(days)}
                    disabled={horizonCoverage.isLoading}
                    className={`px-2.5 py-0.5 text-xs rounded-full transition-colors ${
                      horizonCoverage.h === days 
                        ? 'bg-blue-600 text-white' 
                        : horizonCoverage.isLoading
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
            
            {/* Vertical Divider */}
            <div className={`w-px self-stretch ${isDarkMode ? 'bg-gray-600' : 'bg-gray-300'}`} />
            
            {/* Coverage */}
            <div className="flex flex-col gap-0.5">
              <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Coverage</span>
              <div className="flex items-center gap-1">
                {[0.90, 0.95, 0.99].map((cov) => (
                  <button
                    key={cov}
                    onClick={() => horizonCoverage.onCoverageChange(cov)}
                    disabled={horizonCoverage.isLoading}
                    className={`px-2.5 py-0.5 text-xs rounded-full transition-colors ${
                      horizonCoverage.coverage === cov 
                        ? 'bg-blue-600 text-white' 
                        : horizonCoverage.isLoading
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
            
            {/* Vertical Divider - before Model */}
            {horizonCoverage.volModel && horizonCoverage.onModelChange && (
              <div className={`w-px self-stretch ${isDarkMode ? 'bg-gray-600' : 'bg-gray-300'}`} />
            )}
            
            {/* Volatility Model */}
            {horizonCoverage.volModel && horizonCoverage.onModelChange && (
              <div className="flex flex-col gap-0.5">
                <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Volatility Model</span>
                <div className="flex items-center gap-1">
                  {/* GBM Button */}
                  {(() => {
                    const isSelected = horizonCoverage.volModel === 'GBM';
                    const isBest = horizonCoverage.recommendedModel?.volModel === 'GBM';
                    return (
                      <button
                        onClick={() => horizonCoverage.onModelChange!('GBM')}
                        disabled={horizonCoverage.isLoading}
                        className={`px-2.5 py-0.5 text-xs rounded-full transition-colors ${
                          isSelected 
                            ? isBest
                              ? 'bg-emerald-600 text-white'
                              : 'bg-blue-600 text-white' 
                            : horizonCoverage.isLoading
                              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                              : isBest
                                ? isDarkMode 
                                  ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-600 hover:bg-emerald-800/50'
                                  : 'bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100'
                                : isDarkMode 
                                  ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        GBM
                      </button>
                    );
                  })()}
                  
                  {/* GARCH Button with Dropdown */}
                  {(() => {
                    const isSelected = horizonCoverage.volModel === 'GARCH';
                    const isBest = horizonCoverage.recommendedModel?.volModel === 'GARCH';
                    return (
                      <div className="relative">
                        <button
                          onClick={() => {
                            if (horizonCoverage.volModel === 'GARCH') {
                              setShowGarchDropdown(!showGarchDropdown);
                              setShowRangeDropdown(false);
                            } else {
                              horizonCoverage.onModelChange!('GARCH');
                              setShowGarchDropdown(true);
                              setShowRangeDropdown(false);
                            }
                          }}
                          disabled={horizonCoverage.isLoading}
                          className={`px-2 py-0.5 text-xs rounded-full transition-colors flex items-center gap-1 ${
                            isSelected 
                              ? isBest
                                ? 'bg-emerald-600 text-white'
                                : 'bg-blue-600 text-white' 
                              : horizonCoverage.isLoading
                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                : isBest
                                  ? isDarkMode 
                                    ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-600 hover:bg-emerald-800/50'
                                    : 'bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100'
                                  : isDarkMode 
                                    ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          GARCH
                          {isSelected && (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          )}
                        </button>
                        
                        {/* GARCH Dropdown */}
                        {showGarchDropdown && isSelected && horizonCoverage.onGarchEstimatorChange && (
                          <div className={`absolute top-full left-0 mt-1 py-1 rounded-lg shadow-lg border z-50 min-w-[140px] ${
                            isDarkMode 
                              ? 'bg-gray-800 border-gray-600' 
                              : 'bg-white border-gray-200'
                          }`}>
                            <div className={`px-3 py-1 text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                              Distribution
                            </div>
                            {(['Normal', 'Student-t'] as GarchEstimator[]).map((est) => {
                              const isEstSelected = horizonCoverage.garchEstimator === est;
                              const isEstBest = isBest && horizonCoverage.recommendedModel?.garchEstimator === est;
                              return (
                                <button
                                  key={est}
                                  onClick={() => {
                                    horizonCoverage.onGarchEstimatorChange!(est);
                                    setShowGarchDropdown(false);
                                  }}
                                  className={`w-full px-3 py-2 text-sm text-left transition-colors flex items-center justify-between ${
                                    isEstSelected
                                      ? isEstBest
                                        ? 'bg-emerald-600 text-white'
                                        : isDarkMode 
                                          ? 'bg-blue-600 text-white'
                                          : 'bg-blue-500 text-white'
                                      : isEstBest
                                        ? isDarkMode
                                          ? 'text-emerald-400 hover:bg-gray-700'
                                          : 'text-emerald-600 hover:bg-gray-100'
                                        : isDarkMode 
                                          ? 'text-gray-300 hover:bg-gray-700'
                                          : 'text-gray-700 hover:bg-gray-100'
                                  }`}
                                >
                                  <span>{est}</span>
                                  {isEstBest && <span className="text-yellow-400">★</span>}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  
                  {/* HAR-RV Button */}
                  {(() => {
                    const isSelected = horizonCoverage.volModel === 'HAR-RV';
                    const isBest = horizonCoverage.recommendedModel?.volModel === 'HAR-RV';
                    return (
                      <button
                        onClick={() => {
                          horizonCoverage.onModelChange!('HAR-RV');
                          setShowGarchDropdown(false);
                          setShowRangeDropdown(false);
                        }}
                        disabled={horizonCoverage.isLoading}
                        className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
                          isSelected 
                            ? isBest
                              ? 'bg-emerald-600 text-white'
                              : 'bg-blue-600 text-white' 
                            : horizonCoverage.isLoading
                              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                              : isBest
                                ? isDarkMode 
                                  ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-600 hover:bg-emerald-800/50'
                                  : 'bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100'
                                : isDarkMode 
                                  ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        HAR-RV
                      </button>
                    );
                  })()}
                  
                  {/* Range Button with Dropdown */}
                  {(() => {
                    const isSelected = horizonCoverage.volModel === 'Range';
                    const isBest = horizonCoverage.recommendedModel?.volModel === 'Range';
                    return (
                      <div className="relative">
                        <button
                          onClick={() => {
                            if (horizonCoverage.volModel === 'Range') {
                              setShowRangeDropdown(!showRangeDropdown);
                              setShowGarchDropdown(false);
                            } else {
                              horizonCoverage.onModelChange!('Range');
                              setShowRangeDropdown(true);
                              setShowGarchDropdown(false);
                            }
                          }}
                          disabled={horizonCoverage.isLoading}
                          className={`px-2 py-0.5 text-xs rounded-full transition-colors flex items-center gap-1 ${
                            isSelected 
                              ? isBest
                                ? 'bg-emerald-600 text-white'
                                : 'bg-blue-600 text-white' 
                              : horizonCoverage.isLoading
                                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                : isBest
                                  ? isDarkMode 
                                    ? 'bg-emerald-900/50 text-emerald-400 border border-emerald-600 hover:bg-emerald-800/50'
                                    : 'bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100'
                                  : isDarkMode 
                                    ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          Range
                          {isSelected && (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          )}
                        </button>
                        
                        {/* Range Dropdown */}
                        {showRangeDropdown && isSelected && horizonCoverage.onRangeEstimatorChange && (
                          <div className={`absolute top-full left-0 mt-1 py-1 rounded-lg shadow-lg border z-50 min-w-[160px] ${
                            isDarkMode 
                              ? 'bg-gray-800 border-gray-600' 
                              : 'bg-white border-gray-200'
                          }`}>
                            <div className={`px-3 py-1 text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                              Estimator
                            </div>
                            {([
                              { value: 'P', label: 'Parkinson' },
                              { value: 'GK', label: 'Garman-Klass' },
                              { value: 'RS', label: 'Rogers-Satchell' },
                              { value: 'YZ', label: 'Yang-Zhang' },
                            ] as { value: RangeEstimator; label: string }[]).map(({ value, label }) => {
                              const isEstSelected = horizonCoverage.rangeEstimator === value;
                              const isEstBest = isBest && horizonCoverage.recommendedModel?.rangeEstimator === value;
                              return (
                                <button
                                  key={value}
                                  onClick={() => {
                                    horizonCoverage.onRangeEstimatorChange!(value);
                                    setShowRangeDropdown(false);
                                  }}
                                  className={`w-full px-3 py-2 text-sm text-left transition-colors flex items-center justify-between ${
                                    isEstSelected
                                      ? isEstBest
                                        ? 'bg-emerald-600 text-white'
                                        : isDarkMode 
                                          ? 'bg-blue-600 text-white'
                                          : 'bg-blue-500 text-white'
                                      : isEstBest
                                        ? isDarkMode
                                          ? 'text-emerald-400 hover:bg-gray-700'
                                          : 'text-emerald-600 hover:bg-gray-100'
                                        : isDarkMode 
                                          ? 'text-gray-300 hover:bg-gray-700'
                                          : 'text-gray-700 hover:bg-gray-100'
                                  }`}
                                >
                                  <span>{label}</span>
                                  {isEstBest && <span className="text-yellow-400">★</span>}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  
                  {/* Model Settings Button (⋯) */}
                  <div className="relative" ref={modelSettingsDropdownRef}>
                    <button
                      onClick={() => setShowModelSettingsDropdown(!showModelSettingsDropdown)}
                      className={`
                        w-6 h-6 flex items-center justify-center text-sm rounded-full transition-colors border
                        ${showModelSettingsDropdown
                          ? (isDarkMode ? 'border-gray-400 text-white' : 'border-gray-500 text-gray-900')
                          : (isDarkMode ? 'border-gray-500 text-gray-300 hover:border-gray-400' : 'border-gray-300 text-gray-700 hover:border-gray-400')
                        }
                      `}
                      title="Model Settings"
                    >
                      ⋯
                    </button>

                    {/* Model Settings Dropdown */}
                    {showModelSettingsDropdown && (
                      <div 
                        className={`
                          absolute top-10 right-0 z-50 min-w-[160px] px-3 py-2 rounded-xl shadow-xl backdrop-blur-sm border
                          ${isDarkMode 
                            ? 'bg-gray-900/80 border-gray-500/30' 
                            : 'bg-white/80 border-gray-400/30'
                          }
                        `}
                      >
                        <div className="space-y-2 text-xs">
                          {/* Window - always shown */}
                          {horizonCoverage.onWindowSizeChange && (
                            <div className="flex items-center justify-between gap-4">
                              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Window</span>
                              <input
                                type="number"
                                min={50}
                                max={5000}
                                step={50}
                                value={horizonCoverage.windowSize ?? 1000}
                                onChange={(e) => horizonCoverage.onWindowSizeChange!(parseInt(e.target.value) || 1000)}
                                disabled={horizonCoverage.isLoading}
                                className={`w-20 bg-transparent border-b text-right font-mono tabular-nums outline-none ${
                                  isDarkMode 
                                    ? 'border-gray-600 text-white focus:border-blue-500' 
                                    : 'border-gray-300 text-gray-900 focus:border-blue-500'
                                }`}
                              />
                            </div>
                          )}

                          {/* GBM Lambda - only for GBM */}
                          {horizonCoverage.volModel === 'GBM' && horizonCoverage.onGbmLambdaChange && (
                            <div className="flex items-center justify-between gap-4">
                              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>λ Drift</span>
                              <input
                                type="number"
                                min={0}
                                max={1}
                                step={0.01}
                                value={horizonCoverage.gbmLambda ?? 0}
                                onChange={(e) => horizonCoverage.onGbmLambdaChange!(parseFloat(e.target.value) || 0)}
                                disabled={horizonCoverage.isLoading}
                                className={`w-20 bg-transparent border-b text-right font-mono tabular-nums outline-none ${
                                  isDarkMode 
                                    ? 'border-gray-600 text-white focus:border-blue-500' 
                                    : 'border-gray-300 text-gray-900 focus:border-blue-500'
                                }`}
                              />
                            </div>
                          )}

                          {/* DoF - only for GARCH Student-t */}
                          {horizonCoverage.volModel === 'GARCH' && horizonCoverage.garchEstimator === 'Student-t' && horizonCoverage.onDegreesOfFreedomChange && (
                            <div className="flex items-center justify-between gap-4">
                              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>DoF</span>
                              <input
                                type="number"
                                min={3}
                                max={30}
                                step={0.5}
                                value={horizonCoverage.degreesOfFreedom ?? 5}
                                onChange={(e) => horizonCoverage.onDegreesOfFreedomChange!(parseFloat(e.target.value) || 5)}
                                disabled={horizonCoverage.isLoading}
                                className={`w-20 bg-transparent border-b text-right font-mono tabular-nums outline-none ${
                                  isDarkMode 
                                    ? 'border-gray-600 text-white focus:border-blue-500' 
                                    : 'border-gray-300 text-gray-900 focus:border-blue-500'
                                }`}
                              />
                            </div>
                          )}

                          {/* EWMA Lambda - only for Range */}
                          {horizonCoverage.volModel === 'Range' && horizonCoverage.onEwmaLambdaChange && (
                            <div className="flex items-center justify-between gap-4">
                              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>EWMA λ</span>
                              <input
                                type="number"
                                min={0.5}
                                max={0.99}
                                step={0.01}
                                value={horizonCoverage.ewmaLambda ?? 0.94}
                                onChange={(e) => horizonCoverage.onEwmaLambdaChange!(parseFloat(e.target.value) || 0.94)}
                                disabled={horizonCoverage.isLoading}
                                className={`w-20 bg-transparent border-b text-right font-mono tabular-nums outline-none ${
                                  isDarkMode 
                                    ? 'border-gray-600 text-white focus:border-blue-500' 
                                    : 'border-gray-300 text-gray-900 focus:border-blue-500'
                                }`}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
            
            {/* Vertical Divider - before EWMA */}
            <div className={`w-px self-stretch ${isDarkMode ? 'bg-gray-600' : 'bg-gray-300'}`} />
            
            {/* EWMA Section */}
            <div className="flex flex-col gap-0.5">
              <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>EWMA</span>
              <div className="flex items-center gap-1">
                {/* EWMA Button */}
                <div className="relative group">
                  <button
                    onClick={() => {
                      // Ensure unbiased EWMA is loaded if needed
                      if (onLoadEwmaUnbiased) {
                        onLoadEwmaUnbiased();
                      }
                      setShowEwmaOverlay(!showEwmaOverlay);
                    }}
                    disabled={!ewmaPath || ewmaPath.length === 0}
                    className={`
                      px-2 py-0.5 text-xs rounded-full transition-colors
                      ${showEwmaOverlay && ewmaPath && ewmaPath.length > 0
                        ? isDarkMode
                          ? 'bg-purple-600 text-white'
                          : 'bg-purple-500 text-white'
                        : (!ewmaPath || ewmaPath.length === 0)
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : isDarkMode 
                            ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }
                    `}
                  >
                    Unbiased
                  </button>
                  
                  {/* EWMA Stats Hover Card */}
                  {showEwmaOverlay && ewmaSummary && (
                    <div 
                      className={`absolute top-full mt-2 left-0 z-50 min-w-[280px] rounded-xl border shadow-xl p-3 backdrop-blur-sm opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 ${
                        isDarkMode 
                          ? 'bg-transparent border-gray-500/30' 
                          : 'bg-transparent border-gray-400/30'
                      }`}
                    >
                      <div className="mb-2">
                        <h4 className={`text-xs font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                          EWMA Walker ({horizon ?? 1}D)
                        </h4>
                        <p className={`text-[10px] ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                          Baseline volatility-only forecast (λ = 0.94)
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                        <div className="flex flex-col">
                          <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Coverage</span>
                          <span className={`font-mono tabular-nums font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            {(ewmaSummary.coverage * 100).toFixed(1)}%{' '}
                            <span className={`text-[9px] font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                              (target {(ewmaSummary.targetCoverage * 100).toFixed(1)}%)
                            </span>
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Interval score</span>
                          <span className={`font-mono tabular-nums font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            {ewmaSummary.intervalScore.toFixed(3)}
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Avg width</span>
                          <span className={`font-mono tabular-nums font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            {(ewmaSummary.avgWidth * 100).toFixed(2)}%
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>z-mean / z-std</span>
                          <span className={`font-mono tabular-nums font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            {ewmaSummary.zMean.toFixed(3)} / {ewmaSummary.zStd.toFixed(3)}
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Direction hit-rate</span>
                          <span className={`font-mono tabular-nums font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            {(ewmaSummary.directionHitRate * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Points</span>
                          <span className={`font-mono tabular-nums font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            {ewmaSummary.nPoints.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* EWMA Biased Button */}
                {onLoadEwmaBiased && (
                  <div className="relative group">
                    <button
                      onClick={() => {
                        // Ensure biased EWMA path is loaded if needed
                        if (onLoadEwmaBiased) {
                          onLoadEwmaBiased();
                        }

                        if (ewmaBiasedPath && ewmaBiasedPath.length > 0) {
                          setShowEwmaBiasedOverlay(!showEwmaBiasedOverlay);
                        } else {
                          setShowEwmaBiasedOverlay(true);
                        }
                      }}
                      disabled={isLoadingEwmaBiased}
                      className={`
                        px-2 py-0.5 text-xs rounded-full transition-colors
                        ${showEwmaBiasedOverlay && ewmaBiasedPath && ewmaBiasedPath.length > 0
                          ? isDarkMode
                            ? 'bg-amber-600 text-white'
                            : 'bg-amber-500 text-white'
                          : isLoadingEwmaBiased
                            ? 'bg-gray-300 text-gray-500 cursor-wait'
                            : isDarkMode 
                              ? 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }
                      `}
                    >
                      {isLoadingEwmaBiased ? 'Loading...' : 'Biased'}
                    </button>
                    
                    {/* EWMA Biased Stats Hover Card */}
                    {showEwmaBiasedOverlay && ewmaBiasedSummary && (
                      <div 
                        className={`absolute top-full mt-2 left-0 z-50 min-w-[280px] rounded-xl border shadow-xl p-3 backdrop-blur-sm opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 ${
                          isDarkMode 
                            ? 'bg-transparent border-gray-500/30' 
                            : 'bg-transparent border-gray-400/30'
                        }`}
                      >
                        <div className="mb-2">
                          <h4 className={`text-xs font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                            EWMA Biased ({horizon ?? 1}D)
                          </h4>
                          <p className={`text-[10px] ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                            Reaction Map tilted forecast (λ = 0.94)
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                          <div className="flex flex-col">
                            <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Coverage</span>
                            <span className={`font-mono tabular-nums font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                              {(ewmaBiasedSummary.coverage * 100).toFixed(1)}%{' '}
                              <span className={`text-[9px] font-normal ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                (target {(ewmaBiasedSummary.targetCoverage * 100).toFixed(1)}%)
                              </span>
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Interval score</span>
                            <span className={`font-mono tabular-nums font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                              {ewmaBiasedSummary.intervalScore.toFixed(3)}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Avg width</span>
                            <span className={`font-mono tabular-nums font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                              {(ewmaBiasedSummary.avgWidth * 100).toFixed(2)}%
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>z-mean / z-std</span>
                            <span className={`font-mono tabular-nums font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                              {ewmaBiasedSummary.zMean.toFixed(3)} / {ewmaBiasedSummary.zStd.toFixed(3)}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Direction hit-rate</span>
                            <span className={`font-mono tabular-nums font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                              {(ewmaBiasedSummary.directionHitRate * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className={isDarkMode ? 'text-gray-300' : 'text-gray-600'}>Points</span>
                            <span className={`font-mono tabular-nums font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                              {ewmaBiasedSummary.nPoints.toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* EWMA Settings Button (⋯) with Dropdown */}
                {ewmaReactionMapDropdown && (
                  <div className="relative" ref={ewmaSettingsDropdownRef}>
                    <button
                      onClick={() => setShowEwmaSettingsDropdown(!showEwmaSettingsDropdown)}
                      className={`
                        w-6 h-6 flex items-center justify-center text-sm rounded-full transition-colors border
                        ${showEwmaSettingsDropdown
                          ? (isDarkMode ? 'border-gray-400 text-white' : 'border-gray-500 text-gray-900')
                          : (isDarkMode ? 'border-gray-500 text-gray-300 hover:border-gray-400' : 'border-gray-300 text-gray-700 hover:border-gray-400')
                        }
                      `}
                      title="EWMA Reaction Map Settings"
                    >
                      ⋯
                    </button>

                    {/* Tooltip-style Dropdown Menu */}
                    {showEwmaSettingsDropdown && (
                      <div 
                        className={`
                          absolute top-10 right-0 z-50 min-w-[140px] px-3 py-2 rounded-xl shadow-xl backdrop-blur-sm border
                          ${isDarkMode 
                            ? 'bg-gray-900/80 border-gray-500/30' 
                            : 'bg-white/80 border-gray-400/30'
                          }
                        `}
                      >
                        <div className="space-y-2 text-xs">
                          {/* Lambda Row */}
                          <div className="flex items-center justify-between gap-4">
                            <span className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>λ</span>
                            <input
                              type="number"
                              min={0.01}
                              max={0.999}
                              step={0.01}
                              value={ewmaReactionMapDropdown.reactionLambda}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                if (Number.isFinite(val)) {
                                  ewmaReactionMapDropdown.setReactionLambda(Math.min(0.999, Math.max(0.01, val)));
                                }
                              }}
                              className={`w-16 bg-transparent border-b text-right font-mono tabular-nums outline-none ${
                                isDarkMode 
                                  ? 'border-gray-600 text-white focus:border-amber-500' 
                                  : 'border-gray-300 text-gray-900 focus:border-amber-500'
                              }`}
                            />
                          </div>

                          {/* Train % Row */}
                          <div className="flex items-center justify-between gap-4">
                            <span className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Train%</span>
                            <input
                              type="number"
                              min={10}
                              max={90}
                              step={5}
                              value={Math.round(ewmaReactionMapDropdown.reactionTrainFraction * 100)}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                if (Number.isFinite(val)) {
                                  const frac = Math.min(0.9, Math.max(0.1, val / 100));
                                  ewmaReactionMapDropdown.setReactionTrainFraction(frac);
                                }
                              }}
                              className={`w-16 bg-transparent border-b text-right font-mono tabular-nums outline-none ${
                                isDarkMode 
                                  ? 'border-gray-600 text-white focus:border-amber-500' 
                                  : 'border-gray-300 text-gray-900 focus:border-amber-500'
                              }`}
                            />
                          </div>

                          {/* Buttons Row */}
                          <div className="flex gap-1.5 mt-1">
                            {/* Reset Button */}
                            <button
                              type="button"
                              onClick={() => {
                                ewmaReactionMapDropdown.onReset();
                              }}
                              disabled={ewmaReactionMapDropdown.isOptimizingReaction || ewmaReactionMapDropdown.isLoadingReaction}
                              className={`flex-1 rounded-full px-2 py-1 text-[10px] font-medium transition-colors ${
                                ewmaReactionMapDropdown.isOptimizingReaction || ewmaReactionMapDropdown.isLoadingReaction
                                  ? 'bg-gray-500/30 text-gray-500 cursor-not-allowed'
                                  : isDarkMode
                                    ? 'bg-gray-600/50 hover:bg-gray-600 text-gray-300'
                                    : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                              }`}
                            >
                              Reset
                            </button>

                            {/* Maximize Button - applies best optimization config */}
                            <button
                              type="button"
                              onClick={() => {
                                ewmaReactionMapDropdown.onMaximize();
                              }}
                              disabled={ewmaReactionMapDropdown.isOptimizingReaction || ewmaReactionMapDropdown.isLoadingReaction || !ewmaReactionMapDropdown.hasOptimizationResults}
                              className={`flex-1 rounded-full px-2 py-1 text-[10px] font-medium transition-colors ${
                                ewmaReactionMapDropdown.isOptimizingReaction
                                  ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                                  : ewmaReactionMapDropdown.isMaximized
                                    ? 'bg-amber-600 text-white cursor-default'
                                    : ewmaReactionMapDropdown.hasOptimizationResults
                                      ? 'bg-amber-500/90 hover:bg-amber-500 text-white'
                                      : 'bg-gray-500/50 text-gray-400 cursor-wait'
                              }`}
                            >
                              {ewmaReactionMapDropdown.isOptimizingReaction 
                                ? 'Optimizing...' 
                                : ewmaReactionMapDropdown.isMaximized
                                  ? 'Maximized ✓'
                                  : ewmaReactionMapDropdown.hasOptimizationResults
                                    ? 'Maximize'
                                    : 'Loading...'}
                            </button>
                          </div>

                          {/* Loading indicator */}
                          {ewmaReactionMapDropdown.isLoadingReaction && (
                            <div className={`text-[10px] text-center ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                              Updating...
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* Spacer if no horizonCoverage */}
        {!horizonCoverage && <div />}
      </div>
      
      {/* Zoom Controls Row */}
      <div className="flex items-center gap-4 mb-2 mt-6">
        <div className="flex items-center gap-2">
          <label className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Zoom
          </label>
          <button
            onClick={zoomIn}
            disabled={loading || fullData.length === 0}
            className={`
              w-6 h-6 rounded-full text-xs font-medium transition-all flex items-center justify-center
              ${isDarkMode 
                ? 'bg-gray-700 hover:bg-gray-600 text-white border border-gray-600 disabled:bg-gray-800 disabled:text-gray-500'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300 disabled:bg-gray-50 disabled:text-gray-400'
              }
              disabled:cursor-not-allowed
            `}
            title="Zoom in"
          >
            +
          </button>
          <button
            onClick={zoomOut}
            disabled={loading || fullData.length === 0}
            className={`
              w-6 h-6 rounded-full text-xs font-medium transition-all flex items-center justify-center
              ${isDarkMode 
                ? 'bg-gray-700 hover:bg-gray-600 text-white border border-gray-600 disabled:bg-gray-800 disabled:text-gray-500'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-300 disabled:bg-gray-50 disabled:text-gray-400'
              }
              disabled:cursor-not-allowed
            `}
            title="Zoom out"
          >
            −
          </button>
        </div>
      </div>
      
      {/* Chart Area */}
      <div className={chartBg}>
        {loading ? (
          <div className="flex h-[400px] items-center justify-center">
            <div className="flex flex-col items-center space-y-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></div>
              <div className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-600'}`}>Loading chart...</div>
            </div>
          </div>
        ) : error ? (
          <div className={`flex h-[400px] items-center justify-center text-xs ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
            {error}
          </div>
        ) : chartDataWithEwma.length === 0 ? (
          <div className={`flex h-[400px] items-center justify-center text-xs ${isDarkMode ? 'text-muted-foreground' : 'text-gray-500'}`}>
            No historical data available.
          </div>
        ) : (
          memoizedChartElement
        )}
      </div>
      
      {/* Range Selector - positioned below chart like TradingView */}
      <RangeSelector
        selectedRange={selectedRange}
        perfByRange={perfByRange}
        onChange={handleRangeChange}
        isDarkMode={isDarkMode}
      />

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

type PerfMap = Record<PriceRange, number | null>;

interface RangeSelectorProps {
  selectedRange: PriceRange;
  perfByRange: PerfMap;
  onChange: (range: PriceRange) => void;
  isDarkMode: boolean;
}

const RangeSelector: React.FC<RangeSelectorProps> = ({
  selectedRange,
  perfByRange,
  onChange,
  isDarkMode,
}) => {
  return (
    <div className="w-full mt-4">
      <div className="flex justify-between w-full">
        {RANGE_OPTIONS.map((range) => {
          const perf = perfByRange[range];
          const isSelected = range === selectedRange;
          const isPositive = perf != null && perf >= 0;

          return (
            <button
              key={range}
              type="button"
              onClick={() => onChange(range)}
              className={`
                flex-1 px-2 py-2 text-sm font-medium transition-all mx-0.5
                ${isSelected 
                  ? isDarkMode 
                    ? 'bg-white/10 text-white border border-white/20 rounded-full' 
                    : 'bg-gray-200 text-gray-900 border border-gray-300 rounded-full'
                  : isDarkMode
                    ? 'bg-transparent text-gray-400 hover:bg-white/5 hover:text-gray-300 border border-transparent rounded-lg hover:rounded-full'
                    : 'bg-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-800 border border-transparent rounded-lg hover:rounded-full'
                }
              `}
            >
              <div className="text-center">
                <div className="text-xs font-medium">{range}</div>
                {perf != null && (
                  <div className={`text-xs font-semibold ${
                    isPositive ? 'text-green-500' : 'text-red-500'
                  }`}>
                    {isPositive ? '+' : ''}{perf.toFixed(2)}%
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
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
    side: 'long' | 'short';
    entryDate: string;
    entryPrice: number;
    exitDate?: string;
    exitPrice?: number;
    netPnl?: number;
    margin?: number;
  }[]>;
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
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
};

const PriceTooltip: React.FC<PriceTooltipProps> = ({
  active,
  label,
  payload,
  isDarkMode = true,
  horizon = 1,
  trading212EventsByDate,
}) => {
  if (!active || !payload || !payload.length || !label) return null;
  
  // Normalize label to string for date lookups
  const labelStr = typeof label === 'string' ? label : String(label);
  
  // Find the main chart data (first payload that has 'date' field - not scatter data)
  const chartPayload = payload.find(p => p.payload && 'date' in p.payload);
  const data = chartPayload?.payload ?? payload[0].payload;
  const h = horizon;
  // Use close price directly from data, not from payload value (which could be EWMA)
  const price = data.close;
  
  // Check if this is a future/forecast-only point (no historical price, only forecast data)
  const isFuturePoint = data.isFuture === true;
  const hasForecastData = isFuturePoint && (data.forecastCenter != null || data.forecastLower != null || data.forecastUpper != null);
  const hasEwmaData = data.ewma_forecast != null;
  const hasEwmaBiasedData = data.ewma_biased_forecast != null;
  
  // Get model name for forecast display
  const modelName = data.forecastModelName || 'Model';
  
  // Get Trading212 events for this date from the map (opens AND closes)
  const t212Events = trading212EventsByDate?.get(labelStr) ?? [];
  
  // Debug logging for T212 events
  if (t212Events.length > 0) {
    console.log('[Tooltip T212]', labelStr, t212Events);
  }
  
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
      <div className={`px-3 py-1.5 border-b ${
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
          <div className="px-4 py-3">
            {/* Section Header */}
            <div className="flex items-center gap-1.5 mb-2">
              <div className={`w-1 h-1 rounded-full ${isDarkMode ? 'bg-blue-400' : 'bg-blue-500'}`} />
              <span className={`text-[9px] font-semibold uppercase tracking-wider ${
                isDarkMode ? 'text-blue-400' : 'text-blue-600'
              }`}>
                {modelName}
              </span>
            </div>
            
            <div className="space-y-0.5 text-[10px]">
              {/* Model Forecast (center) */}
              {data.forecastCenter != null && (
                <div className="flex justify-between gap-3">
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>Forecast</span>
                  <span className={`font-mono tabular-nums font-medium ${isDarkMode ? 'text-blue-300' : 'text-blue-700'}`}>
                    ${data.forecastCenter.toFixed(2)}
                  </span>
                </div>
              )}
              {data.forecastUpper != null && (
                <div className="flex justify-between gap-3">
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>Upper</span>
                  <span className={`font-mono tabular-nums ${isDarkMode ? 'text-blue-300/70' : 'text-blue-600'}`}>
                    ${data.forecastUpper.toFixed(2)}
                  </span>
                </div>
              )}
              {data.forecastLower != null && (
                <div className="flex justify-between gap-3">
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>Lower</span>
                  <span className={`font-mono tabular-nums ${isDarkMode ? 'text-blue-300/70' : 'text-blue-600'}`}>
                    ${data.forecastLower.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* OHLCV Data - only show for historical points */}
        {!isFuturePoint && (data.open || data.high || data.low || data.close || data.volume) && (
          <div className="px-4 py-3">
            <div className={`text-[9px] font-semibold uppercase tracking-wider mb-2 ${
              isDarkMode ? 'text-slate-400' : 'text-gray-500'
            }`}>
              OHLCV
            </div>
            <div className="space-y-0.5 text-[10px]">
              {data.open && (
                <div className="flex justify-between gap-3">
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>Open</span>
                  <span className={`font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>${data.open.toFixed(2)}</span>
                </div>
              )}
              {data.high && (
                <div className="flex justify-between gap-3">
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>High</span>
                  <span className={`font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>${data.high.toFixed(2)}</span>
                </div>
              )}
              {data.low && (
                <div className="flex justify-between gap-3">
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>Low</span>
                  <span className={`font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>${data.low.toFixed(2)}</span>
                </div>
              )}
              {data.close && (
                <div className="flex justify-between gap-3">
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>Close</span>
                  <span className={`font-mono tabular-nums font-medium ${
                    data.open && data.close > data.open
                      ? 'text-emerald-400'
                      : data.open && data.close < data.open
                        ? 'text-rose-400'
                        : isDarkMode ? 'text-slate-400' : 'text-gray-500'
                  }`}>${data.close.toFixed(2)}</span>
                </div>
              )}
              {data.volume && (
                <div className="flex justify-between gap-3">
                  <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>Vol</span>
                  <span className={`font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>{formatVolumeAbbreviated(data.volume)}</span>
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* EWMA Unbiased Section */}
        {(data.ewma_past_forecast != null || data.ewma_future_forecast != null) && (
          <div className="px-4 py-3">
            {/* Section Header */}
            <div className="flex items-center gap-1.5 mb-2">
              <div className={`w-1 h-1 rounded-full ${isDarkMode ? 'bg-purple-400' : 'bg-purple-500'}`} />
              <span className={`text-[9px] font-semibold uppercase tracking-wider ${
                isDarkMode ? 'text-purple-400' : 'text-purple-600'
              }`}>
                EWMA Unbiased
              </span>
            </div>
            
            {/* Two-column table */}
            <table className="w-full text-[9px]">
              <tbody className={isDarkMode ? 'text-slate-300' : 'text-gray-700'}>
                {/* Made on (origin date) */}
                <tr>
                  <td className={`pr-2 ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>Made on</td>
                  <td className={`text-right px-1 font-mono ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.ewma_past_origin_date ? formatDateShort(data.ewma_past_origin_date) : '—'}
                  </td>
                  <td className={`text-right pl-1 font-mono ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.ewma_future_origin_date ? formatDateShort(data.ewma_future_origin_date) : '—'}
                  </td>
                </tr>
                {/* Target (target date) */}
                <tr>
                  <td className={`pr-2 ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>Target</td>
                  <td className={`text-right px-1 font-mono ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.ewma_past_target_date ? formatDateShort(data.ewma_past_target_date) : '—'}
                  </td>
                  <td className={`text-right pl-1 font-mono ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.ewma_future_target_date ? formatDateShort(data.ewma_future_target_date) : '—'}
                  </td>
                </tr>
                {/* Forecast Price */}
                <tr>
                  <td className={`pr-2 ${isDarkMode ? 'text-slate-200' : 'text-gray-700'}`}>Forecast</td>
                  <td className={`text-right px-1 font-mono tabular-nums font-bold ${isDarkMode ? 'text-purple-300' : 'text-purple-700'}`}>
                    {data.ewma_past_forecast != null ? `$${data.ewma_past_forecast.toFixed(2)}` : '—'}
                  </td>
                  <td className={`text-right pl-1 font-mono tabular-nums font-bold ${isDarkMode ? 'text-purple-300' : 'text-purple-700'}`}>
                    {data.ewma_future_forecast != null ? `$${data.ewma_future_forecast.toFixed(2)}` : '—'}
                  </td>
                </tr>
                {/* Upper Band */}
                <tr>
                  <td className={`pr-2 ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>Upper</td>
                  <td className={`text-right px-1 font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.ewma_past_upper != null ? `$${data.ewma_past_upper.toFixed(2)}` : '—'}
                  </td>
                  <td className={`text-right pl-1 font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.ewma_future_upper != null ? `$${data.ewma_future_upper.toFixed(2)}` : '—'}
                  </td>
                </tr>
                {/* Lower Band */}
                <tr>
                  <td className={`pr-2 ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>Lower</td>
                  <td className={`text-right px-1 font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.ewma_past_lower != null ? `$${data.ewma_past_lower.toFixed(2)}` : '—'}
                  </td>
                  <td className={`text-right pl-1 font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.ewma_future_lower != null ? `$${data.ewma_future_lower.toFixed(2)}` : '—'}
                  </td>
                </tr>
                {/* Error row */}
                {!data.isFuture && data.close != null && (
                  <tr>
                    <td className={`pr-2 ${isDarkMode ? 'text-slate-200' : 'text-gray-700'}`}>Error</td>
                    <td className="text-right px-1 font-mono tabular-nums">
                      {data.ewma_past_forecast != null ? (
                        <span className={(data.ewma_past_forecast - data.close) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {(data.ewma_past_forecast - data.close) >= 0 ? '+' : ''}{(data.ewma_past_forecast - data.close).toFixed(2)}
                        </span>
                      ) : <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>—</span>}
                    </td>
                    <td className={`text-right pl-1 font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                      —
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        
        {/* EWMA Biased Section */}
        {(data.ewma_biased_past_forecast != null || data.ewma_biased_future_forecast != null) && (
          <div className="px-4 py-3">
            {/* Section Header */}
            <div className="flex items-center gap-1.5 mb-2">
              <div className={`w-1 h-1 rounded-full ${isDarkMode ? 'bg-amber-400' : 'bg-amber-500'}`} />
              <span className={`text-[9px] font-semibold uppercase tracking-wider ${
                isDarkMode ? 'text-amber-400' : 'text-amber-600'
              }`}>
                EWMA Biased
              </span>
            </div>
            
            {/* Two-column table */}
            <table className="w-full text-[9px]">
              <tbody className={isDarkMode ? 'text-slate-300' : 'text-gray-700'}>
                {/* Made on (origin date) */}
                <tr>
                  <td className={`pr-2 ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>Made on</td>
                  <td className={`text-right px-1 font-mono ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.ewma_biased_past_origin_date ? formatDateShort(data.ewma_biased_past_origin_date) : '—'}
                  </td>
                  <td className={`text-right pl-1 font-mono ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.ewma_biased_future_origin_date ? formatDateShort(data.ewma_biased_future_origin_date) : '—'}
                  </td>
                </tr>
                {/* Target (target date) */}
                <tr>
                  <td className={`pr-2 ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>Target</td>
                  <td className={`text-right px-1 font-mono ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.ewma_biased_past_target_date ? formatDateShort(data.ewma_biased_past_target_date) : '—'}
                  </td>
                  <td className={`text-right pl-1 font-mono ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.ewma_biased_future_target_date ? formatDateShort(data.ewma_biased_future_target_date) : '—'}
                  </td>
                </tr>
                {/* Forecast Price */}
                <tr>
                  <td className={`pr-2 ${isDarkMode ? 'text-slate-200' : 'text-gray-700'}`}>Forecast</td>
                  <td className={`text-right px-1 font-mono tabular-nums font-bold ${isDarkMode ? 'text-amber-300' : 'text-amber-700'}`}>
                    {data.ewma_biased_past_forecast != null ? `$${data.ewma_biased_past_forecast.toFixed(2)}` : '—'}
                  </td>
                  <td className={`text-right pl-1 font-mono tabular-nums font-bold ${isDarkMode ? 'text-amber-300' : 'text-amber-700'}`}>
                    {data.ewma_biased_future_forecast != null ? `$${data.ewma_biased_future_forecast.toFixed(2)}` : '—'}
                  </td>
                </tr>
                {/* Upper Band */}
                <tr>
                  <td className={`pr-2 ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>Upper</td>
                  <td className={`text-right px-1 font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.ewma_biased_past_upper != null ? `$${data.ewma_biased_past_upper.toFixed(2)}` : '—'}
                  </td>
                  <td className={`text-right pl-1 font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.ewma_biased_future_upper != null ? `$${data.ewma_biased_future_upper.toFixed(2)}` : '—'}
                  </td>
                </tr>
                {/* Lower Band */}
                <tr>
                  <td className={`pr-2 ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>Lower</td>
                  <td className={`text-right px-1 font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.ewma_biased_past_lower != null ? `$${data.ewma_biased_past_lower.toFixed(2)}` : '—'}
                  </td>
                  <td className={`text-right pl-1 font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                    {data.ewma_biased_future_lower != null ? `$${data.ewma_biased_future_lower.toFixed(2)}` : '—'}
                  </td>
                </tr>
                {/* Error row */}
                {!data.isFuture && data.close != null && (
                  <tr>
                    <td className={`pr-2 ${isDarkMode ? 'text-slate-200' : 'text-gray-700'}`}>Error</td>
                    <td className="text-right px-1 font-mono tabular-nums">
                      {data.ewma_biased_past_forecast != null ? (
                        <span className={(data.ewma_biased_past_forecast - data.close) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {(data.ewma_biased_past_forecast - data.close) >= 0 ? '+' : ''}{(data.ewma_biased_past_forecast - data.close).toFixed(2)}
                        </span>
                      ) : <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>—</span>}
                    </td>
                    <td className={`text-right pl-1 font-mono tabular-nums ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                      —
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        
        {/* Trading212 Events Section (opens AND closes) */}
        {t212Events.length > 0 && (
          <div className="px-4 py-3">
            {/* Section Header - derive run label from first event (solo mode) */}
            {(() => {
              const headerRunLabel = t212Events.length > 0 ? t212Events[0].runLabel : 'EWMA';
              return (
                <div className="flex items-center gap-1.5 mb-2">
                  <div className={`w-1 h-1 rounded-full ${isDarkMode ? 'bg-sky-400' : 'bg-sky-500'}`} />
                  <span className={`text-[9px] font-semibold uppercase tracking-wider ${
                    isDarkMode ? 'text-sky-400' : 'text-sky-600'
                  }`}>
                    {`Portfolio – ${headerRunLabel}`}
                  </span>
                </div>
              );
            })()}
            
            <div className="space-y-2">
              {t212Events.map((e, idx) => {
                const isShort = e.side === 'short';
                const openLabel = e.side === 'long' ? 'Open Long' : 'Open Short';
                const exitLabel = e.side === 'long' ? 'Exit Long' : 'Exit Short';

                if (e.type === 'open') {
                  // Open event - just show the open line
                  return (
                    <div key={idx} className="flex justify-between text-[11px]">
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
                  <div key={idx} className="flex flex-col text-[11px]">
                    {/* Open row for this CLOSED position */}
                    <div className="flex justify-between mb-0.5">
                      <span className="flex items-center gap-1 text-slate-300">
                        <span
                          className={
                            'inline-flex h-2 w-2 rounded-full ' +
                            (isShort ? 'bg-rose-400' : 'bg-emerald-400')
                          }
                        />
                        {openLabel}
                        {/* show entryDate if different than the hovered date */}
                        {labelStr !== e.entryDate && (
                          <span className="ml-1 text-[9px] text-slate-500">
                            {formatDayMonth(e.entryDate)}
                          </span>
                        )}
                      </span>
                      <span className="font-mono tabular-nums text-slate-200">
                        ${e.entryPrice.toFixed(2)}
                      </span>
                    </div>

                    {/* Exit row */}
                    <div className="flex justify-between">
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

                    {/* P&L $ row */}
                    <div className="flex justify-between ml-3">
                      <span className="text-slate-400">P&amp;L</span>
                      <span
                        className={
                          'font-mono tabular-nums font-medium ' +
                          (isGain ? 'text-emerald-400' : 'text-rose-400')
                        }
                      >
                        {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
                      </span>
                    </div>

                    {/* P&L % row (if margin available) */}
                    {e.margin != null && (
                      <div className="flex justify-between ml-3">
                        <span className="text-slate-400"></span>
                        <span
                          className={
                            'font-mono tabular-nums text-[10px] ' +
                            (isGain ? 'text-emerald-400' : 'text-rose-400')
                          }
                        >
                          ({pct >= 0 ? '+' : '-'}{Math.abs(pct).toFixed(1)}%)
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

// Custom animated dot for price line (cyan glow)
const AnimatedPriceDot = (props: any) => {
  const { cx, cy, payload } = props;
  
  // Don't render dot for future/null points
  if (!payload || payload.isFuture || payload.value == null) return null;
  if (cx === undefined || cy === undefined) return null;
  
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill="#22D3EE"
      stroke="#ffffff"
      strokeWidth={1.5}
      style={{
        filter: 'drop-shadow(0 0 3px rgba(34, 211, 238, 0.5))',
        transition: 'all 0.12s ease-out',
      }}
    />
  );
};

// Custom animated dot for EWMA line (purple)
const AnimatedEwmaDot = (props: any) => {
  const { cx, cy, payload } = props;
  
  // Don't render dot for points without EWMA data
  if (!payload || payload.ewma_forecast == null) return null;
  if (cx === undefined || cy === undefined) return null;
  
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill="#A855F7"
      stroke="#ffffff"
      strokeWidth={1.5}
      style={{
        filter: 'drop-shadow(0 0 4px rgba(168, 85, 247, 0.6))',
        transition: 'all 0.12s ease-out',
      }}
    />
  );
};

// Custom animated dot for EWMA Biased line (amber) - Apple style refinement
const createAnimatedEwmaBiasedDot = ({ isMaximized = false }: { isMaximized?: boolean }) => {
  const DotComponent = (props: any) => {
    const { cx, cy, payload } = props;
    
    // Don't render dot for points without EWMA Biased data
    if (!payload || payload.ewma_biased_forecast == null) return null;
    if (cx === undefined || cy === undefined) return null;
    
    // Orange when maximized, amber when not
    const fillColor = isMaximized ? "#F97316" : "#F59E0B";
    
    return (
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill={fillColor}
        stroke="#ffffff"
        strokeWidth={1.5}
        style={{
          transition: 'all 0.15s ease-out',
        }}
      />
    );
  };
  DotComponent.displayName = 'AnimatedEwmaBiasedDot';
  return DotComponent;
};
