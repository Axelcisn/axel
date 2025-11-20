'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot, Area, AreaChart, ComposedChart } from 'recharts';

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
  onConformalModeChange,
  onConformalDomainChange,
  onConformalCalWindowChange,
  onConformalEtaChange,
  onConformalKChange,
  onLoadBaseForecastCount,
  onGenerateBaseForecasts,
  onApplyConformalPrediction
}: PriceChartProps) {
  const [data, setData] = useState<PriceData[]>([]);
  const [selectedRange, setSelectedRange] = useState<TimeRange>('1y');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1); // 1 = normal, higher = more zoomed in

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
  }, [data, selectedRange, zoomLevel]);

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

  // Process forecast data and create extended dataset for visualization with persistent GBM layer
  const { chartData, forecastInfo, gbmInfo, windowHighlightData } = useMemo(() => {
    let baseChartData = [...filteredData];
    let windowHighlightData = null;

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
      return { chartData: baseChartData, forecastInfo: null, gbmInfo: null, windowHighlightData };
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
    if (gbmInfo) {
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
    if (forecastInfo) {
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
    
    return { chartData: finalChartData, forecastInfo, gbmInfo, windowHighlightData };
  }, [activeForecast, gbmForecast, filteredData, gbmWindowLength]);

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

  // Custom tooltip with TradingView style
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    
    const data = payload[0].payload;
    
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
    const isForecastArea = forecastInfo && new Date(label) > new Date(filteredData[filteredData.length - 1].date);
    
    return (
      <div className="bg-gray-900 p-3 rounded-lg shadow-xl border border-gray-600">
        <p className={`text-sm text-gray-300 mb-2 ${tooltipColor}`}>
          {formatTooltipDate(label)}
          {isForecastArea && <span className="ml-2 text-green-400 text-xs">[FORECAST]</span>}
        </p>
        
        {isForecastArea && forecastInfo ? (
          <div className="space-y-1 text-sm">
            <div className="text-green-400 text-xs font-medium mb-1">
              {forecastInfo.method} • {(forecastInfo.coverage * 100).toFixed(1)}% PI
            </div>
            <div className="flex items-center gap-2 text-green-300">
              <span className="font-mono text-xs">U</span>
              <span className="font-medium">{formatPrice(forecastInfo.U_h)}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-300">
              <span className="font-mono text-xs">M</span>
              <span className="font-medium">{formatPrice((forecastInfo.U_h + forecastInfo.L_h) / 2)}</span>
            </div>
            <div className="flex items-center gap-2 text-red-300">
              <span className="font-mono text-xs">L</span>
              <span className="font-medium">{formatPrice(forecastInfo.L_h)}</span>
            </div>
            <div className="text-xs text-gray-400 mt-1">
              Band: {forecastInfo.bandWidthBp} bp
            </div>
          </div>
        ) : (
          <div className={`space-y-1 text-sm ${tooltipColor}`}>
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
      <div className={`bg-white rounded-lg border shadow-sm ${className}`}>
        <div className="p-6">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
              <p className="text-gray-600">Loading chart data...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-white rounded-lg border shadow-sm ${className}`}>
        <div className="p-6">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="text-red-500 text-lg mb-2">⚠️</div>
              <p className="text-red-600 font-medium">Chart Error</p>
              <p className="text-gray-600 text-sm mt-1">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const chartColor = '#3b82f6'; // blue

  return (
    <div className={`bg-white rounded-lg border shadow-sm ${className}`}>
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{symbol}</h3>
            {performance && (
              <div className="flex items-center gap-3 mt-1">
                <span className="text-2xl font-bold text-gray-900">
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
            <span className="text-xs text-gray-600 font-medium">Zoom:</span>
            <div className="flex gap-1">
              <button
                onClick={() => setZoomLevel(Math.max(0.5, zoomLevel - 0.5))}
                disabled={zoomLevel <= 0.5}
                className="w-8 h-8 flex items-center justify-center text-sm font-bold rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Zoom Out"
              >
                −
              </button>
              <button
                onClick={() => setZoomLevel(Math.min(10, zoomLevel + 0.5))}
                disabled={zoomLevel >= 10}
                className="w-8 h-8 flex items-center justify-center text-sm font-bold rounded border border-gray-300 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Zoom In"
              >
                +
              </button>
            </div>
            <span className="text-xs text-gray-500">
              {zoomLevel}x
            </span>
          </div>
        )}
        
        <div style={{ width: '100%', height: '400px' }}>
          <ResponsiveContainer>
            <ComposedChart 
              data={chartData} 
              margin={{ top: 5, right: 5, left: 20, bottom: 5 }}
            >
              <defs>
                {/* Green GBM baseline gradient */}
                {gbmInfo && (
                  <>
                    <linearGradient id="gbmCone" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="50%" stopColor="#34d399" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#6ee7b7" stopOpacity={0.2} />
                    </linearGradient>
                  </>
                )}
                {/* Active forecast cone gradient (purple/blue) - only if different from GBM */}
                {forecastInfo && (!gbmInfo || forecastInfo.method !== 'GBM-CC') && (
                  <>
                    <linearGradient id="forecastCone" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} />
                      <stop offset="50%" stopColor="#a78bfa" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#c4b5fd" stopOpacity={0.2} />
                    </linearGradient>
                  </>
                )}
                {windowHighlightData && (
                  <>
                    <linearGradient id="windowHighlight" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.1} />
                    </linearGradient>
                  </>
                )}
              </defs>
              
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              
              <XAxis 
                dataKey="date"
                tick={{ fontSize: 12, fill: '#64748b' }}
                axisLine={{ stroke: '#e2e8f0' }}
                tickLine={{ stroke: '#e2e8f0' }}
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
                orientation="right"
                tick={{ fontSize: 12, fill: '#64748b' }}
                axisLine={{ stroke: '#e2e8f0' }}
                tickLine={{ stroke: '#e2e8f0' }}
                tickFormatter={(value) => `$${value.toFixed(0)}`}
                domain={
                  zoomLevel > 2 && (forecastInfo || gbmInfo)
                    ? [
                        Math.min(
                          Math.min(...filteredData.map(d => d.adj_close || d.close)),
                          Math.min(
                            forecastInfo?.L_h || Infinity,
                            gbmInfo?.L_h || Infinity
                          ) * 0.98
                        ),
                        Math.max(
                          Math.max(...filteredData.map(d => d.adj_close || d.close)),
                          Math.max(
                            forecastInfo?.U_h || 0,
                            gbmInfo?.U_h || 0
                          ) * 1.02
                        )
                      ]
                    : ['auto', 'auto']
                }
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

              {/* Green GBM baseline cone - always visible when available */}
              {gbmInfo && (
                <>
                  {/* GBM Upper cone area */}
                  <Area
                    type="monotone"
                    dataKey="gbm_area_upper"
                    stroke="none"
                    fill="url(#gbmCone)"
                    fillOpacity={1}
                    connectNulls={false}
                    dot={false}
                  />
                  {/* GBM Lower cone area (white to create the cone effect) */}
                  <Area
                    type="monotone"
                    dataKey="gbm_area_lower"
                    stroke="none"
                    fill="#ffffff"
                    fillOpacity={0.9}
                    connectNulls={false}
                    dot={false}
                  />
                </>
              )}

              {/* Active forecast cone - only if different from GBM */}
              {forecastInfo && (!gbmInfo || !areForeccastsSame(forecastInfo, gbmInfo)) && (
                <>
                  {/* Active forecast Upper cone area */}
                  <Area
                    type="monotone"
                    dataKey="forecast_area_upper"
                    stroke="none"
                    fill="url(#forecastCone)"
                    fillOpacity={1}
                    connectNulls={false}
                    dot={false}
                  />
                  {/* Active forecast Lower cone area (white to create the cone effect) */}
                  <Area
                    type="monotone"
                    dataKey="forecast_area_lower"
                    stroke="none"
                    fill="#ffffff"
                    fillOpacity={0.9}
                    connectNulls={false}
                    dot={false}
                  />
                </>
              )}
              
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
                    onClick={() => setSelectedRange(range.key)}
                    className={`text-center p-2 rounded transition-colors text-xs ${
                      isSelected 
                        ? 'bg-blue-100 border border-blue-300' 
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className={`font-medium ${isSelected ? 'text-blue-900' : 'text-gray-700'}`}>
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
                    <h3 className="text-lg font-semibold">Final Prediction Intervals</h3>
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-green-100 text-green-800">
                      🔒 {method}
                    </span>
                  </div>

                  {/* PI Values */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">L₁ (Lower)</div>
                      <div className="text-lg font-mono">${
                        isLegacyGbmForecast 
                          ? f.pi.L1.toFixed(2)
                          : (f.L_h || f.intervals?.L_h || 0).toFixed(2)
                      }</div>
                    </div>
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">U₁ (Upper)</div>
                      <div className="text-lg font-mono">${
                        isLegacyGbmForecast 
                          ? f.pi.U1.toFixed(2)
                          : (f.U_h || f.intervals?.U_h || 0).toFixed(2)
                      }</div>
                    </div>
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">Band Width</div>
                      <div className="text-lg font-mono">{
                        isLegacyGbmForecast 
                          ? f.pi.band_width_bp.toFixed(0)
                          : (f.band_width_bp || f.intervals?.band_width_bp || 0).toFixed(0)
                      } bp</div>
                    </div>
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">
                        Critical {critType === 't' ? `t(${df ?? 'df'})` : 'z_α'}
                      </div>
                      <div className="text-lg font-mono">
                        {critVal != null ? Number(critVal).toFixed(3) : 'N/A'}
                      </div>
                    </div>
                  </div>

                  {/* Forecast Parameters & Diagnostics - Two Column Layout */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                    {/* Forecast Parameters */}
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <h4 className="font-semibold text-gray-800 mb-2 text-sm">Forecast Parameters</h4>
                      <div className="grid grid-cols-1 gap-3 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Coverage:</span>
                          <span className="font-mono text-gray-900">{
                            isLegacyGbmForecast
                              ? ((f.coverage || f.params?.coverage || 0.95) * 100).toFixed(1)
                              : ((f.coverage || f.params?.coverage || f.target?.coverage || 0) * 100).toFixed(1)
                          }%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Horizon:</span>
                          <span className="font-mono text-gray-900">{
                            isLegacyGbmForecast ? '1D' : (f.h || f.params?.h || f.target?.h || 1) + 'D'
                          }</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">As-of Date:</span>
                          <span className="font-mono text-gray-900">{f.date_t}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Window:</span>
                          <span className="font-mono text-gray-900">{windowN} days</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Drift Shrinkage:</span>
                          <span className="font-mono text-gray-900">λ = {
                            isLegacyGbmForecast 
                              ? (f.lambdaDrift || f.params?.lambdaDrift || 0).toFixed(3)
                              : (f.lambda_drift || f.params?.lambda_drift || 0).toFixed(3)
                          }</span>
                        </div>
                      </div>
                    </div>

                    {/* MLE Estimates - Only for GBM forecasts */}
                    {isLegacyGbmForecast && f.estimates && (
                      <div className="p-3 bg-blue-50 rounded-lg">
                        <h4 className="font-semibold text-blue-800 mb-2 text-sm">MLE Estimates</h4>
                        <div className="grid grid-cols-1 gap-3 text-sm">
                          <div className="flex justify-between">
                            <span className="text-gray-600">μ* (drift):</span>
                            <span className="font-mono text-gray-900">{((f.estimates.mu_star_hat || 0) * 10000).toFixed(2)} bp/day</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">σ (volatility):</span>
                            <span className="font-mono text-gray-900">{((f.estimates.sigma_hat || 0) * 100).toFixed(2)}%</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">μ* used:</span>
                            <span className="font-mono text-gray-900">{((f.estimates.mu_star_used || 0) * 10000).toFixed(2)} bp/day</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Critical z_α:</span>
                            <span className="font-mono text-gray-900">{(f.estimates.z_alpha || 0).toFixed(3)}</span>
                          </div>
                        </div>
                        <p className="text-xs text-blue-600 mt-2 font-medium">MLE with denominator N (no Bessel correction)</p>
                      </div>
                    )}

                    {/* Diagnostics - Show for all volatility models */}
                    {!isLegacyGbmForecast && f.estimates?.volatility_diagnostics && (
                      <div className="p-3 bg-yellow-50 rounded-lg">
                        <h4 className="font-semibold text-yellow-800 mb-2 text-sm">Diagnostics</h4>
                        <div className="grid grid-cols-1 gap-3 text-sm">
                          {f.method?.startsWith('GARCH') && (
                            <>
                              <div className="flex justify-between">
                                <span className="text-gray-600">α (ARCH):</span>
                                <span className="font-mono text-gray-900">
                                  {(f.estimates.volatility_diagnostics.alpha || 0).toFixed(4)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">β (GARCH):</span>
                                <span className="font-mono text-gray-900">
                                  {(f.estimates.volatility_diagnostics.beta || 0).toFixed(4)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">ω (intercept):</span>
                                <span className="font-mono text-gray-900">
                                  {(f.estimates.volatility_diagnostics.omega || 0).toFixed(6)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">Uncond. Var:</span>
                                <span className="font-mono text-gray-900">
                                  {(f.estimates.volatility_diagnostics.unconditional_variance || 0).toFixed(6)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">Persistence:</span>
                                <span className="font-mono text-gray-900">
                                  {(f.estimates.volatility_diagnostics.alpha_plus_beta || 0).toFixed(4)}
                                </span>
                              </div>
                              {f.estimates.volatility_diagnostics.nu && (
                                <div className="flex justify-between">
                                  <span className="text-gray-600">ν (Student-t df):</span>
                                  <span className="font-mono text-gray-900">
                                    {(f.estimates.volatility_diagnostics.nu).toFixed(2)}
                                  </span>
                                </div>
                              )}
                            </>
                          )}
                          
                          {f.method === 'HAR-RV' && (
                            <>
                              <div className="flex justify-between">
                                <span className="text-gray-600">β_d (daily):</span>
                                <span className="font-mono text-gray-900">
                                  {(f.estimates.volatility_diagnostics.beta_d || 0).toFixed(4)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">β_w (weekly):</span>
                                <span className="font-mono text-gray-900">
                                  {(f.estimates.volatility_diagnostics.beta_w || 0).toFixed(4)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">β_m (monthly):</span>
                                <span className="font-mono text-gray-900">
                                  {(f.estimates.volatility_diagnostics.beta_m || 0).toFixed(4)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">R²:</span>
                                <span className="font-mono text-gray-900">
                                  {(f.estimates.volatility_diagnostics.r_squared || 0).toFixed(3)}
                                </span>
                              </div>
                            </>
                          )}

                          {f.method?.startsWith('Range') && (
                            <>
                              <div className="flex justify-between">
                                <span className="text-gray-600">σ_range:</span>
                                <span className="font-mono text-gray-900">
                                  {((f.estimates.volatility_diagnostics.sigma_range || 0) * 100).toFixed(2)}%
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">Estimator:</span>
                                <span className="font-mono text-gray-900">
                                  {f.estimates.volatility_diagnostics.range_estimator || 'N/A'}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">Window Avg:</span>
                                <span className="font-mono text-gray-900">
                                  {((f.estimates.volatility_diagnostics.window_avg || 0) * 100).toFixed(2)}%
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">Annualized:</span>
                                <span className="font-mono text-gray-900">
                                  {((f.estimates.volatility_diagnostics.annualized || 0) * 100).toFixed(2)}%
                                </span>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Soft warnings */}
                        <div className="mt-3 text-xs">
                          {f.estimates.volatility_diagnostics.alpha_plus_beta >= 0.98 && (
                            <p className="text-orange-600">⚠️ High persistence; shocks decay slowly; consider VT/longer window.</p>
                          )}
                          {f.method?.startsWith('GARCH') && (f.params?.window ?? 500) < 500 && (
                            <p className="text-orange-600">⚠️ Short window; estimates may be unstable.</p>
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