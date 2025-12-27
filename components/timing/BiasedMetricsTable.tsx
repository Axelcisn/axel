'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import IntervalMiniChart from './IntervalMiniChart';
import { exponentialMovingAverage } from '@/lib/indicators/utils';
import { computeSessionVwap } from '@/lib/indicators/vwap';

type TimingRowKind = 'section' | 'group' | 'metric';

type TimingRowLevel = 0 | 1 | 2 | 3;

type TimingRow = {
  id: string;
  label: string;
  level: TimingRowLevel;
  kind: TimingRowKind;
  parentId?: string;
};

type IntervalKey = 'interval1' | 'interval2' | 'interval3';

type IntervalMetric = {
  value: number | null;
  gap: number | null;
};

type MetricRowValues = Partial<Record<IntervalKey, IntervalMetric>>;

type IntervalGroup = 'SECONDS' | 'MINUTES' | 'HOURS' | 'DAYS';

type IntervalOption = {
  id: string;
  label: string;
  seconds: number;
  group: IntervalGroup;
};

type Candle = {
  time?: number | string | Date | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  volume?: number | null;
};

type IntervalComputation = {
  candles: Candle[];
  ema20Series: (number | null)[] | null;
  ema50Series: (number | null)[] | null;
  ema200Series: (number | null)[] | null;
  vwapSeries: (number | null)[] | null;
  hasVolume: boolean;
  lastClose: number | null;
  ema20Value: number | null;
  ema50Value: number | null;
  ema200Value: number | null;
  vwapValue: number | null;
};

type BiasedMetricsTableProps = {
  interval1Candles?: Candle[];
  interval2Candles?: Candle[];
  interval3Candles?: Candle[];
  onIntervalsChange?: (value: {
    interval1: IntervalOption;
    interval2: IntervalOption;
    interval3: IntervalOption;
  }) => void;
};

const INTERVAL_OPTIONS: IntervalOption[] = [
  { id: '1s', label: '1 second', seconds: 1, group: 'SECONDS' },
  { id: '5s', label: '5 seconds', seconds: 5, group: 'SECONDS' },
  { id: '10s', label: '10 seconds', seconds: 10, group: 'SECONDS' },
  { id: '15s', label: '15 seconds', seconds: 15, group: 'SECONDS' },
  { id: '30s', label: '30 seconds', seconds: 30, group: 'SECONDS' },
  { id: '45s', label: '45 seconds', seconds: 45, group: 'SECONDS' },
  { id: '1m', label: '1 minute', seconds: 60, group: 'MINUTES' },
  { id: '2m', label: '2 minutes', seconds: 120, group: 'MINUTES' },
  { id: '3m', label: '3 minutes', seconds: 180, group: 'MINUTES' },
  { id: '5m', label: '5 minutes', seconds: 300, group: 'MINUTES' },
  { id: '10m', label: '10 minutes', seconds: 600, group: 'MINUTES' },
  { id: '15m', label: '15 minutes', seconds: 900, group: 'MINUTES' },
  { id: '30m', label: '30 minutes', seconds: 1800, group: 'MINUTES' },
  { id: '45m', label: '45 minutes', seconds: 2700, group: 'MINUTES' },
  { id: '1h', label: '1 hour', seconds: 3600, group: 'HOURS' },
  { id: '2h', label: '2 hours', seconds: 7200, group: 'HOURS' },
  { id: '3h', label: '3 hours', seconds: 10800, group: 'HOURS' },
  { id: '4h', label: '4 hours', seconds: 14400, group: 'HOURS' },
  { id: '1d', label: '1 day', seconds: 86400, group: 'DAYS' },
  { id: '1w', label: '1 week', seconds: 7 * 86400, group: 'DAYS' },
  { id: '1mo', label: '1 month', seconds: 30 * 86400, group: 'DAYS' },
  { id: '3mo', label: '3 months', seconds: 90 * 86400, group: 'DAYS' },
  { id: '6mo', label: '6 months', seconds: 180 * 86400, group: 'DAYS' },
  { id: '12mo', label: '12 months', seconds: 365 * 86400, group: 'DAYS' },
];

