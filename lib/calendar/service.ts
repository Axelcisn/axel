/**
 * Calendar & TZ service (stubs now, replace later)
 */

const EXCHANGE_TZ_MAP: Record<string, string> = {
  'NASDAQ': 'America/New_York',
  'NYSE': 'America/New_York',
  'TSX': 'America/Toronto',
  'LSE': 'Europe/London',
  'ASX': 'Australia/Sydney',
};

export async function resolveExchangeAndTZ(
  symbol?: string, 
  exchange?: string
): Promise<{ exchange: string; tz: string }> {
  // If exchange given, map to IANA TZ
  if (exchange && EXCHANGE_TZ_MAP[exchange.toUpperCase()]) {
    return {
      exchange: exchange.toUpperCase(),
      tz: EXCHANGE_TZ_MAP[exchange.toUpperCase()]
    };
  }

  // If not, use a simple mapping for common US listings
  // TODO: Add more sophisticated symbol->exchange resolution
  const defaultExchange = 'NASDAQ'; // Default for US symbols
  return {
    exchange: defaultExchange,
    tz: EXCHANGE_TZ_MAP[defaultExchange]
  };
}

export function listTradingDays(tz: string, startISO: string, endISO: string): string[] {
  const tradingDays: string[] = [];
  const start = new Date(startISO);
  const end = new Date(endISO);
  
  // For now: weekdays only (Mon–Fri), exclude weekends
  // TODO: Add proper holiday calendar integration
  const current = new Date(start);
  while (current <= end) {
    const dayOfWeek = current.getDay();
    // Monday = 1, Friday = 5 (exclude Saturday = 6, Sunday = 0)
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      tradingDays.push(current.toISOString().split('T')[0]);
    }
    current.setDate(current.getDate() + 1);
  }
  
  return tradingDays;
}