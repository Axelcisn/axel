/**
 * Shared forecast method resolution utilities
 * Ensures consistent method naming across all forecast components
 */

/**
 * Resolve base method string from volatility model parameters
 * This function centralizes the mapping from UI state to forecast method names
 * stored in ForecastRecord.method field
 */
export function resolveBaseMethod(
  volModel: 'GBM' | 'GARCH' | 'HAR-RV' | 'Range',
  garchEstimator: 'Normal' | 'Student-t',
  rangeEstimator: 'P' | 'GK' | 'RS' | 'YZ'
): string {
  if (volModel === 'GBM') return 'GBM-CC';
  if (volModel === 'GARCH') return garchEstimator === 'Student-t' ? 'GARCH11-t' : 'GARCH11-N';
  if (volModel === 'HAR-RV') return 'HAR-RV';
  if (volModel === 'Range') return `Range-${rangeEstimator}`;
  throw new Error(`Unknown volatility model: ${volModel}`);
}

/**
 * Parse method string back to components (for reverse lookup if needed)
 */
export function parseMethodString(method: string): {
  volModel: 'GBM' | 'GARCH' | 'HAR-RV' | 'Range';
  garchEstimator?: 'Normal' | 'Student-t';
  rangeEstimator?: 'P' | 'GK' | 'RS' | 'YZ';
} {
  if (method === 'GBM-CC') {
    return { volModel: 'GBM' };
  }
  
  if (method === 'GARCH11-N') {
    return { volModel: 'GARCH', garchEstimator: 'Normal' };
  }
  
  if (method === 'GARCH11-t') {
    return { volModel: 'GARCH', garchEstimator: 'Student-t' };
  }
  
  if (method === 'HAR-RV') {
    return { volModel: 'HAR-RV' };
  }
  
  if (method.startsWith('Range-')) {
    const estimator = method.replace('Range-', '') as 'P' | 'GK' | 'RS' | 'YZ';
    return { volModel: 'Range', rangeEstimator: estimator };
  }
  
  throw new Error(`Unknown method string: ${method}`);
}

/**
 * Get all possible method strings for a given volatility model
 */
export function getAllMethodsForModel(volModel: 'GBM' | 'GARCH' | 'HAR-RV' | 'Range'): string[] {
  switch (volModel) {
    case 'GBM':
      return ['GBM-CC'];
    case 'GARCH':
      return ['GARCH11-N', 'GARCH11-t'];
    case 'HAR-RV':
      return ['HAR-RV'];
    case 'Range':
      return ['Range-P', 'Range-GK', 'Range-RS', 'Range-YZ'];
    default:
      throw new Error(`Unknown volatility model: ${volModel}`);
  }
}