const INTERVAL_GROUP_ORDER: IntervalGroup[] = ['SECONDS', 'MINUTES', 'HOURS', 'DAYS'];

const OPTION_INDEX: Record<string, number> = INTERVAL_OPTIONS.reduce<Record<string, number>>(
  (acc, opt, idx) => {
    acc[opt.id] = idx;
    return acc;
  },
  {}
);

const getOptionById = (id: string) => INTERVAL_OPTIONS[OPTION_INDEX[id] ?? 0];

const ROWS: TimingRow[] = [
  { id: 'section-biased', label: 'Biased', level: 0, kind: 'section' },
  { id: 'group-ema', label: 'EMA', level: 1, kind: 'group', parentId: 'section-biased' },
  { id: 'ema-20', label: '20', level: 2, kind: 'metric', parentId: 'group-ema' },
  { id: 'ema-50', label: '50', level: 2, kind: 'metric', parentId: 'group-ema' },
  { id: 'ema-200', label: '200', level: 2, kind: 'metric', parentId: 'group-ema' },
  { id: 'group-vwap', label: 'VWAP', level: 1, kind: 'group', parentId: 'section-biased' },
  { id: 'vwap', label: 'VWAP', level: 2, kind: 'metric', parentId: 'group-vwap' },
];

const INDENT_CLASSES: Record<TimingRowLevel, string> = {
  0: '',
  1: 'pl-4',
  2: 'pl-8',
  3: 'pl-12',
};

const rowText = (kind: TimingRowKind) => {
  if (kind === 'section') return 'text-xs font-semibold uppercase tracking-wide text-slate-300';
  if (kind === 'group') return 'text-sm font-semibold text-slate-200';
  return 'text-sm text-slate-100';
};

const cellClass =
  'px-3 py-2 border-b border-slate-800 border-r border-slate-800 last:border-r-0 text-right text-sm text-slate-200 align-middle';
const cellClassNoR =
  'px-3 py-2 border-b border-slate-800 text-right text-sm text-slate-200 align-middle';

const EMPTY_METRIC_COLS = 4;

