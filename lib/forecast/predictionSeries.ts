/**
 * Prediction series loader - dedicated to visualization of model prediction line
 * Uses ONLY y_hat values for true forward-looking predictions
 */

import { loadBaseForecastPairs } from '../conformal/calibration';

// Debug flag to enable verbose per-point logging (set PREDICTION_DEBUG=1 in environment)
const PREDICTION_DEBUG = process.env.PREDICTION_DEBUG === '1';

/**
 * Load prediction series for visualization (orange model line)
 * Only uses forecasts with explicit y_hat values
 */
export async function loadPredictionSeries(
  symbol: string,
  window: number,
  method: string
): Promise<Array<{ date: string; model_price: number }>> {
  // Get all forecast pairs for this method
  const allPairs = await loadBaseForecastPairs(symbol, window, 'price', method, undefined, undefined);

  const series: Array<{ date: string; model_price: number }> = [];

  for (const pair of allPairs) {
    const forecast = pair.forecast;

    // Use true stored prediction ONLY if y_hat is available
    if (forecast.y_hat != null) {
      series.push({
        date: pair.realizedDate,         // where we compare prediction vs realized (t+1)
        model_price: forecast.y_hat,     // explicit prediction in price space
      });
      
      if (PREDICTION_DEBUG) {
        console.log(`[PREDICTION LINE] ${pair.realizedDate}: model_price=${forecast.y_hat.toFixed(2)} from ${forecast.method}`);
      }
    }
    // If y_hat is missing, skip this point (don't use geometric mean for visualization)
  }

  if (PREDICTION_DEBUG) {
    console.log(`[PREDICTION SERIES] ${symbol} ${method}: ${series.length} points with y_hat out of ${allPairs.length} total pairs`);
  }
  
  return series;
}