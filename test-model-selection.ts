/**
 * Test script for model selection system
 */

import { 
  computeModelSelection, 
  loadModelDefaults, 
  loadModelSelectionResult,
  type ModelSelectionOpts,
  type SupportedModel 
} from './lib/modelSelection';

async function testModelSelection() {
  console.log('Testing Model Selection System');
  console.log('===============================\n');

  const testCases = [
    { symbol: 'AAPL', horizonTrading: 3, coverage: 0.95 },
    { symbol: 'AMD', horizonTrading: 5, coverage: 0.90 },
    { symbol: 'PLTR', horizonTrading: 7, coverage: 0.85 }
  ];

  const allModels: SupportedModel[] = ['Range-YZ', 'Range-RS', 'Range-P', 'Range-GK'];

  for (const { symbol, horizonTrading, coverage } of testCases) {
    console.log(`Testing ${symbol} (${horizonTrading}D, ${(coverage * 100).toFixed(0)}%)`);
    console.log('-'.repeat(40));

    try {
      // Compute model selection
      const opts: ModelSelectionOpts = {
        symbol,
        models: allModels,
        horizonTrading,
        coverage
      };
      
      const result = await computeModelSelection(opts);
      
      if (result) {
        console.log(`  ✓ Computed selection for ${symbol}`);
        console.log(`    Default Model: ${result.defaultMethod}`);
        console.log(`    Score: ${result.modelScores[0]?.score?.toFixed(4) || 'N/A'}`);
        console.log(`    Models Evaluated: ${result.modelScores.length}`);
        
        result.modelScores.forEach((score, i) => {
          console.log(`    ${i + 1}. ${score.model}: ${score.score.toFixed(4)}`);
        });
      } else {
        console.log(`  ✗ No result for ${symbol}`);
      }

      // Test loading selection data
      const loadedData = loadModelSelectionResult(symbol, horizonTrading, coverage);
      if (loadedData) {
        console.log(`  ✓ Loaded cached selection data (${loadedData.modelScores.length} models)`);
      }

    } catch (error: any) {
      console.error(`  ✗ Error testing ${symbol}:`, error?.message || String(error));
    }

    console.log();
  }

  // Test model defaults
  console.log('Testing Model Defaults');
  console.log('======================\n');

  try {
    for (const { symbol } of testCases) {
      const defaults = loadModelDefaults(symbol);
      if (defaults) {
        console.log(`${symbol} Model Defaults:`);
        Object.keys(defaults.defaults).forEach(horizon => {
          Object.keys(defaults.defaults[horizon]).forEach(coverage => {
            console.log(`  ${horizon}/${coverage}: ${defaults.defaults[horizon][coverage]}`);
          });
        });
        console.log(`  Updated: ${defaults.lastUpdated}\n`);
      } else {
        console.log(`${symbol}: No defaults found\n`);
      }
    }
  } catch (error: any) {
    console.error('Error testing defaults:', error?.message || String(error));
  }
}

// Run the test
testModelSelection().catch(console.error);