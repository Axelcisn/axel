import { assembleRow } from "@/lib/watchlist/assembler";
import { listRules, updateRule, logFire } from "./store";
import { AlertRule, AlertFire } from "@/lib/watchlist/types";

/**
 * Date utilities for exchange-local day comparison
 */
export class ExchangeDateUtils {
  /**
   * Convert ISO date to exchange-local date string
   */
  static toExchangeLocalDate(isoDate: string, exchangeTZ: string): string {
    try {
      const date = new Date(isoDate);
      return date.toLocaleDateString('en-CA', { timeZone: exchangeTZ }); // Returns YYYY-MM-DD
    } catch (error) {
      console.warn(`Failed to convert ${isoDate} to ${exchangeTZ}:`, error);
      return isoDate.split('T')[0]; // Fallback to UTC date
    }
  }

  /**
   * Check if two ISO dates are the same exchange-local day
   */
  static isSameExchangeDay(date1: string, date2: string, exchangeTZ: string): boolean {
    const local1 = this.toExchangeLocalDate(date1, exchangeTZ);
    const local2 = this.toExchangeLocalDate(date2, exchangeTZ);
    return local1 === local2;
  }

  /**
   * Get current exchange-local date
   */
  static getCurrentExchangeDate(exchangeTZ: string): string {
    const now = new Date();
    return this.toExchangeLocalDate(now.toISOString(), exchangeTZ);
  }
}

/**
 * Run alerts for specified symbols and check firing conditions
 */
export async function runAlertsForSymbols(
  symbols: string[], 
  todayISO: string, 
  exchangeTZ: string
): Promise<AlertFire[]> {
  const fires: AlertFire[] = [];
  const rules = await listRules();
  
  const todayExchangeLocal = ExchangeDateUtils.toExchangeLocalDate(todayISO, exchangeTZ);
  
  console.log(`Running alerts for ${symbols.length} symbols on ${todayExchangeLocal} (${exchangeTZ})`);

  for (const rule of rules.filter(r => r.enabled)) {
    if (!symbols.includes(rule.symbol)) continue;

    try {
      // Get watchlist row for this symbol
      const row = await assembleRow(rule.symbol, todayISO);
      
      // Check throttling: only fire once per exchange-local day
      const alreadyFiredToday = rule.last_fired_at ? 
        ExchangeDateUtils.isSameExchangeDay(rule.last_fired_at, todayISO, exchangeTZ) : 
        false;

      if (alreadyFiredToday) {
        console.log(`Alert rule ${rule.id} for ${rule.symbol} already fired today, skipping`);
        continue;
      }

      let fired = false;
      let fireReason: "threshold" | "next_review" | null = null;

      // Check threshold condition: P̂(T≥k) ≥ p_min
      if (rule.threshold) {
        const { k, p_min } = rule.threshold;
        const p = row.forecast.P_ge_k[k] ?? null;
        
        if (p != null && p >= p_min) {
          fireReason = "threshold";
          fired = true;
          console.log(`Threshold alert triggered for ${rule.symbol}: P(T≥${k}) = ${p.toFixed(3)} >= ${p_min}`);
        }
      }

      // Check review date condition: next_review_date equals today (exchange-local)
      if (!fired && rule.on_review && row.forecast.next_review_date) {
        const reviewDateLocal = ExchangeDateUtils.toExchangeLocalDate(row.forecast.next_review_date, exchangeTZ);
        
        if (reviewDateLocal === todayExchangeLocal) {
          fireReason = "next_review";
          fired = true;
          console.log(`Review date alert triggered for ${rule.symbol}: next_review_date = ${reviewDateLocal}`);
        }
      }

      // Fire alert if conditions met
      if (fired && fireReason) {
        const alertFire: AlertFire = {
          id: crypto.randomUUID(),
          symbol: rule.symbol,
          fired_at: new Date().toISOString(),
          reason: fireReason,
          payload: row
        };

        fires.push(alertFire);

        // Update rule last_fired_at timestamp
        rule.last_fired_at = new Date().toISOString();
        await updateRule(rule);

        console.log(`Alert fired: ${rule.symbol} (${fireReason})`);
      }

    } catch (error) {
      console.error(`Failed to process alert rule ${rule.id} for ${rule.symbol}:`, error);
      // Continue with other rules
    }
  }

  // Log all fires
  for (const fire of fires) {
    try {
      await logFire(fire);
    } catch (error) {
      console.error(`Failed to log alert fire ${fire.id}:`, error);
    }
  }

  console.log(`Completed alerts run: ${fires.length} alerts fired`);
  return fires;
}

/**
 * Run alerts for a single symbol
 */
