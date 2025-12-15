import { ensureCanonicalOrHistory } from "@/lib/storage/canonical";
import { ensureDefaultTargetSpec } from "@/lib/targets/defaultSpec";
import {
  buildEwmaReactionMap,
  buildEwmaTiltConfigFromReactionMap,
  defaultReactionConfig,
} from "@/lib/volatility/ewmaReaction";
import { runEwmaWalker } from "@/lib/volatility/ewmaWalker";
import {
  simulateTrading212Cfd,
  type Trading212CfdConfig,
  type Trading212SimBar,
} from "@/lib/backtest/trading212Cfd";
import type { CanonicalRow } from "@/lib/types/canonical";
import { parseSymbolsFromArgv } from "./_utils/cli";

const DEFAULT_SYMBOLS = ["DUK", "EQIX", "PLD", "AON", "MMC"] as const;

function buildBpsBars(
  rows: CanonicalRow[],
  ewmaPath: { date_tp1: string; y_hat_tp1: number; S_t: number; sigma_t: number }[],
  horizon: number,
  thresholdBps: number,
  simStartDate?: string | null
): Trading212SimBar[] {
  const thresholdFrac = thresholdBps / 10000;
  const ewmaMap = new Map(ewmaPath.map((p) => [p.date_tp1, p]));

  return rows
    .filter((row) => row.date && (!simStartDate || row.date >= simStartDate))
    .map((row) => {
      const price = row.adj_close ?? row.close;
      const ewma = row.date ? ewmaMap.get(row.date) : undefined;
      if (!price || !ewma) return null;

      const muBase = Math.log(ewma.y_hat_tp1 / ewma.S_t);
      const edgeFrac = Number.isFinite(muBase) ? Math.exp(muBase) - 1 : NaN;
      if (!Number.isFinite(edgeFrac)) return null;

      let signal: Trading212SimBar["signal"] = "flat";
      if (edgeFrac > thresholdFrac) signal = "long";
      else if (edgeFrac < -thresholdFrac) signal = "short";

      return { date: row.date, price, signal };
    })
    .filter((p): p is Trading212SimBar => !!p);
}

function summarizeSim(result: ReturnType<typeof simulateTrading212Cfd>) {
  const returnPct =
    result.initialEquity > 0 ? (result.finalEquity - result.initialEquity) / result.initialEquity : 0;
  const trades = result.trades.length;
  const closed = result.trades.filter((t) => t.exitDate).length;
  return { returnPct, trades, closed };
}

async function runForSymbol(symbol: string, thresholdBps: number) {
  const sym = symbol.toUpperCase();
  const { rows } = await ensureCanonicalOrHistory(sym, { interval: "1d", minRows: 400 });
  const spec = await ensureDefaultTargetSpec(sym, {});
  const horizon = spec.h ?? 1;
  const coverage = spec.coverage ?? 0.95;

  const lambda = 0.94;
  const trainFraction = 0.7;
  const reactionConfig = {
    ...defaultReactionConfig,
    lambda,
    coverage,
    trainFraction,
    horizons: [horizon],
  };

  const reactionMap = await buildEwmaReactionMap(sym, reactionConfig);
  const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor: 0.5, horizon });
  const ewmaResult = await runEwmaWalker({ symbol: sym, lambda, coverage, horizon, tiltConfig });

  const bars = buildBpsBars(rows, ewmaResult.points, horizon, thresholdBps, reactionMap.meta.testStart ?? null);
  if (bars.length === 0) {
    throw new Error(`[${sym}] No bars built for cost wiring test`);
  }

  const baseConfig = {
    leverage: 5,
    fxFeeRate: 0.005,
    dailyLongSwapRate: 0,
    dailyShortSwapRate: 0,
    marginCallLevel: 0.45,
    stopOutLevel: 0.25,
    positionFraction: 0.25,
  } satisfies Omit<Trading212CfdConfig, "spreadBps">;

  const sim0 = simulateTrading212Cfd(
    bars,
    5000,
    { ...baseConfig, spreadBps: 0 }
  );
  const sim10 = simulateTrading212Cfd(
    bars,
    5000,
    { ...baseConfig, spreadBps: 10 }
  );

  const stats0 = summarizeSim(sim0);
  const stats10 = summarizeSim(sim10);

  if (stats0.trades !== stats10.trades || stats0.closed !== stats10.closed) {
    throw new Error(
      `[${sym}] Trade counts diverged with cost: trades ${stats0.trades}/${stats10.trades} closed ${stats0.closed}/${stats10.closed}`
    );
  }

  if (stats10.returnPct > stats0.returnPct + 1e-9) {
    throw new Error(
      `[${sym}] Expected costBps=10 return <= costBps=0 return (got ${stats10.returnPct} vs ${stats0.returnPct})`
    );
  }

  console.log(
    `${sym} trades=${stats0.trades} closed=${stats0.closed} return0=${(stats0.returnPct * 100).toFixed(
      2
    )}% return10=${(stats10.returnPct * 100).toFixed(2)}%`
  );
}

async function main() {
  const symbols = parseSymbolsFromArgv(process.argv.slice(2), DEFAULT_SYMBOLS as unknown as string[]);
  const thresholdBps = 0;
  for (const sym of symbols) {
    await runForSymbol(sym, thresholdBps);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