type IntervalSelectProps = {
  value: IntervalOption;
  onChange: (option: IntervalOption) => void;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const normalizeCandles = (candles?: Candle[]): Candle[] =>
  (candles ?? []).map((c) => ({
    time: c?.time ?? null,
    open: toNumber(c?.open),
    high: toNumber(c?.high),
    low: toNumber(c?.low),
    close: toNumber(c?.close),
    volume: toNumber(c?.volume),
  }));

const toUtcDateKey = (time: Candle['time']) => {
  if (time == null) return null;
  const date = typeof time === 'number'
    ? new Date((time as number) > 1e12 ? (time as number) : (time as number) * 1000)
    : new Date(time);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const lastFinite = (series?: (number | null)[] | null): number | null => {
  if (!series) return null;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const v = series[i];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
};

const computeIntervalData = (candles?: Candle[]): IntervalComputation => {
  const normalized = normalizeCandles(candles);
  const usable = normalized
    .filter((c) => c.time != null && c.close != null && Number.isFinite(c.close))
    .map((c) => ({
      time: c.time,
      open: c.open ?? c.close,
      high: c.high ?? c.close,
      low: c.low ?? c.close,
      close: c.close as number,
      volume: Number.isFinite(c.volume ?? NaN) ? (c.volume as number) : null,
    })) as Candle[];

  if (!usable.length) {
    return {
      candles: [],
      ema20Series: null,
      ema50Series: null,
      ema200Series: null,
      vwapSeries: null,
      hasVolume: false,
      lastClose: null,
      ema20Value: null,
      ema50Value: null,
      ema200Value: null,
      vwapValue: null,
    };
  }

  const closeSeries = usable.map((c) => c.close as number);
  const lastClose = closeSeries.length ? closeSeries[closeSeries.length - 1] : null;

  const computeEma = (period: number) => {
    if (closeSeries.length < period) return null;
    const ema = exponentialMovingAverage(closeSeries, period);
    return ema.map((v) => (Number.isFinite(v) ? v : null));
  };

  const ema20Series = computeEma(20);
  const ema50Series = computeEma(50);
  const ema200Series = computeEma(200);

  const hasVolume = usable.some((c) => Number.isFinite(c.volume ?? NaN) && (c.volume as number) > 0);
  const rawVwap = hasVolume ? computeSessionVwap(usable, (bar) => toUtcDateKey(bar.time)) : null;
  const vwapSeries =
    rawVwap?.length && hasVolume
      ? rawVwap.map((v) => (Number.isFinite(v ?? NaN) ? (v as number) : null))
      : hasVolume
        ? []
        : null;

  return {
    candles: usable,
    ema20Series,
    ema50Series,
    ema200Series,
    vwapSeries: vwapSeries ?? null,
    hasVolume,
    lastClose,
    ema20Value: lastFinite(ema20Series),
    ema50Value: lastFinite(ema50Series),
    ema200Value: lastFinite(ema200Series),
    vwapValue: hasVolume ? lastFinite(vwapSeries) : null,
  };
};

const IntervalSelect: React.FC<IntervalSelectProps> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState<number>(OPTION_INDEX[value.id] ?? 0);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setHighlightIndex(OPTION_INDEX[value.id] ?? 0);
    }
  }, [open, value.id]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const selectOption = (option: IntervalOption) => {
    onChange(option);
    setOpen(false);
  };

  const moveHighlight = (delta: number) => {
    setHighlightIndex((prev) => {
      const max = INTERVAL_OPTIONS.length;
      return (prev + delta + max) % max;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement | HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      moveHighlight(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      moveHighlight(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const option = INTERVAL_OPTIONS[highlightIndex] ?? value;
      selectOption(option);
    } else if (e.key === 'Escape') {
      setOpen(false);
    } else if (e.key === ' ') {
      e.preventDefault();
      setOpen((prev) => !prev);
    }
  };

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        className="inline-flex items-center gap-2 rounded-md border border-slate-700/80 bg-slate-900/60 px-3 py-1 text-xs font-semibold text-slate-200 shadow-sm hover:border-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/60"
      >
        <span>{value.label}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4 text-slate-400"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.939l3.71-3.71a.75.75 0 111.06 1.062l-4.24 4.24a.75.75 0 01-1.06 0l-4.24-4.24a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open ? (
        <div
          ref={menuRef}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className="absolute left-0 z-20 mt-2 w-52 rounded-lg border border-slate-800 bg-slate-950/95 shadow-xl outline-none"
        >
          <div className="max-h-64 overflow-y-auto py-2">
            {INTERVAL_GROUP_ORDER.map((group, groupIdx) => {
              const groupOptions = INTERVAL_OPTIONS.filter((opt) => opt.group === group);
              return (
                <div key={group} className="px-2 pb-2">
                  <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    {group}
                  </div>
                  <div className="space-y-1">
                    {groupOptions.map((opt) => {
                      const optIndex = OPTION_INDEX[opt.id];
                      const highlighted = optIndex === highlightIndex;
                      const selected = opt.id === value.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => selectOption(opt)}
                          onMouseEnter={() => setHighlightIndex(optIndex)}
                          className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm ${
                            highlighted ? 'bg-slate-800 text-slate-100' : 'text-slate-200'
                          } ${selected ? 'font-semibold' : ''}`}
                        >
                          <span>{opt.label}</span>
                          {selected && (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                              className="h-4 w-4 text-emerald-400"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.704 5.292a1 1 0 010 1.416l-7.25 7.25a1 1 0 01-1.415 0l-4.043-4.042a1 1 0 111.414-1.415l3.335 3.336 6.543-6.544a1 1 0 011.416 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {groupIdx < INTERVAL_GROUP_ORDER.length - 1 && (
                    <div className="mt-2 border-b border-slate-800" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const formatNumber = (n: number | null | undefined) =>
  Number.isFinite(n ?? NaN) ? (n as number).toFixed(2) : '—';

const formatSigned = (n: number | null | undefined) =>
  Number.isFinite(n ?? NaN) ? `${(n as number) >= 0 ? '+' : ''}${(n as number).toFixed(2)}` : '—';

export default function BiasedMetricsTable({
  interval1Candles,
  interval2Candles,
  interval3Candles,
  onIntervalsChange,
}: BiasedMetricsTableProps) {
  const [interval1, setInterval1] = useState<IntervalOption>(() => getOptionById('1m'));
  const [interval2, setInterval2] = useState<IntervalOption>(() => getOptionById('15m'));
  const [interval3, setInterval3] = useState<IntervalOption>(() => getOptionById('1h'));

  const rows = useMemo(() => ROWS, []);

  const emitIntervals = (
    i1: IntervalOption,
    i2: IntervalOption,
    i3: IntervalOption
  ) => onIntervalsChange?.({ interval1: i1, interval2: i2, interval3: i3 });

  const handleInterval1Change = (opt: IntervalOption) => {
    setInterval1(opt);
    emitIntervals(opt, interval2, interval3);
  };
  const handleInterval2Change = (opt: IntervalOption) => {
    setInterval2(opt);
    emitIntervals(interval1, opt, interval3);
  };
  const handleInterval3Change = (opt: IntervalOption) => {
    setInterval3(opt);
    emitIntervals(interval1, interval2, opt);
  };

  useEffect(() => {
    emitIntervals(interval1, interval2, interval3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const intervalData = useMemo(
    () => ({
      interval1: computeIntervalData(interval1Candles),
      interval2: computeIntervalData(interval2Candles),
      interval3: computeIntervalData(interval3Candles),
    }),
    [interval1Candles, interval2Candles, interval3Candles]
  );

  const metricValues = useMemo(() => {
    const buildCell = (value: number | null, close: number | null): IntervalMetric | undefined => {
      if (value == null || !Number.isFinite(value)) return undefined;
      const gap = close != null && Number.isFinite(close) ? close - value : null;
      return { value, gap };
    };

    const metrics: Record<string, MetricRowValues> = {};
    const addMetric = (id: string, selector: (data: IntervalComputation) => number | null) => {
      const intervals: MetricRowValues = {};
      (['interval1', 'interval2', 'interval3'] as IntervalKey[]).forEach((key) => {
        const data = intervalData[key];
        const cell = buildCell(selector(data), data.lastClose);
        if (cell) intervals[key] = cell;
      });
      if (Object.keys(intervals).length) {
        metrics[id] = intervals;
      }
    };

    addMetric('ema-20', (data) => data.ema20Value);
    addMetric('ema-50', (data) => data.ema50Value);
    addMetric('ema-200', (data) => data.ema200Value);
    addMetric('vwap', (data) => (data.hasVolume ? data.vwapValue : null));

    return metrics;
  }, [intervalData]);

  const headerCellClass =
    'px-3 py-3 border-b border-slate-800 border-r border-slate-800 last:border-r-0 text-center text-xs font-semibold uppercase tracking-wide';

  const renderMetricCells = (rowValues?: MetricRowValues) => {
    const renderCellContent = (metric?: IntervalMetric) => {
      const hasValue = metric?.value != null && Number.isFinite(metric.value);
      const hasGap = metric?.gap != null && Number.isFinite(metric.gap);
      if (!hasValue && !hasGap) {
        return <span className="text-slate-500">—</span>;
      }
      const gapVal = hasGap ? (metric?.gap as number) : null;
      const gapClass =
        gapVal == null
          ? 'text-slate-500'
          : gapVal >= 0
            ? 'text-emerald-400'
            : 'text-rose-400';
      return (
        <div className="flex flex-col items-end leading-tight">
          <span className="font-semibold text-slate-100">{formatNumber(metric?.value)}</span>
          <span className={`text-xs ${gapClass}`}>Δ {formatSigned(gapVal)}</span>
        </div>
      );
    };

    return (
      <>
        {(['interval1', 'interval2', 'interval3'] as IntervalKey[]).map((col) => (
          <td key={col} className={cellClass}>
            {renderCellContent(rowValues?.[col])}
          </td>
        ))}
        <td className={cellClass}>
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-full border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-500"
          >
            Calc
          </button>
        </td>
      </>
    );
  };

  const chartConfigs = useMemo(
    () => [
      { key: 'interval1' as const, label: interval1.label, data: intervalData.interval1 },
      { key: 'interval2' as const, label: interval2.label, data: intervalData.interval2 },
      { key: 'interval3' as const, label: interval3.label, data: intervalData.interval3 },
    ],
    [interval1.label, interval2.label, interval3.label, intervalData]
  );

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800">
      <div className="overflow-auto">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 bg-transparent">
            <tr className="text-slate-300">
              <th
                className={`text-left ${headerCellClass}`}
              >
                Metrics
              </th>
              <th className={headerCellClass}>
                <IntervalSelect value={interval1} onChange={handleInterval1Change} />
              </th>
              <th className={headerCellClass}>
                <IntervalSelect value={interval2} onChange={handleInterval2Change} />
              </th>
              <th className={headerCellClass}>
                <IntervalSelect value={interval3} onChange={handleInterval3Change} />
              </th>
              <th className={headerCellClass}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isMetric = row.kind === 'metric';
              const suppressVerticals = row.id === 'group-ema' || row.id === 'group-vwap';
              const labelBase = `px-3 py-2 border-b border-slate-800 text-left ${rowText(row.kind)} ${INDENT_CLASSES[row.level]}`;
              const labelClass = suppressVerticals
                ? labelBase
                : `${labelBase} border-r border-slate-800 last:border-r-0`;
              const fillerClass = suppressVerticals ? cellClassNoR : cellClass;

              const baseRow = (
                <tr
                  key={`${row.id}-row`}
                  className={`${suppressVerticals ? 'bg-black' : ''} ${isMetric ? 'hover:bg-white/0' : ''}`}
                >
                  <td className={labelClass}>{row.label}</td>
                  {isMetric ? (
                    renderMetricCells(metricValues[row.id])
                  ) : (
                    Array.from({ length: EMPTY_METRIC_COLS }, (_, idx) => (
                      <td key={idx} className={fillerClass}></td>
                    ))
                  )}
                </tr>
              );

              if (row.id === 'section-biased') {
                const chartCellBase =
                  'border-b border-slate-800 border-r border-slate-800 last:border-r-0 px-1 py-2 align-top';
                return (
                  <React.Fragment key={row.id}>
                    {baseRow}
                    <tr className="bg-slate-950/30" key={`${row.id}-charts`}>
                      <td className="px-3 py-2 border-b border-slate-800 border-r border-slate-800 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Charts
                      </td>
                      {chartConfigs.map((cfg, idx) => {
                        const borderClass = idx === chartConfigs.length - 1 ? 'border-r border-slate-800' : '';
                        return (
                          <td key={cfg.key} className={`${chartCellBase} ${borderClass}`}>
                            <IntervalMiniChart
                              title={cfg.label}
                              candles={cfg.data.candles}
                              ema20={cfg.data.ema20Series}
                              ema50={cfg.data.ema50Series}
                              ema200={cfg.data.ema200Series}
                              vwap={cfg.data.vwapSeries}
                              vwapAvailable={
                                cfg.data.hasVolume && (cfg.data.vwapSeries?.some((v) => v != null) ?? false)
                              }
                              height={150}
                            />
                          </td>
                        );
                      })}
                      <td className={cellClass}></td>
                    </tr>
                  </React.Fragment>
                );
              }

              return baseRow;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
