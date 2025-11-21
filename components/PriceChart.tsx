'use client';

import { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ReferenceLine, ComposedChart, ReferenceArea } from 'recharts';

interface PriceChartProps {
  symbol: string;
  className?: string;
  activeForecast?: any;
  gbmForecast?: any;
}

type TimeRange = '5d' | '1m' | '3m' | '6m' | '1y' | '2y' | '5y' | 'max';

export default function PriceChart({ symbol, className = '', activeForecast, gbmForecast }: PriceChartProps) {
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
          {/* Method Badge */}
          {(activeForecast || gbmForecast) && (
            <div className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">
              Method: {activeForecast?.method || gbmForecast?.method || 'GBM'}
            </div>
          )}
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
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="font-medium text-gray-800">Method:</span>
              <span className="ml-2 text-gray-600">
                {activeForecast?.method || gbmForecast?.method || 'GBM'}
              </span>
            </div>
            {(() => {
              const forecast = activeForecast || gbmForecast;
              const lowerBound = forecast?.L_h || forecast?.intervals?.L_h || forecast?.pi?.L1;
              const upperBound = forecast?.U_h || forecast?.intervals?.U_h || forecast?.pi?.U1;
              return lowerBound && upperBound ? (
                <div>
                  <span className="font-medium text-gray-800">Prediction Interval:</span>
                  <span className="ml-2 text-gray-600">
                    [${lowerBound.toFixed(2)}, ${upperBound.toFixed(2)}]
                  </span>
                </div>
              ) : null;
            })()}
          </div>
          
          <div className="mt-2 flex items-center gap-4 text-xs text-gray-500 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 bg-blue-600"></div>
              <span>Historical Price</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 border-t-2 border-dashed border-red-500"></div>
              <span>Prediction Bands</span>
            </div>
            {/* Show GBM bounds legend only when we have both active and GBM forecasts */}
            {activeForecast && gbmForecast && activeForecast !== gbmForecast && (
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 border-t-2 border-dashed border-green-600"></div>
                <span>GBM Bounds</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className={`w-4 h-0.5 border-t-2 border-dashed ${isGbmForecast ? 'border-green-600' : 'border-orange-500'}`}></div>
              <span>Projection Lines</span>
            </div>
            {/* Show GBM projection lines legend when GBM bounds exist */}
            {gbmForecast && (gbmForecast.L_h || gbmForecast.intervals?.L_h || gbmForecast.pi?.L1) && (
              <div className="flex items-center gap-2">
                <div className="w-4 h-0.5 border-t-2 border-dashed border-green-600" style={{borderStyle: "dashed", borderTopWidth: "2px"}}></div>
                <span>GBM Projections</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className={`w-4 h-0.5 border-t-2 border-dashed ${isGbmForecast ? 'border-green-600' : 'border-orange-500'}`}></div>
              <span>Mean Projection</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}