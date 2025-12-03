'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDarkMode } from '@/lib/hooks/useDarkMode';

export default function Navigation() {
  const pathname = usePathname();
  const isDarkMode = useDarkMode();

  const navItems = [
    { href: '/', label: 'Home' },
    { href: '/analysis', label: 'Analysis' },
    { href: '/memory', label: 'Memory' },
    { href: '/watchlist', label: 'Watchlist' },
  ];

  return (
    <nav className={`shadow-sm border-b ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
      <div className="w-full px-[5%]">
        <div className="flex justify-between items-center h-12">
          <Link href="/" className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
            Axel
          </Link>
          
          <div className="flex space-x-8">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`text-sm font-medium transition-colors hover:text-blue-500 ${
                  pathname === item.href
                    ? 'text-blue-500 border-b-2 border-blue-500 pb-1'
                    : isDarkMode ? 'text-gray-300' : 'text-gray-600'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}