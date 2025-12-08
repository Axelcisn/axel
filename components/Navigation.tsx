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

  const appleNavItems = [
    'Store',
    'Mac',
    'iPad',
    'iPhone',
    'Watch',
    'Vision',
    'AirPods',
    'TV & Home',
    'Entertainment',
    'Accessories',
    'Support',
  ];

  const appleQuickLinks = [
    { label: 'Shop', href: '/' },
    { label: 'Find a store', href: '/analysis' },
    { label: 'Apple Gift Card', href: '/memory' },
    { label: 'Apple Vision Pro', href: '/watchlist' },
    { label: 'Apple Trade In', href: '/analysis' },
  ];

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
          />

          <div className="fixed inset-0 z-50 flex justify-center px-4 sm:px-6 pt-14 pb-10 pointer-events-none">
            <div
              className={`w-full max-w-5xl pointer-events-auto overflow-hidden rounded-[22px] border ${
                isDarkMode ? 'border-white/5 bg-[#0b0b0c]/85' : 'border-gray-200/60 bg-[#0e0e10]/90'
              } shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl transition-transform duration-500 ${
                isClosing ? 'animate-searchPanelExit' : 'animate-searchPanelEnter'
              }`}
            >
              <div className="border-b border-white/5 px-5 sm:px-6 py-4 bg-black/40">
                <div className="flex items-center gap-4 text-[13px] text-slate-200">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-5 h-5 opacity-90"
                  >
                    <path d="M16.365 1.75c-.986.067-2.136.66-2.82 1.422-.617.685-1.117 1.64-.98 2.614 1.07.085 2.193-.554 2.9-1.342.636-.718 1.132-1.684.9-2.694ZM19.533 13.05c-.014-1.48.652-2.605 2.096-3.442-.788-1.144-1.975-1.79-3.568-1.94-1.433-.14-2.995.83-3.562.83-.597 0-1.963-.788-3.035-.788-2.223.034-4.513 1.81-4.513 5.23-.016 1.092.195 2.185.637 3.214.575 1.342 2.622 4.758 4.77 4.69 1.082-.025 1.846-.742 3.255-.742 1.377 0 2.092.742 3.272.742 2.176-.034 3.998-3.033 4.54-4.39-2.862-1.357-2.792-3.985-2.792-3.993Z" />
                  </svg>
                  <div className="hidden lg:flex items-center gap-4 tracking-tight">
                    {appleNavItems.map((label) => (
                      <span key={label} className="hover:text-white transition-colors cursor-default">
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className="flex-1 flex justify-end">
                    <div className="flex items-center gap-3 w-full max-w-md rounded-xl border border-white/5 bg-[#161618]/90 px-3 py-2">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.6}
                        className="w-4 h-4 text-slate-300"
                      >
                        <circle cx="11" cy="11" r="6" />
                        <path d="m15.5 15.5 3.5 3.5" strokeLinecap="round" />
                      </svg>
                      <TickerSearch
                        initialSymbol={currentTicker}
                        isDarkMode={true}
                        compact={false}
                        autoFocus={true}
                        variant="panel"
                        panelStyle="bar"
                        placeholder="Search Momentum"
                        className="w-full"
                      />
                      <span className="hidden sm:inline-flex items-center rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-200">
                        Esc
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-5 sm:px-6 py-5 bg-gradient-to-b from-black/40 via-black/35 to-black/55">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400 mb-3">Quick Links</p>
                <ul className="space-y-2 text-sm text-slate-100">
                  {appleQuickLinks.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="flex items-center justify-between rounded-lg px-2 py-2 transition hover:text-white hover:bg-white/5"
                        onClick={() => setIsSearchOpen(false)}
                      >
                        <span>{link.label}</span>
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