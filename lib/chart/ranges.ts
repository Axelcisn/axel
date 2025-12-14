export type PriceRange =
  | "1D"
  | "5D"
  | "1M"
  | "3M"
  | "6M"
  | "YTD"
  | "1Y"
  | "5Y"
  | "ALL";

interface PricePoint {
  date: string;
  adj_close: number;
}

/**
 * Slice historical price data by time range
 * @param rows - Array of price data points (should be sorted by date ascending)
 * @param range - Time range to slice
 * @param today - Reference date for calculations (defaults to today)
 * @returns Filtered array of price points
 */
export function sliceByRange(
  rows: PricePoint[],
  range: PriceRange,
  today?: string
): PricePoint[] {
  if (!rows || rows.length === 0) return [];
  
  const referenceDate = today || new Date().toISOString().split('T')[0];
  
  switch (range) {
    case "ALL":
      return rows;
      
    case "1D":
      // Return last trading day (or last 1-2 rows since we have daily data)
      return rows.slice(-1);
      
    case "5D":
      // Last 5 trading days
      return rows.slice(-5);
      
    case "1M":
      // Approximately 21 trading days (1 month)
      return rows.slice(-21);
    case "3M":
      // Approximately 63 trading days (3 months)
      return rows.slice(-63);
      
    case "6M":
      // Approximately 126 trading days (6 months)
      return rows.slice(-126);
      
    case "1Y":
      // Approximately 252 trading days (1 year)
      return rows.slice(-252);
      
    case "5Y":
      // Approximately 1260 trading days (5 years)
      return rows.slice(-1260);
      
    case "YTD":
      // Year to date - from Jan 1 of the last available year
      if (rows.length === 0) return [];
      
      const lastDate = rows[rows.length - 1].date;
      const yearOfLastDate = new Date(lastDate).getFullYear();
      const yearStart = `${yearOfLastDate}-01-01`;
      
      return rows.filter(row => row.date >= yearStart);
      
    default:
      return rows;
  }
}

/**
 * Calculate performance for a range of price data
 * @param data - Array of price points
 * @returns Object with performance percentage and direction
 */
export function calculateRangePerformance(data: PricePoint[]): {
  percentage: number;
  direction: 'up' | 'down' | 'neutral';
  formatted: string;
} {
  if (!data || data.length === 0) {
    return { percentage: 0, direction: 'neutral', formatted: '—' };
  }
  
  if (data.length === 1) {
    return { percentage: 0, direction: 'neutral', formatted: '0.00%' };
  }
  
  const first = data[0].adj_close;
  const last = data[data.length - 1].adj_close;
  
  if (!first || !last || first === 0) {
    return { percentage: 0, direction: 'neutral', formatted: '—' };
  }
  
  const percentage = ((last - first) / first) * 100;
  const direction = percentage > 0 ? 'up' : percentage < 0 ? 'down' : 'neutral';
  const formatted = `${percentage >= 0 ? '+' : ''}${percentage.toFixed(2)}%`;
  
  return { percentage, direction, formatted };
}

/**
 * Get display label for a price range
 */
export function getRangeLabel(range: PriceRange): string {
  switch (range) {
    case "1D": return "1 day";
    case "5D": return "5 days";
    case "1M": return "1 month";
    case "3M": return "3 months";
    case "6M": return "6 months";
    case "YTD": return "Year to date";
    case "1Y": return "1 year";
    case "5Y": return "5 years";
    case "ALL": return "All time";
    default: return range;
  }
}
