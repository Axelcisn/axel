"use client";

import { useEffect, useState } from "react";
import type { CapitalQuote } from "@/lib/marketData/capital";

export function useCapitalLiveQuote(epic: string, pollMs = 3000) {
  const [data, setData] = useState<CapitalQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!epic) return;

    let alive = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function tick() {
      try {
        setLoading(true);
        const res = await fetch(`/api/capital/quote/${encodeURIComponent(epic)}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        if (alive) {
          setData(json);
          setError(null);
        }
      } catch (e: any) {
        if (alive) setError(e?.message ?? "Fetch error");
      } finally {
        if (alive) setLoading(false);
      }
    }

    tick();
    timer = setInterval(tick, pollMs);

    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [epic, pollMs]);

  return { data, error, loading };
}
