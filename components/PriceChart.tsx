'use client';

import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot, Area, AreaChart, ComposedChart, ReferenceArea } from 'recharts';
import { useDarkMode } from '@/lib/hooks/useDarkMode';

interface PriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adj_close: number | null;
  volume: number | null;
}

interface PriceChartProps {
  symbol: string;
  className?: string;
  activeForecast?: any; // Forecast data from Final Prediction Intervals section
  gbmForecast?: any; // GBM forecast data from timing page
  gbmWindowLength?: number; // Window length from GBM section to highlight
  // Conformal props
  conformalMode?: 'ICP' | 'ICP-SCALED' | 'CQR' | 'EnbPI' | 'ACI';
  conformalDomain?: 'log' | 'price';
  conformalCalWindow?: number;
  conformalEta?: number;
  conformalK?: number;
  conformalState?: any;
  baseForecastCount?: number | null;
  isLoadingBaseForecasts?: boolean;
  isGeneratingBase?: boolean;
  isApplyingConformal?: boolean;
  conformalError?: string | null;
  activeBaseMethod?: string | null;
  targetSpecResult?: any;
  modelLine?: Array<{ date: string; model_price: number }> | null;
  onConformalModeChange?: (mode: 'ICP' | 'ICP-SCALED' | 'CQR' | 'EnbPI' | 'ACI') => void;
  onConformalDomainChange?: (domain: 'log' | 'price') => void;
  onConformalCalWindowChange?: (window: number) => void;
  onConformalEtaChange?: (eta: number) => void;
  onConformalKChange?: (k: number) => void;
  onLoadBaseForecastCount?: () => void;
  onGenerateBaseForecasts?: () => void;
  onApplyConformalPrediction?: () => void;
}

type TimeRange = '5d' | '1m' | '6m' | 'ytd' | '1y' | '5y' | 'all';
type SelectedModel = 'auto' | 'gbm' | 'active'; // 'auto' shows appropriate model, 'gbm'/'active' forces specific model

interface TimeRangeOption {
  key: TimeRange;
  label: string;
  days: number | null; // null means all data
}

const timeRanges: TimeRangeOption[] = [
  { key: '5d', label: '5 days', days: 5 },
  { key: '1m', label: '1 month', days: 30 },
  { key: '6m', label: '6 months', days: 180 },
  { key: 'ytd', label: 'Year to date', days: null }, // Will calculate YTD
  { key: '1y', label: '1 year', days: 365 },
  { key: '5y', label: '5 years', days: 1825 },
  { key: 'all', label: 'All time', days: null }
];

// Helper function to compare if two forecasts are essentially the same
function areForeccastsSame(forecast1: any, forecast2: any): boolean {
  if (!forecast1 || !forecast2) return false;
  
  // Compare the key forecast values with a small tolerance for floating point differences
  const tolerance = 0.001;
  
  return Math.abs(forecast1.L_h - forecast2.L_h) < tolerance &&
         Math.abs(forecast1.U_h - forecast2.U_h) < tolerance &&
         Math.abs(forecast1.currentPrice - forecast2.currentPrice) < tolerance;
}

// Helper function to get next trading date from filtered data series
function getNextTradingDateFromSeries(
  date: string,
  series: { date: string }[]
): string | null {
  const idx = series.findIndex((row) => row.date === date);
  if (idx === -1 || idx === series.length - 1) return null;
  return series[idx + 1].date;
}

