#!/usr/bin/env tsx

/**
 * Professional PI Backtest Generator
 * 
 * Generates comprehensive prediction interval backtests for all supported models
 * across specified symbols using rolling-origin evaluation.
 * 
 * Usage: npm run backtest:pi
 */

import { BacktestStorage, PISummary, PerModelPIMetrics } from './lib/backtest/store';
import { runRollingOriginPI, PIRunResult } from './lib/backtest/runner';
import { SupportedModel } from './lib/modelSelection';
import { promises as fs } from 'fs';
import path from 'path';

// Model universe for backtesting
const models: SupportedModel[] = [
  "GBM-CC",
  "GARCH11-N", 
  "GARCH11-t",
  "Range-P",
  "Range-GK", 
  "Range-RS",
  "Range-YZ",
];

// Default configuration
const DEFAULT_CONFIG = {
  symbols: ["AAPL", "AMD", "PLTR"], // Extend as needed
  horizonTrading: 1,                // 1-day ahead forecasts
  coverage: 0.95,                   // 95% prediction intervals
  lookbackYears: 2,                 // 2 years of evaluation data
  batchSize: 1,                     // Process N symbols at a time
  retryFailures: true,              // Retry failed model evaluations
  savePartialResults: true,         // Save results incrementally
};

interface BacktestConfig {
  symbols: string[];
  horizonTrading: number;
  coverage: number;
  lookbackYears: number;
  batchSize: number;
  retryFailures: boolean;
  savePartialResults: boolean;
}

interface BacktestProgress {
  totalSymbols: number;
  completedSymbols: number;
  totalModels: number;
  completedModels: number;
  failures: Array<{
    symbol: string;
    model: string;
    error: string;
  }>;
  startTime: Date;
  lastSaveTime: Date;
}

/**
 * Enhanced PI backtest generation with progress tracking and error handling
 */
class PIBacktestManager {
  private storage: BacktestStorage;
  private config: BacktestConfig;
  private progress: BacktestProgress;

  constructor(config: Partial<BacktestConfig> = {}) {
    this.storage = new BacktestStorage("data/backtest");
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.progress = this.initializeProgress();
  }

  private initializeProgress(): BacktestProgress {
    return {
      totalSymbols: this.config.symbols.length,
      completedSymbols: 0,
      totalModels: this.config.symbols.length * models.length,
      completedModels: 0,
      failures: [],
      startTime: new Date(),
      lastSaveTime: new Date()
    };
  }

  /**
   * Run comprehensive PI backtests for all symbols and models
   */
  async runBacktests(): Promise<void> {
    console.log('='.repeat(60));
    console.log('🚀 PROFESSIONAL PI BACKTEST GENERATOR');
    console.log('='.repeat(60));
    console.log(`Symbols: ${this.config.symbols.join(', ')}`);
    console.log(`Models: ${models.join(', ')}`);
    console.log(`Horizon: ${this.config.horizonTrading}D, Coverage: ${this.config.coverage * 100}%`);
    console.log(`Evaluation window: ${this.config.lookbackYears} years`);
    console.log('='.repeat(60));

    // Process symbols in batches
    for (let i = 0; i < this.config.symbols.length; i += this.config.batchSize) {
      const batch = this.config.symbols.slice(i, i + this.config.batchSize);
      
      console.log(`\n📊 Processing batch ${Math.floor(i / this.config.batchSize) + 1}/${Math.ceil(this.config.symbols.length / this.config.batchSize)}: ${batch.join(', ')}`);
      
      await Promise.all(batch.map(symbol => this.processSymbol(symbol)));
    }

    // Print final summary
    this.printFinalSummary();
  }

  /**
   * Process all models for a single symbol
   */
  private async processSymbol(symbol: string): Promise<void> {
    console.log(`\n🎯 Processing ${symbol}...`);
    
    // Check if we already have recent backtest data
    const existingSummary = await this.loadExistingSummary(symbol);
    const modelsToRun = this.determineModelsToRun(existingSummary);
    
    if (modelsToRun.length === 0) {
      console.log(`  ✅ ${symbol}: All models up to date, skipping`);
      this.progress.completedSymbols++;
      return;
    }

    console.log(`  🔄 Running ${modelsToRun.length} models for ${symbol}: ${modelsToRun.join(', ')}`);

    const piMetrics: PerModelPIMetrics = existingSummary?.piMetrics || {};
    const completedModels: string[] = [];
    
    // Determine evaluation period
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - this.config.lookbackYears);
    const evalStartDate = startDate.toISOString().split('T')[0];

