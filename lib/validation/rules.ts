import { CanonicalRow } from '../types/canonical';

/**
 * Row coherence validation
 */
export function ruleOHLC(row: CanonicalRow): boolean {
  const { open, high, low, close } = row;
  
  // Valid if high >= max(open, close) && low <= min(open, close) && low <= high
  const maxOC = Math.max(open, close);
  const minOC = Math.min(open, close);
  
  return high >= maxOC && low <= minOC && low <= high;
}

/**
 * Compute log return: r_t = ln(adj_close_t / adj_close_{t−1})
 */
export function computeLogReturns(rows: CanonicalRow[]): CanonicalRow[] {
  const sortedRows = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  
  for (let i = 0; i < sortedRows.length; i++) {
    if (i === 0) {
      // First row r = null
      sortedRows[i].r = null;
    } else {
      const currentAdjClose = sortedRows[i].adj_close;
      const previousAdjClose = sortedRows[i - 1].adj_close;
      
      if (currentAdjClose && previousAdjClose && previousAdjClose > 0) {
        sortedRows[i].r = Math.log(currentAdjClose / previousAdjClose);
      } else {
        sortedRows[i].r = null;
      }
    }
  }
  
  return sortedRows;
}

/**
 * Sort and deduplicate by date
 */
export function sortAndDedup(rows: CanonicalRow[]): { rows: CanonicalRow[]; duplicates: string[] } {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const seen = new Set<string>();
  const deduped: CanonicalRow[] = [];
  const duplicates: string[] = [];
  
  for (const row of sorted) {
    if (seen.has(row.date)) {
      duplicates.push(row.date);
    } else {
      seen.add(row.date);
      deduped.push(row);
    }
  }
  
  return { rows: deduped, duplicates };
}

/**
 * Validate rows and apply OHLC coherence
 */
export function validateRows(rows: CanonicalRow[]): CanonicalRow[] {
  return rows.map(row => {
    const issues = row.issues || [];
    let valid = row.valid !== false;
    
    // Check OHLC coherence
    if (!ruleOHLC(row)) {
      valid = false;
      issues.push('ohlc_coherence_violation');
    }
    
    return {
      ...row,
      valid,
      issues: issues.length > 0 ? issues : undefined
    };
  });
}