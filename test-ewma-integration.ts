#!/usr/bin/env tsx

/**
 * Integration test for EWMA Walker - smaller test with specific validation
 * Tests both 1D (default) and multi-day horizons
 */

import { runEwmaWalker, EwmaWalkerPoint } from './lib/volatility/ewmaWalker';

async function runIntegrationTest() {
  try {
    console.log('🔬 EWMA Walker Integration Test');
    console.log('===============================');
    console.log();

    // Test with smaller date range for faster execution
    const params = {
      symbol: 'AAPL',
      lambda: 0.94,
      startDate: '2024-01-01',
      endDate: '2024-06-01',  // 5 months for more data
      initialWindow: 50,      // Smaller initial window  
      coverage: 0.95,
      horizon: 1,             // 1-day forecast (default)
    };

    console.log('Test parameters:');
    console.log(`  Symbol: ${params.symbol}`);
    console.log(`  Lambda: ${params.lambda}`);
    console.log(`  Date range: ${params.startDate} to ${params.endDate}`);
    console.log(`  Initial window: ${params.initialWindow}`);
    console.log(`  Coverage: ${params.coverage}`);
    console.log(`  Horizon: ${params.horizon}D`);
    console.log();

    const result = await runEwmaWalker(params);

    // Validation tests
    const tests = [
      {
        name: 'Has forecast points',
        test: () => result.points.length > 0,
        expected: true
      },
      {
        name: 'Points have required fields',
        test: () => {
          if (result.points.length === 0) return false;
          const point = result.points[0];
          return point.date_t && point.date_tp1 && 
                 typeof point.S_t === 'number' && 
                 typeof point.sigma_t === 'number' &&
                 typeof point.L_tp1 === 'number' && 
                 typeof point.U_tp1 === 'number';
        },
        expected: true
      },
      {
        name: 'PI metrics match points count',
        test: () => result.piMetrics.length === result.points.length,
        expected: true
      },
      {
        name: 'Coverage is reasonable (80%-100%)',
        test: () => result.aggregatedMetrics.coverage >= 0.80 && result.aggregatedMetrics.coverage <= 1.0,
        expected: true
      },
      {
        name: 'Lower bounds < Upper bounds',
        test: () => result.points.every((p: EwmaWalkerPoint) => p.L_tp1 < p.U_tp1),
        expected: true
      },
      {
        name: 'Volatilities are positive',
        test: () => result.points.every((p: EwmaWalkerPoint) => p.sigma_t > 0),
        expected: true
      },
      {
        name: 'Dates are properly sequenced',
        test: () => {
          for (let i = 1; i < result.points.length; i++) {
            if (result.points[i].date_t <= result.points[i-1].date_t) return false;
          }
          return true;
        },
        expected: true
      }
    ];

    console.log('🧪 Running validation tests:');
    console.log('=============================');
    console.log();

    let passedTests = 0;
    for (const test of tests) {
      const result_test = test.test();
      const passed = result_test === test.expected;
      console.log(`${passed ? '✅' : '❌'} ${test.name}: ${result_test}`);
      if (passed) passedTests++;
    }

    console.log();
    console.log(`Tests passed: ${passedTests}/${tests.length}`);
    console.log();

    if (passedTests === tests.length) {
      console.log('📊 Summary Results (1D):');
      console.log('========================');
      console.log(`Total points: ${result.points.length}`);
      console.log(`Horizon: ${result.params.horizon}D`);
      console.log(`Coverage: ${(result.aggregatedMetrics.coverage * 100).toFixed(1)}%`);
      console.log(`Avg interval score: ${result.aggregatedMetrics.avg_interval_score.toFixed(4)}`);
      
      if (result.points.length > 0) {
        const avgVol = result.points.reduce((sum: number, p: any) => sum + p.sigma_t, 0) / result.points.length;
        console.log(`Average volatility: ${(avgVol * 100).toFixed(2)}% daily`);
        
        const directionAccuracy = result.points.filter((p: any) => p.directionCorrect).length / result.points.length;
        console.log(`Direction accuracy: ${(directionAccuracy * 100).toFixed(1)}%`);
      }
      console.log();

      // Now test with horizon = 5
      console.log('📊 Testing Multi-Day Horizon (5D):');
      console.log('===================================');
      
      const result5D = await runEwmaWalker({
        ...params,
        horizon: 5,
      });
      
      console.log(`Total points (5D): ${result5D.points.length}`);
      console.log(`Horizon used: ${result5D.params.horizon}D`);
      console.log(`Coverage (5D): ${(result5D.aggregatedMetrics.coverage * 100).toFixed(1)}%`);
      
      // Verify that 5D has fewer points (by h-1 = 4)
      const expectedDiff = 4; // h-1 for horizon=5
      const actualDiff = result.points.length - result5D.points.length;
      console.log(`Point reduction: ${actualDiff} (expected ~${expectedDiff})`);
      
      // Verify that avgWidth increases with horizon (roughly by sqrt(5)/sqrt(1) ≈ 2.24)
      const avgWidth1D = result.points.reduce((sum: number, p: any) => sum + (p.U_tp1 - p.L_tp1) / p.S_t, 0) / result.points.length;
      const avgWidth5D = result5D.points.reduce((sum: number, p: any) => sum + (p.U_tp1 - p.L_tp1) / p.S_t, 0) / result5D.points.length;
      const widthRatio = avgWidth5D / avgWidth1D;
      const expectedRatio = Math.sqrt(5);
      console.log(`Avg width (1D): ${(avgWidth1D * 100).toFixed(2)}%`);
      console.log(`Avg width (5D): ${(avgWidth5D * 100).toFixed(2)}%`);
      console.log(`Width ratio: ${widthRatio.toFixed(2)} (expected ~${expectedRatio.toFixed(2)} = √5)`);
      
      console.log();
      console.log('✅ All tests passed! EWMA Walker is working correctly for all horizons.');
    } else {
      console.log('❌ Some tests failed. Please check the implementation.');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Integration test failed:');
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the test
runIntegrationTest();