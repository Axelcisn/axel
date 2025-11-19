/**
 * Corporate Actions handling with multiple data sources
 */

import { CanonicalRow } from '../types/canonical';

export interface CorporateAction {
  symbol: string;
  date: string; // Ex-date in exchange local time
  type: 'split' | 'dividend' | 'spinoff' | 'merger';
  splitRatio?: number; // e.g., 2.0 for 2:1 split
  cashAmount?: number; // dividend per share
  description?: string;
  source: 'price_file' | 'ca_upload' | 'vendor_feed';
}

export interface CAUploadResult {
  symbol: string;
  actions: CorporateAction[];
  conflicts: Array<{
    date: string;
    priceFileAction: CorporateAction | null;
    uploadedAction: CorporateAction;
    resolution: 'use_upload' | 'use_price_file' | 'manual_review';
  }>;
}

/**
 * Process corporate actions from separate upload
 * Join with existing price data by date
 */
export async function processCorporateActionsUpload(
  symbol: string,
  caBuffer: Buffer,
  existingPriceData?: CanonicalRow[]
): Promise<CAUploadResult> {
  const { parseExcelFromBuffer } = await import('./excel');
  
  // Parse CA file
  const rawCARows = await parseExcelFromBuffer(caBuffer);
  const actions: CorporateAction[] = rawCARows.map(row => ({
    symbol,
    date: normalizeDate(row.Date || row.date),
    type: normalizeCAType(row.Type || row.type),
    splitRatio: row.SplitRatio || row.split_ratio || null,
    cashAmount: row.Dividend || row.dividend || row.cash_dividend || null,
    description: row.Description || '',
    source: 'ca_upload'
  }));

  const conflicts: CAUploadResult['conflicts'] = [];

  if (existingPriceData) {
    // Check for conflicts with price file CA data
    for (const action of actions) {
      const priceRow = existingPriceData.find(row => row.date === action.date);
      if (priceRow && (priceRow.split_factor || priceRow.cash_dividend)) {
        const priceFileAction: CorporateAction = {
          symbol,
          date: action.date,
          type: priceRow.split_factor ? 'split' : 'dividend',
          splitRatio: priceRow.split_factor || undefined,
          cashAmount: priceRow.cash_dividend || undefined,
          source: 'price_file'
        };

        conflicts.push({
          date: action.date,
          priceFileAction,
          uploadedAction: action,
          resolution: determineResolution(priceFileAction, action)
        });
      }
    }
  }

  return { symbol, actions, conflicts };
}

/**
 * Recompute adjusted close using corporate actions
 */
export async function recomputeAdjustedClose(
  priceRows: CanonicalRow[],
  corporateActions: CorporateAction[]
): Promise<CanonicalRow[]> {
  const sortedRows = [...priceRows].sort((a, b) => a.date.localeCompare(b.date));
  const sortedActions = corporateActions.sort((a, b) => b.date.localeCompare(a.date)); // Reverse chronological
  
  let cumulativeAdjustment = 1.0;
  
  // Work backwards from latest date
  for (let i = sortedRows.length - 1; i >= 0; i--) {
    const row = sortedRows[i];
    
    // Check for corporate actions on this date
    const actionsOnDate = sortedActions.filter(ca => ca.date === row.date);
    
    for (const action of actionsOnDate) {
      if (action.type === 'split' && action.splitRatio) {
        cumulativeAdjustment *= action.splitRatio;
      }
      if (action.type === 'dividend' && action.cashAmount) {
        // Adjust for dividend (simplified - real calc more complex)
        const dividendAdjustment = (row.close - action.cashAmount) / row.close;
        cumulativeAdjustment *= dividendAdjustment;
      }
    }
    
    // Apply cumulative adjustment to this row
    row.adj_close = row.close / cumulativeAdjustment;
    
    // Update split factor and dividend fields if from CA upload
    const splitAction = actionsOnDate.find(ca => ca.type === 'split');
    const divAction = actionsOnDate.find(ca => ca.type === 'dividend');
    
    if (splitAction) row.split_factor = splitAction.splitRatio || null;
    if (divAction) row.cash_dividend = divAction.cashAmount || null;
  }
  
  return sortedRows;
}

function normalizeCAType(type: string): 'split' | 'dividend' | 'spinoff' | 'merger' {
  const normalized = type.toLowerCase();
  if (normalized.includes('split')) return 'split';
  if (normalized.includes('dividend') || normalized.includes('div')) return 'dividend';
  if (normalized.includes('spinoff') || normalized.includes('spin')) return 'spinoff';
  return 'merger';
}

function normalizeDate(dateValue: any): string {
  if (typeof dateValue === 'string') return dateValue;
  if (dateValue instanceof Date) return dateValue.toISOString().split('T')[0];
  return dateValue.toString();
}

function determineResolution(
  priceFileAction: CorporateAction, 
  uploadAction: CorporateAction
): 'use_upload' | 'use_price_file' | 'manual_review' {
  // Simple heuristic: prefer upload if values differ significantly
  if (priceFileAction.type !== uploadAction.type) return 'manual_review';
  
  if (priceFileAction.type === 'split') {
    const priceSplit = priceFileAction.splitRatio || 1;
    const uploadSplit = uploadAction.splitRatio || 1;
    if (Math.abs(priceSplit - uploadSplit) > 0.01) return 'manual_review';
  }
  
  if (priceFileAction.type === 'dividend') {
    const priceDiv = priceFileAction.cashAmount || 0;
    const uploadDiv = uploadAction.cashAmount || 0;
    if (Math.abs(priceDiv - uploadDiv) > 0.001) return 'manual_review';
  }
  
  // Default: trust the uploaded CA file
  return 'use_upload';
}