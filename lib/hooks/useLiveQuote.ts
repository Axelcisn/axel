"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!symbol) return;

    let isCancelled = false;
    let intervalId: NodeJS.Timeout | null = null;

    async function fetchQuote() {
      try {
        setIsLoading((prev) => prev && !quote);
        const res = await fetch(`/api/quotes/${encodeURIComponent(symbol)}`);
        if (!res.ok) {
          throw new Error(`Quote fetch failed: ${res.status}`);
        }
        const data = (await res.json()) as Quote;
        if (!isCancelled) {
          setQuote(data);
          setError(null);
        }
      } catch (err: any) {
        if (!isCancelled) {
          setError(err);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchQuote();

    if (pollMs > 0) {
      intervalId = setInterval(fetchQuote, pollMs);
    }

    return () => {
      isCancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, pollMs]);

  return { quote, isLoading, error };
}
