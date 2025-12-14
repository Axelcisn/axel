import { PortfolioSummary } from '@/lib/portfolio/types';
import { formatCompactCurrency, formatCurrency } from '@/lib/portfolio/format';
import { MUTED2, TEXT } from './portfolioTheme';

interface PortfolioSummaryStripProps {
  summary: PortfolioSummary;
}

type NumericSummaryKey = Exclude<keyof PortfolioSummary, 'accountId'>;

const metricLabels: Array<{
  key: NumericSummaryKey;
  label: string;
  format: (value: number) => string;
}> = [
  { key: 'dailyPnl', label: 'Daily P&L', format: formatCompactCurrency },
  { key: 'unrealizedPnl', label: 'Unrealized P&L', format: formatCompactCurrency },
  { key: 'realizedPnl', label: 'Realized P&L', format: formatCompactCurrency },
  { key: 'netLiquidity', label: 'Net Liquidity', format: formatCompactCurrency },
  { key: 'excessLiquidity', label: 'Excess Liquidity', format: formatCompactCurrency },
  { key: 'availableFunds', label: 'Available Funds', format: formatCompactCurrency },
  { key: 'buyingPower', label: 'Buying Power', format: formatCurrency },
  { key: 'maintenanceMargin', label: 'Maintenance Margin', format: formatCompactCurrency },
  { key: 'initialMargin', label: 'Initial Margin', format: formatCompactCurrency },
];

export default function PortfolioSummaryStrip({ summary }: PortfolioSummaryStripProps) {
  return (
    <div className="overflow-x-auto">
      <div className="flex flex-1 flex-nowrap overflow-x-auto divide-x divide-white/10">
        {metricLabels.map((metric) => {
          const value = summary[metric.key];
          const tone = value > 0 ? 'text-emerald-400' : value < 0 ? 'text-rose-400' : TEXT;
          return (
            <div key={metric.key} className="flex flex-col gap-1 px-4 py-2 whitespace-nowrap shrink-0">
              <span className={`text-[11px] font-medium uppercase tracking-wide ${MUTED2}`}>
                {metric.label}
              </span>
              <span className={`text-sm font-semibold ${tone}`}>{metric.format(value)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
