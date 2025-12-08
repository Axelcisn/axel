"use client";

import { useRouter } from "next/navigation";
import { useState, useRef, useEffect, KeyboardEvent, FormEvent } from "react";

interface TickerSearchProps {
  initialSymbol?: string;
  className?: string;
  isDarkMode?: boolean;
  compact?: boolean;
  autoFocus?: boolean;
  variant?: 'panel' | 'default';
}

export function TickerSearch({ initialSymbol, className, isDarkMode = true, compact = false, autoFocus = false, variant = 'default' }: TickerSearchProps) {
  const router = useRouter();
  const [value, setValue] = useState(initialSymbol ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

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

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit(value);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={`${variant === 'panel' ? 'flex w-full items-center gap-3' : 'flex items-center gap-2 text-xs'} ${className ?? ""}`}
    >
      {/* Panel variant: hide the small label and show a large full-width input */}
      {variant !== 'panel' && !compact && (
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
          placeholder={variant === 'panel' ? "Search" : (compact ? "Search ticker…" : "AAPL, MSFT, SPY…")}
          className={`${variant === 'panel' ? 'w-full rounded-none border-0 bg-transparent pl-0 pr-3 text-4xl md:text-[42px] font-semibold tracking-tight leading-tight' : (compact ? 'w-32' : 'w-28')} ${
            variant === 'panel'
              ? (isDarkMode
                ? 'text-slate-100 placeholder:text-slate-500 focus:outline-none'
                : 'text-gray-900 placeholder:text-gray-500 focus:outline-none')
              : (isDarkMode
                  ? "rounded-md border px-2 py-1 text-xs border-slate-700 bg-slate-900/80 text-slate-100 placeholder:text-slate-500 focus:border-sky-500"
                  : "rounded-md border px-2 py-1 text-xs border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-sky-500")
          }`}
        />
        {/* For the panel variant we don't show the Go button; submission is done via Enter */}
        {variant !== 'panel' && (
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
        )}
      </div>
      {localError && !compact && (
        <span className="ml-2 text-[11px] text-red-400">{localError}</span>
      )}
    </form>
  );
}
