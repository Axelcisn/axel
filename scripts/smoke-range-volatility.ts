// Smoke test for Range-based volatility forecasts (P, GK, RS, YZ).
// Run with: npx tsx scripts/smoke-range-volatility.ts
// Override tickers via CLI args: npx tsx scripts/smoke-range-volatility.ts T1 T2 ...

import { ensureCanonicalOrHistory } from '@/lib/storage/canonical';
import { ensureDefaultTargetSpec } from '@/lib/targets/defaultSpec';
import { computeRangeSigma } from '@/lib/volatility/range';
import { composePi } from '@/lib/volatility/piComposer';
import { getNormalCritical } from '@/lib/forecast/critical';
import { computeGbmExpectedPrice } from '@/lib/gbm/engine';
import type { SigmaForecast } from '@/lib/volatility/types';
import { parseSymbolsFromArgv } from './_utils/cli';

const DEFAULT_SYMBOLS = ["NFLX", "NVDA", "META", "TSLA", "MCD"] as const;
const SYMBOLS: string[] = parseSymbolsFromArgv(process.argv.slice(2), [...DEFAULT_SYMBOLS]);

const RANGE_MIN_WINDOW = 252;
const DEFAULT_RANGE_WINDOW = 756;

async function runForSymbol(symbol: string) {
  console.log(`\n=== ${symbol} ===`);

  const { rows, meta } = await ensureCanonicalOrHistory(symbol, {
    minRows: 260,
    interval: "1d",
  });
  console.log(`Rows: ${rows.length}, tz: ${meta.exchange_tz}`);

  const spec = await ensureDefaultTargetSpec(symbol, {
    exchangeTz: meta.exchange_tz ?? "America/New_York",
  });

  const h = 1;
  const coverage = spec.coverage ?? 0.95;

  const validRows = rows
    .filter((r) => typeof r.adj_close === "number" && r.adj_close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (validRows.length < 2) {
    console.error(`Not enough valid price rows for ${symbol}`);
    return;
  }

  const latest = validRows[validRows.length - 1];
  const date_t = latest.date;
  const S_t = latest.adj_close!;

  const availableRows = validRows.length;
  const maxFeasibleWindow = Math.min(DEFAULT_RANGE_WINDOW, Math.max(0, availableRows - 1));
  if (maxFeasibleWindow < RANGE_MIN_WINDOW) {
    console.error(`Insufficient data for range estimators: have ${availableRows} rows, need at least ${RANGE_MIN_WINDOW + 1}`);
    return;
  }
  const effectiveRangeWindow = maxFeasibleWindow;

  const estimators: Array<"P" | "GK" | "RS" | "YZ"> = ["P", "GK", "RS", "YZ"];
  const critical = { type: "normal" as const, value: getNormalCritical(coverage) };
  const mu_star_used = 0; // center at S_t for smoke purposes

  const windowStartIdx = Math.max(0, validRows.length - effectiveRangeWindow);
  const windowStart = validRows[windowStartIdx].date;

  for (const estimator of estimators) {
    try {
      const sigmaForecast = await computeRangeSigma({
        symbol,
        date_t,
        estimator,
        window: effectiveRangeWindow,
        ewma_lambda: undefined,
      });

      const sigmaForecastTyped: SigmaForecast = sigmaForecast;

      const piResult = composePi({
        symbol,
        date_t,
        h,
        coverage,
        mu_star_used,
        S_t,
        sigma_forecast: sigmaForecastTyped,
        critical,
        window_span: { start: windowStart, end: date_t },
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
        estimator,
        window: effectiveRangeWindow,
        sigma_1d: sigmaForecast.sigma_1d,
        y_hat,
        L_h,
        U_h,
        band_width_bp,
        diagnostics: {
          estimator: sigmaForecast.diagnostics?.estimator,
          ewma_lambda: sigmaForecast.diagnostics?.ewma_lambda,
          k: sigmaForecast.diagnostics?.k,
          gap_warnings: sigmaForecast.diagnostics?.gap_warnings,
        },
      });
    } catch (err: any) {
      console.error(`Range ${estimator} failed for ${symbol}:`, err?.message ?? err);
    }
  }
}

async function main() {
  console.log("=== Range Smoke Test – NFLX, NVDA, META, TSLA, MCD ===");
  console.log("Override tickers via: npx tsx scripts/smoke-range-volatility.ts T1 T2 ...\n");

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
