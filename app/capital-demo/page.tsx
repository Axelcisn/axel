"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useCapitalLiveQuote } from "@/lib/hooks/useCapitalLiveQuote";
import type { CapitalMarketSearchItem } from "@/lib/marketData/capital";

type DiagnoseResponse = {
  baseUrl: string;
  hasApiKey: boolean;
  apiKeyLen: number;
  apiKeyLast4: string | null;
  hasIdentifier: boolean;
  hasPassword: boolean;
  encryptionKeyCheck: { status: number | null; ok: boolean; bodySnippet: string };
  hints?: string[];
  checks?: {
    demo?: { status: number | null; ok: boolean };
    live?: { status: number | null; ok: boolean };
  };
};

function debounce<T extends (...args: any[]) => void>(fn: T, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

export default function CapitalDemoPage() {
  const defaultEpic = useMemo(() => "OIL_CRUDE", []);
  const [epic, setEpic] = useState(defaultEpic);

  const [diagnose, setDiagnose] = useState<DiagnoseResponse | null>(null);
  const [diagnoseError, setDiagnoseError] = useState<string | null>(null);
  const [diagnoseLoading, setDiagnoseLoading] = useState<boolean>(true);
  const [sessionTestResult, setSessionTestResult] = useState<{ ok: boolean; status: number; bodySnippet?: string } | null>(null);
  const [sessionTestLoading, setSessionTestLoading] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<CapitalMarketSearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchInflight = useRef<AbortController | null>(null);

  const { data, error, loading } = useCapitalLiveQuote(epic, 3000);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/capital/diagnose", { cache: "no-store" });
        const json = (await res.json()) as DiagnoseResponse;
        if (!res.ok) {
          throw new Error(json as any);
        }
        if (alive) {
          setDiagnose(json);
          setDiagnoseError(null);
        }
      } catch (err: any) {
        if (alive) {
          setDiagnose(null);
          setDiagnoseError(err?.message || "Failed to diagnose Capital.com setup");
        }
      } finally {
        if (alive) {
          setDiagnoseLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const ready = diagnose?.encryptionKeyCheck?.ok === true;
  const readyAny = ready || diagnose?.checks?.demo?.ok || diagnose?.checks?.live?.ok;

  const runSessionTest = async () => {
    setSessionTestLoading(true);
    setSessionTestResult(null);
    try {
      const res = await fetch("/api/capital/session-test", { cache: "no-store" });
      const json = await res.json();
      setSessionTestResult(json);
    } catch (err: any) {
      setSessionTestResult({ ok: false, status: 500, bodySnippet: err?.message });
    } finally {
      setSessionTestLoading(false);
    }
  };

  const doSearch = useMemo(
    () =>
      debounce(async (term: string) => {
        if (!term.trim()) {
          setSearchResults([]);
          setSearchError(null);
          setSearchLoading(false);
          return;
        }
        setSearchLoading(true);
        setSearchError(null);
        try {
          if (searchInflight.current) {
            searchInflight.current.abort();
          }
          const controller = new AbortController();
          searchInflight.current = controller;
          const res = await fetch(`/api/capital/markets?searchTerm=${encodeURIComponent(term)}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          const json = await res.json();
          if (!res.ok) {
            throw new Error(json?.message || `HTTP ${res.status}`);
          }
          setSearchResults(Array.isArray(json) ? json : []);
        } catch (err: any) {
          setSearchError(err?.message || "Search failed");
          setSearchResults([]);
        } finally {
          setSearchLoading(false);
        }
      }, 300),
    []
  );

  useEffect(() => {
    doSearch(searchTerm);
  }, [searchTerm, doSearch]);

  return (
    <div className="p-6 max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">Capital.com DEMO — Live Quote</h1>

      <div className="border rounded p-4 bg-slate-50 text-slate-900">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Setup status</div>
          <div className={`text-sm font-medium ${ready ? "text-green-600" : "text-amber-600"}`}>
            {diagnoseLoading ? "Checking…" : ready ? "Ready" : "Needs attention"}
          </div>
        </div>
        {diagnoseLoading && (
          <p className="mt-2 text-sm text-slate-600">Validating API key and credentials…</p>
        )}
        {!diagnoseLoading && diagnoseError && (
          <p className="mt-2 text-sm text-red-600">{diagnoseError}</p>
        )}
        {!diagnoseLoading && diagnose && !ready && (
          <div className="mt-2 space-y-2 text-sm text-slate-800">
            <p className="font-medium text-red-600">API key invalid or missing.</p>
            <p>Encryption key check: status {diagnose.encryptionKeyCheck.status}, ok={String(diagnose.encryptionKeyCheck.ok)}</p>
            {diagnose.hints?.length ? (
              <ul className="list-disc list-inside space-y-1">
                {diagnose.hints.map((h, idx) => (
                  <li key={idx}>{h}</li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-700">No hints available. Verify env vars and restart dev server.</p>
            )}
          </div>
        )}
        {!diagnoseLoading && diagnose && readyAny && (
          <div className="mt-2 text-sm text-green-700 space-y-1">
            <div>API key accepted. Base URL: {diagnose.baseUrl}</div>
            <div className="flex gap-2 items-center">
              <button
                onClick={runSessionTest}
                className="px-3 py-1 text-sm border border-slate-300 rounded-md hover:bg-slate-100"
                disabled={sessionTestLoading}
              >
                {sessionTestLoading ? "Testing…" : "Session test"}
              </button>
              {sessionTestResult && (
                <span className={`text-sm ${sessionTestResult.ok ? "text-green-700" : "text-red-600"}`}>
                  {sessionTestResult.ok ? `OK (${sessionTestResult.status})` : `Fail (${sessionTestResult.status})`}
                  {sessionTestResult.bodySnippet ? ` – ${sessionTestResult.bodySnippet}` : ""}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 items-center">
        <label className="text-sm opacity-80">EPIC</label>
        <input
          className="border rounded px-2 py-1 w-full"
          value={epic}
          onChange={(e) => setEpic(e.target.value)}
          placeholder="e.g. OIL_CRUDE"
        />
      </div>

      {readyAny && (
        <div className="border rounded p-4 space-y-3">
          <div>
            <label className="text-sm font-medium">Market search</label>
            <input
              className="border rounded px-2 py-1 w-full mt-1"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="e.g., oil, sp500, eurusd"
            />
            {searchLoading && <div className="text-xs text-slate-500 mt-1">Searching…</div>}
            {searchError && <div className="text-xs text-red-600 mt-1">{searchError}</div>}
            {searchResults.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm">
                {searchResults.map((r) => (
                  <li
                    key={r.epic}
                    className="border border-slate-200 rounded px-2 py-1 hover:bg-slate-100 cursor-pointer"
                    onClick={() => setEpic(r.epic)}
                  >
                    <div className="font-semibold">{r.instrumentName || r.epic}</div>
                    <div className="text-xs text-slate-600">{r.epic} · {r.instrumentType} · {r.marketStatus}</div>
                    <div className="text-xs text-slate-600">
                      bid: {r.bid ?? "—"} · offer: {r.offer ?? "—"} {r.currency ? `· ${r.currency}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

        <div className="border rounded p-4">
          {loading && <div className="text-sm opacity-80">Loading…</div>}
          {error && <div className="text-sm text-red-600">{error}</div>}

          {data && (
            <div className="space-y-2">
              <div className="text-sm opacity-80">epic: {data.epic}</div>
              <div className="text-2xl font-semibold">
                mid: {data.mid ?? "—"}
              </div>
              <div className="text-sm">
                bid: {data.bid ?? "—"} &nbsp;|&nbsp; ask: {data.ask ?? "—"}
              </div>
              <div className="text-xs opacity-70">
                asOf: {data.asOf ?? "—"} • source: {data.source}
              </div>
            </div>
          )}
        </div>
        </div>
      )}
    </div>
  );
}
