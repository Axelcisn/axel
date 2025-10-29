// Stock Analysis Utilities
import { StockData } from './csvUtils';

export interface AnalysisResult {
  totalStocks: number;
  avgPrice: number;
  totalVolume: number;
  topGainers: StockData[];
  topLosers: StockData[];
  highestPriced: StockData[];
  riskScore: number;
  diversificationScore: number;
}

export function analyzePortfolio(stocks: StockData[]): AnalysisResult {
  if (stocks.length === 0) {
    return {
      totalStocks: 0,
      avgPrice: 0,
      totalVolume: 0,
      topGainers: [],
      topLosers: [],
      highestPriced: [],
      riskScore: 0,
      diversificationScore: 0,
    };
  }

  // Basic calculations
  const totalStocks = stocks.length;
  const avgPrice = stocks.reduce((sum, stock) => sum + stock.price, 0) / totalStocks;
  const totalVolume = stocks.reduce((sum, stock) => sum + stock.volume, 0);

  // Top gainers (by percentage change)
  const topGainers = [...stocks]
    .filter(stock => stock.changePercent > 0)
    .sort((a, b) => b.changePercent - a.changePercent)
    .slice(0, 5);

  // Top losers (by percentage change)
  const topLosers = [...stocks]
    .filter(stock => stock.changePercent < 0)
    .sort((a, b) => a.changePercent - b.changePercent)
    .slice(0, 5);

  // Highest priced stocks
  const highestPriced = [...stocks]
    .sort((a, b) => b.price - a.price)
    .slice(0, 5);

  // Risk score calculation (based on volatility)
  const avgVolatility = stocks.reduce((sum, stock) => sum + Math.abs(stock.changePercent), 0) / totalStocks;
  const riskScore = Math.min(100, avgVolatility * 10);

  // Diversification score (simple metric based on number of stocks and price distribution)
  const priceStdDev = calculateStandardDeviation(stocks.map(s => s.price));
  const diversificationScore = Math.min(100, totalStocks * 2 + (priceStdDev / avgPrice) * 20);

  return {
    totalStocks,
    avgPrice,
    totalVolume,
    topGainers,
    topLosers,
    highestPriced,
    riskScore,
    diversificationScore,
  };
}

export function calculateStandardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const squaredDifferences = values.map(value => Math.pow(value - mean, 2));
  const avgSquaredDiff = squaredDifferences.reduce((sum, value) => sum + value, 0) / values.length;
  
  return Math.sqrt(avgSquaredDiff);
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}

export function formatPercent(percent: number): string {
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`;
}

export function getRiskLevel(riskScore: number): string {
  if (riskScore < 20) return 'Low';
  if (riskScore < 50) return 'Moderate';
  if (riskScore < 80) return 'High';
  return 'Very High';
}

export function getDiversificationLevel(diversificationScore: number): string {
  if (diversificationScore < 30) return 'Poor';
  if (diversificationScore < 60) return 'Moderate';
  if (diversificationScore < 80) return 'Good';
  return 'Excellent';
}