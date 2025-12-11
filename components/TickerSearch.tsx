"use client";

import { useRouter } from "next/navigation";
import { useState, useRef, useEffect, KeyboardEvent, FormEvent } from "react";
import { useSymbolSearch } from "@/lib/hooks/useSymbolSearch";

interface TickerSearchProps {
  initialSymbol?: string;
  className?: string;
  isDarkMode?: boolean;
  compact?: boolean;
  autoFocus?: boolean;
  variant?: 'panel' | 'default';
  showBorder?: boolean;
  showRecentWhenEmpty?: boolean;
}

export function TickerSearch({
  initialSymbol,
  className,
  isDarkMode = true,
  compact = false,
  autoFocus = false,
  variant = 'default',
  showBorder = false,
  showRecentWhenEmpty = true,
}: TickerSearchProps) {
  const router = useRouter();
  const [value, setValue] = useState(initialSymbol ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { results } = useSymbolSearch(value);
  const [recentTickers, setRecentTickers] = useState<string[]>([]);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  // Load recent searches from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('axel:lastSearches');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          setRecentTickers(arr as string[]);
        }
      }
    } catch (e) {
      // ignore parsing/storage errors
    }
  }, []);

  function submit(symbolRaw: string) {
    const symbol = symbolRaw.trim().toUpperCase();
    if (!symbol) {
      setLocalError("Please enter a ticker symbol.");
      return;
    }
    setLocalError(null);
    // Save to recent searches in localStorage (dedup & limit)
    try {
      const key = 'axel:lastSearches';
      const raw = localStorage.getItem(key);
      let arr: string[] = raw ? JSON.parse(raw) : [];
      arr = arr.filter((s) => s !== symbol);
      arr.unshift(symbol);
      arr = arr.slice(0, 10);
      localStorage.setItem(key, JSON.stringify(arr));
      setRecentTickers(arr);
    } catch (e) {
      // ignore storage errors
    }

    router.push(`/company/${encodeURIComponent(symbol)}/timing`);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit(value);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setValue(e.target.value);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit(value);
  }

  const trimmed = value.trim();
  const hasQuery = trimmed.length >= 2;
  const hasResults = results.length > 0;
  const showSuggestions = hasQuery && hasResults;
  const label = showSuggestions ? "Suggested" : "Last searched";
  const visibleRecent = recentTickers.slice(0, 5);
  const listItems = showSuggestions
    ? results.map((r) => ({
        key: r.symbol,
        symbol: r.symbol,
        name: r.name,
        exchange: r.exchange,
        onClick: async () => {
          try {
            await fetch('/api/companies', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ticker: r.symbol, name: r.name, exchange: r.exchange })
            });
          } catch (err) {
            if (process.env.NODE_ENV === 'development') {
              console.warn('[TickerSearch] failed to upsert company', err);
            }
          }
          router.push(`/company/${r.symbol}/timing`);
        }
      }))
    : recentTickers.map((symbol) => ({
        key: symbol,
        symbol,
        name: '',
        exchange: undefined,
        onClick: () => submit(symbol)
      }));

  const shouldShowList = showSuggestions || (showRecentWhenEmpty && visibleRecent.length > 0);

  if (variant === 'panel') {
    const borderClasses = showBorder
      ? isDarkMode
        ? 'rounded-full border border-slate-800 bg-transparent px-4 py-3'
        : 'rounded-full border border-gray-300 bg-transparent px-4 py-3'
      : '';

    return (
      <div className="w-full">
        <div className="mx-auto w-full max-w-[1400px] px-6 md:px-10 pt-20 pb-16">
          <div className="max-w-5xl">
            <form onSubmit={handleSubmit} className="w-full">
              <div className={`flex items-center gap-3 ${borderClasses}`}>
                <button
                  type="submit"
                  className="flex h-6 w-6 items-center justify-center text-slate-500 hover:text-slate-300"
                >
                  <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m21 21-4.35-4.35m0 0A7.5 7.5 0 1 0 5 5a7.5 7.5 0 0 0 11.65 11.65Z" />
                  </svg>
                </button>
                <input
                  ref={inputRef}
                  value={value}
                  onChange={handleChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Search"
                  className="flex-1 bg-transparent text-4xl md:text-5xl font-semibold tracking-tight text-slate-100 outline-none placeholder:text-slate-600"
                />
              </div>
              {localError && (
                <p className="mt-2 text-sm text-red-400">{localError}</p>
              )}
            </form>

            {shouldShowList && (
              <section className="mt-10">
                <p className="text-[10px] md:text-[11px] font-semibold uppercase tracking-[0.20em] text-slate-500">
                  {label}
                </p>

                <div className="mt-3 space-y-1.5">
                  {showSuggestions
                    ? listItems.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          onClick={item.onClick}
                          className="flex w-full items-center gap-3 py-1.5 text-left text-sm md:text-base text-slate-200 hover:text-slate-50"
                        >
                          <svg className="h-4 w-4 text-slate-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5l7 7-7 7" />
                          </svg>
                          <span className="inline-flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-full bg-slate-700/80 text-xs font-semibold text-slate-200">
                              {item.symbol}
                            </span>
                            <span className="text-slate-300">
                              {item.name}
                            </span>
                          </span>
                          {item.exchange && (
                            <span className="ml-auto text-xs font-medium text-slate-500">
                              {item.exchange}
                            </span>
                          )}
                        </button>
                      ))
                    : visibleRecent.map((symbol) => (
                        <button
                          key={symbol}
                          type="button"
                          onClick={() => submit(symbol)}
                          className="flex w-full items-center gap-3 py-1.5 text-left text-sm md:text-base text-slate-200 hover:text-slate-50"
                        >
                          <svg className="h-4 w-4 text-slate-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5l7 7-7 7" />
                          </svg>
                          <span className="font-semibold">{symbol}</span>
                        </button>
                      ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`flex items-center gap-2 text-xs ${className ?? ""}`}
    >
      {!compact && (
        <label className={isDarkMode ? "text-slate-400" : "text-gray-500"}>
          <span className="mr-2">Search ticker:</span>
        </label>
      )}
      <div className="flex w-full items-center gap-1"> 
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          ref={inputRef}
          placeholder={compact ? "Search ticker…" : "AAPL, MSFT, SPY…"}
          className={`${compact ? 'w-32' : 'w-28'} ${
            isDarkMode
              ? "rounded-md border px-2 py-1 text-xs border-slate-700 bg-slate-900/80 text-slate-100 placeholder:text-slate-500 focus:border-sky-500"
              : "rounded-md border px-2 py-1 text-xs border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-sky-500"
          }`}
        />
        <button
          type="submit"
          className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
            isDarkMode
              ? "border-sky-500 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20"
              : "border-sky-500 bg-sky-100 text-sky-700 hover:bg-sky-200"
          }`}
        >
          Go
        </button>
      </div>
      <div className="mt-2 w-full">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">
          {label}
        </div>
        {listItems.length > 0 && (
          <div className="w-full rounded-md border border-slate-700 bg-black/60 shadow-lg">
            {listItems.map((r) => (
              <button
                type="button"
                key={r.key}
                onClick={r.onClick}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-800"
              >
                <span className="px-2 py-0.5 rounded-full bg-slate-700/80 text-xs font-semibold text-slate-200">
                  {r.symbol}
                </span>
                <span className="flex-1 truncate text-slate-300">{r.name || '—'}</span>
                <span className="text-xs text-slate-500">{r.exchange ?? "—"}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {localError && !compact && (
        <span className="ml-2 text-[11px] text-red-400">{localError}</span>
      )}
    </form>
  );
}
