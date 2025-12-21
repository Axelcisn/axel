import fs from 'fs';
import path from 'path';
import type { CanonicalRow } from '../types/canonical';

/**
 * Normalize symbol to uppercase for consistent file lookups.
 * This is the single source of truth for symbol normalization.
 */
function normalizeSymbol(symbol: string): string {
  return symbol.toUpperCase();
}

/**
 * Load canonical rows from filesystem.
 * This is the ONLY function that both /api/history and /api/volatility should use.
 * 
 * @throws Error with code 'ENOENT' if file not found
 * @throws Error if JSON parsing fails
 */
export async function loadCanonicalRows(symbol: string): Promise<CanonicalRow[]> {
  const normalized = normalizeSymbol(symbol);
  const canonicalPath = path.join(process.cwd(), 'data', 'canonical', `${normalized}.json`);
  
  try {
    const fileContent = await fs.promises.readFile(canonicalPath, 'utf-8');
    const parsed = JSON.parse(fileContent);
    
    // Handle both formats: { rows: [...] } or just [...]
    const rows = Array.isArray(parsed) ? parsed : parsed.rows;
    
    if (!Array.isArray(rows)) {
      throw new Error(`Invalid canonical data format for ${normalized}`);
    }
    
    return rows as CanonicalRow[];
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      const err = new Error(`No canonical data found for ${normalized}`);
      (err as any).code = 'ENOENT';
      throw err;
    }
    throw error;
  }
}
