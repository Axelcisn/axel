import { defaultReactionConfig, buildEwmaReactionMap, buildEwmaTiltConfigFromReactionMap } from "@/lib/volatility/ewmaReaction";
import { runEwmaWalker, type EwmaWalkerPoint } from "@/lib/volatility/ewmaWalker";
import { parseSymbolsFromArgv } from "./_utils/cli";

const DEFAULT_SYMBOLS = ["CDNS", "SNPS", "KLAC", "LRCX", "ALGN"];
const HORIZON = 1;
const COVERAGE = 0.95;
const LAMBDA = 0.94;
const ENTER = 0.3;

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function summarizeZEdges(points: EwmaWalkerPoint[]) {
  const sqrtH = Math.sqrt(HORIZON);
  const zEdges: number[] = [];
  for (const p of points) {
    const muBase = Math.log(p.y_hat_tp1 / p.S_t);
    const sigmaH = p.sigma_t != null ? p.sigma_t * sqrtH : NaN;
    if (!Number.isFinite(muBase) || !Number.isFinite(sigmaH) || sigmaH <= 0) continue;
    zEdges.push(muBase / sigmaH);
  }
  const meanAbs = zEdges.length ? zEdges.reduce((s, v) => s + Math.abs(v), 0) / zEdges.length : 0;
  const countAbove = zEdges.filter((z) => Math.abs(z) >= ENTER).length;
  const pctAbove = zEdges.length ? (countAbove / zEdges.length) * 100 : 0;
  return { meanAbsZEdge: meanAbs, pctAbove, countAbove, total: zEdges.length };
}

function meanAbsMu(muByBucket: Record<string, number>) {
  const values = Object.values(muByBucket);
  if (!values.length) return 0;
  return values.reduce((s, v) => s + Math.abs(v), 0) / values.length;
}

async function main() {
  const argv = process.argv.slice(2);
  const symbols = parseSymbolsFromArgv(argv, DEFAULT_SYMBOLS);

  for (const symbol of symbols) {
    const reactionConfig = {
      ...defaultReactionConfig,
      lambda: LAMBDA,
      coverage: COVERAGE,
      trainFraction: 0.7,
      horizons: [HORIZON],
    };

    const reactionMap = await buildEwmaReactionMap(symbol, reactionConfig);
    const tilt50 = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor: 0.5, horizon: HORIZON });
    const tilt25 = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor: 0.25, horizon: HORIZON });

    const path50 = await runEwmaWalker({
      symbol,
      lambda: LAMBDA,
      coverage: COVERAGE,
      horizon: HORIZON,
      tiltConfig: tilt50,
    });
    const path25 = await runEwmaWalker({
      symbol,
      lambda: LAMBDA,
      coverage: COVERAGE,
      horizon: HORIZON,
      tiltConfig: tilt25,
    });

    assert(path50.points.length > 0 && path25.points.length > 0, `${symbol}: empty EWMA path`);

    const z50 = summarizeZEdges(path50.points);
    const z25 = summarizeZEdges(path25.points);
    const muAbs50 = meanAbsMu(tilt50.muByBucket);
    const muAbs25 = meanAbsMu(tilt25.muByBucket);

    assert(muAbs25 <= muAbs50 + 1e-12, `${symbol}: mu shrink failed (k=0.25 > k=0.5)`);
    assert(z25.meanAbsZEdge <= z50.meanAbsZEdge + 1e-12, `${symbol}: |zEdge| did not shrink with k`);
    assert(z25.countAbove <= z50.countAbove, `${symbol}: proxy trade count did not fall with lower k`);

    const summary = `${symbol}: k=0.50 mean|z|=${z50.meanAbsZEdge.toFixed(4)} pct>=${z50.pctAbove.toFixed(2)}% trades=${z50.countAbove} | k=0.25 mean|z|=${z25.meanAbsZEdge.toFixed(4)} pct>=${z25.pctAbove.toFixed(2)}% trades=${z25.countAbove}`;
    console.log(summary);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
