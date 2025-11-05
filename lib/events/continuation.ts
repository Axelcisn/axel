import { getFinalForecastForDate } from '../forecast/store';
import { listEvents, appendEvent } from './store';
import { isTradingDate, nextTradingDate, previousTradingDate } from './dates';
import { loadCanonicalData } from '../storage/canonical';
import { EventRecord, StopRule } from './types';

/** Decide stop and update the event for a single verification day D. */
export async function tickEventForDate(
  ev: EventRecord,
  D_date: string,
  options: { stop_rule: StopRule; k_inside: 1 | 2; T_max: number }
): Promise<{ updated: EventRecord; action: "continue" | "stop" | "censor" | "pause" }> {
  
  // 1. Skip non-trading / missing data
  if (!isTradingDate(D_date, 'UTC')) {
    return { updated: ev, action: "pause" };
  }

  // Load canonical data for S_D and S_{D-1}
  const canonicalData = await loadCanonicalData(ev.symbol);
  const priceMap = new Map<string, number>();
  canonicalData.forEach(row => {
    if (row.adj_close) {
      priceMap.set(row.date, row.adj_close);
    }
  });

  const S_D = priceMap.get(D_date);
  if (!S_D) {
    return { updated: ev, action: "pause" };
  }

  const D_minus_1 = previousTradingDate(D_date, 'UTC');
  const S_D_minus_1 = priceMap.get(D_minus_1);
  if (!S_D_minus_1) {
    return { updated: ev, action: "pause" };
  }

  // 2. Fetch contemporaneous PI
  const forecast = await getFinalForecastForDate(ev.symbol, D_minus_1);
  if (!forecast || !forecast.intervals) {
    return { updated: ev, action: "pause" };
  }

  const L_1 = forecast.intervals.L_h;
  const U_1 = forecast.intervals.U_h;

  // 3. Compute inside/outside & sign
  const outside_1d = (S_D < L_1) || (S_D > U_1);
  const r_D = Math.log(S_D / S_D_minus_1);
  const sign_flip = Math.sign(r_D) === -ev.direction;

  // 4. Update max_z_excess (optional enhancement)
  const m_log = forecast.diagnostics?.m_log || Math.log(S_D_minus_1);
  const s_scale = forecast.diagnostics?.s_scale || forecast.estimates?.sigma_forecast || 0.02;
  const critical_value = forecast.estimates?.critical_value || 1.96;
  
  const z_today = (Math.log(S_D) - m_log) / s_scale;
  const z_excess_today = Math.max(0, Math.abs(z_today) - critical_value);
  
  // 5. Advance T (trading-day count)
  const at_risk_days = (ev.at_risk_days || 0) + 1;
  const j = at_risk_days; // 1 for first verification day after B

  // Create updated event with increments
  const updated: EventRecord = {
    ...ev,
    at_risk_days,
    max_z_excess: Math.max(ev.max_z_excess || 0, z_excess_today),
    stop_rule: options.stop_rule,
    k_inside: options.k_inside
  };

  // 6. Apply stop rule
  if (options.stop_rule === 're-entry') {
    // Stop Rule A (re-entry)
    const inside = S_D >= L_1 && S_D <= U_1;
    
    if (inside) {
      updated.inband_streak = (ev.inband_streak || 0) + 1;
    } else {
      updated.inband_streak = 0;
    }

    if (updated.inband_streak >= options.k_inside) {
      // Stop with T = j - k_inside
      updated.T = j - options.k_inside;
      updated.D_stop = D_date;
      updated.censored = false;
      updated.event_open = false;
      return { updated, action: "stop" };
    }
  } else if (options.stop_rule === 'sign-flip') {
    // Stop Rule B (sign-flip)
    if (sign_flip) {
      // Stop with T = j - 1
      updated.T = j - 1;
      updated.D_stop = D_date;
      updated.censored = false;
      updated.event_open = false;
      return { updated, action: "stop" };
    }
  }

  // 7. Right-censoring
  if (j >= options.T_max) {
    updated.T = options.T_max;
    updated.D_stop = D_date;
    updated.censored = true;
    updated.censor_reason = "T_max";
    updated.event_open = false;
    return { updated, action: "censor" };
  }

  // 8. Otherwise continue
  return { updated, action: "continue" };
}

/** Tick the latest open event on a single date (usually "today"). */
export async function tickOpenEventForDate(
  symbol: string, 
  D_date: string, 
  options: { stop_rule: StopRule; k_inside: 1 | 2; T_max: number }
): Promise<EventRecord | null> {
  
  const events = await listEvents(symbol);
  const openEvent = events.find(e => e.event_open);
  
  if (!openEvent) {
    return null;
  }

  const result = await tickEventForDate(openEvent, D_date, options);
  
  // Persist updated event
  await appendEvent(symbol, result.updated);
  
  return result.updated;
}

/** Rescan over a range: tick each trading day until event stops/censors or end_date reached. */
export async function rescanOpenEvent(
  symbol: string,
  start_date: string,
  end_date: string,
  options: { stop_rule: StopRule; k_inside: 1 | 2; T_max: number }
): Promise<EventRecord | null> {
  
  const events = await listEvents(symbol);
  const openEvent = events.find(e => e.event_open);
  
  if (!openEvent) {
    return null;
  }

  let currentEvent = openEvent;
  let currentDate = start_date;

  // Load canonical data to get available dates
  const canonicalData = await loadCanonicalData(symbol);
  const availableDates = new Set(canonicalData.map(row => row.date));
  const lastAvailableDate = canonicalData
    .filter(row => row.adj_close)
    .map(row => row.date)
    .sort()
    .pop();

  while (currentDate <= end_date && currentEvent.event_open) {
    if (isTradingDate(currentDate, 'UTC')) {
      const result = await tickEventForDate(currentEvent, currentDate, options);
      currentEvent = result.updated;

      if (result.action === "stop" || result.action === "censor") {
        break;
      }
    }

    // Move to next trading date
    currentDate = nextTradingDate(currentDate, 'UTC');
    
    // Check if we've reached end of available data
    if (currentDate > (lastAvailableDate || '')) {
      // End-of-sample censoring
      if (currentEvent.event_open) {
        currentEvent.censored = true;
        currentEvent.censor_reason = "end_of_sample";
        currentEvent.D_stop = lastAvailableDate || currentDate;
        currentEvent.T = currentEvent.at_risk_days || 0;
        currentEvent.event_open = false;
      }
      break;
    }
  }

  // Persist final event state
  await appendEvent(symbol, currentEvent);
  
  return currentEvent;
}