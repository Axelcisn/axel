'use client';

import { useDarkMode } from '@/lib/hooks/useDarkMode';
import { TickerSearch } from '@/components/TickerSearch';

export default function HomePage() {
  const isDarkMode = useDarkMode();

  return (
    <main className="min-h-[calc(100vh-56px)] bg-background overflow-hidden">
      <div className="flex min-h-[calc(100vh-56px)] items-start justify-center px-6">
        <div className="w-full max-w-5xl pt-16">
          <h1 className={`text-5xl font-bold text-center ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Momentum</h1>
          <div className="mt-10">
            <TickerSearch isDarkMode={isDarkMode} variant="panel" showBorder showRecentWhenEmpty={false} />
          </div>
        </div>
      </div>
    </main>
  );
}
