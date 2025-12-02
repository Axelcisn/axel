#!/usr/bin/env tsx

/**
 * Test script for EWMA Walker implementation
 * Validates the walker functionality with AAPL data for various horizons
 */

import { runEwmaWalker, EwmaWalkerPoint } from './lib/volatility/ewmaWalker';

async function testEwmaWalker() {
  try {
    console.log('🧪 Testing EWMA Walker Implementation');
    console.log('=====================================');
    console.log();

    // Test with AAPL over last 3 years (approximate)
    const params = {
      symbol: 'AAPL',
      lambda: 0.94,           // Typical EWMA decay
      startDate: '2022-01-01', // Approx 3 years back
      endDate: '2024-12-01',   // Up to recent
      initialWindow: 252,      // 1 year initial window
      coverage: 0.95,         // 95% prediction intervals
      horizon: 1,             // 1-day forecast (default)
    };

    console.log('Running EWMA walker with parameters:');
    console.log(`  Symbol: ${params.symbol}`);
    console.log(`  Lambda: ${params.lambda}`);
    console.log(`  Date range: ${params.startDate} to ${params.endDate}`);
    console.log(`  Initial window: ${params.initialWindow}`);
    console.log(`  Coverage: ${params.coverage}`);
    console.log(`  Horizon: ${params.horizon}D`);
    console.log();

    const result = await runEwmaWalker(params);

    console.log('📊 EWMA Walker Results:');
    console.log('=======================');
    console.log();
    console.log(`Total forecast points: ${result.points.length}`);
    console.log(`Total PI metrics: ${result.piMetrics.length}`);
    console.log(`Horizon used: ${result.params.horizon}D`);
    console.log();

    if (result.points.length > 0) {
      // Show first few points
      console.log('First 3 forecast points:');
      result.points.slice(0, 3).forEach((point, i) => {
        console.log(`  Point ${i + 1}:`);
        console.log(`    Date: ${point.date_t} → ${point.date_tp1}`);
        console.log(`    Price: $${point.S_t.toFixed(2)} → $${point.S_tp1.toFixed(2)}`);
        console.log(`    Forecast: $${point.y_hat_tp1.toFixed(2)}`);
        console.log(`    Band: [$${point.L_tp1.toFixed(2)}, $${point.U_tp1.toFixed(2)}]`);
        console.log(`    Volatility: ${(point.sigma_t * 100).toFixed(2)}%`);
        console.log(`    Std Error: ${point.standardizedError.toFixed(3)}`);
        console.log(`    Direction: ${point.directionCorrect ? '✓' : '✗'}`);
        console.log();
      });

      // Show last few points
      console.log('Last 3 forecast points:');
      result.points.slice(-3).forEach((point, i) => {
        console.log(`  Point ${result.points.length - 3 + i + 1}:`);
        console.log(`    Date: ${point.date_t} → ${point.date_tp1}`);
        console.log(`    Price: $${point.S_t.toFixed(2)} → $${point.S_tp1.toFixed(2)}`);
        console.log(`    Forecast: $${point.y_hat_tp1.toFixed(2)}`);
        console.log(`    Band: [$${point.L_tp1.toFixed(2)}, $${point.U_tp1.toFixed(2)}]`);
        console.log(`    Volatility: ${(point.sigma_t * 100).toFixed(2)}%`);
        console.log(`    Std Error: ${point.standardizedError.toFixed(3)}`);
        console.log(`    Direction: ${point.directionCorrect ? '✓' : '✗'}`);
        console.log();
      });
    }

    console.log('📈 Aggregate Performance Metrics:');
    console.log('=================================');
    console.log();
    console.log(`Coverage achieved: ${(result.aggregatedMetrics.coverage * 100).toFixed(1)}% (target: ${params.coverage * 100}%)`);
    console.log(`Average interval score: ${result.aggregatedMetrics.avg_interval_score.toFixed(4)}`);
    console.log(`Number of observations: ${result.aggregatedMetrics.count}`);
    console.log();

    if (result.points.length > 0) {
      // Additional diagnostic statistics
      const standardizedErrors = result.points.map(p => p.standardizedError);
      const directionAccuracy = result.points.filter(p => p.directionCorrect).length / result.points.length;
      
      const meanStdError = standardizedErrors.reduce((sum, e) => sum + e, 0) / standardizedErrors.length;
      const stdStdError = Math.sqrt(
        standardizedErrors.reduce((sum, e) => sum + Math.pow(e - meanStdError, 2), 0) / standardizedErrors.length
      );

      console.log('📊 Diagnostic Statistics:');
      console.log('=========================');
      console.log();
      console.log(`Direction accuracy: ${(directionAccuracy * 100).toFixed(1)}%`);
      console.log(`Standardized errors mean: ${meanStdError.toFixed(3)} (should be ≈ 0)`);
      console.log(`Standardized errors std: ${stdStdError.toFixed(3)} (should be ≈ 1)`);
      console.log();

      // Volatility distribution
      const volatilities = result.points.map(p => p.sigma_t);
      const minVol = Math.min(...volatilities);
      const maxVol = Math.max(...volatilities);
      const avgVol = volatilities.reduce((sum, v) => sum + v, 0) / volatilities.length;
      
      console.log('📊 Volatility Distribution:');
      console.log('===========================');
      console.log();
      console.log(`Average volatility: ${(avgVol * 100).toFixed(2)}% daily`);
      console.log(`Min volatility: ${(minVol * 100).toFixed(2)}% daily`);
      console.log(`Max volatility: ${(maxVol * 100).toFixed(2)}% daily`);
      console.log();
    }

    console.log('✅ EWMA Walker test completed successfully!');

  } catch (error: unknown) {
    console.error('❌ EWMA Walker test failed:');
    const err = error as Error;
    console.error(err.message);
    if (err.stack) {
      console.error('\nStack trace:');
      console.error(err.stack);
    }
    process.exit(1);
  }
}

// Run the test
testEwmaWalker();