export default function PriceChart({ 
  symbol, 
  className = '', 
  activeForecast, 
  gbmForecast, 
  gbmWindowLength,
  // Conformal props with defaults
  conformalMode = 'ICP',
  conformalDomain = 'log',
  conformalCalWindow = 250,
  conformalEta = 0.02,
  conformalK = 20,
  conformalState,
  baseForecastCount = null,
  isLoadingBaseForecasts = false,
  isGeneratingBase = false,
  isApplyingConformal = false,
  conformalError = null,
  activeBaseMethod = null,
  targetSpecResult,
  modelLine = null,
  onConformalModeChange,
  onConformalDomainChange,
  onConformalCalWindowChange,
  onConformalEtaChange,
  onConformalKChange,
  onLoadBaseForecastCount,
  onGenerateBaseForecasts,
  onApplyConformalPrediction
}: PriceChartProps) {
  const isDarkMode = useDarkMode();
  
  // Theme configuration
  const theme = {
    background: isDarkMode ? 'bg-gray-900' : 'bg-white',
    border: isDarkMode ? 'border-gray-700' : 'border-gray-200',
    text: {
      primary: isDarkMode ? 'text-white' : 'text-gray-900',
      secondary: isDarkMode ? 'text-gray-300' : 'text-gray-600',
      muted: isDarkMode ? 'text-gray-400' : 'text-gray-500',
    },
    button: {
      primary: isDarkMode ? 'border-gray-600 hover:bg-gray-700 text-gray-300' : 'border-gray-300 hover:bg-gray-100 text-gray-700',
      selected: isDarkMode ? 'bg-blue-800 border-blue-600 text-blue-200' : 'bg-blue-100 border-blue-300 text-blue-900',
      selectedHover: isDarkMode ? 'text-blue-100' : 'text-blue-900',
    },
    chart: {
      grid: isDarkMode ? '#374151' : '#f1f5f9',
      axis: isDarkMode ? '#6b7280' : '#64748b',
      background: isDarkMode ? '#1f2937' : '#ffffff',
    }
  };
  const [data, setData] = useState<PriceData[]>([]);
  const [selectedRange, setSelectedRange] = useState<TimeRange>('1y');
  const [selectedModel, setSelectedModel] = useState<SelectedModel>('auto');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1); // 1 = normal, higher = more zoomed in
  const [focusDateRange, setFocusDateRange] = useState<{ start: string; end: string } | null>(null);

  // Handle miss band clicks to toggle zoom and focus on the band
  const handleMissBandClick = (seg: any, e?: any) => {
    if (e) {
      e.stopPropagation(); // Prevent event bubbling if event exists
    }
    
    console.log('Miss band clicked:', seg); // Debug log
    console.log('Current zoom level:', zoomLevel); // Debug log
    
    if (zoomLevel === 1) {
      // Zoom in and focus on this miss band
      setZoomLevel(2.5);
      
      // Calculate focus range centered around the miss band
      // Add some padding around the miss dates for context
      const forecastDate = new Date(seg.forecastDate);
      const realizedDate = new Date(seg.realizedDate);
      
      // Add 10 days padding on each side (adjust as needed)
      const startDate = new Date(forecastDate);
      startDate.setDate(startDate.getDate() - 10);
      
      const endDate = new Date(realizedDate);
      endDate.setDate(endDate.getDate() + 10);
      
      const focusRange = {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
      };
      
      console.log('Setting focus range:', focusRange); // Debug log
      setFocusDateRange(focusRange);
    } else {
      // Zoom out and clear focus
      console.log('Zooming out'); // Debug log
      setZoomLevel(1);
      setFocusDateRange(null);
    }
  };

  // Reset model selection when forecasts change
  useEffect(() => {
    setSelectedModel('auto');
  }, [activeForecast, gbmForecast]);

  // Load historical price data
  useEffect(() => {
    const loadPriceData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // First try to load from uploads
        let response = await fetch(`/api/uploads/${symbol}`);
        let dataSource = 'uploads';
        
        // If no uploaded data found, fall back to canonical data
        if (!response.ok) {
          response = await fetch(`/api/canonical/${symbol}`);
          dataSource = 'canonical';
        }
        
        if (!response.ok) {
          throw new Error(`Failed to load data: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.rows || data.rows.length === 0) {
          throw new Error('No price data available');
        }
        
        // Sort by date and filter valid rows
        const sortedData = data.rows
          .filter((row: any) => row.valid !== false && (row.adj_close !== null || row.close !== null))
          .sort((a: any, b: any) => a.date.localeCompare(b.date));
        
        console.log(`Loaded ${sortedData.length} rows from ${dataSource} for ${symbol}`);
        setData(sortedData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setIsLoading(false);
      }
    };

    if (symbol) {
      loadPriceData();
    }
  }, [symbol]);

  // Track previous month for smart labeling
  const lastShownMonthRef = useRef(-1);

  // Filter data based on selected time range and zoom level
  const filteredData = useMemo(() => {
    // Reset month tracker when data changes
    lastShownMonthRef.current = -1;
    if (!data.length) return [];

    let baseFilteredData: PriceData[] = [];
    
    // If we have a focus date range (from miss band click), use that instead
    if (focusDateRange) {
      baseFilteredData = data.filter(row => 
        row.date >= focusDateRange.start && row.date <= focusDateRange.end
      );
      return baseFilteredData;
    }
    
    // Calculate zoom-adjusted days
    const selectedOption = timeRanges.find(r => r.key === selectedRange);
    let baseDays = selectedOption?.days || 365; // default to 1 year
    
    // Get the latest date in the data to calculate ranges relative to data, not current date
    const latestDataDate = data[data.length - 1].date;
    
    if (selectedRange === 'ytd') {
      // Year to date - from Jan 1 of the latest data year
      const latestDate = new Date(latestDataDate);
      const currentYear = latestDate.getFullYear();
      const ytdStart = `${currentYear}-01-01`;
      baseFilteredData = data.filter(row => row.date >= ytdStart);
    } else if (selectedRange === 'all') {
      // For 'all' range, show all data but apply zoom by taking subset
      if (zoomLevel > 1) {
        const zoomedLength = Math.max(5, Math.floor(data.length / zoomLevel));
        baseFilteredData = data.slice(-zoomedLength);
      } else {
        baseFilteredData = data;
      }
    } else if (baseDays) {
      // Apply zoom to reduce the time range (higher zoom = fewer days)
      // Calculate cutoff relative to the latest data date, not current date
      const zoomedDays = Math.max(5, Math.floor(baseDays / zoomLevel)); // minimum 5 days
      const cutoffDate = new Date(latestDataDate);
      cutoffDate.setDate(cutoffDate.getDate() - zoomedDays);
      const cutoffString = cutoffDate.toISOString().split('T')[0];
      baseFilteredData = data.filter(row => row.date >= cutoffString);
    } else {
      baseFilteredData = data;
    }

    // If we haven't filtered yet (ytd case), apply zoom by taking subset
    if (selectedRange === 'ytd' && zoomLevel > 1) {
      const zoomedLength = Math.max(5, Math.floor(baseFilteredData.length / zoomLevel));
      baseFilteredData = baseFilteredData.slice(-zoomedLength);
    }

    return baseFilteredData;
  }, [data, selectedRange, zoomLevel, focusDateRange]);

  // Calculate performance metrics
  const performance = useMemo(() => {
    if (filteredData.length < 2) return null;
    
    const firstPrice = filteredData[0].adj_close || filteredData[0].close;
    const lastPrice = filteredData[filteredData.length - 1].adj_close || filteredData[filteredData.length - 1].close;
    const change = lastPrice - firstPrice;
    const changePercent = (change / firstPrice) * 100;
    
    return {
      firstPrice,
      lastPrice,
      change,
      changePercent
    };
  }, [filteredData]);

  // Calculate miss segments independently of filteredData to preserve them during zoom
  const missSegments = useMemo(() => {
    type MissSegment = {
      forecastDate: string;
      realizedDate: string;
      L_price: number;
      U_price: number;
      realizedPrice: number;
      forecastPrice: number;
      predPrice: number;
    };

    const segments: MissSegment[] = [];
    
    if (conformalState?.coverage?.miss_details && 
        conformalState.coverage.miss_details.length > 0 && 
        data.length > 1) {
      const domainIsLog = conformalDomain === 'log';

      // Build a quick date -> price map from FULL data to ensure we have all dates
      const priceMap = new Map<string, number>();
      data.forEach((row) => {
        const price = row.adj_close ?? row.close;
        if (price != null) {
          priceMap.set(row.date, price);
        }
      });

      for (const miss of conformalState.coverage.miss_details) {
        const forecastDate = miss.date; // The date when the prediction was made

        // Find the next trading day for realization
        const realizedDate = getNextTradingDateFromSeries(forecastDate, data);
        if (!realizedDate) continue;

        const realizedPriceFromSeries = priceMap.get(realizedDate);
        if (realizedPriceFromSeries == null) continue;

        // Convert from conformal domain to price domain
        const L_price = domainIsLog ? Math.exp(miss.L_base) : miss.L_base;
        const U_price = domainIsLog ? Math.exp(miss.U_base) : miss.U_base;
        const realizedPrice = domainIsLog ? Math.exp(miss.realized) : miss.realized;
        const predPrice = domainIsLog ? Math.exp(miss.y_pred) : miss.y_pred;

        // Get the forecast price for comparison
        const forecastPriceFromSeries = priceMap.get(forecastDate);
        if (forecastPriceFromSeries == null) continue;

        segments.push({
          forecastDate,
          realizedDate,
          L_price,
          U_price,
          realizedPrice,
          forecastPrice: forecastPriceFromSeries,
          predPrice,
        });
      }
    }
    
    return segments;
  }, [conformalState, conformalDomain, data]);

  // Process forecast data and create extended dataset for visualization with persistent GBM layer
  const { chartData, forecastInfo, gbmInfo, windowHighlightData, yDomain } = useMemo(() => {
    let baseChartData = [...filteredData];
    let windowHighlightData = null;

    // Check if the current filtered data includes the latest data point (current price)
    const allData = data; // Full dataset
    const latestDataPoint = allData.length > 0 ? allData[allData.length - 1] : null;
    
    // Determine if we should show forecasts (only if chart includes the latest data point)
    const shouldShowForecasts = latestDataPoint && 
      filteredData.length > 0 && 
      filteredData.some(item => item.date === latestDataPoint.date);

    // Add GBM window highlighting if specified
    if (gbmWindowLength && filteredData.length > 0) {
      const totalDataLength = filteredData.length;
      const windowStartIndex = Math.max(0, totalDataLength - gbmWindowLength);
      
      windowHighlightData = {
        startIndex: windowStartIndex,
        endIndex: totalDataLength - 1,
        windowLength: gbmWindowLength
      };

      // Add window highlighting data to chart data
      baseChartData = baseChartData.map((item, index) => {
        if (index >= windowStartIndex) {
          return {
            ...item,
            window_highlight: item.adj_close || item.close
          } as any;
        }
        return item;
      });
    }
    
    if (filteredData.length === 0) {
      return { chartData: baseChartData, forecastInfo: null, gbmInfo: null, windowHighlightData, yDomain: ['auto', 'auto'] as const };
    }
    
    // Process GBM forecast for persistent green baseline layer
    let gbmInfo = null;
    if (gbmForecast) {
      const isLegacyGbmFormat = 'pi' in gbmForecast;
      let gbmL_h, gbmU_h, gbmBandWidthBp, gbmBasePrice;
      
      if (isLegacyGbmFormat) {
        gbmL_h = gbmForecast.pi?.L1;
        gbmU_h = gbmForecast.pi?.U1;
        gbmBandWidthBp = gbmForecast.pi?.band_width_bp;
        gbmBasePrice = gbmForecast.S_t;
      } else {
        gbmL_h = gbmForecast.L_h || gbmForecast.intervals?.L_h;
        gbmU_h = gbmForecast.U_h || gbmForecast.intervals?.U_h;
        gbmBandWidthBp = gbmForecast.band_width_bp || gbmForecast.intervals?.band_width_bp;
        gbmBasePrice = gbmForecast.S_t || gbmForecast.estimates?.S_t;
      }
      
      if (gbmL_h && gbmU_h && gbmBasePrice) {
        gbmInfo = {
          L_h: gbmL_h,
          U_h: gbmU_h,
          bandWidthBp: gbmBandWidthBp,
          currentPrice: gbmBasePrice,
          method: 'GBM-CC',
          coverage: isLegacyGbmFormat ? 
            (gbmForecast.params?.coverage || 0.95) : 
            (gbmForecast.target?.coverage || gbmForecast.coverage || gbmForecast.params?.coverage || 0.95),
          horizon: isLegacyGbmFormat ? 
            1 : 
            (gbmForecast.target?.h || gbmForecast.h || gbmForecast.params?.h || 1)
        };
      }
    }
    
    // Process active forecast (which could be the same GBM or a different model)
    let forecastInfo = null;
    if (activeForecast) {
      const isLegacyForecastFormat = 'pi' in activeForecast;
      let L_h, U_h, bandWidthBp, basePrice;
      
      if (isLegacyForecastFormat) {
        L_h = activeForecast.pi?.L1;
        U_h = activeForecast.pi?.U1;
        bandWidthBp = activeForecast.pi?.band_width_bp;
        basePrice = activeForecast.S_t;
      } else {
        L_h = activeForecast.L_h || activeForecast.intervals?.L_h;
        U_h = activeForecast.U_h || activeForecast.intervals?.U_h;
        bandWidthBp = activeForecast.band_width_bp || activeForecast.intervals?.band_width_bp;
        basePrice = activeForecast.S_t || activeForecast.estimates?.S_t;
      }
      
      if (L_h && U_h && basePrice) {
        forecastInfo = {
          L_h,
          U_h,
          bandWidthBp,
          currentPrice: basePrice,
          method: isLegacyForecastFormat ? 'GBM-CC' : (activeForecast.method || 'Unknown'),
          coverage: isLegacyForecastFormat ? 
            (activeForecast.params?.coverage || 0.95) : 
            (activeForecast.target?.coverage || activeForecast.coverage || activeForecast.params?.coverage || 0.95),
          horizon: isLegacyForecastFormat ? 
            1 : 
            (activeForecast.target?.h || activeForecast.h || activeForecast.params?.h || 1)
        };
      }
    }
    
    // If we don't have an active forecast, use GBM as the active forecast for display
    if (!forecastInfo && gbmInfo) {
      forecastInfo = gbmInfo;
    }
    
    // Create extended chart data with forecast points
    const finalChartData = [...baseChartData];
    const latestData = filteredData[filteredData.length - 1];
    const latestPrice = latestData.adj_close || latestData.close;
    
    // Add GBM forecast points for persistent green layer
    if (gbmInfo && shouldShowForecasts) {
      const baseDate = new Date(latestData.date);
      
      for (let i = 1; i <= gbmInfo.horizon; i++) {
        const forecastDate = new Date(baseDate);
        forecastDate.setDate(forecastDate.getDate() + i);
        const forecastDateStr = forecastDate.toISOString().split('T')[0];
        
        const existingIndex = finalChartData.findIndex(item => item.date === forecastDateStr);
        if (existingIndex >= 0) {
          // Update existing forecast point
          finalChartData[existingIndex] = {
            ...finalChartData[existingIndex],
            gbm_area_upper: gbmInfo.U_h,
            gbm_area_lower: gbmInfo.L_h,
          } as any;
        } else {
          // Add new forecast point
          finalChartData.push({
            date: forecastDateStr,
            open: null,
            high: gbmInfo.U_h,
            low: gbmInfo.L_h,
            close: null,
            adj_close: null,
            volume: null,
            gbm_area_upper: gbmInfo.U_h,
            gbm_area_lower: gbmInfo.L_h,
            is_forecast: true
          } as any);
        }
      }
      
      // Add GBM connection point at current price for smooth area transition
      const lastHistoricalIndex = filteredData.length - 1;
      if (finalChartData[lastHistoricalIndex]) {
        finalChartData[lastHistoricalIndex] = {
          ...finalChartData[lastHistoricalIndex],
          gbm_area_upper: latestPrice,
          gbm_area_lower: latestPrice
        } as any;
      }
    }
    
    // Add active forecast points (if different from GBM or if there's no GBM)
    if (forecastInfo && shouldShowForecasts) {
      const baseDate = new Date(latestData.date);
      
      for (let i = 1; i <= forecastInfo.horizon; i++) {
        const forecastDate = new Date(baseDate);
        forecastDate.setDate(forecastDate.getDate() + i);
        const forecastDateStr = forecastDate.toISOString().split('T')[0];
        
        const existingIndex = finalChartData.findIndex(item => item.date === forecastDateStr);
        if (existingIndex >= 0) {
          // Update existing forecast point
          finalChartData[existingIndex] = {
            ...finalChartData[existingIndex],
            forecast_upper: forecastInfo.U_h,
            forecast_lower: forecastInfo.L_h,
            forecast_mid: (forecastInfo.U_h + forecastInfo.L_h) / 2,
            forecast_area_upper: forecastInfo.U_h,
            forecast_area_lower: forecastInfo.L_h,
          } as any;
        } else {
          // Add new forecast point
          finalChartData.push({
            date: forecastDateStr,
            open: null,
            high: forecastInfo.U_h,
            low: forecastInfo.L_h,
            close: null,
            adj_close: null,
            volume: null,
            forecast_upper: forecastInfo.U_h,
            forecast_lower: forecastInfo.L_h,
            forecast_mid: (forecastInfo.U_h + forecastInfo.L_h) / 2,
            forecast_area_upper: forecastInfo.U_h,
            forecast_area_lower: forecastInfo.L_h,
            is_forecast: true
          } as any);
        }
      }
      
      // Add active forecast connection point at current price for smooth area transition
      const lastHistoricalIndex = filteredData.length - 1;
      if (finalChartData[lastHistoricalIndex]) {
        finalChartData[lastHistoricalIndex] = {
          ...finalChartData[lastHistoricalIndex],
          forecast_area_upper: latestPrice,
          forecast_area_lower: latestPrice
        } as any;
      }
    }

    // REMOVED: miss-band injection into finalChartData (now using per-miss local series)
    
    // Inject model prediction line into finalChartData, keyed by date
    if (modelLine && modelLine.length > 0) {
      const modelMap = new Map<string, number>(
        modelLine.map((p) => [p.date, p.model_price])
      );

      for (const row of finalChartData) {
        const mp = modelMap.get(row.date);
        if (mp != null) {
          (row as any).model_price = mp;
        }
      }
    }

    // Create band data for forecast areas (difference between upper and lower bounds)
    for (const row of finalChartData) {
      const anyRow = row as any;
      if (anyRow.gbm_area_upper != null && anyRow.gbm_area_lower != null) {
        anyRow.gbm_band = anyRow.gbm_area_upper - anyRow.gbm_area_lower;
      }
      if (anyRow.forecast_area_upper != null && anyRow.forecast_area_lower != null) {
        anyRow.forecast_band = anyRow.forecast_area_upper - anyRow.forecast_area_lower;
      }
    }

    // Log sample chart data for debugging model line alignment
    const modelPointsCount = finalChartData.filter(r => (r as any).model_price != null).length;
    console.log(`[CHART DEBUG] Model line: ${modelPointsCount} points out of ${finalChartData.length} total chart points`);
    console.log('chartData sample (last 10 with model line):', finalChartData.slice(-10).map(r => ({
      date: r.date,
      price: (r as any).adj_close ?? (r as any).close,
      model_price: (r as any).model_price,
    })));

    // Compute dynamic Y domain - ALWAYS anchor to actual prices first
    const buildChartResult = (domain: [number, number] | ['auto', 'auto']) => ({
      chartData: finalChartData,
      forecastInfo: shouldShowForecasts ? forecastInfo : null,
      gbmInfo: shouldShowForecasts ? gbmInfo : null,
      windowHighlightData,
      yDomain: domain
    });

    // 1. Base min/max from actual prices ONLY (filteredData)
    let baseMin = Infinity;
    let baseMax = -Infinity;

    for (const row of filteredData) {
      const price =
        typeof row.adj_close === 'number'
          ? row.adj_close
          : typeof row.close === 'number'
            ? row.close
            : null;

      if (typeof price === 'number' && Number.isFinite(price)) {
        if (price < baseMin) baseMin = price;
        if (price > baseMax) baseMax = price;
      }
    }

    if (!Number.isFinite(baseMin) || !Number.isFinite(baseMax)) {
      console.debug('[Y-DOMAIN] no finite price data; using auto domain');
      return buildChartResult(['auto', 'auto'] as const);
    }

    // 2. Extend min/max to include cones + model line
    let minY = baseMin;
    let maxY = baseMax;

    for (const row of finalChartData) {
      const rowAny = row as any;
      const candidates: number[] = [];

      if (typeof rowAny.gbm_area_lower === 'number') candidates.push(rowAny.gbm_area_lower);
      if (typeof rowAny.gbm_area_upper === 'number') candidates.push(rowAny.gbm_area_upper);
      if (typeof rowAny.forecast_area_lower === 'number') candidates.push(rowAny.forecast_area_lower);
      if (typeof rowAny.forecast_area_upper === 'number') candidates.push(rowAny.forecast_area_upper);
      if (typeof rowAny.model_price === 'number') candidates.push(rowAny.model_price);

      for (const value of candidates) {
        if (!Number.isFinite(value)) continue;
        if (value < minY) minY = value;
        if (value > maxY) maxY = value;
      }
    }

    const padding = Math.max((maxY - minY) * 0.05, 1);
    const domainMin = minY - padding;
    const domainMax = maxY + padding;

    console.debug(
      '[Y-DOMAIN] base price range:',
      baseMin,
      baseMax,
      '-> extended:',
      minY,
      maxY,
      '-> domain:',
      domainMin,
      domainMax
    );
    
    return buildChartResult([domainMin, domainMax] as const);
  }, [activeForecast, gbmForecast, filteredData, gbmWindowLength, data, modelLine]);

  // Guard for miss details using the computed missSegments
  const hasMissDetails = missSegments && missSegments.length > 0;

  // Format price for display
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(price);
  };

  // Format date for tooltip in TradingView style
  const formatTooltipDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const day = date.getDate();
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const year = date.getFullYear().toString().slice(-2); // Last 2 digits
    
    return `${day} ${month} '${year}`;
  };

  // Custom tooltip with TradingView style - now model-aware and miss-band aware
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    
    const data = payload[0].payload;
    
    // Check if current date falls within any miss band period
    const currentMissBand = hasMissDetails ? missSegments.find(seg => 
      label >= seg.forecastDate && label <= seg.realizedDate
    ) : null;
    
    // If we're in a miss band period, show miss band tooltip
    if (currentMissBand) {
      return (
        <div className={`p-3 rounded-lg shadow-xl border-2 ${
          isDarkMode 
            ? 'bg-red-900 border-red-600' 
            : 'bg-red-50 border-red-300'
        }`}>
          <p className={`text-sm mb-2 font-semibold ${
            isDarkMode ? 'text-red-200' : 'text-red-800'
          }`}>
            ⚠️ Prediction Miss • {formatTooltipDate(label)}
          </p>
          
          <div className="space-y-1 text-sm">
            <div className={`text-xs font-medium mb-2 ${
              isDarkMode ? 'text-red-100' : 'text-red-900'
            }`}>
              Miss Band ({formatTooltipDate(currentMissBand.forecastDate)} → {formatTooltipDate(currentMissBand.realizedDate)})
            </div>
            
            <div className={`flex items-center gap-2 ${
              isDarkMode ? 'text-red-100' : 'text-red-900'
            }`}>
              <span className="font-mono text-xs">Upper</span>
              <span className="font-medium">{formatPrice(currentMissBand.U_price)}</span>
            </div>
            <div className={`flex items-center gap-2 ${
              isDarkMode ? 'text-red-100' : 'text-red-900'
            }`}>
              <span className="font-mono text-xs">Mean</span>
              <span className="font-medium">{formatPrice((currentMissBand.U_price + currentMissBand.L_price) / 2)}</span>
            </div>
            <div className={`flex items-center gap-2 ${
              isDarkMode ? 'text-red-100' : 'text-red-900'
            }`}>
              <span className="font-mono text-xs">Lower</span>
              <span className="font-medium">{formatPrice(currentMissBand.L_price)}</span>
            </div>
            
            <div className={`border-t pt-2 mt-2 text-xs space-y-1 ${
              isDarkMode 
                ? 'border-red-700 text-red-200' 
                : 'border-red-200 text-red-700'
            }`}>
              <div>Predicted: {formatPrice(currentMissBand.predPrice)}</div>
              <div>Realized: {formatPrice(currentMissBand.realizedPrice)}</div>
            </div>
            
            <div className={`text-xs mt-2 italic ${
              isDarkMode ? 'text-red-300' : 'text-red-600'
            }`}>
              Click to zoom into this miss period
            </div>
          </div>
        </div>
      );
    }
    
    // Find current data point index to compare with previous day
    const currentIndex = filteredData.findIndex(item => item.date === label);
    let tooltipColor = 'text-white'; // default color
    
    if (currentIndex > 0) {
      // Compare current closing price with previous day's closing price
      const currentClose = data.adj_close || data.close;
      const previousClose = filteredData[currentIndex - 1].adj_close || filteredData[currentIndex - 1].close;
      
      if (currentClose > previousClose) {
        tooltipColor = 'text-green-400'; // Higher than previous day
      } else if (currentClose < previousClose) {
        tooltipColor = 'text-red-400'; // Lower than previous day
      }
      // If equal, keep default white color
    }
    
    // Check if this is in the forecast area
    const isForecastArea = (forecastInfo || gbmInfo) && new Date(label) > new Date(filteredData[filteredData.length - 1].date);
    
    // Determine which model info to show based on selection and availability
    let displayInfo = null;
    let displayColor = 'text-green-400';
    let displayName = '';
    
    if (isForecastArea) {
      if (selectedModel === 'gbm' && gbmInfo) {
        displayInfo = gbmInfo;
        displayColor = 'text-green-400';
        displayName = 'GBM';
      } else if (selectedModel === 'active' && forecastInfo) {
        displayInfo = forecastInfo;
        displayColor = 'text-blue-400';
        displayName = forecastInfo.method || 'Active Model';
      } else if (selectedModel === 'auto') {
        // Auto mode: show the most relevant model
        if (forecastInfo && (!gbmInfo || !areForeccastsSame(forecastInfo, gbmInfo))) {
          // Show active forecast if it's different from GBM
          displayInfo = forecastInfo;
          displayColor = 'text-blue-400';
          displayName = forecastInfo.method || 'Active Model';
        } else if (gbmInfo) {
          // Show GBM if active is same or not available
          displayInfo = gbmInfo;
          displayColor = 'text-green-400';
          displayName = 'GBM';
        }
      }
    }
    
    return (
      <div className={`p-3 rounded-lg shadow-xl border ${
        isDarkMode 
          ? 'bg-gray-800 border-gray-600' 
          : 'bg-white border-gray-300'
      }`}>
        <p className={`text-sm mb-2 ${
          isDarkMode 
            ? (tooltipColor === 'text-white' ? 'text-gray-200' : tooltipColor === 'text-green-400' ? 'text-green-300' : tooltipColor === 'text-red-400' ? 'text-red-300' : 'text-gray-200')
            : (tooltipColor === 'text-white' ? 'text-gray-900' : tooltipColor === 'text-green-400' ? 'text-green-600' : tooltipColor === 'text-red-400' ? 'text-red-600' : 'text-gray-900')
        }`}>
          {formatTooltipDate(label)}
          {isForecastArea && <span className={`ml-2 text-xs ${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>[FORECAST]</span>}
        </p>
        
        {isForecastArea && displayInfo ? (
          <div className="space-y-1 text-sm">
            <div className={`text-xs font-medium mb-1 ${
              isDarkMode ? 'text-gray-200' : 'text-gray-900'
            }`}>
              <span>{displayName} • {(displayInfo.coverage * 100).toFixed(1)}% PI</span>
            </div>
            <div className={`flex items-center gap-2 ${
              isDarkMode ? 'text-gray-200' : 'text-gray-900'
            }`}>
              <span className="font-mono text-xs">U</span>
              <span className="font-medium">{formatPrice(displayInfo.U_h)}</span>
            </div>
            <div className={`flex items-center gap-2 ${
              isDarkMode ? 'text-gray-200' : 'text-gray-900'
            }`}>
              <span className="font-mono text-xs">M</span>
              <span className="font-medium">{formatPrice((displayInfo.U_h + displayInfo.L_h) / 2)}</span>
            </div>
            <div className={`flex items-center gap-2 ${
              isDarkMode ? 'text-gray-200' : 'text-gray-900'
            }`}>
              <span className="font-mono text-xs">L</span>
              <span className="font-medium">{formatPrice(displayInfo.L_h)}</span>
            </div>
            <div className={`text-xs mt-1 ${
              isDarkMode ? 'text-gray-300' : 'text-gray-700'
            }`}>
              Band: {Math.round(displayInfo.bandWidthBp)} bp
            </div>
            {displayInfo.method && displayInfo.method !== displayName && (
              <div className={`text-xs ${
                isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
                Method: {displayInfo.method}
              </div>
            )}
          </div>
        ) : (
          <div className={`space-y-1 text-sm ${
            isDarkMode 
              ? (tooltipColor === 'text-white' ? 'text-gray-200' : tooltipColor === 'text-green-400' ? 'text-green-300' : tooltipColor === 'text-red-400' ? 'text-red-300' : 'text-gray-200')
              : (tooltipColor === 'text-white' ? 'text-gray-900' : tooltipColor === 'text-green-400' ? 'text-green-600' : tooltipColor === 'text-red-400' ? 'text-red-600' : 'text-gray-900')
          }`}>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">O</span>
              <span className="font-medium">{formatPrice(data.open)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">H</span>
              <span className="font-medium">{formatPrice(data.high)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">L</span>
              <span className="font-medium">{formatPrice(data.low)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">C</span>
              <span className="font-medium">{formatPrice(data.adj_close || data.close)}</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className={`rounded-lg border shadow-sm ${className} ${
        isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
      }`}>
        <div className="p-6">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className={`animate-spin rounded-full h-8 w-8 border-b-2 mx-auto mb-2 ${
                isDarkMode ? 'border-blue-400' : 'border-blue-600'
              }`}></div>
              <p className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Loading chart data...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-lg border shadow-sm ${className} ${
        isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
      }`}>
        <div className="p-6">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className={`text-lg mb-2 ${
                isDarkMode ? 'text-red-400' : 'text-red-500'
              }`}>⚠️</div>
              <p className={`font-medium ${
                isDarkMode ? 'text-red-400' : 'text-red-600'
              }`}>Chart Error</p>
              <p className={`text-sm mt-1 ${
                isDarkMode ? 'text-gray-400' : 'text-gray-600'
              }`}>{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const chartColor = isDarkMode ? '#60a5fa' : '#3b82f6'; // lighter blue for dark mode

  return (
    <div className={`${theme.background} rounded-lg ${theme.border} border shadow-sm ${className}`}>
      {/* Header */}
      <div className={`p-4 ${theme.border} border-b`}>
        <div className="flex justify-between items-start">
          <div>
            <h3 className={`text-lg font-semibold ${theme.text.primary}`}>{symbol}</h3>
            {performance && (
              <div className="flex items-center gap-3 mt-1">
                <span className={`text-2xl font-bold ${theme.text.primary}`}>
                  {formatPrice(performance.lastPrice)}
                </span>
                <div className={`flex items-center gap-1 text-sm font-medium ${
                  performance.change >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  <span>
                    {performance.change >= 0 ? '+' : ''}
                    {formatPrice(Math.abs(performance.change))}
                  </span>
                  <span>
                    ({performance.change >= 0 ? '+' : ''}
                    {performance.changePercent.toFixed(2)}%)
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="p-4">
        {/* Zoom Controls */}
        {forecastInfo && (
          <div className="mb-3 flex items-center gap-2">
            <span className={`text-xs ${theme.text.secondary} font-medium`}>Zoom:</span>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  setZoomLevel(Math.max(0.5, zoomLevel - 0.5));
                  setFocusDateRange(null); // Clear focus when using zoom buttons
                }}
                disabled={zoomLevel <= 0.5}
                className={`w-8 h-8 flex items-center justify-center text-sm font-bold rounded border ${theme.button.primary} disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
                title="Zoom Out"
              >
                −
              </button>
              <button
                onClick={() => {
                  setZoomLevel(Math.min(10, zoomLevel + 0.5));
                  setFocusDateRange(null); // Clear focus when using zoom buttons
                }}
                disabled={zoomLevel >= 10}
                className={`w-8 h-8 flex items-center justify-center text-sm font-bold rounded border ${theme.button.primary} disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
                title="Zoom In"
              >
                +
              </button>
            </div>
            <span className={`text-xs ${theme.text.muted}`}>
              {zoomLevel}x
            </span>
          </div>
        )}
        
        <div 
          style={{ width: '100%', height: '400px' }} 
          className="[&_*]:outline-none [&_*]:focus:outline-none [&_.recharts-wrapper]:outline-none [&_.recharts-surface]:outline-none [&_.recharts-surface]:focus:outline-none"
          onFocus={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
        >
          <ResponsiveContainer>
            <ComposedChart 
              data={chartData} 
              margin={{ top: 5, right: 5, left: 20, bottom: 5 }}
              style={{ outline: 'none' }}
            >
              <defs>
                {/* Enhanced gradients for conformal miss bands - unique for each segment */}
                {missSegments.map((seg, index) => (
                  <linearGradient 
                    key={`missGradient-${index}`}
                    id={`missConeFill-${index}`} 
                    x1="0" y1="0" x2="1" y2="1"
                  >
                    <stop offset="0%" stopColor="#fef2f2" stopOpacity="0.85" />
                    <stop offset="20%" stopColor="#fecaca" stopOpacity="0.75" />
                    <stop offset="40%" stopColor="#f87171" stopOpacity="0.65" />
                    <stop offset="60%" stopColor="#ef4444" stopOpacity="0.55" />
                    <stop offset="80%" stopColor="#dc2626" stopOpacity="0.65" />
                    <stop offset="100%" stopColor="#b91c1c" stopOpacity="0.75" />
                  </linearGradient>
                ))}
                
                {/* Green gradients for upward price movement */}
                {missSegments.map((seg, index) => (
                  <linearGradient 
                    key={`greenGradient-${index}`}
                    id={`upMoveFill-${index}`} 
                    x1="0" y1="0" x2="1" y2="1"
                  >
                    <stop offset="0%" stopColor="#f0fdf4" stopOpacity="0.8" />
                    <stop offset="30%" stopColor="#bbf7d0" stopOpacity="0.7" />
                    <stop offset="60%" stopColor="#4ade80" stopOpacity="0.6" />
                    <stop offset="100%" stopColor="#22c55e" stopOpacity="0.7" />
                  </linearGradient>
                ))}
                
                {/* Red gradients for downward price movement */}
                {missSegments.map((seg, index) => (
                  <linearGradient 
                    key={`redGradient-${index}`}
                    id={`downMoveFill-${index}`} 
                    x1="0" y1="0" x2="1" y2="1"
                  >
                    <stop offset="0%" stopColor="#fef2f2" stopOpacity="0.8" />
                    <stop offset="30%" stopColor="#fecaca" stopOpacity="0.7" />
                    <stop offset="60%" stopColor="#f87171" stopOpacity="0.6" />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity="0.7" />
                  </linearGradient>
                ))}
                
                {/* Yellow gradients for miss distance areas - unique for each segment */}
                {missSegments.map((seg, index) => (
                  <linearGradient 
                    key={`yellowGradient-${index}`}
                    id={`missDistanceFill-${index}`} 
                    x1="0" y1="0" x2="1" y2="1"
                  >
                    <stop offset="0%" stopColor="#fbbf24" stopOpacity="1" />
                    <stop offset="30%" stopColor="#f59e0b" stopOpacity="1" />
                    <stop offset="60%" stopColor="#d97706" stopOpacity="1" />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity="1" />
                  </linearGradient>
                ))}
                
                {/* Professional edge gradient for miss outline */}
                <linearGradient id="missStroke" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#dc2626" stopOpacity="0.7" />
                  <stop offset="50%" stopColor="#b91c1c" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#dc2626" stopOpacity="0.7" />
                </linearGradient>
                {windowHighlightData && (
                  <>
                    <linearGradient id="windowHighlight" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.1} />
                    </linearGradient>
                  </>
                )}
              </defs>
              
              {/* Miss indicators with proper gradient bands */}
              {hasMissDetails &&
                missSegments.map((seg, index) => {
                  const meanPrice = (seg.U_price + seg.L_price) / 2;
                  
                  return (
                    <Fragment key={`miss-${index}-${seg.forecastDate}-${seg.realizedDate}`}>
                      {/* Yellow triangular area from mean to upper bound - bounded by diagonal line */}
                      <ReferenceArea
                        x1={seg.forecastDate}
                        x2={seg.realizedDate}
                        y1={meanPrice}
                        y2={seg.U_price}
                        fill="#f59e0b"
                        stroke="none"
                        style={{ 
                          clipPath: `polygon(100% 0%, 0% 100%, 100% 100%)`,
                          cursor: 'pointer' 
                        }}
                        onClick={(e) => handleMissBandClick(seg, e)}
                      />
                      
                      {/* Yellow triangular area from mean to lower bound - bounded by diagonal line */}
                      <ReferenceArea
                        x1={seg.forecastDate}
                        x2={seg.realizedDate}
                        y1={seg.L_price}
                        y2={meanPrice}
                        fill="#f59e0b"
                        stroke="none"
                        style={{ 
                          clipPath: `polygon(100% 100%, 0% 0%, 100% 0%)`,
                          cursor: 'pointer' 
                        }}
                        onClick={(e) => handleMissBandClick(seg, e)}
                      />
                      
                      {/* Conditional triangular area from mean to actual closing price - green if up, red if down */}
                      <ReferenceArea
                        x1={seg.forecastDate}
                        x2={seg.realizedDate}
                        y1={meanPrice}
                        y2={seg.realizedPrice}
                        fill={seg.realizedPrice > meanPrice ? `url(#upMoveFill-${index})` : `url(#downMoveFill-${index})`}
                        stroke="none"
                        style={{ 
                          clipPath: seg.realizedPrice > meanPrice 
                            ? `polygon(100% 0%, 0% 100%, 100% 100%)` 
                            : `polygon(100% 100%, 0% 0%, 100% 0%)`,
                          cursor: 'pointer' 
                        }}
                        onClick={(e) => handleMissBandClick(seg, e)}
                      />
                      
                      {/* Mean line within the band */}
                      <ReferenceLine
                        segment={[
                          { x: seg.forecastDate, y: meanPrice },
                          { x: seg.realizedDate, y: meanPrice }
                        ]}
                        stroke="#f59e0b"
                        strokeWidth={1.5}
                        strokeOpacity={0.8}
                      />
                      
                      {/* Diagonal yellow line from mean at forecast to upper bound at realization */}
                      <ReferenceLine
                        segment={[
                          { x: seg.forecastDate, y: meanPrice },
                          { x: seg.realizedDate, y: seg.U_price }
                        ]}
                        stroke="#f59e0b"
                        strokeWidth={1.5}
                        strokeOpacity={0.8}
                      />
                      
                      {/* Diagonal yellow line from mean at forecast to lower bound at realization */}
                      <ReferenceLine
                        segment={[
                          { x: seg.forecastDate, y: meanPrice },
                          { x: seg.realizedDate, y: seg.L_price }
                        ]}
                        stroke="#f59e0b"
                        strokeWidth={1.5}
                        strokeOpacity={0.8}
                      />
                      
                      {/* Conditional diagonal line from mean to actual closing price - green if up, red if down */}
                      <ReferenceLine
                        segment={[
                          { x: seg.forecastDate, y: meanPrice },
                          { x: seg.realizedDate, y: seg.realizedPrice }
                        ]}
                        stroke={seg.realizedPrice > meanPrice ? "#22c55e" : "#ef4444"}
                        strokeWidth={2}
                        strokeOpacity={0.9}
                      />
                      
                      {/* Clickable prediction dot */}
                      <ReferenceDot
                        x={seg.forecastDate}
                        y={seg.predPrice}
                        r={3}
                        fill="#dc2626"
                        fillOpacity={1}
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => handleMissBandClick(seg, e)}
                      />
                      
                      {/* Clickable realized price dot */}
                      <ReferenceDot
                        x={seg.realizedDate}
                        y={seg.realizedPrice}
                        r={3}
                        fill="#b91c1c"
                        fillOpacity={1}
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => handleMissBandClick(seg, e)}
                      />
                    </Fragment>
                  );
                })}
              
              <CartesianGrid strokeDasharray="3 3" stroke={theme.chart.grid} />
              
              <XAxis 
                dataKey="date"
                tick={{ fontSize: 12, fill: theme.chart.axis }}
                axisLine={{ stroke: isDarkMode ? '#4b5563' : '#e2e8f0' }}
                tickLine={{ stroke: isDarkMode ? '#4b5563' : '#e2e8f0' }}
                tickFormatter={(value: any, index: number) => {
                  const date = new Date(value);
                  const day = date.getDate();
                  const month = date.toLocaleDateString('en-US', { month: 'short' });
                  const currentMonth = date.getMonth();
                  const currentYear = date.getFullYear();
                  
                  // Check if this is a new month
                  const monthYearKey = currentYear * 12 + currentMonth;
                  
                  if (index === 0 || lastShownMonthRef.current !== monthYearKey) {
                    // New month or first tick - show month name and update tracker
                    lastShownMonthRef.current = monthYearKey;
                    return month;
                  } else {
                    // Same month - show day number
                    return day.toString();
                  }
                }}
              />
              <YAxis
                type="number"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tickFormatter={(value) => `$${value.toFixed(0)}`}
                domain={yDomain ?? ['auto', 'auto']}
              />
              <Tooltip 
                content={<CustomTooltip />} 
                animationDuration={0}
                isAnimationActive={false}
                cursor={{ 
                  stroke: chartColor, 
                  strokeWidth: 1, 
                  strokeDasharray: '3 3',
                  strokeOpacity: 0.8
                }}
                allowEscapeViewBox={{ x: false, y: false }}
                offset={10}
                filterNull={false}
                key={selectedModel}  // Force re-render when selectedModel changes
              />
              
              {/* GBM Window highlight area */}
              {windowHighlightData && (
                <Area
                  type="monotone"
                  dataKey="window_highlight"
                  stroke="none"
                  fill="url(#windowHighlight)"
                  fillOpacity={1}
                  connectNulls={false}
                  dot={false}
                />
              )}

              {/* Green GBM baseline cone - render first as base layer */}
              {gbmInfo && (
                <>
                  {/* GBM lower bound baseline (invisible) */}
                  <Area
                    type="monotone"
                    dataKey="gbm_area_lower"
                    stroke="none"
                    fill="transparent"
                    connectNulls={false}
                    dot={false}
                    stackId="gbmStack"
                  />
                  {/* GBM band area (stacked on top of lower bound) */}
                  <Area
                    type="monotone"
                    dataKey="gbm_band"
                    stroke="none"
                    fill="#10b981"
                    fillOpacity={forecastInfo && !areForeccastsSame(forecastInfo, gbmInfo) ? 0.3 : 0.4}
                    connectNulls={false}
                    dot={false}
                    stackId="gbmStack"
                  />
                  {/* GBM Upper bound line */}
                  <Line
                    type="monotone"
                    dataKey="gbm_area_upper"
                    stroke="#10b981"
                    strokeWidth={2}
                    strokeOpacity={0.8}
                    fill="none"
                    dot={false}
                    connectNulls={false}
                    onClick={() => setSelectedModel('gbm')}
                    style={{ cursor: 'pointer' }}
                  />
                  {/* GBM Lower bound line */}
                  <Line
                    type="monotone"
                    dataKey="gbm_area_lower"
                    stroke="#10b981"
                    strokeWidth={2}
                    strokeOpacity={0.8}
                    fill="none"
                    dot={false}
                    connectNulls={false}
                    onClick={() => setSelectedModel('gbm')}
                    style={{ cursor: 'pointer' }}
                  />
                </>
              )}

              {/* Active forecast cone - render on top of GBM */}
              {forecastInfo && (!gbmInfo || !areForeccastsSame(forecastInfo, gbmInfo)) && (
                <>
                  {/* Forecast lower bound baseline (invisible) */}
                  <Area
                    type="monotone"
                    dataKey="forecast_area_lower"
                    stroke="none"
                    fill="transparent"
                    connectNulls={false}
                    dot={false}
                    stackId="forecastStack"
                  />
                  {/* Forecast band area (stacked on top of lower bound) */}
                  <Area
                    type="monotone"
                    dataKey="forecast_band"
                    stroke="none"
                    fill="#3b82f6"
                    fillOpacity={0.3}
                    connectNulls={false}
                    dot={false}
                    stackId="forecastStack"
                  />
                  {/* Active forecast Upper bound line */}
                  <Line
                    type="monotone"
                    dataKey="forecast_area_upper"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    strokeOpacity={0.8}
                    fill="none"
                    dot={false}
                    connectNulls={false}
                    onClick={() => setSelectedModel('active')}
                    style={{ cursor: 'pointer' }}
                  />
                  {/* Active forecast Lower bound line */}
                  <Line
                    type="monotone"
                    dataKey="forecast_area_lower"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    strokeOpacity={0.8}
                    fill="none"
                    dot={false}
                    connectNulls={false}
                    onClick={() => setSelectedModel('active')}
                    style={{ cursor: 'pointer' }}
                  />
                </>
              )}

              {/* REMOVED: Global miss wedges (now using per-miss local series) */}
              
              {/* Historical price line */}
              <Line 
                type="monotone" 
                dataKey="adj_close" 
                stroke={chartColor}
                strokeWidth={2}
                dot={false}
                activeDot={{ 
                  r: 5, 
                  fill: chartColor, 
                  stroke: '#fff', 
                  strokeWidth: 2,
                  style: { cursor: 'pointer' }
                }}
                connectNulls={false}
              />
              
              {/* Model prediction line */}
              {chartData.some((row: any) => row.model_price != null) && (
                <Line
                  type="monotone"
                  dataKey="model_price"
                  stroke="#fb923c"        // orange
                  strokeWidth={2}
                  strokeDasharray="5 4"   // dashed to differentiate from actual
                  dot={false}
                  isAnimationActive={false}
                  name="Model prediction"
                />
              )}
              
              {/* Active forecast dots - show green if it's same as GBM, purple if different */}
              {forecastInfo && (
                <>
                  <Line
                    type="monotone"
                    dataKey="forecast_upper"
                    stroke={gbmInfo && areForeccastsSame(forecastInfo, gbmInfo) ? '#10b981' : '#8b5cf6'}
                    strokeWidth={0}
                    dot={{ 
                      r: 3, 
                      fill: gbmInfo && areForeccastsSame(forecastInfo, gbmInfo) ? '#10b981' : '#8b5cf6', 
                      fillOpacity: 1, 
                      stroke: '#ffffff', 
                      strokeWidth: 1 
                    }}
                    activeDot={false}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="forecast_lower"
                    stroke={gbmInfo && areForeccastsSame(forecastInfo, gbmInfo) ? '#10b981' : '#8b5cf6'}
                    strokeWidth={0}
                    dot={{ 
                      r: 3, 
                      fill: gbmInfo && areForeccastsSame(forecastInfo, gbmInfo) ? '#10b981' : '#8b5cf6', 
                      fillOpacity: 1, 
                      stroke: '#ffffff', 
                      strokeWidth: 1 
                    }}
                    activeDot={false}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="forecast_mid"
                    stroke={gbmInfo && areForeccastsSame(forecastInfo, gbmInfo) ? '#10b981' : '#8b5cf6'}
                    strokeWidth={0}
                    dot={{ 
                      r: 3, 
                      fill: gbmInfo && areForeccastsSame(forecastInfo, gbmInfo) ? '#10b981' : '#8b5cf6', 
                      fillOpacity: 1, 
                      stroke: '#ffffff', 
                      strokeWidth: 1 
                    }}
                    activeDot={false}
                    connectNulls={false}
                  />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Performance summary */}
      <div className="px-4 pb-4">
        {performance && (
          <div className="mt-3 pt-3 border-t">
            <div className="grid grid-cols-7 gap-2">
              {timeRanges.map((range) => {
                let rangeData;
                
                // Get the latest date in the data to calculate ranges relative to data, not current date
                const latestDataDate = data.length > 0 ? data[data.length - 1].date : new Date().toISOString().split('T')[0];
                
                if (range.key === 'ytd') {
                  // Year to date calculation based on latest data year
                  const latestDate = new Date(latestDataDate);
                  const currentYear = latestDate.getFullYear();
                  rangeData = data.filter(row => row.date >= `${currentYear}-01-01`);
                } else if (range.days) {
                  // Days-based calculation relative to latest data date
                  const cutoff = new Date(latestDataDate);
                  cutoff.setDate(cutoff.getDate() - range.days);
                  rangeData = data.filter(row => row.date >= cutoff.toISOString().split('T')[0]);
                } else {
                  // All data
                  rangeData = data;
                }
                
                if (rangeData.length < 2) return null;
                
                const first = rangeData[0].adj_close || rangeData[0].close;
                const last = rangeData[rangeData.length - 1].adj_close || rangeData[rangeData.length - 1].close;
                const pct = ((last - first) / first) * 100;
                const isSelected = selectedRange === range.key;
                
                return (
                  <button
                    key={range.key}
                    onClick={() => {
                      setSelectedRange(range.key);
                      setFocusDateRange(null); // Clear focus when changing time range
                    }}
                    className={`text-center p-2 rounded transition-colors text-xs border ${
                      isSelected 
                        ? theme.button.selected
                        : `border-transparent ${isDarkMode ? 'hover:bg-gray-800 text-gray-300' : 'hover:bg-gray-50 text-gray-700'}`
                    }`}
                  >
                    <div className={`font-medium ${isSelected ? theme.button.selectedHover : theme.text.secondary}`}>
                      {range.label}
                    </div>
                    <div className={`font-semibold mt-1 ${
                      pct >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Final Prediction Intervals */}
        {(activeForecast ?? gbmForecast) && (
          <div className="mt-4 pt-4 border-t">
            {(() => {
              // Prefer active forecast, fallback to GBM forecast
              const f = activeForecast ?? gbmForecast;
              const isLegacyGbmForecast = 'pi' in f;
              const method = f?.method ?? (isLegacyGbmForecast ? 'GBM-CC' : 'Unknown');
              const critType = f?.critical?.type ?? f?.estimates?.critical_type ?? 'normal';
              const critVal = (f?.critical?.value ?? f?.estimates?.critical_value ?? f?.estimates?.z_alpha ?? f?.z_alpha) ?? null;
              const df = f?.critical?.df ?? f?.estimates?.volatility_diagnostics?.nu;
              const windowN = f?.window_period?.n_obs ?? f?.params?.window ?? f?.estimates?.n ?? 'N/A';
              
              return (
                <>
                  {/* Header Row - Title and Method Chip */}
                  <div className="flex items-center gap-3 mb-4">
                    <h3 className={`text-lg font-semibold ${theme.text.primary}`}>Final Prediction Intervals</h3>
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm ${isDarkMode ? 'bg-green-900 text-green-300' : 'bg-green-100 text-green-800'}`}>
                      🔒 {method}
                    </span>
                  </div>

                  {/* PI Values */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-gray-50'} p-3 rounded`}>
                      <div className={`text-sm ${theme.text.secondary}`}>L₁ (Lower)</div>
                      <div className={`text-lg font-mono ${theme.text.primary}`}>${
                        isLegacyGbmForecast 
                          ? f.pi.L1.toFixed(2)
                          : (f.L_h || f.intervals?.L_h || 0).toFixed(2)
                      }</div>
                    </div>
                    <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-gray-50'} p-3 rounded`}>
                      <div className={`text-sm ${theme.text.secondary}`}>U₁ (Upper)</div>
                      <div className={`text-lg font-mono ${theme.text.primary}`}>${
                        isLegacyGbmForecast 
                          ? f.pi.U1.toFixed(2)
                          : (f.U_h || f.intervals?.U_h || 0).toFixed(2)
                      }</div>
                    </div>
                    <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-gray-50'} p-3 rounded`}>
                      <div className={`text-sm ${theme.text.secondary}`}>Band Width</div>
                      <div className={`text-lg font-mono ${theme.text.primary}`}>{
                        isLegacyGbmForecast 
                          ? f.pi.band_width_bp.toFixed(0)
                          : (f.band_width_bp || f.intervals?.band_width_bp || 0).toFixed(0)
                      } bp</div>
                    </div>
                    <div className={`${isDarkMode ? 'bg-gray-800' : 'bg-gray-50'} p-3 rounded`}>
                      <div className={`text-sm ${theme.text.secondary}`}>
                        Critical {critType === 't' ? `t(${df ?? 'df'})` : 'z_α'}
                      </div>
                      <div className={`text-lg font-mono ${theme.text.primary}`}>
                        {critVal != null ? Number(critVal).toFixed(3) : 'N/A'}
                      </div>
                    </div>
                  </div>

                  {/* Forecast Parameters & Diagnostics - Two Column Layout */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                    {/* Forecast Parameters */}
                    <div className={`p-3 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-50'} rounded-lg`}>
                      <h4 className={`font-semibold ${theme.text.primary} mb-2 text-sm`}>Forecast Parameters</h4>
                      <div className="grid grid-cols-1 gap-3 text-sm">
                        <div className="flex justify-between">
                          <span className={theme.text.secondary}>Coverage:</span>
                          <span className={`font-mono ${theme.text.primary}`}>{
                            isLegacyGbmForecast
                              ? ((f.coverage || f.params?.coverage || 0.95) * 100).toFixed(1)
                              : ((f.coverage || f.params?.coverage || f.target?.coverage || 0) * 100).toFixed(1)
                          }%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className={theme.text.secondary}>Horizon:</span>
                          <span className={`font-mono ${theme.text.primary}`}>{
                            isLegacyGbmForecast ? '1D' : (f.h || f.params?.h || f.target?.h || 1) + 'D'
                          }</span>
                        </div>
                        <div className="flex justify-between">
                          <span className={theme.text.secondary}>As-of Date:</span>
                          <span className={`font-mono ${theme.text.primary}`}>{f.date_t}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className={theme.text.secondary}>Window:</span>
                          <span className={`font-mono ${theme.text.primary}`}>{windowN} days</span>
                        </div>
                        <div className="flex justify-between">
                          <span className={theme.text.secondary}>Drift Shrinkage:</span>
                          <span className={`font-mono ${theme.text.primary}`}>λ = {
                            isLegacyGbmForecast 
                              ? (f.lambdaDrift || f.params?.lambdaDrift || 0).toFixed(3)
                              : (f.lambda_drift || f.params?.lambda_drift || 0).toFixed(3)
                          }</span>
                        </div>
                      </div>
                    </div>

                    {/* MLE Estimates - Only for GBM forecasts */}
                    {isLegacyGbmForecast && f.estimates && (
                      <div className={`p-3 ${isDarkMode ? 'bg-blue-900' : 'bg-blue-50'} rounded-lg`}>
                        <h4 className={`font-semibold ${isDarkMode ? 'text-blue-300' : 'text-blue-800'} mb-2 text-sm`}>MLE Estimates</h4>
                        <div className="grid grid-cols-1 gap-3 text-sm">
                          <div className="flex justify-between">
                            <span className={theme.text.secondary}>μ* (drift):</span>
                            <span className={`font-mono ${theme.text.primary}`}>{((f.estimates.mu_star_hat || 0) * 10000).toFixed(2)} bp/day</span>
                          </div>
                          <div className="flex justify-between">
                            <span className={theme.text.secondary}>σ (volatility):</span>
                            <span className={`font-mono ${theme.text.primary}`}>{((f.estimates.sigma_hat || 0) * 100).toFixed(2)}%</span>
                          </div>
                          <div className="flex justify-between">
                            <span className={theme.text.secondary}>μ* used:</span>
                            <span className={`font-mono ${theme.text.primary}`}>{((f.estimates.mu_star_used || 0) * 10000).toFixed(2)} bp/day</span>
                          </div>
                          <div className="flex justify-between">
                            <span className={theme.text.secondary}>Critical z_α:</span>
                            <span className={`font-mono ${theme.text.primary}`}>{(f.estimates.z_alpha || 0).toFixed(3)}</span>
                          </div>
                        </div>
                        <p className={`text-xs ${isDarkMode ? 'text-blue-400' : 'text-blue-600'} mt-2 font-medium`}>MLE with denominator N (no Bessel correction)</p>
                      </div>
                    )}

                    {/* Diagnostics - Show for all volatility models */}
                    {!isLegacyGbmForecast && f.estimates?.volatility_diagnostics && (
                      <div className={`p-3 ${isDarkMode ? 'bg-yellow-900' : 'bg-yellow-50'} rounded-lg`}>
                        <h4 className={`font-semibold ${isDarkMode ? 'text-yellow-300' : 'text-yellow-800'} mb-2 text-sm`}>Diagnostics</h4>
                        <div className="grid grid-cols-1 gap-3 text-sm">
                          {f.method?.startsWith('GARCH') && (
                            <>
                              <div className="flex justify-between">
                                <span className={theme.text.secondary}>α (ARCH):</span>
                                <span className={`font-mono ${theme.text.primary}`}>
                                  {(f.estimates.volatility_diagnostics.alpha || 0).toFixed(4)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className={theme.text.secondary}>β (GARCH):</span>
                                <span className={`font-mono ${theme.text.primary}`}>
                                  {(f.estimates.volatility_diagnostics.beta || 0).toFixed(4)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className={theme.text.secondary}>ω (intercept):</span>
                                <span className={`font-mono ${theme.text.primary}`}>
                                  {(f.estimates.volatility_diagnostics.omega || 0).toFixed(6)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className={theme.text.secondary}>Uncond. Var:</span>
                                <span className={`font-mono ${theme.text.primary}`}>
                                  {(f.estimates.volatility_diagnostics.unconditional_variance || 0).toFixed(6)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className={theme.text.secondary}>Persistence:</span>
                                <span className={`font-mono ${theme.text.primary}`}>
                                  {(f.estimates.volatility_diagnostics.alpha_plus_beta || 0).toFixed(4)}
                                </span>
                              </div>
                              {f.estimates.volatility_diagnostics.nu && (
                                <div className="flex justify-between">
                                  <span className={theme.text.secondary}>ν (Student-t df):</span>
                                  <span className={`font-mono ${theme.text.primary}`}>
                                    {(f.estimates.volatility_diagnostics.nu).toFixed(2)}
                                  </span>
                                </div>
                              )}
                            </>
                          )}
                          
                          {f.method === 'HAR-RV' && (
                            <>
                              <div className="flex justify-between">
                                <span className={theme.text.secondary}>β_d (daily):</span>
                                <span className={`font-mono ${theme.text.primary}`}>
                                  {(f.estimates.volatility_diagnostics.beta_d || 0).toFixed(4)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className={theme.text.secondary}>β_w (weekly):</span>
                                <span className={`font-mono ${theme.text.primary}`}>
                                  {(f.estimates.volatility_diagnostics.beta_w || 0).toFixed(4)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className={theme.text.secondary}>β_m (monthly):</span>
                                <span className={`font-mono ${theme.text.primary}`}>
                                  {(f.estimates.volatility_diagnostics.beta_m || 0).toFixed(4)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className={theme.text.secondary}>R²:</span>
                                <span className={`font-mono ${theme.text.primary}`}>
                                  {(f.estimates.volatility_diagnostics.r_squared || 0).toFixed(3)}
                                </span>
                              </div>
                            </>
                          )}

                          {f.method?.startsWith('Range') && (
                            <>
                              <div className="flex justify-between">
                                <span className={theme.text.secondary}>σ_range:</span>
                                <span className={`font-mono ${theme.text.primary}`}>
                                  {((f.estimates.volatility_diagnostics.sigma_range || 0) * 100).toFixed(2)}%
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className={theme.text.secondary}>Estimator:</span>
                                <span className={`font-mono ${theme.text.primary}`}>
                                  {f.estimates.volatility_diagnostics.range_estimator || 'N/A'}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className={theme.text.secondary}>Window Avg:</span>
                                <span className={`font-mono ${theme.text.primary}`}>
                                  {((f.estimates.volatility_diagnostics.window_avg || 0) * 100).toFixed(2)}%
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className={theme.text.secondary}>Annualized:</span>
                                <span className={`font-mono ${theme.text.primary}`}>
                                  {((f.estimates.volatility_diagnostics.annualized || 0) * 100).toFixed(2)}%
                                </span>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Soft warnings */}
                        <div className="mt-3 text-xs">
                          {f.estimates.volatility_diagnostics.alpha_plus_beta >= 0.98 && (
                            <p className={`text-orange-500 ${isDarkMode ? 'text-orange-400' : 'text-orange-600'}`}>⚠️ High persistence; shocks decay slowly; consider VT/longer window.</p>
                          )}
                          {f.method?.startsWith('GARCH') && (f.params?.window ?? 500) < 500 && (
                            <p className={`text-orange-500 ${isDarkMode ? 'text-orange-400' : 'text-orange-600'}`}>⚠️ Short window; estimates may be unstable.</p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Empty div for non-GBM forecasts without diagnostics to maintain layout */}
                    {!isLegacyGbmForecast && !f.estimates?.volatility_diagnostics && (
                      <div></div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
