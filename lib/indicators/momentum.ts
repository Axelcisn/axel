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
