"use client";

import { useRouter } from "next/navigation";
import {
  useState,
  useRef,
  useEffect,
  KeyboardEvent,
  FormEvent,
  useMemo,
  useId,
  useCallback,
} from "react";
import { useSymbolSearch } from "@/lib/hooks/useSymbolSearch";

type Size = "sm" | "md" | "lg" | "xl";
type Appearance = "chatgpt" | "minimal" | "tradingview" | "apple";

interface TickerSearchProps {
  initialSymbol?: string;
  className?: string;
  inputClassName?: string;
  isDarkMode?: boolean;
  autoFocus?: boolean;
  size?: Size;
  appearance?: Appearance;
  showBorder?: boolean;
  showRecentWhenEmpty?: boolean;
  placeholder?: string;
  onSubmitSymbol?: (symbol: string) => void;
  onRequestClose?: () => void;
}

type SearchOption = {
  key: string;
  symbol: string;
  name?: string;
  exchange?: string;
  source: "recent" | "result";
};

const STORAGE_KEY = "axel:lastSearches";

const sizeStyles: Record<
  Size,
  {
    wrapper: string;
    gap: string;
    input: string;
    icon: string;
    clear: string;
  }
> = {
  sm: {
    wrapper: "h-11 px-3 rounded-xl",
    gap: "gap-2",
    input: "text-sm",
    icon: "h-4 w-4",
    clear: "h-8 w-8 text-xs",
  },
  md: {
    wrapper: "h-12 px-4 rounded-xl",
    gap: "gap-3",
    input: "text-base",
    icon: "h-5 w-5",
    clear: "h-9 w-9 text-sm",
  },
  lg: {
    wrapper: "h-[52px] md:h-[56px] px-5 rounded-full",
    gap: "gap-4",
    input: "text-base md:text-lg",
    icon: "h-5 w-5 md:h-6 md:w-6",
    clear: "h-10 w-10 text-base",
  },
  xl: {
    wrapper: "relative w-full py-1",
    gap: "gap-4",
    input: "text-[28px] md:text-[32px] font-semibold tracking-[-0.01em] leading-tight",
    icon: "h-6 w-6 md:h-7 md:w-7",
    clear: "h-7 w-7 text-sm",
  },
};

const APPLE_TEXT_INDENT = "";

function highlight(text: string, query: string, isDarkMode: boolean) {
  if (!query) return text;
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const idx = lower.indexOf(needle);
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return (
    <>
      {before}
      <span className={isDarkMode ? "text-white" : "text-gray-900"}>{match}</span>
      {after}
    </>
  );
}

