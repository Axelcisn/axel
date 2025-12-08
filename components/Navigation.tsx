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

  return (
    <nav className={`shadow-sm app-bg ${!isSearchOpen ? 'border-b app-border' : ''}`}>
      <div className="w-full px-[5%]">
        <div className="flex justify-between items-center h-12">
          <div className="flex items-center gap-6">
            <Link href="/" className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              Momentum
            </Link>
          </div>

          <div className="flex items-center space-x-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`text-sm font-medium transition-colors hover:text-blue-500 ${
                  pathname === item.href
                    ? 'text-blue-500 border-b-2 border-blue-500 pb-1'
                    : isDarkMode ? 'text-gray-300' : 'text-gray-600'
                }`}
              >
                {item.label}
              </Link>
            ))}

            {/* Search icon placed to the right of Watchlist */}
            <button
              type="button"
              aria-label="Open search"
              onClick={() => setIsSearchOpen(true)}
              className={`ml-4 rounded-full p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                isDarkMode ? 'text-gray-300 hover:bg-slate-800/60 focus:ring-slate-600' : 'text-gray-700 hover:bg-gray-100 focus:ring-blue-300'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
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
            className={`fixed inset-x-0 top-12 bottom-0 z-40 bg-black/20 backdrop-blur-sm transition-opacity duration-300 ${isClosing ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
            onClick={() => setIsSearchOpen(false)}
            onMouseEnter={() => {
              // If the pointer moves into the backdrop and the panel is not hovered,
              // close the search panel immediately as a fallback.
              if (!isHoveringPanel) setIsSearchOpen(false);
            }}
          />

          <div
            className={`fixed inset-x-0 top-12 z-50 ${isClosing ? 'animate-slideUpFade' : 'animate-slideDownFade'} app-bg border-b app-border`}
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
            <div className="w-full px-[5%] py-3">
                <div className="max-w-6xl">
                  <div className="grid grid-cols-12 gap-4 items-start">
                  {/* Main left area: search box on top, last searched below */}
                  <div className="col-span-9">
                      <div className="mb-3">
                        <div className="flex items-center gap-3 mb-4 text-3xl md:text-4xl">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={`w-[1em] h-[1em] ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
                            <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
                          </svg>
                          <div className="flex-1">
                            <TickerSearch initialSymbol={currentTicker} isDarkMode={isDarkMode} compact={false} autoFocus={true} variant="panel" className="w-full" />
                          </div>
                        </div>
                      </div>
                    <div className="mt-3">
                      {/* Show 'Suggested' with static picks when no recent searches, otherwise 'Last searched' */}
                      <h3 className={`text-sm font-medium mb-3 ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>{lastSearches.length === 0 ? 'Suggested' : 'Last searched'}</h3>
                      <ul className="space-y-3">
                        { (lastSearches.length === 0 ? ['AAPL','MSFT','AMZN','GOOGL','TSLA'] : lastSearches).map((s) => (
                          <li key={s}>
                            <Link
                              href={`/company/${encodeURIComponent(s)}/timing`}
                              className={`flex items-center gap-2 py-1.5 text-sm ${isDarkMode ? 'text-slate-200 hover:text-white' : 'text-gray-800 hover:text-gray-900'}`}
                              onClick={() => setIsSearchOpen(false)}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.2} className="w-4 h-4 text-slate-400">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 5l7 7-7 7" />
                              </svg>
                              <span className="font-medium leading-none">{s}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Right area: (intentionally left blank — close button removed) */}
                  <div className="col-span-3" />
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </nav>
  );
}