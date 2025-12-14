export type PortfolioTab = 'positions' | 'orders' | 'trades' | 'balances';

export interface PortfolioSummary {
  accountId: string;
  dailyPnl: number;
  unrealizedPnl: number;
  realizedPnl: number;
  netLiquidity: number;
  excessLiquidity: number;
  maintenanceMargin: number;
  initialMargin: number;
  availableFunds: number;
  buyingPower: number;
}

export interface PortfolioPosition {
  symbol: string;
  companyName: string;
  position: number;
  last: number;
  change: number;
  changePct: number;
  trend: number[];
  dailyPnl: number;
  dailyPnlPct: number;
  avgPrice: number;
  costBasis: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
}

export interface PortfolioOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  status: 'working' | 'filled' | 'cancelled' | 'partially_filled';
  limitPrice?: number;
  filledQuantity?: number;
  createdAt: string;
}

export interface PortfolioTrade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  value: number;
  timestamp: string;
  venue?: string;
}

export interface PortfolioBalance {
  currency: string;
  cash: number;
  availableFunds: number;
  excessLiquidity: number;
  netLiquidation: number;
  unrealizedPnl?: number;
}

export interface PortfolioDataResponse {
  summary?: PortfolioSummary;
  positions?: PortfolioPosition[];
  orders?: PortfolioOrder[];
  trades?: PortfolioTrade[];
  balances?: PortfolioBalance[];
  error?: string;
}
