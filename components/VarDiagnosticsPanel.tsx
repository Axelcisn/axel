'use client';

import { useState, useEffect } from 'react';

// VarDiagnostics type (simplified for client use)
interface VarDiagnostics {
  alpha: number;
  n: number;
  I: number;
  empiricalRate: number;
  kupiec: { pValue: number; };
  christoffersen: { pValue_cc: number; };
  trafficLight: "green" | "yellow" | "red";
}

interface VarDiagnosticsPanelProps {
  symbol: string;
  horizonTrading: number;
  coverage: number;
  className?: string;
}

type ModelKey = "GBM" | "GARCH11-N" | "GARCH11-t";

interface VarDiagnosticsState {
  data: { [model: string]: VarDiagnostics } | null;
  loading: boolean;
  error: string | null;
}

// Helper function to fetch VaR diagnostics from API
async function fetchVarDiagnostics(
  symbol: string,
  model: ModelKey,
  horizon: number,
  coverage: number
): Promise<VarDiagnostics | null> {
  try {
    const params = new URLSearchParams({
      symbol,
      model,
      horizon: horizon.toString(),
      coverage: coverage.toString()
    });

    const response = await fetch(`/api/var-diagnostics?${params}`);
    
    if (!response.ok) {
      console.error(`VaR diagnostics API error for ${model}:`, response.status, response.statusText);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(`Failed to load VaR diagnostics for ${model}:`, error);
    return null;
  }
}

export default function VarDiagnosticsPanel({ 
  symbol, 
  horizonTrading, 
  coverage, 
  className = '' 
}: VarDiagnosticsPanelProps) {
  const [state, setState] = useState<VarDiagnosticsState>({
    data: null,
    loading: false,
    error: null
  });

  // Load VaR diagnostics when inputs change
  useEffect(() => {
    async function loadDiagnostics() {
      if (!symbol) return;

      setState(prev => ({ ...prev, loading: true, error: null }));

      try {
        const models: ModelKey[] = ["GBM", "GARCH11-N", "GARCH11-t"];
        
        // Fetch diagnostics for all models in parallel
        const diagnosticsPromises = models.map(model => 
          fetchVarDiagnostics(symbol, model, horizonTrading, coverage)
        );
        
        const results = await Promise.all(diagnosticsPromises);
        
        // Combine results into data object
        const data: { [model: string]: VarDiagnostics } = {};
        models.forEach((model, index) => {
          if (results[index]) {
            data[model] = results[index]!;
          }
        });

        setState(prev => ({ 
          ...prev, 
          data, 
          loading: false 
        }));

      } catch (error) {
        console.error('Error loading VaR diagnostics:', error);
        setState(prev => ({ 
          ...prev, 
          loading: false, 
          error: 'Failed to load VaR diagnostics' 
        }));
      }
    }

    loadDiagnostics();
  }, [symbol, horizonTrading, coverage]);

  const { data, loading, error } = state;

  if (loading) {
    return (
      <div className={className}>
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={className}>
        <div className="text-red-600 p-4 border border-red-200 rounded-lg">
          <p className="font-semibold">Error Loading VaR Diagnostics</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!data || Object.keys(data).length === 0) {
    return (
      <div className={className}>
        <div className="text-gray-600 p-4 border border-gray-200 rounded-lg">
          <p>No VaR diagnostics available</p>
        </div>
      </div>
    );
  }

  const modelOrder: ModelKey[] = ["GBM", "GARCH11-N", "GARCH11-t"];

  return (
    <div className={className}>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900">VaR Diagnostics</h3>
          <p className="text-sm text-gray-600 mt-1">
            Backtesting results for {symbol} • {horizonTrading}D horizon • {(coverage * 100).toFixed(0)}% coverage
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Model
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  α
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Breaches
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Empirical Rate
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Kupiec p
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  CC p
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Zone
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {modelOrder.map((model) => {
                const diag = data[model];
                if (!diag) return null;

                const zoneColors = {
                  green: 'text-green-600 bg-green-50',
                  yellow: 'text-amber-600 bg-amber-50',
                  red: 'text-red-600 bg-red-50'
                };
                const zoneColor = zoneColors[diag.trafficLight];

                return (
                  <tr key={model} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {model}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {(diag.alpha * 100).toFixed(1)}%
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {diag.I}/{diag.n}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      <span className={`${
                        Math.abs(diag.empiricalRate - diag.alpha) > 0.01 ? 'text-red-600' : 'text-green-600'
                      }`}>
                        {(diag.empiricalRate * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      <span className={`${
                        diag.kupiec.pValue < 0.05 ? 'text-red-600' :
                        diag.kupiec.pValue < 0.10 ? 'text-yellow-600' :
                        'text-green-600'
                      }`}>
                        {diag.kupiec.pValue.toFixed(3)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      <span className={`${
                        diag.christoffersen.pValue_cc < 0.05 ? 'text-red-600' :
                        diag.christoffersen.pValue_cc < 0.10 ? 'text-yellow-600' :
                        'text-green-600'
                      }`}>
                        {diag.christoffersen.pValue_cc.toFixed(3)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${zoneColor}`}>
                        {diag.trafficLight.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Interpretation guide */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          <h4 className="text-sm font-semibold text-gray-900 mb-2">Interpretation Guide</h4>
          <div className="text-xs text-gray-600 space-y-1">
            <p><strong>Kupiec POF:</strong> Tests if empirical breach rate equals nominal α (p {">"} 0.05 preferred)</p>
            <p><strong>Conditional Coverage (CC):</strong> Joint test of correct rate and independence (p {">"} 0.05 preferred)</p>
            <p><strong>Traffic Light:</strong> 🟢 Green (good), 🟡 Yellow (attention), 🔴 Red (concern)</p>
          </div>
        </div>
      </div>
    </div>
  );
}