'use client';

import React from 'react';

// Simple X icon component
const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

// Trade data passed to the detail card
export interface TradeDetailData {
  // Position info
  side: 'long' | 'short';
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  
  // Financial metrics
  netPnl: number;
  margin: number;
  
  // Run info
  runId: string;
  runLabel: string;
  
  // Optional: ticker symbol
  ticker?: string;
}

interface TradeDetailCardProps {
  trade: TradeDetailData;
  isDarkMode: boolean;
  onClose: () => void;
}

/**
 * Trading212-style detail card that appears when clicking on a trade marker.
 * Shows comprehensive trade information similar to the Trading212 CFD interface.
 */
export const TradeDetailCard: React.FC<TradeDetailCardProps> = ({
  trade,
  isDarkMode,
  onClose,
}) => {
  const isLong = trade.side === 'long';
  const isGain = trade.netPnl >= 0;
  const pnlPct = trade.margin ? (trade.netPnl / trade.margin) * 100 : 0;

  // Format date as "07 Apr 2025"
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00Z');
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  };

  // Calculate holding period in days
  const holdingDays = () => {
    const entry = new Date(trade.entryDate);
    const exit = new Date(trade.exitDate);
    const diffTime = Math.abs(exit.getTime() - entry.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Card */}
      <div
        className={`relative w-[340px] rounded-xl shadow-2xl border ${
          isDarkMode
            ? 'bg-slate-900 border-slate-700'
            : 'bg-white border-gray-200'
        }`}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${
          isDarkMode ? 'border-slate-700' : 'border-gray-200'
        }`}>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase ${
                isLong
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-rose-500/20 text-rose-400'
              }`}
            >
              {isLong ? 'Long' : 'Short'}
            </span>
            {trade.ticker && (
              <span className={`text-sm font-medium ${
                isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
                {trade.ticker}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className={`p-1 rounded-lg transition-colors ${
              isDarkMode
                ? 'hover:bg-slate-700 text-slate-400'
                : 'hover:bg-gray-100 text-gray-500'
            }`}
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Result Banner */}
        <div className={`px-4 py-3 border-b ${
          isDarkMode ? 'border-slate-700' : 'border-gray-200'
        }`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium uppercase tracking-wide ${
              isDarkMode ? 'text-slate-400' : 'text-gray-500'
            }`}>
              Result
            </span>
            <span
              className={`text-xl font-bold font-mono tabular-nums ${
                isGain ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {trade.netPnl >= 0 ? '+' : '-'}${Math.abs(trade.netPnl).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Details Section */}
        <div className="px-4 py-3 space-y-2">
          {/* P&L Breakdown */}
          <DetailRow
            label="Profit/Loss"
            value={`${trade.netPnl >= 0 ? '+' : '-'}$${Math.abs(trade.netPnl).toFixed(2)}`}
            valueColor={isGain ? 'text-emerald-400' : 'text-rose-400'}
            isDarkMode={isDarkMode}
          />
          
          <DetailRow
            label="Return on Margin"
            value={`${pnlPct >= 0 ? '+' : '-'}${Math.abs(pnlPct).toFixed(1)}%`}
            valueColor={isGain ? 'text-emerald-400' : 'text-rose-400'}
            isDarkMode={isDarkMode}
          />

          {/* Divider */}
          <div className={`border-t my-2 ${isDarkMode ? 'border-slate-700' : 'border-gray-200'}`} />

          {/* Entry/Exit Details */}
          <DetailRow
            label="Entry Price"
            value={`$${trade.entryPrice.toFixed(2)}`}
            isDarkMode={isDarkMode}
          />
          
          <DetailRow
            label="Exit Price"
            value={`$${trade.exitPrice.toFixed(2)}`}
            isDarkMode={isDarkMode}
          />

          <DetailRow
            label="Entry Date"
            value={formatDate(trade.entryDate)}
            isDarkMode={isDarkMode}
          />

          <DetailRow
            label="Exit Date"
            value={formatDate(trade.exitDate)}
            isDarkMode={isDarkMode}
          />

          {/* Divider */}
          <div className={`border-t my-2 ${isDarkMode ? 'border-slate-700' : 'border-gray-200'}`} />

          {/* Position Info */}
          <DetailRow
            label="Margin Used"
            value={`$${trade.margin.toFixed(2)}`}
            isDarkMode={isDarkMode}
          />

          <DetailRow
            label="Holding Period"
            value={`${holdingDays()} day${holdingDays() !== 1 ? 's' : ''}`}
            isDarkMode={isDarkMode}
          />

          <DetailRow
            label="Strategy"
            value={trade.runLabel}
            isDarkMode={isDarkMode}
          />
        </div>

        {/* Footer */}
        <div className={`px-4 py-3 border-t ${
          isDarkMode ? 'border-slate-700 bg-slate-800/50' : 'border-gray-200 bg-gray-50'
        }`}>
          <p className={`text-[10px] ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`}>
            Simulated trade based on EWMA signal strategy. Does not include fees or slippage.
          </p>
        </div>
      </div>
    </div>
  );
};

// Helper component for detail rows
interface DetailRowProps {
  label: string;
  value: string;
  valueColor?: string;
  isDarkMode: boolean;
}

const DetailRow: React.FC<DetailRowProps> = ({
  label,
  value,
  valueColor,
  isDarkMode,
}) => (
  <div className="flex items-center justify-between">
    <span className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
      {label}
    </span>
    <span
      className={`text-sm font-mono tabular-nums ${
        valueColor ?? (isDarkMode ? 'text-slate-200' : 'text-gray-700')
      }`}
    >
      {value}
    </span>
  </div>
);

export default TradeDetailCard;
