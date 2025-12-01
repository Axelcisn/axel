/**
 * Shared utilities for forecast horizon resolution and validation
 */

export interface HorizonResolution {
  horizonValue: number;
  isStale: boolean;
  forecastH?: number;
  source: 'forecast' | 'ui' | 'default';
}

/**
 * Resolves forecast horizon with stale detection
 * @param forecast - Forecast object that may contain horizon data
 * @param uiHorizon - Current horizon setting from UI
 * @returns Horizon resolution with stale detection
 */
export function resolveForecastHorizon(
  forecast: any,
  uiHorizon: number | undefined
): HorizonResolution {
  // Extract horizon from forecast object (multiple possible fields)
  const forecastH =
    typeof forecast?.horizonTrading === "number"
      ? forecast.horizonTrading
      : typeof forecast?.target?.h === "number"
      ? forecast.target.h
      : typeof forecast?.params?.h === "number"
      ? forecast.params.h
      : undefined;

  // Determine the horizon value to use
  const horizonValue = forecastH ?? uiHorizon ?? 1;
  
  // Check for stale data (forecast horizon doesn't match UI)
  const isStale =
    forecastH !== undefined && 
    uiHorizon !== undefined && 
    forecastH !== uiHorizon;

  // Determine the source of the horizon value
  const source: HorizonResolution['source'] = 
    forecastH !== undefined ? 'forecast' :
    uiHorizon !== undefined ? 'ui' : 
    'default';

  return {
    horizonValue,
    isStale,
    forecastH,
    source
  };
}