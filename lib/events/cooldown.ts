import { getFinalForecastForDate } from '../forecast/store';
import { getOpenEvent } from './store';
import { loadCanonicalData } from '../storage/canonical';

export type CooldownCheck = {
  ok: boolean;
  inside_count: number;    // how many consecutive in-band days found
  reason?: string;
};

/**
 * Verify K_inside consecutive in-band days before B_date.
 * For j=1..K_inside, check day (t−(j−1))'s PI made at (t−j) vs realized (t−(j−1)).
 * If any PI is missing for those days, treat as "insufficient evidence" and fail softly unless there is no open event.
 */
export async function checkCooldown(
  symbol: string,
  t_date: string,        // forecast day t (we will verify at t+1)
  K_inside: number
): Promise<CooldownCheck> {
  
  // First check: if an open event exists → immediately fail
  const openEvent = await getOpenEvent(symbol);
  if (openEvent) {
    return {
      ok: false,
      inside_count: 0,
      reason: "open_event"
    };
  }
  
  try {
    // Load canonical data for price lookups
    const canonicalData = await loadCanonicalData(symbol);
    const priceMap = new Map<string, number>();
    canonicalData.forEach(row => {
      if (row.adj_close) {
        priceMap.set(row.date, row.adj_close);
      }
    });
    
    let consecutiveInside = 0;
    let missingPIs = false;
    
    // Check K_inside days backwards from t_date
    for (let j = 1; j <= K_inside; j++) {
      // Day we're checking: t - (j-1)
      const checkDate = subtractBusinessDays(t_date, j - 1);
      if (!checkDate) {
        missingPIs = true;
        break;
      }
      
      // PI was made at: t - j
      const piDate = subtractBusinessDays(t_date, j);
      if (!piDate) {
        missingPIs = true;
        break;
      }
      
      // Load the PI made at piDate
      const forecast = await getFinalForecastForDate(symbol, piDate);
      if (!forecast || !forecast.intervals) {
        missingPIs = true;
        break;
      }
      
      // Get realized price at checkDate
      const S_check = priceMap.get(checkDate);
      if (!S_check) {
        missingPIs = true;
        break;
      }
      
      // Check if S_check was inside the PI
      const L_1 = forecast.intervals.L_h;
      const U_1 = forecast.intervals.U_h;
      
      const inside = (S_check >= L_1 && S_check <= U_1);
      
      if (inside) {
        consecutiveInside++;
      } else {
        // Not inside, break the streak
        break;
      }
    }
    
    // Evaluate result
    if (missingPIs) {
      // Soft pass: missing PIs but no open event
      return {
        ok: true,
        inside_count: consecutiveInside,
        reason: "soft_pass_missing_PIs"
      };
    }
    
    if (consecutiveInside >= K_inside) {
      return {
        ok: true,
        inside_count: consecutiveInside
      };
    } else {
      return {
        ok: false,
        inside_count: consecutiveInside,
        reason: `need_${K_inside}_inside_days`
      };
    }
    
  } catch (error) {
    console.warn('Error in cooldown check:', error);
    // Soft pass on errors if no open event
    return {
      ok: true,
      inside_count: 0,
      reason: "soft_pass_error"
    };
  }
}

/**
 * Subtract business days from a date string
 */
function subtractBusinessDays(dateStr: string, days: number): string | null {
  try {
    const date = new Date(dateStr);
    let count = 0;
    
    while (count < days) {
      date.setDate(date.getDate() - 1);
      
      // Skip weekends (0 = Sunday, 6 = Saturday)
      const dayOfWeek = date.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        count++;
      }
    }
    
    return date.toISOString().split('T')[0];
  } catch (error) {
    return null;
  }
}