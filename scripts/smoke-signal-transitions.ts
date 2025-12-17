/**
 * Diagnose why WindowSim finds "NO CLEAN OPEN FOUND" under strict no-carry-in.
 * Prints signal state distribution and transition counts (opens/closes/flips).
 *
 * Run:
 *   npx tsx scripts/smoke-signal-transitions.ts --symbols=VRTX,REGN,ICE,MPC,OKE --lookbackBars=252
 */

import { parseSymbolsFromArgs } from "./_utils/cli";
import { ensureCanonicalOrHistory } from "../lib/storage/canonical";
import { buildBarsWithSignalsForSymbol } from "./_utils/buildBarsWithSignals";

type Sig = -1 | 0 | 1;

function summarizeSignals(dates: string[], sig: Sig[]) {
  const n = sig.length;
  let n0 = 0, nL = 0, nS = 0;

  let opens = 0, closes = 0, flips = 0;
  let openL = 0, openS = 0, closeL = 0, closeS = 0, flipToL = 0, flipToS = 0;

  for (let i = 0; i < n; i++) {
    if (sig[i] === 0) n0++;
    else if (sig[i] === 1) nL++;
    else nS++;
  }

  for (let i = 1; i < n; i++) {
    const prev = sig[i - 1], cur = sig[i];
    if (prev === 0 && cur !== 0) {
      opens++;
      if (cur === 1) openL++; else openS++;
    } else if (prev !== 0 && cur === 0) {
      closes++;
      if (prev === 1) closeL++; else closeS++;
    } else if (prev !== 0 && cur !== 0 && prev !== cur) {
      flips++;
      if (cur === 1) flipToL++; else flipToS++;
    }
  }

  const pct = (x: number) => (n ? (100 * x / n).toFixed(1) : "0.0") + "%";
  const lastFlatIdx = (() => {
    for (let i = n - 1; i >= 0; i--) if (sig[i] === 0) return i;
    return -1;
  })();
  const lastOpenIdx = (() => {
    for (let i = n - 1; i >= 1; i--) if (sig[i] !== 0 && sig[i - 1] === 0) return i;
    return -1;
  })();

  return {
    n,
    range: n ? { start: dates[0], end: dates[n - 1] } : null,
    statePct: { flat: pct(n0), long: pct(nL), short: pct(nS) },
    transitions: {
      opens, openL, openS,
      closes, closeL, closeS,
      flips, flipToL, flipToS
    },
    lastFlat: lastFlatIdx >= 0 ? dates[lastFlatIdx] : null,
    lastOpen: lastOpenIdx >= 0 ? dates[lastOpenIdx] : null,
  };
}

async function main() {
  const { symbols } = parseSymbolsFromArgs(process.argv, {
    defaultSymbols: ["VRTX", "REGN", "ICE", "MPC", "OKE"],
  });

  const lookbackBars = Number(process.argv.find(a => a.startsWith("--lookbackBars="))?.split("=")[1] ?? 252);
  const h = Number(process.argv.find(a => a.startsWith("--h="))?.split("=")[1] ?? 1);
  const coverage = Number(process.argv.find(a => a.startsWith("--coverage="))?.split("=")[1] ?? 0.95);

  for (const symbol of symbols) {
    const { rows, meta } = await ensureCanonicalOrHistory(symbol, { interval: "1d", minRows: 400 });
    const tz = (meta as any)?.exchange_tz ?? "America/New_York";
    const slice = rows.slice(Math.max(0, rows.length - lookbackBars));

    // Build the same bars/signals as the window-sim smoke (simple price-delta signals).
    // If you change signal construction in the app, update buildBarsWithSignalsForSymbol to match.
    const bars = buildBarsWithSignalsForSymbol({
      symbol,
      rows: slice,
      h,
      coverage,
    });

    const dates = bars.map(b => b.date);
    const sig = bars.map(b => {
      if (b.signal === "long") return 1 as Sig;
      if (b.signal === "short") return -1 as Sig;
      return 0 as Sig;
    });

    const summary = summarizeSignals(dates, sig);

    console.log(`\n=== ${symbol} ===`);
    console.log(`lookbackBars=${lookbackBars} h=${h} cov=${coverage} tz=${tz} rows=${rows.length}`);
    console.log(summary);

    if (summary.transitions.opens === 0) {
      if (summary.statePct.flat === "0.0%") {
        console.log("DIAG: Signal is never flat in lookback (always in a position or flipping). Strict no-carry-in cannot find a clean restart.");
      } else if (summary.statePct.long === "0.0%" && summary.statePct.short === "0.0%") {
        console.log("DIAG: Signal is always flat in lookback (no trades possible).");
      } else {
        console.log("DIAG: Signal has non-flat states but no flat->open transitions. Likely only flips or starts non-flat and never reopens from flat within this lookback.");
      }
      console.log(`Last flat day: ${summary.lastFlat ?? "none"} | Last clean open: ${summary.lastOpen ?? "none"}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
