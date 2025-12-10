"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import type { Quote } from "@/lib/types/quotes";

interface UseLiveQuoteOptions {
  pollMs?: number;
}

export function useLiveQuote(
  symbol: string,
  options: UseLiveQuoteOptions = {}
): {
  quote: Quote | null;
  isLoading: boolean;
  error: Error | null;
} {
  const { pollMs = 0 } = options;

  const [quote, setQuote] = useState<Quote | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 3;

  const fetchQuote = useCallback(async (isCancelled: { current: boolean }) => {
    try {
      const res = await fetch(`/api/quotes/${encodeURIComponent(symbol)}`, {
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
      
      const data = (await res.json()) as Quote;
      if (!isCancelled.current) {
        setQuote(data);
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
  }, [symbol]);

  useEffect(() => {
    if (!symbol) return;

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
  }, [symbol, pollMs, fetchQuote]);

  return { quote, isLoading, error };
}
