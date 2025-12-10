'use client';

import { useEffect, useMemo, useState } from 'react';
import WatchlistTable from '@/components/WatchlistTable';
import { AlertFire, WatchlistRow, WatchlistSummary } from '@/lib/watchlist/types';
import { useDarkMode } from '@/lib/hooks/useDarkMode';

type FocusFilter = 'all' | 'up' | 'down' | 'incomplete';

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export default function WatchlistPage() {
  const [watchlistRows, setWatchlistRows] = useState<WatchlistRow[]>([]);
  const [watchlistSummary, setWatchlistSummary] = useState<WatchlistSummary | null>(null);
  const [isLoadingWatchlist, setIsLoadingWatchlist] = useState(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [firedAlerts, setFiredAlerts] = useState<AlertFire[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [focusFilter, setFocusFilter] = useState<FocusFilter>('all');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
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
        const message = await response.text().catch(() => '');
        throw new Error(message || `Failed to load watchlist: ${response.statusText}`);
      }

      const data = await response.json();
      const summary: WatchlistSummary | null = data.summary ?? null;
      const rows: WatchlistRow[] = data.rows || summary?.rows || [];

      setWatchlistRows(rows);
      setWatchlistSummary(summary);
      setLastRefreshedAt(new Date().toISOString());
    } catch (error) {
      setWatchlistRows([]);
      setWatchlistSummary(null);
      setWatchlistError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoadingWatchlist(false);
    }
  };

  const loadAlerts = async () => {
    setAlertsLoading(true);
    
    try {
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

  const daysUntil = (dateStr: string | null | undefined) => {
    if (!dateStr) return null;
    const now = new Date();
    const target = new Date(dateStr);
    const diff = target.getTime() - now.setHours(0, 0, 0, 0);
    return Math.round(diff / (1000 * 60 * 60 * 24));
  };

  const stats = useMemo(() => {
    const total = watchlistRows.length;
    const modeled = watchlistRows.filter(row => 
      row.forecast.source !== 'none' && 
      row.bands.L_1 !== null && 
      row.bands.U_1 !== null
    ).length;
    const momentumUp = watchlistRows.filter(row => row.deviation.direction === 'up').length;
    const nearReview = watchlistRows.filter(row => {
      const days = daysUntil(row.forecast.next_review_date);
      return typeof days === 'number' && days >= 0 && days <= 7;
    }).length;

    return { total, modeled, momentumUp, nearReview };
  }, [watchlistRows]);

  const visibleRows = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    let filtered = watchlistRows;

    if (focusFilter !== 'all') {
      if (focusFilter === 'incomplete') {
        filtered = filtered.filter(row => 
          row.forecast.source === 'none' ||
          row.bands.L_1 === null ||
          row.bands.U_1 === null
        );
      } else {
        filtered = filtered.filter(row => row.deviation.direction === focusFilter);
      }
    }

    if (query) {
      filtered = filtered.filter(row => row.symbol.toLowerCase().includes(query));
    }

    return filtered;
  }, [watchlistRows, focusFilter, searchTerm]);

  const focusOptions: Array<{ value: FocusFilter; label: string; hint: string }> = [
    { value: 'all', label: 'All', hint: 'Full coverage' },
    { value: 'up', label: 'Momentum ↑', hint: 'Positive deviation' },
    { value: 'down', label: 'Pullback ↓', hint: 'Negative deviation' },
    { value: 'incomplete', label: 'Needs data', hint: 'Missing bands' },
  ];

  const heroSurface = isDarkMode
    ? 'bg-gradient-to-br from-[#0c1424] via-[#0b1020] to-[#0e1c2e] border border-slate-800/60'
    : 'bg-gradient-to-br from-white via-slate-50 to-emerald-50 border border-emerald-100/60';

  const cardSurface = isDarkMode
    ? 'bg-[#0d1525] border border-slate-800/80 shadow-[0_12px_50px_-28px_rgba(0,0,0,0.6)]'
    : 'bg-white border border-slate-200 shadow-[0_22px_70px_-40px_rgba(15,23,42,0.3)]';

  const mutedSurface = isDarkMode
    ? 'bg-[#0f1a2c] border border-white/5'
    : 'bg-slate-50 border border-slate-200';

  const asOfDisplay = watchlistSummary?.as_of
    ? new Date(watchlistSummary.as_of).toLocaleDateString()
    : '—';

  const refreshedDisplay = lastRefreshedAt
    ? new Date(lastRefreshedAt).toLocaleTimeString()
    : '—';

  const hasData = !watchlistError && watchlistRows.length > 0;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-10 space-y-8">
        
        {/* Hero */}
        <section className={classNames('relative overflow-hidden rounded-3xl p-8 md:p-10', heroSurface)}>
          <div className="absolute -left-10 -top-10 h-48 w-48 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="absolute -right-8 top-0 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
          <div className="relative z-10 space-y-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-3">
                <p className={classNames('text-xs uppercase tracking-[0.28em] font-semibold', isDarkMode ? 'text-emerald-200/80' : 'text-emerald-700')}>
                  Signal Board
                </p>
                <div className="space-y-1">
                  <h1 className={classNames('text-4xl font-semibold tracking-tight', isDarkMode ? 'text-white' : 'text-slate-900')}>
                    Watchlist
                  </h1>
                  <p className={classNames('text-sm max-w-2xl', isDarkMode ? 'text-slate-200/80' : 'text-slate-600')}>
                    Track the securities you have modeled, monitor deviations, and keep upcoming review dates in one place.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className={classNames(
                    'inline-flex items-center gap-2 rounded-full px-3 py-1 font-medium',
                    isDarkMode ? 'bg-white/10 text-emerald-100 ring-1 ring-white/10' : 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200'
                  )}>
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    As of {asOfDisplay}
                  </span>
                  <span className={classNames(
                    'inline-flex items-center gap-2 rounded-full px-3 py-1 font-medium',
                    isDarkMode ? 'bg-white/5 text-slate-200 ring-1 ring-white/10' : 'bg-white text-slate-700 ring-1 ring-slate-200'
                  )}>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Refreshed {refreshedDisplay}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={loadWatchlist}
                  disabled={isLoadingWatchlist}
                  className={classNames(
                    'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition',
                    isDarkMode
                      ? 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400 disabled:opacity-60'
                      : 'bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-60'
                  )}
                >
                  {isLoadingWatchlist ? (
                    <>
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Refreshing
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.341A8 8 0 118.659 4.572M16 7v5h-5" />
                      </svg>
                      Refresh data
                    </>
                  )}
                </button>
                <a
                  href="/analysis"
                  className={classNames(
                    'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition',
                    isDarkMode
                      ? 'bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/20'
                      : 'bg-white text-slate-900 ring-1 ring-slate-200 hover:ring-slate-300'
                  )}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add coverage
                </a>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <StatCard
                label="Tracked symbols"
                value={stats.total}
                helper="Symbols on file"
                tone="emerald"
                isDarkMode={isDarkMode}
              />
              <StatCard
                label="Fully modeled"
                value={stats.modeled}
                helper="Ready with bands"
                tone="cyan"
                isDarkMode={isDarkMode}
              />
              <StatCard
                label="Momentum up"
                value={stats.momentumUp}
                helper="Positive deviation"
                tone="amber"
                isDarkMode={isDarkMode}
              />
              <StatCard
                label="Reviews next 7d"
                value={stats.nearReview}
                helper="Upcoming checks"
                tone="slate"
                isDarkMode={isDarkMode}
              />
            </div>
          </div>
        </section>

        {/* Main layout */}
        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {/* Watchlist */}
          <div className="space-y-6 xl:col-span-2">
            <div className={classNames('rounded-2xl overflow-hidden', cardSurface)}>
              <div className={classNames(
                'flex flex-col gap-4 border-b px-6 py-5',
                isDarkMode ? 'border-slate-800/80' : 'border-slate-100'
              )}>
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className={classNames('text-lg font-semibold', isDarkMode ? 'text-white' : 'text-slate-900')}>
                      Coverage overview
                    </h2>
                    <p className={classNames('text-sm', isDarkMode ? 'text-slate-300' : 'text-slate-600')}>
                      Filter by direction, search by ticker, and drill into the modeling details.
                    </p>
                  </div>
                  <div className="text-xs font-medium">
                    <span className={classNames(
                      'rounded-full px-3 py-1',
                      isDarkMode ? 'bg-white/5 text-slate-200 ring-1 ring-white/10' : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
                    )}>
                      {watchlistRows.length} total rows
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="relative w-full lg:max-w-sm">
                    <svg className={classNames('absolute left-3 top-2.5 h-4 w-4', isDarkMode ? 'text-slate-400' : 'text-slate-500')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
                    </svg>
                    <input
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search tickers..."
                      className={classNames(
                        'w-full rounded-xl border pl-10 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400',
                        isDarkMode
                          ? 'bg-slate-900 border-slate-800 text-white placeholder:text-slate-500'
                          : 'bg-white border-slate-200 text-slate-900 placeholder:text-slate-400'
                      )}
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {focusOptions.map(option => (
                      <button
                        key={option.value}
                        onClick={() => setFocusFilter(option.value)}
                        className={classNames(
                          'rounded-full px-3 py-1.5 text-sm font-medium transition border',
                          focusFilter === option.value
                            ? isDarkMode
                              ? 'bg-emerald-500 text-emerald-950 border-emerald-400'
                              : 'bg-emerald-600 text-white border-emerald-500'
                            : isDarkMode
                              ? 'bg-slate-900 text-slate-200 border-slate-700 hover:border-slate-500'
                              : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-6">
                {watchlistError ? (
                  <div className={classNames(
                    'flex flex-col items-start gap-3 rounded-xl border px-4 py-3',
                    isDarkMode ? 'border-red-700/50 bg-red-950/40 text-red-200' : 'border-red-200 bg-red-50 text-red-800'
                  )}>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.1 19h13.8c1.3 0 2.1-1.4 1.5-2.5L13.5 5.5c-.6-1.1-2.4-1.1-3 0L3.6 16.5c-.6 1.1.2 2.5 1.5 2.5z" />
                      </svg>
                      Unable to load watchlist
                    </div>
                    <p className={classNames('text-sm', isDarkMode ? 'text-red-100/80' : 'text-red-700')}>{watchlistError}</p>
                    <button
                      onClick={loadWatchlist}
                      className={classNames(
                        'rounded-md px-3 py-1.5 text-sm font-medium',
                        isDarkMode ? 'bg-red-500 text-red-950 hover:bg-red-400' : 'bg-red-600 text-white hover:bg-red-500'
                      )}
                    >
                      Retry
                    </button>
                  </div>
                ) : isLoadingWatchlist ? (
                  <div className={classNames(
                    'flex items-center gap-3 rounded-xl border px-4 py-3 text-sm',
                    isDarkMode ? 'border-slate-800 bg-slate-900 text-slate-200' : 'border-slate-200 bg-slate-50 text-slate-700'
                  )}>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Loading watchlist...
                  </div>
                ) : hasData ? (
                  <WatchlistTable rows={visibleRows} />
                ) : (
                  <div className={classNames(
                    'flex flex-col items-start gap-3 rounded-xl border px-4 py-3 text-sm',
                    isDarkMode ? 'border-slate-800 bg-slate-900 text-slate-200' : 'border-slate-200 bg-slate-50 text-slate-700'
                  )}>
                    <div className="flex items-center gap-2 font-semibold">
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
                        <circle cx="12" cy="12" r="9" />
                      </svg>
                      No watchlist rows yet
                    </div>
                    <p>Use the (+) action on a company page after running analysis to populate this view.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            <div className={classNames('rounded-2xl p-5', cardSurface)}>
              <div className="flex items-center justify-between">
                <div>
                  <p className={classNames('text-xs uppercase tracking-wide', isDarkMode ? 'text-slate-400' : 'text-slate-500')}>Alerts</p>
                  <h3 className={classNames('text-lg font-semibold', isDarkMode ? 'text-white' : 'text-slate-900')}>Recent fires</h3>
                </div>
                <button
                  onClick={loadAlerts}
                  disabled={alertsLoading}
                  className={classNames(
                    'rounded-full px-3 py-1.5 text-xs font-semibold transition',
                    isDarkMode
                      ? 'bg-white/10 text-white hover:bg-white/20 disabled:opacity-50'
                      : 'bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50'
                  )}
                >
                  {alertsLoading ? 'Refreshing' : 'Refresh'}
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {firedAlerts.length === 0 ? (
                  <div className={classNames(
                    'rounded-xl border px-3 py-3 text-sm',
                    isDarkMode ? 'border-slate-800 bg-slate-900 text-slate-200' : 'border-slate-200 bg-slate-50 text-slate-700'
                  )}>
                    {alertsLoading ? 'Loading alerts...' : 'No alerts fired in the past 7 days.'}
                  </div>
                ) : (
                  firedAlerts.slice(0, 5).map((alert) => (
                    <div
                      key={`${alert.symbol}-${alert.fired_at}`}
                      className={classNames(
                        'rounded-xl border px-3 py-3',
                        isDarkMode ? 'border-amber-500/30 bg-amber-500/5' : 'border-amber-200 bg-amber-50'
                      )}
                    >
                      <div className="flex items-center justify-between text-sm font-semibold">
                        <span className={isDarkMode ? 'text-amber-100' : 'text-amber-800'}>{alert.symbol}</span>
                        <span className={classNames('text-xs', isDarkMode ? 'text-amber-200/70' : 'text-amber-700')}>
                          {new Date(alert.fired_at).toLocaleString()}
                        </span>
                      </div>
                      <p className={classNames('mt-1 text-xs', isDarkMode ? 'text-amber-50/90' : 'text-amber-700')}>
                        {alert.reason === 'threshold' ? 'Threshold exceeded' : 'Review date reached'}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className={classNames('rounded-2xl p-5', mutedSurface)}>
              <p className={classNames('text-xs uppercase tracking-wide font-semibold', isDarkMode ? 'text-slate-300' : 'text-slate-600')}>
                Playbook
              </p>
              <h3 className={classNames('mt-1 text-lg font-semibold', isDarkMode ? 'text-white' : 'text-slate-900')}>
                Keep the list fresh
              </h3>
              <ul className={classNames('mt-3 space-y-2 text-sm', isDarkMode ? 'text-slate-200' : 'text-slate-700')}>
                <li>• Run a full analysis, then use the (+) action on the company header to save it here.</li>
                <li>• Re-run refresh daily to rebuild the watchlist with the latest forecasts.</li>
                <li>• Use the focus filters to triage momentum moves and incomplete coverage.</li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatCard({ label, value, helper, tone, isDarkMode }: { label: string; value: number; helper: string; tone: 'emerald' | 'cyan' | 'amber' | 'slate'; isDarkMode: boolean; }) {
  const toneMap = {
    emerald: {
      text: isDarkMode ? 'text-emerald-200' : 'text-emerald-700',
      badge: isDarkMode ? 'bg-emerald-500/10 text-emerald-100 ring-1 ring-emerald-400/40' : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
    },
    cyan: {
      text: isDarkMode ? 'text-cyan-200' : 'text-cyan-700',
      badge: isDarkMode ? 'bg-cyan-500/10 text-cyan-100 ring-1 ring-cyan-400/40' : 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100'
    },
    amber: {
      text: isDarkMode ? 'text-amber-200' : 'text-amber-700',
      badge: isDarkMode ? 'bg-amber-500/10 text-amber-100 ring-1 ring-amber-400/40' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'
    },
    slate: {
      text: isDarkMode ? 'text-slate-200' : 'text-slate-700',
      badge: isDarkMode ? 'bg-slate-500/10 text-slate-100 ring-1 ring-slate-400/40' : 'bg-slate-50 text-slate-700 ring-1 ring-slate-200'
    },
  } as const;

  const toneClasses = toneMap[tone];

  return (
    <div className={classNames(
      'rounded-2xl p-4 ring-1',
      isDarkMode ? 'bg-white/5 ring-white/10' : 'bg-white ring-slate-200 shadow-sm'
    )}>
      <p className={classNames('text-xs uppercase tracking-wide font-semibold', isDarkMode ? 'text-slate-400' : 'text-slate-500')}>{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={classNames('text-3xl font-semibold', isDarkMode ? 'text-white' : 'text-slate-900')}>{value}</span>
        <span className={classNames('text-xs rounded-full px-2 py-0.5 font-medium', toneClasses.badge)}>{helper}</span>
      </div>
      <div className={classNames('mt-1 text-xs', toneClasses.text)}>Live</div>
    </div>
  );
}
