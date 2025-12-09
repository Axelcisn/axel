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
      {/* Apple-style floating bar - centered with rounded corners */}
      <div
        className={`fixed top-0 left-0 right-0 z-[100] flex justify-center pt-3 px-4 transform transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${
          isVisible ? 'translate-y-0 opacity-100' : '-translate-y-[calc(100%+12px)] opacity-0'
        }`}
        style={{ pointerEvents: isVisible ? 'auto' : 'none' }}
      >
        {/* Floating rounded bar - transparent with blur */}
        <div
          className="h-[48px] rounded-full max-w-[720px] w-full px-6 flex items-center justify-between"
          style={{
            backgroundColor: 'transparent',
            backdropFilter: 'saturate(180%) blur(20px)',
            WebkitBackdropFilter: 'saturate(180%) blur(20px)',
            border: isDarkMode ? '1px solid rgba(255, 255, 255, 0.15)' : '1px solid rgba(0, 0, 0, 0.1)',
          }}
        >
          {/* Left: Ticker name - Apple typography */}
          <div className="flex items-center">
            <span
              className="text-[17px] font-semibold tracking-[-0.022em]"
              style={{ color: isDarkMode ? '#f5f5f7' : '#1d1d1f' }}
            >
              {ticker}
            </span>
          </div>

          {/* Right: Price + Search icon */}
          <div className="flex items-center gap-4">
            {/* Price display - larger */}
            {currentPrice != null && (
              <div className="flex items-center gap-3">
                <span
                  className="text-[15px] font-medium"
                  style={{ color: isDarkMode ? '#f5f5f7' : '#1d1d1f' }}
                >
                  ${currentPrice.toFixed(2)}
                </span>
                {priceChange != null && priceChangePercent != null && (
                  <span className={`text-[14px] font-medium ${changeColor}`}>
                    {isPositive ? '+' : ''}{priceChange.toFixed(2)} ({isPositive ? '+' : ''}{priceChangePercent.toFixed(2)}%)
                  </span>
                )}
              </div>
            )}

            {/* Search button - icon only with border */}
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="flex items-center justify-center h-[32px] w-[32px] rounded-full transition-all duration-200"
              style={{
                backgroundColor: 'transparent',
                color: isDarkMode ? '#f5f5f7' : '#1d1d1f',
                border: isDarkMode ? '1px solid rgba(255, 255, 255, 0.25)' : '1px solid rgba(0, 0, 0, 0.15)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = isDarkMode ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.25)';
                e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = isDarkMode ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.15)';
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-[16px] w-[16px]"
              >
                <circle cx="11" cy="11" r="6" />
                <path strokeLinecap="round" d="M21 21l-4.35-4.35" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Search modal - Apple style dropdown attached to sleek bar */}
      {panelMounted && (
        <>
          {/* Backdrop with blur only - no dark overlay */}
          <div
            className={`fixed inset-0 z-[65] transition-opacity duration-300 ${
              isClosing ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
            style={{
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
            }}
            onClick={() => setIsSearchOpen(false)}
          />

          {/* Modal panel - positioned right below the sleek bar */}
          <div
            className={`fixed top-0 left-0 right-0 z-[70] flex justify-center pt-3 px-4 ${
              isClosing ? 'pointer-events-none' : ''
            }`}
          >
            <div
              className={`w-full max-w-[720px] overflow-hidden transform transition-all duration-300 ${
                isClosing
                  ? 'opacity-0 scale-[0.98]'
                  : 'opacity-100 scale-100'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Connected container - sleek bar + search panel */}
              <div
                className="rounded-[24px] overflow-hidden"
                style={{
                  backgroundColor: isDarkMode ? 'rgba(38, 38, 40, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                  border: isDarkMode ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.08)',
                  backdropFilter: 'saturate(180%) blur(20px)',
                  WebkitBackdropFilter: 'saturate(180%) blur(20px)',
                }}
              >
                {/* Top bar - mimics sleek bar */}
                <div className="h-[48px] px-6 flex items-center justify-between border-b"
                  style={{
                    borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
                  }}
                >
                  <span
                    className="text-[17px] font-semibold tracking-[-0.022em]"
                    style={{ color: isDarkMode ? '#f5f5f7' : '#1d1d1f' }}
                  >
                    {ticker}
                  </span>
                  
                  {/* Close button */}
                  <button
                    type="button"
                    onClick={() => setIsSearchOpen(false)}
                    className={`flex h-[28px] w-[28px] items-center justify-center rounded-full transition-colors ${
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
                      strokeWidth="2.5"
                      className="h-3.5 w-3.5"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Search content */}
                <div className="p-5">
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
          </div>
        </>
      )}
    </>
  );
}
