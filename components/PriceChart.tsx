'use client';

import { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ReferenceLine, ComposedChart, ReferenceArea } from 'recharts';

import { GbmForecast } from '@/lib/storage/fsStore';

interface ModelDetailsProps {
  activeForecast?: GbmForecast | any; // any for backward compatibility with conformal-modified forecasts
  gbmForecast?: GbmForecast | any;
  conformalState?: {
    mode?: string;
    coverage?: {
      last60?: number;
      lastCal?: number;
    };
  };
  horizon?: number;
  coverage?: number;
}

function ModelDetails({ activeForecast, gbmForecast, conformalState, horizon, coverage }: ModelDetailsProps) {
  // Determine the primary forecast to use (prefer activeForecast, fallback to gbmForecast)
  const forecast = activeForecast || gbmForecast;
  
  if (!forecast) {
    return null;
  }

  // Extract method information and determine forecast type
  const baseMethod = forecast.method || 'GBM';
  const conformalMode = conformalState?.mode || forecast.provenance?.conformal?.mode;
  
  // For GARCH11-t, append distribution info
  let methodDisplay = conformalMode ? `${baseMethod}-CC-${conformalMode}` : baseMethod;
  if (baseMethod === 'GARCH11-t' && forecast.estimates?.volatility_diagnostics?.df) {
    const df = forecast.estimates.volatility_diagnostics.df;
    methodDisplay = conformalMode ? `${baseMethod}-CC-${conformalMode} (ν = ${df})` : `${baseMethod} (ν = ${df})`;
  }
  
  // Determine forecast type flags
  const isGbm = baseMethod === "GBM";
  const isGarch = baseMethod?.startsWith("GARCH11");  // handles "GARCH11-N" and "GARCH11-t"

  // Extract horizon information from actual forecast data
  const horizonTrading = forecast.params?.horizonTrading || forecast.horizonTrading || horizon || 1;
  const h_eff_days = forecast.h_eff_days ?? (horizonTrading === 1 ? 1 : horizonTrading); // Fallback for old forecasts
  const horizonDisplay = h_eff_days !== null 
    ? `${horizonTrading}D (h_eff = ${h_eff_days} days)` 
    : `${horizonTrading}D (h_eff = N/A)`;

  // Extract dates with proper formatting
  const forecastDate = forecast.date_t || 'N/A';
  const verifyDate = forecast.verifyDate || 'N/A';

  // Extract GBM parameters (only for GBM forecasts)
  const estimates = forecast.estimates || {};
  const params = forecast.params || {};
  
  let parametersDisplay = '';
  let parametersLabel = '';
  
  if (isGbm) {
    // GBM-specific parameters
    const muStarHat = estimates.mu_star_hat ?? 0;
    const muStarUsed = estimates.mu_star_used ?? estimates.muStarUsed ?? 0;
    const sigmaHat = estimates.sigma_hat ?? estimates.sigmaHat ?? 0;
    const lambdaDrift = params.lambdaDrift ?? params.lambda ?? estimates.lambda ?? 0;
    
    parametersDisplay = `μ*_hat = ${muStarHat.toFixed(6)}, μ*_used = ${muStarUsed.toFixed(6)}, σ = ${sigmaHat.toFixed(6)}, λ = ${lambdaDrift.toFixed(2)}`;
    parametersLabel = 'GBM Parameters';
  } else if (isGarch) {
    // GARCH-specific parameters
    const volDiagnostics = estimates.volatility_diagnostics || {};
    const omega = volDiagnostics.omega ?? NaN;
    const alpha = volDiagnostics.alpha ?? NaN;
    const beta = volDiagnostics.beta ?? NaN;
    const phi = (isFinite(alpha) && isFinite(beta)) ? (alpha + beta) : NaN;
    const sigma2_uncond = volDiagnostics.unconditional_var ?? 
      ((isFinite(omega) && isFinite(phi) && phi < 1) ? omega / (1 - phi) : NaN);
    
    const sigma1d = estimates.sigma_forecast ?? NaN;
    const sigma2_1d = estimates.sigma2_forecast ?? NaN;
    
    // Format parameters with appropriate precision and fallbacks
    const omegaStr = isFinite(omega) ? omega.toExponential(3) : 'N/A';
    const alphaStr = isFinite(alpha) ? alpha.toFixed(3) : 'N/A';
    const betaStr = isFinite(beta) ? beta.toFixed(3) : 'N/A';
    const phiStr = isFinite(phi) ? phi.toFixed(3) : 'N/A';
    const sigma2UncondStr = isFinite(sigma2_uncond) ? sigma2_uncond.toExponential(3) : 'N/A';
    const sigma1dStr = isFinite(sigma1d) ? sigma1d.toFixed(6) : 'N/A';
    const sigma2_1dStr = isFinite(sigma2_1d) ? sigma2_1d.toExponential(3) : 'N/A';
    
    parametersDisplay = `ω = ${omegaStr}, α = ${alphaStr}, β = ${betaStr}, α+β = ${phiStr}, σ²_uncond = ${sigma2UncondStr}`;
    parametersLabel = 'GARCH Parameters';
  }

  // Extract prediction interval (preferably conformal-adjusted)
  // Try multiple possible field locations
  const intervals = forecast.intervals || forecast.pi || forecast;
  const L_conf = forecast.L_h || intervals.L_h || intervals.L1 || intervals.lower;
  const U_conf = forecast.U_h || intervals.U_h || intervals.U1 || intervals.upper;
  const piDisplay = (L_conf !== undefined && U_conf !== undefined) 
    ? `[$${L_conf.toFixed(2)}, $${U_conf.toFixed(2)}]` 
    : 'N/A';

  // Calculate center and width
  const center = (L_conf !== undefined && U_conf !== undefined) ? (L_conf + U_conf) / 2 : null;
  const width = (L_conf !== undefined && U_conf !== undefined) ? U_conf - L_conf : null;
  const bps = (L_conf !== undefined && U_conf !== undefined && L_conf > 0) 
    ? Math.round(10000 * (U_conf / L_conf - 1)) 
    : null;
  const centerWidthDisplay = (center !== null && width !== null && bps !== null) 
    ? `Center = $${center.toFixed(2)}, Width = $${width.toFixed(2)} (≈ ${bps} bp)` 
    : 'N/A';

  // Extract coverage statistics
  const coverageStats = conformalState?.coverage;
  const last60Coverage = coverageStats?.last60;
  const calWindowCoverage = coverageStats?.lastCal;
  const coverageDisplay = (last60Coverage !== null && last60Coverage !== undefined && 
                          calWindowCoverage !== null && calWindowCoverage !== undefined)
    ? `${(last60Coverage * 100).toFixed(1)}% (60d), ${(calWindowCoverage * 100).toFixed(1)}% (Cal Window)`
    : 'N/A';

  return (
    <div className="mb-4">
      <h4 className="text-sm font-semibold text-gray-900 mb-3">Model Details</h4>
      
      {/* Professional grid layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-3">
        {/* Row 1: Method & Horizon */}
        <div className="flex flex-col">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Method</span>
          <span className="text-sm text-gray-900 font-medium">{methodDisplay}</span>
        </div>
        
        <div className="flex flex-col">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Horizon</span>
          <span className="text-sm text-gray-900">{horizonDisplay}</span>
        </div>
        
        <div className="flex flex-col">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Forecast Date</span>
          <span className="text-sm text-gray-900">{forecastDate}</span>
        </div>
        
        <div className="flex flex-col">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Verify Date</span>
          <span className="text-sm text-gray-900">{verifyDate}</span>
        </div>
        
        {/* Row 2: Technical Details */}
        <div className="flex flex-col md:col-span-2">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">{parametersLabel}</span>
          <span className="text-sm text-gray-900 font-mono">{parametersDisplay}</span>
        </div>
        
        <div className="flex flex-col md:col-span-2">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Prediction Interval</span>
          <span className="text-sm text-gray-900 font-medium">{piDisplay}</span>
        </div>
        
        {/* GARCH-specific volatility row */}
        {isGarch && (
          <div className="flex flex-col md:col-span-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Volatility (1D)</span>
            <span className="text-sm text-gray-900 font-mono">
              {(() => {
                const sigma1d = estimates.sigma_forecast ?? NaN;
                const sigma2_1d = estimates.sigma2_forecast ?? NaN;
                const sigma1dStr = isFinite(sigma1d) ? sigma1d.toFixed(6) : 'N/A';
                const sigma2_1dStr = isFinite(sigma2_1d) ? sigma2_1d.toExponential(3) : 'N/A';
                return `σ_1d = ${sigma1dStr}, σ²_1d = ${sigma2_1dStr}`;
              })()}
            </span>
          </div>
        )}
        
        {/* Row 3: Statistics */}
        <div className="flex flex-col md:col-span-2">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Center & Width</span>
          <span className="text-sm text-gray-900">{centerWidthDisplay}</span>
        </div>
        
        <div className="flex flex-col md:col-span-2">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Coverage Statistics</span>
          <span className="text-sm text-gray-900">{coverageDisplay}</span>
        </div>
      </div>
    </div>
  );
}

