'use client';

import Link from 'next/link';
import { useDarkMode } from '@/lib/hooks/useDarkMode';

export default function HomePage() {
  const isDarkMode = useDarkMode();

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h1 className={`text-4xl font-bold sm:text-5xl md:text-6xl ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            Welcome to <span className="text-blue-500">Axel</span>
          </h1>
          <p className={`mt-3 max-w-md mx-auto text-base sm:text-lg md:mt-5 md:text-xl md:max-w-3xl ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>
            Advanced financial analysis and momentum timing platform for data-driven investment decisions.
          </p>
        </div>

        <div className="mt-16">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4">
            <div className={`overflow-hidden shadow rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
              <div className="p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="h-8 w-8 bg-blue-500 rounded-md flex items-center justify-center">
                      <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4">
                    <h3 className={`text-lg font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Analysis</h3>
                    <p className={`mt-2 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                      Comprehensive momentum timing analysis with advanced forecasting and risk management.
                    </p>
                    <div className="mt-4">
                      <Link
                        href="/analysis"
                        className={`inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md ${isDarkMode ? 'text-blue-200 bg-blue-900 hover:bg-blue-800' : 'text-blue-700 bg-blue-100 hover:bg-blue-200'}`}
                      >
                        Get Started
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className={`overflow-hidden shadow rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
              <div className="p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="h-8 w-8 bg-green-500 rounded-md flex items-center justify-center">
                      <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4">
                    <h3 className={`text-lg font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Watchlist</h3>
                    <p className={`mt-2 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                      Monitor your portfolio and track market opportunities with real-time alerts.
                    </p>
                    <div className="mt-4">
                      <Link
                        href="/watchlist"
                        className={`inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md ${isDarkMode ? 'text-green-200 bg-green-900 hover:bg-green-800' : 'text-green-700 bg-green-100 hover:bg-green-200'}`}
                      >
                        View Watchlist
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className={`overflow-hidden shadow rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
              <div className="p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="h-8 w-8 bg-purple-500 rounded-md flex items-center justify-center">
                      <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2-2H5a2 2 0 00-2 2v5a2 2 0 002 2z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4">
                    <h3 className={`text-lg font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Memory</h3>
                    <p className={`mt-2 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                      Browse and manage your saved companies and their historical data archives.
                    </p>
                    <div className="mt-4">
                      <Link
                        href="/memory"
                        className={`inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md ${isDarkMode ? 'text-purple-200 bg-purple-900 hover:bg-purple-800' : 'text-purple-700 bg-purple-100 hover:bg-purple-200'}`}
                      >
                        Browse Memory
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className={`overflow-hidden shadow rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
              <div className="p-6">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="h-8 w-8 bg-indigo-500 rounded-md flex items-center justify-center">
                      <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                  </div>
                  <div className="ml-4">
                    <h3 className={`text-lg font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Quick Analysis</h3>
                    <p className={`mt-2 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>
                      Get started quickly with AMD analysis to explore the platform capabilities.
                    </p>
                    <div className="mt-4">
                      <Link
                        href="/analysis?ticker=AMD"
                        className={`inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md ${isDarkMode ? 'text-indigo-200 bg-indigo-900 hover:bg-indigo-800' : 'text-indigo-700 bg-indigo-100 hover:bg-indigo-200'}`}
                      >
                        Analyze AMD
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={`mt-16 shadow rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <div className="px-6 py-8">
            <h2 className={`text-2xl font-bold text-center ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Platform Features</h2>
            <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="text-center">
                <h3 className={`text-lg font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Momentum Timing</h3>
                <p className={`mt-2 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Advanced momentum detection and timing strategies</p>
              </div>
              <div className="text-center">
                <h3 className={`text-lg font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Risk Management</h3>
                <p className={`mt-2 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Sophisticated volatility modeling and conformal prediction</p>
              </div>
              <div className="text-center">
                <h3 className={`text-lg font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Backtesting</h3>
                <p className={`mt-2 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Comprehensive strategy validation and performance analysis</p>
              </div>
              <div className="text-center">
                <h3 className={`text-lg font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Real-time Alerts</h3>
                <p className={`mt-2 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-500'}`}>Automated monitoring and notification system</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
