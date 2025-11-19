import * as XLSX from 'xlsx';
import { CanonicalRow } from '../types/canonical';

// Robust type definitions for parsed price data
export type PriceRow = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  adjClose: number | null;
  volume: number | null;
};

// Normalize column headers: lowercase and strip punctuation/whitespace
const norm = (s?: any) => String(s ?? "").trim().toLowerCase().replace(/[.\s_-]+/g, "_");

const normalizeRow = (r: Record<string, any>) => {
  const m: Record<string, any> = {};
  for (const k of Object.keys(r)) {
    m[norm(k)] = r[k];
  }
  return m;
};

/**
 * Robust Excel parser that handles Yahoo/Stooq style headers and never crashes
 */
export function parseHistoricalPriceXlsx(ab: ArrayBuffer): PriceRow[] {
  try {
    const wb = XLSX.read(new Uint8Array(ab), { type: "array" });
    if (!wb.SheetNames.length) return [];
    
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: null, raw: true });
    
    if (!Array.isArray(raw)) return [];
    
    return raw.map(o => {
      const r = normalizeRow(o);
      
      // Date field aliases
      const date = r.date ?? r.timestamp ?? r.trade_date ?? "";
      
      // Price fields
      const open = Number(r.open);
      const high = Number(r.high);
      const low = Number(r.low);
      const close = Number(r.close);
      
      // Adjusted close with extensive aliases for Yahoo/Stooq formats
      const adj = r.adj_close ?? r.adjclose ?? r.adjusted_close ?? 
                  r.adj_close_ ?? r.adj__close ?? r.adjclose_ ?? 
                  r.adj_close__ ?? r.adj_close___ ?? null;
      const adjClose = adj != null ? Number(adj) : (isFinite(close) ? Number(close) : null);
      
      // Volume field
      const volume = r.volume != null ? Number(r.volume) : null;
      
      // Fix function to handle NaN and null values
      const fix = (x: any) => (x != null && !Number.isNaN(Number(x)) ? Number(x) : null);
      
      return {
        date: String(date ?? ""),
        open: fix(open),
        high: fix(high),
        low: fix(low),
        close: fix(close),
        adjClose: fix(adjClose),
        volume: fix(volume)
      };
    }).filter(x => x.date && (x.adjClose != null || x.close != null));
  } catch {
    return [];
  }
}

/**
 * Robust CSV parser for historical price data with header normalization
 */
export async function parseHistoricalPriceCsv(text: string): Promise<PriceRow[]> {
  try {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    
    const [header, ...rest] = lines;
    const cols = header.split(",").map(s => norm(s.trim()));
    
    const getIdx = (aliases: string[]) => {
      for (const alias of aliases) {
        const idx = cols.indexOf(alias);
        if (idx !== -1) return idx;
      }
      return -1;
    };
    
    const di = getIdx(["date", "timestamp", "trade_date"]);
    const oi = getIdx(["open"]);
    const hi = getIdx(["high"]);
    const li = getIdx(["low"]);
    const ci = getIdx(["close"]);
    const ai = getIdx(["adj_close", "adjclose", "adjusted_close", "adj__close", "adjclose_"]);
    const vi = getIdx(["volume"]);
    
    if (di === -1) return [];
    
    return rest.map(line => {
      try {
        const c = line.split(",").map(s => s.trim());
        
        const date = String(c[di] ?? "");
        const open = oi !== -1 ? Number(c[oi]) : null;
        const high = hi !== -1 ? Number(c[hi]) : null;
        const low = li !== -1 ? Number(c[li]) : null;
        const close = ci !== -1 ? Number(c[ci]) : null;
        const adjFromFile = ai !== -1 ? Number(c[ai]) : null;
        const adjClose = adjFromFile != null ? adjFromFile : close;
        const volume = vi !== -1 ? Number(c[vi]) : null;
        
        const fix = (x: any) => (x != null && !Number.isNaN(Number(x)) ? Number(x) : null);
        
        return {
          date,
          open: fix(open),
          high: fix(high),
          low: fix(low),
          close: fix(close),
          adjClose: fix(adjClose),
          volume: fix(volume)
        };
      } catch {
        return null;
      }
    }).filter((x): x is PriceRow => 
      x !== null && 
      x.date.length > 0 && 
      (x.adjClose != null || x.close != null)
    );
  } catch {
    return [];
  }
}

