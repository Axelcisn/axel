"use client";

import React, { useEffect, useMemo, useState } from "react";
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
  CartesianGrid,
  Line,
  Customized,
} from "recharts";
import { useDarkMode } from "@/lib/hooks/useDarkMode";
import {
  sliceByRange,
  calculateRangePerformance,
  getRangeLabel,
  type PriceRange,
} from "@/lib/chart/ranges";
import { getNextTradingDates, generateFutureTradingDates } from "@/lib/chart/tradingDays";

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
  // EWMA Walker overlay values
  ewma_forecast?: number | null;
  ewma_lower?: number | null;
  ewma_upper?: number | null;
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
}

interface PriceChartProps {
  symbol: string;
  className?: string;
  horizon?: number;  // Number of trading days to extend (1,2,3,5)
  forecastOverlay?: ForecastOverlayProps;
  ewmaPath?: EwmaWalkerPathPoint[] | null;
  horizonCoverage?: HorizonCoverageProps;
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
  horizonCoverage,
}) => {
  const isDarkMode = useDarkMode();
  const h = horizon ?? 1;
  
  // EWMA overlay toggle
  const [showEwmaOverlay, setShowEwmaOverlay] = useState(false);
  
  // Model dropdown states
  const [showGarchDropdown, setShowGarchDropdown] = useState(false);
  const [showRangeDropdown, setShowRangeDropdown] = useState(false);
  
  // Debug: Log overlay prop
  console.log("[PriceChart] overlay prop", {
    h,
    hasOverlay: !!forecastOverlay,
    hasActiveForecast: !!forecastOverlay?.activeForecast,
    volModel: forecastOverlay?.volModel,
    coverage: forecastOverlay?.coverage,
  });
  
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
      console.log(`PriceChart: Using historical future dates:`, historicalFuture);
      return historicalFuture;
    }
    
    // If no historical future dates, generate them (for real-time scenarios)
    const generatedFuture = generateFutureTradingDates(lastDateStr, h);
    console.log(`PriceChart: Generated future dates:`, generatedFuture);
    return generatedFuture;
  }, [lastDateStr, allDates, h]);

  // Debug log for troubleshooting
  console.log("[PriceChart] horizon h=", h, {
    lastDateStr,
    futureDates,
    rangeLength: rangeData.length,
    fullLength: fullData.length,
    allDatesLength: allDates.length,
    lastDateInFull: fullData[fullData.length - 1]?.date,
    firstDateInRange: rangeData[0]?.date,
    lastDateInRange: rangeData[rangeData.length - 1]?.date,
  });

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

  // Merge EWMA forecast path into chartData for overlay
  const chartDataWithEwma = useMemo(() => {
    if (!showEwmaOverlay || !ewmaPath || ewmaPath.length === 0) {
      return chartData;
    }

    // Build maps of date_tp1 -> EWMA values (forecast, lower, upper)
    // The EWMA walker forecasts FOR date_tp1 using data available at date_t
    // So we plot y_hat_tp1 at date_tp1 (the target date)
    const ewmaMap = new Map<string, { forecast: number; lower: number; upper: number }>();
    
    ewmaPath.forEach(point => {
      const normalizedDate = normalizeDateString(point.date_tp1);
      ewmaMap.set(normalizedDate, {
        forecast: point.y_hat_tp1,
        lower: point.L_tp1,
        upper: point.U_tp1,
      });
    });

    // Get chart date range
    const chartDates = chartData.map(p => normalizeDateString(p.date));
    const firstChartDate = chartDates[0];
    const lastChartDate = chartDates[chartDates.length - 1];

    // Debug: Check date format consistency
    console.log("[EWMA Debug] Mapping:", {
      chartRange: { first: firstChartDate, last: lastChartDate, count: chartDates.length },
      ewmaTotal: ewmaPath.length,
      sampleChartDates: chartDates.slice(0, 3),
      sampleEwmaDates: ewmaPath.slice(0, 3).map(p => normalizeDateString(p.date_tp1)),
    });

    // Count matches
    let matchCount = 0;

    // Add EWMA fields to chartData points
    const result = chartData.map(point => {
      const chartDate = normalizeDateString(point.date);
      
      // If exact match exists, use it
      const ewmaData = ewmaMap.get(chartDate);
      if (ewmaData) {
        matchCount++;
        return {
          ...point,
          ewma_forecast: ewmaData.forecast,
          ewma_lower: ewmaData.lower,
          ewma_upper: ewmaData.upper,
        };
      }
      
      return {
        ...point,
        ewma_forecast: null,
        ewma_lower: null,
        ewma_upper: null,
      };
    });

    console.log("[EWMA Debug] Match stats:", { 
      matchCount, 
      chartTotal: chartData.length,
      matchRate: `${((matchCount / chartData.length) * 100).toFixed(1)}%`,
      // Show which chart dates have no EWMA data
      unmatchedDates: chartDates.filter(d => !ewmaMap.has(d)),
      // Show sample of result with ewma values
      sampleWithEwma: result.filter(p => p.ewma_forecast != null).slice(0, 3).map(p => ({
        date: p.date,
        value: p.value,
        ewma: p.ewma_forecast,
      })),
      sampleWithoutEwma: result.filter(p => p.ewma_forecast == null).map(p => ({
        date: p.date,
        value: p.value,
      })),
    });

    // Find and fill gaps: interpolate EWMA values for dates with missing data
    // This handles cases where EWMA API doesn't have data for certain dates
    for (let i = 1; i < result.length - 1; i++) {
      if (result[i].ewma_forecast == null) {
        const prev = result[i - 1];
        const next = result[i + 1];
        
        // If both neighbors have EWMA data, interpolate
        if (prev.ewma_forecast != null && next.ewma_forecast != null) {
          const interpolatedForecast = (prev.ewma_forecast + next.ewma_forecast) / 2;
          const interpolatedLower = (prev.ewma_lower != null && next.ewma_lower != null)
            ? (prev.ewma_lower + next.ewma_lower) / 2 : null;
          const interpolatedUpper = (prev.ewma_upper != null && next.ewma_upper != null)
            ? (prev.ewma_upper + next.ewma_upper) / 2 : null;
          
          // Mutate in place with proper typing
          (result[i] as any).ewma_forecast = interpolatedForecast;
          (result[i] as any).ewma_lower = interpolatedLower;
          (result[i] as any).ewma_upper = interpolatedUpper;
          
          console.log(`[EWMA] Interpolated gap at ${result[i].date}: ${interpolatedForecast.toFixed(2)}`);
        }
      }
    }

    // Log remaining gaps after interpolation
    const remainingGaps: string[] = [];
    for (let i = 1; i < result.length - 1; i++) {
      if (result[i].ewma_forecast == null && 
          (result[i-1].ewma_forecast != null || result[i+1].ewma_forecast != null)) {
        remainingGaps.push(result[i].date);
      }
    }
    if (remainingGaps.length > 0) {
      console.log("[EWMA Debug] ⚠️ Remaining GAPS after interpolation:", remainingGaps);
    }

    return result;
  }, [chartData, ewmaPath, showEwmaOverlay]);

  // Create a CLEAN EWMA-only data array for the overlay line
  // This bypasses all the complex merging and uses ewmaPath directly
  const ewmaLineData = useMemo(() => {
    if (!showEwmaOverlay || !ewmaPath || ewmaPath.length === 0) {
      return [];
    }

    // Get the visible date range from chartData (normalized to YYYY-MM-DD)
    const normalizedChartDates = chartData.map(p => normalizeDateString(p.date));
    const chartDateSet = new Set(normalizedChartDates);
    
    // Filter EWMA points to only those in the visible chart range
    // and create a simple array with date + ewma_forecast (normalized dates)
    const filtered = ewmaPath
      .map(p => ({
        date: normalizeDateString(p.date_tp1),
        ewma_forecast: p.y_hat_tp1,
      }))
      .filter(p => chartDateSet.has(p.date))
      .sort((a, b) => a.date.localeCompare(b.date));
    
    console.log("[EWMA Line Data] Created:", {
      ewmaPathTotal: ewmaPath.length,
      chartDatesCount: chartDateSet.size,
      filteredCount: filtered.length,
      sample: filtered.slice(0, 5),
    });
    
    return filtered;
  }, [chartData, ewmaPath, showEwmaOverlay]);

  // Test helper: find last chart points for debug dot
  const lastChartPoint = chartDataWithEwma[chartDataWithEwma.length - 1];
  const lastHistoricalPoint =
    chartDataWithEwma.slice().reverse().find((p) => p.value != null) || null;

  console.log("[PriceChart] last points", {
    lastChartPoint,
    lastHistoricalPoint,
  });

  // Debug: Log horizon/future data
  console.log("[PriceChart] horizon/future", {
    h,
    lastDateStr,
    futureDates,
    rangeLength: rangeData.length,
    fullLength: fullData.length,
    chartLength: chartData.length,
    lastChartDates: chartData.slice(-5).map(p => p.date),
  });

  // Debug chartData to see what we're actually sending to the chart
  console.log("[PriceChart] chartData sample:", {
    total: chartData.length,
    last3: chartData.slice(-3),
    futureCount: chartData.filter(p => p.isFuture).length,
  });

  // Extract forecast band from activeForecast (if any)
  let overlayDate: string | null = null;
  let overlayCenter: number | null = null;
  let overlayLower: number | null = null;
  let overlayUpper: number | null = null;

  const af = forecastOverlay?.activeForecast;

  console.log("[PriceChart] Debug - Forecast Overlay Check:", {
    forecastOverlay: !!forecastOverlay,
    activeForecast: !!af,
    volModel: forecastOverlay?.volModel,
    coverage: forecastOverlay?.coverage,
    horizon: h,
    chartDataLength: chartData.length,
    willRenderOverlay: !!(af && chartData.length > 0)
  });

  if (af && chartData.length > 0) {
    console.log("[PriceChart] ✅ WILL RENDER OVERLAY - activeForecast available:", {
      method: af.method,
      date_t: af.date_t,
      hasYHat: !!af.y_hat,
      hasIntervals: !!af.intervals,
      hasLH: !!af.L_h,
      hasUH: !!af.U_h
    });
    console.log("[PriceChart] Available chart dates (last 10):", chartData.slice(-10).map(p => p.date));

    // 1) Calculate target date (Date t+h) using business days
    const forecastDateT = af.date_t || af.target_date || af.date;
    
    // Use horizon from forecast data if available, fallback to UI horizon
    // This prevents dots from disappearing when horizon changes but forecast hasn't updated yet
    const forecastHorizon = af.horizonTrading || af.h || af.target?.h;
    const horizonValue = forecastHorizon || h || 1;
    
    console.log("[PriceChart] Horizon selection:", {
      uiHorizon: h,
      forecastHorizon: forecastHorizon,
      usingHorizon: horizonValue,
      forecastHasHorizonData: !!forecastHorizon
    });
    
    // Calculate the target date (t+h) accounting for business days
    const targetDate = calculateTargetDate(forecastDateT, horizonValue);
    const lastPoint = chartData[chartData.length - 1];
    
    // Use the target date if available, otherwise fall back to last chart date
    overlayDate = targetDate || (lastPoint?.date ?? null);

    console.log("[PriceChart] Forecast reference date (t):", forecastDateT);
    console.log("[PriceChart] Horizon:", horizonValue);
    console.log("[PriceChart] Calculated target date (t+h):", targetDate);
    console.log("[PriceChart] Using overlay date:", overlayDate);

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

    console.log("[PriceChart] overlay from inspector", {
      overlayDate,
      overlayCenter,
      overlayLower,
      overlayUpper,
      isLogDomain,
      forecastDate_t: af.date_t,
      horizonUsed: horizonValue,
      horizonMismatch: forecastHorizon && forecastHorizon !== h,
      extractedData: {
        y_hat: af.y_hat,
        L_h: af.L_h,
        U_h: af.U_h,
        intervals,
        topLevelL,
        topLevelU
      }
    });
  } else {
    console.log("[PriceChart] ❌ NO OVERLAY - Conditions not met:", {
      hasActiveForecast: !!af,
      hasChartData: chartData.length > 0,
      activeForecastType: af ? typeof af : 'undefined',
      activeForecastMethod: af?.method || 'none'
    });
  }

  // Create chart data with forecast band for rendering the connecting lines and filled area
  const chartDataWithForecastBand = useMemo(() => {
    // Start with the EWMA-merged data
    let data = [...chartDataWithEwma];
    
    // If we have forecast overlay data, add band values to relevant points
    if (overlayDate && overlayCenter != null && lastHistoricalPoint) {
      const lastHistDate = lastHistoricalPoint.date;
      const lastHistValue = lastHistoricalPoint.value;
      
      // Check if overlayDate exists in data
      const overlayDateExists = data.some(p => p.date === overlayDate);
      
      console.log("[ForecastBand] Building forecast band data:", {
        overlayDate,
        overlayCenter,
        overlayLower,
        overlayUpper,
        lastHistDate,
        lastHistValue,
        overlayDateExists,
        dataLength: data.length,
        lastFewDates: data.slice(-5).map(p => p.date),
        lastFewPoints: data.slice(-5).map(p => ({
          date: p.date,
          value: p.value,
          fc: p.forecastCenter,
          fl: p.forecastLower,
          fu: p.forecastUpper
        }))
      });
      
      // If overlayDate doesn't exist in data, add it
      if (!overlayDateExists) {
        data = [...data, {
          date: overlayDate,
          value: null,
          isFuture: true,
          forecastCenter: overlayCenter,
          forecastLower: overlayLower,
          forecastUpper: overlayUpper,
        }];
        // Sort by date to maintain order
        data.sort((a, b) => a.date.localeCompare(b.date));
      }
      
      // Find the indices of the last historical point and the overlay date
      const lastHistIndex = data.findIndex(p => p.date === lastHistDate);
      const overlayIndex = data.findIndex(p => p.date === overlayDate);
      
      console.log("[ForecastBand] Index lookup:", {
        lastHistIndex,
        overlayIndex,
        pointsBetween: overlayIndex - lastHistIndex - 1
      });
      
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
            };
          }
          
          // Overlay date: the forecast values
          if (idx === overlayIndex) {
            return {
              ...point,
              forecastCenter: overlayCenter,
              forecastLower: overlayLower,
              forecastUpper: overlayUpper,
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
            };
          }
          
          return point;
        });
      }
    }
    
    return data;
  }, [chartDataWithEwma, overlayDate, overlayCenter, overlayLower, overlayUpper, lastHistoricalPoint]);

  // Debug: Log the actual chart data with EWMA
  console.log("[PriceChart] chartDataWithForecastBand EWMA check:", {
    total: chartDataWithForecastBand.length,
    withEwma: chartDataWithForecastBand.filter(p => p.ewma_forecast != null).length,
    withoutEwma: chartDataWithForecastBand.filter(p => p.ewma_forecast == null).length,
    // Check for gaps - consecutive points where one has ewma and next doesn't
    samplePoints: chartDataWithForecastBand.slice(0, 10).map(p => ({
      date: p.date,
      value: p.value?.toFixed(2),
      ewma: p.ewma_forecast?.toFixed(2) ?? 'null',
    })),
  });

  // Compute Y-axis domain that includes EWMA values when overlay is active
  const priceYDomain = useMemo(() => {
    const values: number[] = [];
    
    chartDataWithForecastBand.forEach(p => {
      if (p.value != null) values.push(p.value);
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

  // Determine line color from current range performance
  const latestRangePerf = perfByRange[selectedRange];
  const isPositive = latestRangePerf != null ? latestRangePerf >= 0 : undefined;
  const lineColor = isPositive === false ? "#F97373" : "#00E5A0";

  const chartBg = "w-full";
  const containerClasses = (className ?? "") + " w-full";

  return (
    <div className={containerClasses}>
      {/* Controls Row: Horizon/Coverage on left, Zoom/EWMA on right */}
      <div className="flex justify-between items-center mb-2">
        {/* Left side: Horizon and Coverage */}
        {horizonCoverage && (
          <div className="flex items-start gap-6">
            {/* Horizon */}
            <div className="flex flex-col gap-1">
              <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Horizon</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 5].map((days) => (
                  <button
                    key={days}
                    onClick={() => horizonCoverage.onHorizonChange(days)}
                    disabled={horizonCoverage.isLoading}
                    className={`px-3 py-1 text-sm rounded-full transition-colors ${
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
            <div className="flex flex-col gap-1">
              <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Coverage</span>
              <div className="flex items-center gap-1">
                {[0.90, 0.95, 0.99].map((cov) => (
                  <button
                    key={cov}
                    onClick={() => horizonCoverage.onCoverageChange(cov)}
                    disabled={horizonCoverage.isLoading}
                    className={`px-3 py-1 text-sm rounded-full transition-colors ${
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
            
            {/* Model */}
            {horizonCoverage.volModel && horizonCoverage.onModelChange && (
              <div className="flex flex-col gap-1">
                <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Model</span>
                <div className="flex items-center gap-1">
                  {/* GBM Button */}
                  {(() => {
                    const isSelected = horizonCoverage.volModel === 'GBM';
                    const isBest = horizonCoverage.recommendedModel?.volModel === 'GBM';
                    return (
                      <button
                        onClick={() => horizonCoverage.onModelChange!('GBM')}
                        disabled={horizonCoverage.isLoading}
                        className={`px-3 py-1 text-sm rounded-full transition-colors ${
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
                          className={`px-3 py-1 text-sm rounded-full transition-colors flex items-center gap-1 ${
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
                        className={`px-3 py-1 text-sm rounded-full transition-colors ${
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
                          className={`px-3 py-1 text-sm rounded-full transition-colors flex items-center gap-1 ${
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
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Spacer if no horizonCoverage */}
        {!horizonCoverage && <div />}
        
        {/* Right side: Zoom and EWMA */}
        <div className="flex items-center gap-1">
          <button
            onClick={zoomIn}
            disabled={loading || fullData.length === 0}
            className={`
              w-10 h-10 rounded-full text-sm font-medium transition-all
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
              w-10 h-10 rounded-full text-sm font-medium transition-all
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
          
          {/* EWMA Path Toggle */}
          {ewmaPath && ewmaPath.length > 0 && (
            <button
              onClick={() => setShowEwmaOverlay(!showEwmaOverlay)}
              className={`
                ml-2 px-3 py-2 rounded-full text-xs font-medium transition-all
                ${showEwmaOverlay 
                  ? isDarkMode
                    ? 'bg-purple-600 text-white border border-purple-500'
                    : 'bg-purple-500 text-white border border-purple-400'
                  : isDarkMode 
                    ? 'bg-gray-700 hover:bg-gray-600 text-gray-300 border border-gray-600'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-600 border border-gray-300'
                }
              `}
              title={showEwmaOverlay ? "Hide EWMA forecast path" : "Show EWMA forecast path"}
            >
              EWMA
            </button>
          )}
        </div>
      </div>
      
      {/* Secondary Controls Row: Window Size, EWMA λ, Degrees of Freedom */}
      {horizonCoverage && horizonCoverage.volModel && (
        <div className="flex items-center gap-4 mb-2 mt-6">
          {/* Window Size - always visible */}
          {horizonCoverage.onWindowSizeChange && (
            <div className="flex items-center gap-2">
              <label className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Window
              </label>
              <input
                type="number"
                value={horizonCoverage.windowSize ?? 1000}
                onChange={(e) => horizonCoverage.onWindowSizeChange!(parseInt(e.target.value) || 1000)}
                disabled={horizonCoverage.isLoading}
                className={`w-20 px-3 py-1 text-sm rounded-full border ${
                  isDarkMode 
                    ? 'bg-gray-800 border-gray-600 text-white focus:border-blue-500' 
                    : 'bg-white border-gray-300 text-gray-900 focus:border-blue-500'
                } focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50`}
                min={50}
                max={5000}
              />
            </div>
          )}
          
          {/* EWMA λ - only for Range model */}
          {horizonCoverage.volModel === 'Range' && horizonCoverage.onEwmaLambdaChange && (
            <div className="flex items-center gap-2">
              <label className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                EWMA λ
              </label>
              <input
                type="number"
                value={horizonCoverage.ewmaLambda ?? 0.94}
                onChange={(e) => horizonCoverage.onEwmaLambdaChange!(parseFloat(e.target.value) || 0.94)}
                disabled={horizonCoverage.isLoading}
                step={0.01}
                className={`w-20 px-3 py-1 text-sm rounded-full border ${
                  isDarkMode 
                    ? 'bg-gray-800 border-gray-600 text-white focus:border-blue-500' 
                    : 'bg-white border-gray-300 text-gray-900 focus:border-blue-500'
                } focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50`}
                min={0.5}
                max={0.99}
              />
            </div>
          )}
          
          {/* Degrees of Freedom - only for GARCH Student-t */}
          {horizonCoverage.volModel === 'GARCH' && horizonCoverage.garchEstimator === 'Student-t' && horizonCoverage.onDegreesOfFreedomChange && (
            <div className="flex items-center gap-2">
              <label className={`text-xs font-medium ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                DoF
              </label>
              <input
                type="number"
                value={horizonCoverage.degreesOfFreedom ?? 8}
                onChange={(e) => horizonCoverage.onDegreesOfFreedomChange!(parseInt(e.target.value) || 8)}
                disabled={horizonCoverage.isLoading}
                className={`w-16 px-3 py-1 text-sm rounded-full border ${
                  isDarkMode 
                    ? 'bg-gray-800 border-gray-600 text-white focus:border-blue-500' 
                    : 'bg-white border-gray-300 text-gray-900 focus:border-blue-500'
                } focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50`}
                min={3}
                max={30}
              />
            </div>
          )}
        </div>
      )}
      
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
              
              /* Line draw effect */
              @keyframes lineReveal {
                0% {
                  stroke-dashoffset: 500;
                  opacity: 0.3;
                }
                100% {
                  stroke-dashoffset: 0;
                  opacity: 1;
                }
              }
              
              /* Vertical reference line fade */
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
              
              .recharts-line-curve {
                stroke-dasharray: 500;
                animation: lineReveal 0.7s ease-out forwards;
              }
              
              .forecast-ref-line {
                stroke-dasharray: 100;
                animation: refLineFade 0.6s ease-out forwards;
              }
            `}</style>
            {/* Combined Price and Volume Chart */}
            <ResponsiveContainer width="100%" height={500}>
              <ComposedChart
                data={chartDataWithForecastBand}
                margin={{ top: 20, right: 0, left: 0, bottom: 20 }}
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
                  content={<PriceTooltip isDarkMode={isDarkMode} />}
                  animationDuration={0}
                  cursor={{
                    stroke: isDarkMode ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)",
                    strokeWidth: 1,
                  }}
                />
                
                {/* TEMP: Test dot at last historical point */}
                {lastHistoricalPoint && lastHistoricalPoint.value != null && (
                  <ReferenceDot
                    x={lastHistoricalPoint.date}
                    y={lastHistoricalPoint.value}
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
                {(() => {
                  console.log("[PriceChart] Overlay rendering check:", {
                    overlayDate,
                    overlayCenter,
                    overlayLower, 
                    overlayUpper,
                    hasOverlayDate: !!overlayDate,
                    hasCenterValue: overlayCenter != null,
                    hasLowerValue: overlayLower != null,
                    hasUpperValue: overlayUpper != null,
                    shouldRenderOverlay: !!(overlayDate && overlayCenter != null),
                    dateInChartData: chartData.some(p => p.date === overlayDate),
                    allChartDates: chartData.map(p => p.date),
                    forecastOverlayProps: {
                      activeForecast: !!forecastOverlay?.activeForecast,
                      volModel: forecastOverlay?.volModel,
                      coverage: forecastOverlay?.coverage
                    }
                  });
                  return null;
                })()}
                {overlayDate && overlayCenter != null && (
                  <>
                    {console.log("[PriceChart] 🎯 RENDERING OVERLAY ELEMENTS - Dots should appear!", {
                      overlayDate,
                      overlayCenter,
                      overlayLower,
                      overlayUpper,
                      elementCount: 1 + (overlayLower != null ? 1 : 0) + (overlayUpper != null ? 1 : 0)
                    })}
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
                
                {/* Log when overlay should render but doesn't */}
                {(() => {
                  if (!overlayDate) console.log("[PriceChart] ❌ NO OVERLAY DATE - Cannot render dots");
                  if (overlayDate && overlayCenter == null) console.log("[PriceChart] ❌ NO OVERLAY CENTER - Cannot render dots", {overlayDate, overlayCenter});
                  return null;
                })()}
                
                {/* Debug log for forecast band data */}
                {(() => {
                  const pointsWithForecast = chartDataWithForecastBand.filter(p => 
                    p.forecastCenter != null || p.forecastLower != null || p.forecastUpper != null
                  );
                  console.log("[PriceChart] 📊 FORECAST BAND DATA:", {
                    totalPoints: chartDataWithForecastBand.length,
                    pointsWithForecastData: pointsWithForecast.length,
                    forecastPoints: pointsWithForecast.map(p => ({
                      date: p.date,
                      value: p.value,
                      center: p.forecastCenter,
                      lower: p.forecastLower,
                      upper: p.forecastUpper
                    })),
                    willRenderBands: !!(overlayLower != null && overlayUpper != null)
                  });
                  return null;
                })()}
                
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
                      isAnimationActive={true}
                      animationDuration={800}
                      animationEasing="ease-out"
                      animationBegin={100}
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
                      isAnimationActive={true}
                      animationDuration={800}
                      animationEasing="ease-out"
                      animationBegin={100}
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
                    isAnimationActive={true}
                    animationDuration={600}
                    animationEasing="ease-out"
                    animationBegin={50}
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
                    isAnimationActive={true}
                    animationDuration={600}
                    animationEasing="ease-out"
                    animationBegin={0}
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
                    isAnimationActive={true}
                    animationDuration={600}
                    animationEasing="ease-out"
                    animationBegin={0}
                    connectNulls={false}
                    filter="url(#forecastGlow)"
                  />
                )}
                
                {/* Price Area - takes up top 75% */}
                <Area
                  yAxisId="price"
                  type="monotone"
                  dataKey="value"
                  stroke={lineColor}
                  strokeWidth={2}
                  fill="url(#priceFill)"
                  dot={false}
                  activeDot={<AnimatedPriceDot />}
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
                
                {/* EWMA Forecast Path Overlay - Simple Line */}
                {showEwmaOverlay && (
                  <>
                    <Line
                      yAxisId="price"
                      type="linear"
                      dataKey="ewma_forecast"
                      stroke="transparent"
                      strokeWidth={0}
                      dot={false}
                      activeDot={<AnimatedEwmaDot />}
                      connectNulls={true}
                      isAnimationActive={false}
                    />
                    {ewmaLineData.length > 0 && (
                      <Customized component={<CustomEwmaLine ewmaLineData={ewmaLineData} />} />
                    )}
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      
      {/* Range Selector - positioned below chart like TradingView */}
      <RangeSelector
        selectedRange={selectedRange}
        perfByRange={perfByRange}
        onChange={handleRangeChange}
        isDarkMode={isDarkMode}
      />
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
                flex-1 px-2 py-2 text-sm font-medium rounded-lg transition-all mx-0.5
                ${isSelected 
                  ? isDarkMode 
                    ? 'bg-white/10 text-white border border-white/20' 
                    : 'bg-gray-200 text-gray-900 border border-gray-300'
                  : isDarkMode
                    ? 'bg-transparent text-gray-400 hover:bg-white/5 hover:text-gray-300 border border-transparent'
                    : 'bg-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-800 border border-transparent'
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
  label?: string;
  payload?: { 
    value: number;
    payload: ChartPoint;
  }[];
  isDarkMode?: boolean;
}

const PriceTooltip: React.FC<PriceTooltipProps> = ({
  active,
  label,
  payload,
  isDarkMode = true,
}) => {
  if (!active || !payload || !payload.length || !label) return null;
  
  const data = payload[0].payload;
  const price = payload[0].value;
  
  // Check if this is a future/forecast-only point (no historical price, only forecast data)
  const isFuturePoint = data.isFuture === true;
  const hasForecastData = isFuturePoint && (data.forecastCenter != null || data.forecastLower != null || data.forecastUpper != null);
  const hasEwmaData = data.ewma_forecast != null;
  
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs shadow-lg ${
      isDarkMode 
        ? 'border-white/10 bg-[#111827] text-slate-100'
        : 'border-gray-300 bg-white text-gray-900'
    }`}>
      <div className="flex gap-4">
        {/* Left Column: Price Data */}
        <div className="space-y-1 min-w-[120px]">
          {/* Date with year */}
          <div className={`text-[11px] font-medium ${
            isDarkMode ? 'text-slate-300' : 'text-gray-600'
          }`}>
            {formatTooltipDate(label)}
          </div>
          
          {/* Price - show Center forecast if available, otherwise Close price */}
          {(hasForecastData && data.forecastCenter != null) ? (
            <div className="text-sm font-mono tabular-nums font-semibold">
              ${data.forecastCenter.toFixed(2)}
            </div>
          ) : price != null && (
            <div className="text-sm font-mono tabular-nums font-semibold">
              ${price.toFixed(2)}
            </div>
          )}
          
          {/* Forecast Data - show when hovering on forecast points */}
          {hasForecastData && (
            <div className={`space-y-1 pt-1 border-t ${
              isDarkMode ? 'border-white/10' : 'border-gray-200'
            }`}>
              <div className={`text-[10px] font-medium uppercase tracking-wide ${
                isDarkMode ? 'text-blue-400' : 'text-blue-600'
              }`}>
                Forecast
              </div>
              {data.forecastUpper != null && (
                <div className="flex justify-between gap-4">
                  <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Upper:</span>
                  <span className="font-mono text-cyan-400">${data.forecastUpper.toFixed(2)}</span>
                </div>
              )}
              {data.forecastCenter != null && (
                <div className="flex justify-between gap-4">
                  <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Center:</span>
                  <span className="font-mono font-semibold text-blue-400">${data.forecastCenter.toFixed(2)}</span>
                </div>
              )}
              {data.forecastLower != null && (
                <div className="flex justify-between gap-4">
                  <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Lower:</span>
                  <span className="font-mono text-cyan-400">${data.forecastLower.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}
          
          {/* OHLCV Data - only show for historical points */}
          {!isFuturePoint && (data.open || data.high || data.low || data.close || data.volume) && (
            <div className="space-y-0.5 pt-1">
              {data.open && (
                <div className="flex justify-between">
                  <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Open:</span>
                  <span className="font-mono">${data.open.toFixed(2)}</span>
                </div>
              )}
              {data.high && (
                <div className="flex justify-between">
                  <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>High:</span>
                  <span className="font-mono">${data.high.toFixed(2)}</span>
                </div>
              )}
              {data.low && (
                <div className="flex justify-between">
                  <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Low:</span>
                  <span className="font-mono">${data.low.toFixed(2)}</span>
                </div>
              )}
              {data.close && (
                <div className="flex justify-between">
                  <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Close:</span>
                  <span className="font-mono">${data.close.toFixed(2)}</span>
                </div>
              )}
              {data.volume && (
                <div className="flex justify-between">
                  <span className={isDarkMode ? 'text-slate-400' : 'text-gray-500'}>Volume:</span>
                  <span className="font-mono">{formatVolumeAbbreviated(data.volume)}</span>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Right Column: EWMA Data - Purple themed */}
        {hasEwmaData && (
          <>
            {/* Vertical Divider */}
            <div className={`w-px ${isDarkMode ? 'bg-purple-500/30' : 'bg-purple-300'}`} />
            
            <div className="space-y-1 min-w-[100px]">
              {/* EWMA Header */}
              <div className="text-[10px] font-medium uppercase tracking-wide text-purple-400">
                EWMA
              </div>
              
              {/* EWMA Forecast (ŷ) */}
              <div className="text-sm font-mono tabular-nums font-semibold text-purple-300">
                ${data.ewma_forecast!.toFixed(2)}
              </div>
              
              {/* EWMA Bounds */}
              <div className="space-y-0.5 pt-1">
                {data.ewma_upper != null && (
                  <div className="flex justify-between gap-3">
                    <span className="text-purple-400/70">Upper:</span>
                    <span className="font-mono text-purple-300/80">${data.ewma_upper.toFixed(2)}</span>
                  </div>
                )}
                {data.ewma_lower != null && (
                  <div className="flex justify-between gap-3">
                    <span className="text-purple-400/70">Lower:</span>
                    <span className="font-mono text-purple-300/80">${data.ewma_lower.toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>
          </>
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

// Custom EWMA line renderer using Customized component
// This bypasses Recharts Line component issues with connectNulls
interface CustomEwmaLineProps {
  xAxisMap?: any;
  yAxisMap?: any;
  data?: any[];
  ewmaLineData?: Array<{ date: string; ewma_forecast: number }>;
}

const CustomEwmaLine: React.FC<CustomEwmaLineProps> = ({ 
  xAxisMap, 
  yAxisMap, 
  data,
  ewmaLineData 
}) => {
  if (!xAxisMap || !yAxisMap || !ewmaLineData || ewmaLineData.length === 0) {
    return null;
  }

  // Get the axis scales
  const xAxis = Object.values(xAxisMap)[0] as any;
  const yAxis = yAxisMap?.price as any;
  
  if (!xAxis?.scale || !yAxis?.scale) {
    return null;
  }

  // Build the path by converting each EWMA point to SVG coordinates
  const points: Array<{ x: number; y: number }> = [];
  
  ewmaLineData.forEach(point => {
    const x = xAxis.scale(point.date);
    const y = yAxis.scale(point.ewma_forecast);
    
    if (typeof x === 'number' && typeof y === 'number' && !isNaN(x) && !isNaN(y)) {
      points.push({ x, y });
    }
  });

  if (points.length < 2) {
    return null;
  }

  // Create SVG path - simple line connecting all points
  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  return (
    <path
      d={pathD}
      fill="none"
      stroke="#A855F7"
      strokeWidth={2.5}
      strokeOpacity={0.9}
      style={{
        filter: 'drop-shadow(0 0 2px rgba(168, 85, 247, 0.5))',
      }}
    />
  );
};
