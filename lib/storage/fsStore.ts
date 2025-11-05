import * as fs from 'fs';
import * as path from 'path';
import { CanonicalRow, CanonicalTableMeta, RepairRecord } from '../types/canonical';

const DATA_ROOT = path.join(process.cwd(), 'data');

export async function saveRaw(file: Buffer, symbol: string): Promise<string> {
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `${timestamp}-${symbol}.xlsx`;
  const filePath = path.join(DATA_ROOT, 'uploads', filename);
  
  // Ensure directory exists
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  
  // Atomic write: write to temp file then rename
  const tempPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tempPath, file);
  await fs.promises.rename(tempPath, filePath);
  
  return filePath;
}

export async function saveCanonical(
  symbol: string, 
  payload: { rows: CanonicalRow[]; meta: CanonicalTableMeta }
): Promise<string> {
  const filename = `${symbol}.json`;
  const filePath = path.join(DATA_ROOT, 'canonical', filename);
  
  // Ensure directory exists
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  
  // Atomic write: write to temp file then rename
  const tempPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(payload, null, 2));
  await fs.promises.rename(tempPath, filePath);
  
  return filePath;
}

export async function appendRepairs(symbol: string, repairs: RepairRecord[]): Promise<string> {
  const filename = `repairs-${symbol}.json`;
  const filePath = path.join(DATA_ROOT, 'audit', filename);
  
  // Ensure directory exists
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  
  let existingRepairs: RepairRecord[] = [];
  
  // Read existing repairs if file exists
  try {
    const existingContent = await fs.promises.readFile(filePath, 'utf-8');
    existingRepairs = JSON.parse(existingContent);
  } catch (error) {
    // File doesn't exist or is invalid, start with empty array
    existingRepairs = [];
  }
  
  // Append new repairs
  const allRepairs = [...existingRepairs, ...repairs];
  
  // Atomic write: write to temp file then rename
  const tempPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(allRepairs, null, 2));
  await fs.promises.rename(tempPath, filePath);
  
  return filePath;
}