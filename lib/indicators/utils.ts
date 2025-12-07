/**
 * Indicator utility functions
 * Pure math helpers for technical indicators
 */

/**
 * Calculate True Range for a single bar
 * TR = max(high - low, |high - prevClose|, |low - prevClose|)
 */
export function trueRange(
  high: number,
  low: number,
  prevClose: number
): number {
  if (!isFinite(high) || !isFinite(low) || !isFinite(prevClose)) {
    return NaN;
  }
  
  const hl = high - low;
  const hpc = Math.abs(high - prevClose);
  const lpc = Math.abs(low - prevClose);
  
  return Math.max(hl, hpc, lpc);
}

/**
 * Wilder's smoothing (used in ADX, RSI, ATR)
 * - First value: simple average of the first `period` raw values
 * - Subsequent values: prevSmoothed * (period - 1) / period + currentRaw / period
 *   which is equivalent to: prevSmoothed + (currentRaw - prevSmoothed) / period
 * 
 * Returns array of same length as input, with NaN for indices where
 * smoothing cannot yet be computed.
 */
export function wilderSmooth(values: number[], period: number): number[] {
  if (!values || values.length === 0 || period < 1) {
    return [];
  }
  
  const result: number[] = new Array(values.length).fill(NaN);
  
  if (values.length < period) {
    return result;
  }
  
  // First smoothed value: simple average of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    if (!isFinite(values[i])) {
      return result; // Can't compute if early values are invalid
    }
    sum += values[i];
  }
  
  result[period - 1] = sum / period;
  
  // Subsequent values using Wilder's smoothing formula:
  // smoothed = prevSmoothed + (currentRaw - prevSmoothed) / period
  // which equals: prevSmoothed * (1 - 1/period) + currentRaw / period
  const alpha = 1 / period;
  for (let i = period; i < values.length; i++) {
    const prev = result[i - 1];
    const current = values[i];
    
    if (!isFinite(prev) || !isFinite(current)) {
      result[i] = NaN;
    } else {
      result[i] = prev + (current - prev) * alpha;
    }
  }
  
  return result;
}

/**
 * Simple Moving Average
 * For each index i >= period-1, average values[i-period+1..i]
 * Earlier indices return NaN
 */
export function simpleMovingAverage(values: number[], period: number): number[] {
  if (!values || values.length === 0 || period < 1) {
    return [];
  }
  
  const result: number[] = new Array(values.length).fill(NaN);
  
  if (values.length < period) {
    return result;
  }
  
  // Calculate first SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  result[period - 1] = sum / period;
  
  // Rolling window for subsequent values
  for (let i = period; i < values.length; i++) {
    sum = sum - values[i - period] + values[i];
    result[i] = sum / period;
  }
  
  return result;
}

/**
 * Exponential Moving Average
 * EMA_t = α * value_t + (1 - α) * EMA_{t-1}
 * where α = 2 / (period + 1)
 */
export function exponentialMovingAverage(values: number[], period: number): number[] {
  if (!values || values.length === 0 || period < 1) {
    return [];
  }
  
  const result: number[] = new Array(values.length).fill(NaN);
  
  if (values.length < period) {
    return result;
  }
  
  const alpha = 2 / (period + 1);
  
  // First EMA: SMA of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  result[period - 1] = sum / period;
  
  // Subsequent EMAs
  for (let i = period; i < values.length; i++) {
    result[i] = alpha * values[i] + (1 - alpha) * result[i - 1];
  }
  
  return result;
}
