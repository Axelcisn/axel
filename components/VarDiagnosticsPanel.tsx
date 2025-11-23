'use client';

import { useState, useEffect } from 'react';
import { VarDiagnostics, computeVarDiagnostics } from '@/lib/var/backtest';

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

  // Compute VaR diagnostics when inputs change
  useEffect(() => {
    async function loadDiagnostics() {
      if (!symbol) return;

      setState(prev => ({ ...prev, loading: true, error: null }));

      try {
        const models: ModelKey[] = ["GBM", "GARCH11-N", "GARCH11-t"];
        const alpha = 1 - coverage;
        
        // Use last 250 trading days as backtest window
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // Approx 1 year back
        
        const diagnostics = await computeVarDiagnostics({
          symbol,
          models,
          horizonTrading,
          coverage,
          startDate,
          endDate
        });

        setState({
          data: diagnostics,
          loading: false,
          error: null
        });

      } catch (error) {
        console.error('Failed to load VaR diagnostics:', error);
        setState({
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    loadDiagnostics();
  }, [symbol, horizonTrading, coverage]);

  if (state.loading) {
    return (
      <div className={`bg-white rounded-lg border border-gray-200 ${className}`}>
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">VaR Diagnostics</h3>
        </div>
        <div className="p-4">
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-600">Loading VaR diagnostics...</span>
          </div>
        </div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className={`bg-white rounded-lg border border-gray-200 ${className}`}>
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">VaR Diagnostics</h3>
        </div>
        <div className="p-4">
          <div className="text-red-600 text-sm">
            Error: {state.error}
          </div>
        </div>
      </div>
    );
  }

  if (!state.data) {
    return (
      <div className={`bg-white rounded-lg border border-gray-200 ${className}`}>
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">VaR Diagnostics</h3>
        </div>
        <div className="p-4">
          <div className="text-gray-500 text-sm">No data available</div>
        </div>
      </div>
    );
  }

  const alpha = 1 - coverage;
  const alphaPercent = (alpha * 100).toFixed(1);

  return (
    <div className={`bg-white rounded-lg border border-gray-200 ${className}`}>
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900">VaR Diagnostics</h3>
        <p className="text-sm text-gray-600 mt-1">
          {symbol} • {horizonTrading}D Horizon • {(coverage * 100).toFixed(1)}% Coverage (α = {alphaPercent}%)
        </p>
      </div>
      
      <div className="p-4">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 font-semibold text-gray-700">Model</th>
                <th className="text-center py-2 font-semibold text-gray-700">α</th>
                <th className="text-center py-2 font-semibold text-gray-700">I/n</th>
                <th className="text-center py-2 font-semibold text-gray-700">Kupiec p</th>
                <th className="text-center py-2 font-semibold text-gray-700">LR_ind p</th>
                <th className="text-center py-2 font-semibold text-gray-700">LR_cc p</th>
                <th className="text-center py-2 font-semibold text-gray-700">Zone</th>
              </tr>
            </thead>
            <tbody>
              {(["GBM", "GARCH11-N", "GARCH11-t"] as ModelKey[]).map((model) => {
                const diag = state.data![model];
                if (!diag) return null;

                const { coverage, kupiec, christoffersen, trafficLight } = diag;
                
                return (
                  <tr key={model} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 font-medium text-gray-900">{model}</td>
                    <td className="text-center py-2 text-gray-600">{(coverage.alpha * 100).toFixed(1)}%</td>
                    <td className="text-center py-2 text-gray-600">
                      {kupiec.I}/{coverage.n}
                      <span className="text-xs text-gray-500 ml-1">
                        ({(coverage.empiricalRate * 100).toFixed(1)}%)
                      </span>
                    </td>
                    <td className="text-center py-2">
                      <span className={`${
                        kupiec.pValue < 0.05 ? 'text-red-600' : 
                        kupiec.pValue < 0.10 ? 'text-yellow-600' : 
                        'text-green-600'
                      }`}>
                        {kupiec.pValue.toFixed(3)}
                      </span>
                    </td>
                    <td className="text-center py-2">
                      <span className={`${
                        christoffersen.pValue_ind < 0.05 ? 'text-red-600' : 
                        christoffersen.pValue_ind < 0.10 ? 'text-yellow-600' : 
                        'text-green-600'
                      }`}>
                        {christoffersen.pValue_ind.toFixed(3)}
                      </span>
                    </td>
                    <td className="text-center py-2">
                      <span className={`${
                        christoffersen.pValue_cc < 0.05 ? 'text-red-600' : 
                        christoffersen.pValue_cc < 0.10 ? 'text-yellow-600' : 
                        'text-green-600'
                      }`}>
                        {christoffersen.pValue_cc.toFixed(3)}
                      </span>
                    </td>
                    <td className="text-center py-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getTrafficLightStyles(trafficLight)}`}>
                        {trafficLight}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Summary Information */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-gray-600">
            <div>
              <span className="font-semibold">Kupiec POF:</span> Tests if breach rate = α
            </div>
            <div>
              <span className="font-semibold">LR_ind:</span> Tests independence of violations
            </div>
            <div>
              <span className="font-semibold">LR_cc:</span> Combined coverage test
            </div>
          </div>
          <div className="mt-2 text-xs text-gray-500">
            p-values: <span className="text-green-600">Green ≥ 0.10</span>, 
            <span className="text-yellow-600 ml-1">Yellow 0.05-0.10</span>, 
            <span className="text-red-600 ml-1">Red &lt; 0.05</span>
          </div>
        </div>

        {/* Model Comparison Summary */}
        {state.data && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Coverage Analysis</h4>
            <div className="space-y-1 text-xs text-gray-600">
              {(["GBM", "GARCH11-N", "GARCH11-t"] as ModelKey[]).map((model) => {
                const diag = state.data![model];
                if (!diag || diag.coverage.n === 0) return null;

                const errorBps = Math.abs(diag.coverage.coverageError * 10000);
                const direction = diag.coverage.coverageError > 0 ? 'over' : 'under';
                
                return (
                  <div key={model} className="flex justify-between">
                    <span>{model}:</span>
                    <span className={`${Math.abs(diag.coverage.coverageError) > 0.01 ? 'text-red-600' : 'text-green-600'}`}>
                      {direction}-estimates by {errorBps.toFixed(0)}bp
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Get CSS classes for traffic light styling
 */
function getTrafficLightStyles(zone: "green" | "yellow" | "red"): string {
  switch (zone) {
    case "green":
      return "bg-green-100 text-green-800";
    case "yellow":
      return "bg-yellow-100 text-yellow-800";
    case "red":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}