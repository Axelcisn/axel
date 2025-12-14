// Smoke test for GBM volatility forecasts.
// Run with: npx tsx scripts/smoke-gbm-volatility.ts
// It uses ensureCanonicalOrHistory + ensureDefaultTargetSpec to compute GBM-CC forecasts
// for a small set of symbols and logs the key outputs.

import { ensureCanonicalOrHistory } from '@/lib/storage/canonical';
import { ensureDefaultTargetSpec } from '@/lib/targets/defaultSpec';
import {
  computeGbmEstimates,
  computeGbmInterval,
  computeGbmExpectedPrice,
  type GbmInputs,
} from '@/lib/gbm/engine';
import { parseSymbolsFromArgv } from './_utils/cli';

const DEFAULT_SYMBOLS = ["MSFT", "AMZN", "JPM", "PEP", "IBM"] as const;
const SYMBOLS: string[] = parseSymbolsFromArgv(process.argv.slice(2), [...DEFAULT_SYMBOLS]);
const WINDOW_CHOICES = [756, 504, 252] as const;
type WindowChoice = (typeof WINDOW_CHOICES)[number];

function pickWindowN(rowCount: number): WindowChoice {
  const choice = WINDOW_CHOICES.find((w) => rowCount >= w + 1);
  if (!choice) {
    throw new Error(
      `Insufficient history: need at least ${WINDOW_CHOICES[WINDOW_CHOICES.length - 1] + 1} prices, have ${rowCount}`
    );
  }
  return choice;
}

async function runForSymbol(symbol: string) {
  try {
    const { rows, meta } = await ensureCanonicalOrHistory(symbol, {
      minRows: 260,
      interval: "1d",
    });

    const interval = (meta as any)?.interval ?? "1d";
    console.log(`\n=== ${symbol} ===`);
    console.log(`Rows: ${rows.length}, interval: ${interval}, tz: ${meta.exchange_tz}`);

    const spec = await ensureDefaultTargetSpec(symbol, {
      exchangeTz: meta.exchange_tz ?? "America/New_York",
    });

    const h = 1;
    const coverage = spec.coverage ?? 0.95;
    const lambdaDrift = 0; // Matches the default GBM volatility UI state

    // Filter to valid prices and sort ascending (mirrors API prep)
    const validRows = rows
      .filter((row) => typeof row.adj_close === "number" && row.adj_close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    const windowN = pickWindowN(validRows.length);
    const windowRows = validRows.slice(-(windowN + 1));

    const dates = windowRows.map((r) => r.date);
    const adjClose = windowRows.map((r) => r.adj_close!) as number[];
    const date_t = dates[dates.length - 1];
    const S_t = adjClose[adjClose.length - 1];

    const gbmInput: GbmInputs = {
      dates,
      adjClose,
      windowN,
      lambdaDrift,
      coverage,
    };

    const estimates = computeGbmEstimates(gbmInput);
    const intervalResult = computeGbmInterval({
      S_t,
      muStarUsed: estimates.mu_star_used,
      sigmaHat: estimates.sigma_hat,
      h_trading: h,
      coverage,
    });
    const y_hat = computeGbmExpectedPrice(S_t, estimates, h);

    const band_width_bp = Math.round(10000 * (intervalResult.U_h / intervalResult.L_h - 1));

    console.log({
      method: "GBM-CC",
      date_t,
      h,
      windowN,
      coverage,
      lambdaDrift,
      y_hat,
      L_h: intervalResult.L_h,
      U_h: intervalResult.U_h,
      band_width_bp,
      mu_star_used: estimates.mu_star_used,
      sigma_hat: estimates.sigma_hat,
    });
  } catch (err: any) {
    console.error(`GBM failed for ${symbol}:`, err?.message ?? err);
  }
}

async function main() {
  console.log("=== GBM Smoke Test – Batch 2 (MSFT, AMZN, JPM, PEP, IBM) ===");
  console.log("Override tickers via: npx tsx scripts/smoke-gbm-volatility.ts T1 T2 ...\n");

  for (const symbol of SYMBOLS) {
    // Sequential to avoid rate limits or shared resource contention
    // eslint-disable-next-line no-await-in-loop
    await runForSymbol(symbol);
  }
  process.exitCode = 0;
}

main().catch((err) => {
  console.error("Unexpected smoke test failure:", err?.message ?? err);
  process.exitCode = 0;
});