export async function runAlertsForSymbol(
  symbol: string, 
  todayISO: string, 
  exchangeTZ: string
): Promise<AlertFire[]> {
  return runAlertsForSymbols([symbol], todayISO, exchangeTZ);
}

/**
 * Check if any alerts would fire for a symbol without actually firing them
 */
export async function checkPendingAlerts(
  symbol: string, 
  todayISO: string, 
  exchangeTZ: string
): Promise<{
  threshold_alerts: Array<{ rule_id: string; k: number; p_current: number; p_min: number }>;
  review_alerts: Array<{ rule_id: string; review_date: string }>;
}> {
  const rules = await listRules();
  const symbolRules = rules.filter(r => r.enabled && r.symbol === symbol);
  
  if (symbolRules.length === 0) {
    return { threshold_alerts: [], review_alerts: [] };
  }

  const row = await assembleRow(symbol, todayISO);
  const todayExchangeLocal = ExchangeDateUtils.toExchangeLocalDate(todayISO, exchangeTZ);
  
  const threshold_alerts = [];
  const review_alerts = [];

  for (const rule of symbolRules) {
    // Check if already fired today
    const alreadyFiredToday = rule.last_fired_at ? 
      ExchangeDateUtils.isSameExchangeDay(rule.last_fired_at, todayISO, exchangeTZ) : 
      false;

    if (alreadyFiredToday) continue;

    // Check threshold condition
    if (rule.threshold) {
      const { k, p_min } = rule.threshold;
      const p = row.forecast.P_ge_k[k] ?? null;
      
      if (p != null && p >= p_min) {
        threshold_alerts.push({
          rule_id: rule.id,
          k,
          p_current: p,
          p_min
        });
      }
    }

    // Check review date condition
    if (rule.on_review && row.forecast.next_review_date) {
      const reviewDateLocal = ExchangeDateUtils.toExchangeLocalDate(row.forecast.next_review_date, exchangeTZ);
      
      if (reviewDateLocal === todayExchangeLocal) {
        review_alerts.push({
          rule_id: rule.id,
          review_date: reviewDateLocal
        });
      }
    }
  }

  return { threshold_alerts, review_alerts };
}

/**
 * Get alert summary for dashboard
 */
export async function getAlertSummary(
  symbols: string[], 
  todayISO: string, 
  exchangeTZ: string
): Promise<{
  total_rules: number;
  enabled_rules: number;
  pending_threshold: number;
  pending_review: number;
  fired_today: number;
}> {
  const rules = await listRules();
  const symbolRules = rules.filter(r => symbols.includes(r.symbol));
  
  let pending_threshold = 0;
  let pending_review = 0;
  
  for (const symbol of symbols) {
    try {
      const pending = await checkPendingAlerts(symbol, todayISO, exchangeTZ);
      pending_threshold += pending.threshold_alerts.length;
      pending_review += pending.review_alerts.length;
    } catch (error) {
      console.warn(`Failed to check pending alerts for ${symbol}:`, error);
    }
  }

  // Count fires today
  const { alertsStore } = await import('./store');
  const todayExchangeLocal = ExchangeDateUtils.toExchangeLocalDate(todayISO, exchangeTZ);
  const firesToday = await alertsStore.getFires(todayExchangeLocal);
  const symbolFiresToday = firesToday.filter(f => symbols.includes(f.symbol));

  return {
    total_rules: symbolRules.length,
    enabled_rules: symbolRules.filter(r => r.enabled).length,
    pending_threshold,
    pending_review,
    fired_today: symbolFiresToday.length
  };
}

/**
 * Validate alert rule before saving
 */
export function validateAlertRule(rule: Partial<AlertRule>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!rule.symbol || typeof rule.symbol !== 'string') {
    errors.push('symbol is required and must be a string');
  }

  if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') {
    errors.push('enabled must be a boolean');
  }

  if (rule.threshold) {
    if (typeof rule.threshold.k !== 'number' || rule.threshold.k < 1 || rule.threshold.k > 20) {
      errors.push('threshold.k must be a number between 1 and 20');
    }
    if (typeof rule.threshold.p_min !== 'number' || rule.threshold.p_min < 0 || rule.threshold.p_min > 1) {
      errors.push('threshold.p_min must be a number between 0 and 1');
    }
  }

  if (rule.on_review !== undefined && typeof rule.on_review !== 'boolean') {
    errors.push('on_review must be a boolean');
  }

  if (!rule.threshold && !rule.on_review) {
    errors.push('at least one condition (threshold or on_review) must be specified');
  }

  if (rule.channel && !['log', 'email', 'webhook'].includes(rule.channel)) {
    errors.push('channel must be one of: log, email, webhook');
  }

  if (rule.channel === 'webhook' && (!rule.webhook_url || typeof rule.webhook_url !== 'string')) {
    errors.push('webhook_url is required when channel is webhook');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}