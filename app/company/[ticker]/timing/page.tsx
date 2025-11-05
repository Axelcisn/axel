// cspell:words OHLC Delistings delisted ndist cooldown efron Backtest Watchlist
'use client';

import { useState, useEffect } from 'react';
import { IngestionResult } from '@/lib/types/canonical';
import { TargetSpec, TargetSpecResult } from '@/lib/types/targetSpec';
import { ForecastRecord } from '@/lib/forecast/types';
import { EventRecord } from '@/lib/events/types';

interface TimingPageProps {
  params: {
    ticker: string;
  };
}

export default function TimingPage({ params }: TimingPageProps) {
  const [uploadResult, setUploadResult] = useState<IngestionResult | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Target Spec state
  const [targetSpecResult, setTargetSpecResult] = useState<TargetSpecResult | null>(null);
  const [h, setH] = useState(1);
  const [coverage, setCoverage] = useState(0.95);
  const [isSavingTarget, setIsSavingTarget] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // GBM Forecast state
  const [currentForecast, setCurrentForecast] = useState<ForecastRecord | null>(null);
  const [window, setWindow] = useState(504);
  const [lambdaDrift, setLambdaDrift] = useState(0.25);
  const [isGeneratingForecast, setIsGeneratingForecast] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);

  // Volatility Model state
  const [selectedModel, setSelectedModel] = useState<'GARCH11-N' | 'GARCH11-t' | 'HAR-RV' | 'Range-P' | 'Range-GK' | 'Range-RS' | 'Range-YZ'>('GARCH11-N');
  const [garchWindow, setGarchWindow] = useState(1000);
  const [garchVarianceTargeting, setGarchVarianceTargeting] = useState(true);
  const [garchDist, setGarchDist] = useState<'normal' | 'student-t'>('normal');
  const [garchDf, setGarchDf] = useState(8);
  const [harWindow, setHarWindow] = useState(1000);
  const [harUseIntradayRv, setHarUseIntradayRv] = useState(true);
  const [rangeEstimator, setRangeEstimator] = useState<'P' | 'GK' | 'RS' | 'YZ'>('YZ');
  const [rangeWindow, setRangeWindow] = useState(63);
  const [rangeEwmaLambda, setRangeEwmaLambda] = useState(0.94);
  const [isGeneratingVolatility, setIsGeneratingVolatility] = useState(false);
  const [volatilityError, setVolatilityError] = useState<string | null>(null);

  // Conformal Prediction state
  const [conformalMode, setConformalMode] = useState<'ICP' | 'ICP-SCALED' | 'CQR' | 'EnbPI' | 'ACI'>('ICP');
  const [conformalDomain, setConformalDomain] = useState<'log' | 'price'>('log');
  const [conformalCalWindow, setConformalCalWindow] = useState(250);
  const [conformalEta, setConformalEta] = useState(0.02);
  const [conformalK, setConformalK] = useState(20);
  const [conformalState, setConformalState] = useState<any>(null);
  const [isApplyingConformal, setIsApplyingConformal] = useState(false);
  const [conformalError, setConformalError] = useState<string | null>(null);

  // Breakout Detection state
  const [latestEvent, setLatestEvent] = useState<EventRecord | null>(null);
  const [isDetectingBreakout, setIsDetectingBreakout] = useState(false);
  const [breakoutError, setBreakoutError] = useState<string | null>(null);
  const [breakoutDetectDate, setBreakoutDetectDate] = useState('');
  const [cooldownStatus, setCooldownStatus] = useState<{ok: boolean; inside_count: number; reason?: string} | null>(null);

  // Continuation Clock state
  const [stopRule, setStopRule] = useState<'re-entry' | 'sign-flip'>('re-entry');
  const [kInside, setKInside] = useState<1 | 2>(1);
  const [tMax, setTMax] = useState(20);
  const [isTicking, setIsTicking] = useState(false);
  const [continuationError, setContinuationError] = useState<string | null>(null);
  const [tickDate, setTickDate] = useState('');
  const [lastContinuationAction, setLastContinuationAction] = useState<string | null>(null);

  // Load target spec and latest forecast on mount
  useEffect(() => {
    loadTargetSpec();
    loadLatestForecast();
  }, [params.ticker]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadTargetSpec = async () => {
    try {
      const response = await fetch(`/api/target-spec/${params.ticker}`);
      if (response.ok) {
        const result: TargetSpecResult = await response.json();
        setTargetSpecResult(result);
        setH(result.spec.h);
        setCoverage(result.spec.coverage);
      }
    } catch (error) {
      console.error('Failed to load target spec:', error);
    }
  };

  const loadLatestForecast = async () => {
    try {
      const response = await fetch(`/api/forecast/gbm/${params.ticker}`);
      if (response.ok) {
        const forecast: ForecastRecord = await response.json();
        setCurrentForecast(forecast);
      } else if (response.status !== 404) {
        console.error('Failed to load forecast:', response.statusText);
      }
    } catch (error) {
      console.error('Failed to load forecast:', error);
    }
  };

  const generateGbmForecast = async () => {
    setIsGeneratingForecast(true);
    setForecastError(null);

    try {
      const response = await fetch(`/api/forecast/gbm/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          window,
          lambda_drift: lambdaDrift,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate forecast');
      }

      setCurrentForecast(data);
    } catch (err) {
      setForecastError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsGeneratingForecast(false);
    }
  };

  const generateVolatilityForecast = async () => {
    setIsGeneratingVolatility(true);
    setVolatilityError(null);

    try {
      let params: any = {};
      
      if (selectedModel === 'GARCH11-N' || selectedModel === 'GARCH11-t') {
        params.garch = {
          window: garchWindow,
          variance_targeting: garchVarianceTargeting,
          dist: garchDist,
          ...(garchDist === 'student-t' ? { df: garchDf } : {})
        };
      } else if (selectedModel === 'HAR-RV') {
        params.har = {
          window: harWindow,
          use_intraday_rv: harUseIntradayRv
        };
      } else {
        params.range = {
          estimator: rangeEstimator,
          window: rangeWindow,
          ewma_lambda: rangeEwmaLambda
        };
      }

      const response = await fetch(`/api/volatility/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: selectedModel,
          params
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate volatility forecast');
      }

      setCurrentForecast(data);
      await loadLatestForecast(); // Refresh the forecast display
    } catch (err) {
      setVolatilityError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsGeneratingVolatility(false);
    }
  };

  const applyConformalPrediction = async () => {
    setIsApplyingConformal(true);
    setConformalError(null);

    try {
      const conformalParams = {
        mode: conformalMode,
        domain: conformalDomain,
        cal_window: conformalCalWindow,
        ...(conformalMode === 'ACI' ? { eta: conformalEta } : {}),
        ...(conformalMode === 'EnbPI' ? { K: conformalK } : {})
      };

      const response = await fetch(`/api/conformal/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: params.ticker,
          params: conformalParams
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409 && data.code === 'DOMAIN_CONFLICT') {
          const confirmRecalibrate = confirm(
            `Domain conflict: existing state uses '${data.existing_domain}' but you selected '${data.requested_domain}'. Do you want to force recalibration?`
          );
          
          if (confirmRecalibrate) {
            // Retry with force=true
            const retryResponse = await fetch(`/api/conformal/${params.ticker}?force=true`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                symbol: params.ticker,
                params: conformalParams
              }),
            });
            
            const retryData = await retryResponse.json();
            
            if (!retryResponse.ok) {
              throw new Error(retryData.error || 'Failed to apply conformal prediction');
            }
            
            setConformalState(retryData.state);
            setCurrentForecast(null); // Will be loaded by loadLatestForecast
            await loadLatestForecast();
            return;
          } else {
            setConformalError('Operation cancelled: domain conflict not resolved');
            return;
          }
        }
        throw new Error(data.error || 'Failed to apply conformal prediction');
      }

      setConformalState(data.state);
      setCurrentForecast(null); // Will be loaded by loadLatestForecast
      await loadLatestForecast(); // Refresh the forecast display
    } catch (err) {
      setConformalError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsApplyingConformal(false);
    }
  };

  const saveTargetSpec = async () => {
    setIsSavingTarget(true);
    setTargetError(null);
    setSaveSuccess(false);

    try {
      const response = await fetch(`/api/target-spec/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ h, coverage }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save target spec');
      }

      setTargetSpecResult({ 
        spec: data, 
        meta: { hasTZ: true, source: "canonical" } 
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setTargetError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSavingTarget(false);
    }
  };

  // Validation
  const isValidH = h >= 1;
  const isValidCoverage = coverage > 0.50 && coverage <= 0.995;
  const hasTZ = targetSpecResult?.meta.hasTZ || false;
  const canSave = isValidH && isValidCoverage && hasTZ;

  const handleFileUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsUploading(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    formData.set('symbol', params.ticker); // Default to ticker from URL

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || data.error || 'Upload failed');
      }

      setUploadResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsUploading(false);
    }
  };

  // Breakout Detection Functions
  const detectBreakoutToday = async () => {
    setIsDetectingBreakout(true);
    setBreakoutError(null);

    try {
      const response = await fetch(`/api/events/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode: 'today' }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          setBreakoutError(data.error || 'Cooldown failed or open event exists');
        } else if (response.status === 422) {
          setBreakoutError(data.error || 'Cannot verify today yet');
        } else {
          throw new Error(data.error || 'Detection failed');
        }
        return;
      }

      setLatestEvent(data.created);
      if (data.created) {
        setCooldownStatus({ ok: true, inside_count: 3 });
      }
    } catch (err) {
      setBreakoutError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsDetectingBreakout(false);
    }
  };

  const detectBreakoutForDate = async () => {
    if (!breakoutDetectDate) return;

    setIsDetectingBreakout(true);
    setBreakoutError(null);

    try {
      const response = await fetch(`/api/events/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          mode: 'date', 
          t_date: breakoutDetectDate 
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          setBreakoutError(data.error || 'Cooldown failed or open event exists');
        } else if (response.status === 422) {
          setBreakoutError(data.error || 'Missing data for specified date');
        } else {
          throw new Error(data.error || 'Detection failed');
        }
        return;
      }

      setLatestEvent(data.created);
      if (data.created) {
        setCooldownStatus({ ok: true, inside_count: 3 });
      }
    } catch (err) {
      setBreakoutError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsDetectingBreakout(false);
    }
  };

  // Continuation Clock Functions
  const tickToday = async () => {
    setIsTicking(true);
    setContinuationError(null);

    const today = new Date().toISOString().split('T')[0];

    try {
      const response = await fetch(`/api/continuation/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'tick',
          D_date: today,
          stop_rule: stopRule,
          k_inside: kInside,
          T_max: tMax
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 422) {
          setContinuationError(data.error || 'No open event or missing data');
        } else {
          throw new Error(data.error || 'Tick failed');
        }
        return;
      }

      setLatestEvent(data.updated);
      setLastContinuationAction(data.action);
    } catch (err) {
      setContinuationError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsTicking(false);
    }
  };

  const tickForDate = async () => {
    if (!tickDate) return;

    setIsTicking(true);
    setContinuationError(null);

    try {
      const response = await fetch(`/api/continuation/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'tick',
          D_date: tickDate,
          stop_rule: stopRule,
          k_inside: kInside,
          T_max: tMax
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 422) {
          setContinuationError(data.error || 'No open event or missing data');
        } else {
          throw new Error(data.error || 'Tick failed');
        }
        return;
      }

      setLatestEvent(data.updated);
      setLastContinuationAction(data.action);
    } catch (err) {
      setContinuationError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsTicking(false);
    }
  };

  const rescanFromB = async () => {
    if (!latestEvent) return;

    setIsTicking(true);
    setContinuationError(null);

    try {
      const response = await fetch(`/api/continuation/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'rescan',
          start: latestEvent.B_date,
          stop_rule: stopRule,
          k_inside: kInside,
          T_max: tMax
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 422) {
          setContinuationError(data.error || 'No open event or missing data');
        } else {
          throw new Error(data.error || 'Rescan failed');
        }
        return;
      }

      setLatestEvent(data.updated);
      setLastContinuationAction(data.action);
    } catch (err) {
      setContinuationError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsTicking(false);
    }
  };

  // Load latest event on mount
  useEffect(() => {
    const loadEvent = async () => {
      try {
        const response = await fetch(`/api/events/${params.ticker}?recent=1`);
        if (response.ok) {
          const data = await response.json();
          setLatestEvent(data.event);
        }
      } catch (error) {
        console.error('Failed to load latest event:', error);
      }
    };
    
    loadEvent();
  }, [params.ticker]);

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Momentum Timing - {params.ticker}</h1>
      
      {/* Provenance */}
      {targetSpecResult && (
        <div className="mb-4 p-2 bg-gray-50 rounded text-sm text-gray-700">
          Target: {targetSpecResult.spec.variable} @ {(targetSpecResult.spec.coverage * 100).toFixed(1)}% • h={targetSpecResult.spec.h} • cutoff: t→t+1 (TZ: {targetSpecResult.spec.exchange_tz})
        </div>
      )}
      
      {/* Forecast Target Card */}
      <div className="mb-8 p-6 border rounded-lg bg-white shadow-sm" data-testid="card-forecast-target">
        <h2 className="text-xl font-semibold mb-4">Forecast Target</h2>
        
        {/* Horizon Controls */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-3">Horizon</label>
          <div className="flex flex-wrap gap-2 mb-3">
            {[1, 2, 3, 5].map((days) => (
              <button
                key={days}
                onClick={() => setH(days)}
                className={`px-3 py-1 text-sm rounded ${
                  h === days 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {days}D
              </button>
            ))}
          </div>
          <input
            type="number"
            min="1"
            value={h}
            onChange={(e) => setH(parseInt(e.target.value) || 1)}
            className={`w-20 px-2 py-1 text-sm border rounded ${
              isValidH ? 'border-gray-300' : 'border-red-300'
            }`}
          />
          {!isValidH && (
            <p className="text-red-600 text-xs mt-1">Horizon must be ≥ 1</p>
          )}
        </div>

        {/* Coverage Controls */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-3">Coverage</label>
          <div className="flex flex-wrap gap-2 mb-3">
            {[0.90, 0.95, 0.975].map((level) => (
              <button
                key={level}
                onClick={() => setCoverage(level)}
                className={`px-3 py-1 text-sm rounded ${
                  coverage === level 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {(level * 100).toFixed(1)}%
              </button>
            ))}
          </div>
          <input
            type="number"
            min="0.5"
            max="0.995"
            step="0.005"
            value={coverage}
            onChange={(e) => setCoverage(parseFloat(e.target.value) || 0.95)}
            className={`w-24 px-2 py-1 text-sm border rounded ${
              isValidCoverage ? 'border-gray-300' : 'border-red-300'
            }`}
          />
          {!isValidCoverage && (
            <p className="text-red-600 text-xs mt-1">Coverage must be in range (0.50, 0.995]</p>
          )}
        </div>

        {/* Read-only fields */}
        <div className="mb-6 space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Target Variable</label>
            <input
              type="text"
              value="NEXT_CLOSE_ADJ"
              readOnly
              className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded text-gray-600"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Cutoff</label>
            <input
              type="text"
              value="compute at t close; verify at t+1 close"
              readOnly
              className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded text-gray-600"
            />
          </div>
        </div>

        {/* Save Button */}
        <div className="mb-4">
          <button
            onClick={saveTargetSpec}
            disabled={!canSave || isSavingTarget}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSavingTarget ? 'Saving...' : 'Save Target Spec'}
          </button>
          
          {!hasTZ && (
            <p className="text-red-600 text-sm mt-2">
              Exchange time zone not resolved. Upload canonical data or set primary listing.
            </p>
          )}
          
          {targetError && (
            <p className="text-red-600 text-sm mt-2">{targetError}</p>
          )}
          
          {saveSuccess && (
            <p className="text-green-600 text-sm mt-2">Target Spec saved successfully!</p>
          )}
        </div>

        {/* Reference Text */}
        <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded">
          <p><strong>Target (future observation):</strong> y_{'{t+1}'} = AdjClose_{'{t+1}'}</p>
          <p><strong>&ldquo;Prediction Interval (PI)&rdquo;</strong> for y_{'{t+1}'} at coverage 1−α</p>
        </div>

        {/* Methods Tooltip */}
        <details className="mt-4">
          <summary className="cursor-pointer text-blue-600 hover:text-blue-800 font-medium text-sm">
            Methods
          </summary>
          <div className="mt-2 text-sm bg-blue-50 p-3 rounded">
            <p>PIs are for <strong>future observations</strong> and will be verified <strong>out-of-sample (OOS)</strong> with rolling-origin evaluation.</p>
            <p>Target variable represents the next trading day&apos;s adjusted closing price that we aim to forecast.</p>
          </div>
        </details>
      </div>
      
      {/* GBM Card */}
      <div className="mb-8 p-6 border rounded-lg bg-white shadow-sm" data-testid="card-gbm">
        <h2 className="text-xl font-semibold mb-4">GBM Baseline PI Engine</h2>
        
        {/* Window Controls */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-3">Window Length</label>
          <div className="flex flex-wrap gap-2">
            {[252, 504, 756].map((size) => (
              <button
                key={size}
                onClick={() => setWindow(size)}
                className={`px-3 py-1 text-sm rounded ${
                  window === size 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        {/* Lambda Drift Controls */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-3">
            Drift Shrinkage λ: {lambdaDrift.toFixed(3)}
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.025"
            value={lambdaDrift}
            onChange={(e) => setLambdaDrift(parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>0.000</span>
            <span>1.000</span>
          </div>
        </div>

        {/* Generate Button */}
        <div className="mb-6">
          <button
            onClick={generateGbmForecast}
            disabled={isGeneratingForecast || !targetSpecResult?.meta.hasTZ}
            className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGeneratingForecast ? 'Generating...' : 'Generate GBM PI'}
          </button>
          
          {forecastError && (
            <p className="text-red-600 text-sm mt-2">{forecastError}</p>
          )}
          
          {!targetSpecResult?.meta.hasTZ && (
            <p className="text-red-600 text-sm mt-2">
              Target spec required. Please set target specification first.
            </p>
          )}
        </div>

        {/* Display Estimates */}
        {currentForecast && currentForecast.method === 'GBM-CC' && (
          <div className="bg-gray-50 p-4 rounded">
            <h3 className="font-medium mb-3">Current Estimates</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-600">μ*:</span>
                <span className="ml-2 font-mono">{currentForecast.estimates?.mu_star_hat?.toFixed(6) || 'N/A'}</span>
              </div>
              <div>
                <span className="text-gray-600">σ (daily):</span>
                <span className="ml-2 font-mono">{currentForecast.estimates?.sigma_hat?.toFixed(6) || 'N/A'}</span>
              </div>
              <div>
                <span className="text-gray-600">λ:</span>
                <span className="ml-2 font-mono">{currentForecast.params?.lambda_drift?.toFixed(3) || 'N/A'}</span>
              </div>
              <div>
                <span className="text-gray-600">Window:</span>
                <span className="ml-2">{currentForecast.estimates?.window_start || 'N/A'} – {currentForecast.estimates?.window_end || 'N/A'}</span>
              </div>
              <div>
                <span className="text-gray-600">N:</span>
                <span className="ml-2">{currentForecast.estimates?.n || 'N/A'}</span>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">MLE with denominator N</p>
          </div>
        )}

        {/* Methods Tooltip */}
        <details className="mt-4">
          <summary className="cursor-pointer text-blue-600 hover:text-blue-800 font-medium text-sm">
            Methods & Formulas
          </summary>
          <div className="mt-2 text-xs bg-blue-50 p-3 rounded font-mono">
            <p>mu_star_hat = mean( r_window )</p>
            <p>sigma_hat = sqrt( (1/N) * Σ (r_i − mu_star_hat)² )     # MLE (denominator N)</p>
            <p>mu_star_used = λ * mu_star_hat</p>
            <p>m_t(h) = ln(S_t) + h * mu_star_used</p>
            <p>s_t(h) = sigma_hat * sqrt(h)</p>
            <p>z_α = Φ⁻¹(1 − α/2)</p>
            <p>L_h = exp( m_t(h) − z_α * s_t(h) )</p>
            <p>U_h = exp( m_t(h) + z_α * s_t(h) )</p>
            <p>band_width_bp = 10000 * (U_1 / L_1 − 1)</p>
          </div>
        </details>
      </div>

      {/* Volatility Models Card */}
      <div className="mb-8 p-6 border rounded-lg bg-white shadow-sm" data-testid="card-vol-and-sources">
        <h2 className="text-xl font-semibold mb-4">Volatility Models</h2>
        
        {/* Model Selector */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Select Model:</label>
          <select 
            value={selectedModel} 
            onChange={(e) => setSelectedModel(e.target.value as any)}
            className="w-full p-2 border rounded-md"
          >
            <option value="GARCH11-N">GARCH(1,1) - Normal</option>
            <option value="GARCH11-t">GARCH(1,1) - Student-t</option>
            <option value="HAR-RV">HAR-RV</option>
            <option value="Range-P">Range: Parkinson</option>
            <option value="Range-GK">Range: Garman-Klass</option>
            <option value="Range-RS">Range: Rogers-Satchell</option>
            <option value="Range-YZ">Range: Yang-Zhang</option>
          </select>
        </div>

        {/* GARCH Panel */}
        {(selectedModel === 'GARCH11-N' || selectedModel === 'GARCH11-t') && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-medium mb-3">GARCH(1,1) Parameters</h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm mb-1">Window (days)</label>
                <input 
                  type="number" 
                  value={garchWindow} 
                  onChange={(e) => setGarchWindow(Number(e.target.value))}
                  className="w-full p-2 border rounded text-sm"
                  min="600"
                  step="1"
                />
                <p className="text-xs text-gray-500 mt-1">Recommend 1000</p>
              </div>
              <div>
                <label className="block text-sm mb-1">Distribution</label>
                <select 
                  value={garchDist} 
                  onChange={(e) => setGarchDist(e.target.value as 'normal' | 'student-t')}
                  className="w-full p-2 border rounded text-sm"
                >
                  <option value="normal">Normal</option>
                  <option value="student-t">Student-t</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="flex items-center text-sm">
                  <input 
                    type="checkbox" 
                    checked={garchVarianceTargeting} 
                    onChange={(e) => setGarchVarianceTargeting(e.target.checked)}
                    className="mr-2"
                  />
                  Variance Targeting
                </label>
              </div>
              {garchDist === 'student-t' && (
                <div>
                  <label className="block text-sm mb-1">Degrees of Freedom (ν)</label>
                  <input 
                    type="number" 
                    value={garchDf} 
                    onChange={(e) => setGarchDf(Number(e.target.value))}
                    className="w-full p-2 border rounded text-sm"
                    min="2"
                    step="1"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* HAR Panel */}
        {selectedModel === 'HAR-RV' && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-medium mb-3">HAR-RV Parameters</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-1">Window (days)</label>
                <input 
                  type="number" 
                  value={harWindow} 
                  onChange={(e) => setHarWindow(Number(e.target.value))}
                  className="w-full p-2 border rounded text-sm"
                  min="100"
                  step="1"
                />
              </div>
              <div>
                <label className="flex items-center text-sm">
                  <input 
                    type="checkbox" 
                    checked={harUseIntradayRv} 
                    onChange={(e) => setHarUseIntradayRv(e.target.checked)}
                    className="mr-2"
                  />
                  Use Intraday RV
                </label>
                <p className="text-xs text-gray-500 mt-1">Required for HAR</p>
              </div>
            </div>
            {!harUseIntradayRv && (
              <div className="mt-2 p-2 bg-yellow-100 border-l-4 border-yellow-500 text-sm">
                ⚠️ HAR-RV disabled: intraday RV must be enabled
              </div>
            )}
          </div>
        )}

        {/* Range Panel */}
        {selectedModel.startsWith('Range-') && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-medium mb-3">Range-based Parameters</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm mb-1">Estimator</label>
                <select 
                  value={rangeEstimator} 
                  onChange={(e) => {
                    setRangeEstimator(e.target.value as 'P' | 'GK' | 'RS' | 'YZ');
                    setSelectedModel(`Range-${e.target.value}` as any);
                  }}
                  className="w-full p-2 border rounded text-sm"
                >
                  <option value="P">Parkinson</option>
                  <option value="GK">Garman-Klass</option>
                  <option value="RS">Rogers-Satchell</option>
                  <option value="YZ">Yang-Zhang</option>
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1">Window (days)</label>
                <input 
                  type="number" 
                  value={rangeWindow} 
                  onChange={(e) => setRangeWindow(Number(e.target.value))}
                  className="w-full p-2 border rounded text-sm"
                  min="20"
                  step="1"
                />
                <p className="text-xs text-gray-500 mt-1">Default 63</p>
              </div>
              <div>
                <label className="block text-sm mb-1">EWMA λ</label>
                <input 
                  type="number" 
                  value={rangeEwmaLambda} 
                  onChange={(e) => setRangeEwmaLambda(Number(e.target.value))}
                  className="w-full p-2 border rounded text-sm"
                  min="0"
                  max="1"
                  step="0.01"
                />
                <p className="text-xs text-gray-500 mt-1">Default 0.94</p>
              </div>
            </div>
          </div>
        )}

        {/* Generate Button */}
        <div className="mb-4">
          <button
            onClick={generateVolatilityForecast}
            disabled={isGeneratingVolatility || !targetSpecResult}
            className="px-6 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {isGeneratingVolatility ? 'Generating...' : 'Generate Final PI (Volatility Model)'}
          </button>
          {!targetSpecResult && (
            <p className="text-sm text-gray-500 mt-2">Please save target specification first</p>
          )}
        </div>

        {/* Error Display */}
        {volatilityError && (
          <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-md text-red-700">
            <p className="font-medium">Error:</p>
            <p className="text-sm">{volatilityError}</p>
          </div>
        )}

        {/* Diagnostics Display */}
        {currentForecast && currentForecast.method !== 'GBM-CC' && currentForecast.estimates?.volatility_diagnostics && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <h4 className="font-medium mb-2">Diagnostics</h4>
            <div className="text-sm font-mono">
              {currentForecast.method.startsWith('GARCH') && (
                <div>
                  <p>α = {currentForecast.estimates.volatility_diagnostics.alpha?.toFixed(3) || 'N/A'}</p>
                  <p>β = {currentForecast.estimates.volatility_diagnostics.beta?.toFixed(3) || 'N/A'}</p>
                  <p>α + β = {currentForecast.estimates.volatility_diagnostics.alpha_plus_beta?.toFixed(3) || 'N/A'}</p>
                  <p>ω = {currentForecast.estimates.volatility_diagnostics.omega?.toFixed(6) || 'N/A'}</p>
                  {currentForecast.estimates.volatility_diagnostics.df && (
                    <p>ν = {currentForecast.estimates.volatility_diagnostics.df}</p>
                  )}
                  {currentForecast.estimates.volatility_diagnostics.alpha_plus_beta >= 0.98 && (
                    <p className="text-orange-600 mt-1">⚠️ Near-integrated (α+β ≥ 0.98)</p>
                  )}
                </div>
              )}
              {currentForecast.method === 'HAR-RV' && (
                <div>
                  <p>β₀ = {currentForecast.estimates.volatility_diagnostics.beta0?.toFixed(6) || 'N/A'}</p>
                  <p>βd = {currentForecast.estimates.volatility_diagnostics.beta_d?.toFixed(3) || 'N/A'}</p>
                  <p>βw = {currentForecast.estimates.volatility_diagnostics.beta_w?.toFixed(3) || 'N/A'}</p>
                  <p>βm = {currentForecast.estimates.volatility_diagnostics.beta_m?.toFixed(3) || 'N/A'}</p>
                  <p>R² = {currentForecast.estimates.volatility_diagnostics.R2_in_sample?.toFixed(3) || 'N/A'}</p>
                </div>
              )}
              {currentForecast.method.startsWith('Range-') && (
                <div>
                  <p>Estimator: {currentForecast.estimates.volatility_diagnostics.estimator || 'N/A'}</p>
                  <p>Window: {currentForecast.estimates.volatility_diagnostics.window || 'N/A'} days</p>
                  {currentForecast.estimates.volatility_diagnostics.ewma_lambda && (
                    <p>EWMA λ = {currentForecast.estimates.volatility_diagnostics.ewma_lambda}</p>
                  )}
                  {currentForecast.estimates.volatility_diagnostics.k && (
                    <p>YZ weight k = {currentForecast.estimates.volatility_diagnostics.k.toFixed(3)}</p>
                  )}
                  {currentForecast.estimates.volatility_diagnostics.gap_warnings && (
                    <div className="mt-1 text-orange-600">
                      {currentForecast.estimates.volatility_diagnostics.gap_warnings.map((warning: string, idx: number) => (
                        <p key={idx}>⚠️ {warning}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Formula Tooltip */}
        <details className="mt-4">
          <summary className="cursor-pointer text-blue-600 hover:text-blue-800 font-medium text-sm">
            Methods & Formulas
          </summary>
          <div className="mt-2 text-xs bg-blue-50 p-3 rounded font-mono">
            <div className="mb-4">
              <strong>GARCH(1,1):</strong>
              <p>σₜ² = ω + α εₜ₋₁² + β σₜ₋₁²</p>
              <p>One-step: σ²ₜ₊₁|ₜ = ω + α εₜ² + β σₜ²</p>
              <p>Multi-step: σ²ₜ₊ₕ|ₜ = ω [1−(α+β)ʰ]/(1−α−β) + (α+β)ʰ σₜ²</p>
              <p>Critical c: Normal z₁₋α/₂ or Student-t t_ν,₁₋α/₂</p>
            </div>
            <div className="mb-4">
              <strong>HAR-RV:</strong>
              <p>RVₜ₊₁ = β₀ + βd RVₜ + βw RVₜ⁽ʷ⁾ + βm RVₜ⁽ᵐ⁾</p>
            </div>
            <div>
              <strong>Range daily proxies:</strong>
              <p>P: [ln(H/L)]² / (4 ln 2)</p>
              <p>GK: 0.5[ln(H/L)]² − (2 ln 2 − 1)[ln(C/O)]²</p>
              <p>RS: u(u − c) + d(d − c), u=ln(H/O), d=ln(L/O), c=ln(C/O)</p>
              <p>YZ: k = 0.34 / (1.34 + (N+1)/(N−1)); σ²_YZ = var(g) + k var(c) + (1−k) mean(var_RS)</p>
              <p>EWMA: σ²_EWMA_t = (1 − λ) var_today + λ σ²_EWMA_&#123;t−1&#125;</p>
            </div>
          </div>
        </details>
      </div>

      {/* Conformal Prediction Card */}
      <div className="mb-8 p-6 border rounded-lg bg-white shadow-sm" data-testid="card-conformal">
        <h2 className="text-xl font-semibold mb-4">Conformal Prediction Intervals</h2>
        
        {/* Mode Selector */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-2">Mode:</label>
            <select 
              value={conformalMode} 
              onChange={(e) => setConformalMode(e.target.value as any)}
              className="w-full p-2 border rounded-md"
            >
              <option value="ICP">ICP</option>
              <option value="ICP-SCALED">ICP-scaled</option>
              <option value="CQR">CQR</option>
              <option value="EnbPI">EnbPI</option>
              <option value="ACI">ACI</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Domain:</label>
            <select 
              value={conformalDomain} 
              onChange={(e) => setConformalDomain(e.target.value as 'log' | 'price')}
              className="w-full p-2 border rounded-md"
            >
              <option value="log">log (default)</option>
              <option value="price">price</option>
            </select>
          </div>
        </div>

        {/* Calibration Window */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Calibration Window:</label>
          <select 
            value={conformalCalWindow} 
            onChange={(e) => setConformalCalWindow(Number(e.target.value))}
            className="w-full p-2 border rounded-md"
          >
            <option value={125}>125 days</option>
            <option value={250}>250 days (default)</option>
            <option value={500}>500 days</option>
          </select>
        </div>

        {/* Mode-specific Parameters */}
        {conformalMode === 'ACI' && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-medium mb-3">ACI Parameters</h3>
            <div>
              <label className="block text-sm mb-1">Step size η:</label>
              <select 
                value={conformalEta} 
                onChange={(e) => setConformalEta(Number(e.target.value))}
                className="w-full p-2 border rounded text-sm"
              >
                <option value={0.01}>0.01</option>
                <option value={0.02}>0.02 (default)</option>
                <option value={0.05}>0.05</option>
              </select>
            </div>
          </div>
        )}

        {conformalMode === 'EnbPI' && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-medium mb-3">EnbPI Parameters</h3>
            <div>
              <label className="block text-sm mb-1">Ensemble size K:</label>
              <input 
                type="number" 
                value={conformalK} 
                onChange={(e) => setConformalK(Number(e.target.value))}
                className="w-full p-2 border rounded text-sm"
                min="5"
                step="1"
              />
              <p className="text-xs text-gray-500 mt-1">Minimum 5, default 20</p>
            </div>
          </div>
        )}

        {/* Apply Button */}
        <div className="mb-4">
          <button
            onClick={applyConformalPrediction}
            disabled={isApplyingConformal || !targetSpecResult}
            className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {isApplyingConformal ? 'Applying...' : 'Apply Conformal PI'}
          </button>
          {!targetSpecResult && (
            <p className="text-sm text-gray-500 mt-2">Please save target specification first</p>
          )}
        </div>

        {/* Error Display */}
        {conformalError && (
          <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-md text-red-700">
            <p className="font-medium">Error:</p>
            <p className="text-sm">{conformalError}</p>
          </div>
        )}

        {/* Coverage Chips */}
        {conformalState && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <h4 className="font-medium mb-2">Coverage Statistics</h4>
            <div className="grid grid-cols-3 gap-2 text-sm">
              <div className="text-center">
                <div className="font-mono text-lg">
                  {conformalState.coverage.last60 !== null 
                    ? `${(conformalState.coverage.last60 * 100).toFixed(1)}%` 
                    : 'N/A'}
                </div>
                <div className="text-xs text-gray-600">Last 60d</div>
              </div>
              <div className="text-center">
                <div className="font-mono text-lg">
                  {conformalState.coverage.lastCal !== null 
                    ? `${(conformalState.coverage.lastCal * 100).toFixed(1)}%` 
                    : 'N/A'}
                </div>
                <div className="text-xs text-gray-600">Cal Window</div>
              </div>
              <div className="text-center">
                <div className="font-mono text-lg">{conformalState.coverage.miss_count}</div>
                <div className="text-xs text-gray-600">Misses</div>
              </div>
            </div>
          </div>
        )}

        {/* Parameters Display */}
        {conformalState && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
            <h4 className="font-medium mb-2">Calibrated Parameters</h4>
            <div className="text-sm font-mono">
              {conformalMode === 'ICP' && conformalState.params.q_cal !== null && (
                <p>q_cal = {conformalState.params.q_cal.toFixed(6)}</p>
              )}
              {conformalMode === 'ICP-SCALED' && conformalState.params.q_cal_scaled !== null && (
                <p>q_cal_scaled = {conformalState.params.q_cal_scaled.toFixed(6)}</p>
              )}
              {conformalMode === 'CQR' && (
                <div>
                  {conformalState.params.delta_L !== null && (
                    <p>Δ_L = {conformalState.params.delta_L.toFixed(6)}</p>
                  )}
                  {conformalState.params.delta_U !== null && (
                    <p>Δ_U = {conformalState.params.delta_U.toFixed(6)}</p>
                  )}
                </div>
              )}
              {conformalMode === 'EnbPI' && (
                <div>
                  {conformalState.params.K && <p>K = {conformalState.params.K}</p>}
                  {conformalState.params.q_cal !== null && (
                    <p>q_cal = {conformalState.params.q_cal.toFixed(6)}</p>
                  )}
                </div>
              )}
              {conformalMode === 'ACI' && (
                <div>
                  {conformalState.params.eta && <p>η = {conformalState.params.eta}</p>}
                  {conformalState.params.theta !== null && (
                    <p>θ = {conformalState.params.theta.toFixed(6)}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Warnings */}
        {conformalState && conformalState.domain !== conformalDomain && (
          <div className="mb-4 p-3 bg-yellow-100 border border-yellow-300 rounded-md text-yellow-700">
            <p className="font-medium">⚠️ Domain Switch Warning</p>
            <p className="text-sm">Domain switched {conformalState.domain} ↔ {conformalDomain}: recalibration required</p>
          </div>
        )}

        {/* Formula Tooltip */}
        <details className="mt-4">
          <summary className="cursor-pointer text-blue-600 hover:text-blue-800 font-medium text-sm">
            Methods & Formulas
          </summary>
          <div className="mt-2 text-xs bg-blue-50 p-3 rounded font-mono">
            <div className="space-y-2">
              <div>
                <strong>ICP:</strong> q_cal = Q&#123;1−α&#125;(|y_i − ŷ_i|); PI: [ ŷ ± q_cal ]
              </div>
              <div>
                <strong>ICP scaled:</strong> q_cal_s = Q&#123;1−α&#125;(|y_i − ŷ_i| / σ_pred_i); width = q_cal_s·σ_pred_t
              </div>
              <div>
                <strong>CQR:</strong> L = L^0 − Δ_L ; U = U^0 + Δ_U
              </div>
              <div>
                <strong>EnbPI:</strong> OOB residuals → q_cal ; PI: [ ŷ ± q_cal ]
              </div>
              <div>
                <strong>ACI:</strong> θ&#123;t+1&#125; = θ_t + η ( miss_t − α )
              </div>
            </div>
          </div>
        </details>
      </div>

      {/* Breakout Card */}
      <div className="mb-8 p-6 border rounded-lg bg-white shadow-sm" data-testid="card-breakout">
        <h2 className="text-xl font-semibold mb-4">Breakout Detection</h2>
        
        {/* Controls */}
        <div className="mb-6 space-y-3">
          <div className="flex gap-3">
            <button
              onClick={detectBreakoutToday}
              disabled={isDetectingBreakout}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            >
              {isDetectingBreakout ? 'Detecting...' : 'Detect Today'}
            </button>
            
            <div className="flex gap-2 items-center">
              <input
                type="date"
                value={breakoutDetectDate}
                onChange={(e) => setBreakoutDetectDate(e.target.value)}
                className="px-3 py-2 border rounded"
              />
              <button
                onClick={detectBreakoutForDate}
                disabled={isDetectingBreakout || !breakoutDetectDate}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                Detect for Date
              </button>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {breakoutError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700">
            {breakoutError}
          </div>
        )}

        {/* Event Display */}
        {latestEvent ? (
          <div className="space-y-4">
            {/* Direction and Basic Info */}
            <div className="p-4 bg-red-50 border border-red-200 rounded-md">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">
                  {latestEvent.direction === 1 ? '↑' : '↓'}
                </span>
                <div>
                  <div className="font-semibold">
                    Breakout {latestEvent.direction === 1 ? 'Up' : 'Down'}
                  </div>
                  <div className="text-sm text-gray-600">
                    {latestEvent.t_date} → {latestEvent.B_date}
                  </div>
                </div>
                {latestEvent.event_open && (
                  <span className="ml-auto px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full">
                    OPEN
                  </span>
                )}
              </div>
            </div>

            {/* Magnitude Chips */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gray-50 p-3 rounded text-center">
                <div className="text-xs text-gray-600">z_B</div>
                <div className="font-mono text-lg">{latestEvent.z_B.toFixed(3)}</div>
              </div>
              <div className="bg-gray-50 p-3 rounded text-center">
                <div className="text-xs text-gray-600">z_excess_B</div>
                <div className="font-mono text-lg">{latestEvent.z_excess_B.toFixed(3)}</div>
              </div>
              <div className="bg-gray-50 p-3 rounded text-center">
                <div className="text-xs text-gray-600">% Outside</div>
                <div className="font-mono text-lg">{(latestEvent.pct_outside_B * 100).toFixed(1)}%</div>
              </div>
              <div className="bg-gray-50 p-3 rounded text-center">
                <div className="text-xs text-gray-600">ndist_B</div>
                <div className="font-mono text-lg">{latestEvent.ndist_B.toFixed(3)}</div>
              </div>
            </div>

            {/* Vol Regime */}
            {latestEvent.vol_regime_percentile !== null && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                <div className="text-sm font-medium text-blue-800">
                  Vol Regime: {(latestEvent.vol_regime_percentile * 100).toFixed(0)}th percentile
                </div>
              </div>
            )}

            {/* Provenance */}
            <div className="p-3 bg-gray-50 rounded-md">
              <div className="text-sm space-y-1">
                <div>
                  <strong>Method:</strong> {latestEvent.method_provenance.base_method}
                  {latestEvent.method_provenance.conformal_mode && ` + Conformal:${latestEvent.method_provenance.conformal_mode}`}
                </div>
                <div>
                  <strong>Coverage:</strong> {(latestEvent.method_provenance.coverage_nominal * 100).toFixed(1)}%
                </div>
                <div>
                  <strong>Critical:</strong> {latestEvent.method_provenance.critical.type} = {latestEvent.method_provenance.critical.value.toFixed(3)}
                  {latestEvent.method_provenance.critical.df && ` (df=${latestEvent.method_provenance.critical.df})`}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-green-50 border border-green-200 rounded-md text-green-700">
            No breakout detected (price inside band)
          </div>
        )}

        {/* Cool-down Status */}
        {cooldownStatus && (
          <div className="mt-4 p-3 bg-gray-50 rounded-md">
            <div className="text-sm">
              <strong>Cool-down (K_inside=3):</strong> {cooldownStatus.ok ? '✅ Pass' : '❌ Fail'}
              {cooldownStatus.reason && ` (${cooldownStatus.reason})`}
              <div className="text-xs text-gray-600 mt-1">
                Consecutive in-band days: {cooldownStatus.inside_count}
              </div>
            </div>
          </div>
        )}

        {/* Formulas Tooltip */}
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-blue-600 hover:text-blue-800">
            📖 Formulas & Rules
          </summary>
          <div className="mt-2 p-3 bg-gray-50 rounded text-xs space-y-1">
            <div><strong>outside_1d</strong> = (S_t+1 &lt; L_1) OR (S_t+1 &gt; U_1)</div>
            <div><strong>z_B</strong> = [ ln(S_t+1) − ( ln(S_t) + mu_star_used ) ] / s_t</div>
            <div><strong>z_excess_B</strong> = |z_B| − c</div>
            <div><strong>pct_outside_B</strong> = (L_1 − S_t+1)/L_1 (down) OR (S_t+1 − U_1)/U_1 (up)</div>
            <div><strong>ndist_B</strong> = | ln(S_t+1) − m_t(1) | / (c * s_t)</div>
            <div><strong>vol_regime_percentile</strong> = Percentile( σ_t+1|t vs trailing 3y )</div>
            <div><strong>Cool-down:</strong> K_inside = 3 in-band days required before a new event.</div>
          </div>
        </details>
      </div>

      {/* Continuation Clock Card */}
      <div className="mb-8 p-6 border rounded-lg bg-white shadow-sm" data-testid="card-continuation-clock">
        <h2 className="text-xl font-semibold mb-4">Continuation Clock</h2>
        
        {/* Controls */}
        <div className="mb-6 space-y-4">
          {/* Stop Rule */}
          <div>
            <label className="block text-sm font-medium mb-2">Stop Rule</label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  name="stopRule"
                  value="re-entry"
                  checked={stopRule === 're-entry'}
                  onChange={(e) => setStopRule(e.target.value as 're-entry')}
                  className="mr-2"
                />
                Re-entry (recommended)
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  name="stopRule"
                  value="sign-flip"
                  checked={stopRule === 'sign-flip'}
                  onChange={(e) => setStopRule(e.target.value as 'sign-flip')}
                  className="mr-2"
                />
                Sign-flip
              </label>
            </div>
          </div>

          {/* k_inside selector (only for re-entry) */}
          {stopRule === 're-entry' && (
            <div>
              <label className="block text-sm font-medium mb-2">k_inside</label>
              <select
                value={kInside}
                onChange={(e) => setKInside(Number(e.target.value) as 1 | 2)}
                className="px-3 py-2 border rounded"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </div>
          )}

          {/* T_max */}
          <div>
            <label className="block text-sm font-medium mb-2">T_max</label>
            <input
              type="number"
              min="1"
              max="100"
              value={tMax}
              onChange={(e) => setTMax(Number(e.target.value))}
              className="px-3 py-2 border rounded w-20"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={tickToday}
              disabled={isTicking}
              className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
            >
              {isTicking ? 'Ticking...' : 'Tick Today'}
            </button>
            
            <div className="flex gap-2 items-center">
              <input
                type="date"
                value={tickDate}
                onChange={(e) => setTickDate(e.target.value)}
                className="px-3 py-2 border rounded"
              />
              <button
                onClick={tickForDate}
                disabled={isTicking || !tickDate}
                className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
              >
                Tick Date
              </button>
            </div>

            <button
              onClick={rescanFromB}
              disabled={isTicking || !latestEvent}
              className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
            >
              Rescan from B
            </button>
          </div>
        </div>

        {/* Error Display */}
        {continuationError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700">
            {continuationError}
          </div>
        )}

        {/* Last Action */}
        {lastContinuationAction && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-blue-700">
            Last action: {lastContinuationAction}
          </div>
        )}

        {/* Event Status Display */}
        {latestEvent ? (
          <div className="space-y-4">
            {latestEvent.event_open ? (
              // Open Event
              <div className="p-4 bg-orange-50 border border-orange-200 rounded-md">
                <div className="font-semibold text-orange-800 mb-2">Event Open - Continuing</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="font-medium">T so far</div>
                    <div className="font-mono text-lg">{latestEvent.at_risk_days || 0}</div>
                  </div>
                  {stopRule === 're-entry' && (
                    <div>
                      <div className="font-medium">In-band streak</div>
                      <div className="font-mono text-lg">{latestEvent.inband_streak || 0}</div>
                    </div>
                  )}
                  <div>
                    <div className="font-medium">Max z_excess</div>
                    <div className="font-mono text-lg">{latestEvent.max_z_excess?.toFixed(3) || '0.000'}</div>
                  </div>
                  <div>
                    <div className="font-medium">Stop Rule</div>
                    <div className="text-sm">{latestEvent.stop_rule || 'Not set'}</div>
                  </div>
                </div>
              </div>
            ) : (
              // Closed Event
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-md">
                <div className="font-semibold text-gray-800 mb-2">
                  Event {latestEvent.censored ? 'Censored' : 'Stopped'}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
                  <div>
                    <div className="font-medium">T</div>
                    <div className="font-mono text-lg">{latestEvent.T || 0}</div>
                  </div>
                  <div>
                    <div className="font-medium">D_stop</div>
                    <div className="font-mono">{latestEvent.D_stop || 'N/A'}</div>
                  </div>
                  <div>
                    <div className="font-medium">Censored</div>
                    <div>{latestEvent.censored ? '✅ Yes' : '❌ No'}</div>
                  </div>
                  <div>
                    <div className="font-medium">Reason</div>
                    <div className="text-xs">{latestEvent.censor_reason || 'Reverted'}</div>
                  </div>
                </div>
                
                {/* KM Tuple */}
                <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                  <div className="font-medium text-blue-800 mb-1">KM Tuple</div>
                  <div className="font-mono text-sm">
                    time_i = {latestEvent.T || 0} ; status_i = {latestEvent.censored ? 0 : 1}
                  </div>
                  <div className="text-xs text-blue-600 mt-1">
                    (1 if reverted, 0 if censored)
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-md text-gray-700">
            No event to track
          </div>
        )}

        {/* Note */}
        <div className="mt-4 p-2 bg-gray-50 rounded text-xs text-gray-600">
          Non-trading days do not increment T; missing data pauses.
        </div>

        {/* Formulas Tooltip */}
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-blue-600 hover:text-blue-800">
            📖 Stop Rules & Formulas
          </summary>
          <div className="mt-2 p-3 bg-gray-50 rounded text-xs space-y-1">
            <div><strong>Stop Rule A (re-entry):</strong> S_D ∈ [L_1(D−1), U_1(D−1)] → T = j − k_inside</div>
            <div><strong>Stop Rule B (sign-flip):</strong> sign( ln(S_D/S_D−1) ) = −d → T = j − 1</div>
            <div><strong>Right-censor:</strong> j hits T_max (Type-I) or end_of_sample</div>
            <div><strong>KM tuple:</strong> time_i = T ; status_i = 1 if reverted else 0</div>
          </div>
        </details>
      </div>

      {/* Final PI Card */}
      <div className="mb-8 p-6 border rounded-lg bg-white shadow-sm" data-testid="card-final-pi">
        <h2 className="text-xl font-semibold mb-4">Final Prediction Intervals</h2>
        
        {currentForecast ? (
          <div>
            {/* Method Chip */}
            <div className="mb-4">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-green-100 text-green-800">
                🔒 {currentForecast.method.startsWith('Conformal:') ? (
                  <>
                    {currentForecast.diagnostics?.base_method || 'Base'} + {currentForecast.method}
                  </>
                ) : (
                  currentForecast.method
                )}
              </span>
              <span className="ml-3 text-sm text-gray-500">
                Created: {new Date(currentForecast.created_at).toLocaleString()}
              </span>
            </div>

            {/* PI Values */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-sm text-gray-600">L₁ (Lower)</div>
                <div className="text-lg font-mono">${(currentForecast.L_h || currentForecast.intervals?.L_h || 0).toFixed(2)}</div>
              </div>
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-sm text-gray-600">U₁ (Upper)</div>
                <div className="text-lg font-mono">${(currentForecast.U_h || currentForecast.intervals?.U_h || 0).toFixed(2)}</div>
              </div>
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-sm text-gray-600">Band Width</div>
                <div className="text-lg font-mono">{(currentForecast.band_width_bp || currentForecast.intervals?.band_width_bp || 0).toFixed(0)} bp</div>
              </div>
              <div className="bg-gray-50 p-3 rounded">
                <div className="text-sm text-gray-600">Critical z_α</div>
                <div className="text-lg font-mono">
                  {currentForecast.critical?.z_alpha?.toFixed(3) || 
                   currentForecast.critical?.value?.toFixed(3) || 'N/A'}
                </div>
              </div>
            </div>

            {/* Technical Details */}
            <div className="text-sm text-gray-600 space-y-1">
              <p><strong>Coverage:</strong> {((currentForecast.params?.coverage || currentForecast.target?.coverage || 0) * 100).toFixed(1)}% • <strong>Horizon:</strong> {currentForecast.params?.h || currentForecast.target?.h || 1}D</p>
              <p><strong>As-of Date:</strong> {currentForecast.date_t} • <strong>Window:</strong> {currentForecast.params?.window || 'N/A'} days</p>
              <p><strong>Drift Shrinkage:</strong> λ = {currentForecast.params?.lambda_drift?.toFixed(3) || 'N/A'}</p>
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <p>No forecast generated yet</p>
            <p className="text-sm mt-1">Generate a GBM PI above to see prediction intervals</p>
          </div>
        )}
      </div>
      
      {/* Upload Section */}
      <div className="mb-8 p-6 border rounded-lg bg-white shadow-sm">
        <h2 className="text-xl font-semibold mb-4">Upload Data</h2>
        <form onSubmit={handleFileUpload} className="space-y-4">
          <div>
            <label htmlFor="file" className="block text-sm font-medium mb-2">
              Excel File (.xlsx)
            </label>
            <input
              type="file"
              id="file"
              name="file"
              accept=".xlsx"
              required
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>
          <div>
            <label htmlFor="exchange" className="block text-sm font-medium mb-2">
              Exchange (optional)
            </label>
            <input
              type="text"
              id="exchange"
              name="exchange"
              placeholder="e.g., NASDAQ, NYSE"
              className="block w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <button
            type="submit"
            disabled={isUploading}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {isUploading ? 'Processing...' : 'Upload & Process'}
          </button>
        </form>
        
        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-600">{error}</p>
          </div>
        )}
      </div>

      {/* Data Quality Card */}
      {uploadResult && (
        <div className="p-6 border rounded-lg bg-white shadow-sm">
          <h2 className="text-xl font-semibold mb-4">Data Quality</h2>
          
          {/* Badges */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            <Badge
              label="Contract OK"
              status={uploadResult.badges.contractOK}
            />
            <Badge
              label="Calendar OK"
              status={uploadResult.badges.calendarOK}
            />
            <Badge
              label="TZ OK"
              status={uploadResult.badges.tzOK}
            />
            <Badge
              label="Corporate Actions OK"
              status={uploadResult.badges.corpActionsOK}
            />
            <Badge
              label="Validations OK"
              status={uploadResult.badges.validationsOK}
            />
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium">Repairs:</span>
              <span className={`px-2 py-1 rounded text-sm ${
                uploadResult.badges.repairsCount === 0 
                  ? 'bg-green-100 text-green-800' 
                  : 'bg-yellow-100 text-yellow-800'
              }`}>
                {uploadResult.badges.repairsCount}
              </span>
            </div>
          </div>

          {/* Counts */}
          <div className="mb-6">
            <h3 className="text-lg font-medium mb-2">Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-600">Input rows:</span>
                <span className="ml-2 font-medium">{uploadResult.counts.input}</span>
              </div>
              <div>
                <span className="text-gray-600">Canonical rows:</span>
                <span className="ml-2 font-medium">{uploadResult.counts.canonical}</span>
              </div>
              <div>
                <span className="text-gray-600">Invalid rows:</span>
                <span className="ml-2 font-medium">{uploadResult.counts.invalid}</span>
              </div>
              <div>
                <span className="text-gray-600">Missing days:</span>
                <span className="ml-2 font-medium">{uploadResult.counts.missingDays}</span>
              </div>
            </div>
          </div>

          {/* Details */}
          <details className="mb-4">
            <summary className="cursor-pointer text-blue-600 hover:text-blue-800 font-medium">
              View Details
            </summary>
            <div className="mt-4 space-y-4 text-sm">
              <div>
                <h4 className="font-medium">Metadata</h4>
                <p>Symbol: {uploadResult.meta.symbol}</p>
                <p>Exchange: {uploadResult.meta.exchange}</p>
                <p>Timezone: {uploadResult.meta.exchange_tz}</p>
                <p>Date Range: {uploadResult.meta.calendar_span.start} to {uploadResult.meta.calendar_span.end}</p>
              </div>
              
              {uploadResult.meta.missing_trading_days.length > 0 && (
                <div>
                  <h4 className="font-medium">Missing Trading Days</h4>
                  <p className="text-gray-600">
                    {uploadResult.meta.missing_trading_days.slice(0, 10).join(', ')}
                    {uploadResult.meta.missing_trading_days.length > 10 && '...'}
                  </p>
                </div>
              )}
              
              <div>
                <h4 className="font-medium">Files Generated</h4>
                <div className="space-y-1 text-xs text-gray-600">
                  <p>Raw: {uploadResult.paths.raw}</p>
                  <p>Canonical: {uploadResult.paths.canonical}</p>
                  <p>Audit: {uploadResult.paths.audit}</p>
                </div>
              </div>
            </div>
          </details>

          {/* Methods */}
          <details>
            <summary className="cursor-pointer text-blue-600 hover:text-blue-800 font-medium">
              Methods & Formulas
            </summary>
            <div className="mt-4 text-sm bg-gray-50 p-4 rounded">
              <p><strong>Log returns:</strong> r_t = ln(adj_close_t / adj_close_{'{t−1}'})</p>
              <p><strong>OHLC coherence:</strong> high ≥ max(open, close), low ≤ min(open, close), low ≤ high</p>
              <p><strong>Calendar check:</strong> no gaps vs exchange calendar (weekday approximation for now)</p>
              <p><strong>Delistings:</strong> keep history; mark delisted=true if applicable</p>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

interface BadgeProps {
  label: string;
  status: boolean;
}

function Badge({ label, status }: BadgeProps) {
  return (
    <div className="flex items-center space-x-2">
      <span className="text-sm font-medium">{label}:</span>
      <span className={`px-2 py-1 rounded text-sm ${
        status 
          ? 'bg-green-100 text-green-800' 
          : 'bg-red-100 text-red-800'
      }`}>
        {status ? 'OK' : 'FAIL'}
      </span>
    </div>
  );
}