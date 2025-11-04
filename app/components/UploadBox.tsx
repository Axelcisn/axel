// app/components/UploadBox.tsx
"use client";
import { useRef, useState } from "react";

export function UploadBox({ dataset, ticker, onUploaded }: {
  dataset: string; ticker: string; onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/catalog/upload?dataset=${dataset}&ticker=${ticker}`, {
        method: "POST",
        body: fd
      });
      if (!res.ok) throw new Error(await res.text());
      onUploaded();
    } catch (e: any) {
      setErr(e.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-2 border-dashed rounded-2xl p-8 text-center">
      <p className="mb-3">Upload CSV (with a <code>Date</code> column). Newest rows will appear first.</p>
      <div className="flex justify-center">
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="px-5 py-2 rounded-xl bg-black text-white disabled:opacity-60">
          {busy ? "Uploading…" : "Choose CSV"}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file" accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
      {err && <p className="text-red-600 mt-3">{err}</p>}
    </div>
  );
}