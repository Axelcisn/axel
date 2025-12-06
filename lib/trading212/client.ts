// Server-only Trading212 client for the official Public API (read-only endpoints).
// Do NOT import this from client components.

// ============================================================================
// Environment & Auth
// ============================================================================

const API_KEY_ID = process.env.T212_API_KEY_ID;
const API_SECRET = process.env.T212_API_SECRET;
const BASE_URL = process.env.T212_BASE_URL ?? "https://live.trading212.com";

function buildUrl(pathOrFull: string): string {
  // Handles both "/api/v0/..." and full "https://..." values
  if (pathOrFull.startsWith("http://") || pathOrFull.startsWith("https://")) {
    return pathOrFull;
  }
  return new URL(pathOrFull, BASE_URL).toString();
}

function getAuthHeader(): string {
  if (!API_KEY_ID || !API_SECRET) {
    throw new Error("Missing T212_API_KEY_ID or T212_API_SECRET env vars");
  }
  const credentials = `${API_KEY_ID}:${API_SECRET}`;
  const encoded = Buffer.from(credentials, "utf-8").toString("base64");
  return `Basic ${encoded}`;
}

// ============================================================================
// Generic Fetch Wrapper
// ============================================================================

export async function t212Fetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = buildUrl(path);
  const headers: HeadersInit = {
    Authorization: getAuthHeader(),
    Accept: "application/json",
    ...(init.headers || {}),
  };

  const res = await fetch(url, {
    ...init,
    method: init.method ?? "GET",
    headers,
    cache: "no-store", // account data should not be cached
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Trading212 request failed: ${res.status} ${res.statusText} for ${url} – ${text}`
    );
  }

  return (await res.json()) as T;
}

// ============================================================================
// Types – based on the OpenAPI schemas
// ============================================================================

// ---- Accounts ----

export interface T212Cash {
  availableToTrade: number;
  inPies: number;
  reservedForOrders: number;
}

export interface T212Investments {
  currentValue: number;
  realizedProfitLoss: number;
  totalCost: number;
  unrealizedProfitLoss: number;
}

export interface T212AccountSummary {
  id: number;        // int64
  currency: string;  // ISO 4217
  cash: T212Cash;
  investments: T212Investments;
  totalValue: number;
}

// Response of GET /equity/account/cash (wallet impact view)
export interface T212AccountCash {
  free: number;
  blocked: number;
  invested: number;
  pieCash: number;
  ppl: number;
  result: number;
  total: number;
}

// ---- Instruments metadata ----

export interface T212ExchangeTimeEvent {
  date: string; // ISO date-time
  type:
    | "OPEN"
    | "CLOSE"
    | "BREAK_START"
    | "BREAK_END"
    | "PRE_MARKET_OPEN"
    | "AFTER_HOURS_OPEN"
    | "AFTER_HOURS_CLOSE"
    | "OVERNIGHT_OPEN";
}

export interface T212WorkingSchedule {
  id: number;
  timeEvents: T212ExchangeTimeEvent[];
}

export interface T212Exchange {
  id: number;
  name: string;
  workingSchedules: T212WorkingSchedule[];
}

export interface T212TradableInstrument {
  ticker: string;          // e.g. "AAPL_US_EQ"
  name: string;
  shortName?: string;
  currencyCode: string;    // ISO 4217
  isin?: string;
  type:
    | "CRYPTOCURRENCY"
    | "ETF"
    | "FOREX"
    | "FUTURES"
    | "INDEX"
    | "STOCK"
    | "WARRANT"
    | "CRYPTO"
    | "CVR"
    | "CORPACT";
  workingScheduleId: number;
  maxOpenQuantity?: number;
  extendedHours?: boolean;
  addedOn?: string;        // ISO date-time
}

// ---- Positions ----

export interface T212InstrumentRef {
  ticker: string;
  name: string;
  isin: string;
  currency: string;
}

export interface T212PositionWalletImpact {
  currency: string;
  currentValue: number;
  fxImpact: number;
  totalCost: number;
  unrealizedProfitLoss: number;
}

export interface T212Position {
  instrument: T212InstrumentRef;
  quantity: number;
  quantityAvailableForTrading: number;
  quantityInPies: number;
  averagePricePaid: number;
  currentPrice: number;
  createdAt: string; // ISO date-time
  walletImpact: T212PositionWalletImpact;
}

// ---- History: orders ----

export type T212OrderSide = "BUY" | "SELL";
export type T212OrderType = "LIMIT" | "STOP" | "MARKET" | "STOP_LIMIT";
export type T212OrderStatus =
  | "LOCAL"
  | "UNCONFIRMED"
  | "CONFIRMED"
  | "NEW"
  | "CANCELLING"
  | "CANCELLED"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "REJECTED"
  | "REPLACING"
  | "REPLACED";

export interface T212OrderInstrument extends T212InstrumentRef {}

export interface T212Order {
  id: number;
  ticker: string;
  instrument: T212OrderInstrument;
  createdAt: string;
  side: T212OrderSide;
  type: T212OrderType;
  status: T212OrderStatus;
  quantity?: number;
  value?: number;
  filledQuantity?: number;
  filledValue?: number;
  limitPrice?: number;
  stopPrice?: number;
  currency: string;
  extendedHours?: boolean;
}

export type T212TaxName =
  | "COMMISSION_TURNOVER"
  | "CURRENCY_CONVERSION_FEE"
  | "FINRA_FEE"
  | "FRENCH_TRANSACTION_TAX"
  | "PTM_LEVY"
  | "STAMP_DUTY"
  | "STAMP_DUTY_RESERVE_TAX"
  | "TRANSACTION_FEE";

export interface T212Tax {
  chargedAt: string;
  currency: string;
  name: T212TaxName;
  quantity: number;
}

export interface T212FillWalletImpact {
  currency: string;
  fxRate: number;
  netValue: number;
  realisedProfitLoss: number;
  taxes: T212Tax[];
}

export type T212FillType =
  | "TRADE"
  | "STOCK_SPLIT"
  | "STOCK_DISTRIBUTION"
  | "FOP"
  | "FOP_CORRECTION"
  | "CUSTOM_STOCK_DISTRIBUTION"
  | "EQUITY_RIGHTS";

export interface T212Fill {
  id: number;
  filledAt: string;
  price: number;
  quantity: number;
  tradingMethod: "TOTV" | "OTC";
  type: T212FillType;
  walletImpact: T212FillWalletImpact;
}

export interface T212HistoricalOrder {
  order: T212Order;
  fill: T212Fill;
}

// ---- History: dividends ----

export interface T212HistoryDividendItem {
  ticker: string;
  instrument: T212InstrumentRef;
  paidOn: string;
  quantity: number;
  amount: number;
  amountInEuro: number;
  currency: string;
  tickerCurrency: string;
  grossAmountPerShare: number;
  reference: string;
  type: string; // keep full enum as string for now
}

// ---- History: transactions ----

export type T212TransactionType = "WITHDRAW" | "DEPOSIT" | "FEE" | "TRANSFER";

export interface T212HistoryTransactionItem {
  amount: number;
  currency: string;
  dateTime: string;
  reference: string;
  type: T212TransactionType;
}

// Generic pagination wrapper used by /history/* endpoints
export interface T212PaginatedResponse<T> {
  items: T[];
  nextPagePath: string | null;
}

// ============================================================================
// Concrete Client Functions
// ============================================================================

// ---- Accounts ----

export async function getAccountSummary(): Promise<T212AccountSummary> {
  return t212Fetch<T212AccountSummary>("/api/v0/equity/account/summary");
}

export async function getAccountCash(): Promise<T212AccountCash> {
  return t212Fetch<T212AccountCash>("/api/v0/equity/account/cash");
}

// ---- Metadata ----

export async function getInstruments(): Promise<T212TradableInstrument[]> {
  return t212Fetch<T212TradableInstrument[]>("/api/v0/equity/metadata/instruments");
}

export async function getExchanges(): Promise<T212Exchange[]> {
  return t212Fetch<T212Exchange[]>("/api/v0/equity/metadata/exchanges");
}

// ---- Positions ----

export async function getPositions(ticker?: string): Promise<T212Position[]> {
  const path = ticker
    ? `/api/v0/equity/positions?ticker=${encodeURIComponent(ticker)}`
    : "/api/v0/equity/positions";
  return t212Fetch<T212Position[]>(path);
}

// ---- History: orders (cursor-based pagination) ----

export async function getHistoricalOrders(
  options: { limit?: number; cursorPath?: string; ticker?: string } = {}
): Promise<T212PaginatedResponse<T212HistoricalOrder>> {
  if (options.cursorPath) {
    // Use server-provided nextPagePath directly
    return t212Fetch<T212PaginatedResponse<T212HistoricalOrder>>(options.cursorPath);
  }

  const params = new URLSearchParams();
  if (options.limit != null) params.set("limit", String(options.limit));
  if (options.ticker) params.set("ticker", options.ticker);

  const path = `/api/v0/equity/history/orders${
    params.toString() ? `?${params.toString()}` : ""
  }`;

  return t212Fetch<T212PaginatedResponse<T212HistoricalOrder>>(path);
}

// ---- History: dividends (cursor-based pagination) ----

export async function getDividends(
  options: { limit?: number; cursorPath?: string; ticker?: string } = {}
): Promise<T212PaginatedResponse<T212HistoryDividendItem>> {
  if (options.cursorPath) {
    return t212Fetch<T212PaginatedResponse<T212HistoryDividendItem>>(options.cursorPath);
  }

  const params = new URLSearchParams();
  if (options.limit != null) params.set("limit", String(options.limit));
  if (options.ticker) params.set("ticker", options.ticker);

  const path = `/api/v0/equity/history/dividends${
    params.toString() ? `?${params.toString()}` : ""
  }`;

  return t212Fetch<T212PaginatedResponse<T212HistoryDividendItem>>(path);
}

// ---- History: transactions (cursor-based pagination) ----

export async function getTransactions(
  options: { limit?: number; cursorPath?: string; timeFrom?: string } = {}
): Promise<T212PaginatedResponse<T212HistoryTransactionItem>> {
  if (options.cursorPath) {
    return t212Fetch<T212PaginatedResponse<T212HistoryTransactionItem>>(options.cursorPath);
  }

  const params = new URLSearchParams();
  if (options.limit != null) params.set("limit", String(options.limit));
  if (options.timeFrom) params.set("time", options.timeFrom);

  const path = `/api/v0/equity/history/transactions${
    params.toString() ? `?${params.toString()}` : ""
  }`;

  return t212Fetch<T212PaginatedResponse<T212HistoryTransactionItem>>(path);
}

// ============================================================================
// Equity Curve – Compute portfolio value over time from orders + transactions
// ============================================================================

export interface EquityCurvePoint {
  date: string;           // YYYY-MM-DD
  portfolioValue: number; // total value (cash + positions at cost)
  cashBalance: number;    // available cash
  investedValue: number;  // sum of position costs
  realizedPnL: number;    // cumulative realized P&L
  cumulativeDeposits: number; // cumulative deposits
  cumulativeWithdrawals: number; // cumulative withdrawals
}

export interface EquityCurveData {
  curve: EquityCurvePoint[];
  summary: {
    startDate: string;
    endDate: string;
    startingValue: number;
    endingValue: number;
    totalDeposits: number;
    totalWithdrawals: number;
    netDeposits: number;
    totalRealizedPnL: number;
    absoluteReturn: number;
    percentReturn: number;
  };
}

/**
 * Build equity curve from historical orders and transactions
 * Groups events by date and computes running portfolio value
 */
export async function buildEquityCurve(): Promise<EquityCurveData> {
  // Fetch all historical data (paginate through everything)
  const allOrders = await fetchAllHistoricalOrders();
  const allTransactions = await fetchAllTransactions();

  // Build a timeline of all events
  type TimelineEvent = 
    | { type: 'order'; date: string; data: T212HistoricalOrder }
    | { type: 'transaction'; date: string; data: T212HistoryTransactionItem };

  const timeline: TimelineEvent[] = [];

  // Add orders to timeline
  for (const order of allOrders) {
    const date = order.fill.filledAt.split('T')[0];
    timeline.push({ type: 'order', date, data: order });
  }

  // Add transactions to timeline
  for (const tx of allTransactions) {
    const date = tx.dateTime.split('T')[0];
    timeline.push({ type: 'transaction', date, data: tx });
  }

  // Sort by date ascending
  timeline.sort((a, b) => a.date.localeCompare(b.date));

  if (timeline.length === 0) {
    return {
      curve: [],
      summary: {
        startDate: '',
        endDate: '',
        startingValue: 0,
        endingValue: 0,
        totalDeposits: 0,
        totalWithdrawals: 0,
        netDeposits: 0,
        totalRealizedPnL: 0,
        absoluteReturn: 0,
        percentReturn: 0,
      },
    };
  }

  // Group events by date
  const eventsByDate = new Map<string, TimelineEvent[]>();
  for (const event of timeline) {
    const existing = eventsByDate.get(event.date) ?? [];
    existing.push(event);
    eventsByDate.set(event.date, existing);
  }

  // Process events chronologically
  let cashBalance = 0;
  let investedValue = 0;
  let realizedPnL = 0;
  let cumulativeDeposits = 0;
  let cumulativeWithdrawals = 0;

  // Track positions: ticker -> { quantity, totalCost }
  const positions = new Map<string, { quantity: number; totalCost: number }>();

  const curve: EquityCurvePoint[] = [];
  const sortedDates = Array.from(eventsByDate.keys()).sort();

  for (const date of sortedDates) {
    const events = eventsByDate.get(date)!;

    for (const event of events) {
      if (event.type === 'transaction') {
        const tx = event.data;
        if (tx.type === 'DEPOSIT') {
          cashBalance += tx.amount;
          cumulativeDeposits += tx.amount;
        } else if (tx.type === 'WITHDRAW') {
          cashBalance -= Math.abs(tx.amount);
          cumulativeWithdrawals += Math.abs(tx.amount);
        } else if (tx.type === 'FEE') {
          cashBalance -= Math.abs(tx.amount);
        }
      } else if (event.type === 'order') {
        const order = event.data;
        const ticker = order.order.ticker;
        const fill = order.fill;
        const side = order.order.side;
        const quantity = fill.quantity;
        const price = fill.price;
        const totalValue = quantity * price;

        const pos = positions.get(ticker) ?? { quantity: 0, totalCost: 0 };

        if (side === 'BUY') {
          // Buying: cash decreases, position increases
          cashBalance -= totalValue;
          pos.quantity += quantity;
          pos.totalCost += totalValue;
        } else {
          // Selling: cash increases, position decreases, realize P&L
          const avgCost = pos.quantity > 0 ? pos.totalCost / pos.quantity : 0;
          const costBasis = avgCost * quantity;
          const pnl = totalValue - costBasis;

          cashBalance += totalValue;
          realizedPnL += pnl;

          pos.quantity -= quantity;
          pos.totalCost -= costBasis;

          if (pos.quantity <= 0) {
            pos.quantity = 0;
            pos.totalCost = 0;
          }
        }

        positions.set(ticker, pos);
      }
    }

    // Calculate invested value (sum of position costs)
    investedValue = 0;
    positions.forEach((pos) => {
      investedValue += pos.totalCost;
    });

    // Record curve point
    curve.push({
      date,
      portfolioValue: cashBalance + investedValue,
      cashBalance,
      investedValue,
      realizedPnL,
      cumulativeDeposits,
      cumulativeWithdrawals,
    });
  }

  // Build summary
  const startPoint = curve[0];
  const endPoint = curve[curve.length - 1];
  const totalDeposits = cumulativeDeposits;
  const totalWithdrawals = cumulativeWithdrawals;
  const netDeposits = totalDeposits - totalWithdrawals;
  const absoluteReturn = endPoint.portfolioValue - netDeposits;
  const percentReturn = netDeposits > 0 ? (absoluteReturn / netDeposits) * 100 : 0;

  return {
    curve,
    summary: {
      startDate: startPoint.date,
      endDate: endPoint.date,
      startingValue: startPoint.portfolioValue,
      endingValue: endPoint.portfolioValue,
      totalDeposits,
      totalWithdrawals,
      netDeposits,
      totalRealizedPnL: realizedPnL,
      absoluteReturn,
      percentReturn,
    },
  };
}

/**
 * Fetch all historical orders (paginate through all pages)
 */
async function fetchAllHistoricalOrders(): Promise<T212HistoricalOrder[]> {
  const allOrders: T212HistoricalOrder[] = [];
  let cursorPath: string | undefined;

  do {
    const response = await getHistoricalOrders({ limit: 50, cursorPath });
    allOrders.push(...response.items);
    cursorPath = response.nextPagePath ?? undefined;
  } while (cursorPath);

  return allOrders;
}

/**
 * Fetch all transactions (paginate through all pages)
 */
async function fetchAllTransactions(): Promise<T212HistoryTransactionItem[]> {
  const allTransactions: T212HistoryTransactionItem[] = [];
  let cursorPath: string | undefined;

  do {
    const response = await getTransactions({ limit: 50, cursorPath });
    allTransactions.push(...response.items);
    cursorPath = response.nextPagePath ?? undefined;
  } while (cursorPath);

  return allTransactions;
}

/**
 * Get equity curve with optional date range filter
 */
export async function getEquityCurve(
  options: { startDate?: string; endDate?: string } = {}
): Promise<EquityCurveData> {
  const fullCurve = await buildEquityCurve();

  if (!options.startDate && !options.endDate) {
    return fullCurve;
  }

  // Filter curve by date range
  const filteredCurve = fullCurve.curve.filter((point) => {
    if (options.startDate && point.date < options.startDate) return false;
    if (options.endDate && point.date > options.endDate) return false;
    return true;
  });

  if (filteredCurve.length === 0) {
    return {
      curve: [],
      summary: {
        ...fullCurve.summary,
        startDate: options.startDate ?? '',
        endDate: options.endDate ?? '',
      },
    };
  }

  // Recalculate summary for filtered range
  const startPoint = filteredCurve[0];
  const endPoint = filteredCurve[filteredCurve.length - 1];
  const absoluteReturn = endPoint.portfolioValue - startPoint.portfolioValue;
  const percentReturn = startPoint.portfolioValue > 0
    ? (absoluteReturn / startPoint.portfolioValue) * 100
    : 0;

  return {
    curve: filteredCurve,
    summary: {
      startDate: startPoint.date,
      endDate: endPoint.date,
      startingValue: startPoint.portfolioValue,
      endingValue: endPoint.portfolioValue,
      totalDeposits: endPoint.cumulativeDeposits - startPoint.cumulativeDeposits,
      totalWithdrawals: endPoint.cumulativeWithdrawals - startPoint.cumulativeWithdrawals,
      netDeposits: (endPoint.cumulativeDeposits - startPoint.cumulativeDeposits) -
                   (endPoint.cumulativeWithdrawals - startPoint.cumulativeWithdrawals),
      totalRealizedPnL: endPoint.realizedPnL - startPoint.realizedPnL,
      absoluteReturn,
      percentReturn,
    },
  };
}
