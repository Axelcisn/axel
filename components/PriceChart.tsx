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
} from "recharts";
import { useDarkMode } from "@/lib/hooks/useDarkMode";
import {
  sliceByRange,
  calculateRangePerformance,
  getRangeLabel,
  type PriceRange,
} from "@/lib/chart/ranges";

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
  value: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  volumeColor?: string;
};

interface PriceChartProps {
  symbol: string;
  className?: string;
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
}) => {
  const isDarkMode = useDarkMode();
  const [fullData, setFullData] = useState<PricePoint[]>([]);
  const [selectedRange, setSelectedRange] = useState<PriceRange>("1M");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Zoom state - tracks how many days to show from the end
  const [zoomDays, setZoomDays] = useState<number | null>(null);

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
  const { chartData, perfByRange } = useMemo(() => {
    if (fullData.length === 0) {
      return {
        chartData: [],
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
    
    const chartPoints: ChartPoint[] = rangeData.map((p) => ({
      date: p.date,
      value: p.adj_close,
      open: p.open,
      high: p.high,
      low: p.low,
      close: p.close,
      volume: p.volume,
      // Determine volume color based on price movement
      volumeColor: (p.close && p.open && p.close > p.open) ? "#22c55e" : "#ef4444", // green if bullish, red if bearish
    }));

    return {
      chartData: chartPoints,
      perfByRange: perfMap,
    };
  }, [fullData, selectedRange, zoomDays]);

  // Determine line color from current range performance
  const latestRangePerf = perfByRange[selectedRange];
  const isPositive = latestRangePerf != null ? latestRangePerf >= 0 : undefined;
  const lineColor = isPositive === false ? "#F97373" : "#00E5A0";

  const chartBg = "w-full";
  const containerClasses = (className ?? "") + " w-full";

  return (
    <div className={containerClasses}>
      {/* Zoom Controls */}
      <div className="flex justify-start mb-2 gap-1">
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
        ) : chartData.length === 0 ? (
          <div className={`flex h-[400px] items-center justify-center text-xs ${isDarkMode ? 'text-muted-foreground' : 'text-gray-500'}`}>
            No historical data available.
          </div>
        ) : (
          <div className="space-y-2">
            {/* Main Price Chart */}
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart
                data={chartData}
                margin={{ top: 20, right: 40, left: 0, bottom: 0 }}
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
                </defs>

                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tickMargin={8}
                  minTickGap={24}
                  tick={false} // Hide ticks on price chart
                />
                <YAxis
                  orientation="right"
                  axisLine={false}
                  tickLine={false}
                  tickMargin={8}
                  width={56}
                  tick={{
                    fontSize: 10,
                    fill: isDarkMode ? "rgba(148, 163, 184, 0.9)" : "rgba(75, 85, 99, 0.9)",
                  }}
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(v: number) => v.toFixed(0)}
                />
                <Tooltip
                  content={<PriceTooltip isDarkMode={isDarkMode} />}
                  animationDuration={0}
                  cursor={{
                    stroke: isDarkMode ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)",
                    strokeWidth: 1,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={lineColor}
                  strokeWidth={2}
                  fill="url(#priceFill)"
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              </AreaChart>
            </ResponsiveContainer>

            {/* Volume Chart */}
            <div className="volume-chart-container -mt-2">
              <style jsx>{`
                .volume-chart-container .recharts-bar-rectangle {
                  transition: transform 0.15s ease-in-out;
                }
                .volume-chart-container .recharts-bar-rectangle:hover {
                  transform: scaleX(1.2) scaleY(1.1);
                  transform-origin: bottom center;
                }
              `}</style>
              <ResponsiveContainer width="100%" height={100}>
                <BarChart
                  data={chartData}
                  margin={{ top: 0, right: 40, left: 0, bottom: 8 }}
                >
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tickMargin={8}
                    minTickGap={24}
                    tick={{
                      fontSize: 10,
                      fill: isDarkMode ? "rgba(148, 163, 184, 0.9)" : "rgba(75, 85, 99, 0.9)",
                    }}
                    tickFormatter={formatXAxisDate}
                  />
                  <YAxis
                    orientation="right"
                    axisLine={false}
                    tickLine={false}
                    tick={false}
                    width={56}
                    domain={[0, "dataMax"]}
                  />
                  <Tooltip
                    content={<VolumeTooltip isDarkMode={isDarkMode} />}
                    animationDuration={0}
                    cursor={false}
                  />
                  <Bar dataKey="volume">
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.volumeColor || "#666"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
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
  
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs shadow-lg min-w-[140px] ${
      isDarkMode 
        ? 'border-white/10 bg-[#111827] text-slate-100'
        : 'border-gray-300 bg-white text-gray-900'
    }`}>
      <div className="space-y-1">
        {/* Date with year */}
        <div className={`text-[11px] font-medium ${
          isDarkMode ? 'text-slate-300' : 'text-gray-600'
        }`}>
          {formatTooltipDate(label)}
        </div>
        
        {/* Price (Close/Adj Close) */}
        <div className="text-sm font-mono tabular-nums font-semibold">
          ${price.toFixed(2)}
        </div>
        
        {/* OHLCV Data */}
        {(data.open || data.high || data.low || data.close || data.volume) && (
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
