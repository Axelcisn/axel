'use client';

import { useEffect, useState } from 'react';

export interface PriceHistoryPoint {
  date: string;
  close: number;
}

export interface UsePriceHistoryResult {
  data: PriceHistoryPoint[] | null;
  isLoading: boolean;
  error: string | null;
}

export function usePriceHistory(symbol: string | undefined): UsePriceHistoryResult {
  const [data, setData] = useState<PriceHistoryPoint[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) return;

    const controller = new AbortController();
    const { signal } = controller;
    const symbolStr = symbol;

    async function load() {
      try {
        setIsLoading(true);
        setError(null);

        const res = await fetch(
          `/api/history/${encodeURIComponent(symbolStr)}?interval=1d`,
          { signal }
        );

        if (!res.ok) {
          throw new Error(`Price history request failed: ${res.status}`);
        }

        const json = await res.json();
        const rows = (json.rows ?? []) as any[];

        const mapped: PriceHistoryPoint[] = rows
          .map((row) => ({
            date: row.date,
            close:
              typeof row.adj_close === 'number' && Number.isFinite(row.adj_close)
                ? row.adj_close
                : row.close,
          }))
          .filter((p) => Number.isFinite(p.close));

        // Ensure ascending chronological order and drop duplicate dates so
        // downstream indicators (EWMA, crossovers) receive a clean series.
        const sorted = mapped
          .slice()
          .sort((a, b) => a.date.localeCompare(b.date))
          .filter((p, idx, arr) => idx === 0 || p.date !== arr[idx - 1].date);

        setData(sorted);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        setError(err?.message || 'Failed to load price history');
        setData(null);
      } finally {
        setIsLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, [symbol]);

  return { data, isLoading, error };
}

export default usePriceHistory;
