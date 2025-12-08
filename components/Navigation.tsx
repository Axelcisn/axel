'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useDarkMode } from '@/lib/hooks/useDarkMode';
import { TickerSearch } from '@/components/TickerSearch';

export default function Navigation() {
  const pathname = usePathname();
  const isDarkMode = useDarkMode();
  const [showSearch, setShowSearch] = useState(false);

  const navItems = [
    { href: '/', label: 'Home' },
    { href: '/analysis', label: 'Analysis' },
    { href: '/memory', label: 'Memory' },
    { href: '/watchlist', label: 'Watchlist' },
  ];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowSearch(false);
      }
    };

    if (showSearch) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [showSearch]);

  // Extract current ticker from pathname if on a company page
  const tickerMatch = pathname.match(/\/company\/([^/]+)/);
  const currentTicker = tickerMatch ? tickerMatch[1] : undefined;

  const suggestedTickers = ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'TSLA'];

  return (
    <nav className={`shadow-sm border-b ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
      <div className="w-full px-[5%]">
        <div className="flex items-center justify-between h-12">
          <div className="flex items-center gap-6">
            <Link href="/" className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              Axel
            </Link>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex space-x-8">
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
            </div>
            <button
              type="button"
              aria-label="Open search"
              onClick={() => setShowSearch(true)}
              className={`flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-200 hover:-translate-y-0.5 ${
                isDarkMode
                  ? 'border-gray-700 bg-gray-800/70 text-gray-200 hover:border-gray-600 hover:bg-gray-800'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35m0 0A7.5 7.5 0 1 0 5.65 5.65a7.5 7.5 0 0 0 10.6 10.6Z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className={`fixed inset-0 z-50 transition-[opacity] duration-300 ${showSearch ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}>
        <div
          className={`absolute inset-0 bg-black/60 backdrop-blur-2xl transition-opacity duration-300 ${showSearch ? 'opacity-100' : 'opacity-0'}`}
          onClick={() => setShowSearch(false)}
        />

        <div
          className={`absolute left-0 right-0 top-0 mx-auto max-w-5xl px-4 sm:px-8 transition-all duration-300 ease-out ${
            showSearch ? 'translate-y-0 opacity-100' : '-translate-y-6 opacity-0'
          }`}
        >
          <div
            className={`mt-6 rounded-3xl border shadow-2xl backdrop-blur-xl ${
              isDarkMode ? 'bg-slate-900/80 border-slate-800' : 'bg-white/90 border-gray-200'
            }`}
          >
            <div className="px-6 py-6 sm:px-8 sm:py-8">
              <TickerSearch
                initialSymbol={currentTicker}
                isDarkMode={isDarkMode}
                variant="overlay"
                autoFocus
                onClose={() => setShowSearch(false)}
                onSubmitSuccess={() => setShowSearch(false)}
                suggestions={suggestedTickers}
              />
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}