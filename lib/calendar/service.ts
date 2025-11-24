/**
 * Enhanced Calendar & TZ service with holiday support
 */

import exchangeMap from '../data/exchange_map.json';

export interface TradingDay {
  date: string;
  isFullDay: boolean;
  earlyCloseTime?: string; // e.g., "13:00" for 1 PM ET close
  reason?: string; // e.g., "Thanksgiving Friday"
}

export interface ExchangeInfo {
  exchange: string;
  tz: string;
  currency: string;
  country: string;
}

// Common US market holidays (simplified)
const US_HOLIDAYS_2024_2025 = new Set([
  '2024-01-01', '2024-01-15', '2024-02-19', '2024-03-29', '2024-05-27', '2024-06-19',
  '2024-07-04', '2024-09-02', '2024-11-28', '2024-12-25',
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', '2025-06-19',
  '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25'
]);

const US_EARLY_CLOSE_DAYS = new Set([
  '2024-07-03', '2024-11-29', '2024-12-24', // Day before/after holidays
  '2025-07-03', '2025-11-28', '2025-12-24'
]);

export async function resolveExchangeAndTZ(
  symbol?: string, 
  exchange?: string
): Promise<ExchangeInfo> {
  // If exchange given, look up in exchange map
  if (exchange) {
    const exchangeKey = exchange.toUpperCase();
    const exchangeData = (exchangeMap as any)[exchangeKey];
    
    if (exchangeData) {
      return {
        exchange: exchangeKey,
        tz: exchangeData.timezone,
        currency: exchangeData.currency,
        country: exchangeData.country
      };
    }
  }

  // Symbol-based inference for common patterns
  if (symbol) {
    if (symbol.endsWith('.TO')) {
      return { exchange: 'TSX', tz: 'America/Toronto', currency: 'CAD', country: 'Canada' };
    }
    if (symbol.endsWith('.L')) {
      return { exchange: 'LSE', tz: 'Europe/London', currency: 'GBP', country: 'United Kingdom' };
    }
    if (symbol.endsWith('.AX')) {
      return { exchange: 'ASX', tz: 'Australia/Sydney', currency: 'AUD', country: 'Australia' };
    }
  }

  // Default to NASDAQ for US symbols
  const defaultExchange = 'NASDAQ';
  const exchangeData = (exchangeMap as any)[defaultExchange];
  return {
    exchange: defaultExchange,
    tz: exchangeData.timezone,
    currency: exchangeData.currency,
    country: exchangeData.country
  };
}

export function listTradingDays(
  tz: string, 
  startISO: string, 
  endISO: string,
  options: { includeEarlyClose?: boolean; blockEarlyCloseUploads?: boolean } = {}
): TradingDay[] {
  const tradingDays: TradingDay[] = [];
  const start = new Date(startISO);
  const end = new Date(endISO);
  
  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    const dayOfWeek = current.getDay();
    
    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      current.setDate(current.getDate() + 1);
      continue;
    }
    
    // Check for holidays (US markets for now)
    if (tz === 'America/New_York' && US_HOLIDAYS_2024_2025.has(dateStr)) {
      current.setDate(current.getDate() + 1);
      continue;
    }
    
    // Check for early close days
    const isEarlyClose = tz === 'America/New_York' && US_EARLY_CLOSE_DAYS.has(dateStr);
    
    if (options.includeEarlyClose || !isEarlyClose) {
      tradingDays.push({
        date: dateStr,
        isFullDay: !isEarlyClose,
        earlyCloseTime: isEarlyClose ? '13:00' : undefined,
        reason: isEarlyClose ? 'Holiday early close' : undefined
      });
    }
    
    current.setDate(current.getDate() + 1);
  }
  
  return tradingDays;
}

/**
 * Validate if upload contains data after market close on early-close days
 */
/**
 * Get the Nth trading day after a given date
 */
export function getNthTradingCloseAfter(
  startDate: string, 
  tradingSteps: number,
  tz: string = 'America/New_York'
): { verifyDate: string; calendarDays: number } {
  const tradingDays = listTradingDays(
    tz,
    startDate,
    getDateAfterDays(startDate, tradingSteps * 7) // Conservative end date
  );
  
  // Find the start date in the trading days
  const startIndex = tradingDays.findIndex(day => day.date === startDate);
  if (startIndex === -1) {
    throw new Error(`Start date ${startDate} is not a trading day`);
  }
  
  // Get the Nth trading day after (not including start date)
  if (startIndex + tradingSteps >= tradingDays.length) {
    throw new Error(`Not enough trading days: need ${tradingSteps} after ${startDate}`);
  }
  
  const verifyDate = tradingDays[startIndex + tradingSteps].date;
  
  // Calculate calendar days between start and verify dates
  const calendarDays = computeEffectiveHorizonDays(startDate, verifyDate);
  
  return {
    verifyDate,
    calendarDays
  };
}

/**
 * Compute effective horizon in calendar days between two dates
 */
export function computeEffectiveHorizonDays(startDate: string, endDate: string): number {
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  const diffTime = end.getTime() - start.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Get date N days after a given date
 */
function getDateAfterDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
}

export function validateEarlyCloseConstraints(
  uploadTime: string, // ISO timestamp of upload
  tradingDays: TradingDay[],
  tz: string
): { valid: boolean; violations: string[]; warnings: string[] } {
  const violations: string[] = [];
  const warnings: string[] = [];
  
  const uploadDate = new Date(uploadTime);
  
  for (const day of tradingDays) {
    if (!day.isFullDay && day.earlyCloseTime) {
      // Check if upload contains data that would be after early close
      const earlyCloseDateTime = new Date(`${day.date}T${day.earlyCloseTime}:00`);
      
      if (uploadDate > earlyCloseDateTime) {
        warnings.push(
          `Upload contains data for ${day.date} (early close at ${day.earlyCloseTime}). ` +
          `Verify data is from pre-close trading only.`
        );
      }
    }
  }
  
  return {
    valid: violations.length === 0,
    violations,
    warnings
  };
}