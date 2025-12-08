import { exponentialMovingAverage } from '@/lib/indicators/utils';

export interface EwmaPoint {
  date: string;
  value: number;
}

export interface EwmaCrossoverEvent {
  date: string;
  direction: 'bullish' | 'bearish';
  index: number;
  daysAgo: number;
}

/**
 * Compute an EWMA series for a given window over close prices.
 * Rows are assumed sorted ascending by date.
 */
export function computeEwmaSeries(
  rows: { date: string; close: number }[],
  window: number
): EwmaPoint[] {
  if (!rows.length || window <= 0) return [];

  const values = rows.map((r) => r.close);
  const ema = exponentialMovingAverage(values, window);

  const points: EwmaPoint[] = [];
  for (let i = 0; i < rows.length; i++) {
    const v = ema[i];
    if (!Number.isFinite(v)) continue;
    points.push({ date: rows[i].date, value: v });
  }
  return points;
}

/**
 * Align two EWMA series by date, keeping only overlapping dates with finite values.
 */
function alignByDate(
  shortSeries: EwmaPoint[],
  longSeries: EwmaPoint[]
): { dates: string[]; short: number[]; long: number[] } {
  const longMap = new Map(longSeries.map((p) => [p.date, p.value]));
  const dates: string[] = [];
  const short: number[] = [];
  const long: number[] = [];

  for (const p of shortSeries) {
    const lv = longMap.get(p.date);
    if (lv == null || !Number.isFinite(lv) || !Number.isFinite(p.value)) continue;
    dates.push(p.date);
    short.push(p.value);
    long.push(lv);
  }
  return { dates, short, long };
}

/**
 * Find the last bullish/bearish crossover between short and long EWMA series.
 */
export function findLastEwmaCrossover(
  shortSeries: EwmaPoint[],
  longSeries: EwmaPoint[]
): EwmaCrossoverEvent | null {
  const { dates, short, long } = alignByDate(shortSeries, longSeries);
  const n = dates.length;
  if (n < 2) return null;

  const diff: number[] = [];
  for (let i = 0; i < n; i++) {
    diff.push(short[i] - long[i]);
  }

  let lastIndex: number | null = null;
  let lastDirection: 'bullish' | 'bearish' | null = null;

  for (let i = 1; i < n; i++) {
    const prev = diff[i - 1];
    const curr = diff[i];
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) continue;

    if (prev <= 0 && curr > 0) {
      lastIndex = i;
      lastDirection = 'bullish';
    } else if (prev >= 0 && curr < 0) {
      lastIndex = i;
      lastDirection = 'bearish';
    }
  }

  if (lastIndex == null || lastDirection == null) return null;

  const date = dates[lastIndex];
  const daysAgo = n - 1 - lastIndex;

  return { date, direction: lastDirection, index: lastIndex, daysAgo };
}

