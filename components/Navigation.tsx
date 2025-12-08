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
  const CLOSE_ANIM_MS = 360; // should match .animate-searchPanelExit duration
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
    <nav
      className={`shadow-sm app-bg transition-all duration-300 ${
        !isSearchOpen
          ? 'border-b app-border'
          : `border-b ${isDarkMode ? 'border-white/10' : 'border-gray-200/80'} supports-[backdrop-filter]:backdrop-blur-md`
      }`}
    >
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

      {panelMounted && (
        <>
          <div
            className={`fixed inset-0 z-40 bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(139,92,246,0.08),transparent_30%)] ${
              isDarkMode ? 'bg-black/70' : 'bg-slate-900/60'
            } backdrop-blur-[18px] transition-opacity duration-500 ${
              isClosing ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
            onClick={() => setIsSearchOpen(false)}
            onMouseEnter={() => {
              if (!isHoveringPanel) setIsSearchOpen(false);
            }}
          />

          <div className="fixed inset-0 z-50 flex justify-center px-[5%] pt-16 pb-12 pointer-events-none">
            <div
              className={`w-full max-w-5xl pointer-events-auto rounded-3xl border app-border ${
                isDarkMode ? 'bg-slate-950/70' : 'bg-white/80'
              } shadow-2xl shadow-black/25 backdrop-blur-2xl ring-1 ring-white/5 transition-transform duration-500 ${
                isClosing ? 'animate-searchPanelExit' : 'animate-searchPanelEnter'
              }`}
              onMouseEnter={() => {
                if (hoverTimeoutRef.current) {
                  clearTimeout(hoverTimeoutRef.current);
                  hoverTimeoutRef.current = null;
                }
                setIsHoveringPanel(true);
              }}
              onMouseLeave={() => {
                setIsHoveringPanel(false);
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
              <div
                className={`px-6 pt-6 pb-5 border-b ${isDarkMode ? 'border-white/10' : 'border-gray-200/70'}`}
              >
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-2xl shadow-inner ${isDarkMode ? 'bg-slate-800/80 text-slate-200' : 'bg-slate-100 text-gray-700'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
                      <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <TickerSearch
                      initialSymbol={currentTicker}
                      isDarkMode={isDarkMode}
                      compact={false}
                      autoFocus={true}
                      variant="panel"
                      placeholder="Search Momentum"
                      className="w-full"
                    />
                    <p className={`mt-2 text-sm ${isDarkMode ? 'text-slate-400' : 'text-gray-600'}`}>
                      Find tickers, companies, or revisit a recent search. Press Enter to jump straight to a symbol.
                    </p>
                  </div>
                  <div className={`hidden md:inline-flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-full border app-border ${isDarkMode ? 'text-slate-300' : 'text-gray-600'}`}>
                    <span className="text-[11px] uppercase tracking-wide">Esc</span>
                    <span className="opacity-70">to close</span>
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-12 gap-8 px-6 py-6">
                <div className="md:col-span-5 space-y-4">
                  <div className="space-y-2">
                    <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                      Quick Links
                    </p>
                    <div className="space-y-3">
                      {[{ href: '/', label: 'Home' }, { href: '/analysis', label: 'Analysis' }, { href: '/memory', label: 'Memory' }, { href: '/watchlist', label: 'Watchlist' }].map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`flex items-center justify-between rounded-2xl px-4 py-3 transition ${
                            isDarkMode
                              ? 'bg-white/5 hover:bg-white/10 text-slate-100'
                              : 'bg-slate-50 hover:bg-slate-100 text-gray-900'
                          }`}
                          onClick={() => setIsSearchOpen(false)}
                        >
                          <span className="text-sm font-medium">{item.label}</span>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.4}
                            className="w-4 h-4 opacity-70"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="md:col-span-7 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                      {lastSearches.length === 0 ? 'Suggested' : 'Recent Searches'}
                    </p>
                  </div>
                  <ul className={`divide-y ${isDarkMode ? 'divide-white/5' : 'divide-gray-200'}`}>
                    {(lastSearches.length === 0 ? ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'TSLA'] : lastSearches).map((s) => (
                      <li key={s}>
                        <Link
                          href={`/company/${encodeURIComponent(s)}/timing`}
                          className={`flex items-center justify-between py-3 px-2 rounded-xl transition ${
                            isDarkMode
                              ? 'text-slate-100 hover:bg-white/5'
                              : 'text-gray-900 hover:bg-slate-50'
                          }`}
                          onClick={() => setIsSearchOpen(false)}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                              isDarkMode ? 'bg-white/5 text-slate-200' : 'bg-slate-100 text-gray-800'
                            }`}>
                              {s.slice(0, 3)}
                            </div>
                            <span className="text-sm font-medium leading-none">{s}</span>
                          </div>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.5}
                            className="w-4 h-4 opacity-70"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5l7 7-7 7" />
                          </svg>
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