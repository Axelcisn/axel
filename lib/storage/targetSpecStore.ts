import * as fs from 'fs';
import * as path from 'path';
import { TargetSpec } from '../types/targetSpec';

// Use /tmp in production (Vercel), data/ in development
const DATA_ROOT = process.env.NODE_ENV === 'production' 
  ? '/tmp/data' 
  : path.join(process.cwd(), 'data');
const SPECS_DIR = path.join(DATA_ROOT, 'specs');

export async function getTargetSpec(symbol: string): Promise<TargetSpec | null> {
  const filename = `${symbol}-target.json`;
  const filePath = path.join(SPECS_DIR, filename);
  
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content) as TargetSpec;
  } catch (error) {
    // File doesn't exist or is invalid
    return null;
  }
}

export async function saveTargetSpec(input: TargetSpec): Promise<TargetSpec> {
  const filename = `${input.symbol}-target.json`;
  const filePath = path.join(SPECS_DIR, filename);
  
  // Ensure directory exists
  await fs.promises.mkdir(SPECS_DIR, { recursive: true });
  
  // Add updated timestamp
  const targetSpec: TargetSpec = {
    ...input,
    updated_at: new Date().toISOString()
  };
  
  // Atomic write: write to temp file then rename
  const tempPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(targetSpec, null, 2));
  await fs.promises.rename(tempPath, filePath);
  
  return targetSpec;
}