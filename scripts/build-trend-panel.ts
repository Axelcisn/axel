import { pathToFileURL } from 'url';
import { loadCanonicalData } from '@/lib/storage/canonical';
import type { CanonicalRow } from '@/lib/types/canonical';
import { runEwmaWalker } from '@/lib/volatility/ewmaWalker';
import { computeEwmaSeries } from '@/lib/indicators/ewmaCrossover';

export interface TrendPanelRow {
  symbol: string;
  date: string;        // date_t
  y: number;           // realised H-day log return from t to t+H
  baseSignal: number;  // mu_base / sigma_h at t
  trendSignal: number; // z_t at t
}

function getPrice(row: CanonicalRow): number | null {
  const p = row.adj_close ?? row.close;
  return p && p > 0 ? p : null;
}

function computeFutureReturn(
  rows: CanonicalRow[],
  idx: number,
  horizon: number
): number | null {
  const start = getPrice(rows[idx]);
  const endIdx = idx + horizon;
  if (start == null || endIdx >= rows.length) return null;
  const end = getPrice(rows[endIdx]);
  if (end == null) return null;
  return Math.log(end / start);
}

interface EwmaPoint {
  date: string;
  value: number;
}

function buildTrendZSeries(
  canonical: CanonicalRow[],
  shortWindow: number,
  longWindow: number,
  lookback: number
): Map<string, number> {
  const priceRows = canonical
    .map((r) => ({ date: r.date, close: getPrice(r) }))
    .filter((r) => r.close != null) as { date: string; close: number }[];

  const shortSeries = computeEwmaSeries(priceRows, shortWindow) as EwmaPoint[];
  const longSeries = computeEwmaSeries(priceRows, longWindow) as EwmaPoint[];

  const longMap = new Map<string, number>();
  longSeries.forEach((p) => longMap.set(p.date, p.value));

  const gaps: { date: string; gap: number }[] = [];
  for (const s of shortSeries) {
    const l = longMap.get(s.date);
    if (l == null || !Number.isFinite(l)) continue;
    gaps.push({ date: s.date, gap: s.value - l });
  }

  const zMap = new Map<string, number>();
  const n = gaps.length;
  for (let i = 0; i < n; i++) {
    const windowStart = Math.max(0, i - lookback + 1);
    const window = gaps.slice(windowStart, i + 1);
    const sampleSize = window.length;
    if (sampleSize < lookback / 2) continue;

    let mean = 0;
    for (const g of window) mean += g.gap;
    mean /= sampleSize;

    let variance = 0;
    for (const g of window) {
      const d = g.gap - mean;
      variance += d * d;
    }
    variance /= sampleSize;
    const std = Math.sqrt(variance);

    let z = 0;
    if (std > 1e-8) {
      z = (window[window.length - 1].gap - mean) / std;
    }
    zMap.set(gaps[i].date, z);
  }

  return zMap;
}

interface EwmaBaseRecord {
  date_t: string;
  sigma_t: number;
  S_t: number;
  y_hat_tp1: number;
}

async function buildEwmaBase(
  symbol: string,
  horizon: number
): Promise<EwmaBaseRecord[]> {
  const result = await runEwmaWalker({
    symbol,
    lambda: 0.94,
    horizon,
    coverage: 0.95,
    initialWindow: 252,
  });

  const points = result.points ?? [];
  return points.map((p) => ({
    date_t: p.date_t,
    sigma_t: p.sigma_t,
    S_t: p.S_t,
    y_hat_tp1: p.y_hat_tp1,
  }));
}

function buildBaseSignals(
  baseRecords: EwmaBaseRecord[],
  horizon: number
): Map<string, { mu_base: number; sigma_h: number; baseSignal: number }> {
  const map = new Map<
    string,
    { mu_base: number; sigma_h: number; baseSignal: number }
  >();

  for (const r of baseRecords) {
    const sigma_h = r.sigma_t * Math.sqrt(horizon);
    if (!Number.isFinite(sigma_h) || sigma_h <= 0) continue;

    if (r.S_t <= 0 || r.y_hat_tp1 <= 0) continue;
    const mu_base = Math.log(r.y_hat_tp1 / r.S_t);
    if (!Number.isFinite(mu_base)) continue;

    const baseSignal = mu_base / sigma_h;
    map.set(r.date_t, { mu_base, sigma_h, baseSignal });
  }

  return map;
}

