/**
 * File hash and upload deduplication service
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface UploadMetadata {
  fileHash: string;
  symbol: string;
  vendor?: string;
  uploadedAt: string;
  filename: string;
  fileSize: number;
  rowCount: number;
  dateRange: { start: string; end: string };
  mode: 'replace' | 'incremental';
}

export interface ReuploadDecision {
  action: 'skip' | 'replace' | 'incremental' | 'conflict';
  reason: string;
  existingUpload?: UploadMetadata;
  conflictingDates?: string[];
}

/**
 * Calculate SHA-256 hash of file buffer
 */
export function calculateFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Save upload metadata for tracking
 */
export async function saveUploadMetadata(metadata: UploadMetadata): Promise<string> {
  const metadataDir = path.join(process.cwd(), 'data', 'metadata');
  await fs.promises.mkdir(metadataDir, { recursive: true });
  
  const filename = `${metadata.symbol}-${metadata.uploadedAt.split('T')[0]}-${metadata.fileHash.substring(0, 8)}.json`;
  const filePath = path.join(metadataDir, filename);
  
  await fs.promises.writeFile(filePath, JSON.stringify(metadata, null, 2));
  return filePath;
}

/**
 * Load existing upload metadata for a symbol
 */
export async function loadUploadHistory(symbol: string): Promise<UploadMetadata[]> {
  const metadataDir = path.join(process.cwd(), 'data', 'metadata');
  
  try {
    const files = await fs.promises.readdir(metadataDir);
    const symbolFiles = files.filter(f => f.startsWith(`${symbol}-`) && f.endsWith('.json'));
    
    const metadata: UploadMetadata[] = [];
    for (const file of symbolFiles) {
      try {
        const content = await fs.promises.readFile(path.join(metadataDir, file), 'utf-8');
        metadata.push(JSON.parse(content));
      } catch (e) {
        console.warn(`Failed to parse metadata file: ${file}`);
      }
    }
    
    return metadata.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)); // Latest first
  } catch (e) {
    return [];
  }
}

/**
 * Determine what to do with a re-upload
 */
export async function determineReuploadAction(
  fileHash: string,
  symbol: string,
  newDateRange: { start: string; end: string },
  defaultMode: 'replace' | 'incremental' = 'replace'
): Promise<ReuploadDecision> {
  const history = await loadUploadHistory(symbol);
  
  // Check for exact file hash match
  const exactMatch = history.find(h => h.fileHash === fileHash);
  if (exactMatch) {
    return {
      action: 'skip',
      reason: `Identical file already uploaded on ${exactMatch.uploadedAt}`,
      existingUpload: exactMatch
    };
  }
  
  // Check for date range overlaps
  const overlappingUploads = history.filter(h => 
    dateRangesOverlap(h.dateRange, newDateRange)
  );
  
  if (overlappingUploads.length === 0) {
    return {
      action: defaultMode,
      reason: `No date conflicts found, proceeding with ${defaultMode} mode`
    };
  }
  
  // Find specific conflicting dates
  const existingDates = new Set<string>();
  for (const upload of overlappingUploads) {
    const dates = generateDateRange(upload.dateRange.start, upload.dateRange.end);
    dates.forEach(date => existingDates.add(date));
  }
  
  const newDates = generateDateRange(newDateRange.start, newDateRange.end);
  const conflictingDates = newDates.filter(date => existingDates.has(date));
  
  if (conflictingDates.length > 0) {
    if (defaultMode === 'replace') {
      return {
        action: 'replace',
        reason: `Will overwrite ${conflictingDates.length} existing dates (${conflictingDates[0]} to ${conflictingDates[conflictingDates.length-1]})`,
        conflictingDates,
        existingUpload: overlappingUploads[0]
      };
    } else {
      return {
        action: 'conflict',
        reason: `Date conflicts found and incremental mode cannot handle overlaps`,
        conflictingDates,
        existingUpload: overlappingUploads[0]
      };
    }
  }
  
  return {
    action: defaultMode,
    reason: `No exact conflicts, proceeding with ${defaultMode} mode`
  };
}

/**
 * Merge new data with existing canonical data
 */
export async function mergeCanonicalData(
  symbol: string,
  newRows: any[],
  mode: 'replace' | 'incremental'
): Promise<{ merged: any[]; stats: { added: number; updated: number; skipped: number } }> {
  const { loadCanonical } = await import('../storage/canonical');
  
  const stats = { added: 0, updated: 0, skipped: 0 };
  
  try {
    const existing = await loadCanonical(symbol);
    if (!existing || !existing.rows || !Array.isArray(existing.rows) || mode === 'replace') {
      // Full replacement or no existing data or invalid data
      return { merged: newRows, stats: { added: newRows.length, updated: 0, skipped: 0 } };
    }
    
    // Incremental merge
    const existingByDate = new Map(existing.rows.map((row: any) => [row.date, row]));
    const merged = [...existing.rows];
    
    for (const newRow of newRows) {
      if (existingByDate.has(newRow.date)) {
        if (mode === 'incremental') {
          stats.skipped++;
          continue; // Skip existing dates in incremental mode
        } else {
          // Update existing row
          const index = merged.findIndex((row: any) => row.date === newRow.date);
          merged[index] = newRow;
          stats.updated++;
        }
      } else {
        merged.push(newRow);
        stats.added++;
      }
    }
    
    // Sort by date
    merged.sort((a: any, b: any) => a.date.localeCompare(b.date));
    
    return { merged, stats };
  } catch (e) {
    // No existing data or error loading
    return { merged: newRows, stats: { added: newRows.length, updated: 0, skipped: 0 } };
  }
}

function dateRangesOverlap(
  range1: { start: string; end: string },
  range2: { start: string; end: string }
): boolean {
  return range1.start <= range2.end && range2.start <= range1.end;
}

function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(start);
  const endDate = new Date(end);
  
  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
}