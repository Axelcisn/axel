import {
  PortfolioBalance,
  PortfolioDataResponse,
  PortfolioEquitySeries,
  PortfolioOrder,
  PortfolioPosition,
  PortfolioSummary,
  PortfolioTab,
  PortfolioTrade,
} from './types';

type FetchResult<T> = {
  data: T | null;
  error?: string;
};

async function fetchJson<T>(path: string): Promise<FetchResult<T>> {
  try {
    const res = await fetch(path, { cache: 'no-store' });

    if (!res.ok) {
      let errorMessage = `Request failed with status ${res.status}`;
      const raw = await res.text().catch(() => '');

      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { error?: string };
          if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') {
            errorMessage = parsed.error;
          } else {
            errorMessage = raw.slice(0, 200);
          }
        } catch {
          errorMessage = raw.slice(0, 200);
        }
      }

      return { data: null, error: errorMessage };
    }

    const json = (await res.json()) as T;
    return { data: json };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

function unwrapObject<T>(payload: unknown, key: string): T | null {
  if (!payload || Array.isArray(payload)) return null;
  if (typeof payload === 'object') {
    if (key in payload) {
      const value = (payload as Record<string, unknown>)[key];
      if (value) return value as T;
      return null;
    }
    return payload as T;
  }
  return null;
}

function unwrapArray<T>(payload: unknown, key: string): T[] | null {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const value = (payload as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      return value as T[];
    }
  }
  return null;
}

function baseState(tab: PortfolioTab): PortfolioDataResponse {
  switch (tab) {
    case 'orders':
      return { orders: [] };
    case 'trades':
      return { trades: [] };
    case 'balances':
      return { balances: [] };
    case 'positions':
    default:
      return { positions: [], summary: undefined };
  }
}

export async function fetchPortfolioEquitySeries(): Promise<PortfolioEquitySeries> {
  const { data } = await fetchJson<
    PortfolioEquitySeries | { equity?: PortfolioEquitySeries; series?: PortfolioEquitySeries }
  >('/api/ibkr/equity');

  if (!data) return [];

  const series =
    unwrapArray<PortfolioEquitySeries[number]>(data, 'equity') ??
    unwrapArray<PortfolioEquitySeries[number]>(data, 'series') ??
    (Array.isArray(data) ? (data as PortfolioEquitySeries) : null);

  return series ?? [];
}

export async function fetchPortfolioData(tab: PortfolioTab): Promise<PortfolioDataResponse> {
  if (tab === 'positions') {
    const base = baseState(tab);
    const [summaryRes, positionsRes] = await Promise.all([
      fetchJson<{ summary?: PortfolioSummary } | PortfolioSummary>('/api/ibkr/summary'),
      fetchJson<{ positions?: PortfolioPosition[] } | PortfolioPosition[]>('/api/ibkr/positions'),
    ]);

    const summary = unwrapObject<PortfolioSummary>(summaryRes.data, 'summary');
    const positions = unwrapArray<PortfolioPosition>(positionsRes.data, 'positions') ?? [];

    const hasError = summaryRes.error || positionsRes.error;
    const result: PortfolioDataResponse = {
      ...base,
      summary: summary ?? undefined,
      positions,
    };

    if (hasError) {
      result.error = summaryRes.error ?? positionsRes.error;
    }

    return result;
  }

  if (tab === 'orders') {
    const { data, error } = await fetchJson<{ orders?: PortfolioOrder[] } | PortfolioOrder[]>('/api/ibkr/orders');
    const orders = unwrapArray<PortfolioOrder>(data, 'orders') ?? [];
    return { orders, error };
  }

  if (tab === 'trades') {
    const { data, error } = await fetchJson<{ trades?: PortfolioTrade[] } | PortfolioTrade[]>('/api/ibkr/trades');
    const trades = unwrapArray<PortfolioTrade>(data, 'trades') ?? [];
    return { trades, error };
  }

  if (tab === 'balances') {
    const { data, error } = await fetchJson<{ balances?: PortfolioBalance[] } | PortfolioBalance[]>(
      '/api/ibkr/balances',
    );
    const balances = unwrapArray<PortfolioBalance>(data, 'balances') ?? [];
    return { balances, error };
  }

  return baseState(tab);
}
