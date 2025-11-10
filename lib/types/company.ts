export interface CompanyInfo {
  ticker: string;
  name: string;
  exchange: string;
  exchangeInfo?: {
    country: string;
    region: string;
    currency: string;
    timezone: string;
    formattedTicker: string; // Ticker with proper suffix (e.g., BHP.AX)
  };
  createdAt: string;
  updatedAt: string;
}

export interface CompanyRegistry {
  [ticker: string]: CompanyInfo;
}

export interface ExchangeOption {
  code: string;
  name: string;
  country: string;
  region: string;
  currency: string;
  suffix: string;
}