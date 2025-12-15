'use client';

import { useEffect, useMemo, useState } from 'react';
import PortfolioSummaryStrip from '@/components/portfolio/PortfolioSummaryStrip';
import PortfolioTabs from '@/components/portfolio/PortfolioTabs';
import PortfolioToolbar from '@/components/portfolio/PortfolioToolbar';
import PortfolioTable, { SortDirection, SortField } from '@/components/portfolio/PortfolioTable';
import Sparkline from '@/components/portfolio/Sparkline';
import PortfolioValuePerformancePanel from '@/components/portfolio/PortfolioValuePerformancePanel';
import { fetchPortfolioData, fetchPortfolioEquitySeries } from '@/lib/portfolio/data';
import {
  PortfolioBalance,
  PortfolioDataResponse,
  PortfolioEquitySeries,
  PortfolioOrder,
  PortfolioPosition,
  PortfolioSummary,
  PortfolioTab,
  PortfolioTrade,
} from '@/lib/portfolio/types';
import { formatCurrency, formatNumber, toneForNumber } from '@/lib/portfolio/format';
import {
  DIVIDER,
  HEADER_BG,
  MUTED,
  ROW_ALT,
  ROW_HOVER,
  SURFACE,
  SURFACE_INNER,
  TEXT,
} from '@/components/portfolio/portfolioTheme';

interface PortfolioClientProps {
  initialData?: PortfolioDataResponse;
}

const stickyHeader = `${HEADER_BG} backdrop-blur text-[12px] font-semibold uppercase tracking-wide text-white/70 border-b ${DIVIDER}`;
const ignoredErrors = ['ibkr bridge not configured'];

function normalizeError(message: string | null | undefined): string | null {
  if (!message) return null;
  const lower = message.toLowerCase();
  return ignoredErrors.some((token) => lower.includes(token)) ? null : message;
}

