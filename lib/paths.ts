// lib/paths.ts
import path from "path";
import { promises as fs } from "fs";
import { existsSync } from "fs";

export const DATA_ROOT =
  process.env.DATA_ROOT || path.join(process.cwd(), "data");

export const datasetDir = (dataset: string) =>
  path.join(DATA_ROOT, "datasets", dataset);

export const tickerPartition = (dataset: string, ticker: string) =>
  path.join(datasetDir(dataset), `ticker=${ticker.toUpperCase()}`);

export const yearPartition = (dataset: string, ticker: string, year: number) =>
  path.join(tickerPartition(dataset, ticker), `year=${year}`);

export const pointersDir = () =>
  path.join(DATA_ROOT, "pointers", "latest");

export const latestPointerPath = (dataset: string, ticker: string) =>
  path.join(pointersDir(), dataset, `ticker=${ticker.toUpperCase()}.json`);

export async function ensureDir(p: string) {
  if (!existsSync(p)) await fs.mkdir(p, { recursive: true });
}