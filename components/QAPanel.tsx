'use client';

import React, { useState } from 'react';
import { QAReport, ScenarioResult } from '@/lib/qa/runner';

interface QAPanelProps {
  className?: string;
}

export function QAPanel({ className = '' }: QAPanelProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [report, setReport] = useState<QAReport | null>(null);
  const [smokeResult, setSmokeResult] = useState<ScenarioResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runSmokeTest = async () => {
    setIsRunning(true);
    setError(null);
    setSmokeResult(null);
    
    try {
      const response = await fetch('/api/qa/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'smoke', symbol: 'AAPL' })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Smoke test failed');
      }
      
      const result = await response.json();
      setSmokeResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Smoke test failed');
    } finally {
      setIsRunning(false);
    }
  };

  const runFullSuite = async () => {
    setIsRunning(true);
    setError(null);
    setReport(null);
    
    try {
      const response = await fetch('/api/qa/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'full' })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Full test suite failed');
      }
      
      const result = await response.json();
      setReport(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Full test suite failed');
    } finally {
      setIsRunning(false);
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className={`p-6 bg-white border rounded-lg shadow-sm ${className}`} data-testid="qa-panel">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">
          QA Test Runner
        </h3>
        <div className="flex gap-2">
          <button
            onClick={runSmokeTest}
            disabled={isRunning}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            data-testid="qa-smoke-test-btn"
          >
            {isRunning ? 'Running...' : 'Smoke Test'}
          </button>
          <button
            onClick={runFullSuite}
            disabled={isRunning}
            className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            data-testid="qa-full-suite-btn"
          >
            {isRunning ? 'Running...' : 'Full Suite'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded" data-testid="qa-error">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {smokeResult && (
        <div className="mb-4 p-4 bg-gray-50 border rounded" data-testid="qa-smoke-result">
          <h4 className="font-medium text-gray-900 mb-2">
            Smoke Test Result ({smokeResult.symbol})
          </h4>
          <div className="flex items-center gap-4 mb-3">
            <span className={`px-2 py-1 text-xs rounded ${
              smokeResult.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {smokeResult.success ? 'PASS' : 'FAIL'}
            </span>
            <span className="text-sm text-gray-600">
              {smokeResult.totalPassed} passed, {smokeResult.totalFailed} failed
            </span>
            <span className="text-sm text-gray-600">
              {formatDuration(smokeResult.duration)}
            </span>
          </div>
          
          <div className="space-y-1">
            {smokeResult.assertions.map((assertion, index) => (
              <div key={index} className="flex items-start gap-2 text-sm">
                <span className={assertion.pass ? 'text-green-600' : 'text-red-600'}>
                  {assertion.pass ? '✓' : '✗'}
                </span>
                <span className="text-gray-700">{assertion.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {report && (
        <div className="p-4 bg-gray-50 border rounded" data-testid="qa-full-report">
          <h4 className="font-medium text-gray-900 mb-2">
            Full Test Suite Report
          </h4>
          <div className="flex items-center gap-4 mb-4">
            <span className={`px-2 py-1 text-xs rounded ${
              report.failedScenarios === 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {report.passedScenarios}/{report.totalScenarios} PASSED
            </span>
            <span className="text-sm text-gray-600">
              {formatDuration(report.duration)}
            </span>
          </div>

          <div className="space-y-3">
            {report.scenarios.map((scenario, index) => (
              <div key={index} className="border-l-4 pl-3 border-gray-200">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-1 rounded ${
                    scenario.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {scenario.success ? 'PASS' : 'FAIL'}
                  </span>
                  <span className="font-medium text-sm text-gray-900">
                    {scenario.scenario} ({scenario.symbol})
                  </span>
                  <span className="text-xs text-gray-500">
                    {scenario.totalPassed}P/{scenario.totalFailed}F
                  </span>
                </div>
                
                {!scenario.success && (
                  <div className="ml-2 space-y-1">
                    {scenario.assertions
                      .filter(a => !a.pass)
                      .map((assertion, idx) => (
                        <div key={idx} className="text-xs text-red-600">
                          ✗ {assertion.message}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!smokeResult && !report && !isRunning && (
        <div className="text-center py-8 text-gray-500" data-testid="qa-no-results">
          <p className="text-sm">Run a test to see results</p>
          <p className="text-xs mt-1">
            Smoke Test: Quick validation with AAPL<br/>
            Full Suite: Test all scenarios across multiple symbols
          </p>
        </div>
      )}
    </div>
  );
}