export async function parseExcelToRows(filePath: string): Promise<Record<string, any>[]> {
  const workbook = XLSX.readFile(filePath);
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  
  // Convert to array of objects
  const rawData = XLSX.utils.sheet_to_json(worksheet) as Record<string, any>[];
  return rawData;
}

export async function parseExcelFromBuffer(buffer: Buffer): Promise<Record<string, any>[]> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  
  // Convert to array of objects
  const rawData = XLSX.utils.sheet_to_json(worksheet) as Record<string, any>[];
  return rawData;
}

/**
 * Generic function to parse either Excel or CSV files from buffer
 */
export async function parseFileFromBuffer(buffer: Buffer, filename: string): Promise<Record<string, any>[]> {
  const lowerFilename = filename.toLowerCase();
  
  if (lowerFilename.endsWith('.csv')) {
    // Parse as CSV
    const text = buffer.toString('utf-8');
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    
    const [header, ...dataLines] = lines;
    const headers = header.split(',').map(h => h.trim().replace(/"/g, ''));
    
    return dataLines.map(line => {
      const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
      const row: Record<string, any> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      return row;
    });
  } else if (lowerFilename.endsWith('.xlsx') || lowerFilename.endsWith('.xls')) {
    // Parse as Excel
    return parseExcelFromBuffer(buffer);
  } else {
    throw new Error(`Unsupported file type: ${filename}`);
  }
}

export function mapColumns(raw: Record<string, any>[]): CanonicalRow[] {
  return raw.map(row => {
    // Find columns with case-insensitive matching
    const findColumn = (variants: string[]) => {
      for (const variant of variants) {
        const key = Object.keys(row).find(k => 
          k.toLowerCase().replace(/[_\s]/g, '') === variant.toLowerCase().replace(/[_\s]/g, '')
        );
        if (key !== undefined) return row[key];
      }
      return null;
    };

    // Extract date and convert to YYYY-MM-DD
    const dateValue = findColumn(['date', 'Date', 'DATE']);
    let dateStr = '';
    if (dateValue) {
      const date = new Date(dateValue);
      if (!isNaN(date.getTime())) {
        dateStr = date.toISOString().split('T')[0];
      }
    }

    // Extract price data
    const open = parseFloat(findColumn(['open', 'Open', 'OPEN']) || '0');
    const high = parseFloat(findColumn(['high', 'High', 'HIGH']) || '0');
    const low = parseFloat(findColumn(['low', 'Low', 'LOW']) || '0');
    const close = parseFloat(findColumn(['close', 'Close', 'CLOSE']) || '0');
    
    // Extract adjusted close with variants
    let adj_close = parseFloat(findColumn([
      'adj_close', 'adjclose', 'adj close', 'adjusted_close', 
      'adjustedclose', 'Adj Close', 'AdjClose', 'ADJCLOSE'
    ]) || '0') || null;

    // Extract volume
    const volume = parseFloat(findColumn(['volume', 'Volume', 'VOLUME']) || '0') || null;

    // Extract optional corporate action data
    const split_factor = parseFloat(findColumn([
      'split_factor', 'splitfactor', 'split factor', 'Split Factor'
    ]) || '0') || null;
    
    const cash_dividend = parseFloat(findColumn([
      'cash_dividend', 'cashdividend', 'dividend', 'Dividend', 'Cash Dividend'
    ]) || '0') || null;

    const issues: string[] = [];
    let valid = true;

    // If adj_close missing but close present → set adj_close = close
    if (!adj_close && close > 0) {
      adj_close = close;
      issues.push('adj_close_filled_from_close');
    }

    // Validate price data
    if (!dateStr) {
      valid = false;
      issues.push('invalid_date');
    }
    
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
      valid = false;
      issues.push('invalid_price_data');
    }

    return {
      date: dateStr,
      open: Math.round(open * 10000) / 10000, // Round to 4 decimal places
      high: Math.round(high * 10000) / 10000,
      low: Math.round(low * 10000) / 10000,
      close: Math.round(close * 10000) / 10000,
      adj_close: adj_close ? Math.round(adj_close * 10000) / 10000 : null,
      volume,
      split_factor,
      cash_dividend,
      valid,
      issues: issues.length > 0 ? issues : undefined
    };
  }).filter(row => row.date); // Filter out rows without valid dates
}