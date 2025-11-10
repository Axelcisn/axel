import { promises as fs } from 'fs';
import path from 'path';
import { AlertRule, AlertFire } from '@/lib/watchlist/types';

/**
 * Storage manager for alert rules and fired alerts
 */
export class AlertsStore {
  private dataDir: string;
  private rulesFile: string;

  constructor(baseDir: string = process.cwd()) {
    this.dataDir = path.join(baseDir, 'data', 'alerts');
    this.rulesFile = path.join(this.dataDir, 'rules.json');
  }

  /**
   * Ensure alerts directory exists
   */
  async ensureDataDir(): Promise<void> {
    try {
      await fs.access(this.dataDir);
    } catch {
      await fs.mkdir(this.dataDir, { recursive: true });
    }
  }

  /**
   * List all alert rules
   */
  async listRules(): Promise<AlertRule[]> {
    await this.ensureDataDir();
    
    try {
      const content = await fs.readFile(this.rulesFile, 'utf8');
      return JSON.parse(content) as AlertRule[];
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return []; // No rules file exists yet
      }
      throw new Error(`Failed to load alert rules: ${error}`);
    }
  }

  /**
   * List alert rules for a specific symbol
   */
  async listRulesBySymbol(symbol: string): Promise<AlertRule[]> {
    const allRules = await this.listRules();
    return allRules.filter(rule => rule.symbol === symbol);
  }

  /**
   * Save a new alert rule
   */
  async saveRule(rule: AlertRule): Promise<string> {
    await this.ensureDataDir();
    
    const rules = await this.listRules();
    
    // Check for duplicate ID
    if (rules.some(r => r.id === rule.id)) {
      throw new Error(`Rule with ID ${rule.id} already exists`);
    }
    
    rules.push(rule);
    
    try {
      await fs.writeFile(this.rulesFile, JSON.stringify(rules, null, 2), 'utf8');
      console.log(`Saved alert rule ${rule.id} for ${rule.symbol}`);
      return rule.id;
    } catch (error) {
      throw new Error(`Failed to save alert rule: ${error}`);
    }
  }

  /**
   * Update an existing alert rule
   */
  async updateRule(rule: AlertRule): Promise<string> {
    await this.ensureDataDir();
    
    const rules = await this.listRules();
    const index = rules.findIndex(r => r.id === rule.id);
    
    if (index === -1) {
      throw new Error(`Rule with ID ${rule.id} not found`);
    }
    
    rules[index] = rule;
    
    try {
      await fs.writeFile(this.rulesFile, JSON.stringify(rules, null, 2), 'utf8');
      console.log(`Updated alert rule ${rule.id} for ${rule.symbol}`);
      return rule.id;
    } catch (error) {
      throw new Error(`Failed to update alert rule: ${error}`);
    }
  }

  /**
   * Delete an alert rule
   */
  async deleteRule(ruleId: string): Promise<void> {
    await this.ensureDataDir();
    
    const rules = await this.listRules();
    const filteredRules = rules.filter(r => r.id !== ruleId);
    
    if (filteredRules.length === rules.length) {
      throw new Error(`Rule with ID ${ruleId} not found`);
    }
    
    try {
      await fs.writeFile(this.rulesFile, JSON.stringify(filteredRules, null, 2), 'utf8');
      console.log(`Deleted alert rule ${ruleId}`);
    } catch (error) {
      throw new Error(`Failed to delete alert rule: ${error}`);
    }
  }

  /**
   * Log a fired alert
   */
  async logFire(fire: AlertFire): Promise<string> {
    await this.ensureDataDir();
    
    // Get date for fire grouping (YYYY-MM-DD)
    const fireDate = new Date(fire.fired_at).toISOString().split('T')[0];
    const fireFile = path.join(this.dataDir, `fires-${fireDate}.json`);
    
    try {
      // Load existing fires for the date
      let fires: AlertFire[] = [];
      try {
        const content = await fs.readFile(fireFile, 'utf8');
        fires = JSON.parse(content);
      } catch (error) {
        // File doesn't exist, start with empty array
        if ((error as any).code !== 'ENOENT') {
          throw error;
        }
      }
      
      // Add new fire
      fires.push(fire);
      
      // Save updated fires
      await fs.writeFile(fireFile, JSON.stringify(fires, null, 2), 'utf8');
      
      console.log(`Logged alert fire ${fire.id} for ${fire.symbol}: ${fire.reason}`);
      return fire.id;
      
    } catch (error) {
      throw new Error(`Failed to log alert fire: ${error}`);
    }
  }

  /**
   * Get fired alerts for a date
   */
  async getFires(date: string): Promise<AlertFire[]> {
    await this.ensureDataDir();
    
    const fireFile = path.join(this.dataDir, `fires-${date}.json`);
    
    try {
      const content = await fs.readFile(fireFile, 'utf8');
      return JSON.parse(content) as AlertFire[];
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return []; // No fires for this date
      }
      throw new Error(`Failed to load fires for ${date}: ${error}`);
    }
  }

  /**
   * Get fired alerts for a symbol on a date
   */
  async getFiresBySymbol(symbol: string, date: string): Promise<AlertFire[]> {
    const allFires = await this.getFires(date);
    return allFires.filter(fire => fire.symbol === symbol);
  }

  /**
   * Get recent fired alerts (last N days)
   */
  async getRecentFires(days: number = 7): Promise<AlertFire[]> {
    await this.ensureDataDir();
    
    const fires: AlertFire[] = [];
    const today = new Date();
    
    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      try {
        const dayFires = await this.getFires(dateStr);
        fires.push(...dayFires);
      } catch (error) {
        // Skip days with no fires or errors
        continue;
      }
    }
    
    // Sort by fired_at descending (newest first)
    return fires.sort((a, b) => new Date(b.fired_at).getTime() - new Date(a.fired_at).getTime());
  }

  /**
   * Clean up old fire logs (keep last N days)
   */
  async cleanupOldFires(keepDays: number = 30): Promise<number> {
    await this.ensureDataDir();
    
    try {
      const files = await fs.readdir(this.dataDir);
      const fireFiles = files.filter(f => f.startsWith('fires-') && f.endsWith('.json'));
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - keepDays);
      const cutoffStr = cutoffDate.toISOString().split('T')[0];
      
      let deletedCount = 0;
      
      for (const filename of fireFiles) {
        const dateMatch = filename.match(/fires-(\d{4}-\d{2}-\d{2})\.json$/);
        if (dateMatch) {
          const fileDate = dateMatch[1];
          if (fileDate < cutoffStr) {
            try {
              const filePath = path.join(this.dataDir, filename);
              await fs.unlink(filePath);
              deletedCount++;
            } catch (error) {
              console.warn(`Failed to delete ${filename}:`, error);
            }
          }
        }
      }
      
      if (deletedCount > 0) {
        console.log(`Cleaned up ${deletedCount} old fire log files`);
      }
      
      return deletedCount;
      
    } catch (error) {
      console.error('Failed to cleanup old fires:', error);
      return 0;
    }
  }

  /**
   * Get alert statistics
   */
  async getAlertStats(): Promise<{
    total_rules: number;
    enabled_rules: number;
    symbols_with_rules: number;
    fires_today: number;
    fires_week: number;
  }> {
    const rules = await this.listRules();
    const today = new Date().toISOString().split('T')[0];
    const firesToday = await this.getFires(today);
    const firesWeek = await this.getRecentFires(7);
    
    return {
      total_rules: rules.length,
      enabled_rules: rules.filter(r => r.enabled).length,
      symbols_with_rules: new Set(rules.map(r => r.symbol)).size,
      fires_today: firesToday.length,
      fires_week: firesWeek.length
    };
  }
}

// Export singleton instance
export const alertsStore = new AlertsStore();

// Export individual functions for backwards compatibility
export async function listRules(): Promise<AlertRule[]> {
  return alertsStore.listRules();
}

export async function listRulesBySymbol(symbol: string): Promise<AlertRule[]> {
  return alertsStore.listRulesBySymbol(symbol);
}

export async function saveRule(rule: AlertRule): Promise<string> {
  return alertsStore.saveRule(rule);
}

export async function updateRule(rule: AlertRule): Promise<string> {
  return alertsStore.updateRule(rule);
}

export async function logFire(fire: AlertFire): Promise<string> {
  return alertsStore.logFire(fire);
}