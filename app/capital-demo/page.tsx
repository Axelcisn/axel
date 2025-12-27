"use client";

import { useMemo, useState } from "react";
import { useCapitalLiveQuote } from "@/lib/hooks/useCapitalLiveQuote";

export default function CapitalDemoPage() {
  const defaultEpic = useMemo(() => "OIL_CRUDE", []);
  const [epic, setEpic] = useState(defaultEpic);

  const { data, error, loading } = useCapitalLiveQuote(epic, 3000);

  return (
    <div className="p-6 max-w-xl">
      <h1 className="text-xl font-semibold">Capital.com DEMO — Live Quote</h1>

      <div className="mt-4 flex gap-2 items-center">
        <label className="text-sm opacity-80">EPIC</label>
        <input
          className="border rounded px-2 py-1 w-full"
          value={epic}
          onChange={(e) => setEpic(e.target.value)}
          placeholder="e.g. OIL_CRUDE"
        />
      </div>

      <div className="mt-4 border rounded p-4">
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
  );
}
