"use client"

import React, { useState, useEffect } from 'react';
import { BacktestSummary, ROOutcome } from '@/lib/backtest/types';
import VarDiagnosticsPanel from './VarDiagnosticsPanel';

interface BacktestSymbol {
  symbol: string;
  latest_update: string;
  total_metrics: number;
  engines: string[];
}

interface BacktestData {
  symbol: string;
  outcome: ROOutcome;
  summary: BacktestSummary;
}

export default function BacktestDashboard() {
  const [symbols, setSymbols] = useState<BacktestSymbol[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [backtestData, setBacktestData] = useState<BacktestData | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningBacktest, setRunningBacktest] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  // New backtest form
  const [newSymbol, setNewSymbol] = useState('SPY');
  const [trainYears, setTrainYears] = useState(3);
  const [alpha, setAlpha] = useState(0.10);
  const [selectedEngines, setSelectedEngines] = useState<string[]>(['garch_bootstrap', 'exp_smooth']);

  const availableEngines = [
    'garch_bootstrap',
    'exp_smooth', 
    'linear',
    'gbm_cc',
    'range_yz',
    'conformal_cqr'
  ];

  useEffect(() => {
    loadSymbols();
  }, []);

  const loadSymbols = async () => {
    try {
      const response = await fetch('/api/backtest?action=list');
      const data = await response.json();
      setSymbols(data.symbols || []);
    } catch (error) {
      console.error('Failed to load symbols:', error);
    }
  };

  const loadBacktestData = async (symbol: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/backtest?symbol=${symbol}`);
      if (response.ok) {
        const data = await response.json();
        const summaryResponse = await fetch(`/api/backtest?symbol=${symbol}&action=summary`);
        const summaryData = summaryResponse.ok ? await summaryResponse.json() : null;
        
        setBacktestData({
          symbol: data.symbol,
          outcome: data.outcome,
          summary: summaryData?.summary || {}
        });
      }
    } catch (error) {
      console.error('Failed to load backtest data:', error);
    } finally {
      setLoading(false);
    }
  };

  const runNewBacktest = async () => {
    setRunningBacktest(true);
    try {
      const response = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: newSymbol,
          train_years: trainYears,
          alpha: alpha,
          horizon_h: [1, 5, 20],
          engines: selectedEngines
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Backtest completed:', data);
        
        // Refresh symbols list
        await loadSymbols();
        
        // Load the new data
        setSelectedSymbol(newSymbol);
        await loadBacktestData(newSymbol);
      } else {
        const error = await response.json();
        console.error('Backtest failed:', error);
      }
    } catch (error) {
      console.error('Failed to run backtest:', error);
    } finally {
      setRunningBacktest(false);
    }
  };

  const toggleEngine = (engine: string) => {
    setSelectedEngines(prev => 
      prev.includes(engine) 
        ? prev.filter(e => e !== engine)
        : [...prev, engine]
    );
  };

  const formatPercent = (value: number | undefined) => {
    if (value === undefined) return 'N/A';
    return `${(value * 100).toFixed(1)}%`;
  };

  const formatNumber = (value: number | undefined, decimals = 2) => {
    if (value === undefined) return 'N/A';
    return value.toFixed(decimals);
  };

  const getCoverageColor = (coverage: number | undefined) => {
    if (coverage === undefined) return 'text-gray-500';
    if (coverage >= 0.90) return 'text-green-600';
    if (coverage >= 0.85) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getOverfitStatus = (pbo: number | undefined, dsr: number | undefined) => {
    if (pbo === undefined && dsr === undefined) return { color: 'text-gray-500', text: 'N/A' };
    
    const hasPBOIssue = pbo !== undefined && pbo > 0.5;
    const hasDSRIssue = dsr !== undefined && dsr < 1.0;
    
    if (hasPBOIssue || hasDSRIssue) {
      return { color: 'text-red-600', text: 'Risk Detected' };
    }
    return { color: 'text-green-600', text: 'Healthy' };
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Backtest Dashboard</h1>
              <p className="text-gray-600">Rolling-Origin Cross-Validation & Prediction Intervals</p>
            </div>
            <div className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
              {symbols.length} Symbols Tested
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6" aria-label="Tabs">
              {[
                { id: 'overview', name: 'Overview' },
                { id: 'details', name: 'Analysis Details' },
                { id: 'var', name: 'VaR Diagnostics' },
                { id: 'new', name: 'Run New Backtest' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.name}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6">
            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                
                {/* Symbol Selection */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h3 className="text-lg font-medium mb-4">Select Symbol</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Available Symbols
                      </label>
                      <select
                        value={selectedSymbol}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                          setSelectedSymbol(e.target.value);
                          loadBacktestData(e.target.value);
                        }}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="">Choose a symbol...</option>
                        {symbols.map(s => (
                          <option key={s.symbol} value={s.symbol}>
                            {s.symbol} ({s.total_metrics} predictions)
                          </option>
                        ))}
                      </select>
                    </div>
                    
                    {selectedSymbol && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Engines Tested
                        </label>
                        <div className="flex flex-wrap gap-1">
                          {symbols.find(s => s.symbol === selectedSymbol)?.engines.map(engine => (
                            <span
                              key={engine}
                              className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                            >
                              {engine}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Key Metrics */}
                {backtestData && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    
                    {/* Coverage Rate */}
                    <div className="bg-white border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-gray-700">Coverage (250d)</h4>
                        <span className="text-green-600">✓</span>
                      </div>
                      <div className={`text-2xl font-bold ${getCoverageColor(backtestData.summary.coverage_250d)}`}>
                        {formatPercent(backtestData.summary.coverage_250d)}
                      </div>
                      <div className={`text-xs mt-1 ${
                        getCoverageColor(backtestData.summary.coverage_250d) === 'text-green-600' ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {getCoverageColor(backtestData.summary.coverage_250d) === 'text-green-600' ? 'Good' : 'Needs Attention'}
                      </div>
                    </div>

                    {/* Interval Score */}
                    <div className="bg-white border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-gray-700">Avg Interval Score</h4>
                        <span className="text-blue-600">📊</span>
                      </div>
                      <div className="text-2xl font-bold text-blue-600">
                        {formatNumber(backtestData.summary.avg_interval_score)}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Lower is better</p>
                    </div>

                    {/* Statistical Test */}
                    <div className="bg-white border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-gray-700">DM Test p-value</h4>
                        <span className="text-purple-600">📈</span>
                      </div>
                      <div className="text-2xl font-bold text-purple-600">
                        {formatNumber(backtestData.summary.dm_pvalue)}
                      </div>
                      <div className={`text-xs mt-1 ${
                        backtestData.summary.dm_pvalue !== undefined && backtestData.summary.dm_pvalue < 0.05 
                          ? 'text-green-600' : 'text-gray-500'
                      }`}>
                        {backtestData.summary.dm_pvalue !== undefined && backtestData.summary.dm_pvalue < 0.05 
                          ? 'Significant' : 'Not Significant'}
                      </div>
                    </div>

                    {/* Overfitting Guard */}
                    <div className="bg-white border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium text-gray-700">Overfitting Risk</h4>
                        <span className="text-orange-600">⚠️</span>
                      </div>
                      <div className={`text-lg font-bold ${getOverfitStatus(backtestData.summary.pbo, backtestData.summary.dsr).color}`}>
                        {getOverfitStatus(backtestData.summary.pbo, backtestData.summary.dsr).text}
                      </div>
                      <div className="text-xs mt-1 text-gray-600">
                        PBO: {formatPercent(backtestData.summary.pbo)}
                      </div>
                    </div>

                  </div>
                )}

                {/* Loading State */}
                {loading && (
                  <div className="bg-white border rounded-lg p-8 text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    Loading backtest data...
                  </div>
                )}

              </div>
            )}

            {/* Details Tab */}
            {activeTab === 'details' && (
              <div>
                {backtestData ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    
                    {/* Bootstrap Confidence Intervals */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h3 className="text-lg font-medium mb-4">Bootstrap Confidence Intervals</h3>
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span>Coverage CI:</span>
                          <span className="font-mono text-sm">
                            {backtestData.summary.bootstrap_coverage_ci 
                              ? `[${formatPercent(backtestData.summary.bootstrap_coverage_ci[0])}, ${formatPercent(backtestData.summary.bootstrap_coverage_ci[1])}]`
                              : 'N/A'
                            }
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Interval Score CI:</span>
                          <span className="font-mono text-sm">
                            {backtestData.summary.bootstrap_is_ci 
                              ? `[${formatNumber(backtestData.summary.bootstrap_is_ci[0])}, ${formatNumber(backtestData.summary.bootstrap_is_ci[1])}]`
                              : 'N/A'
                            }
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Regime Analysis */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h3 className="text-lg font-medium mb-4">Regime Detection</h3>
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span>Regime Breaks:</span>
                          <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm">
                            {backtestData.summary.regime_count || 0}
                          </span>
                        </div>
                        {backtestData.outcome.regimes?.break_dates && backtestData.outcome.regimes.break_dates.length > 0 && (
                          <div className="text-sm text-gray-600">
                            Latest break: {backtestData.outcome.regimes.break_dates[backtestData.outcome.regimes.break_dates.length - 1]}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Multiplicity Control */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h3 className="text-lg font-medium mb-4">Multiple Testing</h3>
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span>FDR Level:</span>
                          <span>{formatPercent(backtestData.summary.fdr_q)}</span>
                        </div>
                        {backtestData.outcome.multiplicity?.adjusted && (
                          <div className="text-sm text-gray-600">
                            {backtestData.outcome.multiplicity.adjusted.length} tests adjusted
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Survival Analysis */}
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h3 className="text-lg font-medium mb-4">Survival Metrics</h3>
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span>C-Index:</span>
                          <span>{formatNumber(backtestData.summary.c_index)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>IBS:</span>
                          <span>{formatNumber(backtestData.summary.ibs)}</span>
                        </div>
                      </div>
                    </div>

                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    Select a symbol to view detailed analysis
                  </div>
                )}
              </div>
            )}

            {/* VaR Diagnostics Tab */}
            {activeTab === 'var' && (
              <div className="space-y-6">
                {backtestData && selectedSymbol ? (
                  <div>
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-gray-900 mb-2">VaR Model Validation</h3>
                      <p className="text-sm text-gray-600">
                        Comprehensive Value-at-Risk diagnostics across forecasting models using Basel-style backtesting framework
                      </p>
                    </div>
                    
                    {/* VaR Diagnostics for different horizons and coverages */}
                    <div className="space-y-6">
                      
                      {/* 1-Day, 95% Coverage */}
                      <VarDiagnosticsPanel
                        symbol={selectedSymbol}
                        horizonTrading={1}
                        coverage={0.95}
                        className="mb-6"
                      />
                      
                      {/* 1-Day, 99% Coverage */}
                      <VarDiagnosticsPanel
                        symbol={selectedSymbol}
                        horizonTrading={1}
                        coverage={0.99}
                        className="mb-6"
                      />
                      
                      {/* 5-Day, 95% Coverage */}
                      <VarDiagnosticsPanel
                        symbol={selectedSymbol}
                        horizonTrading={5}
                        coverage={0.95}
                        className="mb-6"
                      />
                      
                    </div>

                    {/* VaR Interpretation Guide */}
                    <div className="bg-blue-50 rounded-lg p-6 mt-8">
                      <h4 className="text-md font-semibold text-blue-900 mb-3">VaR Diagnostics Guide</h4>
                      <div className="space-y-2 text-sm text-blue-800">
                        <div><span className="font-medium">Kupiec POF Test:</span> Tests whether the observed breach rate equals the nominal α level. p &lt; 0.05 indicates significant deviation.</div>
                        <div><span className="font-medium">LR Independence Test:</span> Tests whether violations cluster in time (bad) or occur independently (good). p &lt; 0.05 indicates problematic clustering.</div>
                        <div><span className="font-medium">LR Conditional Coverage:</span> Combined test for both correct breach rate and independence. p &lt; 0.05 indicates model inadequacy.</div>
                        <div><span className="font-medium">Traffic Light System:</span> Basel-style classification based on binomial tail probabilities.</div>
                        <div className="mt-3 pt-3 border-t border-blue-200">
                          <span className="font-medium">Expected Results:</span> GARCH11-t should show better tail behavior than GARCH11-N and GBM in extreme market conditions due to heavy-tailed Student-t distribution.
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    Select a symbol to view VaR diagnostics
                  </div>
                )}
              </div>
            )}

            {/* New Backtest Tab */}
            {activeTab === 'new' && (
              <div className="max-w-2xl mx-auto">
                <div className="bg-gray-50 rounded-lg p-6">
                  <h3 className="text-lg font-medium mb-4">Run New Backtest</h3>
                  <p className="text-sm text-gray-600 mb-6">
                    Configure and launch a rolling-origin cross-validation backtest
                  </p>
                  
                  <div className="space-y-4">
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Symbol
                        </label>
                        <input
                          type="text"
                          value={newSymbol}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewSymbol(e.target.value.toUpperCase())}
                          placeholder="SPY"
                          className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Training Years
                        </label>
                        <select
                          value={trainYears}
                          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTrainYears(parseInt(e.target.value))}
                          className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value={2}>2 years</option>
                          <option value={3}>3 years</option>
                          <option value={5}>5 years</option>
                        </select>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Confidence Level (α)
                        </label>
                        <select
                          value={alpha}
                          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAlpha(parseFloat(e.target.value))}
                          className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value={0.05}>95% (α=0.05)</option>
                          <option value={0.10}>90% (α=0.10)</option>
                          <option value={0.20}>80% (α=0.20)</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Forecasting Engines
                      </label>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {availableEngines.map(engine => (
                          <label
                            key={engine}
                            className="flex items-center space-x-2 cursor-pointer p-2 rounded border hover:bg-gray-50"
                          >
                            <input
                              type="checkbox"
                              checked={selectedEngines.includes(engine)}
                              onChange={() => toggleEngine(engine)}
                              className="rounded"
                            />
                            <span className="text-sm">{engine}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={runNewBacktest}
                      disabled={runningBacktest || selectedEngines.length === 0}
                      className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                      {runningBacktest ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          Running Backtest...
                        </>
                      ) : (
                        'Start Backtest'
                      )}
                    </button>

                    {runningBacktest && (
                      <div className="text-sm text-gray-600 text-center">
                        This may take several minutes to complete...
                      </div>
                    )}

                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}