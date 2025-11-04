// lib/csv.ts
import Papa from "papaparse";
import { parse, isValid } from "date-fns";

export type CSVResult = { columns: string[]; rows: Record<string, any>[] };

/** Parse CSV text to {columns, rows}. Trims empty tail rows. */
export function parseCsv(text: string): CSVResult {
  const parsed = Papa.parse<Record<string, any>>(text, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });
  const rows = (parsed.data || []).filter(Boolean);
  const columns = parsed.meta.fields || Object.keys(rows[0] || {});
  return { columns, rows };
}

/** Best-effort US-style date parsing: handles 10/10/25, 9/3/25, etc. */
export function toDate(value: any): Date | null {
  if (!value) return null;
  const formats = ["MM/dd/yy", "M/d/yy", "MM/d/yy", "M/dd/yy", "yyyy-MM-dd"];
  for (const f of formats) {
    const d = parse(String(value), f, new Date());
    if (isValid(d)) return d;
  }
  const d = new Date(value);
  return isValid(d) ? d : null;
}

/** Sort rows by Date DESC (newest first) if a "Date" column exists. */
export function sortByDateDesc(rows: Record<string, any>[]): Record<string, any>[] {
  if (!rows.length || !("Date" in rows[0])) return rows;
  return [...rows].sort((a, b) => {
    const da = toDate(a["Date"])?.getTime() ?? -Infinity;
    const db = toDate(b["Date"])?.getTime() ?? -Infinity;
    return db - da; // DESC
  });
}