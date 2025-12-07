'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface CompanySubnavProps {
  ticker: string;
}

const navItems = [
  { label: 'Timing', href: 'timing' },
  { label: 'Trend', href: 'trend' },
];

export default function CompanySubnav({ ticker }: CompanySubnavProps) {
  const pathname = usePathname();
  
  // Determine active tab based on current path
  const activeTab = navItems.find(item => pathname?.includes(`/${item.href}`))?.href || 'timing';

  return (
    <div className="flex items-center gap-1 rounded-lg bg-slate-800/50 p-1">
      {navItems.map((item) => {
        const isActive = activeTab === item.href;
        const href = `/company/${ticker}/${item.href}`;
        
        return (
          <Link
            key={item.href}
            href={href}
            className={`
              px-4 py-1.5 text-sm font-medium rounded-md transition-all
              ${isActive 
                ? 'bg-slate-700 text-white shadow-sm' 
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
              }
            `}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
