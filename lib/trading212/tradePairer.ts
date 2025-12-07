/**
 * Trade Pairer for Trading212 fills.
 * 
 * Uses FIFO (First-In-First-Out) logic to pair BUY and SELL fills
 * into entry/exit trades with calculated P&L.
 */

import type { T212SimpleTrade } from "./tradesClient";

// ---- Paired Trade Type ----

export interface T212PairedTrade {
  id: string;
  ticker: string;
  side: "long" | "short";
  entryDate: string;      // ISO date (YYYY-MM-DD)
  exitDate: string | null; // null if position still open
  quantity: number;
  entryPrice: number;
  exitPrice: number | null;
  realisedPnl: number | null;
  currency: string;
  // Original fill IDs for provenance
  entryFillIds: number[];
  exitFillIds: number[];
}

// ---- FIFO Pairing Logic ----

interface OpenPosition {
  fillId: number;
  filledAt: string;
  quantity: number;
  price: number;
}

/**
 * Pair raw T212 fills into entry/exit trades using FIFO.
 * 
 * Logic:
 * - BUY fills open long positions (or close short positions)
 * - SELL fills close long positions (or open short positions)
 * - Positions are matched FIFO by date
 * 
 * For simplicity, we assume the user trades only one direction at a time
 * (no simultaneous long and short positions on the same instrument).
 */
export function pairTrades(fills: T212SimpleTrade[]): T212PairedTrade[] {
  if (fills.length === 0) return [];

  // Sort fills by date ascending
  const sortedFills = [...fills].sort(
    (a, b) => new Date(a.filledAt).getTime() - new Date(b.filledAt).getTime()
  );

  const ticker = sortedFills[0].ticker;
  const currency = sortedFills[0].currency;

  // Track open positions (FIFO queue)
  const openLongs: OpenPosition[] = [];
  const openShorts: OpenPosition[] = [];

  const pairedTrades: T212PairedTrade[] = [];
  let tradeCounter = 0;

  for (const fill of sortedFills) {
    const isBuy = fill.side === "BUY";
    let remainingQty = fill.quantity;

    if (isBuy) {
      // First, close any open short positions (FIFO)
      while (remainingQty > 0 && openShorts.length > 0) {
        const shortPos = openShorts[0];
        const matchQty = Math.min(remainingQty, shortPos.quantity);

        // Calculate P&L: for closing a short, profit = (entry - exit) * qty
        const pnl = (shortPos.price - fill.price) * matchQty;

        pairedTrades.push({
          id: `${ticker}-${++tradeCounter}`,
          ticker,
          side: "short",
          entryDate: shortPos.filledAt.substring(0, 10),
          exitDate: fill.filledAt.substring(0, 10),
          quantity: matchQty,
          entryPrice: shortPos.price,
          exitPrice: fill.price,
          realisedPnl: pnl,
          currency,
          entryFillIds: [shortPos.fillId],
          exitFillIds: [fill.id],
        });

        remainingQty -= matchQty;
        shortPos.quantity -= matchQty;

        if (shortPos.quantity <= 0) {
          openShorts.shift();
        }
      }

      // Any remaining BUY quantity opens a new long position
      if (remainingQty > 0) {
        openLongs.push({
          fillId: fill.id,
          filledAt: fill.filledAt,
          quantity: remainingQty,
          price: fill.price,
        });
      }
    } else {
      // SELL
      // First, close any open long positions (FIFO)
      while (remainingQty > 0 && openLongs.length > 0) {
        const longPos = openLongs[0];
        const matchQty = Math.min(remainingQty, longPos.quantity);

        // Calculate P&L: for closing a long, profit = (exit - entry) * qty
        const pnl = (fill.price - longPos.price) * matchQty;

        pairedTrades.push({
          id: `${ticker}-${++tradeCounter}`,
          ticker,
          side: "long",
          entryDate: longPos.filledAt.substring(0, 10),
          exitDate: fill.filledAt.substring(0, 10),
          quantity: matchQty,
          entryPrice: longPos.price,
          exitPrice: fill.price,
          realisedPnl: pnl,
          currency,
          entryFillIds: [longPos.fillId],
          exitFillIds: [fill.id],
        });

        remainingQty -= matchQty;
        longPos.quantity -= matchQty;

        if (longPos.quantity <= 0) {
          openLongs.shift();
        }
      }

      // Any remaining SELL quantity opens a new short position
      if (remainingQty > 0) {
        openShorts.push({
          fillId: fill.id,
          filledAt: fill.filledAt,
          quantity: remainingQty,
          price: fill.price,
        });
      }
    }
  }

  // Add any remaining open positions as "OPEN" trades (no exit yet)
  for (const longPos of openLongs) {
    pairedTrades.push({
      id: `${ticker}-${++tradeCounter}`,
      ticker,
      side: "long",
      entryDate: longPos.filledAt.substring(0, 10),
      exitDate: null,
      quantity: longPos.quantity,
      entryPrice: longPos.price,
      exitPrice: null,
      realisedPnl: null,
      currency,
      entryFillIds: [longPos.fillId],
      exitFillIds: [],
    });
  }

  for (const shortPos of openShorts) {
    pairedTrades.push({
      id: `${ticker}-${++tradeCounter}`,
      ticker,
      side: "short",
      entryDate: shortPos.filledAt.substring(0, 10),
      exitDate: null,
      quantity: shortPos.quantity,
      entryPrice: shortPos.price,
      exitPrice: null,
      realisedPnl: null,
      currency,
      entryFillIds: [shortPos.fillId],
      exitFillIds: [],
    });
  }

  // Sort by entry date descending (most recent first)
  return pairedTrades.sort(
    (a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime()
  );
}

// ---- Summary Statistics ----

export interface PairedTradesSummary {
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  totalPnl: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number; // 0-1
  avgWin: number;
  avgLoss: number;
  profitFactor: number; // gross profit / gross loss
}

export function summarizePairedTrades(trades: T212PairedTrade[]): PairedTradesSummary {
  const closedTrades = trades.filter((t) => t.exitDate !== null);
  const openTrades = trades.filter((t) => t.exitDate === null);

  const winning = closedTrades.filter((t) => (t.realisedPnl ?? 0) > 0);
  const losing = closedTrades.filter((t) => (t.realisedPnl ?? 0) < 0);

  const grossProfit = winning.reduce((sum, t) => sum + (t.realisedPnl ?? 0), 0);
  const grossLoss = Math.abs(losing.reduce((sum, t) => sum + (t.realisedPnl ?? 0), 0));

  return {
    totalTrades: trades.length,
    closedTrades: closedTrades.length,
    openTrades: openTrades.length,
    totalPnl: closedTrades.reduce((sum, t) => sum + (t.realisedPnl ?? 0), 0),
    winningTrades: winning.length,
    losingTrades: losing.length,
    winRate: closedTrades.length > 0 ? winning.length / closedTrades.length : 0,
    avgWin: winning.length > 0 ? grossProfit / winning.length : 0,
    avgLoss: losing.length > 0 ? grossLoss / losing.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
  };
}
