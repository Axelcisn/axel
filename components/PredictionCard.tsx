'use client';

import { useState, useCallback } from 'react';

type PredictionInput = {
  z_abs: number;
  vol_regime?: "low" | "mid" | "high" | "any";
  source?: "auto" | "KM" | "Cox" | "AFT";
  k_list?: number[];
};

type PredictionOutput = {
  source: "KM" | "Cox" | "AFT";
  T_hat_median: number | null;
  I60: [number, number] | null;
  I80: [number, number] | null;
  P_ge_k: Record<number, number>;
};

interface PredictionCardProps {
  symbol: string;
}

export function PredictionCard({ symbol }: PredictionCardProps) {
  const [input, setInput] = useState<PredictionInput>({
    z_abs: 2.5,
    vol_regime: "any",
    source: "auto",
    k_list: [1, 2, 3, 4, 5]
  });
  
  const [prediction, setPrediction] = useState<PredictionOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generatePrediction = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch('/api/mapping/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          symbol, 
          ...input 
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate prediction');
      }
      
      setPrediction(data.prediction);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setPrediction(null);
    } finally {
      setLoading(false);
    }
  }, [symbol, input]);

  const handleInputChange = (field: keyof PredictionInput, value: any) => {
    setInput(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center gap-2 mb-6">
        <h3 className="text-lg font-semibold">🎯 Continuation Prediction</h3>
        <span className="text-sm text-gray-500">({symbol})</span>
      </div>
      
      {/* Input Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            |z_B| Magnitude
          </label>
          <input
            type="number"
            min="2.0"
            max="10.0"
            step="0.1"
            value={input.z_abs}
            onChange={(e) => handleInputChange('z_abs', parseFloat(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Vol Regime
          </label>
          <select
            value={input.vol_regime || "any"}
            onChange={(e) => handleInputChange('vol_regime', e.target.value as any)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="any">Any</option>
            <option value="low">Low Vol</option>
            <option value="mid">Mid Vol</option>
            <option value="high">High Vol</option>
          </select>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Method
          </label>
          <select
            value={input.source || "auto"}
            onChange={(e) => handleInputChange('source', e.target.value as any)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="auto">Auto Select</option>
            <option value="KM">Kaplan-Meier</option>
            <option value="Cox">Cox Model</option>
            <option value="AFT">AFT Model</option>
          </select>
        </div>
        
        <div className="flex items-end">
          <button
            onClick={generatePrediction}
            disabled={loading}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Predicting...
              </div>
            ) : (
              '🎯 Predict'
            )}
          </button>
        </div>
      </div>
      
      {/* Error Display */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
          <div className="flex items-center gap-2 text-red-700">
            ⚠️ {error}
          </div>
        </div>
      )}
      
      {/* Prediction Results */}
      {prediction && (
        <div className="border border-gray-200 rounded-lg p-6 bg-gradient-to-r from-blue-50 to-purple-50">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold">Prediction Results</h4>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Method:</span>
              <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm font-medium">
                {prediction.source}
              </span>
            </div>
          </div>
          
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-600 mb-2">
                {prediction.T_hat_median ? prediction.T_hat_median.toFixed(1) : 'N/A'}
              </div>
              <div className="text-sm text-gray-600">Median T̂ (days)</div>
              <div className="text-xs text-gray-500">Expected continuation time</div>
            </div>
            
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600 mb-2">
                {prediction.I60 ? 
                  `[${prediction.I60[0].toFixed(1)}, ${prediction.I60[1].toFixed(1)}]` : 
                  'N/A'
                }
              </div>
              <div className="text-sm text-gray-600">I60 Interval</div>
              <div className="text-xs text-gray-500">20th-80th percentiles</div>
            </div>
            
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600 mb-2">
                {prediction.I80 ? 
                  `[${prediction.I80[0].toFixed(1)}, ${prediction.I80[1].toFixed(1)}]` : 
                  'N/A'
                }
              </div>
              <div className="text-sm text-gray-600">I80 Interval</div>
              <div className="text-xs text-gray-500">10th-90th percentiles</div>
            </div>
          </div>
          
          {/* Survival Probabilities */}
          <div>
            <h5 className="font-medium mb-3">Survival Probabilities P̂(T≥k)</h5>
            <div className="grid grid-cols-5 gap-4">
              {(input.k_list || [1, 2, 3, 4, 5]).map(k => {
                const prob = prediction.P_ge_k[k] || 0;
                const percentage = (prob * 100).toFixed(1);
                
                return (
                  <div key={k} className="text-center">
                    <div className="text-lg font-bold text-gray-800">
                      {percentage}%
                    </div>
                    <div className="text-sm text-gray-600">T≥{k}d</div>
                    
                    {/* Visual probability bar */}
                    <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-red-400 to-green-400 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${prob * 100}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          
          {/* Interpretation */}
          <div className="mt-6 p-4 bg-white border border-gray-200 rounded-md">
            <h5 className="font-medium mb-2">💡 Interpretation</h5>
            <div className="text-sm text-gray-700 space-y-1">
              {prediction.T_hat_median && (
                <p>
                  • Expected continuation: <strong>{prediction.T_hat_median.toFixed(1)} days</strong> (50% probability)
                </p>
              )}
              {prediction.P_ge_k[3] && (
                <p>
                  • 3-day survival: <strong>{(prediction.P_ge_k[3] * 100).toFixed(1)}%</strong> chance of lasting ≥3 days
                </p>
              )}
              {prediction.P_ge_k[5] && (
                <p>
                  • 5-day survival: <strong>{(prediction.P_ge_k[5] * 100).toFixed(1)}%</strong> chance of lasting ≥5 days
                </p>
              )}
              <p className="text-xs text-gray-500 mt-2">
                * Higher |z_B| typically indicates stronger breakouts with longer continuation
              </p>
            </div>
          </div>
        </div>
      )}
      
      {/* Quick Examples */}
      {!prediction && !loading && (
        <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-md">
          <h5 className="font-medium mb-2">🚀 Quick Examples</h5>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <button
              onClick={() => {
                setInput({ z_abs: 2.5, vol_regime: "any", source: "auto", k_list: [1, 2, 3, 4, 5] });
                setTimeout(generatePrediction, 100);
              }}
              className="p-3 border border-gray-300 rounded hover:bg-white transition-colors text-left"
            >
              <div className="font-medium">Moderate Breakout</div>
              <div className="text-gray-600">|z| = 2.5, Any Vol</div>
            </button>
            
            <button
              onClick={() => {
                setInput({ z_abs: 3.5, vol_regime: "low", source: "auto", k_list: [1, 2, 3, 4, 5] });
                setTimeout(generatePrediction, 100);
              }}
              className="p-3 border border-gray-300 rounded hover:bg-white transition-colors text-left"
            >
              <div className="font-medium">Strong + Low Vol</div>
              <div className="text-gray-600">|z| = 3.5, Low Vol</div>
            </button>
            
            <button
              onClick={() => {
                setInput({ z_abs: 4.0, vol_regime: "any", source: "auto", k_list: [1, 2, 3, 4, 5] });
                setTimeout(generatePrediction, 100);
              }}
              className="p-3 border border-gray-300 rounded hover:bg-white transition-colors text-left"
            >
              <div className="font-medium">Extreme Breakout</div>
              <div className="text-gray-600">|z| = 4.0, Any Vol</div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}