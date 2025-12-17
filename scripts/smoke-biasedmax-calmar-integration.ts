import { ensureCanonicalOrHistory } from "@/lib/storage/canonical";
import { optimizeEwmaLambdaCalmar } from "@/lib/volatility/ewmaLambdaCalmar";

const DEFAULT_SYMBOLS = ["ZBRA", "ODFL", "PAYX", "KR", "CMI"];

async function pickRangeStart(symbol: string, offset = 63): Promise<{ rangeStart: string; rows: { date: string }[] }> {
  const { rows } = await ensureCanonicalOrHistory(symbol, { interval: "1d", minRows: 260 });
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const idx = Math.max(0, sorted.length - 1 - offset);
  return { rangeStart: sorted[idx]?.date ?? sorted[0].date, rows: sorted };
}

async function main() {
  const symbolsArg = process.argv.find((a) => a.startsWith("--symbols="));
  const symbols = symbolsArg ? symbolsArg.replace("--symbols=", "").split(",") : DEFAULT_SYMBOLS;

  for (const sym of symbols) {
    const symbol = sym.toUpperCase();
    const { rangeStart, rows } = await pickRangeStart(symbol);

    const res = await optimizeEwmaLambdaCalmar({
      symbol,
      rangeStart,
      horizon: 1,
      coverage: 0.95,
      initialEquity: 1000,
      leverage: 5,
      positionFraction: 0.25,
      costBps: 0,
      signalRule: "z",
    });

    // trainEnd = trading day immediately before rangeStart
    const trainEndIdx = rows.findIndex((r) => r.date >= rangeStart) - 1;
    const effectiveTrainEndIdx = trainEndIdx >= 0 ? trainEndIdx : 0;
    const trainPct =
      rows.length > 0 ? ((effectiveTrainEndIdx + 1) / rows.length) * 100 : NaN;

    const lambdaLabel = res.lambdaStar == null ? "—" : res.lambdaStar.toFixed(2);
    console.log(
      `${symbol} rangeStart=${rangeStart} λ*=${lambdaLabel} calmar=${res.calmarScore.toFixed(
        4
      )} trainPct=${Number.isFinite(trainPct) ? trainPct.toFixed(1) + "%" : "—"} objective=Calmar`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
