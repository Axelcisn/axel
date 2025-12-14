import {
  PortfolioBalance,
  PortfolioDataResponse,
  PortfolioOrder,
  PortfolioPosition,
  PortfolioTrade,
  PortfolioSummary,
  PortfolioTab,
} from './types';

const useIbkrBridge =
  process.env.NEXT_PUBLIC_BROKER_SOURCE === 'ibkr' &&
  !!process.env.NEXT_PUBLIC_IBKR_BRIDGE_URL;

const trendA = [0.42, 0.44, 0.4, 0.43, 0.45, 0.47, 0.49, 0.52, 0.51, 0.54, 0.56, 0.6, 0.58, 0.6, 0.62, 0.59, 0.61, 0.64, 0.62, 0.65, 0.67, 0.7];
const trendB = [0.32, 0.31, 0.29, 0.28, 0.3, 0.35, 0.34, 0.36, 0.33, 0.37, 0.41, 0.39, 0.42, 0.44, 0.43, 0.47, 0.49, 0.52, 0.53, 0.55];
const trendC = [0.58, 0.62, 0.65, 0.61, 0.6, 0.63, 0.66, 0.7, 0.72, 0.74, 0.71, 0.69, 0.73, 0.76, 0.78, 0.75, 0.73, 0.77, 0.81, 0.83];
const trendD = [0.12, 0.09, 0.11, 0.08, 0.1, 0.13, 0.11, 0.14, 0.17, 0.2, 0.19, 0.21, 0.18, 0.16, 0.17, 0.2, 0.22, 0.24, 0.26, 0.23];
const trendE = [0.72, 0.7, 0.69, 0.68, 0.66, 0.64, 0.63, 0.62, 0.61, 0.6, 0.58, 0.56, 0.57, 0.55, 0.52, 0.5, 0.49, 0.5, 0.48, 0.5];
const trendF = [0.48, 0.5, 0.52, 0.55, 0.58, 0.6, 0.63, 0.61, 0.59, 0.6, 0.64, 0.66, 0.69, 0.68, 0.66, 0.65, 0.62, 0.64, 0.66, 0.69];

function round(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function buildPosition(opts: {
  symbol: string;
  companyName: string;
  position: number;
  last: number;
  prevClose: number;
  avgPrice: number;
  trend: number[];
}): PortfolioPosition {
  const { symbol, companyName, position, last, prevClose, avgPrice, trend } = opts;
  const change = round(last - prevClose);
  const changePct = round((change / prevClose) * 100);
  const marketValue = round(position * last, 2);
  const costBasis = round(position * avgPrice, 2);
  const dailyPnl = round((last - prevClose) * position, 2);
  const dailyPnlPct = costBasis !== 0 ? round((dailyPnl / costBasis) * 100) : 0;
  const unrealizedPnl = round(marketValue - costBasis, 2);
  const unrealizedPnlPct = costBasis !== 0 ? round((unrealizedPnl / costBasis) * 100) : 0;

  return {
    symbol,
    companyName,
    position,
    last,
    change,
    changePct,
    trend,
    dailyPnl,
    dailyPnlPct,
    avgPrice,
    costBasis,
    marketValue,
    unrealizedPnl,
    unrealizedPnlPct,
  };
}

const mockPositions: PortfolioPosition[] = [
  buildPosition({
    symbol: 'TSLA',
    companyName: 'Tesla Inc',
    position: 620,
    last: 149.42,
    prevClose: 154.0,
    avgPrice: 165.9,
    trend: trendA,
  }),
  buildPosition({
    symbol: 'DIS',
    companyName: 'Disney',
    position: 150,
    last: 97.41,
    prevClose: 95.12,
    avgPrice: 102.4,
    trend: trendB,
  }),
  buildPosition({
    symbol: 'AMD',
    companyName: 'Advanced Micro Devices',
    position: 480,
    last: 166.75,
    prevClose: 164.38,
    avgPrice: 172.1,
    trend: trendC,
  }),
  buildPosition({
    symbol: 'NVDA',
    companyName: 'NVIDIA Corporation',
    position: 380,
    last: 886.56,
    prevClose: 880.12,
    avgPrice: 812.5,
    trend: trendD,
  }),
  buildPosition({
    symbol: 'RICK',
    companyName: 'RCI Hospitality',
    position: 60,
    last: 123.56,
    prevClose: 131.44,
    avgPrice: 128.9,
    trend: trendE,
  }),
  buildPosition({
    symbol: 'MBLY',
    companyName: 'Mobileye Global',
    position: 420,
    last: 28.33,
    prevClose: 29.18,
    avgPrice: 35.5,
    trend: trendF,
  }),
  buildPosition({
    symbol: 'MTTR',
    companyName: 'Matterport',
    position: 1200,
    last: 4.85,
    prevClose: 4.86,
    avgPrice: 5.25,
    trend: trendA.slice().reverse(),
  }),
  buildPosition({
    symbol: 'UBER',
    companyName: 'Uber Technologies',
    position: 220,
    last: 73.3,
    prevClose: 72.8,
    avgPrice: 68.4,
    trend: trendB.slice().reverse(),
  }),
];

const mockOrders: PortfolioOrder[] = [
  {
    id: 'ORD-1023',
    symbol: 'MSFT',
    side: 'buy',
    quantity: 100,
    status: 'working',
    limitPrice: 412.5,
    filledQuantity: 0,
    createdAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
  },
  {
    id: 'ORD-1024',
    symbol: 'AAPL',
    side: 'sell',
    quantity: 50,
    status: 'partially_filled',
    limitPrice: 187.25,
    filledQuantity: 20,
    createdAt: new Date(Date.now() - 1000 * 60 * 75).toISOString(),
  },
  {
    id: 'ORD-1025',
    symbol: 'TSLA',
    side: 'sell',
    quantity: 40,
    status: 'cancelled',
    limitPrice: 152.0,
    filledQuantity: 0,
    createdAt: new Date(Date.now() - 1000 * 60 * 140).toISOString(),
  },
];

const mockTrades: PortfolioTrade[] = [
  {
    id: 'TR-8001',
    symbol: 'NVDA',
    side: 'buy',
    quantity: 40,
    price: 884.2,
    value: 35368,
    timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    venue: 'NASDAQ',
  },
  {
    id: 'TR-8002',
    symbol: 'TSLA',
    side: 'buy',
    quantity: 60,
    price: 151.1,
    value: 9066,
    timestamp: new Date(Date.now() - 1000 * 60 * 130).toISOString(),
    venue: 'NASDAQ',
  },
  {
    id: 'TR-8003',
    symbol: 'DIS',
    side: 'sell',
    quantity: 90,
    price: 98.3,
    value: 8847,
    timestamp: new Date(Date.now() - 1000 * 60 * 200).toISOString(),
    venue: 'NYSE',
  },
];

const mockBalances: PortfolioBalance[] = [
  {
    currency: 'USD',
    cash: 185200,
    availableFunds: 492300,
    excessLiquidity: 523800,
    netLiquidation: 946600,
    unrealizedPnl: -292000,
  },
  {
    currency: 'EUR',
    cash: 18200,
    availableFunds: 21800,
    excessLiquidity: 23000,
    netLiquidation: 26800,
    unrealizedPnl: 1200,
  },
];

export function getMockPortfolioSummary(): PortfolioSummary {
  return {
    accountId: 'U-IBKR-SIM-001',
    dailyPnl: -34544,
    unrealizedPnl: -292000,
    realizedPnl: 125400,
    netLiquidity: 946600,
    excessLiquidity: 523800,
    maintenanceMargin: 324000,
    initialMargin: 282000,
    availableFunds: 492300,
    buyingPower: 176789,
  };
}

export function getMockPositions(): PortfolioPosition[] {
  return mockPositions;
}

export function getMockOrders(): PortfolioOrder[] {
  return mockOrders;
}

export function getMockTrades(): PortfolioTrade[] {
  return mockTrades;
}

export function getMockBalances(): PortfolioBalance[] {
  return mockBalances;
}

function responseForTab(tab: PortfolioTab): PortfolioDataResponse {
  switch (tab) {
    case 'orders':
      return { orders: getMockOrders() };
    case 'trades':
      return { trades: getMockTrades() };
    case 'balances':
      return { balances: getMockBalances() };
    case 'positions':
    default:
      return { summary: getMockPortfolioSummary(), positions: getMockPositions() };
  }
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.error('IBKR proxy fetch failed', err);
    return null;
  }
}

