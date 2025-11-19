/**
 * Enhanced provenance and audit tracking system
 */

import { RepairRecord } from '../types/canonical';

export interface ProvenanceRecord {
  id: string;
  symbol: string;
  uploadedAt: string;
  fileInfo: {
    originalName: string;
    fileHash: string;
    sizeBytes: number;
    mimeType?: string;
  };
  vendor: {
    name: string;
    detectedFrom: 'headers' | 'user_specified' | 'filename' | 'default';
    confidence: number; // 0-100
  };
  processing: {
    headerMappings: Record<string, string>;
    rowsProcessed: number;
    rowsAccepted: number;
    rowsRejected: number;
    dateRange: { start: string; end: string };
    processingTimeMs: number;
  };
  validation: {
    validationPassed: boolean;
    warnings: string[];
    errors: string[];
    qualityScore: number;
  };
  transformations: {
    appliedRepairs: number;
    computedFields: string[]; // e.g., ['adj_close', 'log_returns']
    normalizations: string[]; // e.g., ['duplicate_removal', 'date_formatting']
  };
  storage: {
    canonicalPath: string;
    auditPath: string;
    backupPath?: string;
  };
  user?: {
    uploadedBy?: string;
    notes?: string;
  };
}

export interface AuditSummary {
  symbol: string;
  totalUploads: number;
  dateRange: { start: string; end: string };
  dataQuality: {
    averageQualityScore: number;
    totalRepairs: number;
    commonIssues: Array<{ issue: string; count: number }>;
  };
  vendors: Array<{ vendor: string; uploads: number; lastUpload: string }>;
  recentActivity: ProvenanceRecord[];
}

/**
 * Create a comprehensive provenance record for an upload
 */
export async function createProvenanceRecord(
  symbol: string,
  uploadData: {
    originalFileName: string;
    fileBuffer: Buffer;
    vendor: { name: string; detectedFrom: 'headers' | 'user_specified' | 'filename' | 'default'; confidence: number };
    headerMappings: Record<string, string>;
    processingStats: {
      rowsProcessed: number;
      rowsAccepted: number;
      rowsRejected: number;
      dateRange: { start: string; end: string };
      processingTimeMs: number;
    };
    validation: {
      validationPassed: boolean;
      warnings: string[];
      errors: string[];
      qualityScore: number;
    };
    repairs: RepairRecord[];
    paths: { canonical: string; audit: string };
    userId?: string;
    notes?: string;
  }
): Promise<ProvenanceRecord> {
  const crypto = await import('crypto');
  
  const id = crypto.randomUUID();
  const fileHash = crypto.createHash('sha256').update(uploadData.fileBuffer).digest('hex');

  const record: ProvenanceRecord = {
    id,
    symbol,
    uploadedAt: new Date().toISOString(),
    fileInfo: {
      originalName: uploadData.originalFileName,
      fileHash,
      sizeBytes: uploadData.fileBuffer.length,
      mimeType: inferMimeType(uploadData.originalFileName)
    },
    vendor: uploadData.vendor,
    processing: {
      headerMappings: uploadData.headerMappings,
      rowsProcessed: uploadData.processingStats.rowsProcessed,
      rowsAccepted: uploadData.processingStats.rowsAccepted,
      rowsRejected: uploadData.processingStats.rowsRejected,
      dateRange: uploadData.processingStats.dateRange,
      processingTimeMs: uploadData.processingStats.processingTimeMs
    },
    validation: uploadData.validation,
    transformations: {
      appliedRepairs: uploadData.repairs.length,
      computedFields: extractComputedFields(uploadData.repairs),
      normalizations: extractNormalizations(uploadData.repairs)
    },
    storage: {
      canonicalPath: uploadData.paths.canonical,
      auditPath: uploadData.paths.audit
    },
    user: {
      uploadedBy: uploadData.userId,
      notes: uploadData.notes
    }
  };

  await saveProvenanceRecord(record);
  return record;
}

/**
 * Save provenance record to storage
 */
async function saveProvenanceRecord(record: ProvenanceRecord): Promise<string> {
  const fs = await import('fs');
  const path = await import('path');
  
  const provenanceDir = path.join(process.cwd(), 'data', 'provenance');
  await fs.promises.mkdir(provenanceDir, { recursive: true });
  
  // Save individual record
  const recordFile = path.join(provenanceDir, `${record.id}.json`);
  await fs.promises.writeFile(recordFile, JSON.stringify(record, null, 2));
  
  // Update symbol index
  await updateSymbolProvenanceIndex(record);
  
  return recordFile;
}

/**
 * Update provenance index for quick symbol lookups
 */