interface PriceChartProps {
  symbol: string;
  className?: string;
  activeForecast?: any;
  gbmForecast?: any;
  conformalState?: any;
  horizon?: number;
  coverage?: number;
}

type TimeRange = '5d' | '1m' | '3m' | '6m' | '1y' | '2y' | '5y' | 'max';

export default function PriceChart({ 
  symbol, 
  className = '', 
  activeForecast, 
  gbmForecast, 
  conformalState, 
  horizon = 1, 
  coverage = 0.95 
}: PriceChartProps) {
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<TimeRange>('1y');
  const [zoomLevel, setZoomLevel] = useState<number>(1);

  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        // Try uploads first, then canonical
        let response = await fetch('/api/uploads/' + symbol);
        
        if (!response.ok) {
          response = await fetch('/api/canonical/' + symbol);
        }
        
        if (response.ok) {
          const result = await response.json();
          if (result.rows && result.rows.length > 0) {
            const chartData = result.rows.map((row: any) => ({
              date: row.date,
              price: parseFloat(row.adj_close || row.close) || 0,
              close: parseFloat(row.adj_close || row.close) || 0,
              open: parseFloat(row.open) || 0,
              high: parseFloat(row.high) || 0,
              low: parseFloat(row.low) || 0,
              volume: parseInt(row.volume) || 0,
              // Initialize bounds as null for historical data
              lowerBound: null,
              upperBound: null,
              isForecast: false,
              // Initialize projection lines as null for historical data
              projectionLower: null,
              projectionUpper: null,
              projectionMean: null,
            }));
            
            // Sort by date
            chartData.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
            setData(chartData);
          }
        } else {
          setError('Failed to load data');
        }
      } catch (err) {
        setError('Failed to load data');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [symbol]);

  // Filter data based on time range
  const filteredData = useMemo(() => {
    if (data.length === 0) return [];

    const now = new Date();
    let startDate: Date;
    let fallbackCount: number;

    switch (selectedRange) {
      case '5d':
        startDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
        fallbackCount = 5; // Show last 5 trading days if date filter fails
        break;
      case '1m':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        fallbackCount = 22; // ~22 trading days in a month
        break;
      case '3m':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        fallbackCount = 65; // ~65 trading days in 3 months
        break;
      case '6m':
        startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
        fallbackCount = 130; // ~130 trading days in 6 months
        break;
      case '1y':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        fallbackCount = 250; // ~250 trading days in a year
        break;
      case '2y':
        startDate = new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000);
        fallbackCount = 500;
        break;
      case '5y':
        startDate = new Date(now.getTime() - 5 * 365 * 24 * 60 * 60 * 1000);
        fallbackCount = 1250;
        break;
      case 'max':
      default:
        return data;
    }

    // First try date-based filtering
    const dateFiltered = data.filter(item => new Date(item.date) >= startDate);
    
    // If we get reasonable results (more than 0 but not too few for short periods), use them
    if (dateFiltered.length > 0) {
      // For very short periods, ensure we have some minimum data
      if ((selectedRange === '5d' && dateFiltered.length >= 3) || 
          (selectedRange === '1m' && dateFiltered.length >= 10) || 
          selectedRange === '3m' || selectedRange === '6m' || 
          selectedRange === '1y' || selectedRange === '2y' || selectedRange === '5y') {
        return dateFiltered;
      }
    }
    
    // Fallback: use last N trading days if date filtering gives insufficient results
    return data.slice(-fallbackCount);
  }, [data, selectedRange]);

  // Apply zoom and add forecast data
  const chartData = useMemo(() => {
    let baseData = zoomLevel <= 1 ? filteredData : filteredData.slice(-Math.max(30, Math.floor(filteredData.length / zoomLevel)));
    
    // Add forecast point if available
    const forecast = activeForecast || gbmForecast;
    if (forecast && baseData.length > 0) {
      const lastDataPoint = baseData[baseData.length - 1];
      const lastDate = new Date(lastDataPoint.date);
      
      // Calculate forecast date, skipping weekends
      let forecastDate = new Date(lastDate.getTime() + 24 * 60 * 60 * 1000); // Next day
      const dayOfWeek = lastDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
      
      if (dayOfWeek === 5) { // Friday
        // Skip weekend: Friday -> Monday (add 3 days)
        forecastDate = new Date(lastDate.getTime() + 3 * 24 * 60 * 60 * 1000);
      } else if (dayOfWeek === 6) { // Saturday
        // Saturday -> Monday (add 2 days)
        forecastDate = new Date(lastDate.getTime() + 2 * 24 * 60 * 60 * 1000);
      }
      // For other days (Sunday-Thursday), use next day as normal
      
      // Extract forecast bounds - try different possible locations
      const forecast = activeForecast || gbmForecast;
      const lowerBound = forecast.L_h || forecast.intervals?.L_h || forecast.pi?.L1;
      const upperBound = forecast.U_h || forecast.intervals?.U_h || forecast.pi?.U1;
      
      // Also extract GBM bounds separately if we have both active and GBM forecasts
      let gbmLowerBound, gbmUpperBound;
      if (activeForecast && gbmForecast && activeForecast !== gbmForecast) {
        gbmLowerBound = gbmForecast.L_h || gbmForecast.intervals?.L_h || gbmForecast.pi?.L1;
        gbmUpperBound = gbmForecast.U_h || gbmForecast.intervals?.U_h || gbmForecast.pi?.U1;
      }
      
      // For point forecast, prefer GBM forecast if available, otherwise use active forecast
      // This ensures we always show the GBM price line even when we have conformal bounds
      let pointForecast = forecast.y_hat;
      if (!pointForecast && gbmForecast?.y_hat) {
        pointForecast = gbmForecast.y_hat;
      }
      if (!pointForecast && lowerBound && upperBound) {
        pointForecast = Math.sqrt(lowerBound * upperBound);
      }
      if (!pointForecast) {
        pointForecast = lastDataPoint.close;
      }
      
      if (lowerBound && upperBound) {
        // Create a new array with the updated last data point that includes projection line start points
        const updatedLastDataPoint = {
          ...lastDataPoint,
          // Start projection lines from the current closing price
          projectionLower: lastDataPoint.close,
          projectionUpper: lastDataPoint.close,
          projectionMean: lastDataPoint.close,
          // Start GBM projection lines from the current closing price (only if GBM bounds exist)
          gbmProjectionLower: gbmLowerBound ? lastDataPoint.close : null,
          gbmProjectionUpper: gbmUpperBound ? lastDataPoint.close : null,
          // Add area data for triangular fill from current price
          gbmAreaUpper: gbmUpperBound ? lastDataPoint.close : null,
          gbmAreaLower: gbmLowerBound ? lastDataPoint.close : null,
        };
        
        // Create new base data array with updated last point
        const updatedBaseData = [
          ...baseData.slice(0, -1), // All elements except the last one
          updatedLastDataPoint      // Updated last element
        ];
        
        // Add forecast point to chart data
        baseData = [...updatedBaseData, {
          date: forecastDate.toISOString().split('T')[0],
          price: pointForecast,
          close: null, // Don't extend the blue line into forecast period
          open: pointForecast,
          high: pointForecast,
          low: pointForecast,
          volume: 0,
          isForecast: true,
          lowerBound: lowerBound,
          upperBound: upperBound,
          // Add GBM bounds as separate data fields
          gbmLowerBound: gbmLowerBound,
          gbmUpperBound: gbmUpperBound,
          // Create area data for filling between bounds - use difference approach
          gbmAreaHeight: gbmUpperBound && gbmLowerBound ? gbmUpperBound - gbmLowerBound : null,
          gbmAreaBase: gbmLowerBound,
          // Create area boundary values for triangular fill
          gbmAreaUpper: gbmUpperBound,
          gbmAreaLower: gbmLowerBound,
          // Projection line endpoints (at forecast bounds)
          projectionLower: lowerBound,
          projectionUpper: upperBound,
          projectionMean: pointForecast,
          // GBM projection line endpoints (at GBM bounds)
          gbmProjectionLower: gbmLowerBound,
          gbmProjectionUpper: gbmUpperBound,
        }];
      }
    }
    
    return baseData;
  }, [filteredData, zoomLevel, activeForecast, gbmForecast]);

  // Determine if we're showing GBM forecast for projection line coloring
  const isGbmForecast = useMemo(() => {
    const forecast = activeForecast || gbmForecast;
    if (!forecast) return false;
    
    // Check if the method indicates GBM (including GBM-CC, GBM variants)
    if (forecast.method && (forecast.method === 'GBM' || forecast.method.startsWith('GBM-'))) {
      return true;
    }
    
    // If activeForecast exists but gbmForecast is the source of the point forecast,
    // we're still showing GBM-based projection
    if (activeForecast && gbmForecast && !activeForecast.y_hat && gbmForecast.y_hat) {
      return true;
    }
    
    return false;
  }, [activeForecast, gbmForecast]);

  // Calculate Y-axis domain including forecast bounds
  const yDomain = useMemo(() => {
    if (chartData.length === 0) return ['auto', 'auto'];
    
    const prices = chartData.map(d => d.close).filter(p => p > 0);
    
    // Include forecast bounds in domain calculation from both active and GBM forecasts
    const forecastBounds: number[] = [];
    if (activeForecast?.L_h) forecastBounds.push(activeForecast.L_h);
    if (activeForecast?.U_h) forecastBounds.push(activeForecast.U_h);
    if (activeForecast?.intervals?.L_h) forecastBounds.push(activeForecast.intervals.L_h);
    if (activeForecast?.intervals?.U_h) forecastBounds.push(activeForecast.intervals.U_h);
    if (gbmForecast?.pi?.L1) forecastBounds.push(gbmForecast.pi.L1);
    if (gbmForecast?.pi?.U1) forecastBounds.push(gbmForecast.pi.U1);
    if (gbmForecast?.y_hat) forecastBounds.push(gbmForecast.y_hat);
    if (activeForecast?.y_hat) forecastBounds.push(activeForecast.y_hat);
    
    const allValues = [...prices, ...forecastBounds];
    if (allValues.length === 0) return ['auto', 'auto'];
    
    const minPrice = Math.min(...allValues);
    const maxPrice = Math.max(...allValues);
    const padding = (maxPrice - minPrice) * 0.1; // 10% padding for forecast bands
    
    return [
      Math.max(0, minPrice - padding),
      maxPrice + padding
    ];
  }, [chartData, activeForecast, gbmForecast]);

  if (isLoading) {
    return (
      <div className={className + ' p-6 bg-white border rounded-3xl shadow-sm'}>
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={className + ' p-6 bg-white border rounded-3xl shadow-sm'}>
        <div className="text-center py-8">
          <p className="text-red-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={className + ' p-6 bg-white border rounded-3xl shadow-sm'}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{symbol} Price Chart</h2>
          </div>
        </div>
      </div>

      {/* Time Range Selection */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {(['5d', '1m', '3m', '6m', '1y', '2y', '5y', 'max'] as TimeRange[]).map((range) => (
              <button
                key={range}
                onClick={() => {
                  setSelectedRange(range);
                  setZoomLevel(1);
                }}
                className={'px-3 py-1 text-xs font-medium rounded-3xl border transition-colors ' +
                  (selectedRange === range
                    ? 'bg-blue-100 border-blue-300 text-blue-900'
                    : 'bg-transparent border-gray-300 hover:bg-gray-100 text-gray-700')}
              >
                {range.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="p-4">
        {/* Zoom Controls */}
        {data.length > 0 && (
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs text-gray-600 font-medium">Zoom:</span>
            <div className="flex gap-1">
              <button
                onClick={() => setZoomLevel(Math.max(0.5, zoomLevel - 0.5))}
                disabled={zoomLevel <= 0.5}
                className="w-8 h-8 flex items-center justify-center text-sm font-bold rounded border border-gray-300 hover:bg-gray-100 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Zoom Out"
              >
                −
              </button>
              <button
                onClick={() => setZoomLevel(Math.min(10, zoomLevel + 0.5))}
                disabled={zoomLevel >= 10}
                className="w-8 h-8 flex items-center justify-center text-sm font-bold rounded border border-gray-300 hover:bg-gray-100 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                <linearGradient id="gbmFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.2}/>
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis 
                dataKey="date" 
                fontSize={12}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return (date.getMonth() + 1).toString().padStart(2, '0') + '/' + date.getDate().toString().padStart(2, '0');
                }}
              />
              <YAxis 
                orientation="right"
                domain={yDomain}
                fontSize={12}
                tickFormatter={(value) => '$' + value.toFixed(2)}
              />
              <Tooltip
                animationDuration={0}
                formatter={(value: number, name: string, props: any) => {
                  if (name === 'close') return ['$' + value.toFixed(2), 'Close'];
                  if (name === 'lowerBound') return ['$' + value.toFixed(2), 'Lower Bound'];
                  if (name === 'upperBound') return ['$' + value.toFixed(2), 'Upper Bound'];
                  // Don't show projection lines in tooltip as they create duplicates
                  return null;
                }}
                labelFormatter={(label) => `Date: ${label}`}
                content={(props) => {
                  if (props.active && props.payload && props.payload.length > 0) {
                    const data = props.payload[0].payload;
                    
                    if (data.isForecast) {
                      // Forecast point - show only model predictions
                      return (
                        <div className="bg-white p-3 border rounded shadow-lg">
                          <p className="font-semibold">{`Forecast Date: ${props.label}`}</p>
                          <p style={{color: '#22c55e'}}>{`Mean Forecast: $${data.price.toFixed(2)}`}</p>
                          <p style={{color: '#ef4444'}}>{`Lower Bound: $${data.lowerBound.toFixed(2)}`}</p>
                          <p style={{color: '#ef4444'}}>{`Upper Bound: $${data.upperBound.toFixed(2)}`}</p>
                          {data.gbmLowerBound && data.gbmUpperBound && (
                            <>
                              <p style={{color: '#22c55e'}}>{`GBM Lower: $${data.gbmLowerBound.toFixed(2)}`}</p>
                              <p style={{color: '#22c55e'}}>{`GBM Upper: $${data.gbmUpperBound.toFixed(2)}`}</p>
                            </>
                          )}
                        </div>
                      );
                    } else {
                      // Historical data - show OHLC
                      return (
                        <div className="bg-white p-3 border rounded shadow-lg">
                          <p className="font-semibold">{`Date: ${props.label}`}</p>
                          {data.open !== undefined && <p style={{color: '#8b5cf6'}}>{`Open: $${data.open.toFixed(2)}`}</p>}
                          {data.high !== undefined && <p style={{color: '#22c55e'}}>{`High: $${data.high.toFixed(2)}`}</p>}
                          {data.low !== undefined && <p style={{color: '#ef4444'}}>{`Low: $${data.low.toFixed(2)}`}</p>}
                          {data.close !== undefined && <p style={{color: '#2563eb'}}>{`Close: $${data.close.toFixed(2)}`}</p>}
                        </div>
                      );
                    }
                  }
                  return null;
                }}
                labelStyle={{ color: '#374151' }}
              />
              
              {/* Historical price line */}
              <Line
                type="monotone"
                dataKey="close"
                stroke="#2563eb"
                strokeWidth={2}
                dot={false}
                connectNulls={false}
              />

              {/* GBM upper bound area fill */}
              <Area
                type="monotone"
                dataKey="gbmUpperBound"
                stroke="none"
                fill="#22c55e"
                fillOpacity={0.3}
                connectNulls={false}
                isAnimationActive={false}
              />
              
              {/* GBM lower bound area fill (white to cut out lower part) */}
              <Area
                type="monotone"
                dataKey="gbmLowerBound"
                stroke="none"
                fill="#ffffff"
                fillOpacity={1}
                connectNulls={false}
                isAnimationActive={false}
              />
              
              {/* Prediction bands */}
              <Line
                type="monotone"
                dataKey="upperBound"
                stroke="#ef4444"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="lowerBound"
                stroke="#ef4444"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                connectNulls={false}
              />
              
              {/* GBM Prediction bands - shown as green dashed lines when different from active forecast */}
              <Line
                type="monotone"
                dataKey="gbmUpperBound"
                stroke="#22c55e"
                strokeWidth={2}
                strokeDasharray="3 7"
                dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="gbmLowerBound"
                stroke="#22c55e"
                strokeWidth={2}
                strokeDasharray="3 7"
                dot={false}
                connectNulls={false}
              />
              
              {/* Projection lines from current price to forecast bounds */}
              <Line
                type="monotone"
                dataKey="projectionLower"
                stroke={isGbmForecast ? "#22c55e" : "#f97316"}
                strokeWidth={2}
                strokeDasharray="3 3"
                dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="projectionUpper"
                stroke={isGbmForecast ? "#22c55e" : "#f97316"}
                strokeWidth={2}
                strokeDasharray="3 3"
                dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="projectionMean"
                stroke={isGbmForecast ? "#22c55e" : "#f97316"}
                strokeWidth={2}
                strokeDasharray="3 3"
                dot={false}
                connectNulls={false}
              />
              
              {/* GBM-specific projection lines from current price to GBM bounds */}
              <Line
                type="monotone"
                dataKey="gbmProjectionLower"
                stroke="#22c55e"
                strokeWidth={2}
                strokeDasharray="6 2"
                dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="gbmProjectionUpper"
                stroke="#22c55e"
                strokeWidth={2}
                strokeDasharray="6 2"
                dot={false}
                connectNulls={false}
              />
              
              {/* Reference lines for bounds - no visual elements, just for projection lines */}
              {(() => {
                const forecast = activeForecast || gbmForecast;
                const lowerBound = forecast?.L_h || forecast?.intervals?.L_h || forecast?.pi?.L1;
                const upperBound = forecast?.U_h || forecast?.intervals?.U_h || forecast?.pi?.U1;
                
                if (!lowerBound || !upperBound) {
                  return null;
                }

                return null; // No reference lines needed anymore
              })()}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Footer Info */}
      {(activeForecast || gbmForecast) && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          {/* Model Details Section */}
          <ModelDetails 
            activeForecast={activeForecast}
            gbmForecast={gbmForecast}
            conformalState={conformalState}
            horizon={horizon}
            coverage={coverage}
          />
        </div>
      )}
    </div>
  );
}