'use client';

import { useState, useEffect } from 'react';
import { IngestionResult } from '@/lib/types/canonical';
import { TargetSpec, TargetSpecResult } from '@/lib/types/targetSpec';

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

  // Load target spec on mount
  useEffect(() => {
    loadTargetSpec();
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