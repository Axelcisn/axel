import { loadCanonicalData } from '@/lib/storage/canonical';

export interface SimBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Load canonical daily OHLCV data for a symbol and map to a uniform SimBar shape.
 */
export async function loadSimBars(symbol: string): Promise<SimBar[]> {
  const data = await loadCanonicalData(symbol);
  return data.map((row) => ({
    date: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume ?? 0,
  }));
}
