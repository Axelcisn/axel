'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

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
  debug?: boolean;
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

type ContainerSize = {
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
};

type ErrorState = {
  message: string;
  stack?: string;
  moduleKeys?: string[];
  defaultModuleKeys?: string[];
  containerSize?: ContainerSize;
};

type DebugInfo = {
  candlesCount: number;
  chartCandlesCount: number;
  moduleKeys: string[];
  defaultModuleKeys: string[];
  containerSize?: ContainerSize;
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
  debug = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo>({
    candlesCount: candles.length,
    chartCandlesCount: 0,
    moduleKeys: [],
    defaultModuleKeys: [],
  });

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

  const hasData = chartData.candles.length > 0;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let wheelHandler: ((event: WheelEvent) => void) | null = null;
    let timeScaleApi: any = null;

    const measureContainer = (): ContainerSize => {
      const rect = container.getBoundingClientRect();
      return {
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
        clientWidth: container.clientWidth ?? 0,
        clientHeight: container.clientHeight ?? 0,
      };
    };

    const ensureUsableWidth = (): Promise<number> =>
      new Promise((resolve, reject) => {
        let attempts = 0;
        const attemptMeasure = () => {
          if (disposed) {
            reject(new Error('Component disposed before width resolved'));
            return;
          }
          const rect = container.getBoundingClientRect();
          const measuredWidth = rect.width || container.clientWidth;
          if (measuredWidth >= 50) {
            resolve(measuredWidth);
            return;
          }
          attempts += 1;
          if (attempts >= 10) {
            reject(
              new Error(
                `Container width is 0 after ${attempts} retries (last ${Math.round(measuredWidth)}px)`
              )
            );
            return;
          }
          requestAnimationFrame(attemptMeasure);
        };
        attemptMeasure();
      });

    const run = async () => {
      const containerSize = measureContainer();
      setDebugInfo((prev) => ({
        ...prev,
        candlesCount: candles.length,
        chartCandlesCount: chartData.candles.length,
        containerSize,
      }));
      setError(null);

      if (!hasData) return;

      let moduleKeys: string[] = [];
      let defaultModuleKeys: string[] = [];

      try {
        const lc = await import('lightweight-charts');
        moduleKeys = Object.keys(lc ?? {});
        defaultModuleKeys = Object.keys((lc as any)?.default ?? {});
        if (disposed) return;

        setDebugInfo((prev) => ({
          ...prev,
          moduleKeys,
          defaultModuleKeys,
        }));

        const createChart = (lc as any).createChart ?? (lc as any).default?.createChart;
        const ColorType = (lc as any).ColorType ?? (lc as any).default?.ColorType;
        const CrosshairMode = (lc as any).CrosshairMode ?? (lc as any).default?.CrosshairMode;
        const LineStyle = (lc as any).LineStyle ?? (lc as any).default?.LineStyle;

        if (!createChart) {
          throw new Error('lightweight-charts createChart not found');
        }

        const width = await ensureUsableWidth();
        if (disposed) return;

        if (chartRef.current) {
          chartRef.current.remove();
          chartRef.current = null;
        }

        const layout: Record<string, any> = {
          textColor: '#cbd5e1',
          background: ColorType?.Solid != null
            ? { type: ColorType.Solid, color: 'transparent' }
            : { color: 'transparent' },
        };

        const chart = createChart(container, {
          width,
          height,
          layout,
          grid: {
            vertLines: { color: 'rgba(148,163,184,0.08)' },
            horzLines: { color: 'rgba(148,163,184,0.12)' },
          },
          ...(CrosshairMode ? { crosshair: { mode: CrosshairMode.Normal } } : {}),
          rightPriceScale: { visible: false, borderVisible: false, ticksVisible: false, drawTicks: false },
          timeScale: { borderVisible: false, visible: false, ticksVisible: false },
          watermark: { visible: false, color: 'transparent', text: '' },
          handleScroll: {
            mouseWheel: true,
            pressedMouseMove: true,
            horzTouchDrag: true,
            vertTouchDrag: true,
          },
          handleScale: {
            mouseWheel: true,
            pinch: true,
            axisPressedMouseMove: { time: true, price: true },
          },
        });

        if (typeof chart.applyOptions === 'function') {
          chart.applyOptions({
            watermark: { visible: false, color: 'transparent', text: '' },
            layout: { background: layout.background, textColor: layout.textColor },
            rightPriceScale: { visible: false, borderVisible: false, ticksVisible: false, drawTicks: false },
            timeScale: { borderVisible: false, visible: false, ticksVisible: false },
            handleScroll: {
              mouseWheel: true,
              pressedMouseMove: true,
              horzTouchDrag: true,
              vertTouchDrag: true,
            },
            handleScale: {
              mouseWheel: true,
              pinch: true,
              axisPressedMouseMove: { time: true, price: true },
            },
          });
        }

        chartRef.current = chart;

        const hasLegacyCandles = typeof (chart as any).addCandlestickSeries === 'function';
        const hasLegacyLines = typeof (chart as any).addLineSeries === 'function';
        const hasAddSeries = typeof (chart as any).addSeries === 'function';
        const CandlestickSeriesCtor =
          (lc as any).CandlestickSeries ?? (lc as any).default?.CandlestickSeries;
        const LineSeriesCtor = (lc as any).LineSeries ?? (lc as any).default?.LineSeries;

        const candleOptions = {
          upColor: SERIES_COLORS.candleUp,
          borderUpColor: SERIES_COLORS.candleUp,
          wickUpColor: SERIES_COLORS.candleUp,
          downColor: SERIES_COLORS.candleDown,
          borderDownColor: SERIES_COLORS.candleDown,
          wickDownColor: SERIES_COLORS.candleDown,
          priceLineVisible: true,
          lastValueVisible: true,
        };

        let candleSeries: any;
        if (hasLegacyCandles) {
          candleSeries = (chart as any).addCandlestickSeries(candleOptions);
        } else if (hasAddSeries && CandlestickSeriesCtor) {
          candleSeries = (chart as any).addSeries(CandlestickSeriesCtor, candleOptions);
        } else {
          throw new Error('Cannot create candlestick series: unsupported lightweight-charts API');
        }
        candleSeries.setData(chartData.candles);

        const lastClose = chartData.candles[chartData.candles.length - 1]?.close;
        if (
          lastClose != null &&
          Number.isFinite(lastClose) &&
          typeof candleSeries?.createPriceLine === 'function'
        ) {
          const lineStyle =
            LineStyle?.Dotted ?? LineStyle?.Dashed ?? LineStyle?.LargeDashed ?? LineStyle?.Solid;
          candleSeries.createPriceLine({
            price: lastClose,
            color: '#cbd5e1',
            lineWidth: 1,
            ...(lineStyle != null ? { lineStyle } : {}),
          });
        }

        const addLine = (data: LineData[], color: string, lineWidth = 1.5, dashed = false) => {
          if (!data.length) return;
          const seriesOptions: any = {
            color,
            lineWidth,
            lastValueVisible: true,
            priceLineVisible: true,
            crosshairMarkerVisible: true,
          };
          if (LineStyle) {
            const resolvedStyle = dashed
              ? LineStyle.Dotted ?? LineStyle.Dashed ?? LineStyle.LargeDashed ?? LineStyle.Solid
              : LineStyle.Solid ?? LineStyle.Dashed ?? LineStyle.Dotted ?? LineStyle.LargeDashed;
            if (resolvedStyle != null) {
              seriesOptions.lineStyle = resolvedStyle;
            }
          }
          let s: any;
          if (hasLegacyLines) {
            s = (chart as any).addLineSeries(seriesOptions);
          } else if (hasAddSeries && LineSeriesCtor) {
            s = (chart as any).addSeries(LineSeriesCtor, seriesOptions);
          } else {
            throw new Error('Cannot create line series: unsupported lightweight-charts API');
          }

          s.setData(data);
        };

        addLine(chartData.ema20Data, SERIES_COLORS.ema20);
        addLine(chartData.ema50Data, SERIES_COLORS.ema50);
        addLine(chartData.ema200Data, SERIES_COLORS.ema200);
        if (vwapAvailable) {
          addLine(chartData.vwapData, SERIES_COLORS.vwap, 1.5, true);
        }

        if (typeof chart.timeScale === 'function') {
          timeScaleApi = chart.timeScale();
          if (timeScaleApi?.fitContent) {
            timeScaleApi.fitContent();
          }
        }

        wheelHandler = (event: WheelEvent) => {
          if (!event.ctrlKey) return;
          if (typeof timeScaleApi?.zoom === 'function') {
            event.preventDefault();
            const delta = event.deltaY ?? 0;
            const direction = delta > 0 ? -0.2 : 0.2;
            timeScaleApi.zoom(direction);
          }
        };
        container.addEventListener('wheel', wheelHandler, { passive: false });

        const handleResize = () => {
          const rect = container.getBoundingClientRect();
          const measuredWidth = rect.width || container.clientWidth || width;
          chart.applyOptions({ width: measuredWidth });
        };
        resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(container);
        handleResize();
      } catch (err: any) {
        if (disposed) return;
        const message = err?.message ?? 'Unknown chart error';
        setError({
          message,
          stack: typeof err?.stack === 'string' ? err.stack : undefined,
          moduleKeys: moduleKeys.length ? moduleKeys : undefined,
          defaultModuleKeys: defaultModuleKeys.length ? defaultModuleKeys : undefined,
          containerSize,
        });
      }
    };

    run();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      if (wheelHandler) {
        container.removeEventListener('wheel', wheelHandler);
      }
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [candles, chartData, hasData, height, vwapAvailable]);

  return (
    <div className="flex w-full flex-col gap-0">
      <div className="relative">
        <div
          ref={containerRef}
          style={{ height, width: '100%', minWidth: 220 }}
          className="w-full"
          aria-label={title ? `${title} price chart` : 'Price chart'}
        />
        {!hasData && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
            No data
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col gap-1 p-3 text-xs text-slate-200">
            <span className="font-semibold text-rose-300">Chart failed to mount</span>
            <span className="text-rose-200">{error.message}</span>
            {error.containerSize && (
              <span className="text-slate-400">
                container w:{Math.round(error.containerSize.width)} h:
                {Math.round(error.containerSize.height)} (client {error.containerSize.clientWidth}x
                {error.containerSize.clientHeight})
              </span>
            )}
            {debug && error.moduleKeys?.length ? (
              <span className="text-slate-400">module keys: {error.moduleKeys.join(', ')}</span>
            ) : null}
            {debug && error.defaultModuleKeys?.length ? (
              <span className="text-slate-400">
                default keys: {error.defaultModuleKeys.join(', ')}
              </span>
            ) : null}
            {error.stack ? (
              <pre className="mt-1 max-h-28 overflow-auto rounded bg-slate-950/80 p-2 text-[11px] leading-snug text-slate-300">
                {error.stack}
              </pre>
            ) : null}
          </div>
        )}
      </div>
      {debug && (
        <div className="mt-3 space-y-1 rounded-md border border-slate-800/80 bg-slate-900/70 p-2 text-[11px] leading-relaxed text-slate-300">
          <div className="font-semibold text-slate-200">Debug</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <div>candles prop: {debugInfo.candlesCount}</div>
            <div>candles chart: {debugInfo.chartCandlesCount}</div>
            <div>
              container: w {Math.round(debugInfo.containerSize?.width ?? 0)} h{' '}
              {Math.round(debugInfo.containerSize?.height ?? 0)}
            </div>
            <div>
              client: {debugInfo.containerSize?.clientWidth ?? 0} x{' '}
              {debugInfo.containerSize?.clientHeight ?? 0}
            </div>
          </div>
          <div>lc keys: {debugInfo.moduleKeys.length ? debugInfo.moduleKeys.join(', ') : '—'}</div>
          <div>
            lc.default keys:{' '}
            {debugInfo.defaultModuleKeys.length ? debugInfo.defaultModuleKeys.join(', ') : '—'}
          </div>
          {error ? (
            <div className="text-rose-300">
              Error: {error.message}
              {error.stack ? (
                <pre className="mt-1 max-h-28 overflow-auto rounded bg-slate-950/80 p-2 text-[11px] leading-snug text-slate-300">
                  {error.stack}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default IntervalMiniChart;
