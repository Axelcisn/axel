'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AnalysisPage() {
  const router = useRouter();
  const [ticker, setTicker] = useState('');

  const handleTickerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (ticker.trim()) {
      const formattedTicker = ticker.trim().toUpperCase();
      router.push(`/company/${formattedTicker}/timing`);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">
            Financial Analysis Dashboard
          </h1>
          <p className="mt-3 max-w-2xl mx-auto text-lg text-gray-500">
            Comprehensive momentum timing analysis and risk management tools
          </p>
        </div>

        {/* Ticker Selection */}
        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Select Security for Analysis</h2>
            <form onSubmit={handleTickerSubmit} className="flex gap-4 items-end">
              <div className="flex-1 max-w-sm">
                <label htmlFor="ticker" className="block text-sm font-medium text-gray-700 mb-2">
                  Ticker Symbol
                </label>
                <input
                  type="text"
                  id="ticker"
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  placeholder="e.g., AAPL, MSFT, GOOGL"
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
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