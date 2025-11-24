#!/usr/bin/env node
/**
 * Generate realistic backtest data for testing model selection
 */

import fs from 'fs';

function generateBacktestData(symbol: string, basePrice: number): any {
  const models = ['Range-YZ', 'Range-RS', 'Range-P', 'Range-GK'];
  const metrics = [];
  
  const startDate = new Date('2023-01-01');
  const endDate = new Date('2024-01-01');
  
  for (let d = new Date(startDate); d < endDate; d.setDate(d.getDate() + 1)) {
    // Skip weekends
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    
    for (const model of models) {
      // Random price movement 
      const price = basePrice + (Math.random() - 0.5) * basePrice * 0.02;
      const volatility = 0.01 + Math.random() * 0.015; // 1-2.5% volatility
      
      // Model-specific characteristics
      let intervalScore: number;
      let coverageRate: number;
      
      switch (model) {
        case 'Range-YZ':
          intervalScore = 0.8 + Math.random() * 0.6; // 0.8-1.4
          coverageRate = 0.93 + Math.random() * 0.04; // 93-97%
          break;
        case 'Range-RS':
          intervalScore = 0.75 + Math.random() * 0.5; // 0.75-1.25
          coverageRate = 0.94 + Math.random() * 0.04; // 94-98%
          break;
        case 'Range-P':
          intervalScore = 1.2 + Math.random() * 0.8; // 1.2-2.0
          coverageRate = 0.91 + Math.random() * 0.06; // 91-97%
          break;
        case 'Range-GK':
          intervalScore = 1.0 + Math.random() * 0.7; // 1.0-1.7
          coverageRate = 0.92 + Math.random() * 0.05; // 92-97%
          break;
        default:
          intervalScore = 1.0;
          coverageRate = 0.95;
      }
      
      // Generate bounds
      const width = price * volatility * 2; // 2x volatility for bounds
      const L = price - width / 2;
      const U = price + width / 2;
      
      // Determine coverage hit (breach probability based on model)
      const breachProb = 1 - coverageRate;
      const cover_hit = Math.random() > breachProb ? 1 : 0;
      
      // If breach, adjust interval score higher
      if (cover_hit === 0) {
        intervalScore *= (1.5 + Math.random() * 2); // 1.5-3.5x higher
      }
      
      metrics.push({
        date: d.toISOString().split('T')[0],
        method: model,
        y: parseFloat(price.toFixed(2)),
        L: parseFloat(L.toFixed(2)),
        U: parseFloat(U.toFixed(2)),
        cover_hit,
        interval_score: parseFloat(intervalScore.toFixed(3))
      });
    }
  }
  
  return { pi_metrics: metrics };
}

// Generate test data for all symbols
const symbols = [
  { name: 'AAPL', price: 180 },
  { name: 'AMD', price: 145 },
  { name: 'PLTR', price: 23 }
];

for (const { name, price } of symbols) {
  const data = generateBacktestData(name, price);
  const fileName = `data/backtest/${name}-pi-latest.json`;
  
  fs.writeFileSync(fileName, JSON.stringify(data, null, 2));
  console.log(`Generated ${data.pi_metrics.length} metrics for ${name}`);
}

console.log('✅ Test data generation complete!');