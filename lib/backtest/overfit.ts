import { OverfitGuards } from './types';

/**
 * Overfitting Protection for Backtest Results
 * 
 * Implements methods to detect and quantify overfitting in trading strategies
 * and prediction models through cross-validation and statistical adjustments.
 */

interface StrategyPerformance {
  returns: number[];      // Strategy returns
  sharpe: number;         // Sharpe ratio
  max_drawdown: number;   // Maximum drawdown
  volatility: number;     // Annualized volatility
}

interface CrossValidationResult {
  train_performance: StrategyPerformance;
  test_performance: StrategyPerformance;
  deterioration: number;  // (train_sharpe - test_sharpe) / train_sharpe
}

/**
 * Probability of Backtest Overfitting (PBO) using Combinatorially Symmetric Cross-Validation
 */
export function computePBO(
  strategies: StrategyPerformance[],
  numFolds: number = 16
): number {
  
  if (strategies.length < 2) {
    return 0; // Cannot compute PBO with single strategy
  }
  
  console.log(`Computing PBO for ${strategies.length} strategies with ${numFolds} folds`);
  
  // Simplified PBO implementation
  // In production, would implement full CSCV with multiple train/test splits
  
  let overfittedCount = 0;
  const totalComparisons = strategies.length;
  
  for (const strategy of strategies) {
    // Simple overfitting heuristic: strategy with very high Sharpe (>3) likely overfitted
    // More sophisticated version would use multiple OOS periods
    if (strategy.sharpe > 3.0) {
      overfittedCount++;
    }
    
    // Additional check: extremely low volatility might indicate curve fitting
    if (strategy.volatility < 0.05 && strategy.sharpe > 2.0) {
      overfittedCount++;
    }
  }
  
  const pbo = Math.min(1.0, overfittedCount / totalComparisons);
  
  console.log(`PBO estimate: ${(pbo * 100).toFixed(1)}%`);
  return pbo;
}

/**
 * Deflated Sharpe Ratio (DSR) adjustment for multiple testing
 */
export function computeDeflatedSharpeRatio(
  observedSharpe: number,
  numTrials: number,
  numObservations: number,
  skewness: number = 0,
  kurtosis: number = 3
): number {
  
  if (numObservations < 30) {
    console.warn('DSR computation requires at least 30 observations');
    return observedSharpe;
  }
  
  console.log(`Computing DSR: Sharpe=${observedSharpe.toFixed(3)}, trials=${numTrials}, n=${numObservations}`);
  
  // Estimate expected maximum Sharpe under null hypothesis
  const expectedMaxSharpe = estimateExpectedMaxSharpe(numTrials, numObservations, skewness, kurtosis);
  
  // Estimate standard error of maximum Sharpe
  const seMaxSharpe = estimateStandardErrorMaxSharpe(numTrials, numObservations);
  
  // Deflated Sharpe Ratio
  const dsr = (observedSharpe - expectedMaxSharpe) / seMaxSharpe;
  
  console.log(`DSR: ${dsr.toFixed(3)} (expected max: ${expectedMaxSharpe.toFixed(3)})`);
  return dsr;
}

/**
 * Estimate expected maximum Sharpe ratio under null hypothesis
 */
function estimateExpectedMaxSharpe(
  numTrials: number,
  numObservations: number,
  skewness: number = 0,
  kurtosis: number = 3
): number {
  
  // Simplified estimation using extreme value theory
  const gamma = 0.5772; // Euler-Mascheroni constant
  
  // Expected value of maximum of numTrials standard normal variables
  const expectedMax = Math.sqrt(2 * Math.log(numTrials)) - 
                     (Math.log(Math.log(numTrials)) + Math.log(4 * Math.PI)) / 
                     (2 * Math.sqrt(2 * Math.log(numTrials))) + 
                     gamma / Math.sqrt(2 * Math.log(numTrials));
  
  // Adjust for finite sample effects
  const finiteAdjustment = Math.sqrt((kurtosis - 1) / numObservations);
  
  return expectedMax * (1 + finiteAdjustment);
}

/**
 * Estimate standard error of maximum Sharpe ratio
 */
function estimateStandardErrorMaxSharpe(
  numTrials: number,
  numObservations: number
): number {
  
  // Standard error of maximum using extreme value theory
  const seMax = Math.PI / (Math.sqrt(6) * Math.sqrt(2 * Math.log(numTrials)));
  
  // Adjust for finite sample
  const finiteAdjustment = Math.sqrt(1 / numObservations);
  
  return seMax * (1 + finiteAdjustment);
}

/**
 * Cross-validation analysis for overfitting detection
 */
