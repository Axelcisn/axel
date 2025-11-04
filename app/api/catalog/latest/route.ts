// app/api/catalog/latest/route.ts
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { latestPointerPath } from "@/lib/paths";
import { parseCsv, sortByDateDesc } from "@/lib/csv";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dataset = (searchParams.get("dataset") || "").trim();
  const rawTicker = (searchParams.get("ticker") || "").trim();
  const ticker = rawTicker.toUpperCase();

  if (!dataset || !ticker) {
    return NextResponse.json({ error: "dataset and ticker required" }, { status: 400 });
  }

  const pointer = latestPointerPath(dataset, ticker);
  try {
    const pText = await fs.readFile(pointer, "utf8");
    const meta = JSON.parse(pText) as { path: string };
    const csvText = await fs.readFile(meta.path, "utf8");
    const { columns, rows } = parseCsv(csvText);
    const sorted = sortByDateDesc(rows);
    return NextResponse.json({ columns, rows: sorted });
  } catch (e: any) {
    return NextResponse.json({ error: "No latest file found for dataset/ticker" }, { status: 404 });
  }
}