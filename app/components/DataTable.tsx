// app/components/DataTable.tsx
"use client";
import { useMemo, useState } from "react";
import { toDate } from "@/lib/csv";

type Props = {
  columns: string[];
  rows: Record<string, any>[];
  defaultSortKey?: string;      // default "Date"
  defaultSortDesc?: boolean;    // default true
};

/**
 * Minimal Excel-like table:
 * - sticky header
 * - zebra stripes
 * - click-to-sort on any column
 * - newest-first by default if Date column exists
 * NOTE: No derived columns are created here; we render exactly what's in CSV.
 */
export default function DataTable({ columns, rows, defaultSortKey = "Date", defaultSortDesc = true }: Props) {
  const [sortKey, setSortKey] = useState<string>(defaultSortKey);
  const [desc, setDesc] = useState<boolean>(defaultSortDesc);

  const sorted = useMemo(() => {
    const key = sortKey;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a?.[key];
      const bv = b?.[key];
      if (key === "Date") {
        const ad = toDate(av)?.getTime() ?? -Infinity;
        const bd = toDate(bv)?.getTime() ?? -Infinity;
        return desc ? bd - ad : ad - bd;
      }
      if (typeof av === "number" && typeof bv === "number") {
        return desc ? (bv - av) : (av - bv);
      }
      return desc
        ? String(bv ?? "").localeCompare(String(av ?? ""))
        : String(av ?? "").localeCompare(String(bv ?? ""));
    });
    return copy;
  }, [rows, sortKey, desc]);

  const onHeaderClick = (k: string) => {
    if (k === sortKey) setDesc(!desc);
    else { setSortKey(k); setDesc(k === "Date" ? true : false); }
  };

  return (
    <div className="overflow-auto border rounded-2xl">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 bg-white shadow-[0_1px_0_rgba(0,0,0,0.06)]">
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                onClick={() => onHeaderClick(c)}
                className="px-3 py-2 text-left font-semibold whitespace-nowrap border-b cursor-pointer select-none"
              >
                <span className="inline-flex items-center gap-1">
                  {c}
                  {sortKey === c ? <span>{desc ? "▼" : "▲"}</span> : <span className="opacity-30">↕</span>}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? "bg-gray-50/60" : ""}>
              {columns.map((c) => (
                <td key={c} className="px-3 py-2 border-b whitespace-nowrap">
                  {row?.[c] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}