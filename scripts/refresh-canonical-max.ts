/**
 * One-off refresher to upgrade canonical caches to full history (range=max).
 * Usage: npx tsx scripts/refresh-canonical-max.ts AAPL NVDA TSLA
 */

import { ensureCanonicalOrHistory, loadCanonicalDataWithMeta } from "@/lib/storage/canonical";

async function refreshSymbol(symbol: string) {
  const existing = await loadCanonicalDataWithMeta(symbol).catch(() => null);
  const prevRows = existing?.rows.length ?? 0;
  const prevRange = (existing?.meta as any)?.range ?? null;
  const prevSpan = existing?.meta?.calendar_span ?? null;

  const refreshed = await ensureCanonicalOrHistory(symbol, {
    interval: "1d",
    minRows: 260,
    persist: true,
    forceMaxRefresh: true,
  });

  const nextRows = refreshed.rows.length;
  const nextRange = (refreshed.meta as any)?.range ?? null;
  const nextSpan = refreshed.meta?.calendar_span ?? null;

  console.log(
    JSON.stringify(
      {
        symbol,
        prev: { rows: prevRows, range: prevRange, span: prevSpan },
        next: { rows: nextRows, range: nextRange, span: nextSpan },
      },
      null,
      2
    )
  );
}

async function main() {
  const symbols = process.argv.slice(2);
  if (symbols.length === 0) {
    console.error("Usage: npx tsx scripts/refresh-canonical-max.ts SYMBOL [SYMBOL...]");
    process.exit(1);
  }

  for (const sym of symbols) {
    try {
      await refreshSymbol(sym);
    } catch (err: any) {
      console.error(`[refresh] ${sym} failed:`, err?.message ?? err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
