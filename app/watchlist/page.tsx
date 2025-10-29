'use client';

import { useState, useEffect } from 'react';
import { StockData } from '@/lib/csvUtils';
import { formatCurrency, formatPercent } from '@/lib/analysis';

export default function WatchlistPage() {
  const [watchlist, setWatchlist] = useState<StockData[]>([]);
  const [portfolioData, setPortfolioData] = useState<StockData[]>([]);
  const [selectedStock, setSelectedStock] = useState<string>('');
  const [sortBy, setSortBy] = useState<'symbol' | 'price' | 'change' | 'changePercent'>('symbol');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filterBy, setFilterBy] = useState<'all' | 'gainers' | 'losers'>('all');

  useEffect(() => {
    // Load watchlist from localStorage
    const savedWatchlist = localStorage.getItem('watchlist');
    if (savedWatchlist) {
      setWatchlist(JSON.parse(savedWatchlist));
    }

    // Load portfolio data from localStorage
    const savedPortfolio = localStorage.getItem('portfolioData');
    if (savedPortfolio) {
      setPortfolioData(JSON.parse(savedPortfolio));
    }
  }, []);

  const saveWatchlist = (newWatchlist: StockData[]) => {
    setWatchlist(newWatchlist);
    localStorage.setItem('watchlist', JSON.stringify(newWatchlist));
  };

  const addToWatchlist = () => {
    if (!selectedStock) return;
    
    const stock = portfolioData.find(s => s.symbol === selectedStock);
    if (stock && !watchlist.find(w => w.symbol === stock.symbol)) {
      saveWatchlist([...watchlist, stock]);
      setSelectedStock('');
    }
  };

  const removeFromWatchlist = (symbol: string) => {
    const newWatchlist = watchlist.filter(stock => stock.symbol !== symbol);
    saveWatchlist(newWatchlist);
  };

  const handleSort = (field: 'symbol' | 'price' | 'change' | 'changePercent') => {
    if (sortBy === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDirection('asc');
    }
  };

  const getFilteredAndSortedStocks = () => {
    let filtered = [...watchlist];

    // Apply filter
    switch (filterBy) {
      case 'gainers':
        filtered = filtered.filter(stock => stock.changePercent > 0);
        break;
      case 'losers':
        filtered = filtered.filter(stock => stock.changePercent < 0);
        break;
      default:
        break;
    }

    // Apply sort
    filtered.sort((a, b) => {
      let aValue = a[sortBy];
      let bValue = b[sortBy];

      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = (bValue as string).toLowerCase();
      }

      if (sortDirection === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });

    return filtered;
  };

  const getSortIcon = (field: string) => {
    if (sortBy !== field) return '↕️';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  const filteredAndSortedStocks = getFilteredAndSortedStocks();

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Stock Watchlist</h1>
          
          {/* Add to Watchlist Section */}
          {portfolioData.length > 0 && (
            <div className="mb-8 p-6 bg-blue-50 rounded-lg">
              <h2 className="text-lg font-semibold text-blue-900 mb-4">Add Stock to Watchlist</h2>
              <div className="flex gap-4 items-center">
                <select
                  value={selectedStock}
                  onChange={(e) => setSelectedStock(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select a stock from your portfolio</option>
                  {portfolioData
                    .filter(stock => !watchlist.find(w => w.symbol === stock.symbol))
                    .map(stock => (
                      <option key={stock.symbol} value={stock.symbol}>
                        {stock.symbol} - {formatCurrency(stock.price)}
                      </option>
                    ))}
                </select>
                <button
                  onClick={addToWatchlist}
                  disabled={!selectedStock}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  Add to Watchlist
                </button>
              </div>
            </div>
          )}

          {/* Filters and Controls */}
          <div className="mb-6 flex flex-wrap gap-4 items-center justify-between">
            <div className="flex gap-4 items-center">
              <label className="text-sm font-medium text-gray-700">Filter:</label>
              <select
                value={filterBy}
                onChange={(e) => setFilterBy(e.target.value as 'all' | 'gainers' | 'losers')}
                className="px-3 py-1 border border-gray-300 rounded text-sm"
              >
                <option value="all">All Stocks</option>
                <option value="gainers">Gainers Only</option>
                <option value="losers">Losers Only</option>
              </select>
            </div>
            
            <div className="text-sm text-gray-600">
              {filteredAndSortedStocks.length} of {watchlist.length} stocks
            </div>
          </div>

          {/* Watchlist Table */}
          {watchlist.length === 0 ? (
            <div className="text-center py-12">
              <div className="mb-4">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Your watchlist is empty</h3>
              <p className="text-gray-600 mb-4">
                {portfolioData.length > 0 
                  ? "Add stocks from your portfolio to start tracking them."
                  : "Upload a portfolio first to add stocks to your watchlist."
                }
              </p>
              {portfolioData.length === 0 && (
                <a href="/upload" className="text-blue-600 hover:text-blue-800 font-medium">
                  Go to Upload Page →
                </a>
              )}
            </div>
          ) : (
            <div className="bg-white border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('symbol')}
                      >
                        Symbol {getSortIcon('symbol')}
                      </th>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('price')}
                      >
                        Price {getSortIcon('price')}
                      </th>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('change')}
                      >
                        Change {getSortIcon('change')}
                      </th>
                      <th 
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                        onClick={() => handleSort('changePercent')}
                      >
                        Change % {getSortIcon('changePercent')}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Volume
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredAndSortedStocks.map((stock, index) => (
                      <tr key={stock.symbol} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {stock.symbol}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatCurrency(stock.price)}
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm ${stock.change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(stock.change)}
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${stock.changePercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatPercent(stock.changePercent)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {stock.volume.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <button
                            onClick={() => removeFromWatchlist(stock.symbol)}
                            className="text-red-600 hover:text-red-800 font-medium"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Summary Statistics */}
          {watchlist.length > 0 && (
            <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-blue-50 p-4 rounded-lg text-center">
                <h3 className="text-sm font-medium text-blue-600">Total Watched</h3>
                <p className="text-2xl font-bold text-blue-900">{watchlist.length}</p>
              </div>
              <div className="bg-green-50 p-4 rounded-lg text-center">
                <h3 className="text-sm font-medium text-green-600">Gainers</h3>
                <p className="text-2xl font-bold text-green-900">
                  {watchlist.filter(s => s.changePercent > 0).length}
                </p>
              </div>
              <div className="bg-red-50 p-4 rounded-lg text-center">
                <h3 className="text-sm font-medium text-red-600">Losers</h3>
                <p className="text-2xl font-bold text-red-900">
                  {watchlist.filter(s => s.changePercent < 0).length}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}