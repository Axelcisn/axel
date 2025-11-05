import { loadBaseForecasts } from '../forecast/store';
import { loadCanonicalData } from '../storage/canonical';

/**
 * Compute percentile rank of σ_{t+1|t} vs trailing 3y reference.
 * Prefers sigma history from prior forecasts; if <60 samples, fallback to realized proxy.
 */
export async function computeVolRegimePercentile(
  symbol: string,
  date_t: string,
  sigma_tplus1: number | null
): Promise<number | null> {
  if (sigma_tplus1 === null) {
    return null;
  }
  
  try {
    // Calculate 3-year lookback date
    const targetDate = new Date(date_t);
    const threeYearsAgo = new Date(targetDate);
    threeYearsAgo.setFullYear(targetDate.getFullYear() - 3);
    const lookbackDate = threeYearsAgo.toISOString().split('T')[0];
    
    // Try to get historical sigma forecasts first
    const sigmaHistory = await getHistoricalSigmaForecasts(symbol, lookbackDate, date_t);
    
    let referenceValues: number[];
    
    if (sigmaHistory.length >= 60) {
      // Use forecast sigma history
      referenceValues = sigmaHistory;
    } else {
      // Fallback to realized volatility proxy
      const realizedVols = await getHistoricalRealizedVolatility(symbol, lookbackDate, date_t);
      if (realizedVols.length < 60) {
        return null; // Insufficient data
      }
      referenceValues = realizedVols;
    }
    
    // Compute percentile rank
    const sortedValues = [...referenceValues].sort((a, b) => a - b);
    const rank = sortedValues.filter(v => v <= sigma_tplus1).length;
    const percentile = rank / sortedValues.length;
    
    return percentile;
    
  } catch (error) {
    console.warn('Error computing vol regime percentile:', error);
    return null;
  }
}

/**
 * Extract historical sigma_forecast_1d from past forecasts
 */
async function getHistoricalSigmaForecasts(
  symbol: string, 
  startDate: string, 
  endDate: string
): Promise<number[]> {
  try {
    const forecasts = await loadBaseForecasts(symbol);
    const sigmaValues: number[] = [];
    
    for (const forecast of forecasts) {
      // Filter by date range
      if (forecast.date_t >= startDate && forecast.date_t < endDate) {
        // Extract sigma forecast from estimates
        const sigma = forecast.estimates?.sigma_forecast || 
                      forecast.estimates?.sigma_hat ||
                      (forecast.estimates?.sigma2_forecast ? Math.sqrt(forecast.estimates.sigma2_forecast) : null);
        
        if (sigma && sigma > 0) {
          sigmaValues.push(sigma);
        }
      }
    }
    
    return sigmaValues;
  } catch (error) {
    return [];
  }
}

/**
 * Compute rolling 20-day realized volatility as fallback
 */
async function getHistoricalRealizedVolatility(
  symbol: string, 
  startDate: string, 
  endDate: string
): Promise<number[]> {
  try {
    const canonicalData = await loadCanonicalData(symbol);
    
    // Filter by date range and compute returns
    const filteredData = canonicalData
      .filter(row => row.date >= startDate && row.date < endDate && row.adj_close)
      .sort((a, b) => a.date.localeCompare(b.date));
    
    if (filteredData.length < 21) {
      return [];
    }
    
    // Compute daily returns
    const returns: number[] = [];
    for (let i = 1; i < filteredData.length; i++) {
      const r = Math.log(filteredData[i].adj_close! / filteredData[i-1].adj_close!);
      returns.push(r);
    }
    
    // Compute rolling 20-day volatility
    const rollingVols: number[] = [];
    const window = 20;
    
    for (let i = window - 1; i < returns.length; i++) {
      const windowReturns = returns.slice(i - window + 1, i + 1);
      const mean = windowReturns.reduce((sum, r) => sum + r, 0) / window;
      const variance = windowReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (window - 1);
      const vol = Math.sqrt(variance);
      rollingVols.push(vol);
    }
    
    return rollingVols;
  } catch (error) {
    return [];
  }
}