export function TickerSearch({
  initialSymbol,
  className,
  inputClassName,
  isDarkMode = true,
  autoFocus = false,
  size = "md",
  appearance,
  showBorder = false,
  showRecentWhenEmpty = true,
  placeholder = "Search ticker or company...",
  onSubmitSymbol,
  onRequestClose,
}: TickerSearchProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const blurTimeoutRef = useRef<number | null>(null);
  const listboxId = useId();

  const [value, setValue] = useState(initialSymbol ?? "");
  const [recentTickers, setRecentTickers] = useState<string[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isListOpen, setIsListOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  const { results, isLoading } = useSymbolSearch(value);

  const resolvedAppearance: Appearance = appearance ?? (size === "lg" ? "chatgpt" : "minimal");

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        setRecentTickers(arr as string[]);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const trimmed = value.trim();
  const hasQuery = trimmed.length >= 2;

  const recentOptions: SearchOption[] = useMemo(() => {
    if (!showRecentWhenEmpty || recentTickers.length === 0) return [];
    return recentTickers.slice(0, 10).map((symbol) => ({
      key: `recent-${symbol}`,
      symbol,
      name: "",
      exchange: undefined,
      source: "recent",
    }));
  }, [recentTickers, showRecentWhenEmpty]);

  const resultOptions: SearchOption[] = useMemo(() => {
    if (!hasQuery) return [];
    return results.map((r) => ({
      key: `result-${r.symbol}`,
      symbol: r.symbol,
      name: r.name,
      exchange: r.exchange,
      source: "result",
    }));
  }, [results, hasQuery]);

  const options = useMemo(() => [...recentOptions, ...resultOptions], [recentOptions, resultOptions]);

  const shouldShowRecentSection = showRecentWhenEmpty && !hasQuery && recentOptions.length > 0;
  const shouldShowResultsSection = hasQuery;
  const shouldShowListbox = isListOpen && (shouldShowRecentSection || shouldShowResultsSection);

  useEffect(() => {
    if (!shouldShowListbox || options.length === 0) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex((prev) => {
      if (prev === -1) return 0;
      return Math.min(prev, options.length - 1);
    });
  }, [options, shouldShowListbox]);

  const clearBlurTimeout = () => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  };

  const persistRecent = useCallback((symbol: string) => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      let arr: string[] = raw ? JSON.parse(raw) : [];
      arr = arr.filter((s) => s !== symbol);
      arr.unshift(symbol);
      arr = arr.slice(0, 10);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
      setRecentTickers(arr);
    } catch {
      /* ignore */
    }
  }, []);

  const goToSymbol = useCallback(
    async (option: SearchOption | null, fallbackSymbol?: string) => {
      const symbol = (option?.symbol ?? fallbackSymbol ?? "").trim().toUpperCase();
      if (!symbol) {
        setLocalError("Please enter a ticker symbol.");
        return;
      }
      setLocalError(null);
      persistRecent(symbol);

      if (option?.source === "result") {
        try {
          await fetch("/api/companies", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ticker: option.symbol,
              name: option.name,
              exchange: option.exchange,
            }),
          });
        } catch (err) {
          if (process.env.NODE_ENV === "development") {
            console.warn("[TickerSearch] failed to upsert company", err);
          }
        }
      }

      if (onSubmitSymbol) {
        onSubmitSymbol(symbol);
      } else {
        router.push(`/company/${encodeURIComponent(symbol)}/timing`);
      }
      onRequestClose?.();
    },
    [onSubmitSymbol, onRequestClose, persistRecent, router],
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const option = activeIndex >= 0 ? options[activeIndex] ?? null : null;
    void goToSymbol(option, value);
    setIsListOpen(false);
  };

  const handleOptionSelect = (option: SearchOption) => {
    setValue(option.symbol);
    setIsListOpen(false);
    setActiveIndex(-1);
    void goToSymbol(option);
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!shouldShowListbox || options.length === 0) {
        setIsListOpen(true);
        return;
      }
      setActiveIndex((prev) => {
        const next = prev + 1;
        if (next >= options.length) return 0;
        return next;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!shouldShowListbox || options.length === 0) {
        setIsListOpen(true);
        return;
      }
      setActiveIndex((prev) => {
        if (prev <= 0) return options.length - 1;
        return prev - 1;
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const option = activeIndex >= 0 ? options[activeIndex] ?? null : null;
      void goToSymbol(option, value);
      setIsListOpen(false);
    } else if (e.key === "Escape") {
      setIsListOpen(false);
      setActiveIndex(-1);
      onRequestClose?.();
    } else if (e.key === "Tab") {
      setIsListOpen(false);
      setActiveIndex(-1);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
    setIsListOpen(true);
  };

  const handleFocus = () => {
    clearBlurTimeout();
    setIsFocused(true);
    setIsListOpen(true);
  };

  const handleBlur = () => {
    clearBlurTimeout();
    blurTimeoutRef.current = window.setTimeout(() => {
      setIsFocused(false);
      setIsListOpen(false);
      setActiveIndex(-1);
    }, 120);
  };

  const handleClear = () => {
    setValue("");
    setIsListOpen(true);
    setActiveIndex(-1);
  };

  const styles = sizeStyles[size];
  const wrapperTone =
    resolvedAppearance === "chatgpt"
      ? isDarkMode
        ? "bg-white/5 text-slate-100 border border-white/10 focus-within:ring-2 focus-within:ring-white/20 focus-within:border-white/20"
        : "bg-white text-gray-900 border border-gray-200 focus-within:ring-2 focus-within:ring-gray-200/70 focus-within:border-gray-300"
    : resolvedAppearance === "apple"
      ? "bg-transparent text-white border-0"
      : resolvedAppearance === "tradingview"
        ? isDarkMode
          ? "bg-transparent text-slate-100 border border-white/12 focus-within:ring-2 focus-within:ring-white/10 focus-within:border-white/20"
          : "bg-transparent text-gray-900 border border-gray-300 focus-within:ring-2 focus-within:ring-gray-200/70 focus-within:border-gray-400"
        : isDarkMode
          ? "bg-slate-900/70 text-slate-100 border border-white/10 focus-within:ring-2 focus-within:ring-white/20 focus-within:border-white/20"
          : "bg-white/95 text-gray-900 border border-gray-200/80 focus-within:ring-2 focus-within:ring-gray-300/60 focus-within:border-gray-300";
  const borderOverride =
    showBorder && resolvedAppearance === "minimal"
      ? isDarkMode
        ? "border-white/20"
        : "border-gray-300"
      : "";
  const inputColor =
    resolvedAppearance === "apple"
      ? isDarkMode
        ? "placeholder:text-[#86868b] text-white"
        : "placeholder:text-gray-500 text-gray-900"
      : isDarkMode
        ? "placeholder:text-slate-500"
        : "placeholder:text-gray-400";
  const appleInputClasses =
    `text-[28px] md:text-[32px] font-semibold tracking-[-0.01em] leading-tight bg-transparent outline-none text-white placeholder:text-[#86868b]`;
  const baseInputClasses =
    resolvedAppearance === "apple"
      ? appleInputClasses
      : `bg-transparent outline-none ${styles.input} ${inputColor}`;
  const listboxTone =
    resolvedAppearance === "chatgpt"
      ? isDarkMode
        ? "border-white/10 bg-white/[0.04] shadow-[0_20px_80px_rgba(0,0,0,0.55)]"
        : "border-gray-200 bg-white shadow-[0_20px_80px_rgba(15,23,42,0.14)]"
      : resolvedAppearance === "apple"
        ? isDarkMode
          ? "border-white/10 bg-black/30 shadow-[0_12px_40px_rgba(0,0,0,0.5)]"
          : "border-gray-200 bg-white shadow-[0_12px_40px_rgba(15,23,42,0.16)]"
      : resolvedAppearance === "tradingview"
        ? isDarkMode
          ? "border-white/10 bg-[#141417]/90 shadow-[0_16px_60px_rgba(0,0,0,0.65)]"
          : "border-gray-200 bg-white shadow-[0_16px_60px_rgba(15,23,42,0.18)]"
        : isDarkMode
          ? "border-white/10 bg-[#0c0f16]/95 shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
          : "border-gray-200 bg-white/95 shadow-[0_18px_40px_rgba(15,23,42,0.12)]";
  const headerColor = isDarkMode ? "text-slate-500" : "text-gray-500";
  const optionBase = isDarkMode
    ? "text-slate-100 hover:bg-white/10"
    : "text-gray-900 hover:bg-gray-50";

  const activeDescendant =
    shouldShowListbox && activeIndex >= 0 && options[activeIndex]
      ? `${listboxId}-option-${options[activeIndex].key}`
      : undefined;

  return (
    <div className={`relative ${className ?? ""}`}>
      <form onSubmit={handleSubmit}>
        <div
          className={`flex w-full items-center ${styles.gap} ${styles.wrapper} ${wrapperTone} ${borderOverride} transition-colors`}
        >
          {resolvedAppearance === "apple" ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-6 w-6 md:h-7 md:w-7 flex-shrink-0 text-[#86868b]"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
              <circle cx="11" cy="11" r="6" />
            </svg>
          ) : (
            <span
              className={`flex items-center justify-center text-slate-500 ${isDarkMode ? "text-white/30" : "text-gray-500"}`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={styles.icon}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
                <circle cx="11" cy="11" r="6" />
              </svg>
            </span>
          )}
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onFocus={handleFocus}
            onBlur={handleBlur}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={shouldShowListbox}
          aria-controls={shouldShowListbox ? listboxId : undefined}
          aria-activedescendant={activeDescendant}
          role="combobox"
          placeholder={placeholder}
          className={`flex-1 ${baseInputClasses} ${inputClassName ?? ""}`}
        />
          {value && resolvedAppearance !== "apple" && (
            <button
              type="button"
              onClick={handleClear}
              className={`inline-flex items-center justify-center flex-shrink-0 transition-colors focus-visible:outline-none ${styles.clear} ${isDarkMode
                  ? "text-slate-400 hover:text-white hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-sky-500"
                  : "text-gray-500 hover:text-gray-900 hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-sky-500"
                }`}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
        {localError && (
          <p className="text-sm text-red-400 mt-2">{localError}</p>
        )}
      </form>

      {resolvedAppearance === "apple" ? (
        <div className="mt-8">
          {!hasQuery && recentTickers.length > 0 && (
            <div className="space-y-4">
              <p className="text-[12px] font-normal text-[#86868b] tracking-normal">
                Last searched
              </p>
              <div className="space-y-2">
                {recentTickers.slice(0, 5).map((symbol, idx) => (
                  <button
                    key={`recent-${symbol}`}
                    type="button"
                    onClick={() => {
                      setValue(symbol);
                      void goToSymbol({ key: `recent-${symbol}`, symbol, source: "recent" });
                    }}
                    className="group flex w-full items-center gap-3 py-1 text-[14px] font-semibold text-white hover:text-[#2997ff] transition-colors text-left"
                  >
                    <span className="text-[#86868b] group-hover:text-[#2997ff] transition-colors">→</span>
                    <span>{symbol}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasQuery && shouldShowListbox && (
            <div
              role="listbox"
              id={listboxId}
              aria-label="Search suggestions"
              className="mt-8 space-y-2"
            >
              {isLoading && (
                <div className="py-2 text-[14px] text-[#86868b]">
                  Searching…
                </div>
              )}
              {!isLoading && resultOptions.length === 0 && hasQuery && (
                <div className="py-2 text-[14px] text-[#86868b]">
                  No results found.
                </div>
              )}
              {resultOptions.map((option, idx) => {
                const globalIndex = recentOptions.length + idx;
                const isActive = activeIndex === globalIndex;
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="option"
                    id={`${listboxId}-option-${option.key}`}
                    aria-selected={isActive}
                    onMouseEnter={() => setActiveIndex(globalIndex)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleOptionSelect(option);
                    }}
                    className={`group flex w-full items-center gap-3 py-1 text-left cursor-pointer focus-visible:outline-none text-[14px] font-semibold transition-colors ${
                      isActive ? "text-[#2997ff]" : "text-white hover:text-[#2997ff]"
                    }`}
                  >
                    <span className={`transition-colors ${isActive ? "text-[#2997ff]" : "text-[#86868b] group-hover:text-[#2997ff]"}`}>→</span>
                    <span>
                      <span className="font-semibold">
                        {highlight(option.symbol, trimmed, isDarkMode)}
                      </span>
                      <span className="text-[#86868b] font-normal"> — </span>
                      <span className="text-[#86868b] font-normal">
                        {option.name || option.symbol}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : shouldShowListbox && (
        <div
          role="listbox"
          id={listboxId}
          aria-label="Search suggestions"
          className={`absolute left-0 right-0 ${resolvedAppearance === "chatgpt" ? "mt-3" : "mt-3"} ${
            resolvedAppearance === "tradingview" ? "z-[200]" : ""
          } max-h-80 overflow-auto rounded-2xl border ${listboxTone} backdrop-blur-xl`}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div
            className={`space-y-2 ${
              resolvedAppearance === "chatgpt"
                ? "py-2"
                : resolvedAppearance === "tradingview"
                  ? "py-1"
                  : "px-3 py-3 md:px-4 md:py-4"
            }`}
          >
            {shouldShowRecentSection && (
              <div className={`${resolvedAppearance === "chatgpt" ? "px-2" : "px-0"} space-y-1`}>
                <p className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${headerColor}`}>
                  Recent
                </p>
                <div className="space-y-1">
                  {recentOptions.map((option, idx) => {
                    const globalIndex = idx;
                    const isActive = activeIndex === globalIndex;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        role="option"
                        id={`${listboxId}-option-${option.key}`}
                        aria-selected={isActive}
                        onMouseEnter={() => setActiveIndex(globalIndex)}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleOptionSelect(option);
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                          isActive
                            ? "bg-white/8"
                            : "hover:bg-white/[0.05]"
                        }`}
                      >
                        <span className="h-9 min-w-9 px-2 rounded-full bg-white/[0.08] border border-white/10 flex items-center justify-center text-[13px] font-semibold text-slate-100">
                          {option.symbol}
                        </span>
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-slate-100">{option.symbol}</span>
                          <span className="text-xs text-slate-400">Recent search</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {shouldShowResultsSection && (
              <div className={`${resolvedAppearance === "chatgpt" ? "px-2" : resolvedAppearance === "tradingview" ? "" : "space-y-1.5"}`}>
                {resolvedAppearance !== "chatgpt" && resolvedAppearance !== "tradingview" && (
                  <p className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${headerColor}`}>
                    Results
                  </p>
                )}
                {isLoading && (
                  <div className={`px-4 py-3 text-sm ${isDarkMode ? "text-slate-300" : "text-gray-700"}`}>
                    Loading…
                  </div>
                )}
                {!isLoading && resultOptions.length === 0 && hasQuery && (
                  <div className={`px-4 py-3 text-sm ${isDarkMode ? "text-slate-400" : "text-gray-600"}`}>
                    No matches found.
                  </div>
                )}
                <div
                  className={`${
                    resolvedAppearance === "tradingview"
                      ? "divide-y divide-white/10 max-h-[460px] overflow-y-auto tv-scroll"
                      : "space-y-1"
                  }`}
                >
                  {resultOptions.map((option, idx) => {
                    const globalIndex = recentOptions.length + idx;
                    const isActive = activeIndex === globalIndex;
                    const baseRow =
                      resolvedAppearance === "tradingview"
                        ? `w-full grid grid-cols-[40px_88px_1fr_110px_28px] items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer focus-visible:outline-none`
                        : `w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                            isActive ? "bg-white/[0.07]" : "hover:bg-white/[0.05]"
                          }`;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        role="option"
                        id={`${listboxId}-option-${option.key}`}
                        aria-selected={isActive}
                        onMouseEnter={() => setActiveIndex(globalIndex)}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleOptionSelect(option);
                        }}
                        className={`${baseRow} group`}
                      >
                        {resolvedAppearance === "tradingview" ? (
                          <>
                            <span className="h-9 w-9 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center text-[12px] font-semibold text-slate-100">
                              {(option.symbol || "?").slice(0, 1)}
                            </span>
                            <span className="text-sm font-semibold tracking-wide text-slate-100 uppercase">
                              {highlight(option.symbol, trimmed, isDarkMode)}
                            </span>
                            <span className="text-sm text-slate-300 truncate">
                              {highlight(option.name || option.symbol, trimmed, isDarkMode)}
                            </span>
                            <span className="text-xs text-slate-400 uppercase tracking-wide text-right">
                              {(option.exchange || "").toUpperCase()}
                            </span>
                            <span
                              className={`flex items-center justify-end text-slate-300 transition-opacity ${
                                isActive ? "opacity-80" : "opacity-0 group-hover:opacity-60"
                              }`}
                              aria-hidden="true"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                className="h-4 w-4"
                              >
                                <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="h-9 min-w-9 px-2 rounded-full bg-white/[0.08] border border-white/10 flex items-center justify-center text-[13px] font-semibold text-slate-100">
                              {highlight(option.symbol, trimmed, isDarkMode)}
                            </span>
                            <div className="flex flex-col min-w-0">
                              <span className="text-sm font-semibold text-slate-100">
                                {highlight(option.name || option.symbol, trimmed, isDarkMode)}
                              </span>
                              {option.name && (
                                <span className="text-xs text-slate-400 truncate">
                                  {option.exchange ? `${option.exchange} • ` : ""}{option.name}
                                </span>
                              )}
                            </div>
                            {isActive && (
                              <span className="ml-auto text-[11px] uppercase tracking-wide text-slate-400">
                                Enter
                              </span>
                            )}
                          </>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