export default function PortfolioClient({ initialData }: PortfolioClientProps) {
  const [activeTab, setActiveTab] = useState<PortfolioTab>('positions');
  const [viewMode, setViewMode] = useState<string>('default');
  const [sortMode, setSortMode] = useState<string>('alphabetical');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [sortField, setSortField] = useState<SortField>('companyName');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const [summary, setSummary] = useState<PortfolioSummary | null>(initialData?.summary ?? null);
  const [positions, setPositions] = useState<PortfolioPosition[]>(initialData?.positions ?? []);
  const [orders, setOrders] = useState<PortfolioOrder[]>(initialData?.orders ?? []);
  const [trades, setTrades] = useState<PortfolioTrade[]>(initialData?.trades ?? []);
  const [balances, setBalances] = useState<PortfolioBalance[]>(initialData?.balances ?? []);
  const [equitySeries, setEquitySeries] = useState<PortfolioEquitySeries>([]);

  const [loading, setLoading] = useState<Record<PortfolioTab, boolean>>({
    positions: false,
    orders: false,
    trades: false,
    balances: false,
  });
  const [error, setError] = useState<string | null>(normalizeError(initialData?.error));
  const [equityLoading, setEquityLoading] = useState<boolean>(true);

  useEffect(() => {
    if (sortMode === 'alphabetical') {
      setSortField('companyName');
      setSortDirection('asc');
    } else if (sortMode === 'pnl') {
      setSortField('dailyPnl');
      setSortDirection('desc');
    } else if (sortMode === 'size') {
      setSortField('marketValue');
      setSortDirection('desc');
    }
  }, [sortMode]);

  useEffect(() => {
    let cancelled = false;

    const loadEquitySeries = async (showSkeleton: boolean) => {
      if (showSkeleton) {
        setEquityLoading(true);
      }

      try {
        const series = await fetchPortfolioEquitySeries();
        if (!cancelled) {
          setEquitySeries(series);
        }
      } catch (err) {
        // Ignore errors; UI will keep the last known series
        console.error('Failed to fetch portfolio equity series', err);
      } finally {
        if (!cancelled && showSkeleton) {
          setEquityLoading(false);
        }
      }
    };

    loadEquitySeries(true);
    const id = setInterval(() => loadEquitySeries(false), 60000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading((prev) => ({ ...prev, [activeTab]: true }));
      try {
        const data = await fetchPortfolioData(activeTab);
        if (cancelled) return;

        setError(normalizeError(data.error));

        if (activeTab === 'positions') {
          setSummary(data.summary ?? null);
          setPositions(data.positions ?? []);
        } else if (activeTab === 'orders') {
          setOrders(data.orders ?? []);
        } else if (activeTab === 'trades') {
          setTrades(data.trades ?? []);
        } else if (activeTab === 'balances') {
          setBalances(data.balances ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(normalizeError('Unable to refresh portfolio data.'));
          if (activeTab === 'positions') {
            setSummary(null);
            setPositions([]);
          } else if (activeTab === 'orders') {
            setOrders([]);
          } else if (activeTab === 'trades') {
            setTrades([]);
          } else if (activeTab === 'balances') {
            setBalances([]);
          }
        }
      } finally {
        if (!cancelled) {
          setLoading((prev) => ({ ...prev, [activeTab]: false }));
        }
      }
    };

    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeTab]);

  const filteredPositions = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return positions;
    return positions.filter(
      (row) =>
        row.symbol.toLowerCase().includes(term) || row.companyName.toLowerCase().includes(term),
    );
  }, [positions, searchTerm]);

  const sortedPositions = useMemo(() => {
    const sorted = [...filteredPositions];
    sorted.sort((a, b) => {
      let result = 0;
      switch (sortField) {
        case 'companyName':
          result = a.companyName.localeCompare(b.companyName);
          break;
        case 'symbol':
          result = a.symbol.localeCompare(b.symbol);
          break;
        case 'position':
          result = a.position - b.position;
          break;
        case 'dailyPnl':
          result = a.dailyPnl - b.dailyPnl;
          break;
        case 'marketValue':
          result = a.marketValue - b.marketValue;
          break;
        case 'unrealizedPnl':
          result = a.unrealizedPnl - b.unrealizedPnl;
          break;
        default:
          result = 0;
      }
      return sortDirection === 'asc' ? result : -result;
    });
    return sorted;
  }, [filteredPositions, sortDirection, sortField]);

  const totals = useMemo(
    () =>
      filteredPositions.reduce(
        (acc, row) => {
          acc.costBasis += row.costBasis;
          acc.marketValue += row.marketValue;
          acc.dailyPnl += row.dailyPnl;
          acc.unrealizedPnl += row.unrealizedPnl;
          return acc;
        },
        { costBasis: 0, marketValue: 0, dailyPnl: 0, unrealizedPnl: 0 },
      ),
    [filteredPositions],
  );

  const handleSort = (field: SortField) => {
    setSortField((current) => {
      if (current === field) {
        setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
        return current;
      }
      setSortDirection(field === 'companyName' ? 'asc' : 'desc');
      return field;
    });
  };

  const toggleRow = (symbol: string) => {
    setSelectedRows((prev) =>
      prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol],
    );
  };

  const secondaryShell = `relative overflow-x-auto rounded-2xl ${SURFACE}`;

  const formatTime = (timestamp: string) =>
    new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    }).format(new Date(timestamp));

  return (
    <div className="space-y-4">
      {summary && <PortfolioSummaryStrip summary={summary} />}

      {equityLoading ? (
        <div className={`h-[520px] w-full rounded-3xl ${SURFACE} animate-pulse`} />
      ) : (
        <PortfolioValuePerformancePanel series={equitySeries} />
      )}

      <div className={`overflow-hidden rounded-2xl ${SURFACE}`}>
        <PortfolioTabs activeTab={activeTab} onChange={(tab) => setActiveTab(tab)} />
        <div className={`space-y-3 px-4 py-3 ${SURFACE_INNER}`}>
          <PortfolioToolbar
            viewMode={viewMode}
            sortMode={sortMode}
            searchTerm={searchTerm}
            onViewModeChange={setViewMode}
            onSortModeChange={setSortMode}
            onSearchChange={setSearchTerm}
          />

          {activeTab === 'positions' && (
            <PortfolioTable
              positions={sortedPositions}
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
              totals={totals}
              selectedRows={selectedRows}
              onToggleRow={toggleRow}
              isLoading={loading.positions}
            />
          )}

          {activeTab === 'orders' && (
            <div className={secondaryShell}>
              <table className="min-w-[800px] w-full border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className={`${stickyHeader} px-3 py-2 text-left`}>Order</th>
                    <th className={`${stickyHeader} px-3 py-2 text-left`}>Symbol</th>
                    <th className={`${stickyHeader} px-3 py-2 text-left`}>Side</th>
                    <th className={`${stickyHeader} px-3 py-2 text-right`}>Quantity</th>
                    <th className={`${stickyHeader} px-3 py-2 text-right`}>Filled</th>
                    <th className={`${stickyHeader} px-3 py-2 text-right`}>Limit</th>
                    <th className={`${stickyHeader} px-3 py-2 text-left`}>Status</th>
                    <th className={`${stickyHeader} px-3 py-2 text-left`}>Created</th>
                  </tr>
                </thead>
                <tbody className="bg-transparent text-sm text-white/85">
                  {orders.map((order) => (
                    <tr
                      key={order.id}
                      className={`border-b ${DIVIDER} ${ROW_ALT} ${ROW_HOVER}`}
                    >
                      <td className="px-3 py-2 font-semibold text-white">{order.id}</td>
                      <td className="px-3 py-2">{order.symbol}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            order.side === 'buy'
                              ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/30'
                              : 'bg-rose-500/20 text-rose-200 border border-rose-500/30'
                          }`}
                        >
                          {order.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(order.quantity, 0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(order.filledQuantity ?? 0, 0)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {order.limitPrice ? formatCurrency(order.limitPrice) : '—'}
                      </td>
                      <td className="px-3 py-2 capitalize text-white/70">{order.status.replace('_', ' ')}</td>
                      <td className="px-3 py-2 text-white/60">{formatTime(order.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {loading.orders && (
                <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" aria-label="Loading orders" />
              )}
            </div>
          )}

          {activeTab === 'trades' && (
            <div className={secondaryShell}>
              <table className="min-w-[800px] w-full border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className={`${stickyHeader} px-3 py-2 text-left`}>Trade</th>
                    <th className={`${stickyHeader} px-3 py-2 text-left`}>Symbol</th>
                    <th className={`${stickyHeader} px-3 py-2 text-left`}>Side</th>
                    <th className={`${stickyHeader} px-3 py-2 text-right`}>Quantity</th>
                    <th className={`${stickyHeader} px-3 py-2 text-right`}>Price</th>
                    <th className={`${stickyHeader} px-3 py-2 text-right`}>Value</th>
                    <th className={`${stickyHeader} px-3 py-2 text-left`}>Venue</th>
                    <th className={`${stickyHeader} px-3 py-2 text-left`}>Time</th>
                  </tr>
                </thead>
                <tbody className="bg-transparent text-sm text-white/85">
                  {trades.map((trade) => (
                    <tr
                      key={trade.id}
                      className={`border-b ${DIVIDER} ${ROW_ALT} ${ROW_HOVER}`}
                    >
                      <td className="px-3 py-2 font-semibold text-white">{trade.id}</td>
                      <td className="px-3 py-2">{trade.symbol}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            trade.side === 'buy'
                              ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/30'
                              : 'bg-rose-500/20 text-rose-200 border border-rose-500/30'
                          }`}
                        >
                          {trade.side.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(trade.quantity, 0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(trade.price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(trade.value, 0)}</td>
                      <td className="px-3 py-2 text-white/60">{trade.venue ?? '—'}</td>
                      <td className="px-3 py-2 text-white/60">{formatTime(trade.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {loading.trades && (
                <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" aria-label="Loading trades" />
              )}
            </div>
          )}

          {activeTab === 'balances' && (
            <div className={secondaryShell}>
              <table className="min-w-[700px] w-full border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className={`${stickyHeader} px-3 py-2 text-left`}>Currency</th>
                    <th className={`${stickyHeader} px-3 py-2 text-right`}>Cash</th>
                    <th className={`${stickyHeader} px-3 py-2 text-right`}>Available</th>
                    <th className={`${stickyHeader} px-3 py-2 text-right`}>Excess Liquidity</th>
                    <th className={`${stickyHeader} px-3 py-2 text-right`}>Net Liquidation</th>
                    <th className={`${stickyHeader} px-3 py-2 text-right`}>Unrealized P&L</th>
                    <th className={`${stickyHeader} px-3 py-2 text-left`}>Trend</th>
                  </tr>
                </thead>
                <tbody className="bg-transparent text-sm text-white/85">
                  {balances.map((balance) => (
                    <tr
                      key={balance.currency}
                      className={`border-b ${DIVIDER} ${ROW_ALT} ${ROW_HOVER}`}
                    >
                      <td className="px-3 py-2 font-semibold text-white">{balance.currency}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(balance.cash, 0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(balance.availableFunds, 0)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(balance.excessLiquidity, 0)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(balance.netLiquidation, 0)}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${toneForNumber(balance.unrealizedPnl ?? 0)}`}>
                        {balance.unrealizedPnl != null ? formatCurrency(balance.unrealizedPnl, 0) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <Sparkline data={balance.trend ?? []} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {loading.balances && (
                <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" aria-label="Loading balances" />
              )}
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
