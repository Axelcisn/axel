/**
 * Diagnose why strict no-carry-in restart returns "no window sim" for a window.
 *
 * It reports, per lookback window, the flat/long/short mix, transition counts,
 * whether any flat->open exists, and the last clean open/close/flat dates.
 *
 * Run:
 *   npx tsx scripts/smoke-strict-restart-feasibility.ts --symbols=AAPL,MSFT --lookbacks=63,126,252
 */

import { parseSymbolsFromArgs } from "./_utils/cli";
import { ensureCanonicalOrHistory } from "../lib/storage/canonical";
import { buildBarsWithSignalsForSymbol } from "./_utils/buildBarsWithSignals";

type Sig = -1 | 0 | 1;

function pct(x: number, n: number) {
  return n ? (100 * x) / n : 0;
}

function summarizeWindow(dates: string[], sig: Sig[], startIdx: number) {
  const n = sig.length - startIdx;
  if (n <= 1) return null;

  let n0 = 0,
    nL = 0,
    nS = 0;
  let opens = 0,
    closes = 0,
    flips = 0;
  let lastOpenIdx = -1,
    lastCloseIdx = -1,
    lastFlatIdx = -1;

  for (let i = startIdx; i < sig.length; i++) {
    if (sig[i] === 0) {
      n0++;
      lastFlatIdx = i;
    } else if (sig[i] === 1) nL++;
    else nS++;
  }

  for (let i = Math.max(startIdx + 1, 1); i < sig.length; i++) {
    const prev = sig[i - 1];
    const cur = sig[i];
    if (prev === 0 && cur !== 0) {
      opens++;
      lastOpenIdx = i;
    } else if (prev !== 0 && cur === 0) {
      closes++;
      lastCloseIdx = i;
    } else if (prev !== 0 && cur !== 0 && prev !== cur) {
      flips++;
    }
  }

  const strictRestartPossible = opens > 0;

  return {
    start: dates[startIdx],
    end: dates[dates.length - 1],
    flatPct: pct(n0, n).toFixed(1),
    longPct: pct(nL, n).toFixed(1),
    shortPct: pct(nS, n).toFixed(1),
    opens,
    closes,
    flips,
    strictRestartPossible,
    lastFlat: lastFlatIdx >= 0 ? dates[lastFlatIdx] : null,
    lastOpen: lastOpenIdx >= 0 ? dates[lastOpenIdx] : null,
    lastClose: lastCloseIdx >= 0 ? dates[lastCloseIdx] : null,
  };
}

function parseLookbacks(argv: string[]) {
  const arg = argv.find((a) => a.startsWith("--lookbacks="));
  if (!arg) return [63, 126, 252, 504];
  return arg
    .split("=")[1]
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 1);
}

async function main() {
  const { symbols } = parseSymbolsFromArgs(process.argv, {
    defaultSymbols: ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"],
  });

  const lookbacks = parseLookbacks(process.argv);
  const h = Number(process.argv.find((a) => a.startsWith("--h="))?.split("=")[1] ?? 1);
  const coverage = Number(process.argv.find((a) => a.startsWith("--coverage="))?.split("=")[1] ?? 0.95);

  for (const symbol of symbols) {
    const { rows, meta } = await ensureCanonicalOrHistory(symbol, { interval: "1d", minRows: 600 });
    const tz = (meta as any)?.exchange_tz ?? "America/New_York";

    // Build signals; update buildBarsWithSignalsForSymbol to mirror app signal logic if needed.
    const bars = buildBarsWithSignalsForSymbol({
      symbol,
      rows,
      h,
      coverage,
    });

    const dates = bars.map((b) => b.date);
    const sig = bars.map((b) => {
      if (b.signal === "long") return 1 as Sig;
      if (b.signal === "short") return -1 as Sig;
      return 0 as Sig;
    });

    if (dates.length === 0) {
      console.log(`\n=== ${symbol} ===\nNo bars available.`);
      continue;
    }

    console.log(`\n=== ${symbol} ===`);
    console.log(`tz=${tz} rows=${rows.length} h=${h} cov=${coverage}`);
    console.log(`lastDate=${dates[dates.length - 1]}`);

    for (const lb of lookbacks) {
      const startIdx = Math.max(0, sig.length - lb);
      const s = summarizeWindow(dates, sig, startIdx);
      if (!s) continue;

      console.log(
        `\nlookback=${lb}  ${s.start}..${s.end}` +
          `\n  state% flat/long/short = ${s.flatPct}/${s.longPct}/${s.shortPct}` +
          `\n  transitions opens=${s.opens} closes=${s.closes} flips=${s.flips}` +
          `\n  strictRestartPossible=${s.strictRestartPossible}` +
          `\n  lastOpen=${s.lastOpen ?? "—"} lastClose=${s.lastClose ?? "—"} lastFlat=${s.lastFlat ?? "—"}`
      );
    }

    let lastOpenOverall: string | null = null;
    for (let i = sig.length - 1; i >= 1; i--) {
      if (sig[i] !== 0 && sig[i - 1] === 0) {
        lastOpenOverall = dates[i];
        break;
      }
    }
    console.log(
      `\nRecommended rangeStart (to SEE trades under strict restart): ${
        lastOpenOverall ?? "NO CLEAN OPEN IN FULL HISTORY"
      }`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
