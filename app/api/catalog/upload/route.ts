// app/api/catalog/upload/route.ts
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { ensureDir, yearPartition, latestPointerPath, pointersDir } from "@/lib/paths";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const dataset = (searchParams.get("dataset") || "").trim(); // expect "hist_price"
  const rawTicker = (searchParams.get("ticker") || "").trim();
  const ticker = rawTicker.toUpperCase();

  if (!dataset || !ticker.match(/^[A-Z.]{1,10}$/)) {
    return NextResponse.json({ error: "Invalid dataset or ticker" }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required (multipart/form-data)" }, { status: 400 });
  }

  const arrayBuf = await file.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  const sha = crypto.createHash("sha256").update(buf).digest("hex");

  const now = new Date();
  const year = now.getFullYear();
  const dir = yearPartition(dataset, ticker, year);
  await ensureDir(dir);

  const safeName = `part-${Date.now()}-${sha.slice(0,8)}.csv`;
  const fullPath = path.join(dir, safeName);
  await fs.writeFile(fullPath, buf);

  // Maintain "latest" pointer
  const pDir = path.join(pointersDir(), dataset);
  await ensureDir(pDir);
  const pointerPath = latestPointerPath(dataset, ticker);
  await fs.writeFile(pointerPath, JSON.stringify({
    fileId: `sha256:${sha}`,
    path: fullPath,
    dataset,
    ticker,
    created_at: now.toISOString()
  }, null, 2));

  return NextResponse.json({ ok: true, fileId: `sha256:${sha}`, path: fullPath });
}