"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import type { Quote } from "@/lib/types/quotes";
import type { CapitalQuote } from "@/lib/marketData/capital";
import { parseProviderSymbol, type Provider } from "@/lib/symbols/parseProviderSymbol";

interface UseLiveQuoteOptions {
  pollMs?: number;
}

export type LiveQuote = {
  symbol: string;
  price: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  currency: string | null;
  asOf: string | null;
  source: Provider;
  bid?: number | null;
  ask?: number | null;
  mid?: number | null;
};

export function useLiveQuote(
  symbol: string,
  options: UseLiveQuoteOptions = {}
): {
  quote: LiveQuote | null;
  isLoading: boolean;
  error: Error | null;
} {
  const { pollMs = 0 } = options;

  const [quote, setQuote] = useState<LiveQuote | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 3;

  const { provider, id } = parseProviderSymbol(symbol);

  const normalizeCapital = (data: CapitalQuote): LiveQuote => {
    const mid = data.mid ?? (data.bid != null && data.ask != null ? (data.bid + data.ask) / 2 : null);
    const price = mid ?? data.bid ?? data.ask ?? null;
    return {
      symbol: data.epic,
      price,
      prevClose: null,
      change: null,
      changePct: null,
      currency: null,
      asOf: data.asOf ?? null,
      source: "capital",
      bid: data.bid ?? null,
      ask: data.ask ?? null,
      mid: mid,
    };
  };

  const normalizeYahoo = (data: Quote): LiveQuote => ({
    ...data,
    currency: data.currency ?? null,
    source: "yahoo",
  });

  const fetchQuote = useCallback(async (isCancelled: { current: boolean }) => {
    try {
      const path =
        provider === "capital"
          ? `/api/capital/quote/${encodeURIComponent(id)}`
          : `/api/quotes/${encodeURIComponent(id)}`;

      const res = await fetch(path, {
        cache: 'no-store',
      });
      
      if (!res.ok) {
        // Handle retryable errors (503)
        if (res.status === 503 && retryCountRef.current < maxRetries) {
          retryCountRef.current++;
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, retryCountRef.current - 1) * 1000;
          setTimeout(() => {
            if (!isCancelled.current) {
              fetchQuote(isCancelled);
            }
          }, delay);
          return;
        }
        throw new Error(`Quote fetch failed: ${res.status}`);
      }
      const data = await res.json();
      const normalized: LiveQuote =
        provider === "capital"
          ? normalizeCapital(data as CapitalQuote)
          : normalizeYahoo(data as Quote);

      if (!isCancelled.current) {
        setQuote(normalized);
        setError(null);
        retryCountRef.current = 0; // Reset retry count on success
      }
    } catch (err: any) {
      if (!isCancelled.current) {
        setError(err);
      }
    } finally {
      if (!isCancelled.current) {
        setIsLoading(false);
      }
    }
  }, [provider, id]);

  useEffect(() => {
    if (!symbol || !id) return;

    const isCancelled = { current: false };
    let intervalId: NodeJS.Timeout | null = null;

    // Initial fetch
    setIsLoading((prev) => prev && !quote);
    fetchQuote(isCancelled);

    // Setup polling if enabled
    if (pollMs > 0) {
      intervalId = setInterval(() => {
        if (!isCancelled.current) {
          fetchQuote(isCancelled);
        }
      }, pollMs);
    }

    return () => {
      isCancelled.current = true;
      if (intervalId) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, id, pollMs, fetchQuote]);

  return { quote, isLoading, error };
}