export function crossValidationAnalysis(
  returns: number[],
  numFolds: number = 5
): {
  cv_results: CrossValidationResult[];
  avg_deterioration: number;
  overfitting_score: number;
} {
  
  const n = returns.length;
  const foldSize = Math.floor(n / numFolds);
  
  if (foldSize < 30) {
    throw new Error('Insufficient data for cross-validation (need at least 30 obs per fold)');
  }
  
  console.log(`Running ${numFolds}-fold cross-validation on ${n} observations`);
  
  const cvResults: CrossValidationResult[] = [];
  
  for (let fold = 0; fold < numFolds; fold++) {
    const testStart = fold * foldSize;
    const testEnd = Math.min(testStart + foldSize, n);
    
    // Split data
    const trainReturns = [
      ...returns.slice(0, testStart),
      ...returns.slice(testEnd)
    ];
    const testReturns = returns.slice(testStart, testEnd);
    
    // Compute performance metrics
    const trainPerf = computePerformanceMetrics(trainReturns);
    const testPerf = computePerformanceMetrics(testReturns);
    
    const deterioration = trainPerf.sharpe > 0 ? 
      (trainPerf.sharpe - testPerf.sharpe) / trainPerf.sharpe : 0;
    
    cvResults.push({
      train_performance: trainPerf,
      test_performance: testPerf,
      deterioration
    });
  }
  
  const avgDeterioration = cvResults.reduce((sum, cv) => sum + cv.deterioration, 0) / numFolds;
  
  // Overfitting score: high if performance consistently deteriorates OOS
  const overfittingScore = Math.max(0, Math.min(1, avgDeterioration));
  
  console.log(`Average deterioration: ${(avgDeterioration * 100).toFixed(1)}%`);
  console.log(`Overfitting score: ${overfittingScore.toFixed(3)}`);
  
  return {
    cv_results: cvResults,
    avg_deterioration: avgDeterioration,
    overfitting_score: overfittingScore
  };
}

/**
 * Compute performance metrics from returns series
 */
function computePerformanceMetrics(returns: number[]): StrategyPerformance {
  if (returns.length === 0) {
    return { returns: [], sharpe: 0, max_drawdown: 0, volatility: 0 };
  }
  
  const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  const volatility = Math.sqrt(variance) * Math.sqrt(252); // Annualized
  
  const sharpe = volatility > 0 ? (mean * Math.sqrt(252)) / volatility : 0;
  
  // Compute maximum drawdown
  const cumReturns = returns.reduce((acc, r, i) => {
    acc.push((acc[i - 1] || 0) + r);
    return acc;
  }, [] as number[]);
  
  let maxDrawdown = 0;
  let peak = cumReturns[0] || 0;
  
  for (const cumReturn of cumReturns) {
    if (cumReturn > peak) {
      peak = cumReturn;
    }
    const drawdown = peak - cumReturn;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }
  
  return {
    returns,
    sharpe,
    max_drawdown: maxDrawdown,
    volatility
  };
}

/**
 * Comprehensive overfitting analysis
 */
export function comprehensiveOverfittingAnalysis(
  strategies: StrategyPerformance[],
  numTrials: number,
  numObservations: number
): OverfitGuards {
  
  console.log('Running comprehensive overfitting analysis');
  
  let pbo: number | undefined;
  let dsr: number | undefined;
  
  // Compute PBO if multiple strategies
  if (strategies.length > 1) {
    pbo = computePBO(strategies);
  }
  
  // Compute DSR for best strategy
  if (strategies.length > 0) {
    const bestStrategy = strategies.reduce((best, current) => 
      current.sharpe > best.sharpe ? current : best
    );
    
    dsr = computeDeflatedSharpeRatio(
      bestStrategy.sharpe,
      numTrials,
      numObservations
    );
  }
  
  return { pbo, dsr };
}

/**
 * Data snooping bias test
 */
export function dataSnoopingBiasTest(
  performances: number[],
  baselinePerformance: number
): {
  reality_check_pvalue: number;
  superior_predictive_ability_pvalue: number;
} {
  
  // Simplified implementation of White's Reality Check and Hansen's SPA test
  const n = performances.length;
  const excesses = performances.map(perf => perf - baselinePerformance);
  
  const mean = excesses.reduce((sum, ex) => sum + ex, 0) / n;
  const variance = excesses.reduce((sum, ex) => sum + Math.pow(ex - mean, 2), 0) / (n - 1);
  const stderr = Math.sqrt(variance / n);
  
  const tStat = stderr > 0 ? mean / stderr : 0;
  
  // Approximate p-values (in practice would use bootstrap)
  const rcPvalue = 2 * (1 - standardNormalCDF(Math.abs(tStat)));
  const spaPvalue = 1 - standardNormalCDF(tStat); // One-sided for SPA
  
  return {
    reality_check_pvalue: rcPvalue,
    superior_predictive_ability_pvalue: spaPvalue
  };
}

function standardNormalCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function erf(x: number): number {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  
  return sign * y;
}