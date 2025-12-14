// Smoke test for GARCH volatility forecasts.
// Run with: npx tsx scripts/smoke-garch-volatility.ts
// Override tickers via CLI args: npx tsx scripts/smoke-garch-volatility.ts T1 T2 ...

import fs from 'fs/promises';
import path from 'path';
import { ensureCanonicalOrHistory } from '@/lib/storage/canonical';
import { ensureDefaultTargetSpec } from '@/lib/targets/defaultSpec';
import { fitAndForecastGarch } from '@/lib/volatility/garch';
import { composePi } from '@/lib/volatility/piComposer';
import { getNormalCritical, getStudentTCritical } from '@/lib/forecast/critical';
import { SigmaForecast } from '@/lib/volatility/types';
import { computeGbmExpectedPrice } from '@/lib/gbm/engine';
import { parseSymbolsFromArgv } from './_utils/cli';

const DEFAULT_SYMBOLS = ["V", "MA", "LLY", "COST", "HD"] as const;
type SymbolInput = typeof DEFAULT_SYMBOLS[number];
const SYMBOLS: string[] = parseSymbolsFromArgv(process.argv.slice(2), [...DEFAULT_SYMBOLS]);

// Match production defaults: UI uses ~756 for GARCH window and variance_targeting true
const DEFAULT_WINDOW = 756;
const MIN_GARCH_WINDOW = 500;
const DEFAULT_DF = 8; // aligns with typical UI default for t

async function loadLatestGbmDrift(symbol: string): Promise<number> {
  try {
    const gbmDir = path.join(process.cwd(), 'data', 'forecasts', symbol);
    const files = await fs.readdir(gbmDir);
    const gbmFiles = files.filter(f => f.includes('-GBM.json')).sort().reverse();
    if (gbmFiles.length === 0) return 0;
    const latest = await fs.readFile(path.join(gbmDir, gbmFiles[0]), 'utf-8');
    const record = JSON.parse(latest);
    const mu = record?.estimates?.mu_star_used;
    return typeof mu === 'number' ? mu : 0;
  } catch {
    return 0;
  }
}

function buildReturns(rows: Array<{ date: string; adj_close: number | null; close?: number | null; r?: number | null }>, latestDate: string): number[] {
  const filtered = rows
    .filter(r => r.date <= latestDate)
    .filter(r => typeof r.adj_close === 'number' && r.adj_close! > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const precomputed = filtered
    .map(r => r.r)
    .filter((r): r is number => typeof r === 'number');

  if (precomputed.length > 0) {
    return precomputed;
  }

  const prices: number[] = [];
  for (const row of filtered) {
    const p = row.adj_close ?? row.close;
    if (typeof p === 'number' && p > 0) prices.push(p);
  }
  const recomputed: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const curr = prices[i];
    if (prev > 0 && curr > 0) {
      recomputed.push(Math.log(curr / prev));
    }
  }
  return recomputed;
}

async function runForSymbol(symbol: string) {
  console.log(`\n=== ${symbol} ===`);

  const { rows, meta } = await ensureCanonicalOrHistory(symbol, { minRows: 600, interval: "1d" });
  console.log(`Rows: ${rows.length}, tz: ${meta.exchange_tz}`);

  const spec = await ensureDefaultTargetSpec(symbol, {
    exchangeTz: meta.exchange_tz ?? "America/New_York",
  });

  const h = 1;
  const coverage = spec.coverage ?? 0.95;

  const validRows = rows
    .filter((row) => typeof row.adj_close === "number" && row.adj_close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (validRows.length < 2) {
    console.error(`Not enough valid price rows for ${symbol}`);
    return;
  }

  const latestRow = validRows[validRows.length - 1];
  const date_t = latestRow.date;
  const S_t = latestRow.adj_close!;

  const returns = buildReturns(rows as any, date_t);
  const returnsLen = returns.length;

  // Window logic mirrors route: cap by available returns+1, enforce min
  const windowCap = Math.min(DEFAULT_WINDOW, returnsLen + 1);
  if (windowCap < MIN_GARCH_WINDOW) {
    console.error(`Insufficient returns for GARCH: have ${returnsLen}, need at least ${MIN_GARCH_WINDOW - 1}`);
    return;
  }
  const window = windowCap;
  const returnsForFit = returns.slice(-(window - 1));

  const mu_star_used = await loadLatestGbmDrift(symbol); // fallback to 0 inside helper

  const dists: Array<"normal" | "student-t"> = ["normal", "student-t"];

  for (const dist of dists) {
    try {
      const sigmaForecast = await fitAndForecastGarch({
        symbol,
        date_t,
        window,
        dist,
        variance_targeting: true,
        df: dist === "student-t" ? DEFAULT_DF : undefined,
        returns: returnsForFit,
      });

      const diagnostics = (sigmaForecast.diagnostics ?? {}) as Record<string, any>;
      const omega = diagnostics.omega ?? null;
      const alpha = diagnostics.alpha ?? null;
      const beta = diagnostics.beta ?? null;
      const alpha_plus_beta =
        diagnostics.alpha_plus_beta ??
        (typeof alpha === "number" && typeof beta === "number" ? alpha + beta : null);
      const uncond_var = diagnostics.unconditional_var ?? null;
      const df =
        dist === "student-t"
          ? (typeof diagnostics.nu === "number" ? diagnostics.nu : DEFAULT_DF)
          : undefined;

      const critical =
        dist === "student-t" && typeof df === "number" && df > 2
          ? { type: "t" as const, value: getStudentTCritical(df, coverage), df }
          : { type: "normal" as const, value: getNormalCritical(coverage) };

      const piResult = composePi({
        symbol,
        date_t,
        h,
        coverage,
        mu_star_used,
        S_t,
        sigma_forecast: sigmaForecast,
        critical,
        window_span: { start: validRows[Math.max(0, validRows.length - window)].date, end: date_t },
      });

      const gbmEst = {
        mu_star_hat: 0,
        sigma_hat: sigmaForecast.sigma_1d,
        mu_star_used,
        z_alpha: critical.value,
      };
      const y_hat = computeGbmExpectedPrice(S_t, gbmEst as any, h);

      const L_h = piResult.L_h;
      const U_h = piResult.U_h;
      const band_width_bp = Math.round(10000 * (U_h / L_h - 1));

      console.log({
        symbol,
        dist,
        window,
        nObs: returnsForFit.length,
        sigma_1d: sigmaForecast.sigma_1d,
        omega: omega ?? "n/a",
        alpha: alpha ?? "n/a",
        beta: beta ?? "n/a",
        alpha_plus_beta: alpha_plus_beta ?? "n/a",
        uncond_var: uncond_var ?? "n/a",
        y_hat,
        L_h,
        U_h,
        band_width_bp,
        mu_star_used,
      });
    } catch (err: any) {
      console.error(`GARCH ${dist} failed for ${symbol}:`, err?.message ?? err);
    }
  }
}

async function main() {
  console.log("=== GARCH Smoke Test – V, MA, LLY, COST, HD ===");
  console.log("Override tickers via: npx tsx scripts/smoke-garch-volatility.ts T1 T2 ...\n");

  for (const symbol of SYMBOLS) {
    // eslint-disable-next-line no-await-in-loop
    await runForSymbol(symbol);
  }
  process.exitCode = 0;
}

main().catch((err) => {
  console.error("Unexpected smoke test failure:", err?.message ?? err);
  process.exitCode = 0;
});