    // Process each model
    for (const model of modelsToRun) {
      try {
        console.log(`    🔄 ${symbol}/${model}...`);
        
        const result = await runRollingOriginPI({
          symbol,
          method: model,
          horizonTrading: this.config.horizonTrading,
          coverage: this.config.coverage,
          startDate: evalStartDate,
          endDate
        });

        // Store results
        piMetrics[model] = {
          n: result.n,
          intervalScore: result.intervalScore,
          empiricalCoverage: result.empiricalCoverage,
          avgWidthBp: result.avgWidthBp,
        };
        
        completedModels.push(model);
        this.progress.completedModels++;
        
        console.log(`    ✅ ${symbol}/${model}: n=${result.n}, IS=${result.intervalScore.toFixed(3)}, cov=${(result.empiricalCoverage*100).toFixed(1)}%`);
        
      } catch (error: any) {
        const errorMsg = error?.message || String(error);
        console.error(`    ❌ ${symbol}/${model}: ${errorMsg}`);
        
        this.progress.failures.push({
          symbol,
          model,
          error: errorMsg
        });
        
        this.progress.completedModels++; // Count as completed (failed)
      }
    }

    // Save PI summary for this symbol
    if (completedModels.length > 0 || Object.keys(piMetrics).length > 0) {
      try {
        const summary: PISummary = {
          symbol,
          horizonTrading: this.config.horizonTrading,
          coverage: this.config.coverage,
          models: Object.keys(piMetrics).sort(),
          piMetrics,
          metadata: {
            generated_at: new Date().toISOString(),
            oos_start: evalStartDate,
            oos_end: endDate,
            total_days: 0, // Will be computed from metrics
            version: '1.0'
          }
        };

        await this.storage.savePISummary(summary);
        console.log(`  ✅ Saved PI summary for ${symbol} with ${Object.keys(piMetrics).length} models`);
        
      } catch (error: any) {
        console.error(`  ❌ Failed to save PI summary for ${symbol}: ${error?.message || String(error)}`);
      }
    }

    this.progress.completedSymbols++;
    this.progress.lastSaveTime = new Date();

