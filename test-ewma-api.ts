#!/usr/bin/env tsx

/**
 * Test the EWMA Walker API endpoint
 */

async function testEwmaApi() {
  try {
    console.log('🧪 Testing EWMA Walker API');
    console.log('==========================');
    console.log();

    const baseUrl = 'http://localhost:3000';
    const symbol = 'AAPL';
    
    const requestBody = {
      lambda: 0.94,
      startDate: '2024-01-01',
      endDate: '2024-06-01',
      initialWindow: 252,
      coverage: 0.95
    };

    console.log(`Testing POST ${baseUrl}/api/volatility/ewma/${symbol}`);
    console.log('Request body:', JSON.stringify(requestBody, null, 2));
    console.log();

    const response = await fetch(`${baseUrl}/api/volatility/ewma/${symbol}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    console.log(`Response status: ${response.status}`);
    console.log();

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();

    console.log('📊 API Response Summary:');
    console.log('========================');
    console.log();
    console.log(`Success: ${result.success}`);
    console.log(`Symbol: ${result.symbol}`);
    console.log(`Total points: ${result.summary.totalPoints}`);
    console.log(`Coverage achieved: ${(result.aggregatedMetrics.coverage * 100).toFixed(1)}%`);
    console.log(`Average volatility: ${(result.summary.averageVolatility * 100).toFixed(2)}%`);
    console.log(`Direction accuracy: ${(result.summary.directionAccuracy * 100).toFixed(1)}%`);
    console.log(`Date range: ${result.summary.dateRange?.start} to ${result.summary.dateRange?.end}`);
    console.log();

    if (result.points && result.points.length > 0) {
      console.log('📊 Sample Points (first 3):');
      console.log('============================');
      result.points.slice(0, 3).forEach((point: any, i: number) => {
        console.log(`  Point ${i + 1}:`);
        console.log(`    ${point.date_t} → ${point.date_tp1}`);
        console.log(`    Price: $${point.S_t.toFixed(2)} → $${point.S_tp1.toFixed(2)}`);
        console.log(`    Forecast: $${point.y_hat_tp1.toFixed(2)}`);
        console.log(`    Band: [$${point.L_tp1.toFixed(2)}, $${point.U_tp1.toFixed(2)}]`);
        console.log(`    σ: ${(point.sigma_t * 100).toFixed(2)}%`);
        console.log();
      });
    }

    console.log('✅ EWMA Walker API test completed successfully!');

  } catch (error) {
    console.error('❌ EWMA Walker API test failed:');
    console.error(error instanceof Error ? error.message : String(error));
    console.log();
    console.log('💡 Make sure the Next.js dev server is running:');
    console.log('   npm run dev');
  }
}

// Run the test
testEwmaApi();