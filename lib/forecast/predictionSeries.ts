/**
 * Prediction series loader - dedicated to visualization of model prediction line
 * Uses ONLY y_hat values for true forward-looking predictions
 */

import { loadBaseForecastPairs } from '../conformal/calibration';

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
      
      console.log(`[PREDICTION LINE] ${pair.realizedDate}: model_price=${forecast.y_hat.toFixed(2)} from ${forecast.method}`);
    }
    // If y_hat is missing, skip this point (don't use geometric mean for visualization)
  }

  console.log(`[PREDICTION SERIES] ${symbol} ${method}: ${series.length} points with y_hat out of ${allPairs.length} total pairs`);
  
  return series;
}