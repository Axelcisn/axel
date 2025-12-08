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
  const timeoutRef = useRef<number | null>(null);
  const CLOSE_ANIM_MS = 360; // should match .animate-searchPanelExit duration

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
      };
    }
    return;
  }, [isSearchOpen, panelMounted]);

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
            className={`fixed inset-0 z-40 overflow-hidden ${
              isDarkMode ? 'bg-black/75' : 'bg-slate-900/70'
            } backdrop-blur-2xl transition-opacity duration-500 ${
              isClosing ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
            onClick={() => setIsSearchOpen(false)}
          >
            <div
              className={`absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(255,255,255,0.06),transparent_38%),radial-gradient(circle_at_75%_15%,rgba(255,255,255,0.09),transparent_35%),radial-gradient(circle_at_50%_75%,rgba(59,130,246,0.16),transparent_40%)] ${
                isDarkMode ? 'opacity-80' : 'opacity-70'
              } blur-3xl`}
            />
          </div>

          <div className="fixed inset-0 z-50 flex flex-col items-center px-4 sm:px-8 pt-24 pointer-events-none">
            <div
              className={`relative w-full max-w-4xl pointer-events-auto rounded-[28px] border ${
                isDarkMode ? 'border-white/10 bg-slate-950/70' : 'border-gray-200/80 bg-white/75'
              } shadow-[0_28px_120px_rgba(0,0,0,0.45)] backdrop-blur-3xl transition-transform duration-500 ${
                isClosing ? 'animate-searchPanelExit' : 'animate-searchPanelEnter'
              }`}
            >
              <div className={`flex items-center gap-4 px-6 py-5 border-b ${isDarkMode ? 'border-white/10' : 'border-gray-200/80'}`}>
                <div
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-full shadow-inner ${
                    isDarkMode ? 'bg-white/5 text-slate-200' : 'bg-slate-100 text-gray-700'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
                    <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
                  </svg>
                </div>
                <TickerSearch
                  initialSymbol={currentTicker}
                  isDarkMode={isDarkMode}
                  compact={false}
                  autoFocus={true}
                  variant="panel"
                  placeholder="Search Momentum"
                  className="flex-1"
                  inputClassName="!text-[22px] !leading-tight !font-semibold !border-0 !bg-transparent !pl-1 !pr-2 !py-2 focus:!outline-none"
                />
                <div className={`hidden sm:inline-flex items-center gap-2 text-[11px] font-semibold px-3 py-1.5 rounded-full ${
                  isDarkMode ? 'bg-white/5 text-slate-200' : 'bg-slate-100 text-gray-700'
                }`}>
                  <span className="uppercase tracking-wide">Esc</span>
                  <span className="opacity-70 font-medium">to close</span>
                </div>
              </div>

              <div className="px-6 py-6">
                <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                  Quick Links
                </p>
                <ul className="mt-4 space-y-2 text-[17px]">
                  {[{ href: '/analysis', label: 'Analysis' }, { href: '/memory', label: 'Memory' }, { href: '/watchlist', label: 'Watchlist' }, { href: '/backtests', label: 'Backtests' }, { href: '/', label: 'Home' }].map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`group flex items-center justify-between rounded-2xl px-4 py-3 transition ${
                          isDarkMode ? 'text-slate-100 hover:bg-white/5' : 'text-gray-900 hover:bg-slate-100'
                        }`}
                        onClick={() => setIsSearchOpen(false)}
                      >
                        <span className="font-medium">{item.label}</span>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={1.4}
                          className="w-4 h-4 opacity-80 transition-transform duration-200 group-hover:translate-x-1"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </Link>
                    </li>
                  ))}
                </ul>

                <div className="mt-8 flex items-center justify-between text-sm text-slate-400">
                  <span className="font-medium">Recent searches</span>
                  <span className="text-xs uppercase tracking-[0.2em]">Press Enter to go</span>
                </div>
                <ul className={`mt-3 divide-y ${isDarkMode ? 'divide-white/5' : 'divide-gray-200'}`}>
                  {(lastSearches.length === 0 ? ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'TSLA'] : lastSearches).map((s) => (
                    <li key={s}>
                      <Link
                        href={`/company/${encodeURIComponent(s)}/timing`}
                        className={`flex items-center justify-between py-3 px-1 rounded-xl transition ${
                          isDarkMode ? 'text-slate-100 hover:bg-white/5' : 'text-gray-900 hover:bg-slate-100'
                        }`}
                        onClick={() => setIsSearchOpen(false)}
                      >
                        <span className="text-base font-medium">{s}</span>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={1.4}
                          className="w-4 h-4 opacity-80"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
