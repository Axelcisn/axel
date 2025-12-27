'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

type TimingRowKind = 'section' | 'group' | 'metric';

type TimingRowLevel = 0 | 1 | 2 | 3;

type TimingRow = {
  id: string;
  label: string;
  level: TimingRowLevel;
  kind: TimingRowKind;
  parentId?: string;
};

type ColumnKey =
  | 'interval1Value'
  | 'interval1Gap'
  | 'interval2Value'
  | 'interval2Gap'
  | 'interval3Value'
  | 'interval3Gap';

type IntervalData = {
  close: number;
  ema20: number;
  ema50: number;
  ema200: number;
  vwap: number;
};

type IntervalGroup = 'SECONDS' | 'MINUTES' | 'HOURS' | 'DAYS';

type IntervalOption = {
  id: string;
  label: string;
  seconds: number;
  group: IntervalGroup;
};

type BiasedMetricsTableProps = {
  interval1Data?: IntervalData;
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

const METRIC_COLUMNS: ColumnKey[] = [
  'interval1Value',
  'interval1Gap',
  'interval2Value',
  'interval2Gap',
  'interval3Value',
  'interval3Gap',
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

const EMPTY_METRIC_COLS = 7;

type IntervalSelectProps = {
  value: IntervalOption;
  onChange: (option: IntervalOption) => void;
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

const renderMetricCells = (rowValues?: Partial<Record<ColumnKey, string>>) => {
  const values = rowValues ?? {};
  return (
    <>
      {METRIC_COLUMNS.map((col) => (
        <td key={col} className={cellClass}>
          {values[col] ?? '—'}
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

export default function BiasedMetricsTable({
  interval1Data,
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

  const metricValues = useMemo(() => {
    const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '—');
    if (!interval1Data) return {};
    return {
      'ema-20': { interval1Value: fmt(interval1Data.ema20) },
      'ema-50': { interval1Value: fmt(interval1Data.ema50) },
      'ema-200': { interval1Value: fmt(interval1Data.ema200) },
      vwap: { interval1Value: fmt(interval1Data.vwap) },
    } as Record<string, Partial<Record<ColumnKey, string>>>;
  }, [interval1Data]);

  const headerCellClass =
    'px-3 py-3 border-b border-slate-800 border-r border-slate-800 last:border-r-0 text-center text-xs font-semibold uppercase tracking-wide';

  const subHeaderCellClass =
    'px-3 py-2 border-b border-slate-800 border-r border-slate-800 last:border-r-0 text-center text-[11px] uppercase tracking-wide text-slate-400';

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800">
      <div className="overflow-auto">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 bg-transparent">
            <tr className="text-slate-300">
              <th
                rowSpan={2}
                className={`text-left ${headerCellClass}`}
              >
                Metrics
              </th>
              <th colSpan={2} className={headerCellClass}>
                <IntervalSelect value={interval1} onChange={handleInterval1Change} />
              </th>
              <th colSpan={2} className={headerCellClass}>
                <IntervalSelect value={interval2} onChange={handleInterval2Change} />
              </th>
              <th colSpan={2} className={headerCellClass}>
                <IntervalSelect value={interval3} onChange={handleInterval3Change} />
              </th>
              <th
                rowSpan={2}
                className={headerCellClass}
              >
                Action
              </th>
            </tr>
            <tr>
              <th className={subHeaderCellClass}>Value</th>
              <th className={subHeaderCellClass}>Gap</th>
              <th className={subHeaderCellClass}>Value</th>
              <th className={subHeaderCellClass}>Gap</th>
              <th className={subHeaderCellClass}>Value</th>
              <th className={subHeaderCellClass}>Gap</th>
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

              return (
                <tr
                  key={row.id}
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
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
