'use client';

import { useDarkMode } from '@/lib/hooks/useDarkMode';
import { TickerSearch } from '@/components/TickerSearch';
import LayoutContainer from '@/components/LayoutContainer';

export default function HomePage() {
  const isDarkMode = useDarkMode();

  return (
    <main className="min-h-[calc(100dvh-56px)] bg-background overflow-x-hidden flex items-center justify-center">
      <LayoutContainer className="w-full">
        <div className="mx-auto w-full max-w-[820px] px-2 sm:px-0 flex flex-col items-center justify-center py-10 -translate-y-8 md:-translate-y-10">
          <h1 className={`text-5xl font-bold text-center ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Momentum</h1>
          <div className="mt-8 w-full">
            <TickerSearch
              isDarkMode={isDarkMode}
              appearance="tradingview"
              size="lg"
              showBorder
              showRecentWhenEmpty={false}
            />
          </div>
        </div>
      </LayoutContainer>
    </main>
  );
}
