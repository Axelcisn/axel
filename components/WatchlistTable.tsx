"use client"

import React, { useState, useMemo } from 'react';
import { WatchlistRow } from '@/lib/watchlist/types';
import { useDarkMode } from '@/lib/hooks/useDarkMode';

interface WatchlistTableProps {
  rows: WatchlistRow[];
}

type SortField = 'symbol' | 'direction' | 'z_B' | 'T_hat_median' | 'L_1' | 'U_1' | 'pi_coverage_250d' | 'interval_score' | 'c_index' | 'pbo' | 'dsr';
type SortDirection = 'asc' | 'desc';

interface FilterState {
  direction: string;
  source: string;
  vol_regime_min: number;
  coverage_min: number;
  pbo_max: number;
}

export default function WatchlistTable({ rows }: WatchlistTableProps) {
  const [sortField, setSortField] = useState<SortField>('symbol');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [filters, setFilters] = useState<FilterState>({
    direction: 'all',
    source: 'all',
    vol_regime_min: 0,
    coverage_min: 0,
    pbo_max: 1
  });
  const isDarkMode = useDarkMode();

  // Sort and filter data
  const filteredAndSortedRows = useMemo(() => {
    let filtered = rows.filter(row => {
      // Direction filter
      if (filters.direction !== 'all' && row.deviation.direction !== filters.direction) return false;
      
      // Source filter
      if (filters.source !== 'all' && row.forecast.source !== filters.source) return false;
      
      // Vol regime filter
      if (row.deviation.vol_regime_pct != null && row.deviation.vol_regime_pct < filters.vol_regime_min) return false;
      
      // Coverage filter
      if (row.quality.pi_coverage_250d != null && row.quality.pi_coverage_250d < filters.coverage_min) return false;
      
      // PBO filter
      if (row.quality.pbo != null && row.quality.pbo > filters.pbo_max) return false;
      
      return true;
    });

    // Sort
    filtered.sort((a, b) => {
      let aVal: any, bVal: any;
      
      switch (sortField) {
        case 'symbol':
          aVal = a.symbol;
          bVal = b.symbol;
          break;
        case 'direction':
          aVal = a.deviation.direction;
          bVal = b.deviation.direction;
          break;
        case 'z_B':
          aVal = a.deviation.z_B ?? -Infinity;
          bVal = b.deviation.z_B ?? -Infinity;
          break;
        case 'T_hat_median':
          aVal = a.forecast.T_hat_median ?? -Infinity;
          bVal = b.forecast.T_hat_median ?? -Infinity;
          break;
        case 'L_1':
          aVal = a.bands.L_1 ?? -Infinity;
          bVal = b.bands.L_1 ?? -Infinity;
          break;
        case 'U_1':
          aVal = a.bands.U_1 ?? -Infinity;
          bVal = b.bands.U_1 ?? -Infinity;
          break;
        case 'pi_coverage_250d':
          aVal = a.quality.pi_coverage_250d ?? -Infinity;
          bVal = b.quality.pi_coverage_250d ?? -Infinity;
          break;
        case 'interval_score':
          aVal = a.quality.interval_score ?? Infinity;
          bVal = b.quality.interval_score ?? Infinity;
          break;
        case 'c_index':
          aVal = a.quality.c_index ?? -Infinity;
          bVal = b.quality.c_index ?? -Infinity;
          break;
        case 'pbo':
          aVal = a.quality.pbo ?? -Infinity;
          bVal = b.quality.pbo ?? -Infinity;
          break;
        case 'dsr':
          aVal = a.quality.dsr ?? -Infinity;
          bVal = b.quality.dsr ?? -Infinity;
          break;
        default:
          aVal = a.symbol;
          bVal = b.symbol;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      
      if (sortDirection === 'asc') {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      } else {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      }
    });

    return filtered;
  }, [rows, sortField, sortDirection, filters]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const formatNumber = (value: number | null | undefined, decimals = 2) => {
    if (value === null || value === undefined) return 'N/A';
    return value.toFixed(decimals);
  };

  const formatPercent = (value: number | null | undefined) => {
    if (value === null || value === undefined) return 'N/A';
    return `${(value * 100).toFixed(1)}%`;
  };

  const getDirectionColor = (direction: string) => {
    if (isDarkMode) {
      switch (direction) {
        case 'up': return 'text-green-300 bg-green-900';
        case 'down': return 'text-red-300 bg-red-900';
        default: return 'text-gray-300 bg-gray-800';
      }
    } else {
      switch (direction) {
        case 'up': return 'text-green-600 bg-green-100';
        case 'down': return 'text-red-600 bg-red-100';
        default: return 'text-gray-600 bg-gray-100';
      }
    }
  };

  const getCoverageColor = (coverage: number | null | undefined) => {
    if (coverage === null || coverage === undefined) {
      return isDarkMode ? 'text-gray-400' : 'text-gray-600';
    }
    if (coverage >= 0.90) return isDarkMode ? 'text-green-300' : 'text-green-600';
    if (coverage >= 0.85) return isDarkMode ? 'text-yellow-300' : 'text-yellow-600';
    return isDarkMode ? 'text-red-300' : 'text-red-600';
  };

  const getOverfitColor = (pbo: number | null | undefined) => {
    if (pbo === null || pbo === undefined) {
      return isDarkMode ? 'text-gray-400' : 'text-gray-600';
    }
    if (pbo > 0.7) return isDarkMode ? 'text-red-300' : 'text-red-600';
    if (pbo > 0.5) return isDarkMode ? 'text-yellow-300' : 'text-yellow-600';
    return isDarkMode ? 'text-green-300' : 'text-green-600';
  };

  const renderProvenance = (row: WatchlistRow) => {
    const chips = [];
    
    // PI Engine chip
    if (row.provenance.pi_engine) {
      chips.push(
        <span key="pi" className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
          isDarkMode ? 'bg-blue-900 text-blue-200' : 'bg-blue-100 text-blue-800'
        }`}>
          {row.provenance.pi_engine}
        </span>
      );
    }

    // Range sigma chip
    if (row.provenance.range_sigma) {
      chips.push(
        <span key="range" className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
          isDarkMode ? 'bg-purple-900 text-purple-200' : 'bg-purple-100 text-purple-800'
        }`}>
          {row.provenance.range_sigma}
        </span>
      );
    }

    // Conformal chip
    if (row.provenance.conformal_mode) {
      chips.push(
        <span key="conformal" className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
          isDarkMode ? 'bg-indigo-900 text-indigo-200' : 'bg-indigo-100 text-indigo-800'
        }`}>
          {row.provenance.conformal_mode}
        </span>
      );
    }

    // Survival model chip
    if (row.provenance.surv_model) {
      chips.push(
        <span key="surv" className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
          isDarkMode ? 'bg-green-900 text-green-200' : 'bg-green-100 text-green-800'
        }`}>
          {row.provenance.surv_model}
        </span>
      );
    }

    // Evaluation chip
    chips.push(
      <span key="eval" className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
        isDarkMode ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-800'
      }`}>
        {row.provenance.evaluation}
      </span>
    );

    return (
      <div className="flex flex-wrap gap-1">
        {chips}
      </div>
    );
  };

  const renderProbabilities = (P_ge_k: Record<number, number>) => {
    const keys = Object.keys(P_ge_k).map(k => parseInt(k)).sort((a, b) => a - b);
    return (
      <div className="flex flex-wrap gap-1">
        {keys.map(k => (
          <span key={k} className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs ${
            isDarkMode ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-700'
          }`}>
            P({k}): {formatPercent(P_ge_k[k])}
          </span>
        ))}
      </div>
    );
  };

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <th 
      className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider cursor-pointer ${
        isDarkMode 
          ? 'text-gray-400 hover:bg-gray-700' 
          : 'text-gray-500 hover:bg-gray-100'
      }`}
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center">
        {children}
        {sortField === field && (
          <span className="ml-1">
            {sortDirection === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </div>
    </th>
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className={`p-4 rounded-lg ${isDarkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
        <h3 className={`text-sm font-medium mb-3 ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>Filters</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          
          <div>
            <label className={`block text-xs mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Direction</label>
            <select
              value={filters.direction}
              onChange={(e) => setFilters({...filters, direction: e.target.value})}
              className={`w-full text-sm border rounded px-2 py-1 ${
                isDarkMode 
                  ? 'bg-gray-800 border-gray-600 text-white' 
                  : 'bg-white border-gray-300 text-gray-900'
              }`}
            >
              <option value="all">All</option>
              <option value="up">Up</option>
              <option value="down">Down</option>
              <option value="none">None</option>
            </select>
          </div>

          <div>
            <label className={`block text-xs mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Source</label>
            <select
              value={filters.source}
              onChange={(e) => setFilters({...filters, source: e.target.value})}
              className={`w-full text-sm border rounded px-2 py-1 ${
                isDarkMode 
                  ? 'bg-gray-800 border-gray-600 text-white' 
                  : 'bg-white border-gray-300 text-gray-900'
              }`}
            >
              <option value="all">All</option>
              <option value="KM">KM</option>
              <option value="Cox">Cox</option>
              <option value="AFT">AFT</option>
              <option value="none">None</option>
            </select>
          </div>

          <div>
            <label className={`block text-xs mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Vol Regime % (min)</label>
            <input
              type="number"
              min="0"
              max="100"
              step="10"
              value={filters.vol_regime_min}
              onChange={(e) => setFilters({...filters, vol_regime_min: parseFloat(e.target.value) || 0})}
              className={`w-full text-sm border rounded px-2 py-1 ${
                isDarkMode 
                  ? 'bg-gray-800 border-gray-600 text-white' 
                  : 'bg-white border-gray-300 text-gray-900'
              }`}
            />
          </div>

          <div>
            <label className={`block text-xs mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Coverage % (min)</label>
            <input
              type="number"
              min="0"
              max="100"
              step="5"
              value={filters.coverage_min * 100}
              onChange={(e) => setFilters({...filters, coverage_min: (parseFloat(e.target.value) || 0) / 100})}
              className={`w-full text-sm border rounded px-2 py-1 ${
                isDarkMode 
                  ? 'bg-gray-800 border-gray-600 text-white' 
                  : 'bg-white border-gray-300 text-gray-900'
              }`}
            />
          </div>

          <div>
            <label className={`block text-xs mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>PBO (max)</label>
            <input
              type="number"
              min="0"
              max="1"
              step="0.1"
              value={filters.pbo_max}
              onChange={(e) => setFilters({...filters, pbo_max: parseFloat(e.target.value) || 1})}
              className={`w-full text-sm border rounded px-2 py-1 ${
                isDarkMode 
                  ? 'bg-gray-800 border-gray-600 text-white' 
                  : 'bg-white border-gray-300 text-gray-900'
              }`}
            />
          </div>

        </div>
      </div>

      {/* Results summary */}
      <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
        Showing {filteredAndSortedRows.length} of {rows.length} symbols
      </div>

      {/* Table */}
      <div className={`overflow-x-auto shadow ring-1 ring-opacity-5 md:rounded-lg ${
        isDarkMode ? 'ring-gray-700' : 'ring-black'
      }`}>
        <table className={`min-w-full divide-y ${isDarkMode ? 'divide-gray-600' : 'divide-gray-300'}`}>
          <thead className={`${isDarkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
            <tr>
              <SortHeader field="symbol">Symbol</SortHeader>
              <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                isDarkMode ? 'text-gray-400' : 'text-gray-500'
              }`}>
                Deviation
              </th>
              <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                isDarkMode ? 'text-gray-400' : 'text-gray-500'
              }`}>
                Forecast
              </th>
              <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                isDarkMode ? 'text-gray-400' : 'text-gray-500'
              }`}>
                Bands
              </th>
              <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                isDarkMode ? 'text-gray-400' : 'text-gray-500'
              }`}>
                Quality
              </th>
              <th className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider ${
                isDarkMode ? 'text-gray-400' : 'text-gray-500'
              }`}>
                Provenance
              </th>
            </tr>
          </thead>
          <tbody className={`divide-y ${
            isDarkMode 
              ? 'bg-gray-900 divide-gray-700' 
              : 'bg-white divide-gray-200'
          }`}>
            {filteredAndSortedRows.map((row) => (
              <tr key={row.symbol} className={`${
                isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-50'
              }`}>
                
                {/* Symbol */}
                <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${
                  isDarkMode ? 'text-gray-100' : 'text-gray-900'
                }`}>
                  {row.symbol}
                  <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{row.as_of}</div>
                </td>

                {/* Deviation */}
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <div className="space-y-1">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getDirectionColor(row.deviation.direction)}`}>
                      {row.deviation.direction}
                    </span>
                    {row.deviation.z_B && (
                      <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>z_B: {formatNumber(row.deviation.z_B)}</div>
                    )}
                    {row.deviation.pct_outside_B && (
                      <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>%out: {formatPercent(row.deviation.pct_outside_B)}</div>
                    )}
                    {row.deviation.vol_regime_pct && (
                      <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>vol: {formatPercent(row.deviation.vol_regime_pct)}</div>
                    )}
                  </div>
                </td>

                {/* Forecast */}
                <td className="px-6 py-4 text-sm">
                  <div className="space-y-1">
                    <div className="flex items-center">
                      <span className={`text-xs px-2 py-0.5 rounded mr-2 ${
                        isDarkMode ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-700'
                      }`}>
                        {row.forecast.source}
                      </span>
                      <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                        T̂: {formatNumber(row.forecast.T_hat_median)}
                      </span>
                    </div>
                    {row.forecast.I60 && (
                      <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        I60: [{formatNumber(row.forecast.I60[0])}, {formatNumber(row.forecast.I60[1])}]
                      </div>
                    )}
                    {row.forecast.I80 && (
                      <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        I80: [{formatNumber(row.forecast.I80[0])}, {formatNumber(row.forecast.I80[1])}]
                      </div>
                    )}
                    {Object.keys(row.forecast.P_ge_k).length > 0 && (
                      <div className="mt-1">
                        {renderProbabilities(row.forecast.P_ge_k)}
                      </div>
                    )}
                    {row.forecast.next_review_date && (
                      <div className={`text-xs font-medium ${
                        isDarkMode ? 'text-blue-300' : 'text-blue-600'
                      }`}>
                        Review: {row.forecast.next_review_date}
                      </div>
                    )}
                  </div>
                </td>

                {/* Bands */}
                <td className="px-6 py-4 text-sm">
                  <div className="space-y-1">
                    <div className="flex space-x-2">
                      <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>L₁:</span>
                      <span className={`font-mono ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>{formatNumber(row.bands.L_1)}</span>
                    </div>
                    <div className="flex space-x-2">
                      <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>U₁:</span>
                      <span className={`font-mono ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>{formatNumber(row.bands.U_1)}</span>
                    </div>
                    {row.bands.sigma_forecast && (
                      <div className="flex space-x-2">
                        <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>σ:</span>
                        <span className={`font-mono text-xs ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>{formatNumber(row.bands.sigma_forecast, 4)}</span>
                      </div>
                    )}
                    <div className="text-xs">
                      <span className={`px-1.5 py-0.5 rounded ${
                        isDarkMode ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-700'
                      }`}>
                        {row.bands.critical.type}
                        {row.bands.critical.df && ` (df=${row.bands.critical.df})`}
                      </span>
                    </div>
                    {row.bands.conformal && (
                      <div className="text-xs">
                        <span className={`px-1.5 py-0.5 rounded ${
                          isDarkMode ? 'bg-indigo-900 text-indigo-200' : 'bg-indigo-100 text-indigo-700'
                        }`}>
                          {row.bands.conformal.mode}
                        </span>
                      </div>
                    )}
                  </div>
                </td>

                {/* Quality */}
                <td className="px-6 py-4 text-sm">
                  <div className="space-y-1">
                    <div className={`text-xs ${getCoverageColor(row.quality.pi_coverage_250d)}`}>
                      Cov: {formatPercent(row.quality.pi_coverage_250d)}
                    </div>
                    <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      IS: {formatNumber(row.quality.interval_score)}
                    </div>
                    {row.quality.c_index && (
                      <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        C-idx: {formatNumber(row.quality.c_index)}
                      </div>
                    )}
                    {row.quality.ibs_20d && (
                      <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        IBS: {formatNumber(row.quality.ibs_20d)}
                      </div>
                    )}
                    {row.quality.pbo && (
                      <div className={`text-xs ${getOverfitColor(row.quality.pbo)}`}>
                        PBO: {formatPercent(row.quality.pbo)}
                      </div>
                    )}
                    {row.quality.dsr && (
                      <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        DSR: {formatNumber(row.quality.dsr)}
                      </div>
                    )}
                    {row.quality.fdr_q && (
                      <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        FDR: {formatPercent(row.quality.fdr_q)}
                      </div>
                    )}
                    {row.quality.regime && (
                      <div className={`text-xs ${
                        isDarkMode ? 'text-orange-300' : 'text-orange-600'
                      }`}>
                        Regime: {row.quality.regime.id}
                      </div>
                    )}
                  </div>
                </td>

                {/* Provenance */}
                <td className="px-6 py-4 text-sm">
                  {renderProvenance(row)}
                </td>

              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredAndSortedRows.length === 0 && (
        <div className={`text-center py-8 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          No watchlist rows match the current filters
        </div>
      )}
    </div>
  );
}