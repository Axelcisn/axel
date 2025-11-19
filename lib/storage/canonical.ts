import fs from 'fs';
import path from 'path';
import { CanonicalRow, CanonicalTableMeta } from '../types/canonical';

export interface CanonicalData {
  rows: CanonicalRow[];
  meta: CanonicalTableMeta;
}

/**
 * Load canonical data for a symbol
 */
export async function loadCanonicalData(symbol: string): Promise<CanonicalRow[]> {
  const canonicalPath = path.join(process.cwd(), 'data', 'canonical', `${symbol}.json`);
  
  try {
    const canonicalContent = await fs.promises.readFile(canonicalPath, 'utf-8');
    const canonicalData: CanonicalData = JSON.parse(canonicalContent);
    return canonicalData.rows;
  } catch (error) {
    throw new Error(`No canonical data found for ${symbol}`);
  }
}

/**
 * Load canonical data with metadata for a symbol
 */
export async function loadCanonicalDataWithMeta(symbol: string): Promise<CanonicalData> {
  const canonicalPath = path.join(process.cwd(), 'data', 'canonical', `${symbol}.json`);
  
  try {
    const canonicalContent = await fs.promises.readFile(canonicalPath, 'utf-8');
    const canonicalData: CanonicalData = JSON.parse(canonicalContent);
    return canonicalData;
  } catch (error) {
    throw new Error(`No canonical data found for ${symbol}`);
  }
}

/**
 * Alias for compatibility
 */
export const loadCanonical = loadCanonicalDataWithMeta;