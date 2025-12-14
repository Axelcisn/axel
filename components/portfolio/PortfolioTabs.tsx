import { PortfolioTab } from '@/lib/portfolio/types';
import { MUTED, TEXT } from './portfolioTheme';

interface PortfolioTabsProps {
  activeTab: PortfolioTab;
  onChange: (tab: PortfolioTab) => void;
}

const tabs: Array<{ id: PortfolioTab; label: string }> = [
  { id: 'positions', label: 'Positions' },
  { id: 'orders', label: 'Orders' },
  { id: 'trades', label: 'Trades' },
  { id: 'balances', label: 'Balances' },
];

export default function PortfolioTabs({ activeTab, onChange }: PortfolioTabsProps) {
  return (
    <div className="border-b border-white/10 px-3">
      <div className="flex items-center gap-6 text-sm font-semibold">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`relative px-1 py-3 transition-colors ${
                isActive ? TEXT : `${MUTED} hover:text-white/80`
              }`}
            >
              {tab.label}
              {isActive && (
                <span className="absolute inset-x-0 -bottom-px block h-[2px] rounded-full bg-white/80" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
