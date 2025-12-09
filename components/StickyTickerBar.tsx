'use client';

import { useState, useEffect, useRef } from 'react';
import { useDarkMode } from '@/lib/hooks/useDarkMode';
import { TickerSearch } from '@/components/TickerSearch';

interface StickyTickerBarProps {
  ticker: string;
  companyName?: string;
  currentPrice?: number;
  priceChange?: number;
  priceChangePercent?: number;
}

/**
 * Apple-style sticky navigation bar that appears after scrolling past 50vh.
 * Features a search button that opens a modal similar to Apple's "Explore" menu.
 */
export function StickyTickerBar({
  ticker,
  companyName,
  currentPrice,
  priceChange,
  priceChangePercent,
}: StickyTickerBarProps) {
  const isDarkMode = useDarkMode();
  const [isVisible, setIsVisible] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const CLOSE_ANIM_MS = 280;

  // Track scroll position to show/hide bar - show after 50vh
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const viewportHeight = window.innerHeight;
      // Show bar after scrolling past 50vh
      setIsVisible(scrollY > viewportHeight * 0.5);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Check initial position

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Handle escape key to close search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsSearchOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Mount the panel when requested
  useEffect(() => {
    if (isSearchOpen) {
      setPanelMounted(true);
      setIsClosing(false);
    }
  }, [isSearchOpen]);

  // When closing, keep panel mounted long enough for exit animation
  useEffect(() => {
    if (!isSearchOpen && panelMounted) {
      setIsClosing(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      const id = window.setTimeout(() => {
        setPanelMounted(false);
        setIsClosing(false);
        timeoutRef.current = null;
      }, CLOSE_ANIM_MS);
      timeoutRef.current = id;
      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      };
    }
    return;
  }, [isSearchOpen, panelMounted]);

  // Format price change
  const isPositive = (priceChange ?? 0) >= 0;
  const changeColor = isPositive ? 'text-emerald-400' : 'text-rose-400';

  return (
    <>
      {/* Apple-style sticky bar - slides in from top */}
      <div
        className={`fixed top-0 left-0 right-0 z-[100] transform transition-transform duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${
          isVisible ? 'translate-y-0' : '-translate-y-full'
        }`}
        style={{ pointerEvents: isVisible ? 'auto' : 'none' }}
      >
        {/* Apple-style bar with exact styling */}
        <div
          className="h-[44px]"
          style={{
            backgroundColor: isDarkMode ? 'rgba(29, 29, 31, 0.94)' : 'rgba(255, 255, 255, 0.94)',
            backdropFilter: 'saturate(180%) blur(20px)',
            WebkitBackdropFilter: 'saturate(180%) blur(20px)',
            borderBottom: isDarkMode ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid rgba(0, 0, 0, 0.1)',
          }}
        >
          <div className="mx-auto max-w-[980px] h-full px-[22px]">
            <div className="flex items-center justify-between h-full">
              {/* Left: Ticker name - Apple typography */}
              <div className="flex items-center">
                <span
                  className="text-[17px] font-semibold tracking-[-0.022em]"
                  style={{ color: isDarkMode ? '#f5f5f7' : '#1d1d1f' }}
                >
                  {ticker}
                </span>
              </div>

              {/* Right: Price + Buttons */}
              <div className="flex items-center gap-3">
                {/* Price display */}
                {currentPrice != null && (
                  <div className="flex items-center gap-2 mr-2">
                    <span
                      className="text-[12px] font-normal"
                      style={{ color: isDarkMode ? '#86868b' : '#6e6e73' }}
                    >
                      ${currentPrice.toFixed(2)}
                    </span>
                    {priceChange != null && priceChangePercent != null && (
                      <span className={`text-[12px] font-normal ${changeColor}`}>
                        {isPositive ? '+' : ''}{priceChange.toFixed(2)} ({isPositive ? '+' : ''}{priceChangePercent.toFixed(2)}%)
                      </span>
                    )}
                  </div>
                )}

                {/* Search button - Apple "Explore" style */}
                <button
                  type="button"
                  onClick={() => setIsSearchOpen(true)}
                  className="flex items-center justify-center h-[28px] px-[14px] rounded-full text-[12px] font-normal transition-all duration-200"
                  style={{
                    backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
                    color: isDarkMode ? '#f5f5f7' : '#1d1d1f',
                    border: 'none',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)';
                  }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="h-[14px] w-[14px] mr-1.5"
                  >
                    <circle cx="11" cy="11" r="6" />
                    <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
                  </svg>
                  Search
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Search modal - Apple style dropdown */}
      {panelMounted && (
        <>
          {/* Backdrop with blur */}
          <div
            className={`fixed inset-0 z-[65] bg-black/60 supports-[backdrop-filter]:backdrop-blur-2xl transition-opacity duration-300 ${
              isClosing ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
            onClick={() => setIsSearchOpen(false)}
          />

          {/* Modal panel - centered Apple style */}
          <div
            className={`fixed inset-0 z-[70] flex items-start justify-center pt-[10vh] px-4 ${
              isClosing ? 'pointer-events-none' : ''
            }`}
          >
            <div
              className={`w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden transform transition-all duration-300 ${
                isClosing
                  ? 'opacity-0 scale-95 -translate-y-4'
                  : 'opacity-100 scale-100 translate-y-0'
              } ${
                isDarkMode
                  ? 'bg-[#1d1d1f] border-white/10'
                  : 'bg-white border-gray-200'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <div className="absolute top-3 right-3">
                <button
                  type="button"
                  onClick={() => setIsSearchOpen(false)}
                  className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                    isDarkMode
                      ? 'bg-white/10 text-white/80 hover:bg-white/20'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="h-4 w-4"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Search content */}
              <div className="p-6">
                <TickerSearch
                  initialSymbol={ticker}
                  isDarkMode={isDarkMode}
                  compact={false}
                  autoFocus={true}
                  variant="panel"
                  className="w-full"
                />
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
