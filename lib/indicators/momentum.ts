import { exponentialMovingAverage } from '@/lib/indicators/utils';

/**
 * Momentum / Rate of Change (ROC) Indicator
 * 
 * Measures the change in price over N periods.
 * - Momentum = Close_t - Close_{t-N}
 * - Momentum% = (Close_t - Close_{t-N}) / Close_{t-N}
 */

export interface MomentumPoint {
  date: string;        // date of the current bar
  close: number;       // close price at date
  momentum: number;    // close_t - close_{t-period}
  momentumPct: number; // (close_t - close_{t-period}) / close_{t-period}
}

export interface MomentumResult {
  points: MomentumPoint[];
  latest: MomentumPoint | null;
  period: number;
}

// Normalization bounds for momentum% → score
export const MOMENTUM_MIN_PCT = -0.10; // -10%
export const MOMENTUM_MAX_PCT = 0.10;  // +10%

export type MomentumZone = 'oversold' | 'neutral' | 'overbought';

export type MomentumRegime =
  | 'strong_up'
  | 'up'
  | 'flat'
  | 'down'
  | 'strong_down';

export type MomentumMode = 'roc' | 'rsi' | 'macd';

export interface RocMetrics {
  roc: number;
  zScore: number;
  regime: 'neutral' | 'up' | 'strong_up' | 'down' | 'strong_down';
  zeroCross?: { direction: 'up' | 'down'; barsAgo: number };
  extreme?: 'none' | 'positive' | 'negative';
}

export interface RsiMetrics {
  rsi: number;
  regime: 'strong_up' | 'up' | 'neutral' | 'down' | 'strong_down';
  band: 'overbought' | 'oversold' | 'neutral';
  centerCross?: { direction: 'up' | 'down'; barsAgo: number };
  bandCross?: { band: 'overbought' | 'oversold'; barsAgo: number } | null;
}

export interface MacdMetrics {
  macdLine: number;
  signal: number;
  hist: number;
  macdNorm: number;
  regime: 'neutral' | 'up' | 'strong_up' | 'down' | 'strong_down';
  signalCross?: { direction: 'up' | 'down'; barsAgo: number };
  centerCross?: { direction: 'up' | 'down'; barsAgo: number };
  histSlope: 'strengthening' | 'fading' | 'flat';
}

export interface RsiPoint {
  date: string;
  rsi: number;
}

export interface MacdPoint {
  date: string;
  macdLine: number;
  signal: number;
  hist: number;
  macdNorm: number;
}

export interface MomentumScorePoint {
  date: string;
  score: number;   // 0..100
  zone: MomentumZone;
}

export interface MomentumZeroCross {
  date: string;
  direction: 'neg_to_pos' | 'pos_to_neg';
  index: number;
  barsAgo: number;
}

/**
 * Compute Momentum indicator
 * 
 * @param rows - Array of { date, close } in ascending date order
 * @param period - Lookback period (default: 10)
 * @returns MomentumResult with computed points
 */
export function computeMomentum(
  rows: { date: string; close: number }[],
  period: number = 10
): MomentumResult {
  // Validate inputs
  if (!rows || rows.length === 0) {
    return { points: [], latest: null, period };
  }
  
  if (period < 1) {
    period = 1;
  }
  
  const points: MomentumPoint[] = [];
  
  // Need at least period + 1 rows to compute first momentum
  if (rows.length <= period) {
    return { points: [], latest: null, period };
  }
  
  // Compute momentum for each valid index
  for (let i = period; i < rows.length; i++) {
    const current = rows[i];
    const prev = rows[i - period];
    
    // Skip if data is invalid
    if (!isFinite(current.close) || !isFinite(prev.close)) {
      continue;
    }
    
    const momentum = current.close - prev.close;
    const momentumPct = prev.close !== 0 
      ? momentum / prev.close 
      : 0;
    
    points.push({
      date: current.date,
      close: current.close,
      momentum,
      momentumPct,
    });
  }
  
  const latest = points.length > 0 ? points[points.length - 1] : null;
  
  return {
    points,
    latest,
    period,
  };
}

export function momentumPctToScore(momentumPct: number): number {
  if (!Number.isFinite(momentumPct)) return 50;
  const clamped = Math.max(MOMENTUM_MIN_PCT, Math.min(MOMENTUM_MAX_PCT, momentumPct));
  const raw = (clamped - MOMENTUM_MIN_PCT) / (MOMENTUM_MAX_PCT - MOMENTUM_MIN_PCT); // 0..1
  return raw * 100;
}