export async function fetchPortfolioData(tab: PortfolioTab): Promise<PortfolioDataResponse> {
  if (!useIbkrBridge) {
    return responseForTab(tab);
  }

  if (tab === 'positions') {
    const [summaryRes, positionsRes] = await Promise.all([
      fetchJson<{ summary?: PortfolioSummary } | PortfolioSummary>('/api/ibkr/summary'),
      fetchJson<{ positions?: PortfolioPosition[] } | PortfolioPosition[]>('/api/ibkr/positions'),
    ]);

    const summary =
      summaryRes && !Array.isArray(summaryRes) && 'summary' in summaryRes
        ? summaryRes.summary
        : (summaryRes as PortfolioSummary | null);
    const positions =
      positionsRes && !Array.isArray(positionsRes) && 'positions' in positionsRes
        ? positionsRes.positions
        : (positionsRes as PortfolioPosition[] | null);

    if (summary && positions) {
      return { summary, positions };
    }
  }

  if (tab === 'orders') {
    const ordersRes = await fetchJson<{ orders?: PortfolioOrder[] } | PortfolioOrder[]>('/api/ibkr/orders');
    const orders =
      ordersRes && !Array.isArray(ordersRes) && 'orders' in ordersRes
        ? ordersRes.orders
        : (ordersRes as PortfolioOrder[] | null);
    if (orders) return { orders };
  }

  if (tab === 'trades') {
    const tradesRes = await fetchJson<{ trades?: PortfolioTrade[] } | PortfolioTrade[]>('/api/ibkr/trades');
    const trades =
      tradesRes && !Array.isArray(tradesRes) && 'trades' in tradesRes
        ? tradesRes.trades
        : (tradesRes as PortfolioTrade[] | null);
    if (trades) return { trades };
  }

  if (tab === 'balances') {
    const balancesRes = await fetchJson<{ balances?: PortfolioBalance[] } | PortfolioBalance[]>(
      '/api/ibkr/balances',
    );
    const balances =
      balancesRes && !Array.isArray(balancesRes) && 'balances' in balancesRes
        ? balancesRes.balances
        : (balancesRes as PortfolioBalance[] | null);
    if (balances) return { balances };
  }

  return responseForTab(tab);
}
