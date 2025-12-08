/**
 * Trading212 CFD Simulation Engine
 * 
 * A pure simulation engine that models Trading212's CFD trading mechanics:
 * - Leverage-based margin trading
 * - Overnight swap fees (financing costs)
 * - Spread costs
 * - Margin call and stop-out levels
 * - Single-position strategy support
 */

// ============================================================================
// Types
// ============================================================================

export type Trading212Side = "long" | "short";

export type Trading212Signal = "long" | "short" | "flat";
// "flat" = no position desired for this bar

export interface Trading212CfdConfig {
  leverage: number;           // e.g. 5 for 1:5
  fxFeeRate: number;          // e.g. 0.005 for 0.5% FX fee (applied on realised P&L if we ever model FX)
  dailyLongSwapRate: number;  // per-day rate for long positions (approx, e.g. -0.0001)
  dailyShortSwapRate: number; // per-day rate for short positions
  spreadBps: number;          // round-trip spread in basis points (we'll approximate)
  marginCallLevel: number;    // e.g. 0.45 (45%)
  stopOutLevel: number;       // e.g. 0.25 (25%)
  positionFraction: number;   // fraction of equity to allocate as margin for a new position, e.g. 0.5
}

export interface Trading212SimBar {
  date: string;              // YYYY-MM-DD
  price: number;             // we'll use canonical close or adj_close
  signal: Trading212Signal;  // model's desired regime for this bar
}

export interface Trading212CfdPosition {
  side: Trading212Side;
  quantity: number;
  entryPrice: number;
  exposure: number;          // quantity * entryPrice
  margin: number;            // exposure / leverage
  entryDate: string;
  swapFees: number;          // per-position swap accumulation
  openingEquity: number;     // equity at the time the trade was opened
}

export interface Trading212AccountSnapshot {
  date: string;
  price: number;
  equity: number;            // Total Funds = freeCash + unrealised P&L
  freeCash: number;
  marginUsed: number;
  marginStatus: number;      // 0–100%, per Trading212 formula
  unrealisedPnl: number;
  realisedPnl: number;
  swapFeesAccrued: number;
  fxFeesAccrued: number;
  side: Trading212Side | null;
  quantity: number;
}

export interface Trading212Trade {
  entryDate: string;
  exitDate: string;
  side: Trading212Side;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;    // price-based
  swapFees: number;
  fxFees: number;
  netPnl: number;
  margin: number;      // exact margin used for this position
  openingEquity?: number;  // account equity before this trade opened
  closingEquity?: number;  // account equity after this trade closed
}

