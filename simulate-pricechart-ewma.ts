import fs from 'fs';
import { sliceByRange } from './lib/chart/ranges';
import { getNextTradingDates, generateFutureTradingDates } from './lib/chart/tradingDays';
import { runEwmaWalker } from './lib/volatility/ewmaWalker';

type PricePoint = {
  date: string;
  adj_close: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
};

type ChartPoint = {
  date: string;
  value: number | null;
  isFuture?: boolean;
  ewma_forecast?: number | null;
};

const normalizeDateString = (value: string): string => {
  if (!value) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString().split('T')[0];
};

async function main() {
  const symbol = process.argv[2] || 'AAPL';
  const range = (process.argv[3] as any) || '1M';
  const canonical = JSON.parse(fs.readFileSync(`data/canonical/${symbol}.json`, 'utf-8'));
  const fullData: PricePoint[] = canonical.rows
    .filter((row: any) => row.valid !== false)
    .map((row: any) => ({
      date: row.date,
      adj_close: typeof row.adj_close === 'number' ? row.adj_close : row.close,
    }))
    .filter((p: PricePoint) => !isNaN(p.adj_close))
    .sort((a: PricePoint, b: PricePoint) => a.date.localeCompare(b.date));

  const rangeData = sliceByRange(fullData, range);
  const allDates = fullData.map((p) => p.date);
  const lastDate = rangeData[rangeData.length - 1]?.date;
  const futureDates = lastDate ? getNextTradingDates(lastDate, 1, allDates) : [];
  const chartData: ChartPoint[] = [
    ...rangeData.map((p) => ({ date: p.date, value: p.adj_close, isFuture: false })),
    ...futureDates.map((d) => ({ date: d, value: null, isFuture: true })),
  ];

  const ewma = await runEwmaWalker({ symbol });
  const ewmaMap = new Map<string, number>();
  ewma.points.forEach((p) => {
    ewmaMap.set(normalizeDateString(p.date_tp1), p.y_hat_tp1);
  });

  const merged = chartData.map((point) => {
    const d = normalizeDateString(point.date);
    const ewmaValue = ewmaMap.get(d);
    return { ...point, ewma_forecast: ewmaValue ?? null };
  });

  // Interpolation logic from component
  for (let i = 0; i < merged.length; i++) {
    if (merged[i].ewma_forecast != null) continue;
    const gapStart = i - 1;
    if (gapStart < 0 || merged[gapStart].ewma_forecast == null) continue;
    let gapEnd = i;
    while (gapEnd < merged.length && merged[gapEnd].ewma_forecast == null) {
      gapEnd++;
    }
    if (gapEnd >= merged.length || merged[gapEnd].ewma_forecast == null) break;
    const prev = merged[gapStart];
    const next = merged[gapEnd];
    const totalSteps = gapEnd - gapStart;
    for (let step = 1; step < totalSteps; step++) {
      const idx = gapStart + step;
      const t = step / totalSteps;
      merged[idx] = {
        ...merged[idx],
        ewma_forecast: prev.ewma_forecast! + t * (next.ewma_forecast! - prev.ewma_forecast!),
      };
    }
    i = gapEnd;
  }

  const missing = merged
    .map((p, idx) => ({ ...p, idx }))
    .filter((p) => !p.isFuture && p.ewma_forecast == null);
  console.log('Range', range, 'points', merged.length, 'missing hist', missing.length);
  if (missing.length) {
    missing.forEach((m) => console.log('missing', m.idx, m.date));
  }
}

main();