async function updateSymbolProvenanceIndex(record: ProvenanceRecord): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');
  
  const indexFile = path.join(process.cwd(), 'data', 'provenance', `${record.symbol}-index.json`);
  
  let index: { symbol: string; records: string[] } = { symbol: record.symbol, records: [] };
  
  try {
    const content = await fs.promises.readFile(indexFile, 'utf-8');
    index = JSON.parse(content);
  } catch (e) {
    // File doesn't exist, use default
  }
  
  // Add new record ID
  index.records.unshift(record.id); // Most recent first
  
  // Keep only last 100 records to prevent unbounded growth
  index.records = index.records.slice(0, 100);
  
  await fs.promises.writeFile(indexFile, JSON.stringify(index, null, 2));
}

/**
 * Load provenance records for a symbol
 */
export async function loadSymbolProvenance(
  symbol: string, 
  limit: number = 10
): Promise<ProvenanceRecord[]> {
  const fs = await import('fs');
  const path = await import('path');
  
  const indexFile = path.join(process.cwd(), 'data', 'provenance', `${symbol}-index.json`);
  
  try {
    const indexContent = await fs.promises.readFile(indexFile, 'utf-8');
    const index = JSON.parse(indexContent);
    
    const recordIds = index.records.slice(0, limit);
    const records: ProvenanceRecord[] = [];
    
    for (const recordId of recordIds) {
      try {
        const recordFile = path.join(process.cwd(), 'data', 'provenance', `${recordId}.json`);
        const recordContent = await fs.promises.readFile(recordFile, 'utf-8');
        records.push(JSON.parse(recordContent));
      } catch (e) {
        console.warn(`Failed to load provenance record: ${recordId}`);
      }
    }
    
    return records;
  } catch (e) {
    return [];
  }
}

/**
 * Generate audit summary for a symbol
 */
export async function generateAuditSummary(symbol: string): Promise<AuditSummary> {
  const records = await loadSymbolProvenance(symbol, 50); // Last 50 uploads
  
  if (records.length === 0) {
    return {
      symbol,
      totalUploads: 0,
      dateRange: { start: '', end: '' },
      dataQuality: {
        averageQualityScore: 0,
        totalRepairs: 0,
        commonIssues: []
      },
      vendors: [],
      recentActivity: []
    };
  }

  // Calculate date range across all uploads
  const allDateRanges = records.map(r => r.processing.dateRange);
  const startDates = allDateRanges.map(dr => dr.start).filter(Boolean);
  const endDates = allDateRanges.map(dr => dr.end).filter(Boolean);
  
  const dateRange = {
    start: startDates.length > 0 ? startDates.sort()[0] : '',
    end: endDates.length > 0 ? endDates.sort().reverse()[0] : ''
  };

  // Quality metrics
  const qualityScores = records.map(r => r.validation.qualityScore).filter(s => s > 0);
  const averageQualityScore = qualityScores.length > 0 
    ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length 
    : 0;
  
  const totalRepairs = records.reduce((sum, r) => sum + r.transformations.appliedRepairs, 0);
  
  // Common issues analysis
  const issueCount = new Map<string, number>();
  for (const record of records) {
    for (const warning of record.validation.warnings) {
      issueCount.set(warning, (issueCount.get(warning) || 0) + 1);
    }
    for (const error of record.validation.errors) {
      issueCount.set(error, (issueCount.get(error) || 0) + 1);
    }
  }
  
  const commonIssues = Array.from(issueCount.entries())
    .map(([issue, count]) => ({ issue, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Vendor analysis
  const vendorCount = new Map<string, { count: number; lastUpload: string }>();
  for (const record of records) {
    const vendor = record.vendor.name;
    const existing = vendorCount.get(vendor) || { count: 0, lastUpload: '' };
    vendorCount.set(vendor, {
      count: existing.count + 1,
      lastUpload: record.uploadedAt > existing.lastUpload ? record.uploadedAt : existing.lastUpload
    });
  }
  
  const vendors = Array.from(vendorCount.entries())
    .map(([vendor, data]) => ({ vendor, uploads: data.count, lastUpload: data.lastUpload }))
    .sort((a, b) => b.uploads - a.uploads);

  return {
    symbol,
    totalUploads: records.length,
    dateRange,
    dataQuality: {
      averageQualityScore,
      totalRepairs,
      commonIssues
    },
    vendors,
    recentActivity: records.slice(0, 5) // Most recent 5
  };
}

function inferMimeType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  switch (ext) {
    case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'xls': return 'application/vnd.ms-excel';
    case 'csv': return 'text/csv';
    default: return 'application/octet-stream';
  }
}

function extractComputedFields(repairs: RepairRecord[]): string[] {
  const computed = new Set<string>();
  for (const repair of repairs) {
    if (repair.reason.includes('computed') || repair.reason.includes('calculated')) {
      computed.add(repair.field);
    }
  }
  return Array.from(computed);
}

function extractNormalizations(repairs: RepairRecord[]): string[] {
  const normalizations = new Set<string>();
  for (const repair of repairs) {
    if (repair.reason.includes('normalized') || repair.reason.includes('standardized')) {
      normalizations.add(repair.reason);
    }
  }
  return Array.from(normalizations);
}