import { StockData } from './csvUtils';

const companyStore = new Map<string, StockData>();

export function saveCompanies(companies: StockData[]): void {
  companyStore.clear();

  companies.forEach((company) => {
    if (!company.symbol) {
      return;
    }

    const symbol = company.symbol.toUpperCase();
    companyStore.set(symbol, { ...company, symbol });
  });
}

export function getCompanies(): StockData[] {
  return Array.from(companyStore.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function searchCompanies(query: string): StockData[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return getCompanies();
  }

  return getCompanies().filter((company) =>
    company.symbol.toLowerCase().includes(normalizedQuery)
  );
}
