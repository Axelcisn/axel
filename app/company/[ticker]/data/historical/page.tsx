// app/company/[ticker]/data/historical/page.tsx
"use client";
import { useEffect, useState, useCallback } from "react";
import DataTable from "@/app/components/DataTable";
import { UploadBox } from "@/app/components/UploadBox";

type Payload = { columns: string[]; rows: Record<string, any>[] };

export default function HistoricalPage({ params }: { params: { ticker: string }}) {
  const t = params.ticker.toUpperCase();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/catalog/latest?dataset=hist_price&ticker=${t}`, { cache: "no-store" });
    if (res.ok) setData(await res.json());
    else setData(null);
    setLoading(false);
  }, [t]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="text-sm text-gray-500 mb-2">Search › {t} › Data › Historical</div>
      <h1 className="text-3xl font-bold mb-4">{t} — Historical</h1>

      {!data && !loading && (
        <div className="space-y-6">
          <p className="text-gray-600">
            No historical file yet. Upload a CSV with a <code>Date</code> column. The table will render newest first.
          </p>
          <UploadBox dataset="hist_price" ticker={t} onUploaded={load} />
        </div>
      )}

      {loading && <div className="text-gray-500">Loading…</div>}

      {data && !loading && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="text-gray-600">Rendering newest to oldest. Columns are exactly as in your file (no derived columns).</div>
            <UploadBox dataset="hist_price" ticker={t} onUploaded={load} />
          </div>
          <DataTable columns={data.columns} rows={data.rows} defaultSortKey="Date" defaultSortDesc />
        </div>
      )}
    </div>
  );
}