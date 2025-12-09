"use client";

import { useEffect, useState } from "react";

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange?: string;
}

export function useSymbolSearch(query: string, debounceMs = 200) {
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!query || query.trim().length < 2) {
      setResults([]);
      setError(null);
      return;
    }

    const handle = setTimeout(async () => {
      try {
        setIsLoading(true);
        const res = await fetch(`/api/companies/search?q=${encodeURIComponent(query.trim())}`);
        if (!res.ok) {
          throw new Error(`Search failed: ${res.status}`);
        }
        const data = (await res.json()) as SymbolSearchResult[];
        setResults(data);
        setError(null);
      } catch (err: any) {
        setError(err);
      } finally {
        setIsLoading(false);
      }
    }, debounceMs);

    return () => clearTimeout(handle);
  }, [query, debounceMs]);

  return { results, isLoading, error };
}
