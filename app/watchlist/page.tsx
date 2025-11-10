'use client';

import { useState, useEffect } from 'react';
import WatchlistTable from '@/components/WatchlistTable';
import AlertsCard from '@/components/AlertsCard';
import { WatchlistRow, AlertFire } from '@/lib/watchlist/types';

export default function WatchlistPage() {
  const [watchlistRows, setWatchlistRows] = useState<WatchlistRow[]>([]);
  const [isLoadingWatchlist, setIsLoadingWatchlist] = useState(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [firedAlerts, setFiredAlerts] = useState<AlertFire[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);

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
      const response = await fetch('/api/alerts/run');
      if (!response.ok) {
        throw new Error(`Failed to load alerts: ${response.statusText}`);
      }
      
      const data = await response.json();
      setFiredAlerts(data.fired || []);
    } catch (error) {
      console.error('Failed to load alerts:', error);
    } finally {
      setAlertsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Watchlist</h1>
          <p className="mt-2 text-gray-600">
            Monitor your tracked securities and stay updated with real-time alerts
          </p>
        </div>

        {/* Alerts Section */}
        <div className="mb-8">
          <div className="bg-white shadow rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium text-gray-900">Active Alerts</h2>
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
                    <div key={index} className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-medium text-yellow-900">{alert.symbol}</h3>
                          <p className="text-sm text-yellow-700">
                            Alert fired: {alert.reason === 'threshold' ? 'Threshold exceeded' : 'Review date reached'}
                          </p>
                        </div>
                        <div className="text-sm text-yellow-600">
                          {new Date(alert.fired_at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  {alertsLoading ? 'Loading alerts...' : 'No active alerts'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Watchlist Table Section */}
        <div className="bg-white shadow rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-gray-900">Tracked Securities</h2>
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
                <div className="text-red-600 mb-4">
                  <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.35 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">Error Loading Watchlist</h3>
                <p className="text-gray-600 mb-4">{watchlistError}</p>
                <button
                  onClick={loadWatchlist}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
                >
                  Try Again
                </button>
              </div>
            ) : isLoadingWatchlist ? (
              <div className="text-center py-8 text-gray-500">
                Loading watchlist...
              </div>
            ) : (
              <WatchlistTable rows={watchlistRows} />
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Add New Security</h3>
            <p className="text-gray-600 mb-4">
              To add a new security to your watchlist, go to the Analysis page and run a complete analysis first.
            </p>
            <a
              href="/analysis"
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
            >
              Go to Analysis
            </a>
          </div>

          <div className="bg-white shadow rounded-lg p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Alert Configuration</h3>
            <p className="text-gray-600 mb-4">
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