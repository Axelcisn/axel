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
            className={`fixed inset-0 z-40 ${isDarkMode ? 'bg-black/75' : 'bg-gray-900/70'} backdrop-blur-[24px] transition-opacity duration-500 ${
              isClosing ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
            onClick={() => setIsSearchOpen(false)}
          />

          <div className="fixed inset-0 z-50 flex flex-col items-center px-[5%] pt-14 md:pt-16 pointer-events-none">
            <div
              className={`w-full max-w-3xl pointer-events-auto rounded-3xl border ${
                isDarkMode ? 'border-white/10 bg-[#0e0f11]/85 text-slate-100' : 'border-gray-200/70 bg-white/90 text-gray-900'
              } shadow-2xl shadow-black/30 backdrop-blur-2xl transition-transform duration-500 ${
                isClosing ? 'animate-searchPanelExit' : 'animate-searchPanelEnter'
              }`}
            >
              <div className={`flex items-center gap-3 px-5 py-3 ${isDarkMode ? 'border-b border-white/5' : 'border-b border-gray-200/80'}`}>
                <span className={`${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
                    <circle cx="11" cy="11" r="6.5" />
                  </svg>
                </span>
                <TickerSearch
                  initialSymbol={currentTicker}
                  isDarkMode={isDarkMode}
                  compact={false}
                  autoFocus={true}
                  variant="panel"
                  placeholder="Search apple.com"
                  className="w-full"
                />
              </div>

              <div className="px-5 pb-4 pt-3 space-y-2">
                <p className={`text-sm font-semibold ${isDarkMode ? 'text-slate-300' : 'text-gray-700'}`}>Quick Links</p>
                <ul className="space-y-1">
                  {[
                    { href: '/', label: 'Shop iPhone' },
                    { href: '/analysis', label: 'Find a Store' },
                    { href: '/memory', label: 'Apple Gift Card' },
                    { href: '/watchlist', label: 'Apple Vision Pro' },
                    { href: '/', label: 'Apple Trade In' },
                  ].map((item) => (
                    <li key={item.label}>
                      <Link
                        href={item.href}
                        className={`flex items-center justify-between rounded-xl px-2 py-2 text-[15px] transition ${
                          isDarkMode
                            ? 'text-slate-200 hover:text-white hover:bg-white/5'
                            : 'text-gray-800 hover:text-black hover:bg-gray-100'
                        }`}
                        onClick={() => setIsSearchOpen(false)}
                      >
                        <span>{item.label}</span>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={1.5}
                          className="w-4 h-4 opacity-70"
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