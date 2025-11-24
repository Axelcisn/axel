#!/usr/bin/env node
/**
 * Generate model defaults for test symbols
 */

import { 
  generateModelDefaults,
  type SupportedModel 
} from './lib/modelSelection';

async function generateDefaults() {
  console.log('Generating Model Defaults');
  console.log('=========================\n');

  const symbols = ['AAPL', 'AMD', 'PLTR'];
  const allModels: SupportedModel[] = ['Range-YZ', 'Range-RS', 'Range-P', 'Range-GK'];
  
  const horizons = [1, 3, 5, 7, 10];
  const coverages = [0.85, 0.90, 0.95, 0.99];

  for (const symbol of symbols) {
    console.log(`\nGenerating defaults for ${symbol}...`);
    
    try {
      // Create configuration combinations
      const configurations = [];
      for (const h of horizons) {
        for (const c of coverages) {
          configurations.push({ horizonTrading: h, coverage: c });
        }
      }
      
      const defaults = await generateModelDefaults(symbol, configurations);
      
      console.log(`✅ Generated defaults for ${symbol}`);
      console.log(`   Combinations: ${Object.keys(defaults.defaults).length} horizons`);
      
      // Show a few examples
      Object.keys(defaults.defaults).slice(0, 2).forEach(h => {
        Object.keys(defaults.defaults[h]).slice(0, 2).forEach(c => {
          console.log(`   ${h}/${c}: ${defaults.defaults[h][c]}`);
        });
      });
      
    } catch (error: any) {
      console.error(`❌ Failed to generate defaults for ${symbol}:`, error?.message);
    }
  }
}

generateDefaults().catch(console.error);