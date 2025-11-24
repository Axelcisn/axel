#!/usr/bin/env node
/**
 * Test script for model selection system
 */

const { 
  computeModelSelection, 
  getModelDefaults, 
  loadModelSelectionData 
} = require('./lib/modelSelection');

async function testModelSelection() {
  console.log('Testing Model Selection System');
  console.log('===============================\n');

  const testCases = [
    { symbol: 'AAPL', horizonTrading: 3, coverage: 0.95 },
    { symbol: 'AMD', horizonTrading: 5, coverage: 0.90 },
    { symbol: 'PLTR', horizonTrading: 7, coverage: 0.85 }
  ];

  for (const { symbol, horizonTrading, coverage } of testCases) {
    console.log(`Testing ${symbol} (${horizonTrading}D, ${(coverage * 100).toFixed(0)}%)`);
    console.log('-'.repeat(40));

    try {
      // Compute model selection
      const result = await computeModelSelection(symbol, horizonTrading, coverage);
      
      if (result) {
        console.log(`  ✓ Computed selection for ${symbol}`);
        console.log(`    Default Model: ${result.defaultMethod}`);
        console.log(`    Score: ${result.scoreData[0]?.compositeScore?.toFixed(4) || 'N/A'}`);
        console.log(`    Models Evaluated: ${result.scoreData.length}`);
        
        result.scoreData.forEach((score, i) => {
          console.log(`    ${i + 1}. ${score.model}: ${score.compositeScore.toFixed(4)}`);
        });
      } else {
        console.log(`  ✗ No result for ${symbol}`);
      }

      // Test loading selection data
      const loadedData = await loadModelSelectionData(symbol, horizonTrading, coverage);
      if (loadedData) {
        console.log(`  ✓ Loaded cached selection data (${loadedData.scoreData.length} models)`);
      }

    } catch (error) {
      console.error(`  ✗ Error testing ${symbol}:`, error.message);
    }

    console.log();
  }

  // Test model defaults
  console.log('Testing Model Defaults');
  console.log('======================\n');

  try {
    for (const { symbol } of testCases) {
      const defaults = await getModelDefaults(symbol);
      if (defaults) {
        console.log(`${symbol} Model Defaults:`);
        Object.keys(defaults.defaults).forEach(horizon => {
          Object.keys(defaults.defaults[horizon]).forEach(coverage => {
            console.log(`  ${horizon}/${coverage}: ${defaults.defaults[horizon][coverage]}`);
          });
        });
        console.log(`  Updated: ${defaults.computedAt}\n`);
      } else {
        console.log(`${symbol}: No defaults found\n`);
      }
    }
  } catch (error) {
    console.error('Error testing defaults:', error.message);
  }
}

// Run the test
testModelSelection().catch(console.error);