import { useEffect, useRef, useState } from 'react';

export type YahooCandle = { t: number; o: number; h: number; l: number; c: number; v: number };

type CacheEntry = {
  expires: number;
  data: YahooCandle[];
};

const CACHE_TTL_MS = 45_000;
const cache = new Map<string, CacheEntry>();

export function useYahooCandles(ticker: string, interval: string, rangeDays: number) {
  const [candles, setCandles] = useState<YahooCandle[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!ticker || !interval || !rangeDays) return;
    const key = `${ticker}|${interval}|${rangeDays}`;

    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) {
      setCandles(cached.data);
      setLoading(false);
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const fetchCandles = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/yahoo/chart?ticker=${encodeURIComponent(ticker)}&interval=${encodeURIComponent(
            interval
          )}&rangeDays=${rangeDays}`,
          { signal: controller.signal }
        );
        if (!res.ok) {
          throw new Error(`Yahoo API ${res.status}`);
        }
        const json = await res.json();
        const data: YahooCandle[] = json?.candles ?? [];
        if (!data.length && process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line no-console
          console.warn('No Yahoo candles', {
            ticker,
            interval,
            rangeDays,
            error: json?.error,
            effectiveRangeDays: json?.effectiveRangeDays,
          });
        } else if (process.env.NODE_ENV === 'development') {
          const first = data[0]?.t ?? null;
          const last = data[data.length - 1]?.t ?? null;
          // eslint-disable-next-line no-console
          console.log(
            `[useYahooCandles] ${ticker} ${interval} candles=${data.length} first=${first} last=${last}`
          );
        }
        cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
        setCandles(data);
      } catch (err: any) {
        if (controller.signal.aborted) {
          setLoading(false);
          return;
        }
        setError(err instanceof Error ? err : new Error(String(err)));
        if (process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line no-console
          console.warn('Yahoo candles fetch failed', { ticker, interval, err });
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    fetchCandles();

    return () => {
      controller.abort();
    };
  }, [ticker, interval, rangeDays]);

  return { candles, loading, error };
}
