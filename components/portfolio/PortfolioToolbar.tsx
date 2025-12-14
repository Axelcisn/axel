import { CONTROL_BG, CONTROL_BORDER, CONTROL_TEXT, HEADER_BG } from './portfolioTheme';

interface PortfolioToolbarProps {
  viewMode: string;
  sortMode: string;
  searchTerm: string;
  onViewModeChange: (value: string) => void;
  onSortModeChange: (value: string) => void;
  onSearchChange: (value: string) => void;
}

export default function PortfolioToolbar({
  viewMode,
  sortMode,
  searchTerm,
  onViewModeChange,
  onSortModeChange,
  onSearchChange,
}: PortfolioToolbarProps) {
  const controlBase = `${CONTROL_BG} ${CONTROL_BORDER} ${CONTROL_TEXT} h-10 rounded-full px-4 pr-12 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 appearance-none bg-[#1f1f23] shadow-inner shadow-black/30`;
  const iconBase = `${CONTROL_BG} ${CONTROL_BORDER} rounded-full w-10 h-10 grid place-items-center text-white/70 transition hover:bg-white/10`;
  const optionStyle: React.CSSProperties = { backgroundColor: '#111', color: '#f8fafc' };
  const viewOptions = [
    { value: 'default', label: 'Portfolio View' },
    { value: 'intraday', label: 'Intraday Focus' },
    { value: 'margin', label: 'Margin Safety' },
  ];
  const sortOptions = [
    { value: 'alphabetical', label: 'Strategy Sort Alphabetical' },
    { value: 'pnl', label: 'Strategy Sort Daily P&L' },
    { value: 'size', label: 'Strategy Sort Position Size' },
  ];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <div className="relative">
          <select
            value={viewMode}
            onChange={(e) => onViewModeChange(e.target.value)}
            className={`${controlBase} min-w-[180px]`}
          >
            {viewOptions.map((opt) => (
              <option key={opt.value} value={opt.value} style={optionStyle}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/60">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
            </svg>
          </span>
        </div>
        <div className="relative">
          <select
            value={sortMode}
            onChange={(e) => onSortModeChange(e.target.value)}
            className={`${controlBase} min-w-[240px]`}
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value} style={optionStyle}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/60">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
            </svg>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter symbols"
            className={`${controlBase} w-48 pl-9`}
          />
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/50">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <circle cx="11" cy="11" r="7" />
              <path strokeLinecap="round" d="m16.5 16.5 4 4" />
            </svg>
          </span>
        </div>
        <button type="button" className={iconBase} aria-label="Filter">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16M7 12h10M10 19h4" />
          </svg>
        </button>
        <button type="button" className={iconBase} aria-label="Settings">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.065Z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
        </button>
        <button type="button" className={iconBase} aria-label="More">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
            <circle cx="5" cy="12" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
