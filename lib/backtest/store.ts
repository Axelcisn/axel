import { promises as fs } from 'fs';
import path from 'path';
import { ROOutcome, BacktestSummary } from './types';

/**
 * Per-model PI metrics for structured storage
 */
export interface PerModelPIMetrics {
  [method: string]: {
    n: number;
    intervalScore: number;
    empiricalCoverage: number;
    avgWidthBp: number;
    // Additional metrics from PI evaluation
    misses?: number;
    varPValue?: number;
    ccPValue?: number;
    trafficLight?: "green" | "yellow" | "red";
  };
}

/**
 * Structured PI summary for cross-model comparison
 */
export interface PISummary {
  symbol: string;
  horizonTrading: number;
  coverage: number;
  models: string[];
  piMetrics: PerModelPIMetrics;
  metadata?: {
    generated_at: string;
    oos_start: string;
    oos_end: string;
    total_days: number;
    version: string;
  };
}

/**
 * Storage manager for backtest results and outcomes
 */
export class BacktestStorage {
  private dataDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.dataDir = path.join(baseDir, 'data', 'backtest');
  }

  /**
   * Ensure backtest directory exists
   */
  async ensureDataDir(): Promise<void> {
    try {
      await fs.access(this.dataDir);
    } catch {
      await fs.mkdir(this.dataDir, { recursive: true });
    }
  }

  /**
   * Save backtest outcome for a symbol
   */
  async saveBacktest(symbol: string, outcome: ROOutcome): Promise<string> {
    await this.ensureDataDir();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${symbol}-pi-${timestamp}.json`;
    const filePath = path.join(this.dataDir, filename);
    
    // Also save as latest
    const latestPath = path.join(this.dataDir, `${symbol}-pi-latest.json`);
    
    try {
      const data = {
        ...outcome,
        metadata: {
          symbol,
          saved_at: new Date().toISOString(),
          version: "1.0",
          total_metrics: outcome.pi_metrics.length
        }
      };
      
      const jsonContent = JSON.stringify(data, null, 2);
      
      // Save timestamped version
      await fs.writeFile(filePath, jsonContent, 'utf8');
      
      // Save as latest (atomic update)
      const tempPath = `${latestPath}.tmp`;
      await fs.writeFile(tempPath, jsonContent, 'utf8');
      await fs.rename(tempPath, latestPath);
      
      console.log(`Saved backtest results to ${filePath}`);
      return filePath;
      
    } catch (error) {
      throw new Error(`Failed to save backtest for ${symbol}: ${error}`);
    }
  }

  /**
   * Load PI Summary for structured model comparison
   */
  async loadPISummary(symbol: string, horizonTrading: number, coverage: number): Promise<PISummary | null> {
    await this.ensureDataDir();
    
    const filePath = path.join(this.dataDir, `${symbol}-pi-latest.json`);
    
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);
      
      // Check if it's already in PISummary format
      if (data.piMetrics && typeof data.piMetrics === 'object') {
        // Filter by horizonTrading and coverage if specified
        if (data.horizonTrading === horizonTrading && data.coverage === coverage) {
          return data as PISummary;
        }
        // For now, return as-is if parameters don't match exactly
        return data as PISummary;
      }
      
      // Convert from legacy ROOutcome format to PISummary
      const outcome = data as ROOutcome;
      if (!outcome.pi_metrics) {
        return null;
      }
      
      // Group metrics by method and aggregate
      const methodGroups: Record<string, typeof outcome.pi_metrics> = {};
      for (const metric of outcome.pi_metrics) {
        if (!methodGroups[metric.method]) {
          methodGroups[metric.method] = [];
        }
        methodGroups[metric.method].push(metric);
      }
      
      const piMetrics: PerModelPIMetrics = {};
      const models: string[] = [];
      
      for (const [method, metrics] of Object.entries(methodGroups)) {
        if (metrics.length === 0) continue;
        
        // Compute aggregated metrics
        const totalScore = metrics.reduce((sum, m) => sum + m.interval_score, 0);
        const totalCoverage = metrics.reduce((sum, m) => sum + m.cover_hit, 0);
        const totalWidth = metrics.reduce((sum, m) => {
          const width = m.U - m.L;
          const center = (m.L + m.U) / 2;
          return sum + (width / center) * 10000; // basis points
        }, 0);
        
        piMetrics[method] = {
          n: metrics.length,
          intervalScore: totalScore / metrics.length,
          empiricalCoverage: totalCoverage / metrics.length,
          avgWidthBp: totalWidth / metrics.length
        };
        
        models.push(method);
      }
      
      const summary: PISummary = {
        symbol,
        horizonTrading: horizonTrading || 1,
        coverage: coverage || 0.95,
        models: models.sort(),
        piMetrics,
        metadata: {
          generated_at: new Date().toISOString(),
          oos_start: outcome.pi_metrics[0]?.date || '',
          oos_end: outcome.pi_metrics[outcome.pi_metrics.length - 1]?.date || '',
          total_days: outcome.pi_metrics.length,
          version: '1.0'
        }
      };
      
      return summary;
      
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return null; // File doesn't exist
      }
      throw new Error(`Failed to load PI summary for ${symbol}: ${error}`);
    }
  }

  /**
   * Save PI Summary for structured model comparison
   */
  async savePISummary(summary: PISummary): Promise<void> {
    await this.ensureDataDir();
    
    const filePath = path.join(this.dataDir, `${summary.symbol}-pi-latest.json`);
    
    try {
      // Add metadata
      const dataToSave = {
        ...summary,
        metadata: {
          ...summary.metadata,
          saved_at: new Date().toISOString(),
          version: '1.0'
        }
      };
      
      const jsonContent = JSON.stringify(dataToSave, null, 2);
      
      // Atomic write
      const tempPath = `${filePath}.tmp`;
      await fs.writeFile(tempPath, jsonContent, 'utf8');
      await fs.rename(tempPath, filePath);
      
      console.log(`Saved PI summary for ${summary.symbol} with ${summary.models.length} models`);
      
    } catch (error) {
      throw new Error(`Failed to save PI summary for ${summary.symbol}: ${error}`);
    }
  }

  /**
   * Load latest backtest outcome for a symbol
   */
  async loadBacktest(symbol: string): Promise<ROOutcome | null> {
    await this.ensureDataDir();
    
    const filePath = path.join(this.dataDir, `${symbol}-pi-latest.json`);
    
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);
      
      // Return the ROOutcome (strip metadata)
      const { metadata, ...outcome } = data;
      return outcome as ROOutcome;
      
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return null; // File doesn't exist
      }
      throw new Error(`Failed to load backtest for ${symbol}: ${error}`);
    }
  }

  /**
   * Load backtest by timestamp
   */
  async loadBacktestByTimestamp(symbol: string, timestamp: string): Promise<ROOutcome | null> {
    await this.ensureDataDir();
    
    const filename = `${symbol}-pi-${timestamp}.json`;
    const filePath = path.join(this.dataDir, filename);
    
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);
      
      const { metadata, ...outcome } = data;
      return outcome as ROOutcome;
      
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return null;
      }
      throw new Error(`Failed to load backtest ${symbol}@${timestamp}: ${error}`);
    }
  }

  /**
   * List all backtest timestamps for a symbol
   */
  async listBacktestHistory(symbol: string): Promise<Array<{
    timestamp: string;
    filename: string;
    size: number;
    created: Date;
  }>> {
    await this.ensureDataDir();
    
    try {
      const files = await fs.readdir(this.dataDir);
      const backtestFiles = files.filter(f => 
        f.startsWith(`${symbol}-pi-`) && 
        f.endsWith('.json') && 
        !f.endsWith('-latest.json')
      );
      
      const history = [];
      
      for (const filename of backtestFiles) {
        const filePath = path.join(this.dataDir, filename);
        const stats = await fs.stat(filePath);
        
        // Extract timestamp from filename
        const timestampMatch = filename.match(new RegExp(`${symbol}-pi-(.+)\\.json$`));
        const timestamp = timestampMatch ? timestampMatch[1] : '';
        
        history.push({
          timestamp,
          filename,
          size: stats.size,
          created: stats.birthtime
        });
      }
      
      // Sort by creation time (newest first)
      return history.sort((a, b) => b.created.getTime() - a.created.getTime());
      
    } catch (error) {
      throw new Error(`Failed to list backtest history for ${symbol}: ${error}`);
    }
  }

  /**
   * Delete backtest data for a symbol
   */
  async deleteBacktest(symbol: string, timestamp?: string): Promise<void> {
    await this.ensureDataDir();
    
    try {
      if (timestamp) {
        // Delete specific timestamp
        const filename = `${symbol}-pi-${timestamp}.json`;
        const filePath = path.join(this.dataDir, filename);
        await fs.unlink(filePath);
      } else {
        // Delete all for symbol
        const files = await fs.readdir(this.dataDir);
        const symbolFiles = files.filter(f => f.startsWith(`${symbol}-pi-`));
        
        for (const filename of symbolFiles) {
          const filePath = path.join(this.dataDir, filename);
          await fs.unlink(filePath);
        }
      }
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        throw new Error(`Failed to delete backtest for ${symbol}: ${error}`);
      }
    }
  }

  /**
   * Get backtest summary statistics
   */
  async getBacktestSummary(symbol: string): Promise<BacktestSummary | null> {
    const outcome = await this.loadBacktest(symbol);
    if (!outcome) return null;
    
    return this.computeSummaryFromOutcome(outcome);
  }

  /**
   * Compute summary statistics from ROOutcome
   */
  private computeSummaryFromOutcome(outcome: ROOutcome): BacktestSummary {
    const metrics = outcome.pi_metrics;
    
    if (metrics.length === 0) {
      return {
        coverage_60d: 0,
        coverage_250d: 0,
        avg_interval_score: 0
      };
    }
    
    // Sort by date for windowed calculations
    const sortedMetrics = metrics.sort((a, b) => a.date.localeCompare(b.date));
    
    // Coverage rates
    const recent60 = sortedMetrics.slice(-60);
    const recent250 = sortedMetrics.slice(-250);
    
    const coverage_60d = recent60.length > 0 ? 
      recent60.reduce((sum, m) => sum + m.cover_hit, 0) / recent60.length : 0;
    
    const coverage_250d = recent250.length > 0 ? 
      recent250.reduce((sum, m) => sum + m.cover_hit, 0) / recent250.length : 0;
    
    // Average interval score
    const avg_interval_score = metrics.reduce((sum, m) => sum + m.interval_score, 0) / metrics.length;
    
    const summary: BacktestSummary = {
      coverage_60d,
      coverage_250d,
      avg_interval_score
    };
    
    // Add optional fields if available
    if (outcome.survival) {
      summary.c_index = outcome.survival.c_index;
      summary.ibs = outcome.survival.ibs;
    }
    
    if (outcome.pi_compare) {
      summary.dm_pvalue = outcome.pi_compare.dm_pvalue;
    }
    
    if (outcome.bootstrap) {
      summary.bootstrap_coverage_ci = outcome.bootstrap.ci.coverage_250d;
      summary.bootstrap_is_ci = outcome.bootstrap.ci.IS;
    }
    
    if (outcome.multiplicity) {
      summary.fdr_q = outcome.multiplicity.fdr_q;
    }
    
    if (outcome.regimes) {
      summary.regime_count = outcome.regimes.break_dates.length;
    }
    
    if (outcome.overfit) {
      summary.pbo = outcome.overfit.pbo;
      summary.dsr = outcome.overfit.dsr;
    }
    
    return summary;
  }

  /**
   * List all symbols with backtest data
   */
  async listBacktestedSymbols(): Promise<Array<{
    symbol: string;
    latest_update: string;
    total_metrics: number;
    engines: string[];
  }>> {
    await this.ensureDataDir();
    
    try {
      const files = await fs.readdir(this.dataDir);
      const latestFiles = files.filter(f => f.endsWith('-pi-latest.json'));
      
      const symbols = [];
      
      for (const filename of latestFiles) {
        const symbol = filename.replace('-pi-latest.json', '');
        const outcome = await this.loadBacktest(symbol);
        
        if (outcome) {
          const engines = Array.from(new Set(outcome.pi_metrics.map(m => m.method)));
          
          symbols.push({
            symbol,
            latest_update: outcome.updated_at,
            total_metrics: outcome.pi_metrics.length,
            engines
          });
        }
      }
      
      return symbols.sort((a, b) => a.symbol.localeCompare(b.symbol));
      
    } catch (error) {
      throw new Error(`Failed to list backtested symbols: ${error}`);
    }
  }

  /**
   * Export backtest data to CSV
   */
  async exportToCSV(symbol: string): Promise<string> {
    const outcome = await this.loadBacktest(symbol);
    if (!outcome) {
      throw new Error(`No backtest data found for ${symbol}`);
    }
    
    const headers = ['date', 'method', 'y', 'L', 'U', 'cover_hit', 'interval_score'];
    const rows = [headers];
    
    for (const metric of outcome.pi_metrics) {
      rows.push([
        metric.date,
        metric.method,
        metric.y.toString(),
        metric.L.toString(),
        metric.U.toString(),
        metric.cover_hit.toString(),
        metric.interval_score.toString()
      ]);
    }
    
    const csvContent = rows.map(row => row.join(',')).join('\n');
    
    // Save CSV file
    const csvPath = path.join(this.dataDir, `${symbol}-backtest-export.csv`);
    await fs.writeFile(csvPath, csvContent, 'utf8');
    
    return csvPath;
  }

  /**
   * Cleanup old backtest files (keep last N)
   */
  async cleanupOldBacktests(symbol: string, keepLast: number = 10): Promise<number> {
    const history = await this.listBacktestHistory(symbol);
    
    if (history.length <= keepLast) {
      return 0; // Nothing to cleanup
    }
    
    const toDelete = history.slice(keepLast); // Keep first N (newest)
    let deletedCount = 0;
    
    for (const item of toDelete) {
      try {
        const filePath = path.join(this.dataDir, item.filename);
        await fs.unlink(filePath);
        deletedCount++;
      } catch (error) {
        console.warn(`Failed to delete ${item.filename}:`, error);
      }
    }
    
    console.log(`Cleaned up ${deletedCount} old backtest files for ${symbol}`);
    return deletedCount;
  }
}

// Export singleton instance
export const backtestStorage = new BacktestStorage();