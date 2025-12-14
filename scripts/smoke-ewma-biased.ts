import { ensureCanonicalOrHistory } from '@/lib/storage/canonical';
import { ensureDefaultTargetSpec } from '@/lib/targets/defaultSpec';
import {
  buildEwmaReactionMap,
  buildEwmaTiltConfigFromReactionMap,
  defaultReactionConfig,
  bucketIdForZ,
  DEFAULT_Z_BUCKETS,
} from '@/lib/volatility/ewmaReaction';
import { runEwmaWalker, EwmaWalkerPoint } from '@/lib/volatility/ewmaWalker';
import { parseSymbolsFromArgv } from './_utils/cli';

const DEFAULT_SYMBOLS = ['GOOGL', 'BAC', 'DIS', 'INTC', 'CSCO'] as const;

function computeNeutralZByDate(prices: number[], dates: string[], lambda: number, initialWindow: number) {
  const zMap = new Map<string, number>();
  if (prices.length < initialWindow + 1) return zMap;

  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(Math.log(prices[i] / prices[i - 1]));
  }
  if (returns.length < initialWindow) return zMap;

  const baseSlice = returns.slice(0, initialWindow - 1);
  const mean = baseSlice.reduce((s, r) => s + r, 0) / baseSlice.length;
  let variance = baseSlice.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / Math.max(1, baseSlice.length - 1);

  for (let i = initialWindow - 1; i < returns.length; i++) {
    const sigmaPrev = Math.sqrt(variance);
    const zNeutral = sigmaPrev > 0 ? returns[i] / sigmaPrev : 0;
    const date = dates[i + 1];
    if (date) {
      zMap.set(date, zNeutral);
    }
    variance = lambda * variance + (1 - lambda) * Math.pow(returns[i], 2);
  }

  return zMap;
}

function summarizeCoverage(points: EwmaWalkerPoint[]) {
  let inside = 0;
  for (const p of points) {
    if (p.S_tp1 >= p.L_tp1 && p.S_tp1 <= p.U_tp1) inside++;
  }
  return { inside, total: points.length, coverage: points.length ? inside / points.length : 0 };
}

function summarizeDirectionHit(points: EwmaWalkerPoint[]) {
  let hits = 0;
  for (const p of points) {
    const realized = Math.log(p.S_tp1 / p.S_t);
    const drift = Math.log(p.y_hat_tp1 / p.S_t);
    const sameSign =
      (realized > 0 && drift > 0) ||
      (realized < 0 && drift < 0) ||
      (realized === 0 && drift === 0);
    if (sameSign) hits++;
  }
  return { hits, total: points.length, hitRate: points.length ? hits / points.length : 0 };
}

async function runForSymbol(symbol: string) {
  console.log(`\n=== ${symbol} ===`);
  const { rows, meta } = await ensureCanonicalOrHistory(symbol, { minRows: 260, interval: '1d' });
  console.log(`Rows: ${rows.length}, tz: ${meta.exchange_tz}`);

  const spec = await ensureDefaultTargetSpec(symbol, {});
  const horizon = spec.h ?? 1;
  const coverage = spec.coverage ?? 0.95;
  const lambda = 0.94;
  const trainFraction = 0.7;
  const shrinkFactor = 0.5;

  const neutral = await runEwmaWalker({
    symbol,
    lambda,
    coverage,
    horizon,
  });

  const reactionConfig = {
    ...defaultReactionConfig,
    lambda,
    coverage,
    trainFraction,
    horizons: [horizon],
  };

  const reactionMap = await buildEwmaReactionMap(symbol, reactionConfig);
  const tiltConfig = buildEwmaTiltConfigFromReactionMap(reactionMap, { shrinkFactor, horizon });

  const biased = await runEwmaWalker({
    symbol,
    lambda,
    coverage,
    horizon,
    tiltConfig,
  });

  const neutralSummary = summarizeCoverage(neutral.points);
  console.log(
    `Neutral:  coverage=${(neutralSummary.coverage * 100).toFixed(1)}% (target=${(
      coverage * 100
    ).toFixed(0)}%), forecasts=${neutralSummary.total}`
  );

  const biasedCoverage = summarizeCoverage(biased.points);
  const biasedDir = summarizeDirectionHit(biased.points);
  console.log(
    `Biased:   coverage=${(biasedCoverage.coverage * 100).toFixed(1)}% (target=${(
      coverage * 100
    ).toFixed(0)}%), hitRate=${(biasedDir.hitRate * 100).toFixed(1)}%, forecasts=${biasedCoverage.total}`
  );

  // Bucket sanity check
  const cleanRows = rows
    .filter((r) => (r.adj_close ?? r.close) != null && (r.adj_close ?? r.close)! > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const prices = cleanRows.map((r) => r.adj_close ?? r.close!);
  const dates = cleanRows.map((r) => r.date);
  const zNeutralMap = computeNeutralZByDate(prices, dates, lambda, neutral.params.initialWindow);

  let matches = 0;
  let total = 0;

  for (const p of biased.points) {
    const zNeutral = zNeutralMap.get(p.date_t);
    if (!Number.isFinite(zNeutral)) continue;
    const expected = bucketIdForZ(zNeutral!, DEFAULT_Z_BUCKETS);
    if (!expected) continue;
    const assigned = p.bucketId ?? null;
    if (assigned === expected) {
      matches++;
    }
    total++;
  }

  const matchRate = total ? matches / total : 0;
  console.log(`Buckets:  matches=${matches}/${total} (${(matchRate * 100).toFixed(1)}% match)`);
}

async function main() {
  const symbols = parseSymbolsFromArgv(process.argv.slice(2), [...DEFAULT_SYMBOLS]);
  for (const s of symbols) {
    try {
      await runForSymbol(s);
    } catch (err) {
      console.error(`Error for ${s}:`, err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
