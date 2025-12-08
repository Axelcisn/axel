'use client';

import { useState, useEffect } from 'react';
import WatchlistTable from '@/components/WatchlistTable';
import AlertsCard from '@/components/AlertsCard';
import { WatchlistRow, AlertFire } from '@/lib/watchlist/types';
import { useDarkMode } from '@/lib/hooks/useDarkMode';

export default function WatchlistPage() {
  const [watchlistRows, setWatchlistRows] = useState<WatchlistRow[]>([]);
  const [isLoadingWatchlist, setIsLoadingWatchlist] = useState(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [firedAlerts, setFiredAlerts] = useState<AlertFire[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const isDarkMode = useDarkMode();

  useEffect(() => {
    loadWatchlist();
    loadAlerts();
  }, []);

  const loadWatchlist = async () => {
    setIsLoadingWatchlist(true);
    setWatchlistError(null);
    
    try {
      const response = await fetch('/api/watchlist');
      if (!response.ok) {
        throw new Error(`Failed to load watchlist: ${response.statusText}`);
      }
      
      const data = await response.json();
      setWatchlistRows(data.rows || []);
    } catch (error) {
      setWatchlistError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoadingWatchlist(false);
    }
  };

  const loadAlerts = async () => {
    setAlertsLoading(true);
    
    try {
      // Use lightweight fires endpoint instead of heavy /api/alerts/run
      const response = await fetch('/api/alerts/fires?days=7');
      if (!response.ok) {
        throw new Error(`Failed to load alerts: ${response.statusText}`);
      }
      
      const data = await response.json();
      setFiredAlerts(data.fires || []);
    } catch (error) {
      console.error('Failed to load alerts:', error);
    } finally {
      setAlertsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className={`text-3xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Watchlist</h1>
          <p className={`mt-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
            Monitor your tracked securities and stay updated with real-time alerts
          </p>
        </div>

        {/* Alerts Section */}
        <div className="mb-8">
          <div className={`shadow rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <div className={`px-6 py-4 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <div className="flex items-center justify-between">
                <h2 className={`text-lg font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Active Alerts</h2>
                <button
                  onClick={loadAlerts}
                  disabled={alertsLoading}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {alertsLoading ? 'Refreshing...' : 'Refresh Alerts'}
                </button>
              </div>
            </div>
            <div className="p-6">
              {firedAlerts.length > 0 ? (
                <div className="space-y-4">
                  {firedAlerts.map((alert, index) => (
                    <div key={index} className={`border rounded-lg p-4 ${isDarkMode ? 'bg-yellow-900 border-yellow-700' : 'bg-yellow-50 border-yellow-200'}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className={`font-medium ${isDarkMode ? 'text-yellow-200' : 'text-yellow-900'}`}>{alert.symbol}</h3>
                          <p className={`text-sm ${isDarkMode ? 'text-yellow-300' : 'text-yellow-700'}`}>
                            Alert fired: {alert.reason === 'threshold' ? 'Threshold exceeded' : 'Review date reached'}
                          </p>
                        </div>
                        <div className={`text-sm ${isDarkMode ? 'text-yellow-400' : 'text-yellow-600'}`}>
                          {new Date(alert.fired_at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={`text-center py-8 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  {alertsLoading ? 'Loading alerts...' : 'No active alerts'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Watchlist Table Section */}
        <div className={`shadow rounded-lg ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <div className={`px-6 py-4 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className="flex items-center justify-between">
              <h2 className={`text-lg font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Tracked Securities</h2>
              <button
                onClick={loadWatchlist}
                disabled={isLoadingWatchlist}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoadingWatchlist ? 'Refreshing...' : 'Refresh Watchlist'}
              </button>
            </div>
          </div>
          <div className="p-6">
            {watchlistError ? (
              <div className="text-center py-8">
                <div className={`mb-4 ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                  <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.35 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <h3 className={`text-lg font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Error Loading Watchlist</h3>
                <p className={`mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>{watchlistError}</p>
                <button
                  onClick={loadWatchlist}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
                >
                  Try Again
                </button>
              </div>
            ) : isLoadingWatchlist ? (
              <div className={`text-center py-8 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Loading watchlist...
              </div>
            ) : (
              <WatchlistTable rows={watchlistRows} />
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className={`shadow rounded-lg p-6 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <h3 className={`text-lg font-medium mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Add New Security</h3>
            <p className={`mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              To add a new security to your watchlist, go to the Analysis page and run a complete analysis first.
            </p>
            <a
              href="/analysis"
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
            >
              Go to Analysis
            </a>
          </div>

          <div className={`shadow rounded-lg p-6 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <h3 className={`text-lg font-medium mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Alert Configuration</h3>
            <p className={`mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              Alerts are automatically configured when you complete analysis for a security. Customize thresholds in the analysis interface.
            </p>
            <button
              onClick={loadAlerts}
              className="inline-flex items-center px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700"
            >
              Check Alerts
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}