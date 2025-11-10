import exchangeMap from '../data/exchange_map.json';
import { ExchangeMap, ExchangeInfo } from './formatTicker';

/**
 * Parse a ticker to identify the exchange and base symbol
 * @param ticker - Ticker with potential suffix (e.g., "AAPL", "BHP.AX", "RELIANCE.NS")
 * @returns Object with base symbol and exchange code
 */
export function parseExchange(ticker: string): { symbol: string; exchange: string | null } {
  // Remove any whitespace
  const cleanTicker = ticker.trim().toUpperCase();
  
  // Check each exchange for matching suffix
  for (const [exchangeCode, exchangeInfo] of Object.entries(exchangeMap as ExchangeMap)) {
    const suffix = exchangeInfo.suffix;
    
    // Skip exchanges without suffixes (like NASDAQ, NYSE)
    if (!suffix) continue;
    
    // Check if ticker ends with this exchange's suffix
    if (cleanTicker.endsWith(suffix.toUpperCase())) {
      const baseSymbol = cleanTicker.slice(0, -suffix.length);
      return {
        symbol: baseSymbol,
        exchange: exchangeCode
      };
    }
  }
  
  // If no suffix found, assume it's a US stock (NASDAQ/NYSE)
  // You could make this more sophisticated by checking against known symbols
  return {
    symbol: cleanTicker,
    exchange: null // Could default to 'NASDAQ' or 'NYSE' if preferred
  };
}

/**
 * Determine the most likely exchange for a ticker without suffix
 * This is a heuristic approach - in production you'd want a symbol database
 * @param symbol - Base symbol without suffix
 * @returns Most likely exchange code or null
 */
export function guessExchange(symbol: string): string | null {
  const cleanSymbol = symbol.trim().toUpperCase();
  
  // Common patterns for different exchanges
  const patterns = {
    // US stocks are typically 1-5 characters, all letters
    NASDAQ: /^[A-Z]{1,5}$/,
    // Canadian stocks often end with specific patterns
    TSX: /^[A-Z]{1,4}$/,
    // These are very basic heuristics - you'd want a proper symbol database
  };
  
  // Very basic heuristic: if it's 1-5 letters, assume US
  if (patterns.NASDAQ.test(cleanSymbol)) {
    return 'NASDAQ';
  }
  
  return null;
}

/**
 * Get all possible ticker variations for a symbol across exchanges
 * Useful for search and autocomplete functionality
 * @param baseSymbol - Base symbol without suffix
 * @returns Array of formatted tickers for all exchanges
 */
export function getAllTickerVariations(baseSymbol: string): Array<{ ticker: string; exchange: string; exchangeInfo: ExchangeInfo }> {
  const variations: Array<{ ticker: string; exchange: string; exchangeInfo: ExchangeInfo }> = [];
  
  Object.entries(exchangeMap as ExchangeMap).forEach(([exchangeCode, exchangeInfo]) => {
    const formattedTicker = `${baseSymbol}${exchangeInfo.suffix || ""}`;
    variations.push({
      ticker: formattedTicker,
      exchange: exchangeCode,
      exchangeInfo
    });
  });
  
  return variations;
}

/**
 * Validate if a ticker format is valid for a given exchange
 * @param ticker - Full ticker (with or without suffix)
 * @param exchange - Exchange code to validate against
 * @returns boolean indicating if the format is valid
 */
export function validateTickerFormat(ticker: string, exchange: string): boolean {
  const exchangeInfo = (exchangeMap as ExchangeMap)[exchange];
  if (!exchangeInfo) return false;
  
  const expectedSuffix = exchangeInfo.suffix;
  
  // If exchange has no suffix, ticker should not have a suffix
  if (!expectedSuffix) {
    return !ticker.includes('.');
  }
  
  // If exchange has suffix, ticker should end with that suffix
  return ticker.toUpperCase().endsWith(expectedSuffix.toUpperCase());
}

/**
 * Normalize a ticker to ensure it has the correct format for its exchange
 * @param ticker - Input ticker (may or may not have correct suffix)
 * @param exchange - Target exchange code
 * @returns Properly formatted ticker for the exchange
 */
export function normalizeTicker(ticker: string, exchange: string): string {
  const exchangeInfo = (exchangeMap as ExchangeMap)[exchange];
  if (!exchangeInfo) return ticker;
  
  // First, try to extract the base symbol
  const parsed = parseExchange(ticker);
  const baseSymbol = parsed.symbol;
  
  // Then format it correctly for the target exchange
  return `${baseSymbol}${exchangeInfo.suffix || ""}`;
}

/**
 * Get exchange suggestions based on a partial ticker input
 * Useful for autocomplete functionality
 * @param partialTicker - Partial ticker input
 * @returns Array of suggested completions with exchange info
 */
export function getExchangeSuggestions(partialTicker: string): Array<{ 
  ticker: string; 
  exchange: string; 
  country: string; 
  region: string; 
}> {
  const suggestions: Array<{ ticker: string; exchange: string; country: string; region: string; }> = [];
  const partial = partialTicker.trim().toUpperCase();
  
  if (partial.length < 1) return suggestions;
  
  // Check if partial ticker matches any suffix patterns
  Object.entries(exchangeMap as ExchangeMap).forEach(([exchangeCode, exchangeInfo]) => {
    // Simple matching - you could make this more sophisticated
    if (exchangeCode.toUpperCase().includes(partial)) {
      suggestions.push({
        ticker: `${partial}${exchangeInfo.suffix || ""}`,
        exchange: exchangeCode,
        country: exchangeInfo.country,
        region: exchangeInfo.region
      });
    }
  });
  
  return suggestions.slice(0, 10); // Limit to top 10 suggestions
}