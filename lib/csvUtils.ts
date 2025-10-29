// CSV Utilities for handling file uploads and parsing
export interface StockData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap?: number;
  pe?: number;
  dividend?: number;
}

export function parseCSV(csvText: string): StockData[] {
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  
  const data: StockData[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    if (values.length >= headers.length) {
      const row: any = {};
      headers.forEach((header, index) => {
        row[header] = values[index];
      });
      
      // Map to StockData interface
      const stockData: StockData = {
        symbol: row.symbol || row.ticker || '',
        price: parseFloat(row.price || row.close || '0'),
        change: parseFloat(row.change || '0'),
        changePercent: parseFloat(row['change%'] || row.changepercent || '0'),
        volume: parseInt(row.volume || '0'),
        marketCap: row.marketcap ? parseFloat(row.marketcap) : undefined,
        pe: row.pe ? parseFloat(row.pe) : undefined,
        dividend: row.dividend ? parseFloat(row.dividend) : undefined,
      };
      
      if (stockData.symbol) {
        data.push(stockData);
      }
    }
  }
  
  return data;
}

export function validateCSVHeaders(csvText: string): boolean {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return false;
  
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const requiredHeaders = ['symbol', 'price'];
  
  return requiredHeaders.every(required => 
    headers.some(header => header.includes(required) || header.includes(required.replace('symbol', 'ticker')))
  );
}

export function generateSampleCSV(): string {
  return `Symbol,Price,Change,Change%,Volume,MarketCap,PE,Dividend
AAPL,175.50,2.30,1.33,45678000,2800000000,28.5,0.96
MSFT,415.25,-3.45,-0.82,23456000,3100000000,35.2,2.72
GOOGL,2875.00,15.75,0.55,1234000,1900000000,25.8,0.00
TSLA,248.50,-8.25,-3.21,98765000,785000000,45.6,0.00
AMZN,3420.75,22.50,0.66,3456000,1750000000,52.1,0.00`;
}