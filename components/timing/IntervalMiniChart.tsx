'use client';

import React, { useEffect, useMemo, useRef } from 'react';

type Candle = {
  time?: number | string | Date | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  volume?: number | null;
};

type IntervalMiniChartProps = {
  title?: string;
  candles: Candle[];
  ema20?: (number | null)[] | null;
  ema50?: (number | null)[] | null;
  ema200?: (number | null)[] | null;
  vwap?: (number | null)[] | null;
  vwapAvailable?: boolean;
  height?: number;
};

type CandlestickData = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type LineData = {
  time: number;
  value: number;
};

const SERIES_COLORS = {
  candleUp: '#10b981',
  candleDown: '#ef4444',
  ema20: '#38bdf8',
  ema50: '#a78bfa',
  ema200: '#fbbf24',
  vwap: '#f472b6',
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const normalizeTime = (time: Candle['time']): number | null => {
  if (time == null) return null;
  if (typeof time === 'number') {
    const seconds = time > 1e12 ? Math.floor(time / 1000) : Math.floor(time);
    return seconds;
  }
  const ts = Date.parse(time as string);
  if (Number.isNaN(ts)) return null;
  return Math.floor(ts / 1000);
};

const IntervalMiniChart: React.FC<IntervalMiniChartProps> = ({
  title,
  candles,
  ema20,
  ema50,
  ema200,
  vwap,
  vwapAvailable = true,
  height = 150,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any | null>(null);

  const chartData = useMemo(() => {
    if (!candles || candles.length === 0) {
      return {
        candles: [] as CandlestickData[],
        ema20Data: [] as LineData[],
        ema50Data: [] as LineData[],
        ema200Data: [] as LineData[],
        vwapData: [] as LineData[],
      };
    }

    const candleData: CandlestickData[] = [];
    candles.forEach((candle) => {
      const time = normalizeTime(candle.time);
      const open = toNumber(candle.open);
      const high = toNumber(candle.high);
      const low = toNumber(candle.low);
      const close = toNumber(candle.close);
      if (time == null || open == null || high == null || low == null || close == null) return;
      candleData.push({ time, open, high, low, close });
    });

    const mapLine = (series?: (number | null)[] | null) => {
      if (!series || !candleData.length) return [] as LineData[];
      const out: LineData[] = [];
      for (let i = 0; i < candleData.length && i < series.length; i += 1) {
        const v = series[i];
        if (v == null || !Number.isFinite(v)) continue;
        out.push({ time: candleData[i].time, value: v });
      }
      return out;
    };

    return {
      candles: candleData,
      ema20Data: mapLine(ema20),
      ema50Data: mapLine(ema50),
      ema200Data: mapLine(ema200),
      vwapData: mapLine(vwap),
    };
  }, [candles, ema20, ema50, ema200, vwap]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let disposed = false;

    const run = async () => {
      const lc = await import('lightweight-charts');
      const create = (lc as any).createChart ?? (lc as any).default?.createChart;
      const ColorType = (lc as any).ColorType ?? (lc as any).default?.ColorType;
      const CrosshairMode = (lc as any).CrosshairMode ?? (lc as any).default?.CrosshairMode;
      const LineStyle = (lc as any).LineStyle ?? (lc as any).default?.LineStyle;
      if (!create || !ColorType || !CrosshairMode || !LineStyle) return;
      if (disposed) return;
      if (!chartData.candles.length) return;

      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }

      const chart = create(container, {
        width: container.clientWidth,
        height,
        layout: { background: { type: ColorType.Solid, color: '#0b1220' }, textColor: '#cbd5e1' },
        grid: {
          vertLines: { color: 'rgba(148,163,184,0.08)' },
          horzLines: { color: 'rgba(148,163,184,0.12)' },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false },
      });

      chartRef.current = chart;

      const candleSeries = chart.addCandlestickSeries({
        upColor: SERIES_COLORS.candleUp,
        borderUpColor: SERIES_COLORS.candleUp,
        wickUpColor: SERIES_COLORS.candleUp,
        downColor: SERIES_COLORS.candleDown,
        borderDownColor: SERIES_COLORS.candleDown,
        wickDownColor: SERIES_COLORS.candleDown,
      });
      candleSeries.setData(chartData.candles);

      const addLine = (data: LineData[], color: string, lineWidth = 1.5) => {
        if (!data.length) return;
        const series = chart.addLineSeries({
          color,
          lineWidth,
          lineStyle: LineStyle.Solid,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: true,
        });
        series.setData(data);
      };

      addLine(chartData.ema20Data, SERIES_COLORS.ema20);
      addLine(chartData.ema50Data, SERIES_COLORS.ema50);
      addLine(chartData.ema200Data, SERIES_COLORS.ema200);
      if (vwapAvailable) {
        addLine(chartData.vwapData, SERIES_COLORS.vwap, 1.6);
      }

      const handleResize = () => {
        chart.applyOptions({ width: container.clientWidth });
      };
      const observer = new ResizeObserver(handleResize);
      observer.observe(container);
      handleResize();

      return () => {
        observer.disconnect();
      };
    };

    const cleanupPromise = run();

    return () => {
      disposed = true;
      cleanupPromise.then((cleanup) => cleanup?.());
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [chartData, height, vwapAvailable]);

  const hasData = chartData.candles.length > 0;

  return (
    <div className="flex flex-col rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <span>{title ?? 'Interval'}</span>
        {!vwapAvailable && (
          <span className="text-[10px] font-medium uppercase tracking-wide text-amber-300/80">
            VWAP unavailable
          </span>
        )}
      </div>
      <div className="relative">
        <div ref={containerRef} style={{ height, width: '100%' }} className="w-full" />
        {!hasData && (
          <div className="absolute inset-0 flex items-center justify-center rounded-md bg-slate-900/40 text-sm text-slate-500">
            No data
          </div>
        )}
      </div>
    </div>
  );
};

export default IntervalMiniChart;
