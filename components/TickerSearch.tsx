"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, KeyboardEvent, FormEvent } from "react";

interface TickerSearchProps {
  initialSymbol?: string;
  className?: string;
  isDarkMode?: boolean;
  compact?: boolean;
  variant?: "inline" | "overlay";
  suggestions?: string[];
  autoFocus?: boolean;
  onClose?: () => void;
  onSubmitSuccess?: () => void;
}

export function TickerSearch({
  initialSymbol,
  className,
  isDarkMode = true,
  compact = false,
  variant = "inline",
  suggestions,
  autoFocus = false,
  onClose,
  onSubmitSuccess,
}: TickerSearchProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialSymbol ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  function submit(symbolRaw: string) {
    const symbol = symbolRaw.trim().toUpperCase();
    if (!symbol) {
      setLocalError("Please enter a ticker symbol.");
      return;
    }
    setLocalError(null);
    router.push(`/company/${encodeURIComponent(symbol)}/timing`);
    onSubmitSuccess?.();
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

  const overlayInputClasses = `${
    isDarkMode
      ? "bg-slate-900/70 border-slate-700 text-slate-100 placeholder:text-slate-500 shadow-[0_25px_80px_-40px_rgba(0,0,0,0.45)]"
      : "bg-white/80 border-gray-200 text-gray-900 placeholder:text-gray-500 shadow-[0_25px_80px_-35px_rgba(15,23,42,0.25)]"
  } w-full rounded-2xl border px-5 py-4 pl-12 pr-16 text-base transition-all duration-300 focus:ring-2 focus:ring-blue-500 focus:outline-none`;

  const inlineInputClasses = `${compact ? "w-32" : "w-28"} rounded-md border px-2 py-1 text-xs focus:outline-none ${
    isDarkMode
      ? "border-slate-700 bg-slate-900/80 text-slate-100 placeholder:text-slate-500 focus:border-sky-500"
      : "border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-sky-500"
  }`;

  if (variant === "overlay") {
    return (
      <form onSubmit={handleSubmit} className={`space-y-5 ${className ?? ""}`}>
        <div className="relative">
          <span
            className={`absolute left-4 top-1/2 -translate-y-1/2 ${
              isDarkMode ? "text-slate-400" : "text-gray-500"
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35m0 0A7.5 7.5 0 1 0 5.65 5.65a7.5 7.5 0 0 0 10.6 10.6Z" />
            </svg>
          </span>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tickers"
            className={overlayInputClasses}
          />
          <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-2">
            <button
              type="submit"
              className={`rounded-full px-4 py-1 text-sm font-semibold transition-all duration-200 ${
                isDarkMode
                  ? "bg-blue-500/80 text-slate-50 hover:bg-blue-400/90"
                  : "bg-blue-600 text-white hover:bg-blue-500"
              }`}
            >
              Search
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  isDarkMode
                    ? "border-slate-700 bg-slate-800/80 text-slate-200 hover:border-slate-500"
                    : "border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300"
                }`}
                aria-label="Close search overlay"
              >
                Esc
              </button>
            )}
          </div>
        </div>
        {localError && (
          <span className="text-sm text-red-400">{localError}</span>
        )}
        {suggestions && suggestions.length > 0 && (
          <div className={`rounded-2xl border px-5 py-4 ${isDarkMode ? "border-slate-800 bg-slate-900/50" : "border-gray-200 bg-white/60"}`}>
            <p className={`mb-3 text-sm font-semibold ${isDarkMode ? "text-slate-200" : "text-gray-800"}`}>
              Suggested
            </p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {suggestions.map((symbol) => (
                <li key={symbol}>
                  <button
                    type="button"
                    onClick={() => submit(symbol)}
                    className={`group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-colors ${
                      isDarkMode
                        ? "hover:bg-slate-800/80 text-slate-100"
                        : "hover:bg-gray-50 text-gray-800"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-lg ${isDarkMode ? "text-slate-400" : "text-gray-500"}`}>
                        •
                      </span>
                      <div className="leading-tight">
                        <p className="text-sm font-semibold tracking-tight">{symbol}</p>
                        <p className={`text-xs ${isDarkMode ? "text-slate-400" : "text-gray-500"}`}>
                          Open {symbol} overview
                        </p>
                      </div>
                    </div>
                    <span className={`text-lg transition-transform duration-200 group-hover:translate-x-1 ${
                      isDarkMode ? "text-slate-500" : "text-gray-400"
                    }`}>
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
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
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={compact ? "Search ticker…" : "AAPL, MSFT, SPY…"}
          className={inlineInputClasses}
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
