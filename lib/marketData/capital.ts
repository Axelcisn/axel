// Server-side Capital.com DEMO market data helper.
// Manages session tokens (CST + X-SECURITY-TOKEN) with a short-lived cache
// and exposes a typed quote fetcher.

type SessionTokens = {
  cst: string;
  securityToken: string;
  expiresAtMs: number;
};

export type CapitalQuote = {
  epic: string;
  bid: number | null;
  ask: number | null; // aka offer
  mid: number | null;
  asOf: string | null;
  source: "capital";
};

export type CapitalMarketSearchItem = {
  epic: string;
  instrumentName: string;
  instrumentType: string;
  marketStatus: string;
  bid: number | null;
  offer: number | null;
  currency?: string | null;
  updateTimeUTC?: string | null;
};

const BASE_URL =
  process.env.CAPITAL_API_BASE_URL ?? "https://demo-api-capital.backend-capital.com";

const API_KEY = process.env.CAPITAL_API_KEY;
const IDENTIFIER = process.env.CAPITAL_IDENTIFIER;
const PASSWORD = process.env.CAPITAL_PASSWORD;

// 10 min session per docs. Use a buffer so we refresh before expiry.
const SESSION_TTL_MS = 9 * 60 * 1000;

let cachedSession: SessionTokens | null = null;
let inflightSession: Promise<SessionTokens> | null = null;

function requireEnv(name: string, v: string | undefined): string {
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

function toNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = 12_000
) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function createSession(): Promise<SessionTokens> {
  const apiKey = requireEnv("CAPITAL_API_KEY", API_KEY);
  const identifier = requireEnv("CAPITAL_IDENTIFIER", IDENTIFIER);
  const password = requireEnv("CAPITAL_PASSWORD", PASSWORD);

  const url = `${BASE_URL}/api/v1/session`;

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-CAP-API-KEY": apiKey,
    },
    body: JSON.stringify({
      identifier,
      password,
      encryptedPassword: false,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const snippet = text.length > 300 ? text.slice(0, 300) + "..." : text;
    throw new Error(
      `Capital session failed: status=${res.status} ${res.statusText}; base=${BASE_URL}; body=${snippet}`
    );
  }

  // Tokens are returned in headers
  const cst = res.headers.get("CST");
  const securityToken = res.headers.get("X-SECURITY-TOKEN");

  if (!cst || !securityToken) {
    throw new Error("Capital session created but CST / X-SECURITY-TOKEN headers are missing.");
  }

  return {
    cst,
    securityToken,
    expiresAtMs: Date.now() + SESSION_TTL_MS,
  };
}

async function getSession(): Promise<SessionTokens> {
  const now = Date.now();
  if (cachedSession && now < cachedSession.expiresAtMs) return cachedSession;

  if (!inflightSession) {
    inflightSession = createSession().finally(() => {
      inflightSession = null;
    });
  }

  cachedSession = await inflightSession;
  return cachedSession;
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const session = await getSession();
  const url = `${BASE_URL}${path}`;

  return fetchWithTimeout(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      CST: session.cst,
      "X-SECURITY-TOKEN": session.securityToken,
    },
    cache: "no-store",
  });
}

function extractBidAskAndTime(details: any): {
  bid: number | null;
  ask: number | null;
  asOf: string | null;
} {
  // Try IG-like snapshot shape first, then fall back to top-level
  const snap = details?.snapshot ?? details ?? {};

  const bid = toNumber(snap?.bid ?? snap?.bidPrice ?? snap?.bidPrice?.bid);
  const ask = toNumber(
    snap?.offer ?? snap?.ask ?? snap?.ofr ?? snap?.offerPrice ?? snap?.offerPrice?.ask
  );

  const asOf =
    (typeof snap?.updateTimeUTC === "string" && snap.updateTimeUTC) ||
    (typeof snap?.updateTime === "string" && snap.updateTime) ||
    (typeof snap?.snapshotTimeUTC === "string" && snap.snapshotTimeUTC) ||
    (typeof snap?.snapshotTime === "string" && snap.snapshotTime) ||
    null;

  return { bid, ask, asOf };
}

export async function getCapitalQuote(epic: string): Promise<CapitalQuote> {
  // Primary: market details (usually has current bid/offer)
  const res = await authedFetch(`/api/v1/markets/${encodeURIComponent(epic)}`, {
    method: "GET",
  });

  // If session expired unexpectedly, refresh once and retry
  if (res.status === 401) {
    cachedSession = null;
    const retry = await authedFetch(`/api/v1/markets/${encodeURIComponent(epic)}`, {
      method: "GET",
    });
    if (!retry.ok) {
      const text = await retry.text().catch(() => "");
      throw new Error(
        `Capital markets fetch failed after retry: ${retry.status} ${retry.statusText} ${text}`
      );
    }
    const details = await retry.json();
    const { bid, ask, asOf } = extractBidAskAndTime(details);
    const mid = bid != null && ask != null ? (bid + ask) / 2 : null;
    return { epic, bid, ask, mid, asOf, source: "capital" };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Capital markets fetch failed: ${res.status} ${res.statusText} ${text}`);
  }

  const details = await res.json();
  const { bid, ask, asOf } = extractBidAskAndTime(details);
  const mid = bid != null && ask != null ? (bid + ask) / 2 : null;

  // If parsing fails, make it obvious (so we can adjust extractor quickly)
  if (bid == null && ask == null) {
    throw new Error(`Could not parse bid/ask from /markets response for epic=${epic}`);
  }

  return { epic, bid, ask, mid, asOf, source: "capital" };
}

export async function searchCapitalMarkets(
  searchTerm: string,
  limit = 20
): Promise<CapitalMarketSearchItem[]> {
  const trimmed = searchTerm.trim();
  if (!trimmed) return [];

  const res = await authedFetch(
    `/api/v1/markets?searchTerm=${encodeURIComponent(trimmed)}&max=${limit}`,
    { method: "GET" }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const snippet = text.length > 300 ? text.slice(0, 300) + "..." : text;
    throw new Error(
      `Capital market search failed: status=${res.status} ${res.statusText}; body=${snippet}`
    );
  }

  const data = await res.json();
  const markets = Array.isArray(data?.markets) ? data.markets : [];

  return markets.slice(0, limit).map((m: any) => ({
    epic: String(m.epic ?? "").trim(),
    instrumentName: String(m.instrumentName ?? "").trim(),
    instrumentType: String(m.instrumentType ?? "").trim(),
    marketStatus: String(m.marketStatus ?? "").trim(),
    bid: toNumber(m.snapshot?.bid ?? m.bid),
    offer: toNumber(m.snapshot?.offer ?? m.offer),
    currency: m.currency ?? m.snapshot?.currency ?? null,
    updateTimeUTC:
      (typeof m.snapshot?.updateTimeUTC === "string" && m.snapshot.updateTimeUTC) ||
      (typeof m.updateTimeUTC === "string" && m.updateTimeUTC) ||
      null,
  }));
}
