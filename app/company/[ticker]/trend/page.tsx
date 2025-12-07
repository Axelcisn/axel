'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import CompanySubnav from '@/components/company/CompanySubnav';
import TrendTraditional from '@/components/trend/TrendTraditional';
import TrendML from '@/components/trend/TrendML';
import TrendAI from '@/components/trend/TrendAI';

type TrendTab = 'traditional' | 'ml' | 'ai';

const tabs: { id: TrendTab; label: string }[] = [
  { id: 'traditional', label: 'Traditional' },
  { id: 'ml', label: 'ML' },
  { id: 'ai', label: 'AI' },
];

export default function TrendPage() {
  const params = useParams();
  const ticker = (params?.ticker as string) || '';
  const [activeTab, setActiveTab] = useState<TrendTab>('traditional');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header with CompanySubnav */}
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold text-white">{ticker}</h1>
              <CompanySubnav ticker={ticker} />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        {/* Tab Navigation */}
        <div className="mb-6">
          <div className="flex items-center gap-1 rounded-lg bg-slate-800/30 p-1 w-fit">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  px-4 py-1.5 text-sm font-medium rounded-md transition-all
                  ${activeTab === tab.id
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                  }
                `}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div>
          {activeTab === 'traditional' && <TrendTraditional ticker={ticker} />}
          {activeTab === 'ml' && <TrendML ticker={ticker} />}
          {activeTab === 'ai' && <TrendAI ticker={ticker} />}
        </div>
      </main>
    </div>
  );
}
