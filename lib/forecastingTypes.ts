// Forecasting Types - Core data structures for market analysis

export interface MarketData {
  date: Date;
  timestamp?: Date;  // Alternative field for compatibility
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
  logReturn?: number;
}

export interface PredictionInterval {
  lower: number;
  upper: number;
  confidence: number;
  method: 'GBM' | 'GARCH' | 'HAR' | 'Range';
}

export interface VolatilityEstimate {
  value: number;
  method: 'Parkinson' | 'GK' | 'RS' | 'YZ' | 'Classical';
  window: number;
  date: Date;
}