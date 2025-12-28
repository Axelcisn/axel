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

// Event type for trade actions on a date
type TradeCardEventType = 'open' | 'close';

export interface TradeCardEvent {
  type: TradeCardEventType;
  runLabel: string;
  side: 'long' | 'short';
  entryDate: string;
  entryPrice: number;
  exitDate?: string;
  exitPrice?: number;
  netPnl?: number;
  margin?: number;
}

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
  
  // NEW: Selected chart date and all events on that date
  date?: string;
  events?: TradeCardEvent[];

// NEW: engine-level fields from CfdTrade
  openingEquity?: number;
  closingEquity?: number;
  grossPnl?: number;
  swapFees?: number;
  fxFees?: number;
}

interface TradeDetailCardProps {
  trade: TradeDetailData;
  isDarkMode: boolean;
  onClose: () => void;
}

/**
 * CFD-style detail card that appears when clicking on a trade marker.
 * Shows comprehensive trade information similar to a broker CFD interface.
 */
export const TradeDetailCard: React.FC<TradeDetailCardProps> = ({
  trade,
  isDarkMode,
  onClose,
}) => {
  const isLong = trade.side === 'long';

  // =========================================================================
  // Derived metrics
  // =========================================================================
  
  // Opening/closing equity (fallback to approximation if not provided)
  const openingEquity = trade.openingEquity ?? (trade.margin + trade.netPnl);
  const closingEquity = trade.closingEquity ?? (openingEquity + trade.netPnl);

  // Gross P&L (fallback: estimate from price diff and assumed leverage)
  const leverage = 5; // TODO: pipe config.leverage into TradeDetailData if desired
  const grossPnl = trade.grossPnl ?? 
    (trade.exitPrice - trade.entryPrice) * (trade.margin ? (trade.margin * leverage) / trade.entryPrice : 0) * (isLong ? 1 : -1);
  
  // Fees
  const swapFees = trade.swapFees ?? 0;
  const fxFees = trade.fxFees ?? 0;

  // Net trade P&L including swap and FX
  const netTradePnl = grossPnl + swapFees - fxFees;

  // Return on margin (trade-level)
  const returnOnMargin = trade.margin ? netTradePnl / trade.margin : 0;

  // Return on equity (account-level)
  const returnOnEquity = openingEquity ? (closingEquity - openingEquity) / openingEquity : 0;

  // Position size as % of equity
  const positionPct = openingEquity ? trade.margin / openingEquity : 0;

  // Notional value (exposure)
  const exposure = trade.margin * leverage;

  // Units = exposure / entryPrice
  const units = trade.entryPrice ? exposure / trade.entryPrice : 0;

  // Holding period
  const holdingDays = Math.max(
    0,
    Math.round(
      (new Date(trade.exitDate).getTime() - new Date(trade.entryDate).getTime()) /
      (1000 * 60 * 60 * 24)
    )
  );

  // Result colors
  const isGain = netTradePnl >= 0;

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

        {/* Gross P&L Banner */}
        <div className="px-4 py-3 border-b border-slate-800/60">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Gross P&amp;L
            </span>
            <span
              className={
                "text-lg font-semibold font-mono tabular-nums " +
                (netTradePnl >= 0 ? "text-emerald-400" : "text-rose-400")
              }
            >
              {netTradePnl >= 0 ? "+" : "-"}${Math.abs(netTradePnl).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Metrics Section */}
        <div className="px-4 pt-3 pb-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Metrics
          </div>
        </div>
        <div className="px-4 pb-2 space-y-1">
          <DetailRow
            label="Return on margin"
            value={`${(returnOnMargin * 100).toFixed(1)}%`}
            valueColor={returnOnMargin >= 0 ? 'text-emerald-400' : 'text-rose-400'}
            isDarkMode={isDarkMode}
          />
          <DetailRow
            label="Return on equity"
            value={`${(returnOnEquity * 100).toFixed(1)}%`}
            valueColor={returnOnEquity >= 0 ? 'text-emerald-400' : 'text-rose-400'}
            isDarkMode={isDarkMode}
          />
        </div>

        {/* Position Section */}
        <div className="px-4 pt-3 pb-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Position
          </div>
        </div>
        <div className="px-4 pb-2 space-y-1">
          <DetailRow label="Opening balance" value={`$${openingEquity.toFixed(2)}`} isDarkMode={isDarkMode} />
          <DetailRow label="Closing balance" value={`$${closingEquity.toFixed(2)}`} isDarkMode={isDarkMode} />
          <DetailRow label="Position size" value={`${(positionPct * 100).toFixed(1)}%`} isDarkMode={isDarkMode} />
          <DetailRow label="Margin used" value={`$${trade.margin.toFixed(2)}`} isDarkMode={isDarkMode} />
          <DetailRow label="Leverage" value={`${leverage.toFixed(1)}x`} isDarkMode={isDarkMode} />
          <DetailRow label="Notional value" value={`$${exposure.toFixed(2)}`} isDarkMode={isDarkMode} />
        </div>

        {/* Trade details Section */}
        <div className="px-4 pt-3 pb-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Trade details
          </div>
        </div>
        <div className="px-4 pb-2 space-y-1">
          <DetailRow label="Entry price" value={`$${trade.entryPrice.toFixed(2)}`} isDarkMode={isDarkMode} />
          <DetailRow label="Entry date" value={formatDate(trade.entryDate)} isDarkMode={isDarkMode} />
          <DetailRow label="Units" value={units.toFixed(3)} isDarkMode={isDarkMode} />
          <DetailRow label="Exit price" value={`$${trade.exitPrice.toFixed(2)}`} isDarkMode={isDarkMode} />
          <DetailRow label="Exit date" value={formatDate(trade.exitDate)} isDarkMode={isDarkMode} />
          <DetailRow label="Holding period" value={`${holdingDays} days`} isDarkMode={isDarkMode} />
        </div>

        {/* P&L & fees Section */}
        <div className="px-4 pt-3 pb-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            P&amp;L &amp; fees
          </div>
        </div>
        <div className="px-4 pb-3 space-y-1">
          <DetailRow
            label="Gross P&L"
            value={`${grossPnl >= 0 ? '+' : '-'}$${Math.abs(grossPnl).toFixed(2)}`}
            valueColor={grossPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}
            isDarkMode={isDarkMode}
          />
          <DetailRow label="FX fee" value={`-$${Math.abs(fxFees).toFixed(2)}`} isDarkMode={isDarkMode} />
          <DetailRow
            label="Overnight interest"
            value={`${swapFees >= 0 ? '+' : '-'}$${Math.abs(swapFees).toFixed(2)}`}
            valueColor={swapFees >= 0 ? 'text-emerald-400' : 'text-rose-400'}
            isDarkMode={isDarkMode}
          />
          <DetailRow
            label="Net trade result"
            value={`${netTradePnl >= 0 ? '+' : '-'}$${Math.abs(netTradePnl).toFixed(2)}`}
            valueColor={isGain ? 'text-emerald-400' : 'text-rose-400'}
            isDarkMode={isDarkMode}
          />
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
      className={`text-xs font-mono tabular-nums ${
        valueColor ?? (isDarkMode ? 'text-slate-200' : 'text-gray-700')
      }`}
    >
      {value}
    </span>
  </div>
);

export default TradeDetailCard;
