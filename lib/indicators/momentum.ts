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
