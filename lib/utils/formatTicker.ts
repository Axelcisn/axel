import exchangeMap from '../data/exchange_map.json';

// Exchange mapping type definition
export interface ExchangeInfo {
  country: string;
  region: string;
  suffix: string;
  prefix: string;
  timezone: string;
  currency: string;
  altNames: string[];
}

// Type for the exchange map
export type ExchangeMap = Record<string, ExchangeInfo>;

/**
 * Format a ticker symbol with the appropriate exchange suffix
 * @param symbol - Base ticker symbol (e.g., "AAPL", "BHP")
 * @param exchange - Exchange code (e.g., "NASDAQ", "ASX")
 * @returns Formatted ticker with suffix (e.g., "AAPL", "BHP.AX")
 */
export function formatTicker(symbol: string, exchange: string): string {
  const ex = (exchangeMap as ExchangeMap)[exchange];
  if (!ex) {
    console.warn(`Exchange "${exchange}" not found in exchange map`);
    return symbol;
  }
  return `${symbol}${ex.suffix || ""}`;
}

/**
 * Get exchange information for a given exchange code
 * @param exchange - Exchange code (e.g., "NASDAQ", "ASX")
 * @returns Exchange information object or null if not found
 */
export function getExchangeInfo(exchange: string): ExchangeInfo | null {
  const ex = (exchangeMap as ExchangeMap)[exchange];
  return ex || null;
}

/**
 * Get all available exchanges grouped by region
 * @returns Object with regions as keys and exchange codes as values
 */
export function getExchangesByRegion(): Record<string, string[]> {
  const regions: Record<string, string[]> = {};
  
  Object.entries(exchangeMap as ExchangeMap).forEach(([code, info]) => {
    if (!regions[info.region]) {
      regions[info.region] = [];
    }
    regions[info.region].push(code);
  });
  
  return regions;
}

/**
 * Get all exchange codes as an array
 * @returns Array of all exchange codes
 */
export function getAllExchanges(): string[] {
  return Object.keys(exchangeMap as ExchangeMap);
}

/**
 * Search exchanges by name (including alternative names)
 * @param searchTerm - Search term to match against exchange names
 * @returns Array of matching exchange codes
 */
export function searchExchanges(searchTerm: string): string[] {
  const term = searchTerm.toLowerCase();
  const matches: string[] = [];
  
  Object.entries(exchangeMap as ExchangeMap).forEach(([code, info]) => {
    // Check main code
    if (code.toLowerCase().includes(term)) {
      matches.push(code);
      return;
    }
    
    // Check alternative names
    if (info.altNames.some(name => name.toLowerCase().includes(term))) {
      matches.push(code);
      return;
    }
    
    // Check country
    if (info.country.toLowerCase().includes(term)) {
      matches.push(code);
      return;
    }
  });
  
  return matches;
}

/**
 * Get the trading hours status for an exchange (simplified)
 * Note: This is a basic implementation. For production, you'd want to use a proper timezone library
 * @param exchange - Exchange code
 * @returns Simple status indication
 */
export function getMarketStatus(exchange: string): 'open' | 'closed' | 'unknown' {
  const ex = (exchangeMap as ExchangeMap)[exchange];
  if (!ex) return 'unknown';
  
  // This is a simplified implementation
  // In production, you'd use a proper timezone library to check actual trading hours
  const now = new Date();
  const hour = now.getUTCHours();
  
  // Very basic approximation based on typical trading hours
  // US markets (roughly 14:30-21:00 UTC)
  if (['NASDAQ', 'NYSE'].includes(exchange)) {
    return (hour >= 14 && hour <= 21) ? 'open' : 'closed';
  }
  
  // Asian markets (roughly 01:00-08:00 UTC)
  if (['TSE', 'HKEX', 'SSE', 'SZSE'].includes(exchange)) {
    return (hour >= 1 && hour <= 8) ? 'open' : 'closed';
  }
  
  // European markets (roughly 08:00-16:30 UTC)
  if (['LSE', 'XETRA', 'Euronext_Paris'].includes(exchange)) {
    return (hour >= 8 && hour <= 16) ? 'open' : 'closed';
  }
  
  return 'unknown';
}