export function momentumZoneFromScore(score: number): MomentumZone {
  if (!Number.isFinite(score)) return 'neutral';
  if (score >= 70) return 'overbought';
  if (score <= 30) return 'oversold';
  return 'neutral';
}

export function classifyMomentumRegime(momentumPct: number): MomentumRegime {
  if (!Number.isFinite(momentumPct)) return 'flat';
  const pct = momentumPct * 100;

  if (pct >= 2) return 'strong_up';
  if (pct > 0) return 'up';
  if (pct <= -2) return 'strong_down';
  if (pct < 0) return 'down';
  return 'flat';
}

export function buildMomentumScoreSeries(
  points: MomentumPoint[]
): MomentumScorePoint[] {
  return points.map((p) => {
    const score = momentumPctToScore(p.momentumPct);
    return {
      date: p.date,
      score,
      zone: momentumZoneFromScore(score),
    };
  });
}

export function findLastMomentumZeroCross(
  points: MomentumPoint[]
): MomentumZeroCross | null {
  if (!points || points.length < 2) return null;

  const n = points.length;
  let last: MomentumZeroCross | null = null;

  for (let i = 1; i < n; i++) {
    const prev = points[i - 1].momentumPct;
    const curr = points[i].momentumPct;
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) continue;

    if (prev <= 0 && curr > 0) {
      last = {
        date: points[i].date,
        direction: 'neg_to_pos',
        index: i,
        barsAgo: n - 1 - i,
      };
    } else if (prev >= 0 && curr < 0) {
      last = {
        date: points[i].date,
        direction: 'pos_to_neg',
        index: i,
        barsAgo: n - 1 - i,
      };
    }
  }

  return last;
}

export function computeRocZScore(points: MomentumPoint[]): { zScore: number; sigma: number } {
  if (!points.length) return { zScore: 0, sigma: 0 };

  const values = points.map((p) => p.momentumPct).filter((v) => Number.isFinite(v));
  if (!values.length) return { zScore: 0, sigma: 0 };

  const latest = values[values.length - 1];

  let mean = 0;
  for (const v of values) mean += v;
  mean /= values.length;

  let variance = 0;
  for (const v of values) {
    const d = v - mean;
    variance += d * d;
  }
  variance /= values.length;
  const sigma = Math.sqrt(variance);

  let zScore = 0;
  if (sigma > 1e-8) {
    zScore = latest / sigma;
  }

  return { zScore, sigma };
}

export function classifyRocRegime(roc: number, zScore: number): RocMetrics['regime'] {
  const absZ = Math.abs(zScore);
  if (absZ < 0.5) return 'neutral';
  if (roc > 0) {
    return absZ >= 1.5 ? 'strong_up' : 'up';
  }
  if (roc < 0) {
    return absZ >= 1.5 ? 'strong_down' : 'down';
  }
  return 'neutral';
}

export function computeRsi(
  rows: { date: string; close: number }[],
  period: number = 14
): { points: RsiPoint[]; latest: RsiPoint | null } {
  if (rows.length < period + 1) {
    return { points: [], latest: null };
  }

  const changes: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    changes.push(rows[i].close - rows[i - 1].close);
  }

  const gains: number[] = [];
  const losses: number[] = [];
  for (const c of changes) {
    gains.push(Math.max(c, 0));
    losses.push(Math.max(-c, 0));
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  const points: RsiPoint[] = [];

  for (let i = period; i < gains.length; i++) {
    if (i > period) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }

    let rsi: number;
    if (avgLoss === 0) {
      rsi = 100;
    } else if (avgGain === 0) {
      rsi = 0;
    } else {
      const rs = avgGain / avgLoss;
      rsi = 100 - 100 / (1 + rs);
    }

    points.push({
      date: rows[i + 1].date,
      rsi,
    });
  }

  const latest = points.length ? points[points.length - 1] : null;
  return { points, latest };
}

export function classifyRsiRegime(r: number): RsiMetrics['regime'] {
  if (r >= 70) return 'strong_up';
  if (r >= 55) return 'up';
  if (r > 45 && r < 55) return 'neutral';
  if (r >= 30) return 'down';
  return 'strong_down';
}

export function rsiBand(r: number): RsiMetrics['band'] {
  if (r >= 70) return 'overbought';
  if (r <= 30) return 'oversold';
  return 'neutral';
}

