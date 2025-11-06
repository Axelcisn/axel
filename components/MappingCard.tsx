'use client';

import { useState, useEffect, useCallback } from 'react';

type KmBinStats = {
  bin: {
    z_abs_lower: number;
    z_abs_upper: number;
    vol_regime?: string;
    label: string;
  };
  n_events: number;
  n_censored: number;
  S_at_k: Record<number, number>;
  median_T_hat: number | null;
  I60: [number, number] | null;
  I80: [number, number] | null;
};

type CoxFit = {
  coef: Record<string, number>;
  se: Record<string, number>;
  HR: Record<string, number>;
  HR_CI: Record<string, [number, number]>;
  PH_ok: boolean;
  diagnostics: { schoenfeld_p?: Record<string, number> };
  performance?: { c_index?: number };
};

type MappingSummary = {
  symbol: string;
  bins: KmBinStats[];
  cox?: CoxFit;
  updated_at: string;
};

interface MappingCardProps {
  symbol: string;
}

export function MappingCard({ symbol }: MappingCardProps) {
  const [mappingData, setMappingData] = useState<MappingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMappingData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(`/api/mapping/rebuild?symbols=${symbol}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load mapping data');
      }
      
      const symbolStatus = data.status?.[0];
      if (symbolStatus?.exists) {
        setMappingData(symbolStatus); // Simplified for now
      } else {
        setMappingData(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  const rebuildMapping = async () => {
    try {
      setRebuilding(true);
      setError(null);
      
      const response = await fetch('/api/mapping/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          symbols: [symbol], 
          force: true,
          stratify_vol: false
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to rebuild mapping');
      }
      
      const result = data.results?.[0];
      if (result?.status === 'error') {
        throw new Error(result.message || 'Rebuild failed');
      }
      
      // Reload data after successful rebuild
      await loadMappingData();
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setRebuilding(false);
    }
  };

  useEffect(() => {
    loadMappingData();
  }, [loadMappingData]);

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-lg font-semibold">📊 Survival Mapping</h3>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          <span className="ml-2">Loading mapping data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            📊 Survival Mapping
          </h3>
          <p className="text-gray-600 text-sm">
            KM bins and Cox model for breakout continuation prediction
          </p>
        </div>
        <button 
          onClick={rebuildMapping} 
          disabled={rebuilding}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          {rebuilding ? (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
          ) : (
            "🔄"
          )}
          Rebuild
        </button>
      </div>
      
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
          <div className="flex items-center gap-2 text-red-700">
            ⚠️ {error}
          </div>
        </div>
      )}
      
      {!mappingData ? (
        <div className="text-center py-8">
          <div className="text-6xl mb-4">⚠️</div>
          <h3 className="text-lg font-semibold mb-2">No Mapping Data</h3>
          <p className="text-gray-600 mb-4">
            No survival mapping has been built for {symbol} yet.
          </p>
          <button 
            onClick={rebuildMapping} 
            disabled={rebuilding}
            className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-2 mx-auto"
          >
            {rebuilding ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (
              "📈"
            )}
            Build Mapping
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* KM Bins Section */}
          <div>
            <h4 className="text-md font-semibold mb-3 flex items-center gap-2">
              📊 Kaplan-Meier Bins
            </h4>
            
            {mappingData.bins && mappingData.bins.length > 0 ? (
              <div className="grid gap-3">
                {mappingData.bins.map((binStats, i) => (
                  <KmBinDisplay key={i} binStats={binStats} />
                ))}
              </div>
            ) : (
              <p className="text-gray-600">No KM bins available (n &lt; 40)</p>
            )}
          </div>
          
          {/* Cox Model Section */}
          <div>
            <h4 className="text-md font-semibold mb-3 flex items-center gap-2">
              📈 Cox Proportional Hazards
            </h4>
            
            {mappingData.cox ? (
              <CoxModelDisplay cox={mappingData.cox} />
            ) : (
              <p className="text-gray-600">Cox model not available</p>
            )}
          </div>
          
          {/* Metadata */}
          <div className="text-sm text-gray-500">
            Last updated: {new Date(mappingData.updated_at).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}

function KmBinDisplay({ binStats }: { binStats: KmBinStats }) {
  const { bin, n_events, n_censored, median_T_hat, I60, I80, S_at_k } = binStats;
  
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm font-mono">
            {bin.label}
          </span>
          {bin.vol_regime && bin.vol_regime !== "any" && (
            <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-sm">
              {bin.vol_regime} vol
            </span>
          )}
        </div>
        <div className="text-sm text-gray-600">
          n={n_events} ({n_censored} censored)
        </div>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <div className="font-medium">Median T̂</div>
          <div className="text-gray-600">
            {median_T_hat ? `${median_T_hat.toFixed(1)} days` : 'Not reached'}
          </div>
        </div>
        
        <div>
          <div className="font-medium">I60</div>
          <div className="text-gray-600">
            {I60 ? `[${I60[0].toFixed(1)}, ${I60[1].toFixed(1)}]` : 'N/A'}
          </div>
        </div>
        
        <div>
          <div className="font-medium">I80</div>
          <div className="text-gray-600">
            {I80 ? `[${I80[0].toFixed(1)}, ${I80[1].toFixed(1)}]` : 'N/A'}
          </div>
        </div>
        
        <div>
          <div className="font-medium">P̂(T≥3)</div>
          <div className="text-gray-600">
            {S_at_k[3] ? (S_at_k[3] * 100).toFixed(1) + '%' : 'N/A'}
          </div>
        </div>
      </div>
    </div>
  );
}

function CoxModelDisplay({ cox }: { cox: CoxFit }) {
  const zAbsCoef = cox.coef["z_abs"] || 0;
  const zAbsSE = cox.se["z_abs"] || 0;
  const zAbsHR = cox.HR["z_abs"] || 1;
  const zAbsCI = cox.HR_CI["z_abs"] || [1, 1];
  const cIndex = cox.performance?.c_index;
  const phOk = cox.PH_ok;
  
  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div>
          <div className="font-medium flex items-center gap-2">
            Hazard Ratio (|z|)
            {phOk ? "✅" : "❌"}
          </div>
          <div className="text-lg font-mono">
            {zAbsHR.toFixed(3)}
          </div>
          <div className="text-sm text-gray-600">
            95% CI: [{zAbsCI[0].toFixed(3)}, {zAbsCI[1].toFixed(3)}]
          </div>
        </div>
        
        <div>
          <div className="font-medium">Coefficient (β)</div>
          <div className="text-lg font-mono">
            {zAbsCoef.toFixed(4)}
          </div>
          <div className="text-sm text-gray-600">
            SE: {zAbsSE.toFixed(4)}
          </div>
        </div>
        
        <div>
          <div className="font-medium">Performance</div>
          <div className="text-lg font-mono">
            {cIndex ? `C = ${cIndex.toFixed(3)}` : 'N/A'}
          </div>
          <div className="text-sm text-gray-600">
            PH: {phOk ? 'OK' : 'Violated'}
          </div>
        </div>
      </div>
      
      {!phOk && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
          <div className="flex items-center gap-2 text-red-700">
            ⚠️ Proportional hazards assumption may be violated. Cox predictions should be interpreted cautiously.
          </div>
        </div>
      )}
    </div>
  );
}