    // Print progress update
    this.printProgress();
  }

  /**
   * Load existing PI summary if available
   */
  private async loadExistingSummary(symbol: string): Promise<PISummary | null> {
    try {
      return await this.storage.loadPISummary(symbol, this.config.horizonTrading, this.config.coverage);
    } catch {
      return null;
    }
  }

  /**
   * Determine which models need to be run based on existing data
   */
  private determineModelsToRun(existingSummary: PISummary | null): SupportedModel[] {
    if (!existingSummary) {
      return [...models]; // Run all models
    }

    // Check if existing summary is recent (within 7 days)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);
    
    const isRecent = existingSummary.metadata?.generated_at && 
                     new Date(existingSummary.metadata.generated_at) > cutoffDate;

    if (!isRecent) {
      return [...models]; // Re-run all models if data is stale
    }

    // Only run missing models
    const existingModels = new Set(existingSummary.models);
    return models.filter(model => !existingModels.has(model));
  }

  /**
   * Print progress update
   */
  private printProgress(): void {
    const elapsed = (Date.now() - this.progress.startTime.getTime()) / 1000;
    const symbolsRemaining = this.progress.totalSymbols - this.progress.completedSymbols;
    const modelsRemaining = this.progress.totalModels - this.progress.completedModels;
    
    const avgTimePerModel = elapsed / Math.max(1, this.progress.completedModels);
    const etaSeconds = modelsRemaining * avgTimePerModel;
    
    console.log(`\n📈 PROGRESS: ${this.progress.completedSymbols}/${this.progress.totalSymbols} symbols, ${this.progress.completedModels}/${this.progress.totalModels} models`);
    console.log(`⏱️  Elapsed: ${Math.floor(elapsed)}s, ETA: ${Math.floor(etaSeconds)}s`);
    
    if (this.progress.failures.length > 0) {
      console.log(`⚠️  Failures: ${this.progress.failures.length}`);
    }
  }

  /**
   * Print final summary
   */
  private printFinalSummary(): void {
    const elapsed = (Date.now() - this.progress.startTime.getTime()) / 1000;
    const successful = this.progress.completedModels - this.progress.failures.length;
    
    console.log('\n' + '='.repeat(60));
    console.log('🏁 BACKTEST GENERATION COMPLETE');
    console.log('='.repeat(60));
    console.log(`✅ Successfully processed: ${successful}/${this.progress.totalModels} models`);
    console.log(`📊 Symbols completed: ${this.progress.completedSymbols}/${this.progress.totalSymbols}`);
    console.log(`⏱️  Total time: ${Math.floor(elapsed)}s (${(elapsed/60).toFixed(1)}m)`);
    
    if (this.progress.failures.length > 0) {
      console.log(`\n⚠️  FAILURES (${this.progress.failures.length}):`);
      
      // Group failures by error type
      const errorGroups = this.progress.failures.reduce((acc, failure) => {
        const key = failure.error.slice(0, 50) + '...';
        if (!acc[key]) acc[key] = [];
        acc[key].push(`${failure.symbol}/${failure.model}`);
        return acc;
      }, {} as Record<string, string[]>);
      
      Object.entries(errorGroups).forEach(([error, instances]) => {
        console.log(`   • ${error}: ${instances.slice(0, 3).join(', ')}${instances.length > 3 ? ` +${instances.length - 3} more` : ''}`);
      });
    }

    console.log('\n🎯 Next steps:');
    console.log('   • Check /api/model-selection?symbol=AAPL for updated recommendations');
    console.log('   • Visit /company/AAPL/timing to see real GBM/GARCH metrics in comparison table');
    console.log('   • Run npm run backtest:pi again to update stale data');
    console.log('='.repeat(60));
  }
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const configOverrides: Partial<BacktestConfig> = {};
    
    // Parse --symbols=AAPL,TSLA
    const symbolsArg = args.find(arg => arg.startsWith('--symbols='));
    if (symbolsArg) {
      configOverrides.symbols = symbolsArg.split('=')[1].split(',');
    }
    
    // Parse --horizon=1
    const horizonArg = args.find(arg => arg.startsWith('--horizon='));
    if (horizonArg) {
      configOverrides.horizonTrading = parseInt(horizonArg.split('=')[1], 10);
    }
    
    // Parse --coverage=0.95
    const coverageArg = args.find(arg => arg.startsWith('--coverage='));
    if (coverageArg) {
      configOverrides.coverage = parseFloat(coverageArg.split('=')[1]);
    }

    // Parse --years=2
    const yearsArg = args.find(arg => arg.startsWith('--years='));
    if (yearsArg) {
      configOverrides.lookbackYears = parseInt(yearsArg.split('=')[1], 10);
    }
    
    // Help command
    if (args.includes('--help') || args.includes('-h')) {
      console.log(`
PI Backtest Generator - Generate professional prediction interval backtests

Usage: npm run backtest:pi [options]

Options:
  --symbols=AAPL,AMD,PLTR   Comma-separated list of symbols (default: AAPL,AMD,PLTR)
  --horizon=1               Forecast horizon in trading days (default: 1)
  --coverage=0.95           PI coverage level (default: 0.95)
  --years=2                 Evaluation window in years (default: 2)
  --help, -h                Show this help message

Examples:
  npm run backtest:pi                                    # Use defaults
  npm run backtest:pi --symbols=AAPL --horizon=5        # 5-day horizon for AAPL only
  npm run backtest:pi --symbols=AAPL,TSLA --years=3     # 3 years of data for AAPL,TSLA
      `);
      return;
    }

    // Create and run backtest manager
    const manager = new PIBacktestManager(configOverrides);
    await manager.runBacktests();
    
  } catch (error: any) {
    console.error('\n❌ Fatal error:', error?.message || String(error));
    console.error(error?.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

export { PIBacktestManager, main };