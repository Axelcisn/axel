import * as XLSX from 'xlsx';
import { CanonicalRow } from '../types/canonical';

export async function parseExcelToRows(filePath: string): Promise<Record<string, any>[]> {
  const workbook = XLSX.readFile(filePath);
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  
  // Convert to array of objects
  const rawData = XLSX.utils.sheet_to_json(worksheet) as Record<string, any>[];
  return rawData;
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