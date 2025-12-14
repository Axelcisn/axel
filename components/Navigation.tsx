'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDarkMode } from '@/lib/hooks/useDarkMode';
import { TickerSearch } from '@/components/TickerSearch';
import LayoutContainer from './LayoutContainer';

const CLOSE_ANIM_MS = 220;
const HOVER_CLOSE_MS = 220;
const SEARCH_PANEL_ID = 'global-search-panel';

const navItems = [
  { href: '/', label: 'Home' },
  { href: '/analysis', label: 'Analysis' },
  { href: '/memory', label: 'Memory' },
  { href: '/watchlist', label: 'Watchlist' },
];

export default function Navigation() {
  const pathname = usePathname();
  const isDarkMode = useDarkMode();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isHoveringPanel, setIsHoveringPanel] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const hoverTimeoutRef = useRef<number | null>(null);

  const tickerMatch = pathname.match(/\/company\/([^/]+)/);
  const currentTicker = tickerMatch ? tickerMatch[1] : undefined;

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

  const linkBase =
    'text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded-full px-3 py-1';

  const surfaceTone = isDarkMode
    ? 'bg-[#0f0f0f]/95 border-white/10'
    : 'bg-white/95 border-gray-200';

  return (
    <nav
      className={`relative z-[130] backdrop-blur-xl transition-colors ${surfaceTone} ${isSearchOpen ? 'border-0' : 'border-b'}`}
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

      {panelMounted && (
        <>
          <div
            className={`fixed inset-x-0 top-14 bottom-0 z-[180] ${
              isDarkMode ? 'bg-[#0f0f0f]' : 'bg-white'
            } transition-opacity duration-[420ms] ${
              isClosing ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
            onClick={() => setIsSearchOpen(false)}
            onMouseEnter={() => {
              if (!isHoveringPanel) setIsSearchOpen(false);
            }}
          />

          <div
            id={SEARCH_PANEL_ID}
            className={`fixed inset-x-0 top-14 bottom-0 z-[200] ${
              isClosing ? 'animate-slideUpFade' : 'animate-slideDownFade'
            } transition-colors ${surfaceTone}`}
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
            <LayoutContainer>
              <div className="w-full px-6 md:px-10 pt-14 md:pt-16 pb-20 border-b border-white/10">
                <TickerSearch
                  initialSymbol={currentTicker}
                  isDarkMode={isDarkMode}
                  autoFocus
                  size="xl"
                  appearance="apple"
                  showBorder={false}
                  showRecentWhenEmpty={false}
                  onRequestClose={() => setIsSearchOpen(false)}
                />
              </div>
            </LayoutContainer>
          </div>
        </>
      )}
    </nav>
  );
}
