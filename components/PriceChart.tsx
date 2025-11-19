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

type TimeRange = '1d' | '5d' | '1m' | '6m' | 'ytd' | '1y' | '5y' | 'all';

interface TimeRangeOption {
  key: TimeRange;
  label: string;
  days: number | null; // null means all data
}

const timeRanges: TimeRangeOption[] = [
  { key: '1d', label: '1 day', days: 1 },
  { key: '5d', label: '5 days', days: 5 },
  { key: '1m', label: '1 month', days: 30 },
  { key: '6m', label: '6 months', days: 180 },
  { key: 'ytd', label: 'Year to date', days: null }, // Will calculate YTD
  { key: '1y', label: '1 year', days: 365 },
  { key: '5y', label: '5 years', days: 1825 },
  { key: 'all', label: 'All time', days: null }
];

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
    
    if (selectedRange === 'ytd') {
      // Year to date - from Jan 1 of current year
      const currentYear = new Date().getFullYear();
      const ytdStart = `${currentYear}-01-01`;
      baseFilteredData = data.filter(row => row.date >= ytdStart);
    } else if (selectedRange === 'all') {
      // For 'all' range, use zoom to reduce from full dataset
      baseDays = Math.floor(data.length / zoomLevel);
    } else if (baseDays) {
      // Apply zoom to reduce the time range (higher zoom = fewer days)
      const zoomedDays = Math.max(5, Math.floor(baseDays / zoomLevel)); // minimum 5 days
      const cutoffDate = new Date();
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

  // Process forecast data and create extended dataset for visualization
  const { chartData, forecastInfo, windowHighlightData } = useMemo(() => {
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
    
    if (!activeForecast || filteredData.length === 0) {
      return { chartData: baseChartData, forecastInfo: null, windowHighlightData };
    }
    
    const isGbmForecast = 'pi' in activeForecast;
    let L_h, U_h, bandWidthBp, basePrice, forecastDate;
    
    if (isGbmForecast) {
      L_h = activeForecast.pi?.L1;
      U_h = activeForecast.pi?.U1;
      bandWidthBp = activeForecast.pi?.band_width_bp;
      basePrice = activeForecast.S_t;
      forecastDate = activeForecast.date_forecast || activeForecast.date_t;
    } else {
      L_h = activeForecast.L_h || activeForecast.intervals?.L_h;
      U_h = activeForecast.U_h || activeForecast.intervals?.U_h;
      bandWidthBp = activeForecast.band_width_bp || activeForecast.intervals?.band_width_bp;
      basePrice = activeForecast.S_t || activeForecast.estimates?.S_t;
      forecastDate = activeForecast.date_t;
    }
    
    if (!L_h || !U_h || !basePrice) {
      return { chartData: filteredData, forecastInfo: null };
    }
    
    const forecastInfo = {
      L_h,
      U_h,
      bandWidthBp,
      currentPrice: basePrice,
      method: isGbmForecast ? 'GBM-CC' : (activeForecast.method || 'Unknown'),
      coverage: isGbmForecast ? 
        (activeForecast.params?.coverage || 0.95) : 
        (activeForecast.target?.coverage || activeForecast.coverage || 0.95),
      horizon: isGbmForecast ? 
        1 : // GBM is always 1D horizon
        (activeForecast.target?.h || activeForecast.h || activeForecast.params?.h || 1)
    };
    
    // Create extended chart data with forecast points
    const finalChartData = [...baseChartData];
    
    // Add forecast points based on the actual horizon
    const latestData = filteredData[filteredData.length - 1];
    const baseDate = new Date(latestData.date);
    const latestPrice = latestData.adj_close || latestData.close;
    
    for (let i = 1; i <= forecastInfo.horizon; i++) {
      const forecastDate = new Date(baseDate);
      forecastDate.setDate(forecastDate.getDate() + i);
      const forecastDateStr = forecastDate.toISOString().split('T')[0];
      
      finalChartData.push({
        date: forecastDateStr,
        open: null,
        high: U_h,
        low: L_h,
        close: null,
        adj_close: null,
        volume: null,
        // Forecast-specific fields
        forecast_upper: U_h,
        forecast_lower: L_h,
        forecast_mid: (U_h + L_h) / 2,
        forecast_area_upper: U_h,
        forecast_area_lower: L_h,
        is_forecast: true
      } as any);
    }
    
    // Add the connection point at current price for smooth area transition
    const lastHistoricalIndex = filteredData.length - 1;
    if (finalChartData[lastHistoricalIndex]) {
      finalChartData[lastHistoricalIndex] = {
        ...finalChartData[lastHistoricalIndex],
        forecast_area_upper: latestPrice,
        forecast_area_lower: latestPrice
      } as any;
    }
    
    return { chartData: finalChartData, forecastInfo, windowHighlightData };
  }, [activeForecast, filteredData, gbmWindowLength]);

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
    const time = date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit', 
      hour12: false 
    });
    
    return `${day} ${month} '${year} ${time}`;
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
              margin={{ top: 5, right: 30, left: 5, bottom: 5 }}
            >
              <defs>
                {forecastInfo && (
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
                  
                  if (selectedRange === '1d') {
                    // For 1 day, show time
                    return date.toLocaleTimeString('en-US', { 
                      hour: '2-digit', 
                      minute: '2-digit',
                      hour12: false
                    });
                  } else {
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
                  }
                }}
              />
              <YAxis 
                tick={{ fontSize: 12, fill: '#64748b' }}
                axisLine={{ stroke: '#e2e8f0' }}
                tickLine={{ stroke: '#e2e8f0' }}
                tickFormatter={(value) => `$${value.toFixed(0)}`}
                domain={
                  zoomLevel > 2 && forecastInfo
                    ? [
                        Math.min(
                          Math.min(...filteredData.map(d => d.adj_close || d.close)),
                          forecastInfo.L_h * 0.98
                        ),
                        Math.max(
                          Math.max(...filteredData.map(d => d.adj_close || d.close)),
                          forecastInfo.U_h * 1.02
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

              {/* Forecast cone/fan shape - normal distribution */}
              {forecastInfo && (
                <>
                  {/* Upper cone area */}
                  <Area
                    type="monotone"
                    dataKey="forecast_area_upper"
                    stroke="none"
                    fill="url(#forecastCone)"
                    fillOpacity={1}
                    connectNulls={false}
                    dot={false}
                  />
                  {/* Lower cone area (white to create the cone effect) */}
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
              
              {/* Forecast dots */}
              {forecastInfo && (
                <>
                  <Line
                    type="monotone"
                    dataKey="forecast_upper"
                    stroke="#10b981"
                    strokeWidth={0}
                    dot={{ r: 3, fill: '#10b981', fillOpacity: 1, stroke: '#ffffff', strokeWidth: 1 }}
                    activeDot={false}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="forecast_lower"
                    stroke="#10b981"
                    strokeWidth={0}
                    dot={{ r: 3, fill: '#10b981', fillOpacity: 1, stroke: '#ffffff', strokeWidth: 1 }}
                    activeDot={false}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="forecast_mid"
                    stroke="#10b981"
                    strokeWidth={0}
                    dot={{ r: 3, fill: '#10b981', fillOpacity: 1, stroke: '#ffffff', strokeWidth: 1 }}
                    activeDot={false}
                    connectNulls={false}
                  />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Time range selector */}
      <div className="px-4 pb-4">
        <div className="flex flex-wrap gap-1">
          {timeRanges.map((range) => (
            <button
              key={range.key}
              onClick={() => setSelectedRange(range.key)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                selectedRange === range.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
        
        {/* Performance summary */}
        {performance && (
          <div className="mt-3 pt-3 border-t grid grid-cols-4 gap-4 text-xs">
            {timeRanges.filter(r => r.key !== 'all').map((range) => {
              let rangeData;
              
              if (range.key === 'ytd') {
                // Year to date calculation
                const currentYear = new Date().getFullYear();
                rangeData = data.filter(row => row.date >= `${currentYear}-01-01`);
              } else if (range.days) {
                // Days-based calculation
                const cutoff = new Date();
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
              
              return (
                <div key={range.key} className="text-center">
                  <div className="font-medium text-gray-900">{range.label}</div>
                  <div className={`${pct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Final Prediction Intervals */}
        {(activeForecast ?? gbmForecast) && (
          <div className="mt-4 pt-4 border-t">
            {(() => {
              // Prefer active forecast, fallback to GBM forecast
              const f = activeForecast ?? gbmForecast;
              const isGbmForecast = 'pi' in f;
              const method = f?.method ?? (isGbmForecast ? 'GBM-CC' : 'Unknown');
              const critType = f?.critical?.type ?? f?.estimates?.critical_type ?? 'normal';
              const critVal = (f?.critical?.value ?? f?.estimates?.critical_value ?? f?.estimates?.z_alpha) ?? null;
              const df = f?.critical?.df ?? f?.estimates?.volatility_diagnostics?.nu;
              const windowN = f?.window_period?.n_obs ?? f?.params?.window ?? 'N/A';
              
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
                        isGbmForecast 
                          ? f.pi.L1.toFixed(2)
                          : (f.L_h || f.intervals?.L_h || 0).toFixed(2)
                      }</div>
                    </div>
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">U₁ (Upper)</div>
                      <div className="text-lg font-mono">${
                        isGbmForecast 
                          ? f.pi.U1.toFixed(2)
                          : (f.U_h || f.intervals?.U_h || 0).toFixed(2)
                      }</div>
                    </div>
                    <div className="bg-gray-50 p-3 rounded">
                      <div className="text-sm text-gray-600">Band Width</div>
                      <div className="text-lg font-mono">{
                        isGbmForecast 
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
                            isGbmForecast
                              ? ((f.coverage || f.params?.coverage || 0.95) * 100).toFixed(1)
                              : ((f.coverage || f.params?.coverage || f.target?.coverage || 0) * 100).toFixed(1)
                          }%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Horizon:</span>
                          <span className="font-mono text-gray-900">{
                            isGbmForecast ? '1D' : (f.h || f.params?.h || f.target?.h || 1) + 'D'
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
                            isGbmForecast 
                              ? (f.lambdaDrift || f.params?.lambdaDrift || 0).toFixed(3)
                              : (f.lambda_drift || f.params?.lambda_drift || 0).toFixed(3)
                          }</span>
                        </div>
                      </div>
                    </div>

                    {/* MLE Estimates - Only for GBM forecasts */}
                    {isGbmForecast && f.estimates && (
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
                    {!isGbmForecast && f.estimates?.volatility_diagnostics && (
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
                    {!isGbmForecast && !f.estimates?.volatility_diagnostics && (
                      <div></div>
                    )}
                  </div>

                  {/* Conformal Prediction Intervals Section */}
                  <div className="mt-6 pt-6 border-t border-gray-200">
                    <h3 className="text-lg font-semibold mb-4">Conformal Prediction Intervals</h3>
                    
                    {/* Mode, Domain, and Calibration Window - 3 Column Layout */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                      <div>
                        <label className="block text-sm font-medium mb-2">Mode:</label>
                        <select 
                          value={conformalMode} 
                          onChange={(e) => onConformalModeChange?.(e.target.value as any)}
                          className="w-full p-2 border rounded-md"
                        >
                          <option value="ICP">ICP</option>
                          <option value="ICP-SCALED">ICP-scaled</option>
                          <option value="CQR">CQR</option>
                          <option value="EnbPI">EnbPI</option>
                          <option value="ACI">ACI</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Domain:</label>
                        <select 
                          value={conformalDomain} 
                          onChange={(e) => onConformalDomainChange?.(e.target.value as 'log' | 'price')}
                          className="w-full p-2 border rounded-md"
                        >
                          <option value="log">log (default)</option>
                          <option value="price">price</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-2">Calibration Window:</label>
                        <select 
                          value={conformalCalWindow} 
                          onChange={(e) => onConformalCalWindowChange?.(Number(e.target.value))}
                          className="w-full p-2 border rounded-md"
                        >
                          <option value={125} className={baseForecastCount !== null && baseForecastCount >= 125 ? 'text-green-700' : 'text-red-600'}>
                            125 days {baseForecastCount !== null && baseForecastCount >= 125 ? '✓' : baseForecastCount !== null ? `(need ${125 - baseForecastCount} more)` : ''}
                          </option>
                          <option value={250} className={baseForecastCount !== null && baseForecastCount >= 250 ? 'text-green-700' : 'text-red-600'}>
                            250 days (default) {baseForecastCount !== null && baseForecastCount >= 250 ? '✓' : baseForecastCount !== null ? `(need ${250 - baseForecastCount} more)` : ''}
                          </option>
                          <option value={500} className={baseForecastCount !== null && baseForecastCount >= 500 ? 'text-green-700' : 'text-red-600'}>
                            500 days {baseForecastCount !== null && baseForecastCount >= 500 ? '✓' : baseForecastCount !== null ? `(need ${500 - baseForecastCount} more)` : ''}
                          </option>
                        </select>
                        {baseForecastCount !== null && (
                          <p className="text-xs text-gray-600 mt-1">
                            Available forecasts: {baseForecastCount}
                            {baseForecastCount < conformalCalWindow && (
                              <span className="text-amber-600 ml-2">
                                — Consider selecting {baseForecastCount >= 125 ? '125' : 'generating more forecasts'}
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Mode-specific Parameters */}
                    {conformalMode === 'ACI' && (
                      <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                        <h3 className="font-medium mb-3">ACI Parameters</h3>
                        <div>
                          <label className="block text-sm mb-1">Step size η:</label>
                          <select 
                            value={conformalEta} 
                            onChange={(e) => onConformalEtaChange?.(Number(e.target.value))}
                            className="w-full p-2 border rounded text-sm"
                          >
                            <option value={0.01}>0.01</option>
                            <option value={0.02}>0.02 (default)</option>
                            <option value={0.05}>0.05</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {conformalMode === 'EnbPI' && (
                      <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                        <h3 className="font-medium mb-3">EnbPI Parameters</h3>
                        <div>
                          <label className="block text-sm mb-1">Ensemble size K:</label>
                          <input 
                            type="number" 
                            value={conformalK} 
                            onChange={(e) => onConformalKChange?.(Number(e.target.value))}
                            className="w-full p-2 border rounded text-sm"
                            min="5"
                            step="1"
                          />
                          <p className="text-xs text-gray-500 mt-1">Minimum 5, default 20</p>
                        </div>
                      </div>
                    )}

                    {/* Apply Button and Generate Button - Side by Side */}
                    <div className="mb-4 flex gap-4">
                      <button
                        onClick={onApplyConformalPrediction}
                        disabled={
                          isApplyingConformal || 
                          !targetSpecResult || 
                          (baseForecastCount !== null && baseForecastCount < conformalCalWindow)
                        }
                        className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                      >
                        {isApplyingConformal ? 'Applying...' : 'Apply Conformal PI'}
                      </button>
                      
                      <button
                        type="button"
                        onClick={onGenerateBaseForecasts}
                        disabled={isGeneratingBase || !activeBaseMethod || (baseForecastCount !== null && baseForecastCount >= conformalCalWindow)}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                      >
                        {isGeneratingBase ? (
                          <span className="flex items-center gap-1">
                            <span className="animate-spin">⟳</span>
                            Generating...
                          </span>
                        ) : (
                          `Generate for ${conformalCalWindow}-day window`
                        )}
                      </button>
                    </div>
                    
                    {/* Status Messages */}
                    <div className="mb-4 space-y-2">
                      {!targetSpecResult && (
                        <p className="text-sm text-gray-500">Please save target specification first</p>
                      )}
                      {baseForecastCount !== null && baseForecastCount < conformalCalWindow && (
                        <p className="text-sm text-red-600">
                          Need {conformalCalWindow - baseForecastCount} more base forecasts for calibration
                        </p>
                      )}
                    </div>

                    {/* Error Display */}
                    {conformalError && (
                      <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-md text-red-700">
                        <p className="font-medium">Error:</p>
                        <p className="text-sm">{conformalError}</p>
                      </div>
                    )}

                    {/* Coverage Chips */}
                    {conformalState && (
                      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                        <h4 className="font-medium mb-2">Coverage Statistics</h4>
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <div className="text-center">
                            <div className="font-mono text-lg">
                              {conformalState.coverage.last60 !== null 
                                ? `${(conformalState.coverage.last60 * 100).toFixed(1)}%` 
                                : 'N/A'}
                            </div>
                            <div className="text-xs text-gray-600">Last 60d</div>
                          </div>
                          <div className="text-center">
                            <div className="font-mono text-lg">
                              {conformalState.coverage.lastCal !== null 
                                ? `${(conformalState.coverage.lastCal * 100).toFixed(1)}%` 
                                : 'N/A'}
                            </div>
                            <div className="text-xs text-gray-600">Cal Window</div>
                          </div>
                          <div className="text-center">
                            <div className="font-mono text-lg">{conformalState.coverage.miss_count}</div>
                            <div className="text-xs text-gray-600">Misses</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Parameters Display */}
                    {conformalState && (
                      <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
                        <h4 className="font-medium mb-2">Calibrated Parameters</h4>
                        <div className="text-sm font-mono">
                          {conformalMode === 'ICP' && conformalState.params.q_cal !== null && (
                            <p>q_cal = {conformalState.params.q_cal.toFixed(6)}</p>
                          )}
                          {conformalMode === 'ICP-SCALED' && conformalState.params.q_cal_scaled != null && (
                            <p>q_cal_scaled = {conformalState.params.q_cal_scaled.toFixed(6)}</p>
                          )}
                          {conformalMode === 'CQR' && (
                            <div>
                              {conformalState.params.delta_L != null && (
                                <p>Δ_L = {conformalState.params.delta_L.toFixed(6)}</p>
                              )}
                              {conformalState.params.delta_U != null && (
                                <p>Δ_U = {conformalState.params.delta_U.toFixed(6)}</p>
                              )}
                            </div>
                          )}
                          {conformalMode === 'EnbPI' && (
                            <div>
                              {conformalState.params.K && <p>K = {conformalState.params.K}</p>}
                              {conformalState.params.q_cal != null && (
                                <p>q_cal = {conformalState.params.q_cal.toFixed(6)}</p>
                              )}
                            </div>
                          )}
                          {conformalMode === 'ACI' && (
                            <div>
                              {conformalState.params.eta && <p>η = {conformalState.params.eta}</p>}
                              {conformalState.params.theta != null && (
                                <p>θ = {conformalState.params.theta.toFixed(6)}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Warnings */}
                    {conformalState && conformalState.domain !== conformalDomain && (
                      <div className="mb-4 p-3 bg-yellow-100 border border-yellow-300 rounded-md text-yellow-700">
                        <p className="font-medium">⚠️ Domain Switch Warning</p>
                        <p className="text-sm">Domain switched {conformalState.domain} ↔ {conformalDomain}: recalibration required</p>
                      </div>
                    )}

                    {/* Formula Tooltip */}
                    <details className="mt-4">
                      <summary className="cursor-pointer text-blue-600 hover:text-blue-800 font-medium text-sm">
                        Methods & Formulas
                      </summary>
                      <div className="mt-2 text-xs bg-blue-50 p-3 rounded font-mono">
                        <div className="space-y-2">
                          <div>
                            <strong>ICP:</strong> q_cal = Q&#123;1−α&#125;(|y_i − ŷ_i|); PI: [ ŷ ± q_cal ]
                          </div>
                          <div>
                            <strong>ICP scaled:</strong> q_cal_s = Q&#123;1−α&#125;(|y_i − ŷ_i| / σ_pred_i); width = q_cal_s·σ_pred_t
                          </div>
                          <div>
                            <strong>CQR:</strong> L = L^0 − Δ_L ; U = U^0 + Δ_U
                          </div>
                          <div>
                            <strong>EnbPI:</strong> OOB residuals → q_cal ; PI: [ ŷ ± q_cal ]
                          </div>
                          <div>
                            <strong>ACI:</strong> θ&#123;t+1&#125; = θ_t + η ( miss_t − α )
                          </div>
                        </div>
                      </div>
                    </details>
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