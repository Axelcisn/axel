import { PIMetrics, SurvivalMetrics } from './types';
import { EventRecord } from '../events/types';

/**
 * Prediction Interval Scoring Utilities
 * 
 * Formulas:
 * coverage_hit = 1{ y_t ∈ [L_t, U_t] }
 * IS_α(y;L,U) = (U − L) + (2/α)(L − y)1{ y < L } + (2/α)(y − U)1{ y > U }
 */

/**
 * Compute coverage hit (0 or 1) for a single observation
 */
export function computeCoverageHit(y: number, L: number, U: number): 0 | 1 {
  return (y >= L && y <= U) ? 1 : 0;
}

/**
 * Compute interval score for a single observation
 * IS_α(y;L,U) = (U − L) + (2/α)(L − y)1{ y < L } + (2/α)(y − U)1{ y > U }
 */
export function computeIntervalScore(y: number, L: number, U: number, alpha: number): number {
  const width = U - L;
  const lower_penalty = y < L ? (2 / alpha) * (L - y) : 0;
  const upper_penalty = y > U ? (2 / alpha) * (y - U) : 0;
  
  return width + lower_penalty + upper_penalty;
}

/**
 * Create PIMetrics record for a single day
 */
export function createPIMetrics(
  date: string,
  y: number,
  L: number,
  U: number,
  method: string,
  alpha: number
): PIMetrics {
  return {
    date,
    y,
    L,
    U,
    cover_hit: computeCoverageHit(y, L, U),
    interval_score: computeIntervalScore(y, L, U, alpha),
    method
  };
}

/**
 * Aggregate PI metrics over a rolling window
 */
export function aggregatePIMetrics(
  metrics: PIMetrics[],
  window_days?: number
): {
  coverage: number;
  avg_interval_score: number;
  count: number;
} {
  if (metrics.length === 0) {
    return { coverage: 0, avg_interval_score: 0, count: 0 };
  }
  
  // Use most recent window_days if specified
  const metricsToUse = window_days 
    ? metrics.slice(-window_days)
    : metrics;
  
  const total_coverage = metricsToUse.reduce((sum, m) => sum + m.cover_hit, 0);
  const total_is = metricsToUse.reduce((sum, m) => sum + m.interval_score, 0);
  
  return {
    coverage: total_coverage / metricsToUse.length,
    avg_interval_score: total_is / metricsToUse.length,
    count: metricsToUse.length
  };
}

/**
 * Survival Analysis Scoring Utilities
 */

/**
 * Compute concordance index (C-index) for survival data
 * Measures discrimination ability of survival predictions
 */
export function computeCIndex(events: EventRecord[]): number {
  if (events.length < 2) return 0.5;
  
  let concordant = 0;
  let discordant = 0;
  let comparable = 0;
  
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const event1 = events[i];
      const event2 = events[j];
      
      // Only compare if we can order them meaningfully
      if (!event1.T || !event2.T) continue;
      
      // Case 1: Both events observed (not censored)
      if (!event1.censored && !event2.censored) {
        comparable++;
        // Higher |z_B| should predict shorter survival (higher risk)
        const higher_risk = Math.abs(event1.z_B) > Math.abs(event2.z_B);
        const shorter_survival = event1.T < event2.T;
        
        if (higher_risk === shorter_survival) {
          concordant++;
        } else {
          discordant++;
        }
      }
      // Case 2: One censored, one observed
      else if (!event1.censored && event2.censored) {
        if (event1.T < event2.T) { // Observed event happened before censoring
          comparable++;
          const higher_risk = Math.abs(event1.z_B) > Math.abs(event2.z_B);
          const shorter_survival = true; // event1 definitely had shorter survival
          
          if (higher_risk === shorter_survival) {
            concordant++;
          } else {
            discordant++;
          }
        }
      }
      else if (event1.censored && !event2.censored) {
        if (event2.T < event1.T) { // Observed event happened before censoring
          comparable++;
          const higher_risk = Math.abs(event1.z_B) < Math.abs(event2.z_B);
          const shorter_survival = true; // event2 definitely had shorter survival
          
          if (higher_risk === shorter_survival) {
            concordant++;
          } else {
            discordant++;
          }
        }
      }
      // Case 3: Both censored - not comparable for C-index
    }
  }
  
  return comparable > 0 ? concordant / comparable : 0.5;
}

/**
 * Compute Integrated Brier Score (IBS) over a time window
 * Measures calibration of survival predictions with IPCW adjustment
 */
export function computeIBS(events: EventRecord[], window_days: number = 20): number {
  if (events.length === 0) return 0;
  
  // Simplified IBS computation - in production would use proper IPCW
  // For now, compute average squared prediction error at fixed time points
  
  let total_bs = 0;
  let count = 0;
  
  for (let t = 1; t <= window_days; t++) {
    let bs_t = 0;
    let n_t = 0;
    
    for (const event of events) {
      if (!event.T) continue;
      
      // Actual survival at time t
      const S_actual = event.T >= t ? 1 : 0;
      
      // Predicted survival at time t (simplified using exponential model)
      const z_abs = Math.abs(event.z_B);
      const lambda = z_abs / 3.0; // Simple risk parameterization
      const S_pred = Math.exp(-lambda * t);
      
      // Brier score contribution
      bs_t += Math.pow(S_pred - S_actual, 2);
      n_t++;
    }
    
    if (n_t > 0) {
      total_bs += bs_t / n_t;
      count++;
    }
  }
  
  return count > 0 ? total_bs / count : 0;
}

/**
 * Create survival metrics summary
 */
export function createSurvivalMetrics(
  events: EventRecord[],
  window: string = "20d"
): SurvivalMetrics {
  const window_days = parseInt(window.replace('d', ''));
  
  return {
    window,
    c_index: computeCIndex(events),
    ibs: computeIBS(events, window_days)
  };
}

/**
 * Utility: Filter events by date range
 */
export function filterEventsByDateRange(
  events: EventRecord[],
  start_date?: string,
  end_date?: string
): EventRecord[] {
  return events.filter(event => {
    const B_date = event.B_date;
    
    if (start_date && B_date < start_date) return false;
    if (end_date && B_date > end_date) return false;
    
    return true;
  });
}

/**
 * Utility: Get trading days between dates (simplified)
 */
export function getTradingDaysBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(start);
  const endDate = new Date(end);
  
  while (current <= endDate) {
    // Skip weekends (simplified - real implementation would use trading calendar)
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      dates.push(current.toISOString().split('T')[0]);
    }
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
}