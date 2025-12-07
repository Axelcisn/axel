/**
 * Average Directional Index (ADX) Indicator
 * 
 * Welles Wilder's ADX measures trend strength (not direction).
 * Components: +DI (Plus Directional Indicator), -DI (Minus Directional Indicator), ADX
 * 
 * Standard period: 14
 */

import { trueRange, wilderSmooth } from '@/lib/indicators/utils';

export interface AdxPoint {
  date: string;
  plusDI: number;   // +DI (0-100)
  minusDI: number;  // -DI (0-100)
  adx: number;      // ADX (0-100)
}

export type AdxTrendStrength = 'weak' | 'normal' | 'strong' | 'very-strong';

export interface AdxResult {
  points: AdxPoint[];
  latest: AdxPoint | null;
  period: number;
  trendStrength: AdxTrendStrength | null;
}

/**
 * Determine trend strength label from ADX value
 */
function getTrendStrength(adx: number): AdxTrendStrength {
  if (adx < 20) return 'weak';
  if (adx < 40) return 'normal';
  if (adx < 60) return 'strong';
  return 'very-strong';
}

/**
 * Compute ADX indicator using Wilder's method
 * 
 * @param rows - Array of { date, high, low, close } in ascending date order
 * @param period - Lookback period (default: 14)
 * @returns AdxResult with computed points
 */
export function computeAdx(
  rows: { date: string; high: number; low: number; close: number }[],
  period: number = 14
): AdxResult {
  // Validate inputs
  if (!rows || rows.length === 0) {
    return { points: [], latest: null, period, trendStrength: null };
  }
  
  if (period < 1) {
    period = 1;
  }
  
  // Need at least 2 * period rows to get meaningful ADX
  // (period for first DI smoothing + period for ADX smoothing)
  if (rows.length < 2) {
    return { points: [], latest: null, period, trendStrength: null };
  }
  
  const n = rows.length;
  
  // Arrays for raw values (starting from index 1, so length n-1)
  const trRaw: number[] = [];
  const plusDMRaw: number[] = [];
  const minusDMRaw: number[] = [];
  const dates: string[] = [];
  
  // Step 1: Calculate raw TR, +DM, -DM for each bar (starting from index 1)
  for (let i = 1; i < n; i++) {
    const curr = rows[i];
    const prev = rows[i - 1];
    
    // True Range
    const tr = trueRange(curr.high, curr.low, prev.close);
    
    // Directional Movement
    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;
    
    // +DM: if upMove > downMove AND upMove > 0, then +DM = upMove, else 0
    const plusDM = (upMove > downMove && upMove > 0) ? upMove : 0;
    
    // -DM: if downMove > upMove AND downMove > 0, then -DM = downMove, else 0
    const minusDM = (downMove > upMove && downMove > 0) ? downMove : 0;
    
    trRaw.push(tr);
    plusDMRaw.push(plusDM);
    minusDMRaw.push(minusDM);
    dates.push(curr.date);
  }
  
  // Step 2: Smooth TR, +DM, -DM using Wilder smoothing
  const smoothedTR = wilderSmooth(trRaw, period);
  const smoothedPlusDM = wilderSmooth(plusDMRaw, period);
  const smoothedMinusDM = wilderSmooth(minusDMRaw, period);
  
  // Step 3: Calculate +DI, -DI, and DX
  const plusDI: number[] = [];
  const minusDI: number[] = [];
  const dx: number[] = [];
  
  for (let i = 0; i < smoothedTR.length; i++) {
    const sTR = smoothedTR[i];
    const sPlusDM = smoothedPlusDM[i];
    const sMinusDM = smoothedMinusDM[i];
    
    if (!isFinite(sTR) || sTR === 0 || !isFinite(sPlusDM) || !isFinite(sMinusDM)) {
      plusDI.push(NaN);
      minusDI.push(NaN);
      dx.push(NaN);
      continue;
    }
    
    // +DI = 100 * smoothedPlusDM / smoothedTR
    const pDI = 100 * sPlusDM / sTR;
    // -DI = 100 * smoothedMinusDM / smoothedTR
    const mDI = 100 * sMinusDM / sTR;
    
    plusDI.push(pDI);
    minusDI.push(mDI);
    
    // DX = 100 * |+DI - -DI| / (+DI + -DI)
    const diSum = pDI + mDI;
    const dxVal = diSum !== 0 ? 100 * Math.abs(pDI - mDI) / diSum : 0;
    dx.push(dxVal);
  }
  
  // Step 4: Smooth DX to get ADX
  // Find the first valid index in DX (where smoothed values became valid)
  let firstValidDxIndex = 0;
  for (let i = 0; i < dx.length; i++) {
    if (isFinite(dx[i])) {
      firstValidDxIndex = i;
      break;
    }
  }
  
  // Extract only valid DX values for smoothing
  const validDx = dx.slice(firstValidDxIndex);
  const adxSmoothedValid = wilderSmooth(validDx, period);
  
  // Map back to original indices
  const adxSmoothed = new Array(dx.length).fill(NaN);
  for (let i = 0; i < adxSmoothedValid.length; i++) {
    adxSmoothed[firstValidDxIndex + i] = adxSmoothedValid[i];
  }
  
  // Step 5: Build result points (only where ADX is valid)
  const points: AdxPoint[] = [];
  
  for (let i = 0; i < adxSmoothed.length; i++) {
    const adxVal = adxSmoothed[i];
    const pDI = plusDI[i];
    const mDI = minusDI[i];
    
    // Only include points where ADX is computed
    if (!isFinite(adxVal) || !isFinite(pDI) || !isFinite(mDI)) {
      continue;
    }
    
    points.push({
      date: dates[i],
      plusDI: pDI,
      minusDI: mDI,
      adx: adxVal,
    });
  }
  
  const latest = points.length > 0 ? points[points.length - 1] : null;
  const trendStrength = latest ? getTrendStrength(latest.adx) : null;
  
  return {
    points,
    latest,
    period,
    trendStrength,
  };
}
