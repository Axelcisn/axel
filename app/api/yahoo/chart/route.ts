import { NextResponse } from 'next/server';

type YahooChartResult = {
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      close?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
  };
};

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

type CachedEntry = {
  expires: number;
  promise: Promise<NextResponse>;
};

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CachedEntry>();

const nowSec = () => Math.floor(Date.now() / 1000);
const YAHOO_INTERVALS = new Set([
  '1m',
  '2m',
  '5m',
  '15m',
  '30m',
  '60m',
  '90m',
  '1h',
  '1d',
  '5d',
  '1wk',
  '1mo',
  '3mo',
]);
const normalizeInterval = (interval: string | null) => {
  if (!interval) return '1m';
  if (interval === '1w') return '1wk';
  if (interval === '1h') return '60m';
  return interval;
};

const fetchYahooChunk = async (ticker: string, interval: string, period1: number, period2: number) => {
  const params = new URLSearchParams({
    interval,
    period1: String(period1),
    period2: String(period2),
    includePrePost: 'false',
    events: 'div,splits',
  });

  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${params.toString()}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
    },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Yahoo fetch failed ${res.status}: ${text}`);
  }

  const data = await res.json();
  const chart: YahooChartResult | undefined = data?.chart?.result?.[0];
  if (!chart?.timestamp || !chart.indicators?.quote?.[0]) {
    const errMsg = data?.chart?.error?.description ?? 'No chart result';
    throw new Error(errMsg);
  }

  const quote = chart.indicators.quote[0];
  const candles: Candle[] = [];
  chart.timestamp.forEach((ts, idx) => {
    const c = quote.close?.[idx];
    const o = quote.open?.[idx];
    const h = quote.high?.[idx];
    const l = quote.low?.[idx];
    const v = quote.volume?.[idx];
    if (c == null || !Number.isFinite(c)) return;
    candles.push({
      t: ts,
      o: Number(o ?? c),
      h: Number(h ?? c),
      l: Number(l ?? c),
      c: Number(c),
      v: Number.isFinite(v ?? null) ? Number(v ?? 0) : 0,
    });
  });

  return candles;
};

const mergeCandles = (chunks: Candle[][]) => {
  const byTs = new Map<number, Candle>();
  chunks.flat().forEach((c) => {
    if (!byTs.has(c.t)) byTs.set(c.t, c);
  });
  return Array.from(byTs.values()).sort((a, b) => a.t - b.t);
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get('ticker');
  const rawInterval = searchParams.get('interval');
  const interval = normalizeInterval(rawInterval);
  const rangeDays = Number(searchParams.get('rangeDays') ?? '30');

  if (!ticker) {
    return NextResponse.json({ error: 'ticker required' }, { status: 400 });
  }
  if (!YAHOO_INTERVALS.has(interval)) {
    const allowed = Array.from(YAHOO_INTERVALS).join(', ');
    const label = rawInterval ?? interval;
    return NextResponse.json(
      { error: `Invalid interval '${label}'. Allowed: ${allowed}` },
      { status: 400 }
    );
  }

  const cacheKey = `${ticker}|${interval}|${rangeDays}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.promise;
  }

  const doFetch = async () => {
    try {
      let effectiveRange = rangeDays;
      const now = nowSec();
      const chunks: Candle[][] = [];

      if (interval === '1m') {
        const maxDays = Math.min(rangeDays, 7);
        effectiveRange = maxDays;
        const params = new URLSearchParams({
          interval,
          range: `${maxDays}d`,
          includePrePost: 'false',
          events: 'div,splits',
        });
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${params.toString()}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          next: { revalidate: 0 },
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Yahoo fetch failed ${res.status}: ${text}`);
        }
        const data = await res.json();
        const chart: YahooChartResult | undefined = data?.chart?.result?.[0];
        if (!chart?.timestamp || !chart.indicators?.quote?.[0]) {
          const errMsg = data?.chart?.error?.description ?? 'No chart result';
          throw new Error(errMsg);
        }
        const quote = chart.indicators.quote[0];
        const candles: Candle[] = [];
        chart.timestamp.forEach((ts, idx) => {
          const c = quote.close?.[idx];
          const o = quote.open?.[idx];
          const h = quote.high?.[idx];
          const l = quote.low?.[idx];
          const v = quote.volume?.[idx];
          if (c == null || !Number.isFinite(c)) return;
          candles.push({
            t: ts,
            o: Number(o ?? c),
            h: Number(h ?? c),
            l: Number(l ?? c),
            c: Number(c),
            v: Number.isFinite(v ?? null) ? Number(v ?? 0) : 0,
          });
        });
        chunks.push(candles);
      } else {
        if ((interval.endsWith('m') || interval.endsWith('h')) && rangeDays > 60) {
          effectiveRange = 60;
        }
        const params = new URLSearchParams({
          interval,
          range: `${effectiveRange}d`,
          includePrePost: 'false',
          events: 'div,splits',
        });
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?${params.toString()}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          next: { revalidate: 0 },
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Yahoo fetch failed ${res.status}: ${text}`);
        }
        const data = await res.json();
        const chart: YahooChartResult | undefined = data?.chart?.result?.[0];
        if (!chart?.timestamp || !chart.indicators?.quote?.[0]) {
          const errMsg = data?.chart?.error?.description ?? 'No chart result';
          throw new Error(errMsg);
        }
        const quote = chart.indicators.quote[0];
        const candles: Candle[] = [];
        chart.timestamp.forEach((ts, idx) => {
          const c = quote.close?.[idx];
          const o = quote.open?.[idx];
          const h = quote.high?.[idx];
          const l = quote.low?.[idx];
          const v = quote.volume?.[idx];
          if (c == null || !Number.isFinite(c)) return;
          candles.push({
            t: ts,
            o: Number(o ?? c),
            h: Number(h ?? c),
            l: Number(l ?? c),
            c: Number(c),
            v: Number.isFinite(v ?? null) ? Number(v ?? 0) : 0,
          });
        });
        chunks.push(candles);
      }

      const merged = mergeCandles(chunks);
      if (process.env.NODE_ENV === 'development') {
        const firstTs = merged[0]?.t ?? null;
        const lastTs = merged[merged.length - 1]?.t ?? null;
        // eslint-disable-next-line no-console
        console.log(
          `[yahoo/chart] ${ticker} ${interval} | candles=${merged.length} rangeDays=${rangeDays} effective=${effectiveRange} first=${firstTs} last=${lastTs}`
        );
      }
      return NextResponse.json({ candles: merged, effectiveRangeDays: effectiveRange });
    } catch (error: any) {
      return NextResponse.json({ error: error?.message ?? 'Unknown error' }, { status: 500 });
    }
  };

  const promise = doFetch();
  cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, promise });
  return promise;
}
