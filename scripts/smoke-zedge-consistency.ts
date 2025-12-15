import { ensureCanonicalOrHistory } from "@/lib/storage/canonical";
import { ensureDefaultTargetSpec } from "@/lib/targets/defaultSpec";
import {
  buildEwmaReactionMap,
  buildEwmaTiltConfigFromReactionMap,
  defaultReactionConfig,
} from "@/lib/volatility/ewmaReaction";
import { runEwmaWalker } from "@/lib/volatility/ewmaWalker";
import { computeZEdgeSeries } from "@/lib/volatility/zWfoOptimize";
import { parseSymbolsFromArgv } from "./_utils/cli";

const DEFAULT_SYMBOLS = ["AEP", "SO", "XEL", "ED", "NEM"] as const;

function formatNum(value: number) {
  return Number.isFinite(value) ? value.toFixed(6) : "NaN";
}

async function runForSymbol(symbol: string) {
  const sym = symbol.toUpperCase();
  const { rows } = await ensureCanonicalOrHistory(sym, { interval: "1d", minRows: 1200 });
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

  const zSeries = computeZEdgeSeries(
    rows,
    ewmaResult.points,
    horizon,
    reactionMap.meta.testStart ?? null
  );

  if (zSeries.length === 0) {
    throw new Error(`[${sym}] No zEdge samples found`);
  }

  const ewmaMap = new Map(ewmaResult.points.map((p) => [p.date_tp1, p]));
  const idxCandidates = [
    100,
    500,
    1000,
    zSeries.length - 2,
    zSeries.length - 1,
  ];
  const indices = Array.from(
    new Set(idxCandidates.filter((i) => i >= 0 && i < zSeries.length))
  ).sort((a, b) => a - b);

  console.log(`\n=== ${sym} (z samples=${zSeries.length}) ===`);
  console.log("idx date        S_t        y_hat_tp1  muBase     sigmaH    zEdge(calc)   zEdge(series)");

  indices.forEach((idx) => {
    const zPoint = zSeries[idx];
    const point = ewmaMap.get(zPoint.date);
    if (!point) {
      throw new Error(`[${sym}] Missing EWMA point for date ${zPoint.date}`);
    }
    const sigmaH = point.sigma_t * Math.sqrt(horizon);
    const muBase = Math.log(point.y_hat_tp1 / point.S_t);
    const zEdge =
      Number.isFinite(muBase) && Number.isFinite(sigmaH) && sigmaH > 0 ? muBase / sigmaH : NaN;

    if (!(sigmaH > 0)) {
      throw new Error(`[${sym}] sigmaH <= 0 at idx ${idx}`);
    }
    if (!Number.isFinite(zEdge)) {
      throw new Error(`[${sym}] zEdge not finite at idx ${idx}`);
    }

    const diff = Math.abs(zEdge - zPoint.zEdge);
    if (diff > 1e-9) {
      throw new Error(
        `[${sym}] zEdge mismatch at idx ${idx}: computed=${zEdge} series=${zPoint.zEdge}`
      );
    }

    console.log(
      `${String(idx).padEnd(3)} ${zPoint.date} ${formatNum(point.S_t).padStart(10)} ${formatNum(
        point.y_hat_tp1
      ).padStart(11)} ${formatNum(muBase).padStart(9)} ${formatNum(sigmaH).padStart(
        9
      )} ${formatNum(zEdge).padStart(13)} ${formatNum(zPoint.zEdge).padStart(13)}`
    );
  });
}

async function main() {
  const symbols = parseSymbolsFromArgv(process.argv.slice(2), DEFAULT_SYMBOLS as unknown as string[]);
  for (const sym of symbols) {
    await runForSymbol(sym);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