export async function buildTrendPanelForSymbol(
  symbol: string,
  horizon: number,
  shortWindow: number,
  longWindow: number,
  lookback: number
): Promise<TrendPanelRow[]> {
  const canonical = (await loadCanonicalData(symbol)).slice().sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  const zMap = buildTrendZSeries(canonical, shortWindow, longWindow, lookback);
  const baseRecords = await buildEwmaBase(symbol, horizon);
  const baseMap = buildBaseSignals(baseRecords, horizon);

  const rows: TrendPanelRow[] = [];

  for (let idx = 0; idx < canonical.length; idx++) {
    const row = canonical[idx];
    const date = row.date;

    const base = baseMap.get(date);
    const z = zMap.get(date);
    if (!base || z == null || !Number.isFinite(z)) continue;

    const y = computeFutureReturn(canonical, idx, horizon);
    if (y == null || !Number.isFinite(y)) continue;

    rows.push({
      symbol,
      date,
      y,
      baseSignal: base.baseSignal,
      trendSignal: z,
    });
  }

  return rows;
}

export async function buildTrendPanel(
  symbols: string[],
  horizon: number,
  shortWindow: number,
  longWindow: number,
  lookback: number
): Promise<TrendPanelRow[]> {
  const all: TrendPanelRow[] = [];
  for (const symbol of symbols) {
    console.log(`Building panel for ${symbol}...`);
    const rows = await buildTrendPanelForSymbol(
      symbol,
      horizon,
      shortWindow,
      longWindow,
      lookback
    );
    console.log(`  Rows for ${symbol}: ${rows.length}`);
    all.push(...rows);
  }
  return all;
}

async function main() {
  const args = process.argv.slice(2);
  const symbolsArg = args.find((a) => a.startsWith('--symbols='));
  const horizonArg = args.find((a) => a.startsWith('--h='));

  if (!symbolsArg) {
    console.error(
      'Usage: npx tsx scripts/build-trend-panel.ts --symbols=AAPL,TSLA,... [--h=1]'
    );
    process.exit(1);
  }

  const symbols = symbolsArg.split('=')[1].split(',').map((s) => s.trim());
  const parsedH = horizonArg ? parseInt(horizonArg.split('=')[1], 10) : 1;
  const horizon = Number.isFinite(parsedH) && parsedH > 0 ? parsedH : 1;

  const shortWindow = 14;
  const longWindow = 50;
  const lookback = 60;

  const rows = await buildTrendPanel(
    symbols,
    horizon,
    shortWindow,
    longWindow,
    lookback
  );

  console.log(`Total rows: ${rows.length}`);
  if (rows.length > 0) {
    const first = rows[0];
    const last = rows[rows.length - 1];
    console.log('First row:', first);
    console.log('Last row:', last);

    let yMin = Infinity,
      yMax = -Infinity,
      ySum = 0;
    let baseMin = Infinity,
      baseMax = -Infinity,
      baseSum = 0;
    let trendMin = Infinity,
      trendMax = -Infinity,
      trendSum = 0;

    for (const r of rows) {
      yMin = Math.min(yMin, r.y);
      yMax = Math.max(yMax, r.y);
      ySum += r.y;

      baseMin = Math.min(baseMin, r.baseSignal);
      baseMax = Math.max(baseMax, r.baseSignal);
      baseSum += r.baseSignal;

      trendMin = Math.min(trendMin, r.trendSignal);
      trendMax = Math.max(trendMax, r.trendSignal);
      trendSum += r.trendSignal;
    }

    const n = rows.length;
    console.log(
      'y:      min',
      yMin.toFixed(4),
      'max',
      yMax.toFixed(4),
      'mean',
      (ySum / n).toFixed(4)
    );
    console.log(
      'base:   min',
      baseMin.toFixed(4),
      'max',
      baseMax.toFixed(4),
      'mean',
      (baseSum / n).toFixed(4)
    );
    console.log(
      'trend:  min',
      trendMin.toFixed(4),
      'max',
      trendMax.toFixed(4),
      'mean',
      (trendSum / n).toFixed(4)
    );
  }

  process.exit(0);
}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
