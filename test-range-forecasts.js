#!/usr/bin/env node

/**
 * End-to-end verification of Range estimators (P, GK, RS, YZ)
 * Tests AAPL with window=1000, ewma_lambda=0.94, h=1, coverage=95%
 */

const models = ["Range-P", "Range-GK", "Range-RS", "Range-YZ"];

async function generateRangeForecasts() {
  console.log("🔄 GENERATING RANGE FORECASTS FOR AAPL");
  console.log("=====================================\n");

  const baseUrl = "http://localhost:3000";
  const symbol = "AAPL";
  const params = {
    model: "",  // Will be set for each estimator
    params: { 
      range: { 
        window: 1000, 
        ewma_lambda: 0.94 
      } 
    },
    h: 1,
    coverage: 0.95,
    date_t: "2025-10-10"
  };

  const results = {};

  for (const model of models) {
    console.log(`📊 Testing ${model}...`);
    
    try {
      const requestBody = { ...params, model };
      
      const response = await fetch(`${baseUrl}/api/volatility/${symbol}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`❌ ${model} FAILED: ${response.status} ${response.statusText}`);
        console.log(`   Error: ${errorText}\n`);
        results[model] = { success: false, error: errorText };
        continue;
      }

      const result = await response.json();
      console.log(`✅ ${model} SUCCESS`);
      console.log(`   σ_1d: ${result.estimates?.sigma_forecast?.toFixed(6)}`);
      console.log(`   Interval: [${result.intervals?.L_h?.toFixed(4)}, ${result.intervals?.U_h?.toFixed(4)}]`);
      console.log(`   File: ${result.forecastFile}\n`);
      
      results[model] = { 
        success: true, 
        data: result,
        file: result.forecastFile 
      };

    } catch (error) {
      console.log(`❌ ${model} ERROR: ${error.message}\n`);
      results[model] = { success: false, error: error.message };
    }
  }

  return results;
}

async function main() {
  try {
    const results = await generateRangeForecasts();
    
    console.log("📋 SUMMARY");
    console.log("==========");
    
    const successful = Object.keys(results).filter(m => results[m].success);
    const failed = Object.keys(results).filter(m => !results[m].success);
    
    console.log(`✅ Successful: ${successful.join(", ")}`);
    if (failed.length > 0) {
      console.log(`❌ Failed: ${failed.join(", ")}`);
    }
    
    console.log(`\n🎯 Generated ${successful.length}/4 Range forecasts successfully.`);
    
    if (successful.length === 4) {
      console.log("\n🎉 ALL RANGE ESTIMATORS WORKING!");
      console.log("   Yang-Zhang 'Insufficient variance estimates' error is FIXED! ✅");
    }

  } catch (error) {
    console.error("💥 Script failed:", error.message);
  }
}

main();