'use client';

import { useMemo, useState } from 'react';
import PortfolioLineChart from './PortfolioLineChart';
import { PortfolioEquitySeries, PortfolioRange } from '@/lib/portfolio/types';
import { formatCurrency, formatPercent, toneForNumber } from '@/lib/portfolio/format';
import { MUTED } from './portfolioTheme';

interface PortfolioValuePerformancePanelProps {
  series: PortfolioEquitySeries;
  currency?: string;
}

const ranges: PortfolioRange[] = ['1W', 'MTD', '1M', '3M', 'YTD', '1Y', 'ALL'];

const rangeCopy: Record<PortfolioRange, string> = {
  '1W': 'past week',
  MTD: 'month to date',
  '1M': 'past month',
  '3M': 'past three months',
  YTD: 'year to date',
  '1Y': 'past year',
  ALL: 'all time',
};

function getRangeStart(range: PortfolioRange): Date | null {
  const now = new Date();
  switch (range) {
    case '1W': {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return start;
    }
    case 'MTD':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case '1M': {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      return start;
    }
    case '3M': {
      const start = new Date(now);
      start.setDate(start.getDate() - 90);
      return start;
    }
    case 'YTD':
      return new Date(now.getFullYear(), 0, 1);
    case '1Y': {
      const start = new Date(now);
      start.setDate(start.getDate() - 365);
      return start;
    }
    case 'ALL':
    default:
      return null;
  }
}

function formatSignedCurrency(value: number, currency: string) {
  const absolute = formatCurrency(Math.abs(value), 0, currency);
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${absolute}`;
}

export default function PortfolioValuePerformancePanel({
  series,
  currency = 'USD',
}: PortfolioValuePerformancePanelProps) {
  const [mode, setMode] = useState<'value' | 'performance'>('value');
  const [range, setRange] = useState<PortfolioRange>('3M');

  const {
    windowSeries,
    valuePoints,
    performancePoints,
    endValue,
    delta,
    deltaPct,
  } = useMemo(() => {
    const sorted = [...series].sort(
      (a, b) => new Date(a.t).getTime() - new Date(b.t).getTime(),
    );

    const startDate = getRangeStart(range);
    let window = startDate ? sorted.filter((point) => new Date(point.t) >= startDate) : sorted;

    if (window.length < 2 && sorted.length > 1) {
      const fallbackCount = Math.min(sorted.length, 120);
      window = sorted.slice(-fallbackCount);
    }

    const start = window[0]?.netLiq ?? 0;
    const end = window[window.length - 1]?.netLiq ?? start;
    const change = end - start;
    const changePct = start > 0 ? (change / start) * 100 : 0;

    const valuePts = window.map((point) => ({ x: point.t, y: point.netLiq }));
    const perfPts = window.map((point) => ({
      x: point.t,
      y: start > 0 ? ((point.netLiq - start) / start) * 100 : 0,
    }));

    return {
      windowSeries: window,
      valuePoints: valuePts,
      performancePoints: perfPts,
      endValue: end,
      delta: change,
      deltaPct: changePct,
    };
  }, [series, range]);

  const headline = mode === 'value' ? formatCurrency(endValue, 0, currency) : formatPercent(deltaPct, 2);
  const periodText = range === 'ALL' ? 'overall' : `in the ${rangeCopy[range]}`;
  const subline =
    mode === 'value'
      ? `${formatSignedCurrency(delta, currency)} (${formatPercent(deltaPct, 2)}) ${periodText}`
      : `Total return ${range === 'ALL' ? 'overall' : `in the ${rangeCopy[range]}`}`;

  const chartPoints = mode === 'value' ? valuePoints : performancePoints;

  const mutedText = `${MUTED} text-sm`;
  const deltaTone = toneForNumber(delta);

  return (
    <div className="rounded-3xl">
      <div className="flex items-center px-6 pt-6 md:px-7">
        <div className="flex items-center gap-3 text-sm font-semibold text-white/60">
          <button
            className={`transition-colors ${mode === 'value' ? 'text-white' : 'text-white/50 hover:text-white/80'}`}
            onClick={() => setMode('value')}
            type="button"
          >
            Value
          </button>
          <div className="h-5 w-px bg-white/15" />
          <button
            className={`transition-colors ${mode === 'performance' ? 'text-white' : 'text-white/50 hover:text-white/80'}`}
            onClick={() => setMode('performance')}
            type="button"
          >
            Performance
          </button>
        </div>
      </div>

      <div className="px-6 pb-2 pt-3 md:px-7">
        <div className="flex items-baseline gap-3">
          <div className="text-4xl font-semibold text-white sm:text-5xl">{headline}</div>
          {mode === 'value' && windowSeries.length > 1 && (
            <span className={`text-base font-semibold ${deltaTone}`}>{formatPercent(deltaPct, 2)}</span>
          )}
        </div>
        <div className={`${mutedText} mt-2`}>
          {mode === 'value' ? (
            <span className={deltaTone}>{formatSignedCurrency(delta, currency)}</span>
          ) : null}
          {mode === 'value' ? (
            <span className="text-white/70">
              {` (${formatPercent(deltaPct, 2)}) ${periodText}`}
            </span>
          ) : (
            <span className="text-white/70">{subline}</span>
          )}
        </div>
      </div>

      <div className="pb-1 pt-2">
        <PortfolioLineChart
          points={chartPoints}
          variant={mode}
          currency={currency}
          height={360}
        />
      </div>

      <div className="flex justify-center gap-2 pb-6 pt-4">
        {ranges.map((r) => {
          const active = r === range;
          return (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`rounded-full px-4 py-2 text-sm transition ${
                active
                  ? 'bg-[#339CFF] text-white shadow-[0_10px_30px_rgba(51,156,255,0.25)]'
                  : 'bg-white/5 text-white/55 hover:bg-white/10'
              }`}
            >
              {r === 'ALL' ? 'All' : r}
            </button>
          );
        })}
      </div>
    </div>
  );
}
