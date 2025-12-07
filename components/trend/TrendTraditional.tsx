'use client';

import { useMemo } from 'react';
import TrendPriceChart from '@/components/trend/TrendPriceChart';
import { useEwmaWalker } from '@/lib/hooks/useEwmaWalker';
import { classifyTrendFromEwma } from '@/lib/trend/ewmaTrendClassifier';

interface TrendTraditionalProps {
  ticker: string;
}

export default function TrendTraditional({ ticker }: TrendTraditionalProps) {
  const { path, summary, isLoading, error } = useEwmaWalker(ticker, {
    lambda: 0.94,
    horizon: 1,
    coverage: 0.95,
  });

  const classification = useMemo(
    () => (path && path.length > 0 ? classifyTrendFromEwma(path) : null),
    [path]
  );

  return (
    <div className="space-y-6">
      {/* EWMA Config / Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <div>
          <span className="font-semibold text-slate-200">
            EWMA Trend (λ = 0.94, h = 1D, 95% PI)
          </span>
        </div>
        <div className="flex items-center gap-3">
          {isLoading && <span>Loading EWMA…</span>}
          {error && <span className="text-red-400">Error: {error}</span>}
          {summary && (
            <span>
              Cov: {(summary.piMetrics.empiricalCoverage * 100).toFixed(1)}% ·
              Hit: {(summary.directionHitRate * 100).toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      {/* Main Chart */}
      <TrendPriceChart
        symbol={ticker}
        ewmaPath={path}
        ewmaSummary={summary}
        className="h-[420px]"
      />

      {/* Trend Status Panel */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-200">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Trend status (EWMA-only)
        </h3>

        {!path || path.length === 0 ? (
          <p className="text-slate-400">
            Not enough EWMA data yet to classify the trend.
          </p>
        ) : !classification ? (
          <p className="text-slate-400">
            Unable to compute a stable trend classification from recent data.
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-xs sm:text-sm">
            <div>
              <dt className="text-slate-400">Regime</dt>
              <dd className="font-medium capitalize">
                {classification.regime === 'up' && 'Uptrend'}
                {classification.regime === 'down' && 'Downtrend'}
                {classification.regime === 'sideways' && 'Sideways'}
              </dd>
            </div>

            <div>
              <dt className="text-slate-400">Strength</dt>
              <dd className="font-medium">
                {(classification.strengthScore * 100).toFixed(0)}%
              </dd>
            </div>

            <div>
              <dt className="text-slate-400">Latest price</dt>
              <dd className="font-mono">
                {classification.latestPrice.toFixed(2)}
              </dd>
            </div>

            <div>
              <dt className="text-slate-400">EWMA center</dt>
              <dd className="font-mono">
                {classification.ewmaCenter.toFixed(2)} (
                {(classification.pricePctFromEwma * 100).toFixed(2)}%)
              </dd>
            </div>

            <div>
              <dt className="text-slate-400">Avg return (recent)</dt>
              <dd className="font-mono">
                {(classification.avgReturn * 100).toFixed(2)}%
              </dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  );
}
