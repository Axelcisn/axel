'use client';

import { useEffect, useMemo, useState } from 'react';
import { MarketSessionBadge } from '@/components/MarketSessionBadge';
import BiasedMetricsTable from '@/components/timing/BiasedMetricsTable';
import { useLiveQuote } from '@/lib/hooks/useLiveQuote';
import { CompanyInfo } from '@/lib/types/company';

type TimingPageProps = {
  params: {
    ticker: string;
  };
};

export default function TimingPage({ params }: TimingPageProps) {
  const symbol = params.ticker;
  const { quote } = useLiveQuote(symbol, { pollMs: 3000 });

  const [companyName, setCompanyName] = useState<string>('');
  const [exchange, setExchange] = useState<string>('—');

  useEffect(() => {
    const loadCompanyInfo = async () => {
      try {
        const response = await fetch(`/api/companies?ticker=${symbol}`);
        if (!response.ok) return;
        const company: CompanyInfo = await response.json();
        setCompanyName(company.name || '');
        setExchange(
          (company as any).exchange ??
            (company as any)?.exchangeInfo?.primaryExchange ??
            '—'
        );
      } catch {
        // ignore fetch errors; fallback to defaults
      }
    };
    loadCompanyInfo();
  }, [symbol]);

  const priceValue = quote?.price ?? null;
  const priceDisplay = priceValue != null ? priceValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
  const changeValue = quote?.change ?? null;
  const changePctValue = quote?.changePct ?? null;

  const changeColor = changeValue == null ? 'text-slate-400' : changeValue >= 0 ? 'text-emerald-400' : 'text-rose-400';
  const changeDisplay = changeValue != null ? `${changeValue >= 0 ? '+' : ''}${changeValue.toFixed(2)}` : '—';
  const changePctDisplay = changePctValue != null ? `${changePctValue >= 0 ? '+' : ''}${changePctValue.toFixed(2)}%` : null;

  const headerTimestamp = quote?.asOf ?? null;
  const headerTimestampDisplay = useMemo(() => {
    if (!headerTimestamp) return null;
    const parsed = Date.parse(headerTimestamp);
    if (Number.isNaN(parsed)) return headerTimestamp;
    return new Date(parsed).toLocaleString();
  }, [headerTimestamp]);

  const tickerDisplay = symbol.toUpperCase();

  return (
    <div className="bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between px-6 py-10 md:px-10">
        <div className="space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight text-white">
            {companyName || '—'}
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-700/30 bg-transparent px-3 py-1 text-slate-200">
              <span className="font-medium">{tickerDisplay}</span>
              <span className="text-slate-500">·</span>
              <span>{exchange}</span>
            </div>
            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-200">
              Overnight
            </span>
            <MarketSessionBadge symbol={symbol} />
          </div>
          <div className="flex flex-wrap items-baseline gap-3">
            <div className="flex items-baseline gap-2">
              <span className="text-5xl md:text-6xl font-semibold tracking-tight text-slate-100">
                {priceDisplay}
              </span>
              <span className="text-sm uppercase text-slate-400">USD</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className={`text-xl font-semibold ${changeColor}`}>
                {changeDisplay}
              </span>
              {changePctDisplay && (
                <span className={`text-xl font-semibold ${changeColor}`}>
                  {changePctDisplay}
                </span>
              )}
            </div>
          </div>
          {headerTimestampDisplay && (
            <p className="text-xs text-slate-500">
              As of {headerTimestampDisplay}
            </p>
          )}
        </div>

        <div className="hidden md:flex items-center justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="h-8 w-8"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
      </div>
      <div className="mx-auto mt-4 w-full max-w-[1400px] px-6 pb-12 md:px-10">
        <BiasedMetricsTable />
      </div>
    </div>
  );
}
