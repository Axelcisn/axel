'use client';

import { useState, useEffect } from 'react';
import { useDarkMode } from '@/lib/hooks/useDarkMode';

interface StickyTickerBarProps {
  ticker: string;
  companyName?: string;
  currentPrice?: number;
  priceChange?: number;
  priceChangePercent?: number;
}

/**
 * Apple-style sticky navigation bar that appears after scrolling past 50vh.
 * Displays ticker, price, and change info in a sleek floating pill.
 */
export function StickyTickerBar({
  ticker,
  currentPrice,
  priceChange,
  priceChangePercent,
}: StickyTickerBarProps) {
  const isDarkMode = useDarkMode();
  const [isVisible, setIsVisible] = useState(false);

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

  // Format price change
  const isPositive = (priceChange ?? 0) >= 0;
  const changeColor = isPositive ? 'text-emerald-400' : 'text-rose-400';

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[100] flex justify-center pt-3 px-4 transform transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${
        isVisible ? 'translate-y-0 opacity-100' : '-translate-y-[calc(100%+12px)] opacity-0'
      }`}
      style={{ pointerEvents: isVisible ? 'auto' : 'none' }}
    >
      {/* Floating rounded bar - very dark background */}
      <div
        className="h-[48px] rounded-full max-w-[720px] w-full px-6 flex items-center justify-between"
        style={{
          backgroundColor: isDarkMode ? 'rgba(28, 28, 30, 0.95)' : 'rgba(250, 250, 252, 0.95)',
          backdropFilter: 'saturate(180%) blur(20px)',
          WebkitBackdropFilter: 'saturate(180%) blur(20px)',
          border: isDarkMode ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(0, 0, 0, 0.1)',
        }}
      >
        {/* Left: Ticker name */}
        <div className="flex items-center">
          <span
            className="text-[17px] font-semibold tracking-[-0.022em]"
            style={{ color: isDarkMode ? '#f5f5f7' : '#1d1d1f' }}
          >
            {ticker}
          </span>
        </div>

        {/* Right: Price display */}
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
      </div>
    </div>
  );
}
