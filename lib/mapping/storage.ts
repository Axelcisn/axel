import { promises as fs } from 'fs';
import path from 'path';
import { KmBinStats, CoxFit, MappingSummary } from './types';

/**
 * Storage manager for survival analysis mapping results
 */
export class MappingStorage {
  private dataDir: string;

  constructor(baseDir: string = '/Users/trombadaria/Desktop/axel-1/data') {
    this.dataDir = path.join(baseDir, 'mapping');
  }

  /**
   * Ensure mapping directory exists
   */
  async ensureDataDir(): Promise<void> {
    try {
      await fs.access(this.dataDir);
    } catch {
      await fs.mkdir(this.dataDir, { recursive: true });
    }
  }

  /**
   * Save KM bin results for a symbol
   */
  async saveKmBins(symbol: string, bins: KmBinStats[]): Promise<void> {
    await this.ensureDataDir();
    
    const filePath = path.join(this.dataDir, `${symbol}-km.json`);
    const data = {
      symbol,
      bins,
      updated_at: new Date().toISOString(),
      version: "1.0"
    };
    
    try {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      throw new Error(`Failed to save KM bins for ${symbol}: ${error}`);
    }
  }

  /**
   * Load KM bin results for a symbol
   */
  async loadKmBins(symbol: string): Promise<KmBinStats[] | null> {
    await this.ensureDataDir();
    
    const filePath = path.join(this.dataDir, `${symbol}-km.json`);
    
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data);
      return parsed.bins || [];
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return null; // File doesn't exist
      }
      throw new Error(`Failed to load KM bins for ${symbol}: ${error}`);
    }
  }

  /**
   * Save Cox model results for a symbol
   */
  async saveCoxFit(symbol: string, coxFit: CoxFit): Promise<void> {
    await this.ensureDataDir();
    
    const filePath = path.join(this.dataDir, `${symbol}-cox.json`);
    const data = {
      symbol,
      cox: coxFit,
      updated_at: new Date().toISOString(),
      version: "1.0"
    };
    
    try {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      throw new Error(`Failed to save Cox fit for ${symbol}: ${error}`);
    }
  }

  /**
   * Load Cox model results for a symbol
   */
  async loadCoxFit(symbol: string): Promise<CoxFit | null> {
    await this.ensureDataDir();
    
    const filePath = path.join(this.dataDir, `${symbol}-cox.json`);
    
    try {
      const data = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data);
      return parsed.cox || null;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return null; // File doesn't exist
      }
      throw new Error(`Failed to load Cox fit for ${symbol}: ${error}`);
    }
  }

  /**
   * Save complete mapping summary for a symbol
   */
  async saveMappingSummary(summary: MappingSummary): Promise<void> {
    await this.ensureDataDir();
    
    // Save KM bins if present
    if (summary.bins && summary.bins.length > 0) {
      await this.saveKmBins(summary.symbol, summary.bins);
    }
    
    // Save Cox fit if present
    if (summary.cox) {
      await this.saveCoxFit(summary.symbol, summary.cox);
    }
    
    // Save combined summary
    const filePath = path.join(this.dataDir, `${summary.symbol}-summary.json`);
    try {
      await fs.writeFile(filePath, JSON.stringify(summary, null, 2), 'utf8');
    } catch (error) {
      throw new Error(`Failed to save mapping summary for ${summary.symbol}: ${error}`);
    }
  }

  /**
   * Load complete mapping summary for a symbol
   */
  async loadMappingSummary(symbol: string): Promise<MappingSummary | null> {
    await this.ensureDataDir();
    
    try {
      // Try to load from summary file first
      const summaryPath = path.join(this.dataDir, `${symbol}-summary.json`);
      const summaryData = await fs.readFile(summaryPath, 'utf8');
      return JSON.parse(summaryData);
    } catch {
      // If summary doesn't exist, try to reconstruct from separate files
      const bins = await this.loadKmBins(symbol);
      const cox = await this.loadCoxFit(symbol);
      
      if (bins || cox) {
        return {
          symbol,
          bins: bins || [],
          cox: cox || undefined,
          updated_at: new Date().toISOString()
        };
      }
      
      return null;
    }
  }

  /**
   * List all symbols with saved mapping data
   */
  async listMappedSymbols(): Promise<string[]> {
    await this.ensureDataDir();
    
    try {
      const files = await fs.readdir(this.dataDir);
      const symbols = new Set<string>();
      
      for (const file of files) {
        if (file.endsWith('-km.json') || file.endsWith('-cox.json') || file.endsWith('-summary.json')) {
          const symbol = file.replace(/-(?:km|cox|summary)\.json$/, '');
          symbols.add(symbol);
        }
      }
      
      return Array.from(symbols).sort();
    } catch (error) {
      throw new Error(`Failed to list mapped symbols: ${error}`);
    }
  }

  /**
   * Delete mapping data for a symbol
   */
  async deleteMappingData(symbol: string): Promise<void> {
    await this.ensureDataDir();
    
    const files = [
      `${symbol}-km.json`,
      `${symbol}-cox.json`, 
      `${symbol}-summary.json`
    ];
    
    const errors: string[] = [];
    
    for (const filename of files) {
      const filePath = path.join(this.dataDir, filename);
      try {
        await fs.unlink(filePath);
      } catch (error) {
        if ((error as any).code !== 'ENOENT') {
          errors.push(`${filename}: ${error}`);
        }
      }
    }
    
    if (errors.length > 0) {
      throw new Error(`Failed to delete some files for ${symbol}: ${errors.join(', ')}`);
    }
  }

  /**
   * Get mapping data freshness for a symbol
   */
  async getMappingFreshness(symbol: string): Promise<{
    km_age_hours?: number;
    cox_age_hours?: number;
    needs_rebuild: boolean;
  }> {
    const now = new Date();
    const summary = await this.loadMappingSummary(symbol);
    
    if (!summary) {
      return { needs_rebuild: true };
    }
    
    const updatedAt = new Date(summary.updated_at);
    const ageHours = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60);
    
    // Consider stale if older than 24 hours
    const needsRebuild = ageHours > 24;
    
    return {
      km_age_hours: summary.bins.length > 0 ? ageHours : undefined,
      cox_age_hours: summary.cox ? ageHours : undefined,
      needs_rebuild: needsRebuild
    };
  }

  /**
   * Bulk save mapping results for multiple symbols
   */
  async bulkSaveMappings(mappings: MappingSummary[]): Promise<void> {
    const errors: string[] = [];
    
    for (const mapping of mappings) {
      try {
        await this.saveMappingSummary(mapping);
      } catch (error) {
        errors.push(`${mapping.symbol}: ${error}`);
      }
    }
    
    if (errors.length > 0) {
      throw new Error(`Failed to save some mappings: ${errors.join(', ')}`);
    }
  }
}

// Export singleton instance
export const mappingStorage = new MappingStorage();