import { PortfolioPosition } from '@/lib/portfolio/types';
import { formatCurrency, formatNumber, formatPercent, toneForNumber } from '@/lib/portfolio/format';
import Sparkline from './Sparkline';
import {
  DIVIDER,
  FOOTER_BG,
  HEADER_BG,
  MUTED,
  ROW_ALT,
  ROW_HOVER,
  SURFACE,
  TEXT,
} from './portfolioTheme';

export type SortField = 'companyName' | 'position' | 'dailyPnl' | 'marketValue' | 'unrealizedPnl' | 'symbol';
export type SortDirection = 'asc' | 'desc';

interface Totals {
  costBasis: number;
  marketValue: number;
  dailyPnl: number;
  unrealizedPnl: number;
}

interface PortfolioTableProps {
  positions: PortfolioPosition[];
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
  totals: Totals;
  selectedRows: string[];
  onToggleRow: (symbol: string) => void;
  isLoading?: boolean;
}

const headerBase =
  `${HEADER_BG} backdrop-blur text-[12px] font-semibold uppercase tracking-wide ${MUTED} border-b ${DIVIDER} whitespace-nowrap`;

const cellBase = 'px-3 py-2 text-sm text-white/85 whitespace-nowrap border-b border-white/10';
const cellDivider = 'border-r border-white/10';
const headerDivider = 'border-r border-white/10';

