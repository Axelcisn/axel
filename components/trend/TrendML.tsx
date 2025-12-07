'use client';

interface TrendMLProps {
  ticker: string;
}

export default function TrendML({ ticker }: TrendMLProps) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="text-center">
        <h3 className="text-lg font-semibold text-slate-200 mb-2">
          ML-Based Trend Analysis
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          Machine learning models for trend detection coming soon.
        </p>
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800 text-xs text-slate-400">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          Under Development
        </div>
      </div>
    </div>
  );
}
