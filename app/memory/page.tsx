'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { CompanyInfo } from '@/lib/types/company';
import { useDarkMode } from '@/lib/hooks/useDarkMode';

interface CompanyData {
  company: CompanyInfo;
  hasCanonical: boolean;
  hasUploads: boolean;
  hasForecasts: boolean;
  hasSpecs: boolean;
  lastModified: string;
}

export default function MemoryPage() {
  const [companies, setCompanies] = useState<CompanyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<CompanyData | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [sortBy, setSortBy] = useState<'ticker' | 'name' | 'lastModified'>('ticker');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const isDarkMode = useDarkMode();

  useEffect(() => {
    loadCompanies();
  }, []);

  const loadCompanies = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/companies');
      if (!response.ok) {
        throw new Error(`Failed to load companies: ${response.statusText}`);
      }

      // API now returns an array with hasCanonical/hasUploads flags included
      const companiesData = await response.json();
      
      // Map the enriched response directly - no per-company fetches needed
      const companiesArray: CompanyData[] = (Array.isArray(companiesData) ? companiesData : Object.values(companiesData)).map((company: any) => ({
        company,
        hasCanonical: company.hasCanonical ?? false,
        hasUploads: company.hasUploads ?? false,
        hasForecasts: false, // We'll implement this check if needed
        hasSpecs: false, // We'll implement this check if needed
        lastModified: company.updatedAt || company.createdAt || new Date().toISOString()
      }));

      setCompanies(companiesArray);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // Filter and sort companies
  const filteredAndSortedCompanies = useMemo(() => {
    let filtered = companies.filter(({ company }) => 
      company.ticker.toLowerCase().includes(searchTerm.toLowerCase()) ||
      company.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    filtered.sort((a, b) => {
      let aValue: string | number = '';
      let bValue: string | number = '';

      switch (sortBy) {
        case 'ticker':
          aValue = a.company.ticker;
          bValue = b.company.ticker;
          break;
        case 'name':
          aValue = a.company.name;
          bValue = b.company.name;
          break;
        case 'lastModified':
          aValue = new Date(a.lastModified).getTime();
          bValue = new Date(b.lastModified).getTime();
          break;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc' 
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      return sortDirection === 'asc' 
        ? (aValue as number) - (bValue as number)
        : (bValue as number) - (aValue as number);
    });

    return filtered;
  }, [companies, searchTerm, sortBy, sortDirection]);

  const handleSort = (field: 'ticker' | 'name' | 'lastModified') => {
    if (sortBy === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDirection('asc');
    }
  };

  const getDataBadges = (company: CompanyData) => {
    const badges = [];
    if (company.hasCanonical) badges.push({ label: 'Historical Data', color: 'green' });
    if (company.hasUploads) badges.push({ label: 'Uploads', color: 'blue' });
    if (company.hasForecasts) badges.push({ label: 'Forecasts', color: 'purple' });
    if (company.hasSpecs) badges.push({ label: 'Specs', color: 'yellow' });
    return badges;
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading saved companies...</p>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="text-center py-12">
            <div className="text-red-600 mb-4">
              <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.35 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Error Loading Companies</h3>
            <p className="text-gray-600 mb-4">{error}</p>
            <button
              onClick={loadCompanies}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
            >
              Try Again
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className={`text-3xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Memory</h1>
          <p className={`mt-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
            Browse and manage your saved companies and their historical data
          </p>
        </div>

        {/* Search and Controls */}
        <div className={`shadow rounded-lg mb-6 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <div className="p-6">
            <div className="flex flex-col sm:flex-row gap-4">
              {/* Search Bar */}
              <div className="flex-1">
                <label htmlFor="search" className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Search Companies
                </label>
                <div className="relative">
                  <input
                    type="text"
                    id="search"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by ticker or company name..."
                    className={`block w-full pl-10 pr-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm ${
                      isDarkMode 
                        ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400' 
                        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
                    }`}
                  />
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className={`h-5 w-5 ${isDarkMode ? 'text-gray-400' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* View Mode Toggle */}
              <div className="flex-shrink-0">
                <label className="block text-sm font-medium text-gray-700 mb-2">View</label>
                <div className="flex rounded-md shadow-sm">
                  <button
                    onClick={() => setViewMode('list')}
                    className={`px-3 py-2 text-sm font-medium rounded-l-md border ${
                      viewMode === 'list'
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    List
                  </button>
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`px-3 py-2 text-sm font-medium rounded-r-md border-t border-r border-b ${
                      viewMode === 'grid'
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    Grid
                  </button>
                </div>
              </div>

              {/* Sort Controls */}
              <div className="flex-shrink-0">
                <label className="block text-sm font-medium text-gray-700 mb-2">Sort by</label>
                <select
                  value={sortBy}
                  onChange={(e) => handleSort(e.target.value as 'ticker' | 'name' | 'lastModified')}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                >
                  <option value="ticker">Ticker</option>
                  <option value="name">Company Name</option>
                  <option value="lastModified">Last Modified</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Results Count */}
        <div className="mb-4">
          <p className="text-sm text-gray-600">
            {filteredAndSortedCompanies.length} of {companies.length} companies
            {searchTerm && ` matching "${searchTerm}"`}
          </p>
        </div>

        {/* Companies Display */}
        {filteredAndSortedCompanies.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-gray-900">
              {searchTerm ? 'No companies found' : 'No saved companies'}
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              {searchTerm ? 'Try adjusting your search terms.' : 'Start by analyzing a company to save its data.'}
            </p>
            {!searchTerm && (
              <div className="mt-6">
                <Link
                  href="/analysis"
                  className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
                >
                  Analyze Company
                </Link>
              </div>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredAndSortedCompanies.map((companyData) => (
              <div key={companyData.company.ticker} className="bg-white rounded-lg shadow hover:shadow-md transition-shadow">
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-900">{companyData.company.ticker}</h3>
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">{companyData.company.name}</p>
                      <p className="text-xs text-gray-500 mt-1">{companyData.company.exchange}</p>
                    </div>
                  </div>

                  {/* Data Badges */}
                  <div className="flex flex-wrap gap-1 mb-4">
                    {getDataBadges(companyData).map((badge, index) => (
                      <span
                        key={index}
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          badge.color === 'green' ? 'bg-green-100 text-green-800' :
                          badge.color === 'blue' ? 'bg-blue-100 text-blue-800' :
                          badge.color === 'purple' ? 'bg-purple-100 text-purple-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>

                  {/* Last Modified */}
                  <p className="text-xs text-gray-500 mb-4">
                    Last modified: {new Date(companyData.lastModified).toLocaleDateString()}
                  </p>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Link
                      href={`/memory/${companyData.company.ticker}`}
                      className="flex-1 text-center px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
                    >
                      Open Folder
                    </Link>
                    <button
                      onClick={() => setSelectedCompany(companyData)}
                      className="px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50"
                    >
                      Details
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th 
                    onClick={() => handleSort('ticker')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                  >
                    Ticker {sortBy === 'ticker' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th 
                    onClick={() => handleSort('name')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                  >
                    Company Name {sortBy === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Exchange
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Data Available
                  </th>
                  <th 
                    onClick={() => handleSort('lastModified')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                  >
                    Last Modified {sortBy === 'lastModified' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredAndSortedCompanies.map((companyData) => (
                  <tr key={companyData.company.ticker} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {companyData.company.ticker}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">
                      {companyData.company.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {companyData.company.exchange}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      <div className="flex flex-wrap gap-1">
                        {getDataBadges(companyData).map((badge, index) => (
                          <span
                            key={index}
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                              badge.color === 'green' ? 'bg-green-100 text-green-800' :
                              badge.color === 'blue' ? 'bg-blue-100 text-blue-800' :
                              badge.color === 'purple' ? 'bg-purple-100 text-purple-800' :
                              'bg-yellow-100 text-yellow-800'
                            }`}
                          >
                            {badge.label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(companyData.lastModified).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div className="flex gap-2">
                        <Link
                          href={`/memory/${companyData.company.ticker}`}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          Open
                        </Link>
                        <button
                          onClick={() => setSelectedCompany(companyData)}
                          className="text-gray-600 hover:text-gray-900"
                        >
                          Details
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Company Details Modal */}
        {selectedCompany && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
              <div className="mt-3">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900">
                    {selectedCompany.company.ticker} Details
                  </h3>
                  <button
                    onClick={() => setSelectedCompany(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Company Name</label>
                    <p className="text-sm text-gray-900">{selectedCompany.company.name}</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Exchange</label>
                    <p className="text-sm text-gray-900">{selectedCompany.company.exchange}</p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Created</label>
                    <p className="text-sm text-gray-900">
                      {new Date(selectedCompany.company.createdAt).toLocaleString()}
                    </p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Last Updated</label>
                    <p className="text-sm text-gray-900">
                      {new Date(selectedCompany.company.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Available Data</label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {getDataBadges(selectedCompany).map((badge, index) => (
                        <span
                          key={index}
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            badge.color === 'green' ? 'bg-green-100 text-green-800' :
                            badge.color === 'blue' ? 'bg-blue-100 text-blue-800' :
                            badge.color === 'purple' ? 'bg-purple-100 text-purple-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {badge.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                
                <div className="mt-6 flex gap-3">
                  <Link
                    href={`/memory/${selectedCompany.company.ticker}`}
                    className="flex-1 text-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
                    onClick={() => setSelectedCompany(null)}
                  >
                    Open Folder
                  </Link>
                  <Link
                    href={`/company/${selectedCompany.company.ticker}/timing`}
                    className="flex-1 text-center px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700"
                    onClick={() => setSelectedCompany(null)}
                  >
                    Start Analysis
                  </Link>
                  <button
                    onClick={() => setSelectedCompany(null)}
                    className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}