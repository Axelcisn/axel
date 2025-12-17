/**
 * Smoke test for EWMA λ* (Calmar) optimizer.
 *
 * Run:
 *   npx tsx scripts/smoke-ewma-lambda-calmar.ts --symbols=TT,PH,CMG,FAST,EW --rangeStart=2025-01-01
 */

import { optimizeEwmaLambdaCalmar } from "@/lib/volatility/ewmaLambdaCalmar";
import { parseSymbolsFromArgv } from "./_utils/cli";

const DEFAULT_SYMBOLS = ["ROST", "MNST", "IDA", "WEC", "ETR"] as const;

function parseRangeStart(argv: string[]): string | null {
  const arg = argv.find((a) => a.startsWith("--rangeStart="));
  return arg ? arg.replace("--rangeStart=", "") : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const rangeStart = parseRangeStart(argv);
  if (!rangeStart) {
    throw new Error("rangeStart is required (e.g., --rangeStart=2025-01-01)");
  }

  const symbols = parseSymbolsFromArgv(argv, [...DEFAULT_SYMBOLS]);

  for (const sym of symbols) {
    const result = await optimizeEwmaLambdaCalmar({
      symbol: sym,
      rangeStart,
      horizon: 1,
      coverage: 0.95,
      initialEquity: 1000,
      leverage: 5,
      positionFraction: 0.25,
      costBps: 0,
      signalRule: "z",
    });

    const lambdaLabel = result.lambdaStar == null ? "— (no-trade)" : result.lambdaStar.toFixed(2);
    console.log(
      `${sym}: λ*=${lambdaLabel}, calmar=${result.calmarScore.toFixed(4)}, span=${result.trainSpan.start}→${result.trainSpan.end}`
    );

    if (result.lambdaStar == null) {
      if (result.calmarScore !== 0) {
        throw new Error(`${sym}: expected calmarScore=0 for no-trade baseline`);
      }
      if (!result.grid.every((g) => g.calmar < 0)) {
        throw new Error(`${sym}: expected all grid calmar scores < 0 when choosing no-trade`);
      }
    } else {
      if (!Number.isFinite(result.lambdaStar) || !Number.isFinite(result.calmarScore)) {
        throw new Error(`${sym}: non-finite result`);
      }
      const bestGrid = result.grid.reduce((acc, cur) => (cur.calmar > acc.calmar ? cur : acc));
      if (bestGrid.calmar < 0) {
        throw new Error(`${sym}: expected positive best calmar when lambdaStar selected`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
