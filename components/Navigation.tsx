'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDarkMode } from '@/lib/hooks/useDarkMode';
import { TickerSearch } from '@/components/TickerSearch';

export default function Navigation() {
  const pathname = usePathname();
  const isDarkMode = useDarkMode();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [lastSearches, setLastSearches] = useState<string[]>([]);

  // Panel mount / close animation states
  const [panelMounted, setPanelMounted] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isHoveringPanel, setIsHoveringPanel] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const hoverTimeoutRef = useRef<number | null>(null);
  const CLOSE_ANIM_MS = 220; // should match .animate-slideUpFade duration
  const HOVER_CLOSE_MS = 220; // delay after mouse leaves panel before closing

  const navItems = [
    { href: '/', label: 'Home' },
    { href: '/analysis', label: 'Analysis' },
    { href: '/memory', label: 'Memory' },
    { href: '/watchlist', label: 'Watchlist' },
  ];

  // Extract current ticker from pathname if on a company page
  const tickerMatch = pathname.match(/\/company\/([^/]+)/);
  const currentTicker = tickerMatch ? tickerMatch[1] : undefined;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsSearchOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!isSearchOpen) return;
    try {
      const raw = localStorage.getItem('axel:lastSearches');
      const arr: string[] = raw ? JSON.parse(raw) : [];
      setLastSearches(arr);
    } catch (e) {
      setLastSearches([]);
    }
  }, [isSearchOpen]);

  // Mount the panel when requested
  useEffect(() => {
    if (isSearchOpen) {
      // ensure panel is mounted and not in closing state
      setPanelMounted(true);
      setIsClosing(false);
    }
  }, [isSearchOpen]);

  // When closing, keep panel mounted long enough for exit animation
  useEffect(() => {
    if (!isSearchOpen && panelMounted) {
      setIsClosing(true);
      // clear any existing timeout
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
        if (hoverTimeoutRef.current) {
          clearTimeout(hoverTimeoutRef.current);
          hoverTimeoutRef.current = null;
        }
      };
    }
    return;
  }, [isSearchOpen, panelMounted]);

  // ensure hover timeout is cleared on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
    };
  }, []);

  // Blur underlying page content while search is open
  useEffect(() => {
    const body = document.body;
    if (!body) return;
    if (isSearchOpen) {
      body.classList.add('search-blur');
    } else {
      body.classList.remove('search-blur');
    }
    return () => body.classList.remove('search-blur');
  }, [isSearchOpen]);

  const containerClass = 'mx-auto w-full max-w-[1400px] px-6 md:px-10';

  return (
    <nav
      className={`sticky top-0 z-50 border-b backdrop-blur-xl transition-colors ${
        isDarkMode
          ? 'bg-[#0f0f0f]/95 border-white/10'
          : 'bg-white/95 border-gray-200'
      }`}
    >
      <div className={containerClass}>
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
                  className={`text-[13px] font-medium transition-colors ${
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
      </div>

      {/* Search panel - appears when search icon is clicked */}
      {panelMounted && (
        <>
          {/* Backdrop with blur, starts below navbar so navbar remains visible */}
          <div
            className={`fixed inset-x-0 top-14 bottom-0 z-40 bg-black/65 supports-[backdrop-filter]:backdrop-blur-[22px] supports-[backdrop-filter]:backdrop-saturate-150 transition-opacity duration-[420ms] ${
              isClosing ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
            onClick={() => setIsSearchOpen(false)}
            onMouseEnter={() => {
              // If the pointer moves into the backdrop and the panel is not hovered,
              // close the search panel immediately as a fallback.
              if (!isHoveringPanel) setIsSearchOpen(false);
            }}
          />

          <div
            className={`fixed inset-x-0 top-14 z-50 ${
              isClosing ? 'animate-slideUpFade' : 'animate-slideDownFade'
            } border-b ${isDarkMode ? 'bg-[#0f0f0f]/95 border-white/10' : 'bg-white/95 border-gray-200'} backdrop-blur-xl shadow-2xl`}
            onMouseEnter={() => {
              // Cancel any pending close when user re-enters the panel
              if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
                hoverTimeoutRef.current = null;
              }
              setIsHoveringPanel(true);
            }}
            onMouseLeave={() => {
              setIsHoveringPanel(false);
              // schedule a close after a small delay so quick mouse passes don't immediately close
              if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
                hoverTimeoutRef.current = null;
              }
              hoverTimeoutRef.current = window.setTimeout(() => {
                hoverTimeoutRef.current = null;
                setIsSearchOpen(false);
              }, HOVER_CLOSE_MS);
            }}
          >
            <div className={`${containerClass} py-10 md:py-12`}>
              <div className="max-w-4xl space-y-8">
                <div className="flex items-center gap-4 text-4xl md:text-[42px]">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    className={`h-9 w-9 ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
                    <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.6" fill="none" />
                  </svg>
                  <div className="flex-1">
                    <TickerSearch
                      initialSymbol={currentTicker}
                      isDarkMode={isDarkMode}
                      compact={false}
                      autoFocus={true}
                      variant="panel"
                      className="w-full"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  {/* Show 'Suggested' with static picks when no recent searches, otherwise 'Last searched' */}
                  <h3
                    className={`text-sm font-semibold ${
                      isDarkMode ? 'text-slate-400' : 'text-gray-600'
                    }`}
                  >
                    {lastSearches.length === 0 ? 'Suggested' : 'Last searched'}
                  </h3>
                  <ul className="space-y-3">
                    {(lastSearches.length === 0 ? ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'TSLA'] : lastSearches).map((s) => (
                      <li key={s}>
                        <Link
                          href={`/company/${encodeURIComponent(s)}/timing`}
                          className={`flex items-center gap-3 py-1.5 text-[17px] font-semibold ${
                            isDarkMode ? 'text-slate-100 hover:text-white' : 'text-gray-800 hover:text-gray-900'
                          }`}
                          onClick={() => setIsSearchOpen(false)}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.3}
                            className="h-[18px] w-[18px] text-slate-400"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5l7 7-7 7" />
                          </svg>
                          <span className="leading-none">{s}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