function SortableHeader({
  label,
  field,
  activeField,
  direction,
  onSort,
  align = 'left',
  withDivider = false,
}: {
  label: string;
  field: SortField;
  activeField: SortField;
  direction: SortDirection;
  onSort: (field: SortField) => void;
  align?: 'left' | 'right';
  withDivider?: boolean;
}) {
  const isActive = activeField === field;
  return (
    <th
      className={`${headerBase} ${align === 'right' ? 'text-right' : 'text-left'} px-3 py-3 ${
        withDivider ? headerDivider : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className="flex w-full items-center gap-1 text-xs font-semibold text-white/70 hover:text-white whitespace-nowrap"
      >
        <span className="flex-1 text-left">{label}</span>
        <span className="text-[10px] text-white/50">
          {isActive ? (direction === 'asc' ? '▲' : '▼') : '▴▾'}
        </span>
      </button>
    </th>
  );
}

export default function PortfolioTable({
  positions,
  sortField,
  sortDirection,
  onSort,
  totals,
  selectedRows,
  onToggleRow,
  isLoading = false,
}: PortfolioTableProps) {
  return (
    <div className={`relative overflow-x-auto rounded-2xl ${SURFACE}`}>
      <table className="min-w-[1100px] w-full border-collapse">
        <thead className="sticky top-0 z-10">
          <tr>
            <SortableHeader
              label="Company Name"
              field="companyName"
              activeField={sortField}
              direction={sortDirection}
              onSort={onSort}
            />
            <SortableHeader
              label="Position"
              field="position"
              activeField={sortField}
              direction={sortDirection}
              onSort={onSort}
              align="right"
              withDivider
            />
            <th className={`${headerBase} ${headerDivider} text-right px-3 py-3`}>Last</th>
            <th className={`${headerBase} ${headerDivider} text-right px-3 py-3`}>Change $</th>
            <th className={`${headerBase} ${headerDivider} text-right px-3 py-3`}>Change %</th>
            <SortableHeader
              label="Daily P&L $"
              field="dailyPnl"
              activeField={sortField}
              direction={sortDirection}
              onSort={onSort}
              align="right"
              withDivider
            />
            <th className={`${headerBase} ${headerDivider} text-right px-3 py-3`}>Daily P&L %</th>
            <th className={`${headerBase} ${headerDivider} text-right px-3 py-3`}>Avg Price</th>
            <th className={`${headerBase} ${headerDivider} text-right px-3 py-3`}>Cost Basis</th>
            <SortableHeader
              label="Market Value"
              field="marketValue"
              activeField={sortField}
              direction={sortDirection}
              onSort={onSort}
              align="right"
              withDivider
            />
            <SortableHeader
              label="Unrealized P&L"
              field="unrealizedPnl"
              activeField={sortField}
              direction={sortDirection}
              onSort={onSort}
              align="right"
              withDivider
            />
            <th className={`${headerBase} ${headerDivider} text-right px-3 py-3`}>Unrealized %</th>
            <th className={`${headerBase} ${headerDivider} text-left px-3 py-3`}>Trend</th>
          </tr>
        </thead>
        <tbody className="bg-transparent">
          {positions.map((row) => {
            const isSelected = selectedRows.includes(row.symbol);
            const changeTone = toneForNumber(row.change);
            const pnlTone = toneForNumber(row.dailyPnl);
            const unrealTone = toneForNumber(row.unrealizedPnl);
            return (
              <tr
                key={row.symbol}
                onClick={() => onToggleRow(row.symbol)}
                className={`transition-colors ${ROW_ALT} ${ROW_HOVER} ${
                  isSelected ? 'bg-white/10' : ''
                }`}
              >
                <td className={`${cellBase}`}>
                  <div className="flex flex-col">
                    <span className="text-[13px] font-semibold text-white">{row.symbol}</span>
                    <span className="text-[12px] text-white/60">{row.companyName}</span>
                  </div>
                </td>
                <td className={`${cellBase} ${cellDivider} text-right tabular-nums`}>
                  <span className={row.position < 0 ? 'text-rose-400' : 'text-white'}>
                    {formatNumber(row.position, 0)}
                  </span>
                </td>
                <td className={`${cellBase} ${cellDivider} text-right tabular-nums ${changeTone}`}>
                  {formatNumber(row.last)}
                </td>
                <td className={`${cellBase} ${cellDivider} text-right tabular-nums ${changeTone}`}>
                  {formatNumber(row.change)}
                </td>
                <td className={`${cellBase} ${cellDivider} text-right tabular-nums ${changeTone}`}>
                  {formatPercent(row.changePct)}
                </td>
                <td className={`${cellBase} ${cellDivider} text-right tabular-nums ${pnlTone}`}>
                  {formatCurrency(row.dailyPnl, 0)}
                </td>
                <td className={`${cellBase} ${cellDivider} text-right tabular-nums ${pnlTone}`}>
                  {formatPercent(row.dailyPnlPct)}
                </td>
                <td className={`${cellBase} ${cellDivider} text-right tabular-nums`}>
                  {formatNumber(row.avgPrice)}
                </td>
                <td className={`${cellBase} ${cellDivider} text-right tabular-nums`}>
                  {formatCurrency(row.costBasis, 0)}
                </td>
                <td className={`${cellBase} ${cellDivider} text-right tabular-nums`}>
                  {formatCurrency(row.marketValue, 0)}
                </td>
                <td className={`${cellBase} ${cellDivider} text-right tabular-nums ${unrealTone}`}>
                  {formatCurrency(row.unrealizedPnl, 0)}
                </td>
                <td className={`${cellBase} ${cellDivider} text-right tabular-nums ${unrealTone}`}>
                  {formatPercent(row.unrealizedPnlPct)}
                </td>
                <td className={`${cellBase} ${cellDivider}`}>
                  <Sparkline data={row.trend} />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className={`${FOOTER_BG} text-sm font-semibold ${TEXT}`}>
            <td className={`px-3 py-3 text-left ${MUTED}`}>Totals</td>
            <td className="px-3 py-3 text-right tabular-nums text-white/60 border-l border-white/10">—</td>
            <td className="px-3 py-3 text-right border-l border-white/10 text-white/60">—</td>
            <td className="px-3 py-3 text-right border-l border-white/10 text-white/60">—</td>
            <td className="px-3 py-3 text-right border-l border-white/10 text-white/60">—</td>
            <td className="px-3 py-3 text-right tabular-nums border-l border-white/10">
              {formatCurrency(totals.dailyPnl, 0)}
            </td>
            <td className="px-3 py-3 text-right tabular-nums text-white/60 border-l border-white/10">—</td>
            <td className="px-3 py-3 text-right tabular-nums text-white/60 border-l border-white/10">—</td>
            <td className="px-3 py-3 text-right tabular-nums border-l border-white/10">
              {formatCurrency(totals.costBasis, 0)}
            </td>
            <td className="px-3 py-3 text-right tabular-nums border-l border-white/10">
              {formatCurrency(totals.marketValue, 0)}
            </td>
            <td className="px-3 py-3 text-right tabular-nums border-l border-white/10">
              {formatCurrency(totals.unrealizedPnl, 0)}
            </td>
            <td className="px-3 py-3 text-right text-white/60 border-l border-white/10">—</td>
            <td className="px-3 py-3 text-left text-white/60 border-l border-white/10">—</td>
          </tr>
        </tfoot>
      </table>
      {isLoading && (
        <div className="absolute inset-0 rounded-2xl bg-black/30 backdrop-blur-sm" aria-label="Loading" />
      )}
    </div>
  );
}