export function findLastRsiCenterCross(points: RsiPoint[]): RsiMetrics['centerCross'] {
  if (points.length < 2) return undefined;
  const n = points.length;
  let last: RsiMetrics['centerCross'] | undefined;
  for (let i = 1; i < n; i++) {
    const prev = points[i - 1].rsi;
    const curr = points[i].rsi;
    if (prev <= 50 && curr > 50) {
      last = { direction: 'up', barsAgo: n - 1 - i };
    } else if (prev >= 50 && curr < 50) {
      last = { direction: 'down', barsAgo: n - 1 - i };
    }
  }
  return last;
}

export function findLastRsiBandCross(points: RsiPoint[]): RsiMetrics['bandCross'] {
  if (points.length < 2) return null;
  const n = points.length;
  let last: RsiMetrics['bandCross'] | null = null;
  for (let i = 1; i < n; i++) {
    const prev = points[i - 1].rsi;
    const curr = points[i].rsi;
    if (prev <= 70 && curr > 70) {
      last = { band: 'overbought', barsAgo: n - 1 - i };
    } else if (prev >= 30 && curr < 30) {
      last = { band: 'oversold', barsAgo: n - 1 - i };
    }
  }
  return last;
}

export function computeMacd(
  rows: { date: string; close: number }[],
  shortPeriod: number = 12,
  longPeriod: number = 26,
  signalPeriod: number = 9
): { points: MacdPoint[]; latest: MacdPoint | null } {
  if (rows.length < longPeriod + signalPeriod) {
    return { points: [], latest: null };
  }

  const closes = rows.map((r) => r.close);
  const emaShort = exponentialMovingAverage(closes, shortPeriod);
  const emaLong = exponentialMovingAverage(closes, longPeriod);

  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const s = emaShort[i];
    const l = emaLong[i];
    macdLine.push(Number.isFinite(s) && Number.isFinite(l) ? s - l : NaN);
  }

  const signal = exponentialMovingAverage(macdLine, signalPeriod);
  const points: MacdPoint[] = [];

  for (let i = 0; i < closes.length; i++) {
    const m = macdLine[i];
    const s = signal[i];
    if (!Number.isFinite(m) || !Number.isFinite(s)) continue;

    const hist = m - s;
    const price = closes[i];
    const macdNorm = price !== 0 ? m / price : 0;

    points.push({
      date: rows[i].date,
      macdLine: m,
      signal: s,
      hist,
      macdNorm,
    });
  }

  const latest = points.length ? points[points.length - 1] : null;
  return { points, latest };
}

export function classifyMacdRegime(m: number, macdNorm: number): MacdMetrics['regime'] {
  const a = Math.abs(macdNorm);
  if (a < 0.001) return 'neutral';
  if (m > 0) {
    return a >= 0.005 ? 'strong_up' : 'up';
  }
  if (m < 0) {
    return a >= 0.005 ? 'strong_down' : 'down';
  }
  return 'neutral';
}

export function findLastMacdSignalCross(points: MacdPoint[]): MacdMetrics['signalCross'] {
  if (points.length < 2) return undefined;
  const n = points.length;
  let last: MacdMetrics['signalCross'] | undefined;
  for (let i = 1; i < n; i++) {
    const prevDiff = points[i - 1].macdLine - points[i - 1].signal;
    const currDiff = points[i].macdLine - points[i].signal;
    if (prevDiff <= 0 && currDiff > 0) {
      last = { direction: 'up', barsAgo: n - 1 - i };
    } else if (prevDiff >= 0 && currDiff < 0) {
      last = { direction: 'down', barsAgo: n - 1 - i };
    }
  }
  return last;
}

export function findLastMacdCenterCross(points: MacdPoint[]): MacdMetrics['centerCross'] {
  if (points.length < 2) return undefined;
  const n = points.length;
  let last: MacdMetrics['centerCross'] | undefined;
  for (let i = 1; i < n; i++) {
    const prev = points[i - 1].macdLine;
    const curr = points[i].macdLine;
    if (prev <= 0 && curr > 0) {
      last = { direction: 'up', barsAgo: n - 1 - i };
    } else if (prev >= 0 && curr < 0) {
      last = { direction: 'down', barsAgo: n - 1 - i };
    }
  }
  return last;
}

export function classifyMacdHistSlope(points: MacdPoint[]): MacdMetrics['histSlope'] {
  if (points.length < 2) return 'flat';
  const last = points[points.length - 1].hist;
  const prev = points[points.length - 2].hist;
  if (last > prev) return 'strengthening';
  if (last < prev) return 'fading';
  return 'flat';
}
