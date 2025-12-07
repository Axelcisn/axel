import type { EwmaWalkerPoint } from '@/lib/hooks/useEwmaWalker';

export type TrendRegime = 'up' | 'down' | 'sideways';

export interface TrendClassification {
  regime: TrendRegime;
  strengthScore: number;       // 0..1 scale based on avg return
  latestPrice: number;
  ewmaCenter: number;
  pricePctFromEwma: number;    // (S_t - y_hat) / y_hat
  avgReturn: number;           // mean S_tp1/S_t - 1 over lookback
}

export interface TrendClassificationOptions {
  lookbackPoints?: number;   // default: 10
  threshold?: number;        // default: 0.005 (0.5%)
}

export function classifyTrendFromEwma(
  path: EwmaWalkerPoint[],
  options?: TrendClassificationOptions
): TrendClassification | null {
  if (!path || path.length === 0) return null;

  const lookbackPoints = options?.lookbackPoints ?? 10;
  const threshold = options?.threshold ?? 0.005;

  const recent = path.slice(-lookbackPoints);
  if (recent.length === 0) return null;

  // Compute simple average return over recent points
  const returns: number[] = [];
  for (const p of recent) {
    if (p.S_tp1 != null && p.S_t) {
      const r = p.S_tp1 / p.S_t - 1;
      returns.push(r);
    }
  }

  const avgReturn =
    returns.length > 0
      ? returns.reduce((sum, r) => sum + r, 0) / returns.length
      : 0;

  const latest = path[path.length - 1];
  const latestPrice = latest.S_t;
  const ewmaCenter = latest.y_hat_tp1;
  const pricePctFromEwma =
    ewmaCenter !== 0 ? (latestPrice - ewmaCenter) / ewmaCenter : 0;

  let regime: TrendRegime = 'sideways';

  if (avgReturn > threshold && latestPrice >= ewmaCenter) {
    regime = 'up';
  } else if (avgReturn < -threshold && latestPrice <= ewmaCenter) {
    regime = 'down';
  } else {
    regime = 'sideways';
  }

  const strengthScore = Math.min(1, Math.abs(avgReturn) / threshold);

  return {
    regime,
    strengthScore,
    latestPrice,
    ewmaCenter,
    pricePctFromEwma,
    avgReturn,
  };
}
