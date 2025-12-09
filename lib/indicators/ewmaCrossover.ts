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

export type EwmaGapDirection = 'bullish' | 'bearish' | 'flat';
export type EwmaGapStrength = 'neutral' | 'mild' | 'strong' | 'extreme';
export type EwmaGapSlope = 'strengthening' | 'fading' | 'stable';

export interface EwmaGapStats {
  gap: number;
  gapPct: number;
  meanGap: number;
  stdGap: number;
  zScore: number;
  direction: EwmaGapDirection;
  strength: EwmaGapStrength;
  slope: EwmaGapSlope;
  sampleSize: number;
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

/**
 * Compute normalized gap stats between aligned short/long EWMA series.
 * Uses the last `lookback` aligned points (or fewer if not available).
 */
export function computeEwmaGapStats(
  shortSeries: EwmaPoint[],
  longSeries: EwmaPoint[],
  lookback: number = 60,
  previousZ?: number | null
): EwmaGapStats | null {
  const aligned = alignByDate(shortSeries, longSeries);
  const n = aligned.dates.length;
  if (n === 0) return null;

  const windowSize = Math.min(lookback, n);
  const start = n - windowSize;

  const gaps: number[] = [];
  for (let i = start; i < n; i++) {
    const s = aligned.short[i];
    const l = aligned.long[i];
    if (!Number.isFinite(s) || !Number.isFinite(l)) continue;
    gaps.push(s - l);
  }

  if (!gaps.length) return null;

  const latestShort = aligned.short[n - 1];
  const latestLong = aligned.long[n - 1];

  const gap = latestShort - latestLong;
  const gapPct =
    Number.isFinite(latestLong) && latestLong !== 0 ? gap / latestLong : 0;

  const sampleSize = gaps.length;
  let meanGap = 0;
  for (const g of gaps) meanGap += g;
  meanGap /= sampleSize;

  let varGap = 0;
  for (const g of gaps) {
    const d = g - meanGap;
    varGap += d * d;
  }
  varGap /= sampleSize;
  const stdGap = Math.sqrt(varGap);

  let zScore = 0;
  if (stdGap > 1e-8) {
    zScore = (gap - meanGap) / stdGap;
  }

  const absZ = Math.abs(zScore);

  // Direction should be based on the raw gap (short - long), not on z-score
  let direction: EwmaGapDirection = 'flat';
  if (gap > 0) {
    direction = 'bullish';
  } else if (gap < 0) {
    direction = 'bearish';
  }

  let strength: EwmaGapStrength = 'neutral';
  if (absZ >= 2.5) strength = 'extreme';
  else if (absZ >= 1.5) strength = 'strong';
  else if (absZ >= 0.5) strength = 'mild';

  let slope: EwmaGapSlope = 'stable';
  if (previousZ != null && Number.isFinite(previousZ)) {
    const deltaZ = zScore - previousZ;
    const slopeThreshold = 0.1; // ignore tiny wiggles
    if (deltaZ > slopeThreshold) slope = 'strengthening';
    else if (deltaZ < -slopeThreshold) slope = 'fading';
  }

  return {
    gap,
    gapPct,
    meanGap,
    stdGap,
    zScore,
    direction,
    strength,
    slope,
    sampleSize,
  };
}
