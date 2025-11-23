import { getFinalForecastForDate } from '../forecast/store';
import { appendEvent, listEvents, getOpenEvent } from './store';
import { computeVolRegimePercentile } from './volRegime';
import { checkCooldown } from './cooldown';
import { loadCanonicalData } from '../storage/canonical';
import { EventRecord, EventDirection } from './types';
import { randomUUID } from 'crypto';

export async function detectBreakoutForDate(symbol: string, t_date: string): Promise<EventRecord | null> {
  // 1) Load the Final PI forecast made at t_date
  const f = await getFinalForecastForDate(symbol, t_date);
  if (!f) {
    throw new Error(`No Final PI for ${symbol} at ${t_date}`);
  }
  
  if (!f.intervals) {
    throw new Error(`No intervals in Final PI for ${symbol} at ${t_date}`);
  }
  
  // 2) Pull canonical S_t and S_{t+1}; require S_{t+1} exists
  const canonicalData = await loadCanonicalData(symbol);
  const priceMap = new Map<string, number>();
  canonicalData.forEach(row => {
    if (row.adj_close) {
      priceMap.set(row.date, row.adj_close);
    }
  });
  
  const S_t = priceMap.get(t_date);
  const B_date = getNextTradingDay(t_date, canonicalData);
  
  if (!S_t || !B_date) {
    throw new Error(`Missing price data for ${symbol}: S_t=${S_t}, B_date=${B_date}`);
  }
  
  const S_t_plus_1 = priceMap.get(B_date);
  if (!S_t_plus_1) {
    throw new Error(`S_{t+1} not available yet for ${symbol} at ${B_date}`);
  }
  
  // Extract forecast values
  const L_1 = f.intervals.L_h;
  const U_1 = f.intervals.U_h;
  const m_log = f.diagnostics?.m_log || Math.log(S_t); // m_t(h)
  const s_scale = f.diagnostics?.s_scale || f.estimates?.sigma_forecast || 0.02; // s_t(h)
  const critical_value = f.estimates?.critical_value || 1.96; // c
  const mu_star_used = f.estimates?.mu_star_used || 0; // drift used
  const sigma_forecast_1d = f.estimates?.sigma_forecast || null;
  
  // Get horizon information from forecast
  const h_eff = f.h_eff_days || 1; // Calendar days horizon
  const horizonTrading = f.horizonTrading || 1; // Trading days horizon
  
  // 3) outside_1d = (S_{t+1} < L_1) || (S_{t+1} > U_1); if not, return null
  const outside_1d = (S_t_plus_1 < L_1) || (S_t_plus_1 > U_1);
  if (!outside_1d) {
    return null; // No breakout
  }
  
  // 4) Cool-down check: K_inside = 3
  const cooldownResult = await checkCooldown(symbol, t_date, 3);
  if (!cooldownResult.ok) {
    throw new Error(`Cooldown failed: ${cooldownResult.reason}`);
  }
  
  // 5) Compute magnitudes at breakout B = (t+1):
  const direction: EventDirection = S_t_plus_1 > U_1 ? 1 : -1; // +1 up, -1 down
  
  // z_B = [ ln(S_{t+1}) − ( ln(S_t) + mu_star_used * h_eff ) ] / (sigma_forecast * sqrt(h_eff))
  const sigma_hat = f.estimates?.sigma_hat || s_scale; // Use original daily volatility
  const z_B = (Math.log(S_t_plus_1) - (Math.log(S_t) + mu_star_used * h_eff)) / (sigma_hat * Math.sqrt(h_eff));
  
  // z_excess_B = |z_B| − c
  const z_excess_B = Math.abs(z_B) - critical_value;
  
  // pct_outside = (down) (L_1 − S_{t+1})/L_1  OR  (up) (S_{t+1} − U_1)/U_1
  const pct_outside_B = direction === -1 
    ? (L_1 - S_t_plus_1) / L_1 
    : (S_t_plus_1 - U_1) / U_1;
  
  // ndist_B = | ln(S_{t+1}) − m_t(1) | / (c * s_t)
  const ndist_B = Math.abs(Math.log(S_t_plus_1) - m_log) / (critical_value * s_scale);
  
  // Band width in basis points
  const band_width_bp_B = 10000 * (U_1 / L_1 - 1);
  
  // 6) vol_regime_percentile = Percentile( σ_{t+1|t} vs trailing 3y )
  const vol_regime_percentile = await computeVolRegimePercentile(symbol, t_date, sigma_forecast_1d);
  
  // Extract method provenance
  const base_method = f.diagnostics?.base_method || f.method || 'unknown';
  const conformal_mode = f.diagnostics?.conformal?.mode || null;
  const coverage_nominal = f.target?.coverage || 0.95;
  const critical = {
    type: (f.diagnostics?.critical_type || 'normal') as 'normal' | 't',
    value: critical_value,
    df: f.diagnostics?.df || null
  };
  
  // 7) Build EventRecord with event_open=true and persist via appendEvent
  const eventRecord: EventRecord = {
    id: randomUUID(),
    symbol,
    B_date,
    t_date,
    direction,
    // Magnitudes at breakout:
    z_B,
    z_excess_B,
    pct_outside_B,
    ndist_B,
    L_1_B: L_1,
    U_1_B: U_1,
    band_width_bp_B,
    // Regime & provenance:
    sigma_forecast_1d,
    vol_regime_percentile,
    earnings_window_flag: false, // TODO: implement earnings detection if needed
    method_provenance: {
      base_method,
      conformal_mode,
      coverage_nominal,
      critical
    },
    // Engine state:
    event_open: true,
    created_at: new Date().toISOString()
  };
  
  // 8) Persist and return the EventRecord
  await appendEvent(symbol, eventRecord);
  return eventRecord;
}

/**
 * Get next trading day from canonical data
 */
function getNextTradingDay(date: string, canonicalData: any[]): string | null {
  const currentDate = new Date(date);
  const sortedData = canonicalData
    .filter(row => row.date > date && row.adj_close)
    .sort((a, b) => a.date.localeCompare(b.date));
  
  return sortedData.length > 0 ? sortedData[0].date : null;
}