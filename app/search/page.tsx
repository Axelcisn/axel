// app/search/page.tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SearchPage() {
  const [q, setQ] = useState("");
  const router = useRouter();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = q.trim().toUpperCase();
    if (!t) return;
    router.push(`/company/${t}`);
  };

  return (
    <div className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Search</h1>
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          className="flex-1 border rounded-xl px-4 py-3"
          placeholder='Type a ticker, e.g., "AAPL"'
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="px-5 py-3 rounded-xl bg-black text-white">Go</button>
      </form>

      {q.trim() && (
        <div className="mt-6">
          <button
            onClick={() => router.push(`/company/${q.trim().toUpperCase()}`)}
            className="w-full text-left p-4 rounded-2xl border hover:bg-gray-50"
          >
            <div className="text-sm text-gray-500">Result</div>
            <div className="text-xl font-bold">{q.trim().toUpperCase()}</div>
          </button>
        </div>
      )}
    </div>
  );
}