export interface Trading212SimulationResult {
  initialEquity: number;
  finalEquity: number;
  accountHistory: Trading212AccountSnapshot[];
  trades: Trading212Trade[];
  maxDrawdown: number;       // in decimal (e.g., 0.15 = 15%)
  marginCallEvents: number;
  stopOutEvents: number;
  swapFeesTotal: number;     // Total overnight swap fees (usually negative for longs)
  fxFeesTotal: number;       // Total FX conversion fees
  firstDate: string | null;
  lastDate: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute margin status per Trading212's piecewise definition:
 * - Above 50%: status = TotalFunds / (TotalFunds + Margin) * 100
 * - Below 50%: status = TotalFunds / Margin * 50
 * 
 * See: https://helpcentre.trading212.com/hc/en-us/articles/360008654957
 * 
 * @param equity - Total funds (free cash + unrealised P&L)
 * @param marginUsed - Margin currently locked for open positions
 * @returns Margin status as percentage (0-100)
 */
export function computeMarginStatus(equity: number, marginUsed: number): number {
  // No margin used => account is effectively "free" (no open positions)
  if (marginUsed <= 0) {
    return 100;
  }

  // Equity <= 0 => fully distressed, must stop out
  if (equity <= 0) {
    return 0;
  }

  // Above 50% branch: status = equity / (equity + margin) * 100
  const statusAbove50 = (equity / (equity + marginUsed)) * 100;

  if (statusAbove50 >= 50) {
    return Math.min(100, Math.max(0, statusAbove50));
  }

  // Below 50% branch: status = equity / margin * 50
  const statusBelow50 = (equity / marginUsed) * 50;
  return Math.min(100, Math.max(0, statusBelow50));
}

/**
 * Compute maximum drawdown from an equity series
 * Returns decimal (e.g., 0.15 = 15% drawdown)
 */
function computeMaxDrawdown(equitySeries: number[]): number {
  if (equitySeries.length === 0) return 0;
  let peak = equitySeries[0];
  let maxDd = 0;
  for (const value of equitySeries) {
    if (value > peak) peak = value;
    const dd = (peak - value) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

// ============================================================================
// Core Simulator
// ============================================================================

/**
 * Run a Trading212 CFD simulation over a series of bars.
 * 
 * Strategy: single-position, driven by signal per bar.
 * - signal = "long" => open/hold long
 * - signal = "short" => open/hold short
 * - signal = "flat" => close any position
 * 
 * @param bars - Array of simulation bars with date, price, and signal
 * @param initialEquity - Starting account equity
 * @param config - Trading212 CFD configuration
 * @returns Simulation result with account history, trades, and metrics
 */
export function simulateTrading212Cfd(
  bars: Trading212SimBar[],
  initialEquity: number,
  config: Trading212CfdConfig
): Trading212SimulationResult {
  let equity = initialEquity;
  let freeCash = initialEquity;
  let marginUsed = 0;
  let realisedPnl = 0;
  let swapFeesAccrued = 0;
  let fxFeesAccrued = 0;

  let position: Trading212CfdPosition | null = null;

  let marginCallEvents = 0;
  let stopOutEvents = 0;

  const history: Trading212AccountSnapshot[] = [];
  const trades: Trading212Trade[] = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const price = bar.price;

    // 1) Update unrealised P&L
    let unrealisedPnl = 0;
    if (position) {
      const diff = price - position.entryPrice;
      unrealisedPnl =
        position.side === "long" ? diff * position.quantity : -diff * position.quantity;
    }

    // 2) Update equity
    equity = freeCash + unrealisedPnl;

    // 3) Recompute margin status and check stop-out / margin call
    let marginStatus = computeMarginStatus(equity, marginUsed);

    // Stop-out: if marginStatus <= stopOutLevel * 100, close the position entirely
    if (position && marginStatus <= config.stopOutLevel * 100) {
      stopOutEvents++;

      // Close at current price
      const diff = price - position.entryPrice;
      const grossPnl =
        position.side === "long" ? diff * position.quantity : -diff * position.quantity;
      const swapFees = position.swapFees; // use accumulated swap for this position
      const fxFees = 0;   // FX fee modelling left for future in stop-out path
      const netPnl = grossPnl - fxFees;

      realisedPnl += netPnl;
      freeCash += position.margin + netPnl;
      marginUsed = 0;

      // Negative balance protection: do not allow freeCash / equity < 0
      // Trading212 offers negative balance protection on retail accounts
      if (freeCash < 0) {
        freeCash = 0;
      }

      const closingEquity = freeCash; // no open position anymore

      trades.push({
        entryDate: position.entryDate,
        exitDate: bar.date,
        side: position.side,
        entryPrice: position.entryPrice,
        exitPrice: price,
        quantity: position.quantity,
        grossPnl,
        swapFees,
        fxFees,
        netPnl,
        margin: position.margin,
        openingEquity: position.openingEquity,
        closingEquity,
      });

      position = null;
      unrealisedPnl = 0;
      equity = freeCash;

      marginStatus = computeMarginStatus(equity, marginUsed);
    } else if (position && marginStatus < config.marginCallLevel * 100) {
      marginCallEvents++;
      // For now, margin call is informational only
    }

    // 4) Apply overnight swap for the *previous* day's position
    // Simple per-day swap based on exposure at current price (approx)
    if (position) {
      const exposure = position.quantity * price;
      const rate =
        position.side === "long"
          ? config.dailyLongSwapRate
          : config.dailyShortSwapRate;
      const swapFee = exposure * rate;
      freeCash += swapFee;
      realisedPnl += swapFee;
      swapFeesAccrued += swapFee;
      equity += swapFee;

      // Accumulate per-position swap
      position.swapFees += swapFee;
    }

    // 5) Decide action based on signal and current position
    // bars[i].signal represents what we "desire" at the end of this bar
    // Strategy (single-position):
    // - If position is null:
    //     - signal = long => open long
    //     - signal = short => open short
    //     - signal = flat => do nothing
    // - If position exists:
    //     - same side as signal => hold
    //     - signal = flat       => close position
    //     - opposite side       => close & flip if margin allows
    const desired = bar.signal;

    // Helper: close current position
    const doClosePosition = (pos: Trading212CfdPosition): void => {
      const diff = price - pos.entryPrice;
      const grossPnl =
        pos.side === "long" ? diff * pos.quantity : -diff * pos.quantity;
      // FX fee: Trading212 charges ~0.5% on the realised result for non-GBP instruments
      const fxFees = Math.abs(grossPnl) * config.fxFeeRate;
      const netPnl = grossPnl - fxFees;
      realisedPnl += netPnl;
      fxFeesAccrued += fxFees;
      freeCash += pos.margin + netPnl;
      marginUsed = 0;

      const closingEquity = freeCash; // flat after closing, so equity == freeCash

      trades.push({
        entryDate: pos.entryDate,
        exitDate: bar.date,
        side: pos.side,
        entryPrice: pos.entryPrice,
        exitPrice: price,
        quantity: pos.quantity,
        grossPnl,
        swapFees: pos.swapFees,   // per-position swap
        fxFees,
        netPnl,
        margin: pos.margin,
        openingEquity: pos.openingEquity,
        closingEquity,
      });
    };

    // Helper: open a new position
    const doOpenPosition = (side: Trading212Side): Trading212CfdPosition | null => {
      const equityForPosition = equity; // after updates
      const targetMargin = equityForPosition * config.positionFraction;
      if (targetMargin <= 0) return null;

      const exposure = targetMargin * config.leverage;
      const qty = exposure / price;
      const margin = exposure / config.leverage;

      if (margin > freeCash) return null; // not enough free cash

      // Apply a simple spread cost on entry: move entryPrice against us by half spread
      const spread = (config.spreadBps / 10000) * price;
      const entryPrice =
        side === "long" ? price + spread / 2 : price - spread / 2;

      const newPos: Trading212CfdPosition = {
        side,
        quantity: qty,
        entryPrice,
        exposure,
        margin,
        entryDate: bar.date,
        swapFees: 0,           // start with no swap fees
        openingEquity: equity, // equity BEFORE locking margin
      };

      freeCash -= margin;
      marginUsed = margin;
      return newPos;
    };

    // Execute decision
    if (!position) {
      if (desired === "long") {
        position = doOpenPosition("long");
      } else if (desired === "short") {
        position = doOpenPosition("short");
      }
    } else {
      if (desired === "flat") {
        doClosePosition(position);
        position = null;
      } else if (
        (desired === "long" && position.side === "short") ||
        (desired === "short" && position.side === "long")
      ) {
        // Flip
        doClosePosition(position);
        position = null;
        // recompute equity / freeCash/marginUsed after close
        equity = freeCash;
        marginUsed = 0;
        position = doOpenPosition(desired === "long" ? "long" : "short");
      }
      // else: same side => hold
    }

    // 6) Snapshot state at end of day
    let quantity = 0;
    let side: Trading212Side | null = null;
    if (position) {
      quantity = position.quantity;
      side = position.side;
      const diff = price - position.entryPrice;
      unrealisedPnl =
        position.side === "long" ? diff * position.quantity : -diff * position.quantity;
      equity = freeCash + unrealisedPnl;
      marginUsed = position.margin;
    } else {
      unrealisedPnl = 0;
      marginUsed = 0;
      equity = freeCash;
    }

    marginStatus = computeMarginStatus(equity, marginUsed);

    history.push({
      date: bar.date,
      price,
      equity,
      freeCash,
      marginUsed,
      marginStatus,
      unrealisedPnl,
      realisedPnl,
      swapFeesAccrued,
      fxFeesAccrued,
      side,
      quantity,
    });
  }

  const equitySeries = history.map((h) => h.equity);
  const maxDrawdown = computeMaxDrawdown(equitySeries);
  const firstDate = history.length > 0 ? history[0].date : null;
  const lastDate = history.length > 0 ? history[history.length - 1].date : null;

  return {
    initialEquity,
    finalEquity: equity,
    accountHistory: history,
    trades,
    maxDrawdown,
    marginCallEvents,
    stopOutEvents,
    swapFeesTotal: swapFeesAccrued,
    fxFeesTotal: fxFeesAccrued,
    firstDate,
    lastDate,
  };
}
