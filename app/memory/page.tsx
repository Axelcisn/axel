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

  const badgeClassNames = (color: string) => {
    if (isDarkMode) {
      if (color === 'green') return 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30';
      if (color === 'blue') return 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30';
      if (color === 'purple') return 'bg-purple-500/20 text-purple-200 ring-1 ring-purple-500/30';
      return 'bg-amber-400/20 text-amber-200 ring-1 ring-amber-500/30';
    }

    if (color === 'green') return 'bg-green-100 text-green-800';
    if (color === 'blue') return 'bg-blue-100 text-blue-800';
    if (color === 'purple') return 'bg-purple-100 text-purple-800';
    return 'bg-yellow-100 text-yellow-800';
  };

  const pageBackground = 'bg-background';
  const headingColor = isDarkMode ? 'text-white' : 'text-gray-900';
  const mutedText = isDarkMode ? 'text-slate-300' : 'text-gray-600';
  const labelColor = isDarkMode ? 'text-slate-200' : 'text-gray-700';
  const cardSurface = isDarkMode ? 'bg-slate-900/60 border border-slate-800' : 'bg-white border border-gray-200';

  if (loading) {
    return (
      <main className={`min-h-screen ${pageBackground}`}>
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="py-12 text-center">
            <div className={`mx-auto h-12 w-12 animate-spin rounded-full border-b-2 ${isDarkMode ? 'border-blue-400' : 'border-blue-600'}`} />
            <p className={`mt-4 text-sm ${mutedText}`}>Loading saved companies...</p>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className={`min-h-screen ${pageBackground}`}>
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className={`py-12 text-center ${isDarkMode ? 'text-slate-100' : 'text-gray-900'}`}>
            <div className={`${isDarkMode ? 'text-red-400' : 'text-red-600'} mb-4`}>
              <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.35 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h3 className={`text-lg font-medium ${headingColor}`}>Error Loading Companies</h3>
            <p className={`mt-2 text-sm ${mutedText}`}>{error}</p>
            <button
              onClick={loadCompanies}
              className={`mt-6 px-4 py-2 text-sm font-medium rounded-full transition ${
                isDarkMode ? 'bg-blue-500 text-white hover:bg-blue-400' : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              Try Again
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={`min-h-screen ${pageBackground}`}>
      <div className="mx-auto w-full max-w-[1400px] py-8 px-6 md:px-10">
        <div className="mb-6">
          <h1 className={`text-3xl font-bold ${headingColor}`}>Memory</h1>
        </div>

        <div className="mb-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
            <div className="flex-1">
              <div className="relative">
                <input
                  type="text"
                  id="search"
                  aria-label="Search companies"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by ticker or company name..."
                  className={`block w-full pl-11 pr-4 py-3 rounded-full border transition shadow-sm focus:outline-none ${
                    isDarkMode
                      ? 'bg-transparent border-slate-700 text-white placeholder-slate-400 focus:ring-2 focus:ring-slate-500'
                      : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500 focus:ring-2 focus:ring-blue-500'
                  }`}
                />
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className={`h-5 w-5 ${isDarkMode ? 'text-slate-400' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${labelColor}`}>View</span>
                <div className={`inline-flex h-11 items-center rounded-full border px-1 ${isDarkMode ? 'border-slate-800' : 'border-gray-300'}`}>
                  <button
                    onClick={() => setViewMode('list')}
                    className={`h-9 px-4 text-sm font-semibold rounded-full transition ${
                      viewMode === 'list'
                        ? isDarkMode
                          ? 'bg-blue-500 text-white shadow-sm'
                          : 'bg-blue-600 text-white shadow-sm'
                        : isDarkMode
                          ? 'text-slate-200 hover:bg-slate-800'
                          : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    List
                  </button>
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`h-9 px-4 text-sm font-semibold rounded-full transition ${
                      viewMode === 'grid'
                        ? isDarkMode
                          ? 'bg-blue-500 text-white shadow-sm'
                          : 'bg-blue-600 text-white shadow-sm'
                        : isDarkMode
                          ? 'text-slate-200 hover:bg-slate-800'
                          : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    Grid
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${labelColor}`}>Sort by</span>
                <select
                  value={sortBy}
                  onChange={(e) => handleSort(e.target.value as 'ticker' | 'name' | 'lastModified')}
                  className={`h-11 rounded-full border px-4 text-sm shadow-sm transition focus:outline-none focus:ring-2 ${
                    isDarkMode
                      ? 'bg-slate-900/60 border-slate-700 text-slate-100 focus:ring-slate-500'
                      : 'bg-white border-gray-300 text-gray-900 focus:ring-blue-500'
                  }`}
                >
                  <option value="ticker">Ticker</option>
                  <option value="name">Company Name</option>
                  <option value="lastModified">Last Modified</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-4">
          <p className={`text-sm ${mutedText}`}>
            {filteredAndSortedCompanies.length} of {companies.length} companies
            {searchTerm && ` matching "${searchTerm}"`}
          </p>
        </div>

        {filteredAndSortedCompanies.length === 0 ? (
          <div className={`text-center py-12 rounded-2xl ${cardSurface} ${isDarkMode ? 'text-slate-100' : 'text-gray-900'}`}>
            <svg className={`mx-auto h-12 w-12 ${isDarkMode ? 'text-slate-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <h3 className="mt-4 text-lg font-medium">
              {searchTerm ? 'No companies found' : 'No saved companies'}
            </h3>
            <p className={`mt-2 text-sm ${mutedText}`}>
              {searchTerm ? 'Try adjusting your search terms.' : 'Start by analyzing a company to save its data.'}
            </p>
            {!searchTerm && (
              <div className="mt-6">
                <Link
                  href="/analysis"
                  className={`inline-flex items-center px-5 py-2 text-sm font-medium rounded-full transition ${
                    isDarkMode ? 'bg-blue-500 text-white hover:bg-blue-400' : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  Analyze Company
                </Link>
              </div>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredAndSortedCompanies.map((companyData) => (
              <div key={companyData.company.ticker} className={`${cardSurface} rounded-2xl shadow-sm transition hover:shadow-md ${isDarkMode ? 'text-slate-100' : 'text-gray-900'}`}>
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold">{companyData.company.ticker}</h3>
                      <p className={`text-sm mt-1 line-clamp-2 ${mutedText}`}>{companyData.company.name}</p>
                      <p className={`text-xs mt-1 ${mutedText}`}>{companyData.company.exchange}</p>
                    </div>
                  </div>

                  <div className="mb-4 flex flex-wrap gap-1">
                    {getDataBadges(companyData).map((badge, index) => (
                      <span
                        key={index}
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${badgeClassNames(badge.color)}`}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>

                  <p className={`text-xs mb-4 ${mutedText}`}>
                    Last modified: {new Date(companyData.lastModified).toLocaleDateString()}
                  </p>

                  <div className="flex gap-2">
                    <Link
                      href={`/memory/${companyData.company.ticker}`}
                      className={`flex-1 text-center px-3 py-2 text-sm font-medium rounded-full transition ${
                        isDarkMode ? 'bg-blue-500 text-white hover:bg-blue-400' : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      Open Folder
                    </Link>
                    <button
                      onClick={() => setSelectedCompany(companyData)}
                      className={`px-3 py-2 text-sm font-medium rounded-full border transition ${
                        isDarkMode
                          ? 'border-slate-700 text-slate-100 hover:bg-slate-800/70'
                          : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      Details
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={`rounded-2xl overflow-hidden border ${isDarkMode ? 'border-slate-800/70' : 'border-gray-200'}`}>
            <table className="min-w-full">
              <thead className="bg-transparent">
                <tr>
                  <th
                    onClick={() => handleSort('ticker')}
                    className={`px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer ${
                      isDarkMode ? 'text-slate-300' : 'text-gray-600'
                    }`}
                  >
                    Ticker {sortBy === 'ticker' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th
                    onClick={() => handleSort('name')}
                    className={`px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer ${
                      isDarkMode ? 'text-slate-300' : 'text-gray-600'
                    }`}
                  >
                    Company Name {sortBy === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className={`px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-slate-300' : 'text-gray-600'}`}>
                    Exchange
                  </th>
                  <th className={`px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-slate-300' : 'text-gray-600'}`}>
                    Data Available
                  </th>
                  <th
                    onClick={() => handleSort('lastModified')}
                    className={`px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider cursor-pointer ${
                      isDarkMode ? 'text-slate-300' : 'text-gray-600'
                    }`}
                  >
                    Last Modified {sortBy === 'lastModified' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className={`px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? 'text-slate-300' : 'text-gray-600'}`}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className={isDarkMode ? 'divide-y divide-slate-800/70' : 'divide-y divide-gray-200'}>
                {filteredAndSortedCompanies.map((companyData) => (
                  <tr
                    key={companyData.company.ticker}
                    className={`${isDarkMode ? 'hover:bg-slate-800/50' : 'hover:bg-gray-50'} transition`}
                  >
                    <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${isDarkMode ? 'text-slate-50' : 'text-gray-900'}`}>
                      {companyData.company.ticker}
                    </td>
                    <td className={`px-6 py-4 text-sm max-w-xs truncate ${isDarkMode ? 'text-slate-100' : 'text-gray-900'}`}>
                      {companyData.company.name}
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap text-sm ${mutedText}`}>
                      {companyData.company.exchange}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex flex-wrap gap-1">
                        {getDataBadges(companyData).map((badge, index) => (
                          <span
                            key={index}
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${badgeClassNames(badge.color)}`}
                          >
                            {badge.label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap text-sm ${mutedText}`}>
                      {new Date(companyData.lastModified).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex gap-2">
                        <Link
                          href={`/memory/${companyData.company.ticker}`}
                          className={isDarkMode ? 'text-blue-300 hover:text-blue-200' : 'text-blue-600 hover:text-blue-800'}
                        >
                          Open
                        </Link>
                        <button
                          onClick={() => setSelectedCompany(companyData)}
                          className={isDarkMode ? 'text-slate-300 hover:text-slate-100' : 'text-gray-600 hover:text-gray-900'}
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

        {selectedCompany && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm overflow-y-auto h-full w-full z-50">
            <div className={`relative top-20 mx-auto p-5 w-96 rounded-2xl shadow-xl ${cardSurface} ${isDarkMode ? 'text-slate-100' : 'text-gray-900'}`}>
              <div className="mt-1">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium">
                    {selectedCompany.company.ticker} Details
                  </h3>
                  <button
                    onClick={() => setSelectedCompany(null)}
                    className={`transition ${isDarkMode ? 'text-slate-400 hover:text-slate-200' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                
                <div className="space-y-3">
                  <div>
                    <label className={`block text-sm font-medium ${labelColor}`}>Company Name</label>
                    <p className="text-sm">{selectedCompany.company.name}</p>
                  </div>
                  
                  <div>
                    <label className={`block text-sm font-medium ${labelColor}`}>Exchange</label>
                    <p className="text-sm">{selectedCompany.company.exchange}</p>
                  </div>
                  
                  <div>
                    <label className={`block text-sm font-medium ${labelColor}`}>Created</label>
                    <p className="text-sm">
                      {new Date(selectedCompany.company.createdAt).toLocaleString()}
                    </p>
                  </div>
                  
                  <div>
                    <label className={`block text-sm font-medium ${labelColor}`}>Last Updated</label>
                    <p className="text-sm">
                      {new Date(selectedCompany.company.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  
                  <div>
                    <label className={`block text-sm font-medium ${labelColor}`}>Available Data</label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {getDataBadges(selectedCompany).map((badge, index) => (
                        <span
                          key={index}
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${badgeClassNames(badge.color)}`}
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
                    className={`flex-1 text-center px-4 py-2 text-sm font-medium rounded-full transition ${
                      isDarkMode ? 'bg-blue-500 text-white hover:bg-blue-400' : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                    onClick={() => setSelectedCompany(null)}
                  >
                    Open Folder
                  </Link>
                  <Link
                    href={`/company/${selectedCompany.company.ticker}/timing`}
                    className={`flex-1 text-center px-4 py-2 text-sm font-medium rounded-full transition ${
                      isDarkMode ? 'bg-emerald-500 text-white hover:bg-emerald-400' : 'bg-green-600 text-white hover:bg-green-700'
                    }`}
                    onClick={() => setSelectedCompany(null)}
                  >
                    Start Analysis
                  </Link>
                  <button
                    onClick={() => setSelectedCompany(null)}
                    className={`px-4 py-2 text-sm font-medium rounded-full border transition ${
                      isDarkMode
                        ? 'border-slate-700 text-slate-100 hover:bg-slate-800/70'
                        : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
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
