'use client';

import { useEffect, useMemo, useState } from 'react';
import { MarketSessionBadge } from '@/components/MarketSessionBadge';
import BiasedMetricsTable from '@/components/timing/BiasedMetricsTable';
import { useLiveQuote } from '@/lib/hooks/useLiveQuote';
import { useYahooCandles, type YahooCandle } from '@/lib/hooks/useYahooCandles';
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

  const [intervalIds, setIntervalIds] = useState({
    interval1: '1m',
    interval2: '15m',
    interval3: '1h',
  });

  const rangeDays = 30;
  const yahooInterval = (id: string) => {
    if (id === '1h') return '60m';
    return id;
  };

  const { candles: candles1, error: candles1Error } = useYahooCandles(
    symbol,
    yahooInterval(intervalIds.interval1),
    rangeDays
  );
  const { candles: candles2, error: candles2Error } = useYahooCandles(
    symbol,
    yahooInterval(intervalIds.interval2),
    rangeDays
  );
  const { candles: candles3, error: candles3Error } = useYahooCandles(
    symbol,
    yahooInterval(intervalIds.interval3),
    rangeDays
  );

  const mapCandles = (candles: YahooCandle[] | null) =>
    candles?.map((c) => ({
      time: c.t,
      open: c.o,
      high: c.h,
      low: c.l,
      close: c.c,
      volume: c.v,
    })) ?? undefined;

  const devDebug = useMemo(() => {
    if (process.env.NODE_ENV !== 'development') return null;
    const summarize = (cs: YahooCandle[] | null | undefined) => {
      if (!cs || cs.length === 0) return { len: 0, first: null, last: null };
      return { len: cs.length, first: cs[0]?.t ?? null, last: cs[cs.length - 1]?.t ?? null };
    };
    return {
      i1: summarize(candles1),
      i2: summarize(candles2),
      i3: summarize(candles3),
    };
  }, [candles1, candles2, candles3]);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if ((candles1 && candles1.length === 0) || (candles2 && candles2.length === 0) || (candles3 && candles3.length === 0)) {
      // eslint-disable-next-line no-console
      console.warn('Empty candles', {
        symbol,
        intervalIds,
        errors: { candles1Error, candles2Error, candles3Error },
      });
    }
  }, [candles1, candles2, candles3, candles1Error, candles2Error, candles3Error, symbol, intervalIds]);

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
        {process.env.NODE_ENV === 'development' && devDebug && (
          <div className="mb-3 rounded-lg border border-slate-800/80 bg-slate-950/80 px-3 py-2 text-[11px] text-slate-400">
            <div className="space-x-3">
              <span>
                {intervalIds.interval1}: {devDebug.i1.len} candles (first: {devDebug.i1.first ?? '—'} last: {devDebug.i1.last ?? '—'})
              </span>
              <span className="text-slate-500">|</span>
              <span>
                {intervalIds.interval2}: {devDebug.i2.len} candles (first: {devDebug.i2.first ?? '—'} last: {devDebug.i2.last ?? '—'})
              </span>
              <span className="text-slate-500">|</span>
              <span>
                {intervalIds.interval3}: {devDebug.i3.len} candles (first: {devDebug.i3.first ?? '—'} last: {devDebug.i3.last ?? '—'})
              </span>
            </div>
          </div>
        )}
        <BiasedMetricsTable
          interval1Candles={mapCandles(candles1)}
          interval2Candles={mapCandles(candles2)}
          interval3Candles={mapCandles(candles3)}
          onIntervalsChange={(value) => {
            setIntervalIds({
              interval1: value.interval1.id,
              interval2: value.interval2.id,
              interval3: value.interval3.id,
            });
          }}
        />
      </div>
    </div>
  );
}
