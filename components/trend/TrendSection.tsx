'use client';

import { useState } from 'react';
import { useDarkMode } from '@/lib/hooks/useDarkMode';

// Tab type for trend analysis
type TrendTab = 'traditional' | 'ml' | 'ai';

// EWMA crossover preset type
type EwmaPreset = 'short' | 'medium' | 'long' | 'custom';

interface TrendSectionProps {
  ticker: string;
  horizon?: number;
  coverage?: number;
  shortWindowOverride?: number;
  longWindowOverride?: number;
  onEwmaWindowChange?: (
    shortWindow: number,
    longWindow: number,
    preset: EwmaPreset
  ) => void;
  momentumPeriodOverride?: number;
  onMomentumPeriodChange?: (period: number) => void;
  ewmaCrossoverOverride?: any;
  trendWeight?: number | null;
  trendWeightUpdatedAt?: string | null;
}

export default function TrendSection({
  ticker,
  horizon = 1,
  coverage,
  shortWindowOverride,
  longWindowOverride,
  onEwmaWindowChange,
  momentumPeriodOverride,
  onMomentumPeriodChange,
  ewmaCrossoverOverride,
  trendWeight: trendWeightProp,
  trendWeightUpdatedAt: trendWeightUpdatedAtProp,
}: TrendSectionProps) {
  const isDarkMode = useDarkMode();
  
  // Tabs & UI state
  const [activeTab, setActiveTab] = useState<TrendTab>('traditional');

  // Tab configuration
  const tabs = [
    { key: 'traditional' as const, label: 'Traditional' },
    { key: 'ml' as const, label: 'ML' },
    { key: 'ai' as const, label: 'AI' },
  ];

  return (
    <div className="mt-8">
      {/* Header */}
      <div className="mb-6">
        <h3 className={`text-xl font-semibold mb-3 ${
          isDarkMode ? 'text-slate-100' : 'text-gray-900'
        }`}>
          Trend Analysis
        </h3>
        
        {/* Tab Navigation */}
        <div className={`border-b ${isDarkMode ? 'border-slate-700' : 'border-gray-200'}`}>
          <nav className="-mb-px flex space-x-8" aria-label="Tabs">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.key
                    ? isDarkMode
                      ? 'border-violet-400 text-violet-300'
                      : 'border-violet-500 text-violet-600'
                    : isDarkMode
                    ? 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-300'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Traditional Tab Content - Cards Removed */}
      {activeTab === 'traditional' && (
        <div className="space-y-6">
          <div className="text-center py-12">
            <p className="text-slate-400 text-sm">Trend analysis cards have been removed.</p>
          </div>
        </div>
      )}

      {/* ML Tab Content */}
      {activeTab === 'ml' && (
        <div className={`rounded-xl p-6 border ${
          isDarkMode 
            ? 'bg-transparent border-slate-700/50' 
            : 'bg-transparent border-gray-200'
        }`}>
          <div className="text-center">
            <h4 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-slate-200' : 'text-gray-800'}`}>
              ML-Based Trend Analysis
            </h4>
            <p className={`text-sm mb-4 ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
              Machine learning models for trend detection coming soon.
            </p>
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs ${
              isDarkMode ? 'bg-slate-800 text-slate-400' : 'bg-gray-200 text-gray-500'
            }`}>
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Under Development
            </div>
          </div>
        </div>
      )}

      {/* AI Tab Content */}
      {activeTab === 'ai' && (
        <div className={`rounded-xl p-6 border ${
          isDarkMode 
            ? 'bg-transparent border-slate-700/50' 
            : 'bg-transparent border-gray-200'
        }`}>
          <div className="text-center">
            <h4 className={`text-lg font-semibold mb-2 ${isDarkMode ? 'text-slate-200' : 'text-gray-800'}`}>
              AI-Powered Trend Insights
            </h4>
            <p className={`text-sm mb-4 ${isDarkMode ? 'text-slate-400' : 'text-gray-500'}`}>
              LLM-based trend reasoning and market commentary coming soon.
            </p>
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs ${
              isDarkMode ? 'bg-slate-800 text-slate-400' : 'bg-gray-200 text-gray-500'
            }`}>
              <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
              Under Development
            </div>
          </div>
        </div>
      )}
    </div>
  );
}