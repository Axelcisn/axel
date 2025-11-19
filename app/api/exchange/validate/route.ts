import { NextRequest, NextResponse } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// Exchange validation patterns and known conflicts
const ADR_PATTERNS = [
  // Chinese ADRs typically end with specific patterns
  /^[A-Z]+\.HK$/,  // Hong Kong suffix
  /^[A-Z]+\.SS$/,  // Shanghai suffix
  /^[A-Z]+\.SZ$/,  // Shenzhen suffix
  
  // Common ADR tickers that should be on US exchanges
  'BABA',    // Alibaba - should be NYSE, not Hong Kong
  'JD',      // JD.com - should be NASDAQ, not Hong Kong
  'PDD',     // PDD Holdings - should be NASDAQ
  'BIDU',    // Baidu - should be NASDAQ
  'NIO',     // NIO - should be NYSE
  'XPEV',    // XPeng - should be NYSE
  'LI',      // Li Auto - should be NASDAQ
  'TME',     // Tencent Music - should be NYSE
  'NTES',    // NetEase - should be NASDAQ
];

// Exchange groupings for validation
const EXCHANGE_REGIONS = {
  US: ['NYSE', 'NASDAQ', 'AMEX', 'OTC'],
  EUROPE: ['LSE', 'EURONEXT', 'XETRA', 'SIX'],
  ASIA: ['TSE', 'HKEX', 'SSE', 'SZSE', 'ASX'],
  EMERGING: ['BSE', 'NSE', 'JSE', 'BMV']
};

// Common ticker patterns by exchange
const TICKER_PATTERNS: Record<string, RegExp> = {
  'HKEX': /^\d{4}\.HK$/,     // Hong Kong: 4 digits + .HK
  'TSE': /^\d{4}\.T$/,       // Tokyo: 4 digits + .T
  'LSE': /^[A-Z]{3,4}\.L$/,  // London: 3-4 letters + .L
  'EURONEXT': /^[A-Z]{2,5}\.PA$/, // Paris: letters + .PA
  'ASX': /^[A-Z]{3}\.AX$/,   // Australia: 3 letters + .AX
};

// Known problematic combinations
const KNOWN_CONFLICTS = [
  {
    ticker: 'BABA',
    wrongExchange: 'HKEX',
    correctExchange: 'NYSE',
    reason: 'BABA is an ADR that trades on NYSE, not Hong Kong'
  },
  {
    ticker: 'JD',
    wrongExchange: 'HKEX',
    correctExchange: 'NASDAQ',
    reason: 'JD is an ADR that trades on NASDAQ, not Hong Kong'
  },
  {
    ticker: 'TSM',
    wrongExchange: 'TSE',
    correctExchange: 'NYSE',
    reason: 'TSM (Taiwan Semiconductor) ADR trades on NYSE'
  }
];

interface ValidationResult {
  valid: boolean;
  warning?: {
    type: 'adr_mismatch' | 'pattern_mismatch' | 'region_mismatch';
    message: string;
    suggestion: string;
    correctExchange?: string;
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker')?.toUpperCase();
    const exchange = searchParams.get('exchange')?.toUpperCase();

    if (!ticker || !exchange) {
      return NextResponse.json(
        { error: 'Both ticker and exchange parameters are required' },
        { status: 400 }
      );
    }

    const validation = validateTickerExchange(ticker, exchange);

    return NextResponse.json(validation);

  } catch (error) {
    console.error('Exchange validation error:', error);
    return NextResponse.json(
      { error: 'Failed to validate exchange' },
      { status: 500 }
    );
  }
}

function validateTickerExchange(ticker: string, exchange: string): ValidationResult {
  // Check for known conflicts first
  const knownConflict = KNOWN_CONFLICTS.find(
    conflict => conflict.ticker === ticker && conflict.wrongExchange === exchange
  );

  if (knownConflict) {
    return {
      valid: false,
      warning: {
        type: 'adr_mismatch',
        message: knownConflict.reason,
        suggestion: `Consider using ${knownConflict.correctExchange} instead`,
        correctExchange: knownConflict.correctExchange
      }
    };
  }

  // Check ticker patterns against exchange
  const expectedPattern = TICKER_PATTERNS[exchange];
  if (expectedPattern && !expectedPattern.test(ticker)) {
    const suggestion = getPatternSuggestion(ticker, exchange);
    return {
      valid: false,
      warning: {
        type: 'pattern_mismatch',
        message: `Ticker "${ticker}" doesn't match expected pattern for ${exchange}`,
        suggestion: suggestion
      }
    };
  }

  // Check for ADR patterns on non-US exchanges
  if (!EXCHANGE_REGIONS.US.includes(exchange)) {
    const isKnownADR = ADR_PATTERNS.some(pattern => {
      if (typeof pattern === 'string') {
        return pattern === ticker;
      }
      return pattern.test(ticker);
    });

    if (isKnownADR) {
      const suggestedExchange = getSuggestedUSExchange(ticker);
      return {
        valid: false,
        warning: {
          type: 'adr_mismatch',
          message: `"${ticker}" appears to be an ADR and may trade on US exchanges`,
          suggestion: `Consider using ${suggestedExchange} if this is an ADR`,
          correctExchange: suggestedExchange
        }
      };
    }
  }

  // No issues found
  return { valid: true };
}

function getPatternSuggestion(ticker: string, exchange: string): string {
  switch (exchange) {
    case 'HKEX':
      return 'Hong Kong tickers should be 4 digits followed by .HK (e.g., 0700.HK)';
    case 'TSE':
      return 'Tokyo tickers should be 4 digits followed by .T (e.g., 7203.T)';
    case 'LSE':
      return 'London tickers should be 3-4 letters followed by .L (e.g., VOD.L)';
    case 'ASX':
      return 'Australian tickers should be 3 letters followed by .AX (e.g., CBA.AX)';
    default:
      return `Check the standard ticker format for ${exchange}`;
  }
}

function getSuggestedUSExchange(ticker: string): string {
  // Large tech companies typically trade on NASDAQ
  const nasdaqTickers = ['BIDU', 'JD', 'PDD', 'NTES', 'LI'];
  if (nasdaqTickers.includes(ticker)) {
    return 'NASDAQ';
  }

  // Large industrial/traditional companies typically trade on NYSE
  const nyseTickers = ['BABA', 'NIO', 'XPEV', 'TME'];
  if (nyseTickers.includes(ticker)) {
    return 'NYSE';
  }

  // Default suggestion
  return 'NYSE or NASDAQ';
}