"use client"

import React, { useState, useEffect } from 'react';
import { ForecastRecord } from '@/lib/forecast/types';

interface ProvenancePanelProps {
  symbol: string;
}

export default function ProvenancePanel({ symbol }: ProvenancePanelProps) {
  const [forecast, setForecast] = useState<ForecastRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadLatestForecast = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/forecast/gbm/${symbol}`);
        if (response.ok) {
          const data = await response.json();
          setForecast(data);
        } else if (response.status !== 404) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to load forecast');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    loadLatestForecast();
  }, [symbol]);

  if (loading) {
    return (
      <div className="p-6 border rounded-lg bg-white shadow-sm" data-testid="provenance-panel">
        <h2 className="text-xl font-semibold mb-4">Provenance & Audit Trail</h2>
        <p className="text-gray-500">Loading forecast provenance...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 border rounded-lg bg-white shadow-sm" data-testid="provenance-panel">
        <h2 className="text-xl font-semibold mb-4">Provenance & Audit Trail</h2>
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!forecast) {
    return (
      <div className="p-6 border rounded-lg bg-white shadow-sm" data-testid="provenance-panel">
        <h2 className="text-xl font-semibold mb-4">Provenance & Audit Trail</h2>
        <p className="text-gray-500">No forecast data available</p>
      </div>
    );
  }

  const { provenance } = forecast;

  return (
    <div className="p-6 border rounded-lg bg-white shadow-sm" data-testid="provenance-panel">
      <h2 className="text-xl font-semibold mb-4">Provenance & Audit Trail</h2>
      
      {/* Basic Forecast Info */}
      <div className="mb-6 p-4 bg-gray-50 rounded">
        <h3 className="font-medium mb-3">Latest Final PI</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-600">Method:</span>
            <span className="ml-2 font-mono">{forecast.method}</span>
          </div>
          <div>
            <span className="text-gray-600">Date:</span>
            <span className="ml-2 font-mono">{forecast.date_t}</span>
          </div>
          <div>
            <span className="text-gray-600">Created:</span>
            <span className="ml-2 font-mono">{new Date(forecast.created_at).toLocaleString()}</span>
          </div>
          <div>
            <span className="text-gray-600">Locked:</span>
            <span className="ml-2 font-mono">{forecast.locked ? '🔒 Yes' : '🔓 No'}</span>
          </div>
        </div>
      </div>

      {/* Provenance Details */}
      {provenance ? (
        <div className="space-y-6">
          {/* Parameters Snapshot */}
          <div>
            <h3 className="font-medium mb-3">Parameters Snapshot</h3>
            <div className="p-3 bg-blue-50 border border-blue-200 rounded">
              <pre className="text-sm font-mono overflow-x-auto">
                {JSON.stringify(provenance.params_snapshot, null, 2)}
              </pre>
            </div>
          </div>

          {/* RNG Seed */}
          <div>
            <h3 className="font-medium mb-3">Randomness</h3>
            <div className="p-3 bg-gray-50 border border-gray-200 rounded">
              <div className="text-sm">
                <span className="text-gray-600">RNG Seed:</span>
                <span className="ml-2 font-mono">
                  {provenance.rng_seed || 'null (deterministic)'}
                </span>
              </div>
            </div>
          </div>

          {/* Regime Tag */}
          {provenance.regime_tag && (
            <div>
              <h3 className="font-medium mb-3">Regime Context</h3>
              <div className="p-3 bg-purple-50 border border-purple-200 rounded">
                <div className="text-sm space-y-1">
                  <div>
                    <span className="text-gray-600">Regime ID:</span>
                    <span className="ml-2 font-mono">{provenance.regime_tag.id || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Break Date:</span>
                    <span className="ml-2 font-mono">{provenance.regime_tag.break_date || 'N/A'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Conformal Settings */}
          {provenance.conformal && (
            <div>
              <h3 className="font-medium mb-3">Conformal Prediction Settings</h3>
              <div className="p-3 bg-green-50 border border-green-200 rounded">
                <div className="text-sm space-y-1">
                  <div>
                    <span className="text-gray-600">Mode:</span>
                    <span className="ml-2 font-mono">{provenance.conformal.mode || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Domain:</span>
                    <span className="ml-2 font-mono">{provenance.conformal.domain || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Cal Window:</span>
                    <span className="ml-2 font-mono">{provenance.conformal.cal_window || 'N/A'}</span>
                  </div>
                  {provenance.conformal.q_cal && (
                    <div>
                      <span className="text-gray-600">q_cal:</span>
                      <span className="ml-2 font-mono">{provenance.conformal.q_cal.toFixed(6)}</span>
                    </div>
                  )}
                  {provenance.conformal.q_cal_scaled && (
                    <div>
                      <span className="text-gray-600">q_cal_scaled:</span>
                      <span className="ml-2 font-mono">{provenance.conformal.q_cal_scaled.toFixed(6)}</span>
                    </div>
                  )}
                  {provenance.conformal.delta_L && (
                    <div>
                      <span className="text-gray-600">Δ_L:</span>
                      <span className="ml-2 font-mono">{provenance.conformal.delta_L.toFixed(6)}</span>
                    </div>
                  )}
                  {provenance.conformal.delta_U && (
                    <div>
                      <span className="text-gray-600">Δ_U:</span>
                      <span className="ml-2 font-mono">{provenance.conformal.delta_U.toFixed(6)}</span>
                    </div>
                  )}
                  {provenance.conformal.eta && (
                    <div>
                      <span className="text-gray-600">η (ACI step):</span>
                      <span className="ml-2 font-mono">{provenance.conformal.eta}</span>
                    </div>
                  )}
                  {provenance.conformal.theta && (
                    <div>
                      <span className="text-gray-600">θ (ACI param):</span>
                      <span className="ml-2 font-mono">{provenance.conformal.theta.toFixed(6)}</span>
                    </div>
                  )}
                  {provenance.conformal.K && (
                    <div>
                      <span className="text-gray-600">K (EnbPI size):</span>
                      <span className="ml-2 font-mono">{provenance.conformal.K}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded">
          <p className="text-yellow-700 text-sm">
            No provenance data available for this forecast. 
            This may be from an older forecast created before provenance tracking was enabled.
          </p>
        </div>
      )}

      {/* Audit Information */}
      <div className="mt-6 pt-4 border-t">
        <h3 className="font-medium mb-3">Audit Information</h3>
        <div className="text-xs text-gray-500 space-y-1">
          <div>This forecast record is immutable (locked: {forecast.locked ? 'true' : 'false'})</div>
          <div>Created at: {new Date(forecast.created_at).toISOString()}</div>
          <div>Symbol: {forecast.symbol}</div>
          <div>Method: {forecast.method}</div>
        </div>
      </div>
    </div>
  );
}