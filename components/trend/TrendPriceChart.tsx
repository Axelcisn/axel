'use client';

import { PriceChart, 
  type EwmaWalkerPathPoint as PriceChartEwmaPoint,
  type EwmaSummary as PriceChartEwmaSummary
} from '@/components/PriceChart';
import type { EwmaWalkerPoint, EwmaSummary } from '@/lib/hooks/useEwmaWalker';

interface TrendPriceChartProps {
  symbol: string;
  ewmaPath: EwmaWalkerPoint[] | null;
  ewmaSummary: EwmaSummary | null;
  className?: string;
}

/**
 * Convert hook's EwmaWalkerPoint to PriceChart's EwmaWalkerPathPoint
 */
function convertPathToPriceChart(path: EwmaWalkerPoint[] | null): PriceChartEwmaPoint[] | undefined {
  if (!path) return undefined;
  return path.map((p) => ({
    date_t: p.date_t,
    date_tp1: p.date_tp1,
    S_t: p.S_t,
    S_tp1: p.S_tp1 ?? p.S_t, // PriceChart expects number, fallback to S_t if null
    y_hat_tp1: p.y_hat_tp1,
    L_tp1: p.L_tp1,
    U_tp1: p.U_tp1,
  }));
}

/**
 * Convert hook's EwmaSummary to PriceChart's EwmaSummary
 */
function convertSummaryToPriceChart(summary: EwmaSummary | null): PriceChartEwmaSummary | undefined {
  if (!summary) return undefined;
  return {
    coverage: summary.piMetrics.empiricalCoverage,
    targetCoverage: summary.piMetrics.coverage,
    intervalScore: summary.piMetrics.intervalScore,
    avgWidth: summary.piMetrics.avgWidth,
    zMean: summary.zMean,
    zStd: summary.zStd,
    directionHitRate: summary.directionHitRate,
    nPoints: summary.piMetrics.nPoints,
  };
}

export default function TrendPriceChart({
  symbol,
  ewmaPath,
  ewmaSummary,
  className,
}: TrendPriceChartProps) {
  const convertedPath = convertPathToPriceChart(ewmaPath);
  const convertedSummary = convertSummaryToPriceChart(ewmaSummary);

  return (
    <div className={className}>
      <PriceChart
        symbol={symbol}
        ewmaPath={convertedPath}
        ewmaSummary={convertedSummary}
        // All Timing-specific props are left undefined
        forecastOverlay={undefined}
        ewmaBiasedPath={undefined}
        ewmaBiasedSummary={undefined}
        onLoadEwmaUnbiased={undefined}
        onLoadEwmaBiased={undefined}
        isLoadingEwmaBiased={undefined}
        ewmaReactionMapDropdown={undefined}
        horizonCoverage={undefined}
        tradeOverlays={undefined}
        t212AccountHistory={undefined}
        activeT212RunId={undefined}
        onToggleT212Run={undefined}
        isCfdEnabled={undefined}
        onToggleCfd={undefined}
        onDateRangeChange={undefined}
        simulationRuns={undefined}
      />
    </div>
  );
}
