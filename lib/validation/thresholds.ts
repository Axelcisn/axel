/**
 * Enhanced validation rules and thresholds
 */

import { CanonicalRow } from '../types/canonical';
import { TradingDay } from '../calendar/service';

export interface ValidationConfig {
  missingDaysThresholds: {
    maxConsecutive: number;
    maxTotal: number;
    blockUpload: boolean;
  };
  fileSizeLimits: {
    maxSizeBytes: number;
    maxRows: number;
  };
  dataQualityChecks: {
    requireMinimumHistory: number; // minimum days of history
    maxPriceChangePercent: number; // flag suspicious price movements
    allowNegativePrices: boolean;
  };
}

export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  missingDaysThresholds: {
    maxConsecutive: 3,
    maxTotal: 10,
    blockUpload: true
  },
  fileSizeLimits: {
    maxSizeBytes: 50 * 1024 * 1024, // 50MB
    maxRows: 100000
  },
  dataQualityChecks: {
    requireMinimumHistory: 30, // 30 days minimum
    maxPriceChangePercent: 50, // Flag >50% single-day changes
    allowNegativePrices: false
  }
};

export interface ValidationResult {
  valid: boolean;
  blocked: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    totalRows: number;
    missingTradingDays: number;
    consecutiveMissingMax: number;
    suspiciousPriceChanges: number;
    dataQualityScore: number; // 0-100
  };
}

/**
 * Comprehensive validation with configurable thresholds
 */
export function validateUploadData(
  rows: CanonicalRow[],
  expectedTradingDays: TradingDay[],
  fileSize: number,
  config: ValidationConfig = DEFAULT_VALIDATION_CONFIG
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  const result: ValidationResult = {
    valid: true,
    blocked: false,
    errors,
    warnings,
    stats: {
      totalRows: rows.length,
      missingTradingDays: 0,
      consecutiveMissingMax: 0,
      suspiciousPriceChanges: 0,
      dataQualityScore: 100
    }
  };

  // File size validation
  if (fileSize > config.fileSizeLimits.maxSizeBytes) {
    errors.push(`File size (${Math.round(fileSize / (1024 * 1024))}MB) exceeds limit of ${Math.round(config.fileSizeLimits.maxSizeBytes / (1024 * 1024))}MB`);
    result.blocked = true;
  }

  if (rows.length > config.fileSizeLimits.maxRows) {
    errors.push(`Row count (${rows.length}) exceeds limit of ${config.fileSizeLimits.maxRows}`);
    result.blocked = true;
  }

  // Minimum history check
  if (rows.length < config.dataQualityChecks.requireMinimumHistory) {
    warnings.push(`Insufficient history: only ${rows.length} days (recommended: ${config.dataQualityChecks.requireMinimumHistory}+ days)`);
    result.stats.dataQualityScore -= 20;
  }

  // Missing trading days analysis
  const missingDaysAnalysis = analyzeMissingTradingDays(rows, expectedTradingDays);
  result.stats.missingTradingDays = missingDaysAnalysis.totalMissing;
  result.stats.consecutiveMissingMax = missingDaysAnalysis.maxConsecutive;

  if (missingDaysAnalysis.totalMissing > config.missingDaysThresholds.maxTotal) {
    const message = `Too many missing trading days: ${missingDaysAnalysis.totalMissing} (max: ${config.missingDaysThresholds.maxTotal})`;
    if (config.missingDaysThresholds.blockUpload) {
      errors.push(message);
      result.blocked = true;
    } else {
      warnings.push(message);
    }
    result.stats.dataQualityScore -= 30;
  }

  if (missingDaysAnalysis.maxConsecutive > config.missingDaysThresholds.maxConsecutive) {
    const message = `Too many consecutive missing days: ${missingDaysAnalysis.maxConsecutive} (max: ${config.missingDaysThresholds.maxConsecutive})`;
    if (config.missingDaysThresholds.blockUpload) {
      errors.push(message);
      result.blocked = true;
    } else {
      warnings.push(message);
    }
    result.stats.dataQualityScore -= 25;
  }

  // Price validation
  const priceValidation = validatePriceData(rows, config);
  result.stats.suspiciousPriceChanges = priceValidation.suspiciousChanges;
  warnings.push(...priceValidation.warnings);
  errors.push(...priceValidation.errors);
  
  if (priceValidation.errors.length > 0) {
    result.blocked = true;
  }
  
  result.stats.dataQualityScore -= priceValidation.qualityDeduction;

  // Final validity check
  result.valid = errors.length === 0;

  return result;
}

