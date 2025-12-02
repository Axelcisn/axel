import { sliceByRange } from './lib/chart/ranges';
import { getNextTradingDates, generateFutureTradingDates } from './lib/chart/tradingDays';
import { runEwmaWalker } from './lib/volatility/ewmaWalker';
import fs from 'fs';

type PricePoint = {
  date: string;
  adj_close: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
};

type ChartPoint = PricePoint & {
  value: number | null;
  isFuture?: boolean;
};

const normalizeDateString = (value: string): string => {
  if (!value) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return value;
  return parsed.toISOString().split('T')[0];
};

async function main() {
  const symbol = 'AAPL';
  const h = 1;
  const selectedRange = '1M';

  const canonical = JSON.parse(fs.readFileSync(`data/canonical/${symbol}.json`, 'utf-8'));
  const rows: PricePoint[] = canonical.rows
    .filter((row: any) => row.valid !== false)
    .map((row: any) => ({
      date: row.date,
      adj_close: typeof row.adj_close === 'number' ? row.adj_close : row.close,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }))
    .filter((p: PricePoint) => !isNaN(p.adj_close))
    .sort((a: PricePoint, b: PricePoint) => a.date.localeCompare(b.date));

  const fullData = rows;
  const rangeData = sliceByRange(fullData, selectedRange as any);
  const allDates = fullData.map((p) => p.date);
  const lastPoint = rangeData[rangeData.length - 1];
  const lastDateStr = lastPoint?.date;

  const futureDates = ((): string[] => {
    if (!lastDateStr || h <= 0) return [];
    const historicalFuture = getNextTradingDates(lastDateStr, h, allDates);
    if (historicalFuture.length > 0) return historicalFuture;
    return generateFutureTradingDates(lastDateStr, h);
  })();

  const base: ChartPoint[] = rangeData.map((p) => ({
    ...p,
    value: p.adj_close,
    isFuture: false,
  }));

  const futurePoints: ChartPoint[] = futureDates.map((d) => ({
    date: d,
    adj_close: 0,
    value: null,
    isFuture: true,
  }));

  const chartData = [...base, ...futurePoints];

  const ewmaResult = await runEwmaWalker({ symbol });
  const ewmaMap = new Map<string, { forecast: number }>();
  ewmaResult.points.forEach((point) => {
    ewmaMap.set(normalizeDateString(point.date_tp1), { forecast: point.y_hat_tp1 });
  });

  const result = chartData.map((point) => {
    const chartDate = normalizeDateString(point.date);
    const ewmaData = ewmaMap.get(chartDate);
    return {
      ...point,
      ewma_forecast: ewmaData ? ewmaData.forecast : null,
    };
  });

  const missing = result.filter((p) => p.ewma_forecast == null && !p.isFuture);
  console.log('Total points', result.length, 'missing historical', missing.length);
  console.log('Missing dates:', missing.map((p) => p.date));
  console.log('Sample data points with ewma:', result.filter((p) => p.ewma_forecast != null).slice(0,5));
}

main();
