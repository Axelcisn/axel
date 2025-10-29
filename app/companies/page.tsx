'use client';

import { useEffect, useState } from 'react';
import type { StockData } from '@/lib/csvUtils';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/analysis';

const fetchCompanies = async (query: string): Promise<StockData[]> => {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set('query', query.trim());
  }

  const queryString = params.toString();
  const endpoint = queryString ? `/api/companies?${queryString}` : '/api/companies';

  const response = await fetch(endpoint, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Unable to load companies');
  }

  const data = await response.json();
  return data.results as StockData[];
};

export default function CompaniesPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StockData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const debouncedQuery = useDebouncedValue(query, 300);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      setIsLoading(true);
      setError('');

      try {
        const companies = await fetchCompanies(debouncedQuery);
        if (isMounted) {
          setResults(companies);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch companies');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    load();

    return () => {
      isMounted = false;
    };
  }, [debouncedQuery]);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">Company Search</h1>
          <p className="text-gray-600 mb-8">
            Search the companies you have uploaded to quickly review their pricing and change metrics.
          </p>

          <div className="mb-6">
            <label htmlFor="company-search" className="block text-sm font-medium text-gray-700 mb-2">
              Search by symbol
            </label>
            <input
              id="company-search"
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="e.g. AAPL"
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {isLoading && <p className="text-sm text-gray-500">Loading companies...</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}

          {!isLoading && !error && (
            <div className="mt-6">
              {results.length === 0 ? (
                <p className="text-sm text-gray-500">No companies found. Upload a portfolio to get started.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Symbol</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Change</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Change %</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Volume</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {results.map((company) => (
                        <tr key={company.symbol}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{company.symbol}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatCurrency(company.price)}</td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatCurrency(company.change)}</td>
                          <td
                            className={`px-6 py-4 whitespace-nowrap text-sm ${
                              company.changePercent >= 0 ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            {formatPercent(company.changePercent)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{formatNumber(company.volume)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
