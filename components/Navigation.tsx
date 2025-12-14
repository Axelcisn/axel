'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDarkMode } from '@/lib/hooks/useDarkMode';
import { TickerSearch } from '@/components/TickerSearch';
import LayoutContainer from './LayoutContainer';

const SEARCH_PANEL_ID = 'global-search-panel';
const APPLE_NAV_BG = 'bg-[#0D0D0D]';
const APPLE_SURFACE = `${APPLE_NAV_BG} border-b border-white/[0.08]`;

const navItems = [
  { href: '/', label: 'Home' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/memory', label: 'Memory' },
  { href: '/watchlist', label: 'Watchlist' },
];

export default function Navigation() {
  const pathname = usePathname();
  const isDarkMode = useDarkMode();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchAreaRef = useRef<HTMLDivElement>(null);

  const linkBase =
    'text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded-full px-3 py-1';

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimeout();
    closeTimeoutRef.current = setTimeout(() => {
      setIsSearchOpen(false);
    }, 300);
  }, [clearCloseTimeout]);

  const handleMouseEnterSearchArea = useCallback(() => {
    clearCloseTimeout();
  }, [clearCloseTimeout]);

  const handleMouseLeaveSearchArea = useCallback(() => {
    scheduleClose();
  }, [scheduleClose]);

  useEffect(() => {
    if (!isSearchOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSearchOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearCloseTimeout();
    };
  }, [isSearchOpen, clearCloseTimeout]);

  const closeSearch = () => {
    clearCloseTimeout();
    setIsSearchOpen(false);
  };

  return (
    <nav 
      className={`relative z-[130] ${APPLE_SURFACE}`}
      onMouseEnter={isSearchOpen ? handleMouseEnterSearchArea : undefined}
      onMouseLeave={isSearchOpen ? handleMouseLeaveSearchArea : undefined}
    >
      <LayoutContainer>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center h-14 gap-4">
          <div className="flex items-center">
            <Link
              href="/"
              className={`text-[17px] font-semibold tracking-tight ${
                isDarkMode ? 'text-white' : 'text-gray-900'
              }`}
            >
              Momentum
            </Link>
          </div>

          <div className="flex items-center justify-center gap-8">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== '/' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${linkBase} ${
                    isActive
                      ? isDarkMode
                        ? 'text-white'
                        : 'text-gray-900'
                      : isDarkMode
                        ? 'text-slate-200/80 hover:text-white'
                        : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              aria-label="Open search"
              aria-expanded={isSearchOpen}
              aria-controls={SEARCH_PANEL_ID}
              onClick={() => setIsSearchOpen(true)}
              className={`flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
                isDarkMode
                  ? 'border-white/10 bg-white/5 text-slate-200 hover:bg-white/10'
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-[18px] w-[18px]"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
                <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="2" fill="none" />
              </svg>
            </button>
          </div>
        </div>
      </LayoutContainer>

      {isSearchOpen && (
        <>
          {/* Top section - solid dark background with search */}
          <div
            ref={searchAreaRef}
            id={SEARCH_PANEL_ID}
            role="dialog"
            aria-modal="true"
            className="fixed left-0 right-0 top-14 z-[200] bg-[#0D0D0D] border-b border-white/[0.08] animate-in fade-in slide-in-from-top-2 duration-200 h-[360px]"
            onMouseEnter={handleMouseEnterSearchArea}
            onMouseLeave={handleMouseLeaveSearchArea}
          >
            <LayoutContainer>
              <div className="max-w-[600px] py-8">
                <TickerSearch
                  isDarkMode={isDarkMode}
                  autoFocus
                  size="xl"
                  appearance="apple"
                  showRecentWhenEmpty
                  placeholder="Search"
                  onRequestClose={closeSearch}
                />
              </div>
            </LayoutContainer>
          </div>

          {/* Bottom section - blurred transparent overlay */}
          <div
            className="fixed left-0 right-0 bottom-0 z-[199] bg-black/40 backdrop-blur-md animate-in fade-in duration-200"
            style={{ top: 'calc(56px + 360px)' }}
            onMouseDown={closeSearch}
          />
        </>
      )}
    </nav>
  );
}
