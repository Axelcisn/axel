// cspell:words stationarity Bera
// Mathematical computation service for forecasting models
import { MarketData, PredictionInterval, VolatilityEstimate } from './forecastingTypes';

export interface GBMParameters {
  muStarHat: number;        // MLE mean of log returns
  sigmaHat: number;         // MLE volatility (denominator N)
  muStarUsed: number;       // λ-shrunk drift (λ ∈ [0,1])
  lambda: number;           // Shrinkage parameter
  windowSize: number;       // Window N (default 504)
  confidence: number;       // Confidence level (1-α)
}

export interface GBMForecast {
  horizon: number;
  pointForecast: number;    // exp(m_t(h))
  lower: number;            // L_h = exp(m_t(h) - z_α * s_t(h))
  upper: number;            // U_h = exp(m_t(h) + z_α * s_t(h))
  parameters: GBMParameters;
  timestamp: Date;
  bandWidthBp: number;      // 10000 * (U_1 / L_1 - 1)
}

export class MathService {
  
  // Calculate log returns from price data
  static calculateLogReturns(prices: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
    return returns;
  }

  // Calculate sample mean
  static mean(values: number[]): number {
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  // Calculate sample variance using MLE (denominator N, not N-1)
  static varianceMLE(values: number[]): number {
    const mu = this.mean(values);
    const squaredDiffs = values.map(val => Math.pow(val - mu, 2));
    return this.mean(squaredDiffs); // MLE uses N, not N-1
  }

  // Calculate sample standard deviation using MLE
  static standardDeviationMLE(values: number[]): number {
    return Math.sqrt(this.varianceMLE(values));
  }

  // Normal distribution inverse CDF (approximation)
  static normalInverse(p: number): number {
    // Beasley-Springer-Moro algorithm approximation
    const a = [0, -3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [0, -5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [0, -7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [0, 7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];

    const pLow = 0.02425;
    const pHigh = 1 - pLow;
    let q: number, r: number;

    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[1] * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) * q + c[6]) /
             ((((d[1] * q + d[2]) * q + d[3]) * q + d[4]) * q + 1);
    } else if (p <= pHigh) {
      q = p - 0.5;
      r = q * q;
      return (((((a[1] * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * r + a[6]) * q /
             (((((b[1] * r + b[2]) * r + b[3]) * r + b[4]) * r + b[5]) * r + 1);
    } else {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[1] * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) * q + c[6]) /
              ((((d[1] * q + d[2]) * q + d[3]) * q + d[4]) * q + 1);
    }
  }

  // Calculate rolling window statistics
  static rollingStatistics(values: number[], windowSize: number): Array<{mean: number, std: number, start: number, end: number}> {
    const results: Array<{mean: number, std: number, start: number, end: number}> = [];
    
    for (let i = windowSize - 1; i < values.length; i++) {
      const window = values.slice(i - windowSize + 1, i + 1);
      results.push({
        mean: this.mean(window),
        std: this.standardDeviationMLE(window),
        start: i - windowSize + 1,
        end: i
      });
    }
    
    return results;
  }

  // Exponentially Weighted Moving Average
  static ewma(values: number[], lambda: number): number[] {
    const result: number[] = [];
    result[0] = values[0];
    
    for (let i = 1; i < values.length; i++) {
      result[i] = lambda * result[i - 1] + (1 - lambda) * values[i];
    }
    
    return result;
  }
}

export class GBMService {
  
  /**
   * Estimate GBM parameters using MLE with λ-shrinkage - Step 3 specification
   * Window N (default 504), MLE estimation, λ-shrinkage
   */
  static estimateParameters(
    data: MarketData[], 
    windowSize: number = 504,
    lambda: number = 1.0,
    confidence: number = 0.95
  ): GBMParameters {
    const prices = data.map(d => d.close);
    const logReturns = MathService.calculateLogReturns(prices);
    
    // Use last N observations
    const N = Math.min(windowSize, logReturns.length);
    const recentReturns = logReturns.slice(-N);
    
    // MLE estimation
    const muStarHat = MathService.mean(recentReturns);  // MLE mean of log-returns
    const sigmaHat = MathService.standardDeviationMLE(recentReturns);  // MLE (denominator N)
    
    // Drift shrinkage: μ*_used = λ * μ*_hat
    const muStarUsed = lambda * muStarHat;  // λ ∈ [0,1]
    
    return {
      muStarHat,
      sigmaHat,
      muStarUsed,
      lambda,
      windowSize: N,
      confidence
    };
  }

  /**
   * Generate GBM forecast with prediction intervals (not confidence intervals)
   * m_t(h) = ln(S_t) + h * μ*_used
   * s_t(h) = σ_hat * sqrt(h)
   * L_h = exp(m_t(h) - z_α * s_t(h))
   * U_h = exp(m_t(h) + z_α * s_t(h))
   */
  static forecast(
    currentPrice: number,
    parameters: GBMParameters,
    horizon: number,
    timeframe: string = '1d'
  ): GBMForecast {
    
    // Convert horizon to days (for daily model)
    const timeMultipliers: Record<string, number> = {
      '1m': 1 / (24 * 60),
      '5m': 5 / (24 * 60), 
      '15m': 15 / (24 * 60),
      '1h': 1 / 24,
      '4h': 4 / 24,
      '1d': 1,
      '1w': 7,
      '1M': 30
    };
    
    const h = horizon * (timeMultipliers[timeframe] || 1); // horizon in days
    
    // Step-3 formulas
    const m_t_h = Math.log(currentPrice) + h * parameters.muStarUsed;  // m_t(h)
    const s_t_h = parameters.sigmaHat * Math.sqrt(h);  // s_t(h)
    
    // Prediction intervals (not confidence intervals)
    const alpha = 1 - parameters.confidence;
    const z_alpha = MathService.normalInverse(1 - alpha / 2);
    
    const L_h = Math.exp(m_t_h - z_alpha * s_t_h);  // Lower PI
    const U_h = Math.exp(m_t_h + z_alpha * s_t_h);  // Upper PI
    const pointForecast = Math.exp(m_t_h);  // Point forecast
    
    // Band width in basis points: 10000 * (U_1 / L_1 - 1)
    let bandWidthBp = 0;
    if (h === 1) {
      bandWidthBp = 10000 * (U_h / L_h - 1);
    } else {
      // Calculate for h=1 specifically for band width
      const m_t_1 = Math.log(currentPrice) + 1 * parameters.muStarUsed;
      const s_t_1 = parameters.sigmaHat * Math.sqrt(1);
      const L_1 = Math.exp(m_t_1 - z_alpha * s_t_1);
      const U_1 = Math.exp(m_t_1 + z_alpha * s_t_1);
      bandWidthBp = 10000 * (U_1 / L_1 - 1);
    }
    
    return {
      horizon,
      pointForecast,
      lower: L_h,
      upper: U_h,
      parameters,
      timestamp: new Date(),
      bandWidthBp
    };
  }

  // Generate rolling parameter estimates
  static rollingParameterEstimation(
    data: MarketData[], 
    windowSize: number = 504,
    lambda: number = 1.0
  ): Array<{date: Date, parameters: GBMParameters}> {
    const results: Array<{date: Date, parameters: GBMParameters}> = [];
    
    for (let i = windowSize - 1; i < data.length; i++) {
      const windowData = data.slice(i - windowSize + 1, i + 1);
      const parameters = this.estimateParameters(windowData, windowSize, lambda);
      
      results.push({
        date: data[i].timestamp || data[i].date,
        parameters
      });
    }
    
    return results;
  }

  // Generate multiple horizon forecasts
  static multiHorizonForecast(
    data: MarketData[],
    horizons: number[],
    timeframe: string = '1d',
    windowSize: number = 504,
    lambda: number = 1.0
  ): GBMForecast[] {
    const parameters = this.estimateParameters(data, windowSize, lambda);
    const currentPrice = data[data.length - 1].close;
    
    return horizons.map(horizon => this.forecast(currentPrice, parameters, horizon, timeframe));
  }

    // Validate model assumptions - simplified for Step-3 specification
  static validateAssumptions(data: MarketData[]): {
    normalityTest: { statistic: number, pValue: number, isNormal: boolean },
    autocorrelationTest: { lags: number[], autocorrelations: number[] },
    stationarityTest: { isStationary: boolean, comment: string }
  } {
    const prices = data.map(d => d.close);
    const logReturns = MathService.calculateLogReturns(prices);
    
    // Simple normality test (Jarque-Bera approximation)
    const mean = MathService.mean(logReturns);
    const std = MathService.standardDeviationMLE(logReturns);
    const standardized = logReturns.map(r => (r - mean) / std);
    
    // Skewness and kurtosis
    const skewness = MathService.mean(standardized.map(z => Math.pow(z, 3)));
    const kurtosis = MathService.mean(standardized.map(z => Math.pow(z, 4))) - 3;
    
    const n = logReturns.length;
    const jbStatistic = n * (skewness * skewness / 6 + kurtosis * kurtosis / 24);
    const jbPValue = jbStatistic > 5.99 ? 0.05 : 0.1; // Rough approximation
    
    // Simple autocorrelation test
    const autocorrelations: number[] = [];
    const maxLag = Math.min(10, Math.floor(logReturns.length / 4));
    
    for (let lag = 1; lag <= maxLag; lag++) {
      let sum = 0;
      let count = 0;
      
      for (let i = lag; i < logReturns.length; i++) {
        sum += (logReturns[i] - mean) * (logReturns[i - lag] - mean);
        count++;
      }
      
      const autocorr = sum / (count * std * std);
      autocorrelations.push(autocorr);
    }
    
    return {
      normalityTest: {
        statistic: jbStatistic,
        pValue: jbPValue,
        isNormal: jbStatistic < 5.99
      },
      autocorrelationTest: {
        lags: Array.from({length: maxLag}, (_, i) => i + 1),
        autocorrelations
      },
      stationarityTest: {
        isStationary: true, // Assume log returns are stationary for now
        comment: "Log returns assumed stationary (proper ADF test needed for validation)"
      }
    };
  }

  // Calculate model fit statistics - adapted for Step-3 parameters
  static calculateFitStatistics(
    data: MarketData[],
    forecasts: GBMForecast[]
  ): {
    logLikelihood: number,
    aic: number,
    bic: number,
    rmse: number,
    mae: number
  } {
    const prices = data.map(d => d.close);
    const logReturns = MathService.calculateLogReturns(prices);
    
    // Calculate log-likelihood using Step-3 parameters
    const parameters = forecasts[0].parameters;
    const muStarUsed = parameters.muStarUsed; // Daily drift
    const sigmaHat = parameters.sigmaHat; // Daily volatility
    
    // Log-likelihood of normal distribution
    let logLikelihood = 0;
    for (const r of logReturns) {
      const normalizedReturn = (r - muStarUsed) / sigmaHat;
      logLikelihood += -0.5 * Math.log(2 * Math.PI) - Math.log(sigmaHat) - 0.5 * normalizedReturn * normalizedReturn;
    }
    
    const n = logReturns.length;
    const k = 2; // Number of parameters (μ*, σ)
    
    // Forecast accuracy metrics (placeholder)
    const rmse = MathService.standardDeviationMLE(logReturns);
    const mae = MathService.mean(logReturns.map(r => Math.abs(r - muStarUsed)));
    
    return {
      logLikelihood,
      aic: -2 * logLikelihood + 2 * k,
      bic: -2 * logLikelihood + k * Math.log(n),
      rmse,
      mae
    };
  }
}