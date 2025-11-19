/**
 * Vendor-specific column mappings and processing rules
 */

export interface VendorConfig {
  name: string;
  headerMappings: Record<string, string>;
  hasAdjustedClose: boolean;
  hasCorporateActions: boolean;
  dateFormat: string;
  processingRules?: {
    computeAdjClose?: boolean;
    splitFactorColumn?: string;
    dividendColumn?: string;
  };
}

export const VENDOR_CONFIGS: Record<string, VendorConfig> = {
  'yahoo': {
    name: 'Yahoo Finance',
    headerMappings: {
      'Date': 'date',
      'Open': 'open',
      'High': 'high',
      'Low': 'low',
      'Close': 'close',
      'Adj Close': 'adj_close',
      'Volume': 'volume'
    },
    hasAdjustedClose: true,
    hasCorporateActions: false,
    dateFormat: 'YYYY-MM-DD'
  },
  'bloomberg': {
    name: 'Bloomberg Terminal',
    headerMappings: {
      'Date': 'date',
      'PX_OPEN': 'open',
      'PX_HIGH': 'high',
      'PX_LOW': 'low',
      'PX_LAST': 'close',
      'PX_VOLUME': 'volume',
      'SPLIT_FACTOR': 'split_factor',
      'DIVIDEND': 'cash_dividend'
    },
    hasAdjustedClose: false,
    hasCorporateActions: true,
    dateFormat: 'MM/DD/YYYY',
    processingRules: {
      computeAdjClose: true,
      splitFactorColumn: 'SPLIT_FACTOR',
      dividendColumn: 'DIVIDEND'
    }
  },
  'refinitiv': {
    name: 'Refinitiv Eikon',
    headerMappings: {
      'Date': 'date',
      'OPEN': 'open',
      'HIGH': 'high',
      'LOW': 'low',
      'CLOSE': 'close',
      'VOLUME': 'volume',
      'SPLIT_ADJUST': 'split_factor',
      'CASH_DIV': 'cash_dividend'
    },
    hasAdjustedClose: false,
    hasCorporateActions: true,
    dateFormat: 'DD/MM/YYYY',
    processingRules: {
      computeAdjClose: true
    }
  }
};

/**
 * Auto-detect vendor from file headers
 */
export function detectVendor(headers: string[]): string | null {
  const headerSet = new Set(headers.map(h => h.trim()));
  
  for (const [vendorKey, config] of Object.entries(VENDOR_CONFIGS)) {
    const requiredHeaders = Object.keys(config.headerMappings);
    const matchCount = requiredHeaders.filter(h => headerSet.has(h)).length;
    const matchRatio = matchCount / requiredHeaders.length;
    
    if (matchRatio >= 0.8) { // 80% header match threshold
      return vendorKey;
    }
  }
  
  return null;
}

/**
 * Save vendor mapping for reuse
 */
export async function saveVendorMapping(
  filePath: string, 
  vendorKey: string, 
  customMappings?: Record<string, string>
): Promise<void> {
  const mappingData = {
    vendor: vendorKey,
    savedAt: new Date().toISOString(),
    customMappings: customMappings || {}
  };
  
  const fs = await import('fs');
  const path = await import('path');
  
  const mappingFile = path.join(
    process.cwd(), 
    'data', 
    'vendors', 
    `${vendorKey}-mapping.json`
  );
  
  await fs.promises.mkdir(path.dirname(mappingFile), { recursive: true });
  await fs.promises.writeFile(mappingFile, JSON.stringify(mappingData, null, 2));
}