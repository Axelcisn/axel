'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { AlertFire, WatchlistRow, WatchlistSummary } from '@/lib/watchlist/types';
import type { Quote } from '@/lib/types/quotes';

type CompanyMap = Record<string, { name?: string; exchange?: string }>;
type QuoteMap = Record<string, Quote | null>;

type TableRow = {
  symbol: string;
  name: string;
  bidSize: number | null;
  bid: number | null;
  ask: number | null;
  askSize: number | null;
  last: number | null;
  change: number | null;
  changePct: number | null;
  trendPoints: number[];
  source: WatchlistRow;
};

const defaultTrend = [0.4, 0.48, 0.45, 0.5, 0.46, 0.52, 0.5, 0.56, 0.53];

function formatNumber(value: number | null, decimals = 2) {
  if (value === null || Number.isNaN(value)) return '—';
  return value.toFixed(decimals);
}

function formatChange(value: number | null) {
  if (value === null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

function formatPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—';
  const safe = Number(value);
  if (!Number.isFinite(safe)) return '—';
  const sign = safe > 0 ? '+' : '';
  return `${sign}${safe.toFixed(2)}%`;
}

function buildTableRow(row: WatchlistRow, company: CompanyMap[string], quote?: Quote | null): TableRow {
  const bid = row.bands.L_1 ?? null;
  const ask = row.bands.U_1 ?? null;
  const last = quote?.price ?? ask ?? bid ?? row.forecast.T_hat_median ?? null;
  const change = quote?.change ?? row.deviation.z_B ?? null;
  const changePct = quote?.changePct ?? (row.deviation.pct_outside_B != null ? row.deviation.pct_outside_B * 100 : null);
  const bidSize = row.deviation.vol_regime_pct != null ? Math.round(row.deviation.vol_regime_pct * 100) : null;
  const askSize = row.forecast.I60 ? Math.round(row.forecast.I60[1]) : null;
  const trendPoints = Object.values(row.forecast.P_ge_k || {}).length
    ? Object.values(row.forecast.P_ge_k || {}).slice(0, 12).map((v) => (typeof v === 'number' ? v : 0.5))
    : defaultTrend;

  return {
    symbol: row.symbol,
    name: company?.name || row.symbol,
    bidSize,
    bid,
    ask,
    askSize,
    last,
    change,
    changePct,
    trendPoints,
    source: row,
  };
}

function TrendArrow({ positive }: { positive: boolean }) {
  return (
    <div
      className={`flex h-8 w-8 items-center justify-center rounded-md ${
        positive ? 'bg-emerald-900/30 text-emerald-400' : 'bg-rose-900/25 text-rose-400'
      }`}
    >
      <span className="text-lg">{positive ? '↑' : '↓'}</span>
    </div>
  );
}

function DetailPanel({ row, company }: { row: TableRow | null; company?: CompanyMap[string] }) {
  if (!row) {
    return (
      <div className="rounded-xl bg-[#0d1019] p-4 text-slate-300 shadow-inner shadow-black/30">
        <p className="text-sm">Select a symbol to view details.</p>
      </div>
    );
  }

  const metrics = [
    { label: 'Opening Price', value: formatNumber(row.source.bands.L_1) },
    { label: 'High', value: formatNumber(row.source.bands.U_1) },
    { label: 'T̂ (days)', value: formatNumber(row.source.forecast.T_hat_median) },
    { label: 'Next Review', value: row.source.forecast.next_review_date || '—' },
    { label: 'Coverage', value: formatPercent(row.source.quality.pi_coverage_250d) },
    { label: 'Regime', value: row.source.quality.regime?.id ?? '—' },
  ];

  return (
    <div className="rounded-xl border border-slate-800/70 bg-transparent p-4 shadow-inner shadow-black/30">
      <div className="flex items-start justify-between border-b border-slate-800/70 px-4 py-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">{company?.name || row.symbol}</p>
          <h2 className="text-3xl font-semibold text-slate-100">{row.symbol}</h2>
          <p className="text-xs text-slate-500">Realtime price: non-consolidated</p>
        </div>
        <div className="text-right">
          <div className="text-4xl font-semibold text-emerald-400">{formatNumber(row.last)}</div>
          <div className="text-sm text-slate-400">
            {formatChange(row.change)} ({formatPercent(row.changePct)})
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 border-b border-slate-800/70 px-4 py-3">
        <button className="flex-1 rounded-md bg-[#0f62fe] px-3 py-2 text-sm font-semibold text-white shadow hover:bg-[#0d55d8]">
          Buy Order
        </button>
        <button className="flex-1 rounded-md bg-[#d32f2f] px-3 py-2 text-sm font-semibold text-white shadow hover:bg-[#b92626]">
          Sell Order
        </button>
        <button className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800">
          ⚡
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-4 border-b border-slate-800/70 px-4 py-4 text-sm">
        {metrics.map((metric) => (
          <div key={metric.label} className="flex justify-between py-1">
            <span className="text-slate-400">{metric.label}</span>
            <span className="font-medium text-slate-100">{metric.value}</span>
          </div>
        ))}
      </div>

      <div className="px-4 py-4">
        <p className="mb-2 text-sm font-semibold text-slate-100">Trend</p>
        <TrendArrow positive={(row.change || 0) >= 0} />
      </div>
    </div>
  );
}

export default function WatchlistPage() {
  const [watchlistRows, setWatchlistRows] = useState<WatchlistRow[]>([]);
  const [watchlistSummary, setWatchlistSummary] = useState<WatchlistSummary | null>(null);
  const [isLoadingWatchlist, setIsLoadingWatchlist] = useState(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [firedAlerts, setFiredAlerts] = useState<AlertFire[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [companyMap, setCompanyMap] = useState<CompanyMap>({});
  const [quotes, setQuotes] = useState<QuoteMap>({});
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  const loadCompanies = useCallback(async () => {
    try {
      const response = await fetch('/api/companies');
      if (!response.ok) return;
      const companies = await response.json();
      const map: CompanyMap = {};
      companies.forEach((c: any) => {
        map[c.ticker] = { name: c.name, exchange: c.exchange };
      });
      setCompanyMap(map);
    } catch (error) {
      console.warn('Failed to load companies', error);
    }
  }, []);

  const loadQuotesForRows = useCallback(async (rows: WatchlistRow[]) => {
    const symbols = Array.from(new Set(rows.map((r) => r.symbol))).filter(Boolean);
    if (!symbols.length) return;

    const entries = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const res = await fetch(`/api/quotes/${encodeURIComponent(symbol)}`, { cache: 'no-store' });
          if (!res.ok) throw new Error('Quote fetch failed');
          const quote = (await res.json()) as Quote;
          return [symbol, quote] as const;
        } catch (err) {
          console.warn('Failed to load quote for', symbol, err);
          return [symbol, null] as const;
        }
      })
    );

    setQuotes((prev) => {
      const next = { ...prev };
      entries.forEach(([symbol, quote]) => {
        next[symbol] = quote;
      });
      return next;
    });
  }, []);

  const loadWatchlist = useCallback(async () => {
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
      setSelectedSymbol((prev) => prev || (rows.length ? rows[0].symbol : null));
      loadQuotesForRows(rows);
    } catch (error) {
      setWatchlistRows([]);
      setWatchlistSummary(null);
      setWatchlistError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setIsLoadingWatchlist(false);
    }
  }, [loadQuotesForRows]);

  const loadAlerts = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    loadWatchlist();
    loadAlerts();
    loadCompanies();
  }, [loadWatchlist, loadAlerts, loadCompanies]);

  const tableRows: TableRow[] = useMemo(
    () => watchlistRows.map((row) => buildTableRow(row, companyMap[row.symbol], quotes[row.symbol])),
    [watchlistRows, companyMap, quotes]
  );

  const selectedRow = useMemo(
    () => tableRows.find((row) => row.symbol === selectedSymbol) || null,
    [tableRows, selectedSymbol]
  );

  const asOfDisplay = watchlistSummary?.as_of
    ? new Date(watchlistSummary.as_of).toLocaleDateString()
    : '—';

  return (
    <main className="min-h-screen bg-transparent text-foreground">
      <div className="mx-auto w-full max-w-[1400px] px-6 md:px-10 py-4 space-y-3">
        {/* Top controls */}
        <div className="flex items-center justify-between text-sm font-semibold text-slate-200">
          <div className="flex items-center gap-6">
            <button className="pb-2 text-slate-400 hover:text-white">Tech Leaders</button>
            <button className="pb-2 text-slate-400 hover:text-white">Traded</button>
            <button className="border-b-2 border-[#2e7df6] pb-2 text-white">Stocks</button>
            <button className="text-lg leading-none text-slate-200 hover:text-white" title="Add category">
              +
            </button>
          </div>
          <div className="flex items-center gap-3 text-slate-200">
            <button className="flex items-center gap-2 rounded-full border border-slate-700 px-3 py-2 text-sm font-semibold hover:border-slate-500 hover:bg-slate-800/40">
              <span>Watchlist View</span>
              <svg className="h-4 w-4 text-slate-300" viewBox="0 0 20 20" fill="currentColor">
                <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 0 1 1.08 1.04l-4.25 4.25a.75.75 0 0 1-1.06 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z" />
              </svg>
            </button>
            <button
              className="group relative flex h-10 w-10 items-center justify-center rounded-full border border-slate-700/80 text-slate-200 transition hover:border-slate-400/80 hover:bg-slate-900/40 focus:outline-none focus:ring-2 focus:ring-slate-500/60"
              title="Settings"
            >
              <span className="pointer-events-none absolute inset-0 rounded-full border border-slate-800/60 group-hover:border-slate-500/60" />
              <span className="pointer-events-none absolute inset-[3px] rounded-full bg-gradient-to-b from-slate-900/70 to-slate-800/30 group-hover:from-slate-800/70 group-hover:to-slate-700/30" />
              <svg
                className="pointer-events-none relative h-5 w-5 text-slate-100 drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="2.6" />
                <path d="M19.2 12.8c.05-.26.08-.53.08-.8s-.03-.54-.08-.8l1.44-1.12a.5.5 0 0 0 .12-.64l-1.36-2.35a.5.5 0 0 0-.6-.22l-1.7.68a6.2 6.2 0 0 0-1.38-.8l-.26-1.8a.5.5 0 0 0-.5-.43h-2.72a.5.5 0 0 0-.5.43l-.26 1.8a6.2 6.2 0 0 0-1.38.8l-1.7-.68a.5.5 0 0 0-.6.22L3.24 9.44a.5.5 0 0 0 .12.64L4.8 11.2c-.05.26-.08.53-.08.8s.03.54.08.8l-1.44 1.12a.5.5 0 0 0-.12.64l1.36 2.35c.13.23.4.33.64.22l1.7-.68c.42.33.89.6 1.38.8l.26 1.8c.04.25.25.43.5.43h2.72c.25 0 .46-.18.5-.43l.26-1.8c.49-.2.96-.47 1.38-.8l1.7.68c.24.1.51 0 .64-.22l1.36-2.35a.5.5 0 0 0-.12-.64L19.2 12.8Z" />
              </svg>
            </button>
            <button
              className="group relative flex h-10 w-10 items-center justify-center rounded-full border border-slate-700/80 text-slate-200 transition hover:border-slate-400/80 hover:bg-slate-900/40 focus:outline-none focus:ring-2 focus:ring-slate-500/60"
              title="Refresh"
              onClick={loadWatchlist}
            >
              <span className="pointer-events-none absolute inset-0 rounded-full border border-slate-800/60 group-hover:border-slate-500/60" />
              <span className="pointer-events-none absolute inset-[3px] rounded-full bg-gradient-to-b from-slate-900/70 to-slate-800/30 group-hover:from-slate-800/70 group-hover:to-slate-700/30" />
              <svg
                className="pointer-events-none relative h-5 w-5 text-slate-100 drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 12a8 8 0 1 1-2.34-5.66" />
                <path d="M20 5v5h-5" />
              </svg>
            </button>
          </div>
        </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
          {/* Table */}
          <div className="overflow-hidden rounded-xl bg-transparent">
            {watchlistError ? (
              <div className="px-4 py-6 text-sm text-red-400">{watchlistError}</div>
            ) : (
              <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <div className="min-w-[980px]">
                  <table className="w-full divide-y divide-slate-800 text-sm text-slate-200">
                    <thead className="bg-transparent">
                      <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 whitespace-nowrap">
                        <th className="px-3 py-3">Financial Instrument</th>
                        <th className="px-3 py-3">Company Name</th>
                        <th className="px-3 py-3 text-center">Bid Size</th>
                        <th className="px-3 py-3">Bid</th>
                        <th className="px-3 py-3">Ask</th>
                        <th className="px-3 py-3 text-center">Ask Size</th>
                        <th className="px-3 py-3">Last</th>
                        <th className="px-3 py-3">Change</th>
                        <th className="px-3 py-3">Change %</th>
                        <th className="px-3 py-3">Trend</th>
                      </tr>
                    </thead>
                    <tbody className="whitespace-nowrap">
                      {tableRows.map((row) => {
                        const isSelected = row.symbol === selectedSymbol;
                        const hasDelta = row.change !== null && !Number.isNaN(row.change);
                        const positive = hasDelta ? (row.change as number) >= 0 : false;
                        const colorClass = hasDelta ? (positive ? 'text-emerald-400' : 'text-rose-400') : 'text-slate-400';
                        return (
                          <tr
                            key={row.symbol}
                            className={`cursor-pointer ${isSelected ? 'bg-slate-800/20' : ''} hover:bg-slate-800/20`}
                            onClick={() => setSelectedSymbol(row.symbol)}
                          >
                            <td className="px-3 py-3 font-semibold text-slate-100">{row.symbol}</td>
                            <td className="px-3 py-3 text-slate-200">{row.name}</td>
                            <td className="px-3 py-3 text-center text-slate-200">{row.bidSize ?? '—'}</td>
                            <td className="px-3 py-3 text-slate-200">{formatNumber(row.bid)}</td>
                            <td className="px-3 py-3 text-slate-200">{formatNumber(row.ask)}</td>
                            <td className="px-3 py-3 text-center text-slate-200">{row.askSize ?? '—'}</td>
                            <td className={`px-3 py-3 font-semibold ${colorClass}`}>{formatNumber(row.last)}</td>
                            <td className={`px-3 py-3 ${colorClass}`}>{formatChange(row.change)}</td>
                            <td className={`px-3 py-3 ${colorClass}`}>{formatPercent(row.changePct)}</td>
                            <td className="px-3 py-3">
                              <TrendArrow positive={hasDelta ? positive : true} />
                            </td>
                          </tr>
                        );
                      })}
                      {!tableRows.length && !isLoadingWatchlist && (
                        <tr>
                          <td colSpan={10} className="px-4 py-6 text-center text-slate-500">
                            No watchlist rows. Use the (+) action on a company page to add one.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Detail panel and alerts */}
          <div className="flex flex-col gap-4">
            <DetailPanel row={selectedRow} company={selectedRow ? companyMap[selectedRow.symbol] : undefined} />
          </div>
        </div>
      </div>
    </main>
  );
}
