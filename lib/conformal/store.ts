import fs from 'fs';
import path from 'path';
import { ConformalState } from './types';

const DATA_ROOT = path.join(process.cwd(), 'data');
const CONFORMAL_DIR = path.join(DATA_ROOT, 'conformal');

/**
 * Load conformal state for a symbol
 */
export async function loadState(symbol: string): Promise<ConformalState | null> {
  const filename = `${symbol}-state.json`;
  const filePath = path.join(CONFORMAL_DIR, filename);
  
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content) as ConformalState;
  } catch (error) {
    // File doesn't exist or is invalid
    return null;
  }
}

/**
 * Save conformal state for a symbol (atomic write)
 */
export async function saveState(symbol: string, state: ConformalState): Promise<string> {
  const filename = `${symbol}-state.json`;
  const filePath = path.join(CONFORMAL_DIR, filename);
  
  // Ensure directory exists
  await fs.promises.mkdir(CONFORMAL_DIR, { recursive: true });
  
  // Update timestamp
  const stateToSave: ConformalState = {
    ...state,
    updated_at: new Date().toISOString()
  };
  
  // Atomic write: write to temp file then rename
  const tempPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(stateToSave, null, 2));
  await fs.promises.rename(tempPath, filePath);
  
  return filePath;
}