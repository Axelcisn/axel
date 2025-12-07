"use client";

import { useRouter } from "next/navigation";
import { useState, KeyboardEvent, FormEvent } from "react";

interface TickerSearchProps {
  initialSymbol?: string;
  className?: string;
  isDarkMode?: boolean;
  compact?: boolean;
}

export function TickerSearch({ initialSymbol, className, isDarkMode = true, compact = false }: TickerSearchProps) {
  const router = useRouter();
  const [value, setValue] = useState(initialSymbol ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(symbolRaw: string) {
    const symbol = symbolRaw.trim().toUpperCase();
    if (!symbol) {
      setLocalError("Please enter a ticker symbol.");
      return;
    }
    setLocalError(null);
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
      className={`flex items-center gap-2 text-xs ${className ?? ""}`}
    >
      {!compact && (
        <label className={isDarkMode ? "text-slate-400" : "text-gray-500"}>
          <span className="mr-2">Search ticker:</span>
        </label>
      )}
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={compact ? "Search ticker…" : "AAPL, MSFT, SPY…"}
          className={`${compact ? 'w-32' : 'w-28'} rounded-md border px-2 py-1 text-xs focus:outline-none ${
            isDarkMode
              ? "border-slate-700 bg-slate-900/80 text-slate-100 placeholder:text-slate-500 focus:border-sky-500"
              : "border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-sky-500"
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
      {localError && !compact && (
        <span className="ml-2 text-[11px] text-red-400">{localError}</span>
      )}
    </form>
  );
}