function analyzeMissingTradingDays(
  rows: CanonicalRow[],
  expectedTradingDays: TradingDay[]
): { totalMissing: number; maxConsecutive: number; missingDates: string[] } {
  const actualDates = new Set(rows.map(r => r.date));
  const expectedDates = expectedTradingDays.map(d => d.date);
  
  const missingDates = expectedDates.filter(date => !actualDates.has(date));
  
  // Calculate max consecutive missing days
  let maxConsecutive = 0;
  let currentConsecutive = 0;
  
  for (const expectedDate of expectedDates) {
    if (!actualDates.has(expectedDate)) {
      currentConsecutive++;
      maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
    } else {
      currentConsecutive = 0;
    }
  }

  return {
    totalMissing: missingDates.length,
    maxConsecutive,
    missingDates
  };
}

function validatePriceData(
  rows: CanonicalRow[],
  config: ValidationConfig
): { errors: string[]; warnings: string[]; suspiciousChanges: number; qualityDeduction: number } {
  const errors: string[] = [];
  const warnings: string[] = [];
  let suspiciousChanges = 0;
  let qualityDeduction = 0;

  // Sort rows by date for sequential analysis
  const sortedRows = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  for (let i = 0; i < sortedRows.length; i++) {
    const row = sortedRows[i];

    // Check for negative prices
    if (!config.dataQualityChecks.allowNegativePrices) {
      if (row.open < 0 || row.high < 0 || row.low < 0 || row.close < 0) {
        errors.push(`Negative prices found on ${row.date}`);
      }
    }

    // Check for invalid OHLC relationships
    if (row.high < row.low) {
      errors.push(`Invalid OHLC: High (${row.high}) < Low (${row.low}) on ${row.date}`);
    }
    if (row.high < row.open || row.high < row.close) {
      warnings.push(`Suspicious OHLC: High not highest price on ${row.date}`);
      qualityDeduction += 2;
    }
    if (row.low > row.open || row.low > row.close) {
      warnings.push(`Suspicious OHLC: Low not lowest price on ${row.date}`);
      qualityDeduction += 2;
    }

    // Check for large price changes (possible data errors)
    if (i > 0) {
      const prevRow = sortedRows[i - 1];
      const priceChange = Math.abs(row.close - prevRow.close) / prevRow.close * 100;
      
      if (priceChange > config.dataQualityChecks.maxPriceChangePercent) {
        warnings.push(
          `Large price change on ${row.date}: ${priceChange.toFixed(1)}% ` +
          `(${prevRow.close} → ${row.close}). Verify this is not a data error.`
        );
        suspiciousChanges++;
        qualityDeduction += 5;
      }
    }

    // Check for zero volume (might be suspicious)
    if (row.volume === 0) {
      warnings.push(`Zero volume on ${row.date} - verify this is correct`);
      qualityDeduction += 1;
    }
  }

  return { errors, warnings, suspiciousChanges, qualityDeduction: Math.min(qualityDeduction, 50) };
}

/**
 * Create custom validation config for specific use cases
 */
export function createValidationConfig(overrides: Partial<ValidationConfig>): ValidationConfig {
  return {
    missingDaysThresholds: {
      ...DEFAULT_VALIDATION_CONFIG.missingDaysThresholds,
      ...overrides.missingDaysThresholds
    },
    fileSizeLimits: {
      ...DEFAULT_VALIDATION_CONFIG.fileSizeLimits,
      ...overrides.fileSizeLimits
    },
    dataQualityChecks: {
      ...DEFAULT_VALIDATION_CONFIG.dataQualityChecks,
      ...overrides.dataQualityChecks
    }
  };
}