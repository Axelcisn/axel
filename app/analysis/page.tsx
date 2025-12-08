'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDarkMode } from '@/lib/hooks/useDarkMode';

export default function AnalysisPage() {
  const router = useRouter();
  const [ticker, setTicker] = useState('');
  const isDarkMode = useDarkMode();

  const handleTickerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (ticker.trim()) {
      const formattedTicker = ticker.trim().toUpperCase();
      router.push(`/company/${formattedTicker}/timing`);
    }
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h1 className={`text-3xl font-bold sm:text-4xl ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            Financial Analysis Dashboard
          </h1>
          <p className={`mt-3 max-w-2xl mx-auto text-lg ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>
            Comprehensive momentum timing analysis and risk management tools
          </p>
        </div>

        {/* Ticker Selection */}
        <div className={`shadow rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <div className="px-6 py-8">
            <h2 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Select Security for Analysis</h2>
            <form onSubmit={handleTickerSubmit} className="flex gap-4 items-end">
              <div className="flex-1 max-w-sm">
                <label htmlFor="ticker" className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Ticker Symbol
                </label>
                <input
                  type="text"
                  id="ticker"
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  placeholder="e.g., AAPL, MSFT, GOOGL"
                  className={`block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${
                    isDarkMode 
                      ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' 
                      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
                  }`}
                />
              </div>
              <button
                type="submit"
                className="px-6 py-3 bg-green-600 text-white font-medium rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                Launch Full Analysis
              </button>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}