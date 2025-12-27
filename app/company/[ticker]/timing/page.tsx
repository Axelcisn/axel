// cspell:words OHLC Delistings delisted ndist cooldown efron Backtest
'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { IngestionResult, CanonicalRow } from '@/lib/types/canonical';
import { TargetSpec, TargetSpecResult } from '@/lib/types/targetSpec';
import { ForecastRecord } from '@/lib/forecast/types';
import { EventRecord } from '@/lib/events/types';
import { AlertFire } from '@/lib/watchlist/types';
import { RepairRecord } from '@/lib/types/canonical';
import { GbmForecast } from '@/lib/storage/fsStore';
import AlertsCard from '@/components/AlertsCard';
import { QAPanel } from '@/components/QAPanel';
import { EnhancedRepairsPanel } from '@/components/EnhancedRepairsPanel';
import { GbmForecastInspector } from '@/components/GbmForecastInspector';
import { GarchForecastInspector } from '@/components/GarchForecastInspector';
import { RangeForecastInspector } from '@/components/RangeForecastInspector';
import { formatTicker, getAllExchanges, getExchangesByRegion, getExchangeInfo } from '@/lib/utils/formatTicker';
import { parseExchange, normalizeTicker } from '@/lib/utils/parseExchange';
import { CompanyInfo, ExchangeOption } from '@/lib/types/company';
import { useDarkMode } from '@/lib/hooks/useDarkMode';
import { useAutoCleanupForecasts, extractFileIdFromPath } from '@/lib/hooks/useAutoCleanupForecasts';
import { resolveBaseMethod } from '@/lib/forecast/methods';
import { PriceChart, TrendOverlayState, SimulationRunSummary, VolCell, VolBundle } from '@/components/PriceChart';
import { useTrendIndicators } from '@/lib/hooks/useTrendIndicators';
import {
  CfdSimConfig,
  CfdSimBar,
  CfdSignal,
  CfdSimulationResult,
  CfdTrade,
  CfdAccountSnapshot,
  simulateCfd,
} from '@/lib/backtest/cfdSim';
import { computeWindowSimFromBars, type WindowSimResult } from '@/lib/backtest/windowSim';
import { buildSelectedStrategyAnalytics, type SelectedStrategyAnalytics } from '@/lib/analytics/selectedStrategyAnalytics';
import { TickerSearch } from '@/components/TickerSearch';
import { MarketSessionBadge } from '@/components/MarketSessionBadge';
import { StickyTickerBar } from '@/components/StickyTickerBar';
import TrendSection from '@/components/trend/TrendSection';
import useEwmaCrossover from '@/lib/hooks/useEwmaCrossover';
import { computeEwmaSeries, computeEwmaGapZSeries } from '@/lib/indicators/ewmaCrossover';
import { useLiveQuote } from '@/lib/hooks/useLiveQuote';
import { decideZOptimizeApply } from '@/lib/volatility/zOptimizeApplyPolicy';
import { computeGbmInterval } from '@/lib/gbm/engine';
import { buildVolSelectionKey } from '@/lib/volatility/volSelectionKey';

/**
 * Data flow (Timing/Trend):
 * UI controls (Horizon, Coverage, Vol Model, EWMA mode, Window) → local state in this page
 * → request bodies/queries to /api/volatility/[symbol] and EWMA routes (h/coverage/window/model/λ)
 * → server model functions (GBM/GARCH/HAR/Range/ewmaWalker) compute intervals
 * → responses update active/base forecasts and EWMA paths → passed into PriceChart for rendering.
 */

// Badge component interface and implementation
interface BadgeProps {
  label: string;
  status: boolean;
}

function Badge({ label, status }: BadgeProps) {
  return (
    <div className="flex items-center space-x-2">
      <span className="text-sm font-medium">{label}:</span>
      <span className={`px-2 py-1 rounded text-sm ${
        status 
          ? 'bg-green-100 text-green-800' 
          : 'bg-red-100 text-red-800'
      }`}>
        {status ? 'OK' : 'FAIL'}
      </span>
    </div>
  );
}

// Client-side type for gates status
type GateStatus = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

// Result types for pipeline functions
interface VolForecastResult {
  ok: boolean;
  forecast: any | null;   // ForecastRecord-like object
  reason?: string;
}

interface BaseForecastsResult {
  ok: boolean;
  baseForecastCount: number;
}

// Centralized forecast pipeline status
type ForecastStatus = "idle" | "loading" | "ready" | "error";

// Model score type for recommendations table
interface ModelScoreLite {
  model: string;
  score: number;
  metrics: {
    alpha: number;
    n: number;
    intervalScore: number;
    empiricalCoverage: number;
    coverageError: number;
    avgWidthBp: number;
    kupiecPValue: number;
    ccPValue: number;
    trafficLight: "green" | "yellow" | "red";
  };
  noData?: boolean;             // true when we have no real PI metrics
}

// Enhanced upload validation summary types
interface ValidationSummary {
  ok: boolean;
  mode?: 'replace' | 'incremental'; // Processing mode used
  file: {
    name: string;
    hash: string;
    rows: number;
    sizeBytes: number;
  };
  dateRange: {
    first: string; // YYYY-MM-DD
    last: string;  // YYYY-MM-DD
  };
  validation: {
    ohlcCoherence: { failCount: number };
    missingDays: { 
      consecutiveMax: number; 
      totalMissing: number; 
      blocked: boolean;
      thresholds: { maxConsecutive: number; maxTotal: number };
    };
    duplicates: { count: number };
    corporateActions: { splits: number; dividends: number };
    outliers: { flagged: number };
  };
  provenance: {
    vendor: 'yahoo' | 'bloomberg' | 'refinitiv' | 'unknown';
    mappingId: string;
    processedAt: string; // ISO-8601
  };
}

type TrendEwmaPreset = 'short' | 'medium' | 'long' | 'custom';
// Use TrendOverlayState from PriceChart for type compatibility

interface TimingPageProps {
  params: {
    ticker: string;
  };
}

type VolModelSpec = {
  model: 'GBM' | 'GARCH' | 'HAR-RV' | 'Range';
  garchEstimator?: 'Normal' | 'Student-t';
  rangeEstimator?: 'P' | 'GK' | 'RS' | 'YZ';
};

async function runWithConcurrencyLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const queue = [...items];
  const runners = Array(Math.min(limit, queue.length))
    .fill(null)
    .map(async () => {
      while (queue.length) {
        const item = queue.shift();
        if (item === undefined) break;
        await worker(item);
      }
    });
  await Promise.all(runners);
}

const toNum = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

function toVolCell(forecast: any | null | undefined): VolCell | undefined {
  if (!forecast) return undefined;

  const intervals = forecast.intervals ?? {};
  const lower = toNum(
    intervals.L_h ??
    intervals.lower ??
    (forecast as any)?.L_h ??
    (forecast as any)?.lower ??
    (forecast as any)?.bounds?.lower ??
    (forecast as any)?.bounds?.L_h
  );
  const upper = toNum(
    intervals.U_h ??
    intervals.upper ??
    (forecast as any)?.U_h ??
    (forecast as any)?.upper ??
    (forecast as any)?.bounds?.upper ??
    (forecast as any)?.bounds?.U_h
  );

  const est = forecast.estimates ?? {};
  const sigma1d = toNum(
    est.sigma_forecast ??
    est.sigma_1d ??
    est.sigma_hat ??
    (forecast as any)?.sigma_1d
  );

  const widthPct =
    lower != null && upper != null && lower > 0
      ? ((upper / lower) - 1) * 100
      : undefined;

  return {
    sigma1d: sigma1d ?? undefined,
    lower: lower ?? undefined,
    upper: upper ?? undefined,
    widthPct,
  };
}

const mean = (arr: number[]): number => {
  if (!arr.length) return NaN;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
};

const variance = (arr: number[], avg?: number): number => {
  if (arr.length === 0) return NaN;
  const m = avg != null ? avg : mean(arr);
  return arr.reduce((s, v) => s + Math.pow(v - m, 2), 0) / arr.length;
};

const normalizeDateKey = (value: string | null | undefined): string => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return value.slice(0, 10);
};

const getWindowedRows = (
  rows: CanonicalRow[] | null | undefined,
  window: { start: string; end: string } | null
): CanonicalRow[] => {
  if (!rows || rows.length === 0) return [];
  if (!window) return rows;
  return rows.filter((r) => r.date >= window.start && r.date <= window.end);
};

interface EwmaExpectedReturnArgs {
  rows: CanonicalRow[];
  h: number;
  lambda: number;
  trainFraction: number;
  initialEquity: number;
  leverage: number;
  positionFraction: number;
  costBps: number;
}

const computeEwmaExpectedReturnPct = ({
  rows,
  h,
  lambda,
  trainFraction,
  initialEquity,
  leverage,
  positionFraction,
  costBps,
}: EwmaExpectedReturnArgs): number | undefined => {
  if (!rows || rows.length < 3) return undefined;
  const prices: number[] = [];
  for (const row of rows) {
    const p = toNum(row.adj_close ?? row.close);
    if (p != null && p > 0) prices.push(p);
  }
  if (prices.length < 3) return undefined;

  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const curr = prices[i];
    if (prev > 0 && curr > 0) {
      returns.push(Math.log(curr / prev));
    }
  }
  if (returns.length < 2) return undefined;

  const exposure = leverage * positionFraction;
  const MIN_TRAIN = 20;
  let equity = initialEquity;
  let prevPos = 0;
  let positionChanges = 0;

  for (let i = 0; i < returns.length - 1; i++) {
    const priceIdx = i + 1; // prices index corresponding to returns[i]
    const historyReturns = returns.slice(0, i + 1);
    const trainN = Math.max(2, Math.floor(trainFraction * historyReturns.length));
    const trainReturns = historyReturns.slice(-trainN);
    if (trainReturns.length < MIN_TRAIN) {
      prevPos = 0;
      continue;
    }

    const muLog = mean(trainReturns);
    let sigma2 = variance(trainReturns, muLog);
    if (!Number.isFinite(sigma2)) sigma2 = 0;
    for (const r of trainReturns) {
      const e = r - muLog;
      sigma2 = lambda * sigma2 + (1 - lambda) * (e * e);
    }
    const sigmaHat = Math.sqrt(Math.max(sigma2, 0));
    const muHat = muLog + 0.5 * sigmaHat * sigmaHat;
    const muStarUsed = lambda * muHat;
    const S_t = prices[priceIdx];
    if (!Number.isFinite(S_t) || S_t <= 0) {
      prevPos = 0;
      continue;
    }
    const expected = S_t * Math.exp(muStarUsed * h);
    const pos = expected > S_t ? 1 : -1;

    const rSimple = prices[priceIdx + 1] / prices[priceIdx] - 1;
    if (!Number.isFinite(rSimple)) {
      prevPos = pos;
      continue;
    }
    const delta = 1 + exposure * pos * rSimple;
    const deltaClamped = delta > 0 ? delta : 1e-6;

    let costMultiplier = 0;
    if (pos !== prevPos) {
      costMultiplier = prevPos !== 0 ? 2 : 1;
      positionChanges++;
    }

    equity = equity * deltaClamped * (1 - (costBps / 10000) * costMultiplier);
    prevPos = pos;
  }

  if (equity <= 0 || !Number.isFinite(equity)) return undefined;
  return equity / initialEquity - 1;
};

const buildEwmaExpectedBars = (
  rows: CanonicalRow[],
  h: number,
  lambda: number,
  trainFraction: number
): CfdSimBar[] => {
  if (!rows || rows.length < 3) return [];
  const prices: number[] = [];
  const dates: string[] = [];
  for (const row of rows) {
    const p = toNum(row.adj_close ?? row.close);
    if (p != null && p > 0 && row.date) {
      prices.push(p);
      dates.push(row.date);
    }
  }
  if (prices.length < 3) return [];

  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const curr = prices[i];
    if (prev > 0 && curr > 0) {
      returns.push(Math.log(curr / prev));
    }
  }
  const bars: CfdSimBar[] = [];
  const MIN_TRAIN = 20;
  for (let i = 0; i < returns.length - 1; i++) {
    const priceIdx = i + 1;
    const historyReturns = returns.slice(0, i + 1);
    const trainN = Math.max(2, Math.floor(trainFraction * historyReturns.length));
    const trainReturns = historyReturns.slice(-trainN);
    if (trainReturns.length < MIN_TRAIN) {
      bars.push({ date: dates[priceIdx], price: prices[priceIdx], signal: "flat" });
      continue;
    }
    const muLog = mean(trainReturns);
    let sigma2 = variance(trainReturns, muLog);
    if (!Number.isFinite(sigma2)) sigma2 = 0;
    for (const r of trainReturns) {
      const e = r - muLog;
      sigma2 = lambda * sigma2 + (1 - lambda) * (e * e);
    }
    const sigmaHat = Math.sqrt(Math.max(sigma2, 0));
    const muHat = muLog + 0.5 * sigmaHat * sigmaHat;
    const muStarUsed = lambda * muHat;
    const S_t = prices[priceIdx];
    if (!Number.isFinite(S_t) || S_t <= 0) {
      bars.push({ date: dates[priceIdx], price: prices[priceIdx], signal: "flat" });
      continue;
    }
    const expected = S_t * Math.exp(muStarUsed * h);
    const signal: CfdSignal = expected > S_t ? "long" : "short";
    bars.push({ date: dates[priceIdx], price: prices[priceIdx], signal });
  }
  return bars;
};

const summarizeSimPerformance = (
  result: CfdSimulationResult,
  priceStart: number | null,
  priceEnd: number | null
): Partial<SimulationRunSummary> => {
  const trades = result.trades ?? [];
  const initialCapital = result.initialEquity;
  const lastSnap = result.accountHistory[result.accountHistory.length - 1] ?? null;
  const openPnl = lastSnap?.unrealisedPnl ?? 0;
  const netProfit = result.finalEquity - result.initialEquity;
  const grossProfit = trades.filter((t) => (t.netPnl ?? 0) > 0).reduce((a, t) => a + (t.netPnl ?? 0), 0);
  const grossLoss = trades.filter((t) => (t.netPnl ?? 0) < 0).reduce((a, t) => a + (t.netPnl ?? 0), 0);
  const closedLong = trades.filter((t) => t.side === "long");
  const closedShort = trades.filter((t) => t.side === "short");
  const netProfitLong = closedLong.reduce((a, t) => a + (t.netPnl ?? 0), 0);
  const netProfitShort = closedShort.reduce((a, t) => a + (t.netPnl ?? 0), 0);
  const grossProfitLong = closedLong.filter((t) => (t.netPnl ?? 0) > 0).reduce((a, t) => a + (t.netPnl ?? 0), 0);
  const grossLossLong = closedLong.filter((t) => (t.netPnl ?? 0) < 0).reduce((a, t) => a + (t.netPnl ?? 0), 0);
  const grossProfitShort = closedShort.filter((t) => (t.netPnl ?? 0) > 0).reduce((a, t) => a + (t.netPnl ?? 0), 0);
  const grossLossShort = closedShort.filter((t) => (t.netPnl ?? 0) < 0).reduce((a, t) => a + (t.netPnl ?? 0), 0);
  const commissionPaid = result.swapFeesTotal ?? 0;
  const buyHoldPricePct = priceStart != null && priceEnd != null && priceStart > 0 ? (priceEnd - priceStart) / priceStart : null;
  const buyHoldReturn = buyHoldPricePct != null && Number.isFinite(buyHoldPricePct) ? buyHoldPricePct * initialCapital : undefined;
  const maxContractsHeld = Math.max(0, ...trades.map((t) => Math.abs(t.quantity ?? 0)));

  const equitySeries = result.accountHistory
    .map((s) => ({ date: s.date, equity: s.equity }))
    .filter((s) => Number.isFinite(s.equity));

  const dayDiff = (start: string, end: string) => {
    const a = new Date(start);
    const b = new Date(end);
    const diff = Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
    if (!Number.isFinite(diff)) return 0;
    return Math.max(1, diff);
  };

  const computeDrawdownStats = (series: { date: string; equity: number }[]) => {
    if (series.length < 2) {
      return {
        avgDuration: null,
        maxDuration: null,
        avgValue: null,
        maxValue: null,
        avgPct: null,
        maxPct: null,
      };
    }
    const segments: { peak: number; trough: number; duration: number }[] = [];
    let peak = series[0].equity;
    let peakDate = series[0].date;
    let trough = series[0].equity;
    let startDate = series[0].date;
    let inDrawdown = false;

    for (let i = 1; i < series.length; i++) {
      const eq = series[i].equity;
      const date = series[i].date;
      if (eq > peak) {
        if (inDrawdown) {
          segments.push({
            peak,
            trough,
            duration: dayDiff(startDate, date),
          });
        }
        peak = eq;
        peakDate = date;
        trough = eq;
        startDate = date;
        inDrawdown = false;
        continue;
      }
      if (eq < trough) {
        trough = eq;
      }
      if (!inDrawdown && eq < peak) {
        inDrawdown = true;
        startDate = peakDate;
      }
      if (inDrawdown && eq >= peak) {
        segments.push({
          peak,
          trough,
          duration: dayDiff(startDate, date),
        });
        peak = eq;
        peakDate = date;
        trough = eq;
        startDate = date;
        inDrawdown = false;
      }
    }
    if (inDrawdown) {
      const last = series[series.length - 1];
      segments.push({
        peak,
        trough,
        duration: dayDiff(startDate, last.date),
      });
    }
    const pctValues = segments
      .map((s) => (s.peak > 0 ? (s.trough - s.peak) / s.peak : null))
      .filter((v): v is number => v != null && Number.isFinite(v));
    const valueValues = segments.map((s) => s.trough - s.peak);
    const durations = segments.map((s) => s.duration);
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    const min = (arr: number[]) => (arr.length ? Math.min(...arr) : null);
    return {
      avgDuration: avg(durations),
      maxDuration: durations.length ? Math.max(...durations) : null,
      avgValue: avg(valueValues),
      maxValue: min(valueValues),
      avgPct: avg(pctValues),
      maxPct: min(pctValues),
    };
  };

  const computeRunUpStats = (series: { date: string; equity: number }[]) => {
    if (series.length < 2) {
      return {
        avgDuration: null,
        maxDuration: null,
        avgValue: null,
        maxValue: null,
        avgPct: null,
        maxPct: null,
      };
    }
    const segments: { trough: number; peak: number; duration: number }[] = [];
    let trough = series[0].equity;
    let troughDate = series[0].date;
    let peak = series[0].equity;
    let startDate = series[0].date;
    let inRunUp = false;

    for (let i = 1; i < series.length; i++) {
      const eq = series[i].equity;
      const date = series[i].date;

      if (eq < trough) {
        if (inRunUp) {
          segments.push({
            trough,
            peak,
            duration: dayDiff(startDate, date),
          });
        }
        trough = eq;
        troughDate = date;
        peak = eq;
        startDate = troughDate;
        inRunUp = false;
        continue;
      }

      if (eq > peak) {
        peak = eq;
      }
      if (!inRunUp && eq > trough) {
        inRunUp = true;
        startDate = troughDate;
      }
      if (inRunUp && eq <= trough) {
        segments.push({
          trough,
          peak,
          duration: dayDiff(startDate, date),
        });
        trough = eq;
        troughDate = date;
        peak = eq;
        startDate = troughDate;
        inRunUp = false;
      }
    }
    if (inRunUp) {
      const last = series[series.length - 1];
      segments.push({
        trough,
        peak,
        duration: dayDiff(startDate, last.date),
      });
    }

    const pctValues = segments
      .map((s) => (s.trough > 0 ? (s.peak - s.trough) / s.trough : null))
      .filter((v): v is number => v != null && Number.isFinite(v));
    const valueValues = segments.map((s) => s.peak - s.trough);
    const durations = segments.map((s) => s.duration);
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    const max = (arr: number[]) => (arr.length ? Math.max(...arr) : null);

    return {
      avgDuration: avg(durations),
      maxDuration: max(durations),
      avgValue: avg(valueValues),
      maxValue: max(valueValues),
      avgPct: avg(pctValues),
      maxPct: max(pctValues),
    };
  };

  const drawdownStats = computeDrawdownStats(equitySeries);
  const runUpStats = computeRunUpStats(equitySeries);

  const pctOfInitial = (v: number | null | undefined) => {
    if (initialCapital <= 0 || v == null || !Number.isFinite(v)) return null;
    return v / initialCapital;
  };

  const openPnlPct = pctOfInitial(openPnl);
  const netProfitPct = pctOfInitial(netProfit);
  const grossProfitPct = pctOfInitial(grossProfit);
  const grossLossPct = pctOfInitial(grossLoss);
  const commissionPct = pctOfInitial(commissionPaid);
  const buyHoldPct = pctOfInitial(buyHoldReturn ?? null) ?? buyHoldPricePct ?? null;

  if (process.env.NODE_ENV !== "production") {
    console.log("[SIM-PERF]", {
      initialEquity: initialCapital,
      finalEquity: result.finalEquity,
      netProfitUsd: netProfit,
      netProfitPct,
      maxDDUsd: drawdownStats.maxValue,
      maxDDPct: drawdownStats.maxPct,
      buyHoldUsd: buyHoldReturn,
      buyHoldPct,
      buyHoldPricePct,
      openPnlUsd: openPnl,
      openPnlPct,
      grossProfitUsd: grossProfit,
      grossLossUsd: grossLoss,
      commissionUsd: commissionPaid,
    });
    console.log("[SIM-PERF][AUDIT]", {
      initialEquity: initialCapital,
      finalEquity: result.finalEquity,
      openPnlUsd: openPnl,
      openPnlPct,
      netProfitUsd: netProfit,
      netProfitPct,
      grossProfitUsd: grossProfit,
      grossLossUsd: grossLoss,
      commissionUsd: commissionPaid,
      buyHoldPctPrice: buyHoldPricePct,
      buyHoldUsdDerived: buyHoldReturn,
      maxDrawdownPctPeak: drawdownStats.maxPct ?? null,
      maxDrawdownUsdPeak: drawdownStats.maxValue ?? null,
    });
  }

  return {
    initialCapital,
    openPnl,
    openPnlPct: openPnlPct ?? undefined,
    netProfit,
    netProfitPct: netProfitPct ?? undefined,
    netProfitLong,
    netProfitShort,
    grossProfit,
    grossProfitPct: grossProfitPct ?? undefined,
    grossLoss,
    grossLossPct: grossLossPct ?? undefined,
    grossProfitLong,
    grossLossLong,
    grossProfitShort,
    grossLossShort,
    commissionPaid,
    commissionPct: commissionPct ?? undefined,
    buyHoldReturn,
    buyHoldPct: buyHoldPct ?? undefined,
    buyHoldPricePct: buyHoldPricePct ?? undefined,
    maxContractsHeld,
    avgRunUpDuration: runUpStats.avgDuration ?? undefined,
    maxRunUpDuration: runUpStats.maxDuration ?? undefined,
    avgRunUpValue: runUpStats.avgValue ?? undefined,
    maxRunUpValue: runUpStats.maxValue ?? undefined,
    avgRunUpPct: runUpStats.avgPct ?? undefined,
    maxRunUpPct: runUpStats.maxPct ?? undefined,
    avgDrawdownDuration: drawdownStats.avgDuration ?? undefined,
    maxDrawdownDuration: drawdownStats.maxDuration ?? undefined,
    avgDrawdownValue: drawdownStats.avgValue ?? undefined,
    maxDrawdownValue: drawdownStats.maxValue ?? undefined,
    avgDrawdownPct: drawdownStats.avgPct ?? undefined,
    maxDrawdownPct: drawdownStats.maxPct ?? undefined,
  };
};

export default function TimingPage({ params }: TimingPageProps) {
  // Dark mode hook
  const isDarkMode = useDarkMode();
  const { quote, isLoading: isQuoteLoading } = useLiveQuote(params.ticker, {
    pollMs: 3000, // Poll every 3 seconds for near real-time updates
  });
  
  // Auto-cleanup hook for generated forecast files
  const { trackGeneratedFile, cleanupTrackedFiles } = useAutoCleanupForecasts(params.ticker);
  
  // Server-confirmed Target Spec (what the API route reads)  
  const [serverTargetSpec, setServerTargetSpec] = useState<any | null>(null);
  const [isLoadingServerSpec, setIsLoadingServerSpec] = useState(false);
  const tickerParam = params.ticker; // NEVER shadow this

  const [uploadResult, setUploadResult] = useState<IngestionResult | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Target Spec state
  const [targetSpecResult, setTargetSpecResult] = useState<TargetSpecResult | null>(null);
  const [h, setH] = useState(1);
  const [coverage, setCoverage] = useState(0.95);
  const [isSavingTarget, setIsSavingTarget] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [trendMomentumPeriod, setTrendMomentumPeriod] = useState(10);
  const [trendShortWindow, setTrendShortWindow] = useState(14);
  const [trendLongWindow, setTrendLongWindow] = useState(50);
  const [trendOverlays, setTrendOverlays] = useState<TrendOverlayState>({
    ewma: true,  // Always show Trend-EWMA
    momentum: false,
    adx: false,
  });

  function toggleEwmaTrendOverlay() {
    setTrendOverlays((prev) => ({
      ...prev,
      ewma: !prev.ewma,
    }));
  }

  // GBM Forecast state
  const [currentForecast, setCurrentForecast] = useState<GbmForecast | ForecastRecord | null>(null);
  
  // Separate sources so GBM card never shows volatility records
  const [gbmForecast, setGbmForecast] = useState<any | null>(null);
  
  // Volatility forecast state (last volatility model run)
  const [volForecast, setVolForecast] = useState<any | null>(null);

  // Base forecast for conformal (internal, not displayed until conformal is applied)
  const [baseForecast, setBaseForecast] = useState<any | null>(null);

  // Current price state for header display
  const [headerPrice, setHeaderPrice] = useState<{ price: number | null; date: string | null }>({ price: null, date: null });
  const [priceDirection, setPriceDirection] = useState<"up" | "down" | null>(null);
  const prevPriceRef = useRef<number | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.info("[Header] quote", quote);
  }, [quote]);

  // Single source for what the "Final Prediction Intervals" card shows
  const [activeForecast, setActiveForecast] = useState<any | null>(null);
  
  // Track forecast changes for debugging
  const forecastChangeLog = useRef<Array<{timestamp: number, action: string, forecast: any}>>([]);
  const logForecastChange = (action: string, forecast: any) => {
    const entry = {timestamp: Date.now(), action, forecast: forecast ? {method: forecast.method, date_t: forecast.date_t} : null};
    forecastChangeLog.current.push(entry);
    console.log('[FORECAST_CHANGE_LOG]', entry);
    // Keep only last 10 entries
    if (forecastChangeLog.current.length > 10) {
      forecastChangeLog.current = forecastChangeLog.current.slice(-10);
    }
  };
  
  // Wrap setActiveForecast to add logging
  const setActiveForecastWithLogging = useCallback((forecast: any) => {
    logForecastChange('setActiveForecast called', forecast);
    setActiveForecast(forecast);
  }, []);
  
  // Debug: Monitor activeForecast changes for forecast overlay
  useEffect(() => {
    const timestamp = new Date().toISOString();
    console.log(`[FORECAST_OVERLAY_DEBUG] ${timestamp} activeForecast changed:`, {
      hasActiveForecast: !!activeForecast,
      activeForecastKeys: activeForecast ? Object.keys(activeForecast) : null,
      hasIntervals: !!activeForecast?.intervals,
      intervalKeys: activeForecast?.intervals ? Object.keys(activeForecast.intervals) : null,
      hasConformal: !!activeForecast?.conformal,
      method: activeForecast?.method || 'none',
      date_t: activeForecast?.date_t || 'none',
      stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
    });
  }, [activeForecast]);

  const trendEwmaCrossover = useEwmaCrossover(
    params.ticker,
    trendShortWindow,
    trendLongWindow
  );
  const headerPriceSeries = trendEwmaCrossover.priceSeries;
  const trendShortEwma = trendEwmaCrossover.shortEwma;
  const trendLongEwma = trendEwmaCrossover.longEwma;

  const trendFastWindow = trendShortWindow;
  const trendSlowWindow = trendLongWindow;

  const trendEwmaSeries = useMemo(() => {
    if (!headerPriceSeries || headerPriceSeries.length < trendSlowWindow + 5) {
      return {
        short: [] as { date: string; value: number }[],
        long: [] as { date: string; value: number }[],
        crossSignals: [] as { date: string; type: 'bullish' | 'bearish' }[],
      };
    }

    const priceRows = headerPriceSeries.map((b) => ({ date: b.date, close: b.close }));
    const shortSeries = computeEwmaSeries(priceRows, trendFastWindow);
    const longSeries = computeEwmaSeries(priceRows, trendSlowWindow);

    const crossSignals: { date: string; type: 'bullish' | 'bearish' }[] = [];
    for (let i = 1; i < shortSeries.length && i < longSeries.length; i++) {
      const prevGap = shortSeries[i - 1].value - longSeries[i - 1].value;
      const currGap = shortSeries[i].value - longSeries[i].value;
      if (prevGap <= 0 && currGap > 0) {
        crossSignals.push({ date: shortSeries[i].date, type: 'bullish' });
      } else if (prevGap >= 0 && currGap < 0) {
        crossSignals.push({ date: shortSeries[i].date, type: 'bearish' });
      }
    }

    return {
      short: shortSeries,
      long: longSeries,
      crossSignals,
    };
  }, [headerPriceSeries, trendFastWindow, trendSlowWindow]);

  // Stable forecast overlay state - use the best available forecast for chart display
  const stableOverlayForecast = useMemo(() => {
    // Priority: activeForecast > currentForecast > gbmForecast
    return activeForecast || currentForecast || gbmForecast || null;
  }, [activeForecast, currentForecast, gbmForecast, params.ticker]);
  // Note: 'window' is a browser global, not a React dependency

  // Use useState for localStorage fallback to handle SSR properly
  const [storedForecast, setStoredForecast] = useState<any>(null);
  
  // Load stored forecast on client side only
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(`overlay-forecast-${params.ticker}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          setStoredForecast(parsed);
          console.log('[FallbackForecast] Loaded stored forecast from localStorage:', parsed.method, parsed.date_t);
        }
      } catch (e) {
        // Ignore localStorage errors
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.ticker]);
  // Note: 'window' is a browser global, not a React dependency

  const [window, setWindow] = useState(504);
  const [lambdaDrift, setLambdaDrift] = useState(0.25);
  const [isGeneratingForecast, setIsGeneratingForecast] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const windowReductionLogRef = useRef<{ required: number; effective: number; canonical: number } | null>(null);
  const lastAutoForecastKeyRef = useRef<string | null>(null);
  const [autoForecastError, setAutoForecastError] = useState<string | null>(null);
  const [selectedSimRunId, setSelectedSimRunId] = useState<string | null>(null);
  const [showSimulationSettings, setShowSimulationSettings] = useState(false);
  const simulationSettingsRef = useRef<HTMLDivElement | null>(null);

  // Volatility Model state
  const [volModel, setVolModel] = useState<'GBM' | 'GARCH' | 'HAR-RV' | 'Range'>('GBM');
  const [garchEstimator, setGarchEstimator] = useState<'Normal' | 'Student-t'>('Normal');
  const [rangeEstimator, setRangeEstimator] = useState<'P' | 'GK' | 'RS' | 'YZ'>('P');
  const [garchVarianceTargeting, setGarchVarianceTargeting] = useState(true);
  const [garchDf, setGarchDf] = useState(8);
  const [harUseIntradayRv, setHarUseIntradayRv] = useState(true);
  const [rangeEwmaLambda, setRangeEwmaLambda] = useState(0.94);
  const [isVolForecastLoading, setIsVolForecastLoading] = useState(false);
  const [volForecastError, setVolForecastError] = useState<string | null>(null);
  const volInFlightRef = useRef<Set<string>>(new Set());
  const volPrefetchRunIdRef = useRef(0);
  
  // STEP 3: Bulletproof forecast storage by selection key
  const [forecastByKey, setForecastByKey] = useState<Record<string, any>>({});

  const EWMA_UNBIASED_DEFAULTS: Record<number, { lambda: number; trainFraction: number }> = {
    1: { lambda: 0.94, trainFraction: 0.7 },
    2: { lambda: 0.94, trainFraction: 0.7 },
    3: { lambda: 0.94, trainFraction: 0.7 },
    5: { lambda: 0.94, trainFraction: 0.7 },
  };
  
  // Compute stable selection key for transition tracking
  const volSelectionKey = useMemo(() => {
    return buildVolSelectionKey({
      model: volModel,
      garchEstimator,
      rangeEstimator,
      h,
      coverage,
    });
  }, [volModel, garchEstimator, rangeEstimator, h, coverage]);
  
  // GBM state for volatility models (separate from standalone GBM card)
  const [gbmWindow, setGbmWindow] = useState<number>(504);
  const [gbmLambda, setGbmLambda] = useState<number>(0);

  const DEFAULT_GARCH_WINDOW = 756;
  const DEFAULT_RANGE_WINDOW = 504;

  // Helper: Check if a forecast matches the current UI selection
  const forecastMatchesSelection = useCallback((forecast: any) => {
    if (!forecast?.method) return false;
    
    const method = forecast.method;
    
    // Check if forecast matches selected model
    if (volModel === 'GBM') {
      return method === 'GBM' || method === 'GBM-CC';
    } else if (volModel === 'GARCH') {
      const expectedMethod = garchEstimator === 'Student-t' ? 'GARCH11-t' : 'GARCH11-N';
      return method === expectedMethod;
    } else if (volModel === 'HAR-RV') {
      return method === 'HAR-RV';
    } else if (volModel === 'Range') {
      return method === `Range-${rangeEstimator}`;
    }
    
    return false;
  }, [volModel, garchEstimator, rangeEstimator]);

  // Update stableOverlayForecast to filter by matching forecasts
  const stableOverlayForecastFiltered = useMemo(() => {
    const candidates = [activeForecast, currentForecast, gbmForecast].filter(Boolean);
    const matchingForecast = candidates.find(f => forecastMatchesSelection(f));
    
    // ============================================================================
    // STEP 1 DIAGNOSTIC: Log forecast selection/matching logic
    // ============================================================================
    if (process.env.NODE_ENV === "development") {
      console.log('[🔍 STEP1-SELECTION]', {
        selectedVolModel: volModel,
        selectedRangeEstimator: rangeEstimator,
        selectedGarchEstimator: garchEstimator,
        candidateForecastMethods: candidates.map(f => f?.method || 'NONE'),
        activeForecastMethod: activeForecast?.method || 'NONE',
        currentForecastMethod: currentForecast?.method || 'NONE',
        gbmForecastMethod: gbmForecast?.method || 'NONE',
        matchingForecastMethod: matchingForecast?.method || 'NO MATCH',
        expectedMatchPattern: volModel === 'Range' ? `Range-${rangeEstimator}` :
                             volModel === 'GARCH' ? (garchEstimator === 'Student-t' ? 'GARCH11-t' : 'GARCH11-N') :
                             volModel === 'HAR-RV' ? 'HAR-RV' : 'GBM/GBM-CC',
        matchFound: !!matchingForecast,
        timestamp: new Date().toISOString(),
      });
    }
    
    return matchingForecast || null;
  }, [activeForecast, currentForecast, gbmForecast, forecastMatchesSelection, volModel, rangeEstimator, garchEstimator]);

  // Fallback overlay forecast - only use stored forecast if it matches current selection
  const fallbackOverlayForecast = useMemo(() => {
    if (stableOverlayForecastFiltered) return stableOverlayForecastFiltered;
    // Check if stored forecast matches current selection before using it
    if (storedForecast && forecastMatchesSelection(storedForecast)) {
      return storedForecast;
    }
    return null;
  }, [stableOverlayForecastFiltered, storedForecast, forecastMatchesSelection]);

  // Persist overlay forecast outside of useMemo to keep memo pure
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!stableOverlayForecastFiltered) return;
    try {
      localStorage.setItem(`overlay-forecast-${params.ticker}`, JSON.stringify(stableOverlayForecastFiltered));
    } catch {
      // Ignore localStorage errors
    }
  }, [stableOverlayForecastFiltered, params.ticker]);
  
  // Volatility window state - softer defaults for GARCH/Range, can be manually set or synced with GBM
  const [volWindow, setVolWindow] = useState(DEFAULT_GARCH_WINDOW);
  const [volWindowAutoSync, setVolWindowAutoSync] = useState(false); // Default to manual (1000) not auto-sync
  const [rvAvailable, setRvAvailable] = useState<boolean>(false);
  const [isGeneratingVolatility, setIsGeneratingVolatility] = useState(false);
  const [volatilityError, setVolatilityError] = useState<string | null>(null);
  const [modelAvailabilityMessage, setModelAvailabilityMessage] = useState<string | null>(null);
  // Adjust default volatility window when switching models to avoid overly aggressive defaults
  useEffect(() => {
    if (volModel === 'GARCH' && volWindow > DEFAULT_GARCH_WINDOW) {
      setVolWindow(DEFAULT_GARCH_WINDOW);
    } else if (volModel === 'Range' && volWindow > DEFAULT_RANGE_WINDOW) {
      setVolWindow(DEFAULT_RANGE_WINDOW);
    }
  }, [volModel, volWindow]);
  
  // Track when horizon changes but forecast hasn't been regenerated
  const [forecastHorizonMismatch, setForecastHorizonMismatch] = useState(false);

  // EWMA Reaction Map state
  type ReactionBucketSummary = {
    bucketId: string;
    horizon: number;
    nObs: number;
    pUp: number;
    meanReturn: number;
    stdReturn: number;
  };

  type ReactionMapSummary = {
    trainStart: string;
    trainEnd: string;
    testStart: string;
    testEnd: string;
    nTrain: number;
    nTest: number;
    buckets: ReactionBucketSummary[];
  };

  type ZOptimizeResult = {
    thresholds: {
      enterLong: number;
      enterShort: number;
      exitLong: number;
      exitShort: number;
      flipLong: number;
      flipShort: number;
    };
    quantiles: { enter: number; exit: number; flip: number };
    meanScore: number;
    folds: number;
    avgTradeCount: number;
    avgShortOppCount: number;
    totalShortEntries?: number;
    applyRecommended: boolean;
    baselineScore: number;
    bestScore: number;
    reason?: string;
    selectionTier: "strict" | "bestEffort" | "fallbackAuto";
    strictPass: boolean;
    recencyPass: boolean;
    failedConstraints?: string[];
    recency?: any;
  };

  const [reactionMapSummary, setReactionMapSummary] = useState<ReactionMapSummary | null>(null);
  const [isLoadingReaction, setIsLoadingReaction] = useState(false);
  const [reactionError, setReactionError] = useState<string | null>(null);
  const [reactionLambda, setReactionLambda] = useState(0.94);
  // Coverage and Horizon for Reaction Map now come from main controls:
  // - coverage (main Timing coverage)
  // - h (main Timing horizon)
  const [reactionTrainFraction, setReactionTrainFraction] = useState(0.7);
  const [reactionMinTrainObs, setReactionMinTrainObs] = useState(500);

  // Biased Max lambda-only optimization state
  type EwmaOptimizationResult = {
    lambda: number;
    trainFraction: number;
    directionHitRate: number;
    coverage: number;
    intervalScore: number;
    avgWidth: number;
    neutralDirectionHitRate: number;
    neutralIntervalScore: number;
    zEnterUsed: number;
    shortOpportunityRate: number;
  };
  type EwmaOptimizationCandidate = EwmaOptimizationResult;
  type EwmaOptimizationNeutralSummary = {
    lambda: number;
    directionHitRate: number;
    intervalScore: number;
    coverage: number;
    avgWidth: number;
  };
  type BiasedMaxCalmarResult = {
    lambdaStar: number | null;
    calmarScore: number;
    trainSpan: { start: string; end: string } | null;
    updatedAt: string | null;
    cacheHit?: boolean;
    cacheStale?: boolean;
    staleDays?: number | null;
    objective?: string | null;
    note?: string | null;
    noTrade?: boolean;
    rangeStartUsed?: string | null;
    trainEndUsed?: string | null;
  };
  const [biasedMaxObjective, setBiasedMaxObjective] = useState<"calmar">("calmar");
  const [reactionOptimizationBest, setReactionOptimizationBest] = useState<EwmaOptimizationResult | null>(null);
  const [, setReactionOptimizationCandidates] = useState<EwmaOptimizationResult[]>([]);
  const [, setReactionOptimizationNeutral] = useState<EwmaOptimizationNeutralSummary | null>(null);
  const [biasedMaxCalmarResult, setBiasedMaxCalmarResult] = useState<BiasedMaxCalmarResult | null>(null);
  const [biasedMaxCalmarError, setBiasedMaxCalmarError] = useState<string | null>(null);
  const [isLoadingBiasedMaxCalmar, setIsLoadingBiasedMaxCalmar] = useState(false);
  const [cfdCanonicalRows, setCfdCanonicalRows] = useState<CanonicalRow[] | null>(null);
  const isFetchingCanonicalRowsRef = useRef(false);
  const canonicalRowsPromiseRef = useRef<Promise<CanonicalRow[] | null> | null>(null);
  const canonicalFetchAbortRef = useRef<AbortController | null>(null);
  const canonicalFetchKeyBase = useMemo(() => `${params.ticker}|1d|adj`, [params.ticker]);
  const canonicalRowsKeyRef = useRef<string | null>(null);
  const userHasSetWindowRef = useRef(false);
  const derivedMaxTrainFraction = useMemo(() => {
    if (!biasedMaxCalmarResult?.trainSpan) return null;
    const rows = cfdCanonicalRows;
    if (!rows || rows.length === 0) return null;
    const trainEnd = biasedMaxCalmarResult.trainSpan.end;
    const cutoffIdx = rows.findIndex((r) => r.date > trainEnd);
    const trainCount = cutoffIdx === -1 ? rows.length : cutoffIdx;
    if (trainCount <= 0) return null;
    const frac = trainCount / rows.length;
    if (!Number.isFinite(frac)) return null;
    return Math.min(0.99, Math.max(0.01, frac));
  }, [biasedMaxCalmarResult?.trainSpan, cfdCanonicalRows]);

  const getMaxEwmaConfig = useCallback(() => {
    if (biasedMaxCalmarResult) {
      if (biasedMaxCalmarResult.lambdaStar == null) {
        return null;
      }
      return {
        lambda: biasedMaxCalmarResult.lambdaStar,
        trainFraction: derivedMaxTrainFraction ?? reactionTrainFraction,
      };
    }
    if (reactionOptimizationBest) {
      return {
        lambda: reactionOptimizationBest.lambda,
        trainFraction: reactionTrainFraction,
      };
    }
    return {
      lambda: reactionLambda,
      trainFraction: reactionTrainFraction,
    };
  }, [biasedMaxCalmarResult, derivedMaxTrainFraction, reactionOptimizationBest, reactionLambda, reactionTrainFraction]);

  const [isOptimizingReaction, setIsOptimizingReaction] = useState(false);
  const [isReactionMaximized, setIsReactionMaximized] = useState(false);  // Track if Biased has been optimized
  const [, setReactionOptimizeError] = useState<string | null>(null);
  type BaseMode = 'unbiased' | 'biased' | 'max';

  const fetchCanonicalRows = useCallback(async (): Promise<CanonicalRow[] | null> => {
    if (cfdCanonicalRows && cfdCanonicalRows.length > 0) return cfdCanonicalRows;
    if (canonicalRowsPromiseRef.current && canonicalRowsKeyRef.current === canonicalFetchKeyBase) {
      return canonicalRowsPromiseRef.current;
    }
    canonicalRowsKeyRef.current = canonicalFetchKeyBase;
    const promise = (async () => {
      try {
        if (canonicalFetchAbortRef.current) {
          canonicalFetchAbortRef.current.abort();
        }
        const aborter = new AbortController();
        canonicalFetchAbortRef.current = aborter;
        isFetchingCanonicalRowsRef.current = true;
        const resp = await fetch(`/api/history/${encodeURIComponent(params.ticker)}`, {
          signal: aborter.signal,
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        const rows = Array.isArray(data?.rows)
          ? data.rows
          : Array.isArray(data)
            ? data
            : [];
        if (Array.isArray(rows) && rows.length > 0) {
          setCfdCanonicalRows(rows as CanonicalRow[]);
          return rows as CanonicalRow[];
        }
      } catch (err) {
        if (process.env.NODE_ENV === "development") {
          console.error("[CanonicalRows] fetch error", err);
        }
      } finally {
        isFetchingCanonicalRowsRef.current = false;
        canonicalRowsPromiseRef.current = null;
        canonicalFetchAbortRef.current = null;
        canonicalRowsKeyRef.current = null;
      }
      return null;
    })();
    canonicalRowsPromiseRef.current = promise;
    return promise;
  }, [canonicalFetchKeyBase, params.ticker, cfdCanonicalRows]);

  useEffect(() => {
    if (cfdCanonicalRows && cfdCanonicalRows.length > 0) return;
    fetchCanonicalRows();
  }, [fetchCanonicalRows, cfdCanonicalRows]);

  interface SimulationMode {
    baseMode: BaseMode;
    withTrend: boolean;
  }

  type SimCostConfig = {
    spreadBps?: number;
    feeBps?: number;
    fxBps?: number;
    slippageBps?: number;
  };

  const simCostDefaults: SimCostConfig = {
    spreadBps: 5,
    feeBps: 0,
    fxBps: 0,
    slippageBps: 0,
  };

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

  function estimateDefaultThresholdPct(costs: SimCostConfig): number {
    const spread = costs.spreadBps ?? 0;
    const fee = costs.feeBps ?? 0;
    const fx = costs.fxBps ?? 0;
    const slippage = costs.slippageBps ?? 0;
    const roundTripPct = (2 * (spread + fee + fx + slippage)) / 10000; // convert bps to decimal pct
    const buffered = roundTripPct + 0.0001; // small buffer (~1 bp) to avoid churn
    const fallback = 0.001; // 10 bps = 0.10%
    const candidate = Number.isFinite(buffered) ? buffered : fallback;
    return clamp(candidate, 0.0002, 0.005); // 2–50 bps
  }

  const [trendWeight, setTrendWeight] = useState<number | null>(null);
  const [trendWeightUpdatedAt, setTrendWeightUpdatedAt] = useState<string | null>(null);
  const [simulationMode, setSimulationMode] = useState<SimulationMode>({
    baseMode: 'biased',
    withTrend: false,
  });
  const effectiveTrendWeight = useMemo(() => {
    if (trendWeight != null && Math.abs(trendWeight) >= 0.005) {
      return trendWeight;
    }
    return 0.05;
  }, [trendWeight]);
  const resolveRunIdForMode = useCallback(
    (mode: SimulationMode): CfdRunId => {
      if (mode.baseMode === "unbiased") return "ewma-unbiased";
      if (mode.baseMode === "max") {
        return mode.withTrend ? "ewma-biased-max-trend" : "ewma-biased-max";
      }
      return mode.withTrend ? "ewma-biased-trend" : "ewma-biased";
    },
    []
  );

  // Cfd CFD Simulation state
  const [isCfdEnabled, setIsCfdEnabled] = useState(true);  // CFD simulation toggle
  
  const [cfdInitialEquity, setCfdInitialEquity] = useState(1000);
  const [cfdLeverage, setCfdLeverage] = useState(5);
  const [cfdPositionFraction, setCfdPositionFraction] = useState(0.25); // 25% default
  // Fractional threshold (e.g., 0.001 = 0.10%) used for no-trade band
  const [cfdThresholdFrac, setCfdThresholdFrac] = useState<number>(() => estimateDefaultThresholdPct(simCostDefaults));
  const [cfdCostBps, setCfdCostBps] = useState<number>(0);
  const [ewmaShrinkK, setEwmaShrinkK] = useState<number>(0.5);
  const [cfdSignalRule, setCfdSignalRule] = useState<"bps" | "z">("z");
  const [cfdZMode, setCfdZMode] = useState<"auto" | "manual" | "optimize">("optimize");
  const [cfdZEnter, setCfdZEnter] = useState(0.3);
  const [cfdZExit, setCfdZExit] = useState(0.1);
  const [cfdZFlip, setCfdZFlip] = useState(0.6);
  const [cfdZOptimizeResult, setCfdZOptimizeResult] = useState<ZOptimizeResult | null>(null);
  const [isOptimizingZThresholds, setIsOptimizingZThresholds] = useState(false);
  const [cfdZOptimizeError, setCfdZOptimizeError] = useState<string | null>(null);
  const [cfdZDisplayThresholds, setCfdZDisplayThresholds] = useState<ZOptimizeResult["thresholds"] | null>(null);
  const cfdZOptimizeFailedRef = useRef(false);
  const [cfdDailyLongSwap, setCfdDailyLongSwap] = useState(0);  // can tune later
  const [cfdDailyShortSwap, setCfdDailyShortSwap] = useState(0);
  const [isRunningCfdSim, setIsRunningCfdSim] = useState(false);
  const [cfdError, setCfdError] = useState<string | null>(null);
  // Cfd Simulation Runs - multiple scenarios for comparison
  type CfdRunId =
    | "ewma-unbiased"
    | "ewma-biased"
    | "ewma-biased-max"
    | "ewma-biased-trend"
    | "ewma-biased-max-trend";

  type CfdSimRun = {
    id: CfdRunId;
    label: string;
    signalSource: "unbiased" | "biased";
    result: CfdSimulationResult;
    bars: CfdSimBar[];
    configSnapshot: CfdSimConfig;
    initialEquity: number;
    windowResult?: WindowSimResult | null;
    lambda?: number;
    trainFraction?: number;
    trendTiltEnabled?: boolean;
    strategyStartDate?: string | null;
  };

  type StrategyKey = "unbiased" | "biased" | "biased-max";
  type BaseRunId = "ewma-unbiased" | "ewma-biased" | "ewma-biased-max";
  type CfdBaseRunsById = Partial<Record<BaseRunId, CfdSimRun>>;
  type SimCompareRangePreset =
    | "chart"
    | "1d"
    | "5d"
    | "1m"
    | "3m"
    | "6m"
    | "ytd"
    | "1y"
    | "5y"
    | "all"
    | "custom";

  type FilteredStats = {
    days: number;
    firstDate: string;
    lastDate: string;
    returnPct: number;
    maxDrawdown: number;
    tradeCount: number;
    stopOutEvents: number;
  };

  type SimulationStrategySummary = SimulationRunSummary;
  type SimResultCacheEntry = {
    accountHistory: CfdAccountSnapshot[];
    initialEquity: number;
    trades: CfdTrade[];
  };

  // Type for trade overlays passed to PriceChart
  type CfdTradeOverlay = {
    runId: CfdRunId;
    label: string;
    color: string; // hex color for this run
    trades: CfdTrade[];
  };

  const [cfdRuns, setCfdRuns] = useState<CfdSimRun[]>([]);
  const [cfdBaseRunsById, setCfdBaseRunsById] = useState<CfdBaseRunsById>({});
  const [cfdCurrentRunId, setCfdCurrentRunId] = useState<CfdRunId | null>(null);
  const [cfdVisibleRunIds, setCfdVisibleRunIds] = useState<Set<CfdRunId>>(() => new Set());
  const [simComparePreset, setSimComparePreset] = useState<SimCompareRangePreset>("chart");
  const [, setSimCompareCustom] = useState<{ start: string; end: string } | null>(null);
  const [visibleWindow, setVisibleWindow] = useState<{ start: string; end: string } | null>(null);
  const cfdRunsRef = useRef<CfdSimRun[]>([]);
  const defaultWindowSeededRef = useRef(false);
  const baselineVerifyLoggedRef = useRef(false);

  useEffect(() => {
    cfdRunsRef.current = cfdRuns;
  }, [cfdRuns]);
  useEffect(() => {
    defaultWindowSeededRef.current = false;
  }, [params.ticker]);
  const handleSimComparePresetChange = useCallback((p: SimCompareRangePreset) => {
    setSimComparePreset(p);
  }, []);
  const handleSimCompareCustomChange = useCallback((start: string, end: string) => {
    if (!start || !end) return;
    setSimCompareCustom({ start, end });
    setSimComparePreset("custom");
  }, []);
  const handleVisibleWindowChange = useCallback(
    (
      nextWindow: { start: string; end: string } | null,
      source: "chart" | "pill" | "dropdown"
    ) => {
      if (source === "chart" || source === "pill") {
        setSimComparePreset("chart");
        setSimCompareCustom(null);
      } else if (source === "dropdown" && nextWindow) {
        setSimCompareCustom(nextWindow);
      }
      const isInitialSeed = !defaultWindowSeededRef.current && !visibleWindow;
      if (!isInitialSeed && nextWindow) {
        userHasSetWindowRef.current = true;
      }
      setVisibleWindow(nextWindow);
    },
    [visibleWindow]
  );
  useEffect(() => {
    setVisibleWindow(null);
    setSimCompareCustom(null);
    setSimComparePreset("chart");
    setBiasedMaxCalmarResult(null);
    setBiasedMaxCalmarError(null);
    setCfdCanonicalRows(null);
    canonicalRowsPromiseRef.current = null;
    canonicalFetchAbortRef.current?.abort();
    canonicalFetchAbortRef.current = null;
    baselineVerifyLoggedRef.current = false;
    userHasSetWindowRef.current = false;
  }, [params.ticker]);

  useEffect(() => {
    if (visibleWindow) {
      defaultWindowSeededRef.current = true;
      return;
    }
    if (defaultWindowSeededRef.current) return;
    if (userHasSetWindowRef.current) return;
    if (!cfdCanonicalRows || cfdCanonicalRows.length === 0) return;
    const end = cfdCanonicalRows[cfdCanonicalRows.length - 1]?.date;
    const startIdx = Math.max(0, cfdCanonicalRows.length - 252);
    const start = cfdCanonicalRows[startIdx]?.date ?? cfdCanonicalRows[0]?.date ?? null;
    if (!start || !end) return;
    defaultWindowSeededRef.current = true;
    setVisibleWindow({ start, end });
  }, [visibleWindow, cfdCanonicalRows]);

  useEffect(() => {
    setCfdRuns((prev) =>
      prev.map((run) => ({
        ...run,
        windowResult: visibleWindow
          ? computeWindowSimFromBars(
              run.bars,
              visibleWindow,
              run.initialEquity,
              run.configSnapshot,
              run.strategyStartDate ?? null
            )
          : null,
      }))
    );
  }, [visibleWindow]);

  useEffect(() => {
    setCfdZOptimizeResult(null);
    setCfdZOptimizeError(null);
    setIsOptimizingZThresholds(false);
  }, [params.ticker]);

  useEffect(() => {
    setCfdBaseRunsById((prev) => {
      const next: CfdBaseRunsById = { ...prev };
      const replace = (id: BaseRunId) => {
        const found = cfdRuns.find((r) => r.id === id);
        if (found) {
          next[id] = found;
        }
      };
      replace("ewma-unbiased");
      replace("ewma-biased");
      replace("ewma-biased-max");
      return next;
    });
  }, [cfdRuns]);

  useEffect(() => {
    if (cfdZMode === "manual") {
      setCfdZDisplayThresholds({
        enterLong: cfdZEnter,
        enterShort: cfdZEnter,
        exitLong: cfdZExit,
        exitShort: cfdZExit,
        flipLong: cfdZFlip,
        flipShort: cfdZFlip,
      });
    }
  }, [cfdZMode, cfdZEnter, cfdZExit, cfdZFlip]);
  const hasMaxRun = useMemo(
    () => cfdRuns.some((r) => r.id === "ewma-biased-max" || r.id === "ewma-biased-max-trend"),
    [cfdRuns]
  );
  const comparisonRunIds: BaseRunId[] = useMemo(
    () => ["ewma-unbiased", "ewma-biased", "ewma-biased-max"],
    []
  );
  const comparisonRowSpecs: { key: StrategyKey; label: string; id: BaseRunId }[] = useMemo(
    () => [
      { key: "unbiased", label: "EWMA Unbiased", id: "ewma-unbiased" },
      { key: "biased", label: "EWMA Biased", id: "ewma-biased" },
      { key: "biased-max", label: "EWMA Biased (Max)", id: "ewma-biased-max" },
    ],
    []
  );
  const activeCfdRunId = useMemo(
    () => (cfdVisibleRunIds.size > 0 ? Array.from(cfdVisibleRunIds)[0] : null),
    [cfdVisibleRunIds]
  );
  const referenceSimRun = useMemo(
    () =>
      cfdBaseRunsById["ewma-biased"] ??
      cfdBaseRunsById["ewma-biased-max"] ??
      cfdBaseRunsById["ewma-unbiased"] ??
      null,
    [cfdBaseRunsById]
  );
  const summarizeRunStats = useCallback(
    (run: CfdSimRun, window?: { start: string; end: string } | null): FilteredStats | null => {
      const baseResult =
        window && run.windowResult?.result ? run.windowResult.result : run.result;
      const history = baseResult.accountHistory;
      if (!history || history.length === 0) {
        return null;
      }

      const runStart = history[0]?.date;
      const runEnd = history[history.length - 1]?.date;
      if (!runStart || !runEnd) {
        return null;
      }

      const clampedWindow = window
        ? {
            start: window.start > runStart ? window.start : runStart,
            end: window.end < runEnd ? window.end : runEnd,
          }
        : { start: runStart, end: runEnd };

      if (clampedWindow.start > clampedWindow.end) {
        return null;
      }

      const startIdx = history.findIndex((snap) => snap.date >= clampedWindow.start);
      if (startIdx === -1) {
        return null;
      }

      let endIdx = history.length - 1;
      for (let i = history.length - 1; i >= startIdx; i--) {
        if (history[i].date <= clampedWindow.end) {
          endIdx = i;
          break;
        }
      }

      if (endIdx < startIdx) {
        return null;
      }

      const slice = history.slice(startIdx, endIdx + 1);
      if (slice.length === 0) {
        return null;
      }

      const first = slice[0];
      const last = slice[slice.length - 1];
      const initialEquity = first?.equity ?? 0;
      const lastEquity = last?.equity ?? 0;
      const returnPct = initialEquity > 0 ? (lastEquity - initialEquity) / initialEquity : 0;

      const maxDrawdown = (() => {
        let peak = slice[0].equity;
        let maxDd = 0;
        for (const snap of slice) {
          if (snap.equity > peak) {
            peak = snap.equity;
          }
          const dd = peak > 0 ? (peak - snap.equity) / peak : 0;
          if (dd > maxDd) {
            maxDd = dd;
          }
        }
        return maxDd;
      })();

      let openedTrades = 0;
      let prevSide: CfdAccountSnapshot["side"] | null =
        startIdx > 0 ? history[startIdx - 1]?.side ?? null : null;
      for (let i = startIdx; i <= endIdx; i++) {
        const side = history[i].side;
        if (side && side !== prevSide) {
          openedTrades++;
        }
        prevSide = side;
      }

      const closedTradesCount = baseResult.trades.filter(
        (t) => t.entryDate >= first.date && t.entryDate <= last.date
      ).length;
      const tradeCount = Math.max(openedTrades, closedTradesCount);

      let stopOutEvents = 0;
      if (Array.isArray(baseResult.stopOutDates) && baseResult.stopOutDates.length > 0) {
        stopOutEvents = baseResult.stopOutDates.filter(
          (d) => d >= first.date && d <= last.date
        ).length;
      } else if (!window || (clampedWindow.start === runStart && clampedWindow.end === runEnd)) {
        stopOutEvents = baseResult.stopOutEvents ?? 0;
      }

      return {
        days: slice.length,
        firstDate: first?.date ?? "—",
        lastDate: last?.date ?? "—",
        returnPct,
        maxDrawdown,
        tradeCount,
        stopOutEvents,
      };
    },
    []
  );

  const handleChangeSimulationMode = useCallback(
    (mode: SimulationMode) => {
      // Update simulationMode immutably
      setSimulationMode((prev) => {
        console.log("[SIM-CLICK] before", { prev, requested: mode });
        if (prev.baseMode === mode.baseMode && prev.withTrend === mode.withTrend) {
          console.log("[SIM-CLICK] after (unchanged)", prev);
          return prev;
        }
        const nextMode = { ...mode };
        console.log("[SIM-CLICK] after", nextMode);
        return nextMode;
      });

      // If runs already exist, immediately switch visible run
      setCfdVisibleRunIds((prevVisible) => {
        if (cfdRuns.length === 0) {
          // No runs yet; let the sync effect handle initial selection
          return prevVisible;
        }

        const desired = resolveRunIdForMode(mode);
        const fallbackForMode: CfdRunId =
          mode.baseMode === "max"
            ? "ewma-biased-max"
            : mode.baseMode === "unbiased"
              ? "ewma-unbiased"
              : "ewma-biased";

        const runIds = new Set(cfdRuns.map((r) => r.id));
        let chosen: CfdRunId | null = null;

        if (runIds.has(desired)) {
          chosen = desired;
        } else if (runIds.has(fallbackForMode)) {
          chosen = fallbackForMode;
        } else if (runIds.has("ewma-biased")) {
          chosen = "ewma-biased";
        } else if (runIds.has("ewma-unbiased")) {
          chosen = "ewma-unbiased";
        } else if (cfdRuns.length > 0) {
          chosen = cfdRuns[0].id;
        }

        if (!chosen) {
          return prevVisible;
        }

        const next = new Set<CfdRunId>([chosen]);
        console.log(
          "[SIM-CLICK] set visible run to",
          chosen,
          "for baseMode",
          mode.baseMode,
          "withTrend",
          mode.withTrend
        );
        return next;
      });
    },
    [resolveRunIdForMode, cfdRuns]
  );

  const { momentum: chartMomentum, adx: chartAdx } = useTrendIndicators(params.ticker, { momentumPeriod: trendMomentumPeriod });

  // State for Yahoo Finance sync
  const [isYahooSyncing, setIsYahooSyncing] = useState(false);
  const [yahooSyncError, setYahooSyncError] = useState<string | null>(null);

  // Toggle visibility of a Cfd run on the chart (solo mode: only one run visible at a time)
  const toggleCfdRunVisibility = useCallback((runId: CfdRunId) => {
    setCfdVisibleRunIds(new Set<CfdRunId>([runId]));
  }, []);

  // Build trade overlays for visible runs to pass to PriceChart
  const cfdTradeOverlays: CfdTradeOverlay[] = useMemo(() => {
    const runColors: Record<CfdRunId, string> = {
      "ewma-unbiased": "#9CA3AF",     // gray-400
      "ewma-biased": "#3B82F6",       // blue-500
      "ewma-biased-max": "#F59E0B",   // amber-500
      "ewma-biased-trend": "#2563EB", // blue-600
      "ewma-biased-max-trend": "#D97706", // amber-600
    };
    return cfdRuns
      .filter((run) => cfdVisibleRunIds.has(run.id))
      .map((run) => ({
        runId: run.id,
        label: run.label,
        color: runColors[run.id],
        trades: run.windowResult?.result?.trades ?? run.result.trades,
      }));
  }, [cfdRuns, cfdVisibleRunIds, visibleWindow]);

  // Active run (solo mode) for equity chart
  const cfdActiveRun = useMemo(() => {
    console.log("[INIT-ACCOUNT] activeRunId=", activeCfdRunId, "visibleSet=", Array.from(cfdVisibleRunIds), "cfdRuns ids=", cfdRuns.map((r) => r.id));
    return activeCfdRunId
      ? cfdRuns.find((run) => run.id === activeCfdRunId) ?? null
      : cfdRuns.find((run) => cfdVisibleRunIds.has(run.id)) ?? null;
  }, [cfdRuns, activeCfdRunId, cfdVisibleRunIds]);

  const cfdAccountHistory: CfdAccountSnapshot[] | null = useMemo(() => {
    const res = cfdActiveRun?.windowResult?.result ?? null;
    return res?.accountHistory ?? null;
  }, [cfdActiveRun]);

  const cfdActiveTrades: CfdTrade[] | null = useMemo(() => {
    const res = cfdActiveRun?.windowResult?.result ?? null;
    return res?.trades ?? null;
  }, [cfdActiveRun]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (cfdRuns.length === 0) return;
    if (baselineVerifyLoggedRef.current) return;
    const visibleIds = Array.from(cfdVisibleRunIds);
    const overlaysCount = cfdTradeOverlays.length;
    const equityLen = cfdAccountHistory?.length ?? 0;
    console.log("[Cfd DEV VERIFY] baseline seeded", {
      runCount: cfdRuns.length,
      visibleIds,
      overlaysCount,
      equityLen,
    });
    if (visibleIds.length === 0 || overlaysCount === 0 || equityLen === 0) {
      console.warn("[Cfd DEV VERIFY] baseline incomplete", {
        visibleIds,
        overlaysCount,
        equityLen,
      });
    }
    baselineVerifyLoggedRef.current = true;
  }, [cfdRuns, cfdVisibleRunIds, cfdTradeOverlays, cfdAccountHistory]);

  // Keep visible run in sync with SimulationMode and available runs
  useEffect(() => {
    console.log(
      "[INIT-VISIBLE] baseMode=",
      simulationMode.baseMode,
      "withTrend=",
      simulationMode.withTrend,
      "cfdRuns ids=",
      cfdRuns.map((r) => r.id)
    );
    if (cfdRuns.length === 0) return;

    const desiredRunId = resolveRunIdForMode(simulationMode);
    const fallbackForMode: CfdRunId =
      simulationMode.baseMode === "max"
        ? "ewma-biased-max"
        : simulationMode.baseMode === "unbiased"
          ? "ewma-unbiased"
          : "ewma-biased";

    const runIds = new Set(cfdRuns.map((r) => r.id));

    let chosen: CfdRunId | null = null;

    if (runIds.has(desiredRunId)) {
      chosen = desiredRunId;
    } else if (runIds.has(fallbackForMode)) {
      chosen = fallbackForMode;
    } else if (runIds.has("ewma-biased")) {
      chosen = "ewma-biased";
    } else if (runIds.has("ewma-unbiased")) {
      chosen = "ewma-unbiased";
    } else {
      chosen = cfdRuns[0].id;
    }

    if (chosen != null && !(cfdVisibleRunIds.size === 1 && cfdVisibleRunIds.has(chosen))) {
      console.log("[INIT-VISIBLE] sync visible run to", chosen);
      setCfdVisibleRunIds(new Set<CfdRunId>([chosen]));
    }
  }, [resolveRunIdForMode, simulationMode, cfdRuns, cfdVisibleRunIds]);

  const { rows: simulationRunsSummary, simResultsById } = useMemo(() => {
    const windowedRows = getWindowedRows(cfdCanonicalRows, visibleWindow);
    const asOfRow = windowedRows.length > 0 ? windowedRows[windowedRows.length - 1] : null;
    const asOfDate = asOfRow?.date ?? null;
    const prices: number[] = [];
    for (const row of windowedRows) {
      const p = toNum(row.adj_close ?? row.close);
      if (p != null && p > 0) {
        prices.push(p);
      }
    }
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const prev = prices[i - 1];
      const curr = prices[i];
      if (prev > 0 && curr > 0) {
        returns.push(Math.log(curr / prev));
      }
    }

    const sharedVolatility: VolBundle = {
      gbm: toVolCell(
        forecastByKey[
          buildVolSelectionKey({ model: "GBM", h, coverage })
        ]
      ),
      garchNormal: toVolCell(
        forecastByKey[
          buildVolSelectionKey({ model: "GARCH", garchEstimator: "Normal", h, coverage })
        ]
      ),
      garchStudent: toVolCell(
        forecastByKey[
          buildVolSelectionKey({ model: "GARCH", garchEstimator: "Student-t", h, coverage })
        ]
      ),
      harRv: toVolCell(
        forecastByKey[
          buildVolSelectionKey({ model: "HAR-RV", h, coverage })
        ]
      ),
      rangeParkinson: toVolCell(
        forecastByKey[
          buildVolSelectionKey({ model: "Range", rangeEstimator: "P", h, coverage })
        ]
      ),
      rangeGarmanKlass: toVolCell(
        forecastByKey[
          buildVolSelectionKey({ model: "Range", rangeEstimator: "GK", h, coverage })
        ]
      ),
      rangeRogersSatchell: toVolCell(
        forecastByKey[
          buildVolSelectionKey({ model: "Range", rangeEstimator: "RS", h, coverage })
        ]
      ),
      rangeYangZhang: toVolCell(
        forecastByKey[
          buildVolSelectionKey({ model: "Range", rangeEstimator: "YZ", h, coverage })
        ]
      ),
    };

    const simResultMap: Record<string, SimResultCacheEntry> = {};
    const storeSimResult = (
      id: string,
      result?: CfdSimulationResult | null,
      fallbackInitialEquity?: number | null
    ) => {
      if (!result) return;
      const initialEquity =
        (Number.isFinite(result.initialEquity) ? result.initialEquity : undefined) ??
        (fallbackInitialEquity ?? undefined) ??
        cfdInitialEquity;
      simResultMap[id] = {
        accountHistory: result.accountHistory ?? [],
        initialEquity,
        trades: result.trades ?? [],
      };
    };

    const rows: SimulationStrategySummary[] = comparisonRowSpecs.map((spec, idx) => {
      const run = cfdBaseRunsById[spec.id];
      const stats = run ? summarizeRunStats(run, visibleWindow) : null;
      const defaults = EWMA_UNBIASED_DEFAULTS[h] ?? { lambda: 0.94, trainFraction: 0.7 };
      const isUnbiased = spec.key === "unbiased" || /unbiased/i.test(spec.label);
      const isBiasedMax = spec.key === "biased-max";
      const canonicalId = spec.key;
      const baseResult = run?.windowResult?.result ?? run?.result ?? null;

      if (!isUnbiased) {
        storeSimResult(canonicalId, baseResult, run?.initialEquity);
      }

      let lambdaUsed = isUnbiased
        ? (run?.lambda ?? defaults.lambda)
        : (run?.lambda ?? reactionLambda ?? 0.94);
      let trainFracUsed = isUnbiased
        ? (run?.trainFraction ?? defaults.trainFraction)
        : (run?.trainFraction ?? reactionTrainFraction ?? 0.7);

      if (isBiasedMax) {
        lambdaUsed = run?.lambda ?? biasedMaxCalmarResult?.lambdaStar ?? lambdaUsed;
        trainFracUsed = run?.trainFraction ?? derivedMaxTrainFraction ?? trainFracUsed;
      }

      let horizonForecast = undefined as SimulationStrategySummary["horizonForecast"];
      let ewmaExpectedReturnPct: number | undefined = undefined;
      let perfMetrics: Partial<SimulationStrategySummary> | undefined = undefined;
      if (
        returns.length >= 2 &&
        asOfRow &&
        asOfRow.date &&
        (asOfRow.adj_close != null || asOfRow.close != null)
      ) {
        const trainN = Math.max(2, Math.floor(trainFracUsed * returns.length));
        const trainReturns = returns.slice(-trainN);
        if (trainReturns.length >= 2) {
        const muLog = mean(trainReturns);
        let sigma2 = variance(trainReturns, muLog);
        if (!Number.isFinite(sigma2)) {
          sigma2 = 0;
        }
        for (const r of trainReturns) {
          const e = r - muLog;
          sigma2 = lambdaUsed * sigma2 + (1 - lambdaUsed) * (e * e);
        }
        const sigmaHat = Math.sqrt(Math.max(sigma2, 0));
        const muHat = muLog + 0.5 * sigmaHat * sigmaHat;
        const muStarUsed = lambdaUsed * muHat;
        const S0 = toNum(asOfRow.adj_close ?? asOfRow.close);
        if (S0 != null && S0 > 0 && Number.isFinite(muStarUsed) && Number.isFinite(sigmaHat)) {
          const interval = computeGbmInterval({
            S_t: S0,
            muStarUsed,
            sigmaHat,
            h_trading: h,
            coverage,
          });
          const expected = S0 * Math.exp(muStarUsed * h);
          horizonForecast = {
            expected: Number.isFinite(expected) ? expected : undefined,
            lower: Number.isFinite(interval.L_h) ? interval.L_h : undefined,
            upper: Number.isFinite(interval.U_h) ? interval.U_h : undefined,
            asOfDate: asOfDate ?? undefined,
            mu: muStarUsed,
            sigma1d: sigmaHat,
          };
        }
        }
        // Compute EWMA expected-based return for Unbiased only
        if (isUnbiased) {
          ewmaExpectedReturnPct = computeEwmaExpectedReturnPct({
            rows: windowedRows,
            h,
            lambda: lambdaUsed,
            trainFraction: trainFracUsed,
            initialEquity: cfdInitialEquity,
            leverage: cfdLeverage,
            positionFraction: cfdPositionFraction,
            costBps: cfdCostBps,
          });
          if (process.env.NODE_ENV !== "production") {
            console.log("[EWMA-EXPECTED][RET]", {
              returnPct: ewmaExpectedReturnPct,
              h,
              lambdaUsed,
              trainFracUsed,
              startDate: windowedRows[0]?.date,
              endDate: asOfDate,
            });
          }
        }

        // Build bars and simulate for performance breakdown FOR ALL RUNS
        const bars = buildEwmaExpectedBars(windowedRows, h, lambdaUsed, trainFracUsed);
        if (bars.length > 0) {
          const config: CfdSimConfig = {
            leverage: cfdLeverage,
            fxFeeRate: 0,
            dailyLongSwapRate: 0,
            dailyShortSwapRate: 0,
            spreadBps: cfdCostBps,
            marginCallLevel: 0.45,
            stopOutLevel: 0.25,
            positionFraction: cfdPositionFraction,
          };
          const simResult = simulateCfd(bars, cfdInitialEquity, config);
          if (isUnbiased || !simResultMap[canonicalId]) {
            storeSimResult(canonicalId, simResult);
          }
          const priceStart = prices[0] ?? null;
          const priceEnd = prices[prices.length - 1] ?? null;
          perfMetrics = summarizeSimPerformance(simResult, priceStart, priceEnd);
        }
      }

      if (isUnbiased && !simResultMap[canonicalId]) {
        storeSimResult(canonicalId, baseResult, run?.initialEquity);
      }

      const row = {
        id: spec.key,
        label: spec.label,
        lambda: lambdaUsed,
        trainFraction: trainFracUsed,
        ewmaExpectedReturnPct,
        returnPct: stats?.returnPct ?? 0,
        maxDrawdown: stats?.maxDrawdown ?? 0,
        tradeCount: stats?.tradeCount ?? 0,
        stopOutEvents: stats?.stopOutEvents ?? 0,
        days: stats?.days ?? 0,
        firstDate: stats?.firstDate ?? "—",
        lastDate: stats?.lastDate ?? "—",
        volatility: sharedVolatility,
        horizonForecast,
        ...(perfMetrics ?? {}),
      };

      if (process.env.NODE_ENV !== "production") {
        console.log("[SIM-TABLE][ROW-SOURCE]", {
          idx,
          specId: spec.id,
          label: spec.label,
          runPresent: !!run,
        lambda: row.lambda,
        trainFraction: row.trainFraction,
        window: visibleWindow,
        firstDate: row.firstDate,
        lastDate: row.lastDate,
        trades: row.tradeCount,
          returnPct: row.returnPct,
        });
      }

      return row;
    });

    return { rows, simResultsById: simResultMap };
  }, [
    comparisonRowSpecs,
    comparisonRunIds,
    reactionLambda,
    reactionTrainFraction,
    biasedMaxCalmarResult,
    derivedMaxTrainFraction,
    summarizeRunStats,
    cfdBaseRunsById,
    visibleWindow,
    cfdCanonicalRows,
    forecastByKey,
    h,
    coverage,
    cfdInitialEquity,
    cfdLeverage,
    cfdPositionFraction,
    cfdCostBps,
  ]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.log(
      "[SIM-TABLE][VOL]",
      simulationRunsSummary.map((r) => ({
        id: r.id,
        gbm: r.volatility?.gbm,
        garchN: r.volatility?.garchNormal,
        garchT: r.volatility?.garchStudent,
      }))
    );
  }, [simulationRunsSummary]);

  useEffect(() => {
    console.log("[SIM-ID]", {
      selectedSimRunId,
      simKeys: Object.keys(simResultsById ?? {}).slice(0, 20),
      has: !!(selectedSimRunId && simResultsById?.[selectedSimRunId]),
    });
  }, [selectedSimRunId, simResultsById]);

useEffect(() => {
  if (selectedSimRunId) return;
  const ids = simulationRunsSummary?.map((r) => r.id) ?? [];
  const def = ids.includes("unbiased") ? "unbiased" : ids[0] ?? null;
  if (def) setSelectedSimRunId(def);
}, [selectedSimRunId, simulationRunsSummary]);

useEffect(() => {
  console.log("[SELECTED RUN]", selectedSimRunId);
}, [selectedSimRunId]);

  type SelectedSimPoint = {
    pnlUsd: number;
    equityUsd: number;
    side?: CfdAccountSnapshot["side"] | null;
    contracts?: number | null;
  };

  const { selectedSimByDate, selectedPnlLabel } = useMemo(() => {
    if (!selectedSimRunId) {
      return { selectedSimByDate: undefined, selectedPnlLabel: undefined as string | undefined };
    }
    const cache = simResultsById[selectedSimRunId];
    const label =
      simulationRunsSummary.find((r) => r.id === selectedSimRunId)?.label ?? selectedSimRunId;
    if (!cache || !cache.accountHistory || cache.accountHistory.length === 0) {
      return { selectedSimByDate: undefined, selectedPnlLabel: label };
    }

    const start = visibleWindow?.start ?? null;
    const end = visibleWindow?.end ?? null;
    const initialEquity =
      (Number.isFinite(cache.initialEquity) ? cache.initialEquity : undefined) ??
      cache.accountHistory[0]?.equity ??
      cfdInitialEquity;

    const simMap: Record<string, SelectedSimPoint> = {};
    cache.accountHistory.forEach((snap) => {
      const date = normalizeDateKey(snap.date);
      if (!date) return;
      if (start && date < start) return;
      if (end && date > end) return;
      const equity = snap.equity;
      if (equity == null || !Number.isFinite(equity)) return;
      const pnlUsd = equity - initialEquity;
      const qty = Number.isFinite(snap.quantity) ? snap.quantity : null;
      const derivedSide =
        qty != null && qty !== 0 ? (qty > 0 ? ("long" as const) : ("short" as const)) : null;
      simMap[date] = {
        pnlUsd,
        equityUsd: equity,
        side: snap.side ?? derivedSide,
        contracts: qty,
      };
    });

    const selectedSimByDate = simMap;

    return { selectedSimByDate, selectedPnlLabel: label };
  }, [selectedSimRunId, simResultsById, simulationRunsSummary, visibleWindow, cfdInitialEquity]);

  const selectedOverviewStats = useMemo(() => {
    if (!selectedSimRunId) return null;
    const summary = simulationRunsSummary.find((r) => r.id === selectedSimRunId);
    const simCache = simResultsById[selectedSimRunId];
    const initialEquity =
      (simCache && Number.isFinite(simCache.initialEquity) ? simCache.initialEquity : null) ??
      null;

    const keys = selectedSimByDate ? Object.keys(selectedSimByDate).sort() : [];
    const lastKey = keys.length ? keys[keys.length - 1] : null;
    const lastPoint = lastKey && selectedSimByDate ? selectedSimByDate[lastKey] : null;
    const pnlAbs =
      lastPoint && Number.isFinite(lastPoint.pnlUsd) ? (lastPoint.pnlUsd as number) : null;
    const pnlPct =
      pnlAbs != null && initialEquity && initialEquity !== 0 ? pnlAbs / initialEquity : null;

    const maxDrawdownAbs = summary?.maxDrawdownValue ?? null;
    const maxDrawdownPct = summary?.maxDrawdownPct ?? null;

    const trades = simCache?.trades ?? [];
    const totalTrades = summary?.tradeCount ?? (trades.length > 0 ? trades.length : null);
    const profitableTrades = trades.length > 0 ? trades.filter((t) => (t.netPnl ?? 0) > 0).length : null;
    const pctProfitable =
      profitableTrades != null && totalTrades
        ? (profitableTrades / totalTrades) * 100
        : null;

    const grossProfit = summary?.grossProfit;
    const grossLoss = summary?.grossLoss;
    const grossLossAbs =
      grossLoss != null && Number.isFinite(grossLoss) ? Math.abs(grossLoss) : null;
    const profitFactor =
      grossLossAbs != null && grossLossAbs > 0 && grossProfit != null && Number.isFinite(grossProfit)
        ? grossProfit / grossLossAbs
        : null;

    return {
      pnlAbs,
      pnlPct,
      maxDrawdownAbs,
      maxDrawdownPct,
      totalTrades,
      profitableTrades,
      pctProfitable,
      profitFactor,
      label: summary?.label ?? null,
      asOfDate: lastKey ?? null,
    };
  }, [selectedSimRunId, selectedSimByDate, simulationRunsSummary, simResultsById]);

  const selectedAnalytics: SelectedStrategyAnalytics | null = useMemo(
    () =>
      buildSelectedStrategyAnalytics({
        selectedSimRunId,
        selectedOverviewStats,
        simulationRunsSummary,
        simResult: selectedSimRunId ? simResultsById[selectedSimRunId] : null,
        selectedSimByDate,
        canonicalRows: cfdCanonicalRows,
        visibleWindow,
        initialEquityFallback: cfdInitialEquity,
      }),
    [
      selectedSimRunId,
      selectedOverviewStats,
      simulationRunsSummary,
      simResultsById,
      selectedSimByDate,
      cfdCanonicalRows,
      visibleWindow,
      cfdInitialEquity,
    ]
  );

  const handleOpenSimulationSettings = useCallback(() => {
    setShowSimulationSettings(true);
    requestAnimationFrame(() => {
      simulationSettingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  // Sync volatility window with GBM window only when auto-sync is enabled and GBM window changes
  useEffect(() => {
    if (volWindowAutoSync) {
      setVolWindow(window);
    }
  }, [window, volWindowAutoSync]);

  // Keep dist consistent with the selected model (legacy compatibility)
  const garchDist = garchEstimator === 'Normal' ? 'normal' : 'student-t';

  // Conformal Prediction state
  const [conformalMode, setConformalMode] = useState<'ICP' | 'ICP-SCALED' | 'CQR' | 'EnbPI' | 'ACI'>('ICP');
  const [conformalDomain, setConformalDomain] = useState<'log' | 'price'>('log');
  const [conformalCalWindow, setConformalCalWindow] = useState(250);
  const [conformalEta, setConformalEta] = useState(0.02);
  const [conformalK, setConformalK] = useState(20);
  const [conformalState, setConformalState] = useState<any>(null);
  const [isApplyingConformal, setIsApplyingConformal] = useState(false);
  const [conformalError, setConformalError] = useState<string | null>(null);
  const [baseForecastCount, setBaseForecastCount] = useState<number | null>(null);
  const [isLoadingBaseForecasts, setIsLoadingBaseForecasts] = useState(false);
  const [showMissDetails, setShowMissDetails] = useState(false); // Changed to false (closed by default)
  const [baseForecastsToGenerate, setBaseForecastsToGenerate] = useState(250); // Default to cal window

  // Model prediction line for the active method
  const [modelLine, setModelLine] = useState<
    Array<{ date: string; model_price: number }> | null
  >(null);

  // Base forecast generation state
  const [isGeneratingBase, setIsGeneratingBase] = useState(false);

  // Stale state tracking for master controls
  const [baseForecastsStale, setBaseForecastsStale] = useState(false);
  const [conformalStale, setConformalStale] = useState(false);
  const [coverageStatsStale, setCoverageStatsStale] = useState(false);

  // Validation Gates state
  const [gatesStatus, setGatesStatus] = useState<GateStatus | null>(null);
  const [isCheckingGates, setIsCheckingGates] = useState(false);

  // Company Registry state
  const [companyTicker, setCompanyTicker] = useState(params.ticker);
  const [companyName, setCompanyName] = useState('');
  const [companyExchange, setCompanyExchange] = useState<string | null>(null);
  const [availableExchanges, setAvailableExchanges] = useState<string[]>([]);
  const [exchangesByRegion, setExchangesByRegion] = useState<Record<string, string[]>>({});
  const [isSavingCompany, setIsSavingCompany] = useState(false);
  const [companySaveSuccess, setCompanySaveSuccess] = useState(false);

  // Initialization state to prevent auto-generation before data is loaded
  const [isInitialized, setIsInitialized] = useState(false);

  // Alerts state
  const [firedAlerts, setFiredAlerts] = useState<AlertFire[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [repairRecords, setRepairRecords] = useState<RepairRecord[]>([]);
  const [isLoadingRepairs, setIsLoadingRepairs] = useState(false);
  
  // Watchlist state
  const [isAddingToWatchlist, setIsAddingToWatchlist] = useState(false);
  const [isInWatchlist, setIsInWatchlist] = useState(false);

  // Breakout Detection state
  const [latestEvent, setLatestEvent] = useState<EventRecord | null>(null);
  const [isDetectingBreakout, setIsDetectingBreakout] = useState(false);
  const [breakoutError, setBreakoutError] = useState<string | null>(null);
  const [breakoutDetectDate, setBreakoutDetectDate] = useState('');
  const [cooldownStatus, setCooldownStatus] = useState<{ok: boolean; inside_count: number; reason?: string} | null>(null);

  // Continuation Clock state
  const [stopRule, setStopRule] = useState<'re-entry' | 'sign-flip'>('re-entry');
  const [kInside, setKInside] = useState<1 | 2>(1);
  const [tMax, setTMax] = useState(20);
  const [isTicking, setIsTicking] = useState(false);
  const [continuationError, setContinuationError] = useState<string | null>(null);
  const [tickDate, setTickDate] = useState('');
  const [lastContinuationAction, setLastContinuationAction] = useState<string | null>(null);

  // Model selection state for recommended defaults
  const [recommendedModel, setRecommendedModel] = useState<string | null>(null);
  const [modelScores, setModelScores] = useState<ModelScoreLite[] | null>(null);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);
  const [isModelInfoOpen, setIsModelInfoOpen] = useState(false);

  // Centralized forecast pipeline status
  const [forecastStatus, setForecastStatus] = useState<ForecastStatus>("idle");

  // Data Contract popover state
  const [showDataContract, setShowDataContract] = useState(false);

  // Validation checklist dropdown state  
  const [showValidationChecklist, setShowValidationChecklist] = useState(false);

  // Validation summary state
  const [validationSummary, setValidationSummary] = useState<ValidationSummary | null>(null);

  // Upload mode and reprocess state
  const [uploadMode, setUploadMode] = useState<'replace' | 'incremental'>('replace');
  const [lastFileHash, setLastFileHash] = useState<string | null>(null);
  const [isReprocessing, setIsReprocessing] = useState(false);

  // Exchange validation warning state (M-4)
  const [exchangeWarning, setExchangeWarning] = useState<{
    show: boolean;
    message: string;
    details: string;
    conflictType?: 'adr' | 'suffix' | 'region' | 'pattern';
  } | null>(null);

  // Provenance ribbon state (M-5)
  const [provenanceData, setProvenanceData] = useState<{
    vendor: string;
    mappingId: string;
    fileHash: string;
    rows: number;
    dateRange: { first: string; last: string };
    processedAt: string;
  } | null>(null);

  // Column mapping state (A-1)
  const [showColumnMapping, setShowColumnMapping] = useState(false);
  const [selectedMapping, setSelectedMapping] = useState<string | null>(null);
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);
  const [columnMappings, setColumnMappings] = useState<Array<{
    id: string;
    name: string;
    vendor: 'yahoo' | 'bloomberg' | 'refinitiv' | 'unknown';
    map: Record<string, string>;
  }>>([]);
  const [customMapping, setCustomMapping] = useState<Record<string, string>>({});
  const [mappingTab, setMappingTab] = useState<'template' | 'custom'>('template');

  // Preview data state (A-2)
  const [previewData, setPreviewData] = useState<{
    head: Array<Record<string, string>>;
    tail: Array<Record<string, string>>;
    gaps: Array<{
      start: string;
      end?: string;
      days: number;
      severity: 'warn' | 'info';
    }>;
  } | null>(null);

  // Repairs & Audit panel state (A-3)
  const [showRepairsPanel, setShowRepairsPanel] = useState(false);

  // Corporate Actions state (A-4)
  const [corporateActionsFile, setCorporateActionsFile] = useState<File | null>(null);
  const [isUploadingCorporateActions, setIsUploadingCorporateActions] = useState(false);
  const [corporateActionsResult, setCorporateActionsResult] = useState<any>(null);
  const [corporateActionsError, setCorporateActionsError] = useState<string | null>(null);
  const [showConflictResolution, setShowConflictResolution] = useState(false);
  const [conflictData, setConflictData] = useState<any>(null);
  const [existingCorporateActions, setExistingCorporateActions] = useState<any[]>([]);

  // Delisting awareness state (A-5)
  const [delistingInfo, setDelistingInfo] = useState<{
    symbol: string;
    status: 'active' | 'delisted' | 'suspended' | 'pending_delisting';
    delistingDate?: string;
    reason?: string;
    exchange: string;
    lastTradingDate?: string;
    warnings: string[];
    manualOverride?: {
      overridden: boolean;
      overrideDate: string;
      overrideReason: string;
      overriddenBy: string;
    };
  } | null>(null);
  const [showDelistingOverride, setShowDelistingOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  // Export functionality state (A-6)
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Data type selector state
  const [dataTypes, setDataTypes] = useState(['Historical Price', 'Dividends']);
  const [selectedDataType, setSelectedDataType] = useState('Historical Price');
  const [showAddDataType, setShowAddDataType] = useState(false);
  const [newDataTypeName, setNewDataTypeName] = useState('');

  // File upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Data Quality modal state
  const [showDataQualityModal, setShowDataQualityModal] = useState(false);

  // Coverage details toggle state
  const [showCoverageDetails, setShowCoverageDetails] = useState(false);

  // Stable accessors to prevent variable shadowing - using server spec
  const resolvedTargetSpec = useMemo(() => targetSpecResult || serverTargetSpec, [targetSpecResult, serverTargetSpec]);
  const persistedCoverage = typeof resolvedTargetSpec?.spec?.coverage === "number" ? resolvedTargetSpec.spec.coverage : null;
  const persistedTZ = resolvedTargetSpec?.spec?.exchange_tz ?? null;
  const historyCount = useMemo(() => {
    if (uploadResult?.counts?.canonical) return uploadResult.counts.canonical;
    if (uploadResult?.meta?.rows) return uploadResult.meta.rows;
    return 0;
  }, [uploadResult]);

  // Pipeline prerequisites to avoid premature runs that show false errors
  // Note: We use local state values (h, coverage) with defaults, NOT requiring saved target-spec
  // This allows the pipeline to run for new tickers that don't have a saved target-spec yet
  const pipelineReady = useMemo(() => {
    // Local state h and coverage always have valid defaults (h=1, coverage=0.95)
    const hasValidH = typeof h === "number" && h >= 1;
    const hasValidCoverage = typeof coverage === "number" && coverage > 0 && coverage < 1;
    // For TZ, prefer saved spec, fallback to canonical meta (uploadResult), or default to US market
    const effectiveTZ = resolvedTargetSpec?.spec?.exchange_tz 
      || uploadResult?.meta?.exchange_tz 
      || 'America/New_York'; // Safe default for US stocks
    const hasTZ = Boolean(effectiveTZ);
    return isInitialized && hasValidH && hasValidCoverage && hasTZ && historyCount > 0;
  }, [historyCount, isInitialized, h, coverage, resolvedTargetSpec, uploadResult]);

  const fetchVolForecast = useCallback(
    async (spec: VolModelSpec): Promise<any | null> => {
      const currentTargetSpec = targetSpecResult || serverTargetSpec;
      const effectiveCoverage = currentTargetSpec?.spec?.coverage ?? coverage;
      const effectiveTZ =
        currentTargetSpec?.spec?.exchange_tz ||
        uploadResult?.meta?.exchange_tz ||
        "America/New_York";
      const currentHistoryCount = historyCount;

      // Choose window per model and clamp to available history
      const baseWindow = spec.model === "GBM" ? gbmWindow : volWindow;
      const effectiveWindowN =
        currentHistoryCount > 0
          ? Math.min(baseWindow, Math.max(1, currentHistoryCount - 1))
          : baseWindow;

      const selectedModel =
        spec.model === "GBM"
          ? "GBM-CC"
          : spec.model === "GARCH"
            ? spec.garchEstimator === "Student-t"
              ? "GARCH11-t"
              : "GARCH11-N"
            : spec.model === "HAR-RV"
              ? "HAR-RV"
              : `Range-${spec.rangeEstimator ?? "P"}`;

      const isGarchModel = selectedModel === "GARCH11-N" || selectedModel === "GARCH11-t";
      const isRangeModel = selectedModel.startsWith("Range-");
      const resolvedDist =
        isGarchModel && selectedModel === "GARCH11-t" ? "student-t" : "normal";
      const resolvedEstimator = isRangeModel
        ? selectedModel.split("-")[1] || spec.rangeEstimator
        : spec.rangeEstimator;

      const modelParams: any = {};
      if (selectedModel === "GBM-CC") {
        modelParams.gbm = {
          windowN: effectiveWindowN,
          lambdaDrift: gbmLambda,
        };
      } else if (isGarchModel) {
        modelParams.garch = {
          window: effectiveWindowN,
          variance_targeting: garchVarianceTargeting,
          dist: resolvedDist,
          ...(resolvedDist === "student-t" ? { df: garchDf } : {}),
        };
      } else if (selectedModel === "HAR-RV") {
        modelParams.har = {
          window: effectiveWindowN,
          use_intraday_rv: harUseIntradayRv,
        };
      } else {
        modelParams.range = {
          estimator: resolvedEstimator,
          window: effectiveWindowN,
          ewma_lambda: rangeEwmaLambda,
        };
      }

      try {
        const resp = await fetch(
          `/api/volatility/${encodeURIComponent(params.ticker)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: selectedModel,
              params: modelParams,
              overwrite: true,
              horizon: h,
              coverage: effectiveCoverage,
              tz: effectiveTZ,
            }),
          }
        );

        if (!resp.ok) {
          const bodyText = await resp.text();
          if (process.env.NODE_ENV !== "production") {
            console.warn("[VOL PREFETCH][ERR]", {
              key: buildVolSelectionKey({
                model: spec.model,
                garchEstimator: spec.garchEstimator,
                rangeEstimator: spec.rangeEstimator,
                h,
                coverage,
              }),
              status: resp.status,
              bodyText,
              model: selectedModel,
              estimator: resolvedEstimator,
            });
          }
          return null;
        }

        const bodyText = await resp.text();
        const data = JSON.parse(bodyText);
        return data ?? null;
      } catch (_error) {
        return null;
      }
    },
    [
      targetSpecResult,
      serverTargetSpec,
      coverage,
      uploadResult,
      historyCount,
      gbmWindow,
      volWindow,
      gbmLambda,
      garchVarianceTargeting,
      garchDf,
      harUseIntradayRv,
      rangeEwmaLambda,
      params.ticker,
      h,
    ]
  );

  const prevServerTargetSpecRef = useRef<any | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (prevServerTargetSpecRef.current !== serverTargetSpec) {
      console.log("SERVER_SPEC changed:", serverTargetSpec);
      prevServerTargetSpecRef.current = serverTargetSpec;
    }
  }, [serverTargetSpec]);

  const ensureAllVolForecasts = useCallback(async () => {
    const runId = ++volPrefetchRunIdRef.current;
    const specs: { spec: VolModelSpec; key: string }[] = [
      { spec: { model: "GBM" }, key: buildVolSelectionKey({ model: "GBM", h, coverage }) },
      {
        spec: { model: "GARCH", garchEstimator: "Normal" },
        key: buildVolSelectionKey({ model: "GARCH", garchEstimator: "Normal", h, coverage }),
      },
      {
        spec: { model: "GARCH", garchEstimator: "Student-t" },
        key: buildVolSelectionKey({ model: "GARCH", garchEstimator: "Student-t", h, coverage }),
      },
      { spec: { model: "HAR-RV" }, key: buildVolSelectionKey({ model: "HAR-RV", h, coverage }) },
      {
        spec: { model: "Range", rangeEstimator: "P" },
        key: buildVolSelectionKey({ model: "Range", rangeEstimator: "P", h, coverage }),
      },
      {
        spec: { model: "Range", rangeEstimator: "GK" },
        key: buildVolSelectionKey({ model: "Range", rangeEstimator: "GK", h, coverage }),
      },
      {
        spec: { model: "Range", rangeEstimator: "RS" },
        key: buildVolSelectionKey({ model: "Range", rangeEstimator: "RS", h, coverage }),
      },
      {
        spec: { model: "Range", rangeEstimator: "YZ" },
        key: buildVolSelectionKey({ model: "Range", rangeEstimator: "YZ", h, coverage }),
      },
    ];

    const todo = specs.filter(({ key }) => {
      const existing = forecastByKey[key];
      const isInFlight = volInFlightRef.current.has(key);
      // Refetch if: no forecast, or forecast exists but has no valid interval data
      const needsFetch = !existing || 
        !existing.intervals?.L_h || 
        !existing.intervals?.U_h ||
        !Number.isFinite(existing.intervals.L_h) ||
        !Number.isFinite(existing.intervals.U_h);
      return needsFetch && !isInFlight;
    });

    if (todo.length === 0) return;

    await runWithConcurrencyLimit(todo, 3, async ({ key, spec }) => {
      volInFlightRef.current.add(key);
      try {
        if (spec.rangeEstimator === "RS") {
          console.log("[VOL PREFETCH][RS]", { key, payload: { spec, h, coverage } });
        }
        const forecast = await fetchVolForecast(spec);
        if (volPrefetchRunIdRef.current !== runId) return;
        if (forecast) {
          setForecastByKey((prev) =>
            prev[key] ? prev : { ...prev, [key]: { ...forecast, _key: key } }
          );
          if (spec.rangeEstimator === "RS") {
            console.log("[VOL PREFETCH][RS][WRITE]", { key });
          }
        }
      } finally {
        volInFlightRef.current.delete(key);
      }
    });
  }, [h, coverage, forecastByKey, fetchVolForecast]);

  useEffect(() => {
    if (!pipelineReady) return;
    ensureAllVolForecasts();
  }, [pipelineReady, ensureAllVolForecasts]);

  // Memoize forecast overlay props to prevent unnecessary re-renders
  // STEP 3: Use strict key matching (no fallback chain)
  const forecastOverlayProps = useMemo(() => ({
    activeForecast: forecastByKey[volSelectionKey] ?? null,
    volModel,
    coverage,
    conformalState,
  }), [forecastByKey, volSelectionKey, volModel, coverage, conformalState]);

  // Exchange TZ resolver helper
  function resolveExchangeTZ(opts: { canonicalTZ?: string | null; selectedExchange?: string | null }): string | null {
    // Prefer canonical meta (Data Quality already shows this)
    if (opts.canonicalTZ && opts.canonicalTZ.includes("/")) return opts.canonicalTZ;

    // Fallback map by exchange code (minimal — extend if you like)
    const map: Record<string, string> = {
      NASDAQ: "America/New_York",
      NYSE:   "America/New_York", 
      XETRA:  "Europe/Berlin",
      LSE:    "Europe/London"
    };
    const ex = (opts.selectedExchange || "").split(" ")[0].toUpperCase(); // "NASDAQ"
    return map[ex] || null;
  }

  // Load target spec and latest forecast on mount
  useEffect(() => {
    const initializeComponent = async () => {
      console.log('[Init] Starting component initialization for:', params.ticker);
      
      try {
        // Load all initial data
        await Promise.all([
          loadTargetSpec(),
          loadLatestForecast(),
          loadCompanyInfo(),
          loadCurrentPrice(),
          loadExistingCorporateActions(),
          loadDelistingStatus(),
          loadExistingCanonicalData()
        ]);
        
        console.log('[Init] Initial data loading complete');
        
        // Mark as initialized to allow auto-generation
        setIsInitialized(true);
        
      } catch (error) {
        console.error('[Init] Error during component initialization:', error);
        // Still mark as initialized to prevent hanging state
        setIsInitialized(true);
      }
    };

    // Reset initialization flag when ticker changes
    setIsInitialized(false);
    initializeComponent();
  }, [params.ticker]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load global Trend Weight calibration (UI only)
  useEffect(() => {
    let cancelled = false;
    const loadCalibration = async () => {
      try {
        const res = await fetch('/api/trend/calibration');
        if (!res.ok) {
          console.warn('[Timing] Failed to load Trend calibration, status:', res.status);
          return;
        }
        const json = await res.json();
        const calibration = json?.calibration as {
          trendSignalWeightGlobal?: number;
          calibrationDate?: string;
        } | null;

        if (
          calibration &&
          typeof calibration.trendSignalWeightGlobal === 'number' &&
          Number.isFinite(calibration.trendSignalWeightGlobal)
        ) {
          if (!cancelled) {
            setTrendWeight(calibration.trendSignalWeightGlobal);
            setTrendWeightUpdatedAt(calibration.calibrationDate ?? null);
          }
        } else if (!cancelled) {
          setTrendWeight(null);
          setTrendWeightUpdatedAt(null);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[Timing] Error loading Trend calibration:', err);
        }
      }
    };

    loadCalibration();

    return () => {
      cancelled = true;
    };
  }, []);

  // Helper function to parse method string to UI state on client-side
  const parseMethodToUIState = (method: string): {
    volModel: 'GBM' | 'GARCH' | 'HAR-RV' | 'Range';
    garchEstimator?: 'Normal' | 'Student-t';
    rangeEstimator?: 'P' | 'GK' | 'RS' | 'YZ';
  } => {
    switch (method) {
      case "GBM-CC":
        return { volModel: 'GBM' };
      case "GARCH11-N":
        return { volModel: 'GARCH', garchEstimator: 'Normal' };
      case "GARCH11-t":
        return { volModel: 'GARCH', garchEstimator: 'Student-t' };
      case "HAR-RV":
        return { volModel: 'HAR-RV' };
      case "Range-P":
        return { volModel: 'Range', rangeEstimator: 'P' };
      case "Range-GK":
        return { volModel: 'Range', rangeEstimator: 'GK' };
      case "Range-RS":
        return { volModel: 'Range', rangeEstimator: 'RS' };
      case "Range-YZ":
        return { volModel: 'Range', rangeEstimator: 'YZ' };
      default:
        return { volModel: 'GBM' };
    }
  };

  // Load recommended default model on mount
  useEffect(() => {
    const loadRecommendedModel = async () => {
      setIsLoadingRecommendations(true);
      try {
        // Get the recommended default model for this symbol and configuration
        const horizonTrading = targetSpecResult?.spec?.h || 5; // Use target spec horizon or default to 5
        const coverage = targetSpecResult?.spec?.coverage || 0.95; // Use target spec coverage or default to 95%
        
        const urlParams = new URLSearchParams({
          symbol: params.ticker,
          horizonTrading: horizonTrading.toString(),
          coverage: coverage.toString()
        });

        const response = await fetch(`/api/model-selection?${urlParams}`);
        
        if (response.ok) {
          const result = await response.json();
          const defaultModel = result.defaultModel; // Updated field name
          const modelScoresData = result.modelScores; // New field
          
          if (defaultModel) {
            console.log(`Loaded recommended model for ${params.ticker}: ${defaultModel}`);
            setRecommendedModel(defaultModel);
            setModelScores(modelScoresData);
            // Note: We only store the recommendation, not auto-apply it
          } else {
            console.log(`No recommended model found for ${params.ticker}, using defaults`);
            setRecommendedModel(null);
            setModelScores(null);
          }
        } else {
          console.error('Failed to load model recommendations:', response.status, response.statusText);
          setRecommendedModel(null);
          setModelScores(null);
        }
      } catch (error) {
        console.error('Failed to load recommended model:', error);
        setRecommendedModel(null);
        setModelScores(null);
      } finally {
        setIsLoadingRecommendations(false);
      }
    };

    loadRecommendedModel();
  }, [params.ticker, targetSpecResult]); // Re-run when ticker or target spec changes

  const loadExistingCanonicalData = async () => {
    try {
      const response = await fetch(`/api/canonical/${params.ticker}`);
      if (response.ok) {
        const data = await response.json();
        if (data.meta?.rows) {
          // Set a minimal uploadResult if we have existing canonical data
          setUploadResult({
            symbol: params.ticker,
            paths: { raw: '', canonical: '', audit: '' },
            counts: { 
              input: data.meta.rows, 
              canonical: data.meta.rows, 
              invalid: 0,
              missingDays: 0 
            },
            meta: {
              symbol: params.ticker,
              exchange_tz: data.meta.exchange_tz || 'America/New_York',
              calendar_span: { start: data.meta.calendar_span?.start || '', end: data.meta.calendar_span?.end || '' },
              rows: data.meta.rows,
              missing_trading_days: [],
              invalid_rows: 0,
              generated_at: data.meta.generated_at || new Date().toISOString()
            },
            badges: {
              contractOK: true,
              calendarOK: true,
              tzOK: true,
              corpActionsOK: true,
              validationsOK: true,
              repairsCount: 0
            }
          });
        }
      }
    } catch (error) {
      console.log('No existing canonical data found');
    }
  };

  const loadCompanyInfo = async () => {
    try {
      // First try to fetch from Yahoo Finance API for live company name
      const yahooRes = await fetch(`/api/company-info/${params.ticker}`);
      if (yahooRes.ok) {
        const yahooData = await yahooRes.json();
        if (yahooData.name) {
          setCompanyName(yahooData.name);
          setCompanyTicker(params.ticker);
          setCompanyExchange(yahooData.exchange || null);
          
          // Save to local company registry for future search suggestions
          try {
            await fetch('/api/companies', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ticker: params.ticker.toUpperCase(),
                name: yahooData.name,
                exchange: yahooData.exchange || null
              })
            });
          } catch (saveErr) {
            console.warn('Failed to save company to registry:', saveErr);
          }
          return;
        }
      }
      
      // Fallback to local companies registry
      const response = await fetch(`/api/companies?ticker=${params.ticker}`);
      if (response.status === 404) {
        setCompanyTicker(params.ticker);
        return;
      }
      if (response.ok) {
        const company = await response.json();
        setCompanyName(company.name || '');
        setCompanyExchange(company.exchange || null);
        // Keep ticker in sync with URL param
        setCompanyTicker(params.ticker);
      } else {
        console.error('Failed to load company info:', response.status, response.statusText);
        setCompanyTicker(params.ticker);
      }
    } catch (error) {
      console.error('Failed to load company info:', error);
      // Set default ticker from URL
      setCompanyTicker(params.ticker);
    }
  };

  // Fetch current price for header display (canonical fallback)
  const loadCurrentPrice = async () => {
    try {
      const rows = cfdCanonicalRows?.length ? cfdCanonicalRows : await fetchCanonicalRows();
      if (!rows || rows.length === 0) return;
      const last = rows[rows.length - 1];
      const price = last?.adj_close ?? last?.close;
      const date = last?.date;
      setHeaderPrice({ price: price ?? null, date: date ?? null });
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.error("[Header] loadCurrentPrice error", err);
      }
    }
  };

  const loadTargetSpec = async () => {
    try {
      const response = await fetch(`/api/target-spec/${params.ticker}`);
      if (response.ok) {
        const result: TargetSpecResult = await response.json();
        setTargetSpecResult(result);
        setH(result.spec.h);
        setCoverage(result.spec.coverage);
      }
    } catch (error) {
      console.error('Failed to load target spec:', error);
    }
  };

  const loadLatestForecast = useCallback(async () => {
    try {
      const response = await fetch(`/api/forecast/gbm/${params.ticker}`);
      if (response.status === 404) {
        setCurrentForecast(null);
        return;
      }
      if (response.ok) {
        const forecasts = await response.json();
        // Get the most recent forecast (array is sorted by date_t descending)
        if (forecasts.length > 0) {
          setCurrentForecast(forecasts[0]);
          // Also set as active forecast if no active forecast is currently set
          setActiveForecast((prevActive: any) => prevActive || forecasts[0]);
        } else {
          setCurrentForecast(null);
        }
      } else {
        console.error('Failed to load forecasts:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Failed to load forecasts:', error);
    }
  }, [params.ticker]);

  // Load latest locked forecast for conformal prediction
  const loadLatestActiveForecast = useCallback(async () => {
    try {
      // Try to load the latest forecast from all methods
      const response = await fetch(`/api/forecast/gbm/${params.ticker}`);
      if (response.status === 404) {
        return null;
      }
      if (response.ok) {
        const forecasts = await response.json();
        
        // Find the most recent locked forecast
        const latestLocked = forecasts.find((f: any) => f.locked === true);
        if (latestLocked) {
          console.log('[LoadActiveForecast] Found latest locked forecast:', latestLocked.method, latestLocked.date_t);
          setActiveForecast(latestLocked);
          return latestLocked;
        }
        
        // If no locked forecast, use the most recent forecast
        if (forecasts.length > 0) {
          console.log('[LoadActiveForecast] Using most recent forecast:', forecasts[0].method, forecasts[0].date_t);
          setActiveForecast(forecasts[0]);
          return forecasts[0];
        }
      } else {
        console.error('Failed to load active forecast:', response.status, response.statusText);
      }
      
      // If no API forecasts found, check if we have a GBM forecast in state
      if (gbmForecast) {
        console.log('[LoadActiveForecast] Using GBM forecast from state:', gbmForecast.method);
        setActiveForecast(gbmForecast);
        return gbmForecast;
      }

      console.log('[LoadActiveForecast] No active forecast found');
      return null;
    } catch (error) {
      console.error('Failed to load active forecast:', error);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.ticker]); // gbmForecast intentionally omitted to avoid race conditions with pipeline

  const loadServerTargetSpec = useCallback(async () => {
    try {
      setIsLoadingServerSpec(true);
      const resp = await fetch(`/api/target-spec/${encodeURIComponent(tickerParam)}`, { cache: "no-store" });
      if (!resp.ok) { 
        console.warn(`Failed to load server target spec for ${tickerParam}: ${resp.status}`);
        setServerTargetSpec(null); 
        return; 
      }
      const data = await resp.json();
      console.log(`Loaded server target spec for ${tickerParam}:`, data);
      setServerTargetSpec(data); // Should be { spec: {...}, meta: {...} }
    } catch (error) {
      console.error(`Error loading server target spec for ${tickerParam}:`, error);
      setServerTargetSpec(null);
    } finally {
      setIsLoadingServerSpec(false);
    }
  }, [tickerParam]);

  useEffect(() => { loadServerTargetSpec(); }, [loadServerTargetSpec]);

  // Check RV availability for HAR-RV gating
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/canonical/${encodeURIComponent(tickerParam)}?fields=rv_head`, { cache: 'no-store' });
        const j = await r.json();
        setRvAvailable(Boolean(j?.rv_head && j.rv_head.length > 0));
      } catch { 
        setRvAvailable(false); 
      }
    })();
  }, [tickerParam]);

  // Derive base method from current UI selection instead of active forecast
  const selectedBaseMethod = resolveBaseMethod(volModel, garchEstimator, rangeEstimator);

  // Legacy: still derive active base method for compatibility (can be removed later)
  const activeBaseMethod: string | null = 
    activeForecast?.method ?? 
    gbmForecast?.method ?? 
    'GBM';

  // Load base forecast count with method-awareness
  const loadBaseForecastCount = useCallback(async () => {
    try {
      setIsLoadingBaseForecasts(true);
      
      // Use selected base method from current UI selection with complete parameter set
      const baseMethod = selectedBaseMethod;
      const query = `?base_method=${encodeURIComponent(baseMethod)}&h=${h}&coverage=${coverage}&domain=${conformalDomain}`;
      const resp = await fetch(
        `/api/conformal/head/${encodeURIComponent(tickerParam)}${query}`,
        { cache: 'no-store' }
      );
      
      if (!resp.ok) {
        console.error('[Conformal] head failed', resp.status);
        setBaseForecastCount(0);
        return;
      }
      const data = await resp.json();
      setBaseForecastCount(typeof data.base_forecasts === 'number' ? data.base_forecasts : 0);
    } catch (err) {
      console.error('[Conformal] head error', err);
      setBaseForecastCount(0);
    } finally {
      setIsLoadingBaseForecasts(false);
    }
  }, [tickerParam, selectedBaseMethod, h, coverage, conformalDomain]);

  // Load model line data
  const loadModelLine = useCallback(async () => {
    if (!activeBaseMethod) return;

    try {
      const url = `/api/forecast/model-line/${encodeURIComponent(
        params.ticker
      )}?method=${encodeURIComponent(
        activeBaseMethod
      )}&window=${conformalCalWindow}`;

      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) {
        console.error('Failed to load model line', await resp.text());
        return;
      }

      const json = await resp.json();
      setModelLine(json.data ?? null);
    } catch (err) {
      console.error('Error loading model line', err);
    }
  }, [params.ticker, activeBaseMethod, conformalCalWindow]);

  // Load base forecast count when dependencies change
  useEffect(() => { loadBaseForecastCount(); }, [loadBaseForecastCount]);

  // Load model line when dependencies change
  useEffect(() => { loadModelLine(); }, [loadModelLine]);

  // Load latest active forecast when page loads
  useEffect(() => { loadLatestActiveForecast(); }, [loadLatestActiveForecast]);

  // Auto-set activeForecast from currentForecast if activeForecast is not set
  useEffect(() => {
    if (!activeForecast && currentForecast) {
      const timestamp = new Date().toISOString();
      console.log(`🎯 BROWSER DEBUG [${timestamp}] ⚠️ AutoSetActive from currentForecast:`, {
        currentForecastMethod: currentForecast.method,
        currentForecastDate: currentForecast.date_t,
        stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
      });
      console.log('[AutoSetActive] Setting activeForecast from currentForecast:', currentForecast.method, currentForecast.date_t);
      setActiveForecast(currentForecast);
    }
  }, [activeForecast, currentForecast]);

  // Auto-set activeForecast from gbmForecast if activeForecast is not set
  useEffect(() => {
    if (!activeForecast && gbmForecast) {
      const timestamp = new Date().toISOString();
      console.log(`🎯 BROWSER DEBUG [${timestamp}] ⚠️ AutoSetActive from gbmForecast:`, {
        gbmForecastMethod: gbmForecast.method,
        gbmForecastDate: gbmForecast.date_t,
        stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
      });
      console.log('[AutoSetActive] Setting activeForecast from gbmForecast:', gbmForecast.method, gbmForecast.date_t);
      setActiveForecast(gbmForecast);
    }
  }, [activeForecast, gbmForecast]);

  // 🔍 CRITICAL DEBUG: Monitor activeForecast changes with browser console output
  useEffect(() => {
    const timestamp = new Date().toISOString();
    console.log(`🎯 BROWSER DEBUG [${timestamp}] activeForecast changed:`, {
      hasActiveForecast: !!activeForecast,
      activeForecastKeys: activeForecast ? Object.keys(activeForecast) : 'null',
      method: activeForecast?.method,
      date_t: activeForecast?.date_t,
      hasIntervals: !!activeForecast?.intervals,
      hasConformal: !!activeForecast?.conformal,
      stackTrace: new Error().stack?.split('\n').slice(1, 6).join('\n')
    });
  }, [activeForecast]);

  // Load conformal state
  const loadConformalState = useCallback(async () => {
    try {
      const response = await fetch(`/api/conformal/${encodeURIComponent(params.ticker)}`);
      if (response.ok) {
        const data = await response.json();
        setConformalState(data);
      } else if (response.status !== 404) {
        console.error('Failed to load conformal state:', response.statusText);
      }
    } catch (error) {
      console.error('Failed to load conformal state:', error);
    }
  }, [params.ticker]);

  // Load conformal state on mount and when ticker changes
  useEffect(() => { loadConformalState(); }, [loadConformalState]);

  // Load EWMA Reaction Map (manual trigger only)
  const loadReactionMap = useCallback(async () => {
    if (!params?.ticker) return;

    try {
      setIsLoadingReaction(true);
      setReactionError(null);

      const query = new URLSearchParams({
        lambda: reactionLambda.toString(),
        coverage: coverage.toString(),              // main coverage
        trainFraction: reactionTrainFraction.toString(),
        minTrainObs: reactionMinTrainObs.toString(),
        horizons: String(h),                        // main horizon
      });

      const res = await fetch(
        `/api/volatility/ewma-reaction/${encodeURIComponent(params.ticker)}?${query.toString()}`,
        { cache: "no-store" }
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `EWMA reaction API error ${res.status}`);
      }

      const json = await res.json();
      
      if (!json.success) {
        throw new Error(json.error || "Failed to build reaction map");
      }

      const result = json.result;

      const buckets: ReactionBucketSummary[] = (result.stats || []).map((s: any) => ({
        bucketId: s.bucketId,
        horizon: s.horizon,
        nObs: s.nObs,
        pUp: s.pUp,
        meanReturn: s.meanReturn,
        stdReturn: s.stdReturn,
      }));

      setReactionMapSummary({
        trainStart: result.meta.trainStart,
        trainEnd: result.meta.trainEnd,
        testStart: result.meta.testStart,
        testEnd: result.meta.testEnd,
        nTrain: result.meta.nTrain,
        nTest: result.meta.nTest,
        buckets,
      });
    } catch (err: any) {
      console.error("[EWMA REACTION] loadReactionMap error", err);
      setReactionError(err?.message || "Failed to load EWMA reaction map.");
      setReactionMapSummary(null);
    } finally {
      setIsLoadingReaction(false);
    }
  }, [params?.ticker, reactionLambda, coverage, h, reactionTrainFraction, reactionMinTrainObs]);

  // Auto-load reaction map when λ or Train% changes
  useEffect(() => {
    // Debounce to avoid too many calls while typing
    const timeout = setTimeout(() => {
      loadReactionMap();
    }, 300);
    return () => clearTimeout(timeout);
  }, [reactionLambda, reactionTrainFraction, loadReactionMap]);

  // Core optimization function - runs the optimizer API and updates state
  const runOptimization = useCallback(async (options?: { applyBest?: boolean }) => {
    if (!params?.ticker) return;
    const { applyBest = false } = options ?? {};

    try {
      setIsOptimizingReaction(true);
      setReactionOptimizeError(null);

      const query = new URLSearchParams({
        h: String(h),
        coverage: coverage.toString(),
        shrinkFactor: ewmaShrinkK.toString(),
        minTrainObs: reactionMinTrainObs.toString(),
        zMode: cfdZMode,
        zEnter: cfdZEnter.toString(),
        // Coarse grid for speed: λ step 0.05, train step 0.05
        lambdaMin: "0.50",
        lambdaMax: "0.99",
        lambdaStep: "0.05",
        trainMin: "0.50",
        trainMax: "0.90",
        trainStep: "0.05",
      });

      const res = await fetch(
        `/api/volatility/ewma-optimize/${encodeURIComponent(params.ticker)}?${query.toString()}`
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Optimize failed: ${res.status} ${text}`);
      }

      const json = await res.json();

      if (!json.success) {
        throw new Error(json.error || "Unknown optimization error");
      }

      const best = json.best as EwmaOptimizationCandidate;
      const candidates = (json.candidates ?? []) as EwmaOptimizationCandidate[];
      const neutral = json.neutralBaseline as EwmaOptimizationNeutralSummary | null;

      // Store best, candidates, and neutral baseline for display
      setReactionOptimizationBest(best);
      setReactionOptimizationCandidates(candidates);
      setReactionOptimizationNeutral(neutral ?? null);

      // Only apply best λ/Train% if explicitly requested (e.g., from Maximize button)
      if (applyBest) {
        setReactionLambda(best.lambda);
        setReactionTrainFraction(best.trainFraction);
        setIsReactionMaximized(true);
      }
      
      console.log("[EWMA Optimize] Optimization complete:", {
        best: { lambda: best.lambda, trainFraction: best.trainFraction },
        candidatesCount: candidates.length,
        applyBest,
      });
    } catch (err: any) {
      console.error("[EWMA Optimize] error:", err);
      setReactionOptimizeError(err?.message ?? "Failed to optimize EWMA");
    } finally {
      setIsOptimizingReaction(false);
    }
  }, [params?.ticker, h, coverage, reactionMinTrainObs, cfdZEnter, cfdZMode, ewmaShrinkK]);

  const runZThresholdOptimization = useCallback(async () => {
    if (!params?.ticker) return;
    try {
      setIsOptimizingZThresholds(true);
      setCfdZOptimizeError(null);
      setCfdZOptimizeResult(null);
      cfdZOptimizeFailedRef.current = false;

      const query = new URLSearchParams({
        h: String(h),
        lambda: reactionLambda.toString(),
        coverage: coverage.toString(),
        trainFraction: reactionTrainFraction.toString(),
        minTrainObs: reactionMinTrainObs.toString(),
        trainLenBars: "252",
        valLenBars: "63",
        stepLenBars: "63",
        costBps: cfdCostBps.toString(),
        initialEquity: cfdInitialEquity.toString(),
        leverage: cfdLeverage.toString(),
        positionFraction: cfdPositionFraction.toString(),
        shrinkFactor: ewmaShrinkK.toString(),
      });

      const res = await fetch(
        `/api/volatility/z-threshold-optimize/${encodeURIComponent(params.ticker)}?${query.toString()}`
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Z threshold optimize API error ${res.status}`);
      }

      const json = await res.json();
      if (!json.success || !json.best) {
        throw new Error(json.error || "Failed to optimize z thresholds");
      }

      const candidate = {
        thresholds: json.best.thresholds,
        quantiles: json.best.quantiles,
        meanScore: json.best.meanScore,
        folds: json.best.folds,
        avgTradeCount: json.best.avgTradeCount,
        avgShortOppCount: json.best.avgShortOppCount,
        totalShortEntries: json.best.totalShortEntries,
        applyRecommended: json.best.applyRecommended,
        baselineScore: json.best.baselineScore,
        bestScore: json.best.bestScore,
        reason: json.best.reason,
        selectionTier: json.best.selectionTier,
        strictPass: json.best.strictPass,
        recencyPass: json.best.recencyPass,
        failedConstraints: json.best.failedConstraints,
        recency: json.best.recency,
      } as ZOptimizeResult;

      const decision = decideZOptimizeApply(candidate);
      setCfdZOptimizeResult(candidate);
      setCfdZDisplayThresholds(decision.applied ? candidate.thresholds : null);
      setCfdZMode("optimize");
    } catch (err: any) {
      console.error("[Z-OPTIMIZE] error", err);
      setCfdZOptimizeError(err?.message || "Failed to optimize z thresholds.");
      cfdZOptimizeFailedRef.current = true;
      setCfdZMode("optimize");
    } finally {
      setIsOptimizingZThresholds(false);
    }
  }, [
    params?.ticker,
    h,
    coverage,
    reactionLambda,
    reactionTrainFraction,
    reactionMinTrainObs,
    cfdCostBps,
    cfdInitialEquity,
    cfdLeverage,
    cfdPositionFraction,
    ewmaShrinkK,
  ]);

  const fetchBiasedMaxCalmar = useCallback(async () => {
    if (!params?.ticker) return;
    const rangeStart = visibleWindow?.start;
    if (!rangeStart) return;
    if (biasedMaxObjective !== "calmar") return;

    try {
      setIsLoadingBiasedMaxCalmar(true);
      setBiasedMaxCalmarError(null);

      const query = new URLSearchParams({
        rangeStart,
        h: String(h),
        coverage: coverage.toString(),
        equity: cfdInitialEquity.toString(),
        leverage: cfdLeverage.toString(),
        posFrac: cfdPositionFraction.toString(),
        costBps: cfdCostBps.toString(),
        shrinkFactor: ewmaShrinkK.toString(),
        signalRule: "z",
        objective: biasedMaxObjective,
      });

      const res = await fetch(
        `/api/volatility/ewma-lambda-calmar/${encodeURIComponent(params.ticker)}?${query.toString()}`
      );
      const json = await res.json();
      if (!res.ok || !json?.success) {
        const msg = json?.error || `Lambda Calmar API error ${res.status}`;
        throw new Error(msg);
      }

      setBiasedMaxCalmarResult({
        lambdaStar: json.lambdaStar,
        calmarScore: json.calmarScore,
        trainSpan: json.trainSpan ?? null,
        updatedAt: json.updatedAt ?? null,
        cacheHit: json.cacheHit ?? false,
        cacheStale: json.cacheStale ?? false,
        staleDays: json.staleDays ?? null,
        objective: json.objective ?? "calmar",
        note: json.note ?? null,
        noTrade: json.noTrade ?? false,
        rangeStartUsed: json.rangeStartUsed ?? rangeStart,
        trainEndUsed: json.trainEndUsed ?? json.trainSpan?.end ?? null,
      });

      if (!cfdCanonicalRows) {
        await fetchCanonicalRows();
      }
    } catch (err: any) {
      console.error("[Lambda Calmar] fetch error", err);
      setBiasedMaxCalmarError(err?.message || "Failed to compute λ* (Calmar).");
      setBiasedMaxCalmarResult(null);
    } finally {
      setIsLoadingBiasedMaxCalmar(false);
    }
  }, [
    params?.ticker,
    visibleWindow?.start,
    h,
    coverage,
    cfdInitialEquity,
    cfdLeverage,
    cfdPositionFraction,
    cfdCostBps,
    ewmaShrinkK,
    cfdCanonicalRows,
    biasedMaxObjective,
  ]);

  useEffect(() => {
    cfdZOptimizeFailedRef.current = false;
  }, [
    params?.ticker,
    h,
    coverage,
    reactionLambda,
    reactionTrainFraction,
    reactionMinTrainObs,
    cfdCostBps,
    cfdInitialEquity,
    cfdLeverage,
    cfdPositionFraction,
    ewmaShrinkK,
  ]);

  useEffect(() => {
    if (
      cfdZMode === "optimize" &&
      !isOptimizingZThresholds &&
      !cfdZOptimizeError &&
      (!cfdZOptimizeResult || !cfdZDisplayThresholds) &&
      !cfdZOptimizeFailedRef.current
    ) {
      runZThresholdOptimization();
    }
  }, [
    cfdZMode,
    cfdZOptimizeResult,
    cfdZDisplayThresholds,
    isOptimizingZThresholds,
    cfdZOptimizeError,
    runZThresholdOptimization,
  ]);

  useEffect(() => {
    fetchBiasedMaxCalmar();
  }, [fetchBiasedMaxCalmar]);

  useEffect(() => {
    if (cfdZMode === "optimize") {
      setCfdZOptimizeResult(null);
      setCfdZDisplayThresholds(null);
    }
  }, [
    cfdZMode,
    params.ticker,
    h,
    coverage,
    reactionLambda,
    reactionTrainFraction,
    reactionMinTrainObs,
    cfdCostBps,
    cfdInitialEquity,
    cfdLeverage,
    cfdPositionFraction,
    ewmaShrinkK,
  ]);


  // EWMA Maximize button handler - now only toggles biased overlay and applies best config
  const handleMaximizeReaction = useCallback(() => {
    // If we already have optimization results, apply them and show overlay
    if (reactionOptimizationBest) {
      setReactionLambda(reactionOptimizationBest.lambda);
      setIsReactionMaximized(true);
    } else {
      // Fallback: run optimization if somehow we don't have results yet
      runOptimization({ applyBest: true });
    }
  }, [reactionOptimizationBest, runOptimization]);

  // Click handlers for optimization table rows
  const handleApplyOptimizationCandidate = useCallback(
    (_candidate: any) => {},
    []
  );

  const handleApplyOptimizationNeutral = useCallback(() => {
    return;
  }, []);

  const handleApplyOptimizedZThresholds = useCallback(() => {
    if (cfdZOptimizeResult) {
      setCfdZMode("optimize");
      setCfdZDisplayThresholds(cfdZOptimizeResult.thresholds);
    }
  }, [cfdZOptimizeResult]);

  useEffect(() => {
    setCfdSignalRule("z");
    setCfdZMode("optimize");
  }, [params.ticker]);

  // Cfd CFD Simulation: Build bars from any EWMA path (Unbiased or Biased)
  type CfdSimBarsOptions = {
    useTrendTilt?: boolean;
    trendWeight?: number | null;
    trendZByDate?: Map<string, number>;
    horizon?: number;
    zMode?: "auto" | "manual" | "optimize";
    signalRule?: "bps" | "z";
    zEnter?: number;
    zExit?: number;
    zFlip?: number;
    optimizedThresholds?: ZOptimizeResult["thresholds"] | null;
  };
  type CfdSimBarsResult = {
    bars: CfdSimBar[];
    thresholdsUsed: {
      enterLong: number;
      enterShort: number;
      exitLong: number;
      exitShort: number;
      flipLong: number;
      flipShort: number;
    } | null;
  };

  // Stub type for EWMA simulation (no longer used, but kept for backward compatibility)
  type EwmaWalkerPathPoint = {
    date_t: string;
    date_tp1: string;
    S_t: number;
    S_tp1: number;
    y_hat_tp1: number;
    L_tp1: number;
    U_tp1: number;
    sigma_t: number;
  };

  const quantile = (arr: number[], q: number): number => {
    if (!arr.length) return NaN;
    const sorted = [...arr].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }
    return sorted[base];
  };

  const computeAutoZThresholds = useCallback((
    ewmaPathArg: EwmaWalkerPathPoint[],
    canonicalRows: CanonicalRow[],
    horizon: number,
    fallbackEnter: number
  ): {
    enterLong: number;
    enterShort: number;
    exitLong: number;
    exitShort: number;
    flipLong: number;
    flipShort: number;
  } | null => {
    const exitRatio = 0.3;
    const flipRatio = 2.0;
    const sqrtH = Math.sqrt(horizon);

    const simStartDate = canonicalRows[0]?.date ?? null;
    if (!simStartDate) {
      const fallback = fallbackEnter;
      return {
        enterLong: fallback,
        enterShort: fallback,
        exitLong: fallback * exitRatio,
        exitShort: fallback * exitRatio,
        flipLong: fallback * flipRatio,
        flipShort: fallback * flipRatio,
      };
    }

    const calibPoints = ewmaPathArg
      .filter((p) => p.date_tp1 < simStartDate)
      .sort((a, b) => a.date_tp1.localeCompare(b.date_tp1));
    const lastCalib = calibPoints.slice(-252);

    const zEdges: number[] = [];
    for (const p of lastCalib) {
      const sigmaH = p.sigma_t * sqrtH;
      const muBase = Math.log(p.y_hat_tp1 / p.S_t);
      if (!Number.isFinite(muBase) || !Number.isFinite(sigmaH) || sigmaH <= 0) continue;
      zEdges.push(muBase / sigmaH);
    }

    if (zEdges.length === 0) {
      const fallback = fallbackEnter;
      return {
        enterLong: fallback,
        enterShort: fallback,
        exitLong: fallback * exitRatio,
        exitShort: fallback * exitRatio,
        flipLong: fallback * flipRatio,
        flipShort: fallback * flipRatio,
      };
    }

    const targetQ = 0.9;
    const minSamples = 50;
    const pos = zEdges.filter((z) => z > 0);
    const neg = zEdges.filter((z) => z < 0).map((z) => -z);
    const absVals = zEdges.map((z) => Math.abs(z));

    const symEnter = quantile(absVals, targetQ);
    const enterLong = pos.length >= minSamples ? quantile(pos, targetQ) : symEnter;
    const enterShort = neg.length >= minSamples ? quantile(neg, targetQ) : symEnter;

    const enterLongFinal = Number.isFinite(enterLong) ? enterLong : fallbackEnter;
    const enterShortFinal = Number.isFinite(enterShort) ? enterShort : enterLongFinal;

    const thresholds = {
      enterLong: enterLongFinal,
      enterShort: enterShortFinal,
      exitLong: enterLongFinal * exitRatio,
      exitShort: enterShortFinal * exitRatio,
      flipLong: enterLongFinal * flipRatio,
      flipShort: enterShortFinal * flipRatio,
    };

    if (!(thresholds.exitLong < thresholds.enterLong && thresholds.enterLong < thresholds.flipLong)) return null;
    if (!(thresholds.exitShort < thresholds.enterShort && thresholds.enterShort < thresholds.flipShort)) return null;

    return thresholds;
  }, []);

  const buildCfdSimBarsFromEwmaPath = useCallback((
    canonicalRows: CanonicalRow[],
    ewmaPathArg: EwmaWalkerPathPoint[] | null,
    thresholdPct: number,
    options?: CfdSimBarsOptions
  ): CfdSimBarsResult => {
    if (!ewmaPathArg) return { bars: [], thresholdsUsed: null };

    const useTrendTilt =
      !!options?.useTrendTilt &&
      options.trendWeight != null &&
      options.trendZByDate instanceof Map &&
      typeof options.horizon === 'number' &&
      options.horizon > 0;

    const trendWeight = options?.trendWeight ?? null;
    const trendZByDate = options?.trendZByDate;
    const horizon = options?.horizon ?? 1;
    const zMode = options?.zMode ?? "auto";
    const signalRule = options?.signalRule ?? "bps";
    const zEnter = options?.zEnter ?? 0.3;
    const zExit = options?.zExit ?? 0.1;
    const zFlip = options?.zFlip ?? 0.6;
    const optimizedThresholds = options?.optimizedThresholds ?? null;
    const sqrtH = Math.sqrt(horizon);

    // Build lookup from target date to forecast
    const ewmaMap = new Map<string, EwmaWalkerPathPoint>();
    ewmaPathArg.forEach((p) => {
      ewmaMap.set(p.date_tp1, p);
    });

    const manualThresholds = {
      enterLong: zEnter,
      enterShort: zEnter,
      exitLong: zExit,
      exitShort: zExit,
      flipLong: zFlip,
      flipShort: zFlip,
    };

    let thresholds: typeof manualThresholds | null = null;
    if (signalRule === "z") {
      if (zMode === "auto") {
        thresholds = computeAutoZThresholds(ewmaPathArg, canonicalRows, horizon, zEnter);
      } else if (zMode === "manual") {
        thresholds = manualThresholds;
      } else if (zMode === "optimize") {
        thresholds = optimizedThresholds ?? null;
      }
    }

    if (signalRule === "z" && zMode === "optimize" && !thresholds) {
      return { bars: [], thresholdsUsed: null };
    }

    const bars: CfdSimBar[] = [];
    let qPrev = 0; // -1 short, 0 flat, +1 long

    for (const row of canonicalRows) {
      const price = row.adj_close ?? row.close;
      if (!price || !row.date) continue;

      const ewma = ewmaMap.get(row.date);
      if (!ewma) continue; // no forecast for this date

      const muBase = Math.log(ewma.y_hat_tp1 / ewma.S_t);
      const sigmaH = ewma.sigma_t != null ? ewma.sigma_t * sqrtH : NaN;
      let muUsed = muBase;

      if (
        useTrendTilt &&
        trendWeight != null &&
        trendZByDate &&
        Number.isFinite(sigmaH) &&
        sigmaH > 0
      ) {
        const zRaw = trendZByDate.get(row.date);
        if (zRaw != null && Number.isFinite(zRaw)) {
          const zClamped = Math.max(-2, Math.min(2, zRaw));
          muUsed = muBase + trendWeight * zClamped * sigmaH;
        }
      }

      const edgeFrac = Number.isFinite(muUsed) ? Math.exp(muUsed) - 1 : NaN;
      const zEdge =
        Number.isFinite(muUsed) && Number.isFinite(sigmaH) && sigmaH > 0
          ? muUsed / sigmaH
          : 0;

      if (!Number.isFinite(edgeFrac)) continue;

      let signal: CfdSignal = "flat";

      if (signalRule === "bps") {
        if (edgeFrac > thresholdPct) {
          signal = "long";
        } else if (edgeFrac < -thresholdPct) {
          signal = "short";
        }
      } else if (thresholds) {
        // z-based hysteresis state machine with asymmetric thresholds
        const {
          enterLong,
          enterShort,
          exitLong,
          exitShort,
          flipLong,
          flipShort,
        } = thresholds;
        let q = qPrev;
        if (qPrev === 0) {
          if (zEdge >= enterLong) q = 1;
          else if (zEdge <= -enterShort) q = -1;
        } else if (qPrev === 1) {
          if (zEdge <= -flipShort) q = -1;
          else if (zEdge <= exitLong) q = 0;
        } else if (qPrev === -1) {
          if (zEdge >= flipLong) q = 1;
          else if (zEdge >= -exitShort) q = 0;
        }
        qPrev = q;
        if (q > 0) signal = "long";
        else if (q < 0) signal = "short";
      }

      bars.push({
        date: row.date,
        price,
        signal,
      });
    }

    return { bars, thresholdsUsed: thresholds };
  }, [computeAutoZThresholds]);

  // Cfd CFD Simulation: Reusable helper to run sim for a specific EWMA source
  interface RunCfdSimOptions {
    autoSelect?: boolean;
    useTrendTilt?: boolean;
    trendWeight?: number | null;
    lambdaOverride?: number | null;
    trainFractionOverride?: number | null;
    ewmaPathOverride?: EwmaWalkerPathPoint[] | null;
  }

  const runCfdSimForSource = useCallback(
    async (
      source: "unbiased" | "biased",
      runId: CfdRunId,
      label: string,
      opts?: RunCfdSimOptions
    ) => {
      const { autoSelect, useTrendTilt, trendWeight } = opts ?? {};
      setCfdError(null);
      setIsRunningCfdSim(true);

      try {
        const isMaxRun = runId === "ewma-biased-max" || runId === "ewma-biased-max-trend";
        const isNoTradeBaseline = isMaxRun && biasedMaxCalmarResult?.lambdaStar == null;

        // Fetch canonical rows if not cached (deduped)
        let rows = cfdCanonicalRows;
        if (!rows) {
          rows = await fetchCanonicalRows() ?? null;
        }

        if (!rows || rows.length === 0) {
          throw new Error('No canonical data available');
        }

        // EWMA simulation paths no longer available
        const ewmaPathForSim = opts?.ewmaPathOverride ?? null;

        if (!isNoTradeBaseline && (!ewmaPathForSim || ewmaPathForSim.length === 0)) {
          setCfdError('EWMA simulation paths have been removed. This feature is no longer supported.');
          setIsRunningCfdSim(false);
          return;
        }

        // Filter canonical rows to start at strategy start (max uses rangeStart; biased uses reaction testStart)
        const simStartDate = (() => {
          const candidates = [
            isMaxRun ? visibleWindow?.start ?? null : null,
            reactionMapSummary?.testStart,
            rows[0]?.date ?? null,
          ].filter(Boolean) as string[];
          return candidates.length ? candidates.reduce((a, b) => (a > b ? a : b)) : null;
        })();
        const simEndDate = rows[rows.length - 1]?.date ?? null;

        let rowsForSim = rows;
        if (simStartDate || simEndDate) {
          rowsForSim = rows.filter((row) => {
            if (!row.date) return false;
            if (simStartDate && row.date < simStartDate) return false;
            if (simEndDate && row.date > simEndDate) return false;
            return true;
          });
        }

        // Debug: Log sim window
        console.log("[Cfd] Sim window", {
          simStartDate,
          firstRow: rowsForSim[0]?.date,
          lastRow: rowsForSim[rowsForSim.length - 1]?.date,
          n: rowsForSim.length,
        });

        if (!rowsForSim || rowsForSim.length === 0) {
          throw new Error('No canonical rows available for Cfd sim.');
        }

        if (
          cfdSignalRule === "z" &&
          cfdZMode === "optimize" &&
          !cfdZOptimizeResult &&
          !isNoTradeBaseline
        ) {
          throw new Error('Optimize z thresholds first to run the simulation.');
        }

        const canUseTrendTilt =
          source === "biased" &&
          !!useTrendTilt &&
          trendWeight != null &&
          Number.isFinite(trendWeight);

        let trendZByDate: Map<string, number> | undefined;

        if (canUseTrendTilt) {
          const priceRowsForZ = rowsForSim
            .map((row) => {
              const close = row.adj_close ?? row.close;
              return close && close > 0
                ? { date: row.date, close }
                : null;
            })
            .filter((r): r is { date: string; close: number } => !!r);

          const zSeries = computeEwmaGapZSeries(
            priceRowsForZ,
            trendShortWindow,
            trendLongWindow,
            60
          );

          trendZByDate = new Map<string, number>();
          for (const p of zSeries) {
            if (Number.isFinite(p.z)) {
              trendZByDate.set(p.date, p.z);
            }
          }
        }

        const zOptimizeDecision = cfdZOptimizeResult
          ? decideZOptimizeApply(cfdZOptimizeResult)
          : { applied: false };
        const effectiveZMode =
          cfdSignalRule === "z" && cfdZMode === "optimize"
            ? zOptimizeDecision.applied
              ? "optimize"
              : "auto"
            : cfdZMode;

        const built = isNoTradeBaseline
          ? {
              bars: rowsForSim
                .filter((row) => {
                  const price = row.adj_close ?? row.close;
                  return price != null && price > 0 && !!row.date;
                })
                .map((row) => ({
                  date: row.date,
                  price: (row.adj_close ?? row.close) as number,
                  signal: "flat" as const,
                })),
              thresholdsUsed: null,
            }
          : buildCfdSimBarsFromEwmaPath(
              rowsForSim,
              ewmaPathForSim,
              cfdThresholdFrac,
              {
                useTrendTilt: canUseTrendTilt,
                trendWeight: canUseTrendTilt ? trendWeight! : null,
                trendZByDate,
                horizon: h,
                zMode: effectiveZMode,
                signalRule: cfdSignalRule,
                zEnter: cfdZEnter,
                zExit: cfdZExit,
                zFlip: cfdZFlip,
                optimizedThresholds: zOptimizeDecision.applied ? cfdZOptimizeResult?.thresholds ?? null : null,
              }
            );
        const bars = built.bars;
        if (cfdSignalRule === "z") {
          setCfdZDisplayThresholds(built.thresholdsUsed);
        } else {
          setCfdZDisplayThresholds(null);
        }

        if (bars.length === 0) {
          throw new Error('No overlapping bars between canonical data and EWMA path');
        }

        const strategyStartDate = simStartDate;

        const config: CfdSimConfig = {
          leverage: cfdLeverage,
          fxFeeRate: 0.005,
          dailyLongSwapRate: cfdDailyLongSwap,
          dailyShortSwapRate: cfdDailyShortSwap,
          spreadBps: cfdCostBps,
          marginCallLevel: 0.45,
          stopOutLevel: 0.25,
          positionFraction: cfdPositionFraction,
        };

        const result = simulateCfd(bars, cfdInitialEquity, config);
        const windowResult = visibleWindow
          ? computeWindowSimFromBars(
              bars,
              visibleWindow,
              cfdInitialEquity,
              config,
              strategyStartDate
            )
          : null;

        // Debug: Log sim run stored
        if (process.env.NODE_ENV !== "production") {
          console.log("[Cfd] Sim run stored", {
            runId,
            label,
            source,
            equityStart: cfdInitialEquity,
            equityEnd: result.finalEquity,
            trades: result.trades.length,
            stopOuts: result.stopOutEvents,
            maxDrawdown: result.maxDrawdown,
            firstDate: result.accountHistory[0]?.date,
            lastDate: result.accountHistory[result.accountHistory.length - 1]?.date,
            barsCount: bars.length,
            equityLen: result.accountHistory.length,
          });
        }

        // Store the run in our collection
        // For max runs, use calmar-optimized values when available; otherwise fall back
        const storedLambda = opts?.lambdaOverride != null
          ? opts.lambdaOverride
          : isMaxRun
            ? isNoTradeBaseline
              ? null
              : biasedMaxCalmarResult?.lambdaStar ?? reactionOptimizationBest?.lambda ?? reactionLambda
            : reactionLambda;
        const storedTrainFraction = opts?.trainFractionOverride != null
          ? opts.trainFractionOverride
          : isMaxRun
            ? derivedMaxTrainFraction ?? reactionTrainFraction
            : reactionTrainFraction;
        const signalSource: CfdSimRun['signalSource'] = source;
        const runRecord: CfdSimRun = {
          id: runId,
          label,
          signalSource,
          result,
          bars,
          configSnapshot: config,
          initialEquity: cfdInitialEquity,
          windowResult,
          lambda: storedLambda ?? undefined,
          trainFraction: storedTrainFraction,
          trendTiltEnabled: canUseTrendTilt,
          strategyStartDate,
        };
        setCfdRuns((prev) => {
          const other = prev.filter((r) => r.id !== runId);
          return [...other, runRecord];
        });
        setTimeout(() => {
          const exists = cfdRunsRef.current.some((r) => r.id === runId);
          if (!exists) {
            console.warn("[Cfd GUARD] run dropped after store", { runId });
          }
        }, 0);
        if (comparisonRunIds.includes(runId as BaseRunId)) {
          setCfdBaseRunsById((prev) => ({
            ...prev,
            [runId as BaseRunId]: runRecord,
          }));
          if (process.env.NODE_ENV !== "production") {
            const stats = summarizeRunStats(runRecord);
            console.log("[Cfd][BASE-RUN] stored", {
              runId,
              label,
              lambda: runRecord.lambda,
              trainFraction: runRecord.trainFraction,
              returnPct: stats?.returnPct,
              maxDrawdown: stats?.maxDrawdown,
              trades: stats?.tradeCount,
              stopOutEvents: stats?.stopOutEvents,
              firstDate: stats?.firstDate,
              lastDate: stats?.lastDate,
            });
          }
        }

        if (opts?.autoSelect) {
          setCfdCurrentRunId(runId);
        }
      } catch (err: any) {
        console.error('[Cfd Sim]', err);
        setCfdError(err?.message ?? 'Failed to run Cfd simulation.');
      } finally {
        setIsRunningCfdSim(false);
      }
    },
    [
      params.ticker,
      cfdCanonicalRows,
      reactionMapSummary,
      cfdThresholdFrac,
      cfdLeverage,
      cfdDailyLongSwap,
      cfdDailyShortSwap,
      cfdPositionFraction,
      cfdInitialEquity,
      cfdCostBps,
      cfdSignalRule,
      cfdZMode,
      cfdZEnter,
      cfdZExit,
      cfdZFlip,
      cfdZOptimizeResult,
      reactionLambda,
      reactionTrainFraction,
      reactionOptimizationBest,
      buildCfdSimBarsFromEwmaPath,
      h,
      trendShortWindow,
      trendLongWindow,
      comparisonRunIds,
      summarizeRunStats,
      visibleWindow,
      biasedMaxCalmarResult,
      derivedMaxTrainFraction,
      fetchCanonicalRows,
    ]
  );

  // Debug: Log Cfd table row values whenever runs change
  useEffect(() => {
    if (cfdRuns.length === 0) return;
    if (process.env.NODE_ENV !== "development") return;
    console.log("[Cfd] Table rows updated:");
    cfdRuns.forEach((run) => {
      const r = run.result;
      const ret = (r.finalEquity - r.initialEquity) / r.initialEquity;
      const maxDdPct = r.maxDrawdown * 100;
      console.log("[Cfd] Table row", run.id, {
        label: run.label,
        retPct: (ret * 100).toFixed(1) + "%",
        maxDdPct: maxDdPct.toFixed(1) + "%",
        trades: r.trades.length,
        stopOuts: r.stopOutEvents,
        marginCalls: r.marginCallEvents,
        lambda: run.lambda,
        trainFraction: run.trainFraction,
      });
    });
  }, [cfdRuns]);

  // Clear Cfd runs when CFD is disabled (but keep EWMA overlay selection)
  useEffect(() => {
    if (!isCfdEnabled && cfdRunsRef.current.length > 0) {
      console.log("[Cfd] CFD disabled, clearing runs (keeping EWMA overlay selection)");
      setCfdRuns([]);
      setCfdBaseRunsById({});
      setCfdCurrentRunId(null);
      baselineVerifyLoggedRef.current = false;
      // Don't clear cfdVisibleRunIds - keep EWMA overlay active on chart
    }
  }, [isCfdEnabled]);

  const simConfigKey = useMemo(
    () =>
      [
        "ticker",
        params?.ticker ?? "",
        "h",
        h,
        "cov",
        coverage,
        "lambda",
        reactionLambda,
        "trainFrac",
        reactionTrainFraction,
        "minTrainObs",
        reactionMinTrainObs,
        "shrink",
        ewmaShrinkK,
        "eq",
        cfdInitialEquity,
        "lev",
        cfdLeverage,
        "posFrac",
        cfdPositionFraction,
        "thresh",
        cfdThresholdFrac,
        "cost",
        cfdCostBps,
        "rule",
        cfdSignalRule,
        "zMode",
        cfdZMode,
        "zEnter",
        cfdZEnter,
        "zExit",
        cfdZExit,
        "zFlip",
        cfdZFlip,
        "swapL",
        cfdDailyLongSwap,
        "swapS",
        cfdDailyShortSwap,
        "trendS",
        trendShortWindow,
        "trendL",
        trendLongWindow,
        "trendM",
        trendMomentumPeriod,
        "trendW",
        effectiveTrendWeight ?? "",
      ].join("|"),
    [
      params?.ticker,
      h,
      coverage,
      reactionLambda,
      reactionTrainFraction,
      reactionMinTrainObs,
      ewmaShrinkK,
      cfdInitialEquity,
      cfdLeverage,
      cfdPositionFraction,
      cfdThresholdFrac,
      cfdCostBps,
      cfdSignalRule,
      cfdZMode,
      cfdZEnter,
      cfdZExit,
      cfdZFlip,
      cfdDailyLongSwap,
      cfdDailyShortSwap,
      trendShortWindow,
      trendLongWindow,
      trendMomentumPeriod,
      effectiveTrendWeight,
    ]
  );
  const prevSimConfigKeyRef = useRef<string | null>(null);

  // Clear Cfd runs when key parameters change to trigger fresh re-computation
  useEffect(() => {
    if (prevSimConfigKeyRef.current === null) {
      prevSimConfigKeyRef.current = simConfigKey;
      return;
    }
    if (prevSimConfigKeyRef.current !== simConfigKey) {
      prevSimConfigKeyRef.current = simConfigKey;
      if (cfdRunsRef.current.length > 0) {
        console.log("[Cfd settings] changed, clearing sims", {
          cfdInitialEquity,
          cfdLeverage,
          cfdPositionFraction,
          cfdThresholdFrac,
          cfdCostBps,
          cfdSignalRule,
          cfdZMode,
          cfdZEnter,
          cfdZExit,
          cfdZFlip,
        });
      }
      setCfdRuns([]);
      setCfdBaseRunsById({});
      setCfdCurrentRunId(null);
      setCfdVisibleRunIds(new Set<CfdRunId>()); // Ensure visible selection is cleared when runs are wiped
      baselineVerifyLoggedRef.current = false;
    }
  }, [simConfigKey]);

  // Debug: Monitor conformal state changes
  useEffect(() => {
    console.log("[CONF] conformalState changed:", conformalState);
  }, [conformalState]);

  // Clear conformal state when key parameters change to avoid stale data
  // Note: Removed activeBaseMethod to prevent clearing on every forecast change
  useEffect(() => {
    console.log("[CONF] Config change detected, clearing conformal state");
    setConformalState(null);
  }, [conformalMode, conformalDomain, conformalCalWindow]);

  // Keep base forecasts to generate in sync with calibration window
  useEffect(() => {
    setBaseForecastsToGenerate(conformalCalWindow);
  }, [conformalCalWindow]);

  // Handle generation of base forecasts for conformal prediction
  const handleGenerateBaseForecasts = useCallback(async (): Promise<BaseForecastsResult> => {
    // Use selected base method from current UI selection
    const baseMethod = selectedBaseMethod;

    console.log('[DEBUG] handleGenerateBaseForecasts called:', {
      selectedBaseMethod,
      baseMethod,
      volModel,
      garchEstimator,
      rangeEstimator,
      targetSpecResult: !!targetSpecResult
    });

    try {
      setIsGeneratingBase(true);
      setConformalError(null);

      console.log('[Conformal] Generating base forecasts:', {
        symbol: tickerParam,
        baseMethod: baseMethod,
        calWindow: conformalCalWindow,
        domain: conformalDomain,
        h,
        coverage
      });

      const response = await fetch(`/api/conformal/generate/${encodeURIComponent(tickerParam)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_method: baseMethod,
          cal_window: conformalCalWindow,
          domain: conformalDomain,
          horizon: h,                               // Add horizon from UI state
          coverage: coverage                        // Add coverage from UI state
        })
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('[Conformal] Generate base forecasts error:', data);
        setConformalError(data.error || data.details || 'Failed to generate base forecasts');
        return { ok: false, baseForecastCount: 0 };
      }

      console.log('[Conformal] Generated base forecasts:', data);
      
      // Track generated file IDs for auto-cleanup
      if (data.generatedFileIds && Array.isArray(data.generatedFileIds)) {
        data.generatedFileIds.forEach((fileId: string) => {
          trackGeneratedFile(fileId);
          console.log('[AutoCleanup] Tracked base forecast file:', fileId);
        });
      }
      
      // Show success message briefly
      const successMessage = `Generated ${data.created} new forecasts. ${data.alreadyExisting} already existed.`;
      console.log('[Conformal]', successMessage);
      
      // Calculate total base forecast count after generation
      const totalCount = (data.created || 0) + (data.alreadyExisting || 0);
      
      // Refresh the base forecast count to update the panel
      await loadBaseForecastCount();
      await loadModelLine();
      
      // You could also show a temporary success message
      // setConformalError(null); // Clear any previous errors
      
      return { ok: true, baseForecastCount: totalCount };
    } catch (err) {
      console.error('[Conformal] Generate base forecasts error:', err);
      setConformalError(err instanceof Error ? err.message : String(err));
      return { ok: false, baseForecastCount: 0 };
    } finally {
      setIsGeneratingBase(false);
    }
  }, [tickerParam, selectedBaseMethod, conformalCalWindow, conformalDomain, h, coverage, loadBaseForecastCount, loadModelLine, volModel, garchEstimator, rangeEstimator, targetSpecResult, trackGeneratedFile]);

  // Generate base forecasts for current configuration (symbol, base method, horizon, coverage, domain)
  const handleGenerateBaseForecastsForCurrentConfig = useCallback(async () => {
    if (!tickerParam) return;
    
    try {
      setIsGeneratingBase(true);
      setConformalError(null);

      const baseMethod = selectedBaseMethod;
      const body = {
        base_method: baseMethod,
        cal_window: baseForecastsToGenerate, // Use user-specified number instead of conformalCalWindow
        domain: conformalDomain,
        horizon: h,
        coverage: coverage
      };

      console.log(`[BASE] Generating base forecasts for current config:`, {
        symbol: tickerParam,
        ...body
      });

      const resp = await fetch(
        `/api/conformal/generate/${encodeURIComponent(tickerParam)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        setConformalError(data.error || data.details || "Failed to generate base forecasts.");
        return;
      }

      const data = await resp.json();
      console.log("[BASE] Generated base forecasts successfully:", data);

      // Track generated file IDs for auto-cleanup
      if (data.generatedFileIds && Array.isArray(data.generatedFileIds)) {
        data.generatedFileIds.forEach((fileId: string) => {
          trackGeneratedFile(fileId);
          console.log('[AutoCleanup] Tracked base forecast file (manual):', fileId);
        });
      }

      // Show success info
      if (data.message) {
        console.log("[BASE]", data.message);
      }

      // Refresh the base forecast count so UI shows updated availability
      await loadBaseForecastCount();

    } catch (err: any) {
      console.error("[BASE] Error generating base forecasts", err);
      setConformalError(err?.message || "Failed to generate base forecasts.");
    } finally {
      setIsGeneratingBase(false);
    }
  }, [tickerParam, selectedBaseMethod, baseForecastsToGenerate, conformalDomain, h, coverage, loadBaseForecastCount, trackGeneratedFile]);

  const generateGbmForecast = useCallback(async () => {
    setIsGeneratingForecast(true);
    setForecastError(null);

    try {
      const response = await fetch(`/api/forecast/gbm/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          windowN: window,
          lambdaDrift,
          coverage,
          horizonTrading: h,  // Add horizon parameter
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate forecast');
      }

      setGbmForecast(data);            // GBM card shows only GBM
      
      // Critical: Setting activeForecast from GBM
      const timestamp = new Date().toISOString();
      console.log(`🎯 BROWSER DEBUG [${timestamp}] ✅ SETTING activeForecast in GBM generation:`, {
        dataKeys: data ? Object.keys(data) : null,
        method: data?.method,
        date_t: data?.date_t,
        stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
      });
      setActiveForecast(data);         // Final PI shows GBM until a vol model is run
      
      // Reload forecasts to get the updated list
      await loadLatestForecast();
      
    } catch (err) {
      setForecastError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsGeneratingForecast(false);
    }
  }, [window, lambdaDrift, coverage, h, params.ticker, loadLatestForecast]);

  const generateVolatilityForecast = useCallback(async (): Promise<VolForecastResult> => {
    console.log("[VOL][handler] click", new Date().toISOString());
    console.log("[VOL][handler] click", { time: new Date().toISOString() });
    setVolatilityError(null);
    setModelAvailabilityMessage(null);
    setIsVolForecastLoading(true);

    // Read current values from state instead of depending on them
    const currentTargetSpec = targetSpecResult || serverTargetSpec;
    // Use persisted values if available, otherwise fall back to local state/defaults
    const effectiveCoverage = currentTargetSpec?.spec?.coverage ?? coverage;
    const effectiveTZ = currentTargetSpec?.spec?.exchange_tz 
      || uploadResult?.meta?.exchange_tz 
      || 'America/New_York'; // Safe default for US stocks
    const currentHistoryCount = historyCount;
    const currentRvAvailable = rvAvailable;

    console.log("[VOL][handler] inputs", {
      volModel,
      garchEstimator,
      rangeEstimator,
      volWindow,
      dist: garchEstimator === 'Normal' ? 'normal' : 'student-t',
      varianceTargeting: garchVarianceTargeting,
      tickerParam,
      effectiveCoverage,
      effectiveTZ,
      historyCount: currentHistoryCount,
    });

    // Coverage is valid if within acceptable range (using effective value from state or spec)
    const covOK = typeof effectiveCoverage === 'number' && effectiveCoverage > 0.50 && effectiveCoverage <= 0.999;

    // Construct the model name for logic checks
    const model = volModel === 'GBM'
      ? 'GBM-CC'
      : volModel === 'GARCH' 
      ? (garchEstimator === 'Student-t' ? 'GARCH11-t' : 'GARCH11-N')
      : volModel === 'HAR-RV' 
      ? 'HAR-RV' 
      : `Range-${rangeEstimator}`;
    const windowN = volModel === 'GBM' ? gbmWindow : volWindow;
    const requiredWindowN = windowN;
    const maxFeasibleWindowN = currentHistoryCount > 0 ? Math.min(requiredWindowN, currentHistoryCount - 1) : 0;
    let selectedModel: string | undefined;
    const emitVolResult = (result: VolForecastResult, context: string) => {
      if (process.env.NODE_ENV === "development") {
        console.info("[VOL][handler] result", {
          context,
          volModel,
          model,
          selectedModel,
          effectiveWindowN,
          historyCount: currentHistoryCount,
          rvAvailable: currentRvAvailable,
          ok: result.ok,
          reason: result.reason ?? null,
        });
      }
      return result;
    };

    if (maxFeasibleWindowN <= 0) {
      const message = 'Insufficient history: no observations available.';
      setVolatilityError(message);
      return emitVolResult({ ok: false, forecast: null, reason: 'NO_HISTORY' }, "no-history");
    }
    let effectiveWindowN = maxFeasibleWindowN;

    if (process.env.NODE_ENV === "development") {
      console.info("[VOL][client] window-check", {
        ticker: params.ticker,
        volModel,
        gbmWindow,
        volWindow,
        historyCount: currentHistoryCount,
        requiredWindowN,
        effectiveWindowN,
        model,
      });
    }

    if (volModel === 'GARCH') {
      const configWindow = requiredWindowN;
      const garchMinWindow = 500;
      const maxFeasibleGarchWindow = Math.min(configWindow, currentHistoryCount - 1);
      if (maxFeasibleGarchWindow < garchMinWindow) {
        if (process.env.NODE_ENV === 'development') {
          console.info("[VOL][client] garch-precheck insufficient", {
            ticker: params.ticker,
            historyCount: currentHistoryCount,
            configWindow,
            maxFeasibleGarchWindow,
            garchMinWindow,
          });
        }
        setVolatilityError(`Insufficient history for GARCH: need at least ${garchMinWindow} observations, have ${currentHistoryCount}.`);
        setModelAvailabilityMessage("GARCH needs roughly 600 clean daily returns; this ticker doesn't have enough data for this window. Showing GBM instead.");
        return emitVolResult({ ok: false, forecast: null, reason: "INSUFFICIENT_GARCH_DATA" }, "garch-precheck");
      }
      effectiveWindowN = maxFeasibleGarchWindow;
    }
    if (volModel === 'Range') {
      const configWindow = requiredWindowN;
      const rangeMinWindow = 252;
      const maxFeasibleRangeWindow = Math.min(configWindow, currentHistoryCount - 1);
      if (maxFeasibleRangeWindow < rangeMinWindow) {
        if (process.env.NODE_ENV === 'development') {
          console.info("[VOL][client] range-precheck insufficient", {
            ticker: params.ticker,
            historyCount: currentHistoryCount,
            window: maxFeasibleRangeWindow,
            rangeMinWindow,
            configWindow,
          });
        }
        setVolatilityError(`Insufficient history for Range estimator: need at least ${rangeMinWindow + 1} observations, have ${currentHistoryCount}.`);
        setModelAvailabilityMessage("Range estimator needs more clean OHLC data for this window; try a smaller window or a different model.");
        return emitVolResult({ ok: false, forecast: null, reason: "INSUFFICIENT_RANGE_DATA" }, "range-precheck");
      }
      effectiveWindowN = maxFeasibleRangeWindow;
    }
    if (volModel === 'HAR-RV') {
      const minRequiredHarObs = Math.max(effectiveWindowN + 1, 50); // need window plus one, and a modest floor for RV proxies
      if (currentHistoryCount < minRequiredHarObs) {
        if (process.env.NODE_ENV === 'development') {
          console.info("[VOL][client] har-precheck insufficient", {
            ticker: params.ticker,
            historyCount: currentHistoryCount,
            window: effectiveWindowN,
            minRequiredHarObs,
          });
        }
        setVolatilityError(`Insufficient history for HAR-RV: need ${minRequiredHarObs} observations, have ${currentHistoryCount}.`);
        return emitVolResult({ ok: false, forecast: null, reason: "INSUFFICIENT_HAR_DATA" }, "har-precheck");
      }
    }

    const hasData = currentHistoryCount >= effectiveWindowN + 1;
    const hasTZ   = !!effectiveTZ;
    const wantsHar = volModel === "HAR-RV";
    const harAvailable = !wantsHar || currentRvAvailable;  // only true if RV exists

    console.log("[VOL][handler] guard", { hasData, covOK, hasTZ, harAvailable, rvAvailable: currentRvAvailable });

    if (!hasData) { 
      console.log("[VOL][handler] early-return", { reason: "insufficient-data" });
      const neededObs = requiredWindowN + 1;
      setVolatilityError(`Insufficient history: need ${neededObs} observations, have ${currentHistoryCount}.`);
      return emitVolResult({ ok: false, forecast: null, reason: 'INSUFFICIENT_DATA' }, "insufficient-data");
    }
    if (!covOK) { 
      console.log("[VOL][handler] early-return", { reason: "coverage-invalid" });
      setVolatilityError("Coverage must be between 50% and 99.9%.");
      return emitVolResult({ ok: false, forecast: null }, "coverage-invalid");
    }
    if (!hasTZ) { 
      console.log("[VOL][handler] early-return", { reason: "no-timezone" });
      setVolatilityError("Exchange timezone missing.");
      return emitVolResult({ ok: false, forecast: null }, "no-timezone");
    }
    if (!harAvailable) {
      console.log("[VOL][handler] early-return", { reason: "har-unavailable" });
      setVolatilityError("Realized-volatility inputs not found (daily/weekly/monthly). HAR-RV requires RV.");
      return emitVolResult({ ok: false, forecast: null }, "har-unavailable");
    }

    if (!currentHistoryCount || currentHistoryCount <= 0) {
      console.log("[VOL][handler] early-return", { reason: "no-canonical-data" });
      setVolatilityError('No canonical data available. Please upload price history before generating forecasts.');
      return emitVolResult({ ok: false, forecast: null, reason: 'NO_HISTORY' }, "no-canonical-data");
    }

    // CRITICAL: Set loading and clear stale forecast at start
    setIsVolForecastLoading(true);
    setVolForecastError(null);
    setActiveForecast(null); // Clear stale forecast immediately
    setIsGeneratingVolatility(true);

    // Construct the model name for API (explicit, user-driven)
    switch (volModel) {
      case 'GBM':
        selectedModel = 'GBM-CC';
        break;
      case 'GARCH':
        selectedModel = garchEstimator === 'Student-t' ? 'GARCH11-t' : 'GARCH11-N';
        break;
      case 'HAR-RV':
        selectedModel = 'HAR-RV';
        break;
      case 'Range':
        selectedModel = `Range-${rangeEstimator}`;
        break;
      default:
        selectedModel = recommendedModel ?? 'GBM-CC';
        break;
    }

    const isGarchModel = selectedModel === 'GARCH11-N' || selectedModel === 'GARCH11-t';
    const isRangeModel = selectedModel.startsWith('Range-');
    const resolvedDist = isGarchModel && selectedModel === 'GARCH11-t' ? 'student-t' : 'normal';
    const resolvedEstimator = isRangeModel ? selectedModel.split('-')[1] || rangeEstimator : rangeEstimator;

    console.log("[VOL][handler] inputs", { 
      volModel,
      garchEstimator,
      rangeEstimator,
      selectedModel,
      volWindow, 
      dist: resolvedDist, 
      estimator: resolvedEstimator,
      varianceTargeting: garchVarianceTargeting,
      tickerParam, 
      effectiveCoverage, 
      effectiveTZ 
    });

    try {
      // Build params using selected model (single source of truth)
      let modelParams: any = {};
      
      if (selectedModel === 'GBM-CC') {
        modelParams.gbm = {
          windowN: effectiveWindowN,
          lambdaDrift: gbmLambda,
        };
      } else if (isGarchModel) {
        modelParams.garch = {
          window: effectiveWindowN,
          variance_targeting: garchVarianceTargeting,
          dist: resolvedDist,
          ...(resolvedDist === 'student-t' ? { df: garchDf } : {})
        };
      } else if (selectedModel === 'HAR-RV') {
        modelParams.har = {
          window: effectiveWindowN,
          use_intraday_rv: harUseIntradayRv
        };
      } else { // Range-* (default path)
        modelParams.range = {
          estimator: resolvedEstimator,
          window: effectiveWindowN,
          ewma_lambda: rangeEwmaLambda
        };
      }

      console.log("[VOL] POST", { model: selectedModel, estimator: resolvedEstimator });

      // ============================================================================
      // COMPREHENSIVE REQUEST DIAGNOSTIC (Step 1: Prove request h changes)
      // ============================================================================
      console.log("🔍 [COMPREHENSIVE-REQUEST-CHECK] Before fetch /api/volatility:", {
        volSelectionKey,
        requestBody: {
          model: selectedModel,
          h: h,
          coverage: effectiveCoverage,
        },
        stateSnapshot: { h, coverage, volModel, garchEstimator, rangeEstimator },
        timestamp: new Date().toISOString(),
      });

      // ============================================================================
      // STEP 1 DIAGNOSTIC: Log forecast request details (especially for Range)
      // ============================================================================
      if (process.env.NODE_ENV === "development") {
        console.log('[🔍 STEP1-REQUEST]', {
          selectedVolModel: volModel,
          selectedRangeEstimator: rangeEstimator,
          selectedGarchEstimator: garchEstimator,
          computedModelString: selectedModel,
          requestPayload: {
            model: selectedModel,
            params: modelParams,
            horizon: h,
            coverage: effectiveCoverage,
            tz: effectiveTZ,
            overwrite: true,
          },
          forecastKey: `${selectedModel}_h${h}_cov${effectiveCoverage}`,
          timestamp: new Date().toISOString(),
        });
      }

      // Add Range-specific logging
      if (selectedModel?.startsWith('Range-')) {
        const estimator = selectedModel.split('-')[1];
        console.log('[RANGE] POST', { 
          url: `/api/volatility/${encodeURIComponent(tickerParam)}`, 
          model: selectedModel, 
          estimator: estimator 
        });
      }

      console.log("[VOL][handler] POST -> /api/volatility", {
        url: `/api/volatility/${encodeURIComponent(tickerParam)}`,
        model: selectedModel,
        windowN: effectiveWindowN,
        dist: resolvedDist,
        requestBody: {
          model: selectedModel,
          params: modelParams,
          overwrite: true,
          horizon: h,
          coverage: effectiveCoverage,
          tz: effectiveTZ
        }
      });
      console.debug("[VOL] POST payload (UI-driven)", {
        model: selectedModel,
        horizon: h,
        coverage: effectiveCoverage,
        windowForModel: effectiveWindowN,
        gbmWindow,
        volWindow
      });
      if (process.env.NODE_ENV === "development") {
        console.info("[VOL][client] generating", {
          ticker: params.ticker,
          volModel,
          garchEstimator,
          rangeEstimator,
          selectedModel,
          volParams: modelParams,
        });
      }

      const resp = await fetch(`/api/volatility/${encodeURIComponent(tickerParam)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel,
          params: modelParams,
          overwrite: true,
          // Pass horizon and coverage from effective values (state or spec fallback)
          horizon: h,
          coverage: effectiveCoverage,
          tz: effectiveTZ
        })
      });

      console.log("[VOL][handler] resp.status =", resp.status);
      console.log("[VOL][handler] resp.headers =", Object.fromEntries(resp.headers.entries()));
      
      if (!resp.ok) {
        // Handle error response with content-type detection
        const contentType = resp.headers.get('content-type') || '';
        let reason: string | undefined;
        let errorMessage = `Server error ${resp.status}`;
        
        if (contentType.includes('application/json')) {
          const errorData = await resp.json();
          errorMessage = errorData.error || errorData.message || JSON.stringify(errorData);
          console.error('[VOL] API error:', errorData);
          console.error('[VOL] Full error details:', errorData);
          const detailedError = errorData.details ? `${errorMessage} - ${errorData.details}` : errorMessage;
          setVolatilityError(detailedError);
          setVolForecastError(detailedError); // Also set transition error
          const normalizedMessage = typeof errorMessage === 'string' ? errorMessage.toLowerCase() : '';
          if (resp.status === 422) {
            if (errorData.code === 'INSUFFICIENT_GBM_DATA') {
              reason = 'INSUFFICIENT_GBM_DATA';
            } else if (errorData.code === 'INSUFFICIENT_GARCH_DATA' || normalizedMessage.includes('insufficient returns for garch estimation')) {
              reason = 'INSUFFICIENT_GARCH_DATA';
            } else if (errorData.code === 'INSUFFICIENT_RANGE_DATA') {
              reason = 'INSUFFICIENT_RANGE_DATA';
            } else if (errorData.code === 'INSUFFICIENT_HAR_DATA') {
              reason = 'INSUFFICIENT_HAR_DATA';
            } else if (normalizedMessage.includes('insufficient data')) {
              reason = 'INSUFFICIENT_DATA';
            }
          } else if (typeof errorMessage === 'string' && normalizedMessage.includes('insufficient data')) {
            reason = 'INSUFFICIENT_DATA';
          }
        } else {
          // Likely HTML error page from server crash
          const htmlText = await resp.text();
          console.error('[VOL] Server error body:', htmlText);
          errorMessage = `Server error ${resp.status}. Check console for details.`;
          setVolatilityError(errorMessage);
          setVolForecastError(errorMessage); // Also set transition error
          reason = 'SERVER_ERROR';
        }
        switch (reason) {
          case 'INSUFFICIENT_GARCH_DATA':
            setModelAvailabilityMessage("GARCH needs roughly 600 clean daily returns; this ticker doesn't have enough data for this window. Showing GBM instead.");
            break;
          case 'INSUFFICIENT_RANGE_DATA':
            setModelAvailabilityMessage("Range estimator needs more clean OHLC data for this window; try a smaller window or a different model.");
            break;
          case 'INSUFFICIENT_GBM_DATA':
            setModelAvailabilityMessage("Not enough history for this GBM window; try a smaller window or another model.");
            break;
          case 'INSUFFICIENT_HAR_DATA':
            setModelAvailabilityMessage("HAR-RV needs more realized volatility data; try another model.");
            break;
          default:
            setModelAvailabilityMessage(null);
        }
        return emitVolResult({ ok: false, forecast: null, reason }, "api-error");
      }

      const bodyText = await resp.text();
      console.log("[VOL][handler] resp.body =", bodyText);

      const data = JSON.parse(bodyText);
      
      // ============================================================================
      // STEP 1 DIAGNOSTIC: Log forecast response details
      // ============================================================================
      if (process.env.NODE_ENV === "development") {
        console.log('[🔍 STEP1-RESPONSE]', {
          httpStatus: resp.status,
          forecastMethod: data?.method || 'MISSING',
          sigmaForecast: data?.estimates?.sigma_forecast || 'MISSING',
          L_h: data?.intervals?.L_h || data?.L_h || 'MISSING',
          U_h: data?.intervals?.U_h || data?.U_h || 'MISSING',
          errorField: data?.error || null,
          success: data?.success !== false,
          fullResponseKeys: Object.keys(data || {}),
          timestamp: new Date().toISOString(),
        });
      }

      setModelAvailabilityMessage(null);
      
      // Tag forecast with selection key BEFORE storing
      const forecastWithKey = { ...data, _key: volSelectionKey };
      
      // STEP 3: Store forecast by key (bulletproof - no fallback chains)
      setForecastByKey(prev => ({ ...prev, [volSelectionKey]: forecastWithKey }));
      
      if (volModel === 'GBM') {
        // GBM from Volatility card is our baseline
        setGbmForecast(forecastWithKey);    // feed green cone baseline
        setVolForecast(null);    // GBM is not considered a "vol" model
        setBaseForecast(forecastWithKey);   // Store as base forecast for conformal calibration
      } else {
        // GARCH / HAR / Range
        setVolForecast(forecastWithKey);    // last volatility model run
        setBaseForecast(forecastWithKey);   // Store as base forecast for conformal calibration
        // NOTE: DO NOT touch gbmForecast here – we keep the baseline
      }
      
      // Always update active forecast so chart reflects the latest model selection
      setActiveForecast(forecastWithKey);
      setCurrentForecast(forecastWithKey);        // keep for legacy compatibility if needed elsewhere
      console.log("[VOL][handler] setForecast", { 
        volModel,
        method: forecastWithKey?.method, 
        date: forecastWithKey?.date_t, 
        is_active: forecastWithKey?.is_active,
        _key: forecastWithKey?._key,
        gbmUpdated: volModel === 'GBM',
        volUpdated: volModel !== 'GBM'
      });

      // Note: Don't call loadLatestForecast here - pipeline will handle state management
      return emitVolResult({ ok: true, forecast: forecastWithKey }, "success");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setVolatilityError(errorMsg);
      setVolForecastError(errorMsg); // Also set transition error
      console.error('[VOL][handler] exception:', err);
      return emitVolResult({ ok: false, forecast: null, reason: 'ERROR' }, "exception");
    } finally {
      // CRITICAL: Always clear loading state in finally block
      setIsGeneratingVolatility(false);
      setIsVolForecastLoading(false);
    }
  }, [
    tickerParam,
    volModel,
    garchEstimator,
    rangeEstimator,
    volWindow,
    garchVarianceTargeting,
    garchDf,
    harUseIntradayRv,
    rangeEwmaLambda,
    gbmWindow,
    gbmLambda,
    historyCount,
    rvAvailable,
    serverTargetSpec,
    targetSpecResult,
    h, // Add horizon as dependency
    coverage, // Add coverage as dependency for effectiveCoverage fallback
    uploadResult, // Add uploadResult as dependency for effectiveTZ fallback
    recommendedModel,
    params.ticker,
  ]);

  // Validation Gates Functions
  const checkGatesBeforeAction = useCallback(async (actionName: string): Promise<boolean> => {
    setIsCheckingGates(true);
    try {
      const response = await fetch(`/api/validation/gates/${params.ticker}`);
      if (!response.ok) {
        throw new Error(`Gates API failed: ${response.status}`);
      }
      const gates: GateStatus = await response.json();
      setGatesStatus(gates);
      
      if (!gates.ok) {
        const errorMsg = `Cannot proceed with ${actionName}:\n${gates.errors.join('\n')}`;
        alert(errorMsg);
        return false;
      }
      
      if (gates.warnings.length > 0) {
        const warningMsg = `Warnings for ${actionName}:\n${gates.warnings.join('\n')}\n\nProceed anyway?`;
        return confirm(warningMsg);
      }
      
      return true;
    } catch (err) {
      console.error('Gates check failed:', err);
      const proceedAnyway = confirm(`Gates validation failed (${err}). Proceed anyway?`);
      return proceedAnyway;
    } finally {
      setIsCheckingGates(false);
    }
  }, [params.ticker]);

  const applyConformalPrediction = useCallback(async (
    overrideBaseForecast?: any
  ): Promise<boolean> => {
    // Check validation gates first
    const canProceed = await checkGatesBeforeAction('conformal prediction');
    if (!canProceed) return false;

    // Derive effective base forecast - use override if provided, fallback to state
    const effectiveBaseForecast = overrideBaseForecast ?? baseForecast;

    // Ensure we have a base forecast to calibrate
    if (!effectiveBaseForecast) {
      console.log("[CONF] applyConformalPrediction guard check:", {
        isInitialized,
        hasBaseForecast: !!baseForecast,
        hasOverrideBaseForecast: !!overrideBaseForecast,
        hasEffectiveBaseForecast: !!effectiveBaseForecast,
        baseForecastCount,
        volModel,
        h,
        coverage,
      });
      const errorMessage = !isInitialized 
        ? 'System is still initializing. Please wait a moment and try again.'
        : 'No base forecast found. Please generate a volatility forecast first by clicking on a model button (GBM, GARCH, HAR-RV, or Range).';
      setConformalError(errorMessage);
      return false;
    }

    // Use selected base method from current UI selection
    const baseMethod = selectedBaseMethod;
    const selectedCoverage = coverage;

    setIsApplyingConformal(true);
    setConformalError(null);

    try {
      const conformalParams = {
        mode: conformalMode,
        domain: conformalDomain,
        cal_window: conformalCalWindow,
        ...(conformalMode === 'ACI' ? { eta: conformalEta } : {}),
        ...(conformalMode === 'EnbPI' ? { K: conformalK } : {})
      };

      const response = await fetch(`/api/conformal/${tickerParam}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: tickerParam,
          params: conformalParams,
          base_method: baseMethod,
          horizon: h,
          coverage: selectedCoverage
        }),
      });

      let data = await response.json();

      console.log("[CONF] API response", {
        ok: response.ok,
        hasState: !!data?.state,
        stateKeys: data?.state ? Object.keys(data.state) : null,
        hasCoverage: !!data?.state?.coverage,
        stateObject: data?.state,
        raw: data,
      });

      if (!response.ok) {
        if (response.status === 409 && data.code === 'DOMAIN_CONFLICT') {
          const confirmRecalibrate = confirm(
            `Domain conflict: existing state uses '${data.existing_domain}' but you selected '${data.requested_domain}'. Do you want to force recalibration?`
          );
          
          if (confirmRecalibrate) {
            // Retry with force=true
            const retryResponse = await fetch(`/api/conformal/${params.ticker}?force=true`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                symbol: params.ticker,
                params: conformalParams,
                base_method: baseMethod,
                horizon: h,
                coverage: selectedCoverage
              }),
            });
            
            const retryData = await retryResponse.json();
            
            if (!retryResponse.ok) {
              throw new Error(retryData.error || 'Failed to apply conformal prediction');
            }
            
            data = retryData; // Use retry data for subsequent processing
          } else {
            setConformalError('Operation cancelled: domain conflict not resolved');
            return false;
          }
        } else if (data.error && data.error.includes('Insufficient base forecasts')) {
          // Enhanced error message for insufficient base forecasts
          const match = data.error.match(/need (\d+), have (\d+)/);
          if (match) {
            const [, needed, have] = match;
            const shortage = parseInt(needed) - parseInt(have);
            setConformalError(
              `Insufficient base forecasts: need ${needed}, have ${have}. ` +
              `Generate ${shortage} more base forecasts or reduce calibration window to ${have}.`
            );
          } else {
            setConformalError(
              `${data.error}. Consider generating more base forecasts or reducing the calibration window.`
            );
          }
          return false;
        } else {
          throw new Error(data.error || 'Failed to apply conformal prediction');
        }
      }

      // Extract base bands for conformal adjustment
      const intervals = effectiveBaseForecast.intervals || effectiveBaseForecast.pi || effectiveBaseForecast;
      const L_base = effectiveBaseForecast.L_h || intervals.L_h || intervals.L1 || intervals.lower;
      const U_base = effectiveBaseForecast.U_h || intervals.U_h || intervals.U1 || intervals.upper;

      // Build updated forecast with conformal bands
      let updatedForecast = effectiveBaseForecast;

      if (typeof data.state?.q_cal === "number" && L_base != null && U_base != null) {
        // Compute conformal-adjusted bands in log space
        const center_base = (L_base + U_base) / 2;
        const yHat = Math.log(center_base);
        const L_conf = Math.exp(yHat - data.state.q_cal);
        const U_conf = Math.exp(yHat + data.state.q_cal);

        updatedForecast = {
          ...effectiveBaseForecast,
          intervals: {
            ...intervals,
            L_base,
            U_base,
            L_conf,
            U_conf
          },
          conformal: {
            q_cal: data.state.q_cal,
            mode: data.state.mode,
            domain: data.state.domain,
          },
        };

        console.log('[Conformal] Applied conformal bands:', { L_conf, U_conf });
      } else {
        console.warn('[Conformal] No valid q_cal or base bands, using effectiveBaseForecast as-is');
      }

      // Single atomic commit of all conformal-related state
      // React will batch these setState calls into one render
      console.log("[CONF] About to set conformal state:", data.state);
      setConformalState(data.state);
      console.log("[CONF] Just set conformal state");
      
      // Critical moment: Setting activeForecast with conformal result
      const timestamp = new Date().toISOString();
      console.log(`🎯 BROWSER DEBUG [${timestamp}] ✅ SETTING activeForecast in conformal pipeline:`, {
        updatedForecastKeys: updatedForecast ? Object.keys(updatedForecast) : null,
        hasIntervals: !!updatedForecast?.intervals,
        hasConformal: !!updatedForecast?.conformal,
        method: updatedForecast?.method,
        date_t: updatedForecast?.date_t,
        stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
      });
      setActiveForecast(updatedForecast);
      
      setCurrentForecast(updatedForecast); // Keep for legacy compatibility
      setShowCoverageDetails(true);

      console.log('[Conformal] Successfully applied conformal prediction with atomic state update');
      console.log("[CONF] applyConformalPrediction success", {
        hasConformalState: !!data?.state,
        updatedForecastKeys: updatedForecast ? Object.keys(updatedForecast) : null,
      });
      return true;

    } catch (err) {
      setConformalError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    } finally {
      setIsApplyingConformal(false);
    }
  }, [
    selectedBaseMethod,
    conformalMode,
    conformalDomain,
    conformalCalWindow,
    conformalEta,
    conformalK,
    tickerParam,
    params.ticker,
    baseForecast,  // Changed from activeForecast to baseForecast
    baseForecastCount,  // Add missing dependency
    volModel,  // Add missing dependency  
    checkGatesBeforeAction,
    h,
    coverage,
    isInitialized,
  ]);

  // Command 2: Add handleUnifiedGenerate orchestrator
  const handleUnifiedGenerate = useCallback(async () => {
    try {
      // 1) First generate/update volatility forecast (GBM / GARCH / HAR / Range)
      const volResult = await generateVolatilityForecast();
      if (!volResult.ok || !volResult.forecast) return;

      // Wait for the forecast to be loaded and active method to be updated
      await loadLatestForecast();

      // 2) Then ensure base forecasts exist for current method + cal window
      if (baseForecastCount !== null && baseForecastCount < conformalCalWindow) {
        const baseRes = await handleGenerateBaseForecasts();
        await loadBaseForecastCount();
        await loadModelLine();
        if (!baseRes.ok) return;
      }

      // 3) Finally apply conformal calibration using the fresh forecast
      await applyConformalPrediction(volResult.forecast);
    } catch (err) {
      console.error('[UnifiedGenerate] error', err);
    }
  }, [
    baseForecastCount,
    conformalCalWindow,
    handleGenerateBaseForecasts,
    loadBaseForecastCount,
    loadModelLine,
    generateVolatilityForecast,
    applyConformalPrediction,
    loadLatestForecast,
  ]);

  // Centralized forecast pipeline with status management
  const runForecastPipeline = useCallback(async () => {
    console.log('[ForecastPipeline] Starting pipeline execution:', { h, coverage, volModel, garchEstimator, rangeEstimator });

    if (!pipelineReady) {
      console.log('[ForecastPipeline] Skipping pipeline - prerequisites not ready', {
        pipelineReady,
        isInitialized,
        h,
        coverage,
        historyCount,
      });
      return;
    }

    try {
      setForecastStatus("loading");
      setForecastError(null);
      setConformalError(null);
      setVolatilityError(null);

      // Clear stale state but preserve activeForecast for chart continuity
      setBaseForecastsStale(true);
      setConformalStale(true);
      setCoverageStatsStale(true);
      setBaseForecastCount(null);
      setConformalState(null);
      // Note: NOT clearing activeForecast here - keep existing forecast visible until new one is ready

      console.log('[ForecastPipeline] Step 1: Generating volatility forecast');
      console.log('[PIPE] Step 1 start - generateVolatilityForecast', {
        volModel,
        hasBaseForecastBefore: !!baseForecast
      });
      // 1) Generate volatility forecast for current volModel/estimator
      const volResult = await generateVolatilityForecast();
      console.log('[PIPE] Step 1 result:', { 
        ok: volResult.ok, 
        hasForecast: !!volResult.forecast,
        hasBaseForecastAfter: !!baseForecast 
      });
      if (!volResult.ok || !volResult.forecast) {
        // Step 1 failed - no base forecast available for chart overlay
        console.log('[PIPE] Step 1 failed - no forecast available for chart overlay');
        setForecastStatus("error");
        return;
      }
      const baseForecastObject = volResult.forecast;

      console.log('[ForecastPipeline] Step 2: Generating base forecasts');
      console.log('[PIPE] Step 2 start - handleGenerateBaseForecasts');
      // 2) Generate / refresh base forecasts for conformal (if needed)
      const baseRes = await handleGenerateBaseForecasts();
      console.log('[PIPE] Step 2 result:', { 
        ok: baseRes.ok,
        baseForecastCount: baseRes.baseForecastCount 
      });
      if (!baseRes.ok) {
        // Step 2 failed - use base forecast for chart overlay if available
        const timestamp = new Date().toISOString();
        console.log(`🎯 BROWSER DEBUG [${timestamp}] ⚠️ Step 2 failed - SETTING activeForecast to baseForecastObject:`, {
          baseForecastObjectKeys: baseForecastObject ? Object.keys(baseForecastObject) : null,
          baseResOk: baseRes.ok,
          stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
        });
        console.log('[PIPE] Step 2 failed - using base forecast as activeForecast for chart overlay');
        setActiveForecast(baseForecastObject);
        setForecastStatus("error");
        return;
      }

      console.log('[ForecastPipeline] Step 3: Applying conformal prediction');
      console.log('[PIPE] Step 3 start - applyConformalPrediction with fresh base forecast');
      // 3) Apply conformal prediction using the fresh base forecast object
      const conformalSuccess = await applyConformalPrediction(baseForecastObject);
      console.log('[PIPE] Step 3 result:', { 
        conformalSuccess, 
        hasConformalState: !!conformalState 
      });
      if (!conformalSuccess) {
        // Fallback: Use base forecast for chart overlay even if conformal fails
        const timestamp = new Date().toISOString();
        console.log(`🎯 BROWSER DEBUG [${timestamp}] ⚠️ Conformal failed - SETTING activeForecast to baseForecastObject:`, {
          conformalSuccess,
          baseForecastObjectKeys: baseForecastObject ? Object.keys(baseForecastObject) : null,
          hasConformalState: !!conformalState,
          stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
        });
        console.log('[PIPE] Conformal failed - using base forecast as activeForecast for chart overlay');
        setActiveForecast(baseForecastObject);
        setForecastStatus("error");
        return;
      }

      // Clear stale flags on success
      setBaseForecastsStale(false);
      setConformalStale(false);
      setCoverageStatsStale(false);
      setForecastHorizonMismatch(false); // Clear horizon mismatch flag

      console.log('[ForecastPipeline] Pipeline complete - setting status to ready');
      console.log('[PIPE] Success - activeForecast should now be available for chart overlay');
      
      // Final pipeline success logging
      const timestamp = new Date().toISOString();
      console.log(`🎯 BROWSER DEBUG [${timestamp}] ✅ Pipeline SUCCESS - activeForecast should remain from conformal step:`, {
        hasActiveForecast: !!activeForecast,
        activeForecastMethod: activeForecast?.method,
        activeForecastDate: activeForecast?.date_t,
        stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
      });
      
      setForecastStatus("ready");
    } catch (error) {
      console.error('[ForecastPipeline] Pipeline error:', error);
      
      // Fallback: If we have a base forecast from step 1, use it for chart overlay
      if (baseForecast) {
        const timestamp = new Date().toISOString();
        console.log(`🎯 BROWSER DEBUG [${timestamp}] ⚠️ Pipeline failed - SETTING activeForecast to baseForecast:`, {
          error: error instanceof Error ? error.message : error,
          baseForecastKeys: baseForecast ? Object.keys(baseForecast) : null,
          stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
        });
        console.log('[PIPE] Pipeline failed - using available baseForecast as activeForecast for chart overlay');
        setActiveForecast(baseForecast);
      }
      
      setForecastStatus("error");
      setForecastError(error instanceof Error ? error.message : 'Failed to complete forecast pipeline');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    h,
    coverage,
    volModel,
    garchEstimator,
    rangeEstimator,
    generateVolatilityForecast,
    handleGenerateBaseForecasts,
    applyConformalPrediction,
    pipelineReady,
    isInitialized,
    resolvedTargetSpec,
    historyCount,
    baseForecast,
    conformalState,
    // Note: activeForecast intentionally omitted - only used for debug logging, not logic
  ]);

  // Handlers for parameter changes - auto-trigger volatility forecast for Inspector
  const handleHorizonChange = useCallback(async (newH: number) => {
    // Update UI state immediately
    setH(newH);
    
    // CRITICAL: Clear ALL forecast state to prevent showing stale h=1 forecast under h=2/3/5
    setActiveForecast(null);
    setForecastByKey(prev => ({ ...prev, [volSelectionKey]: null })); // Clear current key
    
    // Mark that forecast may be stale if we have an active forecast
    setForecastHorizonMismatch(true);

    console.log(`[HorizonChange] Updated horizon to h=${newH}. Cleared stale forecast. Auto-fetch will trigger.`);
    
    // Auto-triggers volatility forecast via useEffect (for Inspector)
    // Conformal calibration only runs when user clicks "Generate"
  }, [volSelectionKey]);

  const handleCoverageChange = useCallback((newCoverage: number) => {
    setCoverage(newCoverage);
    // Auto-triggers volatility forecast via useEffect (for Inspector)
    // Conformal calibration only runs when user clicks "Generate"
  }, []);

  const handleModelChange = useCallback((newModel: 'GBM' | 'GARCH' | 'HAR-RV' | 'Range') => {
    setVolModel(newModel);
    // Clear ALL stale overlays so tooltip/chart doesn't show previous model while new one is loading
    setActiveForecast(null);
    setBaseForecast(null);
    setVolForecast(null);
    setCurrentForecast(null);  // CRITICAL: Clear this to prevent fallback to old forecast
    setGbmForecast(null);       // CRITICAL: Clear this to prevent fallback to old GBM
    // Auto-triggers volatility forecast via useEffect (for Inspector)
    // Conformal calibration only runs when user clicks "Generate"
  }, []);

  const handleEstimatorChange = useCallback((newEstimator: 'P' | 'GK' | 'RS' | 'YZ') => {
    setRangeEstimator(newEstimator);
    // Auto-triggers volatility forecast via useEffect (for Inspector)
    // Conformal calibration only runs when user clicks "Generate"
  }, []);

  const handleGarchEstimatorChange = useCallback((newEstimator: 'Normal' | 'Student-t') => {
    setGarchEstimator(newEstimator);
    // Auto-triggers volatility forecast via useEffect (for Inspector)
    // Conformal calibration only runs when user clicks "Generate"
  }, []);

  // Apply recommended model to UI state (no automatic pipeline execution)
  const handleApplyBestModel = useCallback(() => {
    if (!recommendedModel) return;
    const nextState = parseMethodToUIState(recommendedModel);
    if (!nextState) return;
    
    setVolModel(nextState.volModel);
    if (nextState.garchEstimator) {
      setGarchEstimator(nextState.garchEstimator);
    }
    if (nextState.rangeEstimator) {
      setRangeEstimator(nextState.rangeEstimator);
    }
    
    console.log(`Applied recommended model: ${recommendedModel}`);
    // Do not call runForecastPipeline here – user must click Generate.
  }, [recommendedModel]);

  // Override the early onGenerateBaseForecastsClick with the proper implementation
  // Note: This function is deprecated in favor of the main Generate button
  // Kept for UI compatibility but no longer triggers pipeline automatically
  const onGenerateBaseForecastsClick = useCallback(async () => {
    // Only proceed if there are no base forecasts available (0 or null)
    if (baseForecastCount !== null && baseForecastCount > 0) {
      console.log('[BaseForecasts] Skipping generation - base forecasts already exist:', baseForecastCount);
      return;
    }
    
    console.log('[BaseForecasts] Base forecasts needed - use main Generate button to run full pipeline');
    // Do not call runForecastPipeline here – user must click main Generate button.
  }, [baseForecastCount]);

  // Main Generate button - the ONLY entry point to the forecast pipeline
  const handleGenerateClick = useCallback(() => {
    console.log("[GEN] Click Generate", {
      pipelineReady,
      forecastStatus,
      hasBaseForecast: !!baseForecast,
      h,
      coverage,
      historyCount,
      isInitialized
    });

    if (!pipelineReady) {
      console.log("[Generate] Pipeline not ready:", {
        isInitialized,
        hasValidH: typeof h === "number" && h >= 1,
        hasValidCoverage: typeof coverage === "number" && coverage > 0 && coverage < 1,
        historyCount,
      });
      setForecastError("Pipeline not ready - ensure historical data is loaded.");
      return;
    }

    if (forecastStatus === "loading") {
      console.log("[Generate] Pipeline already in flight, ignoring click.");
      return;
    }

    console.log("[Generate] Running forecast pipeline with current selections.");
    runForecastPipeline();
  }, [
    pipelineReady,
    isInitialized,
    historyCount,
    forecastStatus,
    runForecastPipeline,
    baseForecast,
    coverage,
    h,
  ]);

  const saveTargetSpec = async () => {
    setIsSavingTarget(true);
    setTargetError(null);
    setSaveSuccess(false);

    try {
      const response = await fetch(`/api/target-spec/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ h, coverage, exchange_tz: resolvedTZ }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save target spec');
      }

      setTargetSpecResult({ 
        spec: data, 
        meta: { hasTZ: true, source: "canonical" } 
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      
      // Reload server target spec so generate button enables immediately
      await loadServerTargetSpec();
    } catch (err) {
      setTargetError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSavingTarget(false);
    }
  };

  // Validation
  const isValidH = h >= 1;
  const isValidCoverage = coverage > 0.50 && coverage <= 0.995;
  
  // Compute resolved TZ for Forecast Target save
  const canonicalTZ = uploadResult?.meta?.exchange_tz ?? null;
  const selectedExchange = null; // TODO: Add company state for this
  const resolvedTZ = resolveExchangeTZ({ canonicalTZ, selectedExchange });

  // Auto-save function for horizon and coverage changes
  const autoSaveTargetSpec = useCallback(async () => {
    // Only auto-save if we have valid values and resolved timezone
    if (isValidH && isValidCoverage && resolvedTZ && !isSavingTarget) {
      try {
        const response = await fetch(`/api/target-spec/${params.ticker}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ h, coverage, exchange_tz: resolvedTZ }),
        });

        const data = await response.json();

        if (response.ok) {
          setTargetSpecResult({ 
            spec: data, 
            meta: { hasTZ: true, source: "canonical" } 
          });
          // Reload server target spec so generate button enables immediately
          await loadServerTargetSpec();
        }
      } catch (err) {
        // Silently handle auto-save errors to not interrupt user experience
        console.warn('Auto-save failed:', err);
      }
    }
  }, [isValidH, isValidCoverage, resolvedTZ, isSavingTarget, params.ticker, h, coverage, loadServerTargetSpec]);
  
  // Removed handleHorizonCoverageChange - replaced with explicit handlers above

  // Calculate effective horizon in calendar days (weekend/holiday logic)
  const calculateEffectiveHorizon = useCallback((originDate: Date, horizonDays: number): number => {
    const targetDate = new Date(originDate);
    let tradingDaysAdded = 0;
    
    while (tradingDaysAdded < horizonDays) {
      targetDate.setDate(targetDate.getDate() + 1);
      const dayOfWeek = targetDate.getDay();
      
      // Skip weekends (Saturday = 6, Sunday = 0)
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        tradingDaysAdded++;
      }
    }
    
    // Calculate calendar days difference
    const timeDiff = targetDate.getTime() - originDate.getTime();
    const effectiveHorizon = Math.ceil(timeDiff / (1000 * 3600 * 24));
    
    console.log('[HorizonCalc]', {
      originDate: originDate.toISOString().split('T')[0],
      tradingHorizon: horizonDays,
      targetDate: targetDate.toISOString().split('T')[0],
      effectiveHorizon,
      isWeekendSpanning: effectiveHorizon > horizonDays
    });
    
    return effectiveHorizon;
  }, []);

  // Simplified auto-save for horizon/coverage changes (no auto-generation)
  useEffect(() => {
    if (!isValidH || !isValidCoverage || !resolvedTZ) return;
    
    const timeoutId = setTimeout(() => {
      // Only auto-save target spec, don't trigger forecast pipeline
      autoSaveTargetSpec();
      
      // Mark that settings have changed but don't auto-run pipeline
      console.log('[Settings] Horizon or Coverage changed:', { h, coverage });
    }, 500); // Debounce auto-save by 500ms

    return () => clearTimeout(timeoutId);
  }, [h, coverage, resolvedTZ, isValidH, isValidCoverage, autoSaveTargetSpec]);

  // Auto-trigger volatility forecast (for Inspector) when model/parameters change
  // This ONLY updates the base forecast for the Inspector, NOT conformal calibration
  useEffect(() => {
    // Guard: Only run if pipeline is ready (initialized, has target spec, etc.)
    if (!pipelineReady || !isInitialized) {
      console.log('[AutoForecast] Skipping - pipeline not ready');
      return;
    }

    const availableObs = historyCount;
    const requiredWindowForAuto = volModel === 'GBM' ? gbmWindow : volWindow;
    const maxFeasibleAutoWindow = availableObs > 0 ? Math.min(requiredWindowForAuto, availableObs - 1) : 0;
    let effectiveAutoWindowN = maxFeasibleAutoWindow;
    const autoKey = JSON.stringify({
      ticker: params.ticker,
      volModel,
      garchEstimator,
      rangeEstimator,
      h,
      coverage,
      windowN: effectiveAutoWindowN,
    });

    if (effectiveAutoWindowN <= 0) {
      lastAutoForecastKeyRef.current = autoKey;
      setAutoForecastError('INSUFFICIENT_DATA');
      return;
    }

    if (volModel === 'GARCH') {
      const garchMinWindow = 600;
      if (maxFeasibleAutoWindow < garchMinWindow) {
        setAutoForecastError('INSUFFICIENT_GARCH_DATA');
        lastAutoForecastKeyRef.current = autoKey;
        return;
      }
      effectiveAutoWindowN = maxFeasibleAutoWindow;
    } else if (volModel === 'Range') {
      const rangeMinWindow = 252;
      if (maxFeasibleAutoWindow < rangeMinWindow) {
        setAutoForecastError('INSUFFICIENT_RANGE_DATA');
        lastAutoForecastKeyRef.current = autoKey;
        return;
      }
      effectiveAutoWindowN = maxFeasibleAutoWindow;
    }

    const skipReasons = new Set([
      'INSUFFICIENT_DATA',
      'INSUFFICIENT_GBM_DATA',
      'INSUFFICIENT_GARCH_DATA',
      'INSUFFICIENT_RANGE_DATA',
      'INSUFFICIENT_HAR_DATA',
    ]);

    const shouldSkipForKnownInsufficient =
      autoForecastError ? skipReasons.has(autoForecastError) : false;

    if (lastAutoForecastKeyRef.current === autoKey && shouldSkipForKnownInsufficient) {
      return;
    }
    
    // Debounce to avoid rapid-fire API calls during parameter changes
    const timeoutId = setTimeout(async () => {
      console.log('[AutoForecast] Triggering volatility forecast for Inspector:', {
        volModel,
        garchEstimator,
        rangeEstimator,
        h,
        coverage,
        volWindow,
        garchDf,
        rangeEwmaLambda
      });
      
      try {
        lastAutoForecastKeyRef.current = autoKey;
        // Only generate the volatility forecast (step 1 of pipeline)
        // This updates the Inspector WITHOUT running conformal calibration
        const result = await generateVolatilityForecast();
        
        if (result.ok && result.forecast) {
          console.log('[AutoForecast] Volatility forecast generated successfully');
          setAutoForecastError(null);
          lastAutoForecastKeyRef.current = autoKey;
          // Set as active forecast for chart overlay and Inspector display
          setActiveForecast(result.forecast);
          setBaseForecast(result.forecast);
          // Mark conformal as stale since we have a new base forecast
          setConformalStale(true);
        } else {
          console.log('[AutoForecast] Volatility forecast failed:', result);
          if (result.reason === 'INSUFFICIENT_DATA' || result.reason === 'NO_HISTORY') {
            setAutoForecastError('INSUFFICIENT_DATA');
          } else if (result.reason === 'INSUFFICIENT_GBM_DATA') {
            setAutoForecastError('INSUFFICIENT_GBM_DATA');
          } else if (result.reason === 'INSUFFICIENT_GARCH_DATA') {
            setAutoForecastError('INSUFFICIENT_GARCH_DATA');
          } else if (result.reason === 'INSUFFICIENT_RANGE_DATA') {
            setAutoForecastError('INSUFFICIENT_RANGE_DATA');
          } else if (result.reason === 'INSUFFICIENT_HAR_DATA') {
            setAutoForecastError('INSUFFICIENT_HAR_DATA');
          } else {
            setAutoForecastError(result.reason ?? null);
          }
        }
      } catch (error) {
        console.error('[AutoForecast] Error generating volatility forecast:', error);
        setAutoForecastError('ERROR');
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [
    // Trigger on model/parameter changes
    volModel,
    garchEstimator,
    rangeEstimator,
    h,
    coverage,
    volWindow,
    garchDf,
    rangeEwmaLambda,
    gbmWindow,
    historyCount,
    params.ticker,
    // Guard dependencies
    pipelineReady,
    isInitialized,
    generateVolatilityForecast,
    autoForecastError
  ]);

  // Auto-generation effect removed - pipeline now runs only on explicit user actions
  
  // Save button guard (using resolved TZ instead of client spec)
  const canSave = isValidH && isValidCoverage && !!resolvedTZ;

  const handleFileUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    
    if (!selectedFile) {
      setError('Please select a file to upload');
      return;
    }
    
    setIsUploading(true);
    setError(null);
    setUploadWarning(null);
    setValidationSummary(null); // Clear previous validation summary
    // Don't clear parsedRows here - keep them for display while upload continues

    // Parse the file using our robust parser
    const parseFormData = new FormData();
    parseFormData.set('file', selectedFile);

    try {
      // Parse the file first using our robust parser
      const parseResponse = await fetch('/api/upload', {
        method: 'POST',
        body: parseFormData,
      });

      const parseData = await parseResponse.json();

      // Handle the standardized response format
      const parsed = Array.isArray(parseData.rows) ? parseData.rows : [];
      setParsedRows(parsed);
      
      if (!Array.isArray(parseData.rows) || parsed.length === 0) {
        setError(parseData.error ?? "No valid data rows found. Expected columns: Date, Open, High, Low, Close, Adj Close (or Adj. Close), Volume.");
        return;
      } else if (parsed.length < 252) {
        setUploadWarning("Uploads succeed, but GBM PI recommends ≥252 rows for stable results.");
      }

      // Now proceed with the enhanced upload if parsing succeeded
      const formData = new FormData();
      formData.set('file', selectedFile);
      formData.set('symbol', params.ticker); // Default to ticker from URL
      formData.set('mode', uploadMode); // Add upload mode

      // Use the enhanced upload API
      const response = await fetch('/api/upload/enhanced', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        // Handle error responses from enhanced API
        throw new Error(data.error || data.detail || 'Upload failed');
      }

      // Check if this is a validation summary response (success) or error response
      if (data.ok !== undefined || data.success !== false) {
        // This is a ValidationSummaryResponse (data.ok exists) or success response
        setValidationSummary(data);
        
        // Store the file hash for reprocessing
        setLastFileHash(data.file.hash);

        // Extract and store provenance data for the audit ribbon (M-5)
        setProvenanceData({
          vendor: data.provenance.vendor,
          mappingId: data.provenance.mappingId,
          fileHash: data.file.hash,
          rows: data.file.rows,
          dateRange: data.dateRange,
          processedAt: data.provenance.processedAt
        });
        
        // Also set upload result for backward compatibility with existing UI
        setUploadResult({
          symbol: params.ticker,
          paths: { raw: '', canonical: '', audit: '' },
          counts: { 
            input: data.file.rows, 
            canonical: data.file.rows, 
            invalid: data.validation.ohlcCoherence.failCount,
            missingDays: data.validation.missingDays.totalMissing 
          },
          meta: {
            symbol: params.ticker,
            exchange_tz: 'America/New_York',
            calendar_span: { start: data.dateRange.first, end: data.dateRange.last },
            rows: data.file.rows,
            missing_trading_days: [],
            invalid_rows: data.validation.ohlcCoherence.failCount,
            generated_at: data.provenance.processedAt
          },
          badges: {
            contractOK: true,
            calendarOK: !data.validation.missingDays.blocked,
            tzOK: true,
            corpActionsOK: true,
            validationsOK: data.validation.ohlcCoherence.failCount === 0,
            repairsCount: 0
          }
        });

        // Load preview data after successful upload (A-2)
        await loadPreviewData(data.file.hash);
      } else {
        // Fallback to old upload API if enhanced returns different format
        throw new Error('Unexpected response format');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsUploading(false);
    }
  };

  const handleReprocess = async () => {
    if (!lastFileHash) {
      setError('No file to reprocess. Please upload a file first.');
      return;
    }

    setIsReprocessing(true);
    setError(null);
    setValidationSummary(null); // Clear previous validation summary

    try {
      // Send reprocess request with hash and mode
      const response = await fetch('/api/upload/enhanced', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: uploadMode,
          reprocessHash: lastFileHash,
          symbol: params.ticker,
          mappingId: validationSummary?.provenance.mappingId
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Reprocess failed');
      }

      // Handle successful reprocess response
      if (data.ok !== undefined) {
        setValidationSummary(data);

        // Extract and store provenance data for the audit ribbon (M-5)
        setProvenanceData({
          vendor: data.provenance.vendor,
          mappingId: data.provenance.mappingId,
          fileHash: data.file.hash,
          rows: data.file.rows,
          dateRange: data.dateRange,
          processedAt: data.provenance.processedAt
        });
        
        // Update upload result for backward compatibility
        setUploadResult({
          symbol: params.ticker,
          paths: { raw: '', canonical: '', audit: '' },
          counts: { 
            input: data.file.rows, 
            canonical: data.file.rows, 
            invalid: data.validation.ohlcCoherence.failCount,
            missingDays: data.validation.missingDays.totalMissing 
          },
          meta: {
            symbol: params.ticker,
            exchange_tz: 'America/New_York',
            calendar_span: { start: data.dateRange.first, end: data.dateRange.last },
            rows: data.file.rows,
            missing_trading_days: [],
            invalid_rows: data.validation.ohlcCoherence.failCount,
            generated_at: data.provenance.processedAt
          },
          badges: {
            contractOK: true,
            calendarOK: !data.validation.missingDays.blocked,
            tzOK: true,
            corpActionsOK: true,
            validationsOK: data.validation.ohlcCoherence.failCount === 0,
            repairsCount: 0
          }
        });

        // Load preview data after successful reprocess (A-2)
        await loadPreviewData(data.file.hash);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsReprocessing(false);
    }
  };

  // Column Mapping Functions (A-1)
  const loadColumnMappings = async (vendor?: string) => {
    try {
      const url = vendor ? `/api/mappings?vendor=${vendor}` : '/api/mappings';
      const response = await fetch(url);
      if (response.ok) {
        const mappings = await response.json();
        setColumnMappings(mappings);
      }
    } catch (error) {
      console.error('Failed to load column mappings:', error);
    }
  };

  const detectVendorFromFilename = (filename: string): 'yahoo' | 'bloomberg' | 'refinitiv' | 'unknown' => {
    const lower = filename.toLowerCase();
    if (lower.includes('yahoo') || lower.includes('yf_')) return 'yahoo';
    if (lower.includes('bloomberg') || lower.includes('bbg_')) return 'bloomberg';
    if (lower.includes('refinitiv') || lower.includes('ref_')) return 'refinitiv';
    return 'unknown';
  };

  const openColumnMapping = async (file: File) => {
    setDetectedHeaders(['Date', 'Open', 'High', 'Low', 'Close', 'Adj Close', 'Volume']); // Mock headers for now
    const detectedVendor = detectVendorFromFilename(file.name);
    await loadColumnMappings(detectedVendor);
    
    // Auto-select first matching template
    const matching = columnMappings.find(m => m.vendor === detectedVendor);
    if (matching) {
      setSelectedMapping(matching.id);
    }
    
    setShowColumnMapping(true);
  };

  const saveColumnMapping = async (name: string, vendor: string, mapping: Record<string, string>) => {
    try {
      const response = await fetch('/api/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, vendor, map: mapping })
      });
      
      if (response.ok) {
        const saved = await response.json();
        setColumnMappings(prev => [saved, ...prev]);
        setSelectedMapping(saved.id);
        return saved.id;
      }
    } catch (error) {
      console.error('Failed to save mapping:', error);
    }
    return null;
  };

  // Preview Data Functions (A-2)
  const loadPreviewData = async (fileHash?: string) => {
    try {
      const url = fileHash 
        ? `/api/preview/${params.ticker}?hash=${fileHash}`
        : `/api/preview/${params.ticker}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setPreviewData(data);
      }
    } catch (error) {
      console.error('Failed to load preview data:', error);
    }
  };

  // Corporate Actions Functions (A-4)
  const handleCorporateActionsUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!corporateActionsFile) return;

    setIsUploadingCorporateActions(true);
    setCorporateActionsError(null);
    setCorporateActionsResult(null);

    try {
      const formData = new FormData();
      formData.append('file', corporateActionsFile);
      formData.append('symbol', params.ticker);
      formData.append('conflictResolution', 'manual');

      const response = await fetch('/api/corporate-actions', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      if (data.requiresResolution) {
        // Show conflict resolution modal
        setConflictData(data);
        setShowConflictResolution(true);
      } else {
        // Success
        setCorporateActionsResult(data);
        await loadExistingCorporateActions(); // Refresh the list
      }
    } catch (err) {
      setCorporateActionsError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsUploadingCorporateActions(false);
    }
  };

  const resolveConflicts = async (resolutionType: 'overwrite' | 'skip') => {
    if (!conflictData) return;

    setIsUploadingCorporateActions(true);
    try {
      const formData = new FormData();
      formData.append('file', corporateActionsFile!);
      formData.append('symbol', params.ticker);
      formData.append('conflictResolution', resolutionType);

      const response = await fetch('/api/corporate-actions', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Resolution failed');
      }

      setCorporateActionsResult(data);
      setShowConflictResolution(false);
      setConflictData(null);
      await loadExistingCorporateActions(); // Refresh the list
    } catch (err) {
      setCorporateActionsError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsUploadingCorporateActions(false);
    }
  };

  const loadExistingCorporateActions = async () => {
    try {
      const response = await fetch(`/api/corporate-actions?symbol=${params.ticker}`);
      if (response.ok) {
        const data = await response.json();
        setExistingCorporateActions(data.actions || []);
      }
    } catch (error) {
      console.error('Failed to load existing corporate actions:', error);
    }
  };

  // Delisting Awareness Functions (A-5)
  const loadDelistingStatus = async () => {
    try {
      const response = await fetch(`/api/delisting/status?symbol=${params.ticker}`);
      if (response.ok) {
        const data = await response.json();
        setDelistingInfo(data);
      }
    } catch (error) {
      console.error('Failed to load delisting status:', error);
    }
  };

  const applyDelistingOverride = async () => {
    if (!overrideReason.trim()) return;

    try {
      const response = await fetch('/api/delisting/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: params.ticker,
          overrideReason: overrideReason.trim(),
          overriddenBy: 'manual_user' // In real app, this would be current user
        })
      });

      if (response.ok) {
        const data = await response.json();
        setDelistingInfo(data.delistingInfo);
        setShowDelistingOverride(false);
        setOverrideReason('');
      }
    } catch (error) {
      console.error('Failed to apply delisting override:', error);
    }
  };

  // Export Functions (A-6)
  const exportCanonicalCSV = async () => {
    setIsExporting(true);
    setExportError(null);

    try {
      // First check if data is available
      const infoResponse = await fetch('/api/export/canonical', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: params.ticker })
      });

      if (!infoResponse.ok) {
        const errorData = await infoResponse.json();
        throw new Error(errorData.error || 'Failed to check export availability');
      }

      // If data is available, proceed with download
      const downloadUrl = `/api/export/canonical?symbol=${params.ticker}&format=csv`;
      
      // Create a temporary link element to trigger download
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  // Data Type Management Functions
  const addNewDataType = () => {
    if (newDataTypeName.trim() && !dataTypes.includes(newDataTypeName.trim())) {
      setDataTypes(prev => [...prev, newDataTypeName.trim()]);
      setSelectedDataType(newDataTypeName.trim());
      setNewDataTypeName('');
      setShowAddDataType(false);
    }
  };

  const handleDataTypeKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addNewDataType();
    } else if (e.key === 'Escape') {
      setShowAddDataType(false);
      setNewDataTypeName('');
    }
  };

  // Company Registry Functions
  const saveCompanyInfo = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingCompany(true);
    setCompanySaveSuccess(false);

    try {
      const exchangeInfo = companyExchange ? getExchangeInfo(companyExchange) : null;
      const formattedTicker = companyExchange ? formatTicker(companyTicker, companyExchange) : companyTicker;

      const companyData: CompanyInfo = {
        ticker: companyTicker,
        name: companyName,
        exchange: companyExchange ?? '',
        exchangeInfo: exchangeInfo ? {
          country: exchangeInfo.country,
          region: exchangeInfo.region,
          currency: exchangeInfo.currency,
          timezone: exchangeInfo.timezone,
          formattedTicker
        } : undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const response = await fetch('/api/companies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(companyData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save company');
      }

      setCompanySaveSuccess(true);
      setTimeout(() => setCompanySaveSuccess(false), 3000);

      // M-4: Check for exchange validation warnings after successful save
      try {
        const validationResponse = await fetch('/api/exchange/validate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ticker: companyTicker,
            exchange: companyExchange,
          }),
        });

        if (validationResponse.ok) {
          const validation = await validationResponse.json();
          if (!validation.isValid && validation.warnings.length > 0) {
            const primaryWarning = validation.warnings[0];
            setExchangeWarning({
              show: true,
              message: primaryWarning.message,
              details: primaryWarning.details,
              conflictType: primaryWarning.type,
            });
          }
        }
      } catch (validationError) {
        console.warn('Exchange validation check failed:', validationError);
        // Don't throw - this is a non-critical warning
      }
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSavingCompany(false);
    }
  };

  // Breakout Detection Functions
  const detectBreakoutToday = async () => {
    // Check validation gates first
    const canProceed = await checkGatesBeforeAction('breakout detection');
    if (!canProceed) return;

    setIsDetectingBreakout(true);
    setBreakoutError(null);

    try {
      const response = await fetch(`/api/events/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mode: 'today' }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          setBreakoutError(data.error || 'Cooldown failed or open event exists');
        } else if (response.status === 422) {
          setBreakoutError(data.error || 'Cannot verify today yet');
        } else {
          throw new Error(data.error || 'Detection failed');
        }
        return;
      }

      setLatestEvent(data.created);
      if (data.created) {
        setCooldownStatus({ ok: true, inside_count: 3 });
      }
    } catch (err) {
      setBreakoutError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsDetectingBreakout(false);
    }
  };

  const detectBreakoutForDate = async () => {
    if (!breakoutDetectDate) return;

    // Check validation gates first
    const canProceed = await checkGatesBeforeAction('breakout detection for date');
    if (!canProceed) return;

    setIsDetectingBreakout(true);
    setBreakoutError(null);

    try {
      const response = await fetch(`/api/events/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          mode: 'date', 
          t_date: breakoutDetectDate 
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          setBreakoutError(data.error || 'Cooldown failed or open event exists');
        } else if (response.status === 422) {
          setBreakoutError(data.error || 'Missing data for specified date');
        } else {
          throw new Error(data.error || 'Detection failed');
        }
        return;
      }

      setLatestEvent(data.created);
      if (data.created) {
        setCooldownStatus({ ok: true, inside_count: 3 });
      }
    } catch (err) {
      setBreakoutError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsDetectingBreakout(false);
    }
  };

  // Continuation Clock Functions
  const tickToday = async () => {
    setIsTicking(true);
    setContinuationError(null);

    const today = new Date().toISOString().split('T')[0];

    try {
      const response = await fetch(`/api/continuation/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'tick',
          D_date: today,
          stop_rule: stopRule,
          k_inside: kInside,
          T_max: tMax
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 422) {
          setContinuationError(data.error || 'No open event or missing data');
        } else {
          throw new Error(data.error || 'Tick failed');
        }
        return;
      }

      setLatestEvent(data.updated);
      setLastContinuationAction(data.action);
    } catch (err) {
      setContinuationError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsTicking(false);
    }
  };

  const tickForDate = async () => {
    if (!tickDate) return;

    setIsTicking(true);
    setContinuationError(null);

    try {
      const response = await fetch(`/api/continuation/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'tick',
          D_date: tickDate,
          stop_rule: stopRule,
          k_inside: kInside,
          T_max: tMax
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 422) {
          setContinuationError(data.error || 'No open event or missing data');
        } else {
          throw new Error(data.error || 'Tick failed');
        }
        return;
      }

      setLatestEvent(data.updated);
      setLastContinuationAction(data.action);
    } catch (err) {
      setContinuationError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsTicking(false);
    }
  };

  const rescanFromB = async () => {
    if (!latestEvent) return;

    setIsTicking(true);
    setContinuationError(null);

    try {
      const response = await fetch(`/api/continuation/${params.ticker}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'rescan',
          start: latestEvent.B_date,
          stop_rule: stopRule,
          k_inside: kInside,
          T_max: tMax
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 422) {
          setContinuationError(data.error || 'No open event or missing data');
        } else {
          throw new Error(data.error || 'Rescan failed');
        }
        return;
      }

      setLatestEvent(data.updated);
      setLastContinuationAction(data.action);
    } catch (err) {
      setContinuationError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsTicking(false);
    }
  };

  // Load latest event on mount
  useEffect(() => {
    const loadEvent = async () => {
      try {
        const response = await fetch(`/api/events/${params.ticker}?recent=1`);
        if (response.ok) {
          const data = await response.json();
          setLatestEvent(data.event);
        }
      } catch (error) {
        console.error('Failed to load latest event:', error);
      }
    };
    
    loadEvent();
  }, [params.ticker]);

  // Watchlist and Alerts Functions
  const runAlertsNow = async () => {
    setAlertsLoading(true);

    try {
      const response = await fetch('/api/alerts/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ symbols: [params.ticker] }),
      });

      if (response.ok) {
        const data = await response.json();
        setFiredAlerts(data.fired || []);
      }
    } catch (err) {
      console.error('Failed to run alerts:', err);
    } finally {
      setAlertsLoading(false);
    }
  };

  // Check alerts on mount
  useEffect(() => {
    const checkFiredAlerts = async () => {
      setAlertsLoading(true);

      try {
        const response = await fetch('/api/alerts/run');
        if (response.ok) {
          const data = await response.json();
          setFiredAlerts(data.pending || []);
        }
      } catch (err) {
        console.error('Failed to check fired alerts:', err);
      } finally {
        setAlertsLoading(false);
      }
    };

    const checkIfInWatchlist = async () => {
      try {
        // Check if ticker exists in any watchlist data
        const response = await fetch('/api/watchlist');
        if (response.ok) {
          const data = await response.json();
          const rows = data.rows || data.summary?.rows || [];
          const isInList = rows.some((row: any) => row.symbol === params.ticker);
          setIsInWatchlist(isInList);
          return;
        }

        // If no watchlist data exists yet, check if we should persist from localStorage
        const savedWatchlistState = localStorage.getItem(`watchlist_${params.ticker}`);
        if (savedWatchlistState === 'true') {
          setIsInWatchlist(true);
        }
      } catch (err) {
        console.error('Failed to check watchlist status:', err);
        // Fallback to localStorage if API fails
        const savedWatchlistState = localStorage.getItem(`watchlist_${params.ticker}`);
        if (savedWatchlistState === 'true') {
          setIsInWatchlist(true);
        }
      }
    };

    checkFiredAlerts();
    checkIfInWatchlist();
  }, [params.ticker]);

  // Function to add ticker to watchlist
  const addToWatchlist = async () => {
    setIsAddingToWatchlist(true);
    
    try {
      // Get today's date in YYYY-MM-DD format
      const today = new Date().toISOString().split('T')[0];
      
      const response = await fetch('/api/watchlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          symbols: [params.ticker],
          as_of: today
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to add to watchlist');
      }

      setIsInWatchlist(true);
      
      // Save to localStorage for persistence
      localStorage.setItem(`watchlist_${params.ticker}`, 'true');
    } catch (err) {
      console.error('Failed to add to watchlist:', err);
    } finally {
      setIsAddingToWatchlist(false);
    }
  };

  // Function to sync canonical history from Yahoo Finance
  const handleYahooSync = async () => {
    if (!params?.ticker) return;
    const symbol = params.ticker.toUpperCase();
    setIsYahooSyncing(true);
    setYahooSyncError(null);

    try {
      const res = await fetch(`/api/history/sync/${encodeURIComponent(symbol)}`, {
        method: "GET",
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Sync failed: ${res.status} ${res.statusText} ${text}`);
      }

      // After a successful sync, clear the cached canonical rows so they get re-fetched
      setCfdCanonicalRows(null);
      
      // Show success briefly (the new data will load when Cfd sim is run next)
      console.log(`Yahoo sync complete for ${symbol}`);
    } catch (err: unknown) {
      console.error("Yahoo sync error", err);
      const message = err instanceof Error ? err.message : "Yahoo sync failed";
      setYahooSyncError(message);
    } finally {
      setIsYahooSyncing(false);
    }
  };

  // Load repairs when uploadResult is available
  useEffect(() => {
    const loadRepairsForSymbol = async () => {
      if (!uploadResult) return;
      
      setIsLoadingRepairs(true);
      
      try {
        const response = await fetch(`/api/repairs/${params.ticker}`);
        if (response.ok) {
          const repairs = await response.json();
          setRepairRecords(repairs);
        }
      } catch (err) {
        console.error('Failed to load repairs:', err);
      } finally {
        setIsLoadingRepairs(false);
      }
    };

    loadRepairsForSymbol();
  }, [uploadResult, params.ticker]);

  // Initialize exchange data on mount
  useEffect(() => {
    const initializeExchangeData = async () => {
      try {
        const exchanges = getAllExchanges();
        const regions = getExchangesByRegion();
        setAvailableExchanges(exchanges);
        setExchangesByRegion(regions);
      } catch (error) {
        console.error('Failed to load exchange data:', error);
      }
    };

    initializeExchangeData();
  }, []);

  // Load existing company info when ticker changes
  useEffect(() => {
    const loadCompanyInfo = async () => {
      try {
        const response = await fetch(`/api/companies?ticker=${params.ticker}`);
        if (response.status === 404) {
          return;
        }
        if (response.ok) {
          const company: CompanyInfo = await response.json();
          setCompanyName(company.name || '');
          setCompanyTicker(params.ticker);
          setCompanyExchange(
            (company as any).exchange ??
              (company as any)?.exchangeInfo?.primaryExchange ??
              null
          );
          return;
        } else {
          console.error('Failed to load company info:', response.status, response.statusText);
          setCompanyTicker(params.ticker);
        }
      } catch (error) {
        console.error('Failed to load company info:', error);
        setCompanyTicker(params.ticker);
      }
    };

    if (params.ticker) {
      loadCompanyInfo();
    }
  }, [params.ticker]);

  // Load base forecast count for conformal prediction
  useEffect(() => {
    loadBaseForecastCount();
  }, [params.ticker, loadBaseForecastCount]);

  const tickerDisplay = companyTicker || params.ticker.toUpperCase();
  const logoLetter = tickerDisplay.slice(0, 1);
  const exchangeDisplay = companyExchange ?? '—';
  const historyLastClose =
    headerPriceSeries && headerPriceSeries.length > 0
      ? headerPriceSeries[headerPriceSeries.length - 1].close
      : headerPrice.price;
  const historyPrevClose =
    headerPriceSeries && headerPriceSeries.length > 1
      ? headerPriceSeries[headerPriceSeries.length - 2].close
      : null;
  const historyChangeAbs =
    historyLastClose != null && historyPrevClose != null
      ? historyLastClose - historyPrevClose
      : null;
  const historyChangePct =
    historyLastClose != null && historyPrevClose != null && historyPrevClose !== 0
      ? ((historyLastClose - historyPrevClose) / historyPrevClose) * 100
      : null;

  const livePrice = quote?.price ?? null;
  const liveChange = quote ? quote.change : null;
  const liveChangePct = quote ? quote.changePct : null;

  const priceValue = livePrice ?? historyLastClose ?? headerPrice?.price ?? null;
  const priceDisplay =
    priceValue != null
      ? priceValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : isQuoteLoading
        ? '—'
        : '—';

  const changeValue = quote ? liveChange : historyChangeAbs;
  const changePctValue = quote ? liveChangePct : historyChangePct;

  const changeColor =
    changeValue == null ? 'text-slate-400' : changeValue >= 0 ? 'text-emerald-400' : 'text-rose-400';
  const changeDisplay =
    changeValue != null ? `${changeValue >= 0 ? '+' : ''}${changeValue.toFixed(2)}` : '—';
  const changePctDisplay =
    changePctValue != null ? `${changePctValue >= 0 ? '+' : ''}${changePctValue.toFixed(2)}%` : null;

  const historyAsOf =
    headerPriceSeries && headerPriceSeries.length > 0
      ? headerPriceSeries[headerPriceSeries.length - 1].date
      : headerPrice.date;
  const headerTimestamp = quote?.asOf ?? historyAsOf ?? headerPrice?.date ?? null;
  const headerTimestampDisplay =
    headerTimestamp && !Number.isNaN(Date.parse(headerTimestamp))
      ? new Date(headerTimestamp).toLocaleString()
      : headerTimestamp;

  useEffect(() => {
    if (priceValue == null) return;
    const prev = prevPriceRef.current;
    if (prev != null && prev !== priceValue) {
      const dir = priceValue > prev ? 'up' : 'down';
      setPriceDirection(dir);
      const timeout = setTimeout(() => setPriceDirection(null), 500);
      prevPriceRef.current = priceValue;
      return () => clearTimeout(timeout);
    }
    prevPriceRef.current = priceValue;
  }, [priceValue]);

  const actionButtons = (
    <>
      {/* Add to Watchlist Button */}
      <button
        onClick={addToWatchlist}
        disabled={isAddingToWatchlist || isInWatchlist}
        className={`group relative flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200 ${
          isInWatchlist
            ? 'bg-emerald-500 text-white border border-emerald-500 cursor-default'
            : isDarkMode
              ? 'text-slate-300 border border-slate-700/70 hover:text-white hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed'
              : 'text-slate-600 border border-slate-200 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed'
        }`}
        title={isInWatchlist ? 'Already in Watchlist' : 'Add to Watchlist'}
      >
        {isInWatchlist ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-5 h-5 transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.75">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        )}
      </button>
    </>
  );

  return (
    <>
      {/* Apple-style sticky bar that appears after scrolling */}
      <StickyTickerBar
        ticker={tickerDisplay}
        companyName={companyName || undefined}
        currentPrice={priceValue ?? undefined}
        priceChange={changeValue ?? undefined}
        priceChangePercent={changePctValue ?? undefined}
      />
      
      <div className="mx-auto w-full max-w-[1400px] px-6 md:px-10 py-6 bg-background text-foreground">
        <div className="grid grid-cols-[1fr_auto] gap-5 items-center mb-8">
          <div className="space-y-3">
              <h1 className="text-4xl font-semibold tracking-tight text-white">
                {companyName || tickerDisplay}
              </h1>
              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-700/30 backdrop-blur-xl bg-transparent px-3 py-1 text-slate-200">
                  <span className="font-medium">{tickerDisplay}</span>
                <span className="text-slate-500">·</span>
                <span>{exchangeDisplay}</span>
              </div>
              <MarketSessionBadge symbol={params.ticker} />
            </div>
            <div className="flex flex-wrap items-baseline gap-3">
              <div className="flex items-baseline gap-2">
                <span className={`text-5xl md:text-6xl font-semibold tracking-tight transition-colors duration-300 ${priceDirection === 'up' ? 'price-up' : priceDirection === 'down' ? 'price-down' : 'text-slate-100'}`}>
                  {priceDisplay}
                </span>
                <span className="text-sm uppercase text-slate-400">USD</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className={`text-xl font-semibold ${changeColor}`}>
                  {changeDisplay}
                </span>
                {changePctDisplay && (
                  <span className={`text-xl font-semibold ${changeColor}`}>
                    {changePctDisplay}
                  </span>
                )}
              </div>
            </div>
            {headerTimestampDisplay && (
              <p className="text-xs text-slate-500">
                As of {headerTimestampDisplay}
              </p>
            )}
        </div>
        <div className="flex items-center gap-2">
          {actionButtons}
        </div>
      </div>
      {/* Trend Analysis Section */}
      <div className="mb-8">
        <TrendSection
          ticker={params.ticker}
          horizon={h}
          coverage={coverage}
          shortWindowOverride={trendShortWindow}
          longWindowOverride={trendLongWindow}
          onEwmaWindowChange={(short, long) => {
            setTrendShortWindow(short);
            setTrendLongWindow(long);
          }}
          momentumPeriodOverride={trendMomentumPeriod}
          onMomentumPeriodChange={setTrendMomentumPeriod}
          ewmaCrossoverOverride={trendEwmaCrossover}
          trendWeight={trendWeight}
          trendWeightUpdatedAt={trendWeightUpdatedAt}
        />
      </div>

      {/* Price Chart Section */}
      <div className="mb-4">
        {showSimulationSettings && (
          <div
            ref={simulationSettingsRef}
            id="simulation-settings-panel"
            className={`mb-4 rounded-2xl border p-4 ${
              isDarkMode ? "border-slate-800 bg-slate-900/60 text-slate-100" : "border-slate-200 bg-white text-slate-900"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">Simulation settings</div>
              <button
                type="button"
                onClick={() => setShowSimulationSettings(false)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  isDarkMode
                    ? "bg-slate-800 text-slate-200 hover:bg-slate-700"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Close
              </button>
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Horizon (days)</label>
                <input
                  type="number"
                  min={1}
                  value={h}
                  onChange={(e) => handleHorizonChange(Math.max(1, Number(e.target.value) || 1))}
                  className={`w-full rounded-md border px-2 py-1.5 text-sm ${
                    isDarkMode
                      ? "bg-slate-900 border-slate-700 text-slate-100"
                      : "bg-white border-slate-200 text-slate-800"
                  }`}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Coverage</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="0.99"
                  value={coverage}
                  onChange={(e) => handleCoverageChange(Math.min(0.99, Math.max(0.01, Number(e.target.value) || coverage)))}
                  className={`w-full rounded-md border px-2 py-1.5 text-sm ${
                    isDarkMode
                      ? "bg-slate-900 border-slate-700 text-slate-100"
                      : "bg-white border-slate-200 text-slate-800"
                  }`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Initial equity ($)</label>
                <input
                  type="number"
                  min={0}
                  value={cfdInitialEquity}
                  onChange={(e) => setCfdInitialEquity(Number(e.target.value) || 0)}
                  className={`w-full rounded-md border px-2 py-1.5 text-sm ${
                    isDarkMode
                      ? "bg-slate-900 border-slate-700 text-slate-100"
                      : "bg-white border-slate-200 text-slate-800"
                  }`}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Leverage</label>
                <input
                  type="number"
                  min={0}
                  value={cfdLeverage}
                  onChange={(e) => setCfdLeverage(Number(e.target.value) || 0)}
                  className={`w-full rounded-md border px-2 py-1.5 text-sm ${
                    isDarkMode
                      ? "bg-slate-900 border-slate-700 text-slate-100"
                      : "bg-white border-slate-200 text-slate-800"
                  }`}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Position size (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={Math.round(cfdPositionFraction * 1000) / 10}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (Number.isFinite(next)) {
                      setCfdPositionFraction(Math.max(0, Math.min(100, next)) / 100);
                    }
                  }}
                  className={`w-full rounded-md border px-2 py-1.5 text-sm ${
                    isDarkMode
                      ? "bg-slate-900 border-slate-700 text-slate-100"
                      : "bg-white border-slate-200 text-slate-800"
                  }`}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">Cost (bps)</label>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={cfdCostBps}
                  onChange={(e) => setCfdCostBps(Number(e.target.value) || 0)}
                  className={`w-full rounded-md border px-2 py-1.5 text-sm ${
                    isDarkMode
                      ? "bg-slate-900 border-slate-700 text-slate-100"
                      : "bg-white border-slate-200 text-slate-800"
                  }`}
                />
              </div>
            </div>
          </div>
        )}
        {process.env.NODE_ENV === "development" && (() => {
          console.debug("[VOL-TRANS][parent]", { volSelectionKey, isVolForecastLoading, volForecastError });
          return null;
        })()}
        <PriceChart 
          symbol={params.ticker} 
          className="w-full"
          canonicalRows={cfdCanonicalRows}
          horizon={h}
          livePrice={livePrice}
          forecastOverlay={forecastOverlayProps}
          volSelectionKey={volSelectionKey}
          isVolForecastLoading={isVolForecastLoading}
          trendOverlays={trendOverlays}
          showTrendEwma={trendOverlays.ewma}
          onToggleEwmaTrend={toggleEwmaTrendOverlay}
          ewmaShortWindow={trendShortWindow}
          ewmaLongWindow={trendLongWindow}
          ewmaShortSeries={trendEwmaSeries.short}
          ewmaLongSeries={trendEwmaSeries.long}
          trendEwmaCrossSignals={trendEwmaSeries.crossSignals}
          momentumScoreSeries={chartMomentum?.scoreSeries ?? undefined}
          momentumPeriod={chartMomentum?.period ?? trendMomentumPeriod}
          adxPeriod={chartAdx?.period ?? 14}
          adxSeries={chartAdx?.series ?? undefined}
          horizonCoverage={{
            h,
            coverage,
            onHorizonChange: handleHorizonChange,
            onCoverageChange: handleCoverageChange,
            isLoading: forecastStatus === "loading",
          }}
          tradeOverlays={cfdTradeOverlays}
          cfdAccountHistory={cfdAccountHistory}
          activeCfdRunId={activeCfdRunId}
          onToggleCfdRun={toggleCfdRunVisibility}
          simulationMode={simulationMode}
          onChangeSimulationMode={handleChangeSimulationMode}
          hasMaxRun={hasMaxRun}
          trendWeight={trendWeight}
          trendWeightUpdatedAt={trendWeightUpdatedAt}
          simulationRuns={simulationRunsSummary}
          selectedSimRunId={selectedSimRunId}
          onSelectSimulationRun={setSelectedSimRunId}
          selectedSimByDate={selectedSimByDate}
          selectedPnlLabel={selectedPnlLabel}
          selectedOverviewStats={selectedOverviewStats}
          selectedAnalytics={selectedAnalytics}
          simComparePreset={simComparePreset}
          visibleWindow={visibleWindow}
          onChangeSimComparePreset={handleSimComparePresetChange}
          onChangeSimCompareCustom={handleSimCompareCustomChange}
          onVisibleWindowChange={handleVisibleWindowChange}
          cfdInitialEquity={cfdInitialEquity}
          cfdLeverage={cfdLeverage}
          cfdPositionFraction={cfdPositionFraction}
          cfdThresholdFrac={cfdThresholdFrac}
          cfdCostBps={cfdCostBps}
          cfdZMode={cfdZMode}
          cfdSignalRule={cfdSignalRule}
          cfdZDisplayThresholds={cfdZDisplayThresholds}
          cfdZOptimized={cfdZOptimizeResult}
          isOptimizingZThresholds={isOptimizingZThresholds}
          cfdZOptimizeError={cfdZOptimizeError}
          onApplyOptimizedZThresholds={handleApplyOptimizedZThresholds}
          onChangeCfdInitialEquity={setCfdInitialEquity}
          onChangeCfdLeverage={setCfdLeverage}
          onChangeCfdPositionFraction={setCfdPositionFraction}
          onChangeCfdThresholdPct={setCfdThresholdFrac}
          onChangeCfdCostBps={setCfdCostBps}
          onOptimizeZThresholds={runZThresholdOptimization}
          onOpenSimulationSettings={handleOpenSimulationSettings}
        />
      </div>
      
      {modelAvailabilityMessage && (
        <div className={`mb-4 text-sm ${isDarkMode ? 'text-amber-200' : 'text-amber-700'}`}>
          {modelAvailabilityMessage}
        </div>
      )}


      {/* EWMA Reaction Map Card */}
      <div className="mb-8">
        {/* Header */}
        <div className="mb-4">
          <h3 className={`text-lg font-semibold ${
            isDarkMode ? 'text-white' : 'text-gray-900'
          }`}>EWMA Reaction Map</h3>

          {/* Summary info row */}
          {reactionMapSummary && (
            <div className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Train: {reactionMapSummary.trainStart} → {reactionMapSummary.trainEnd} ({reactionMapSummary.nTrain} obs) · 
              Test: {reactionMapSummary.testStart} → {reactionMapSummary.testEnd} ({reactionMapSummary.nTest} obs) ·
              H(d): {h} · Cov%: {Math.round(coverage * 1000) / 10}%
            </div>
          )}
        </div>

        {/* Error Display */}
        {reactionError && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
            {reactionError}
          </div>
        )}

        {/* Two-column layout */}
        {reactionMapSummary && reactionMapSummary.buckets.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            
            {/* Left Column: Bucket Statistics */}
            <div className={`rounded-xl p-4 border ${
              isDarkMode 
                ? 'bg-transparent border-slate-700/50' 
                : 'bg-transparent border-gray-200'
            }`}>
              <h4 className={`text-sm font-medium mb-3 ${
                isDarkMode ? 'text-slate-300' : 'text-gray-700'
              }`}>Bucket Statistics</h4>

              <div className="overflow-x-auto">
                <table className={`w-full text-[11px] ${isDarkMode ? 'text-slate-300' : 'text-gray-700'}`}>
                  <thead className={`${isDarkMode ? 'text-slate-500' : 'text-gray-500'}`}>
                    <tr className={`border-b ${isDarkMode ? 'border-slate-700/70' : 'border-gray-200'}`}>
                      <th className="py-1.5 pr-2 text-left font-medium">Bucket</th>
                      <th className="py-1.5 px-2 text-right font-medium">h</th>
                      <th className="py-1.5 px-2 text-right font-medium">n</th>
                      <th className="py-1.5 px-2 text-right font-medium">P(Up)</th>
                      <th className="py-1.5 px-2 text-right font-medium">Mean %</th>
                      <th className="py-1.5 pl-2 text-right font-medium">Std %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reactionMapSummary.buckets.map((b) => (
                      <tr 
                        key={`${b.bucketId}-${b.horizon}`}
                        className="transition-colors rounded-lg hover:bg-sky-500/20 cursor-pointer"
                      >
                        <td className="py-2 pl-2 pr-2 font-mono rounded-l-lg">{b.bucketId}</td>
                        <td className="py-2 px-2 text-right">{b.horizon}</td>
                        <td className="py-2 px-2 text-right">{b.nObs}</td>
                        <td className={`py-2 px-2 text-right font-medium ${
                          b.pUp > 0.55 
                            ? 'text-emerald-500' 
                            : b.pUp < 0.45 
                              ? 'text-rose-500' 
                              : isDarkMode ? 'text-slate-400' : 'text-gray-500'
                        }`}>
                          {(b.pUp * 100).toFixed(1)}%
                        </td>
                        <td className={`py-2 px-2 text-right font-mono ${
                          b.meanReturn > 0 
                            ? 'text-emerald-500' 
                            : b.meanReturn < 0 
                              ? 'text-rose-500' 
                              : isDarkMode ? 'text-slate-400' : 'text-gray-500'
                        }`}>
                          {(b.meanReturn * 100).toFixed(2)}
                        </td>
                        <td className="py-2 pl-2 pr-2 text-right font-mono rounded-r-lg">
                          {(b.stdReturn * 100).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right Column: Optimization Results */}
            <div className="space-y-4">
              <div className={`rounded-xl p-4 border ${
                isDarkMode 
                  ? 'bg-transparent border-slate-700/50' 
                  : 'bg-transparent border-gray-200'
              }`}>
                <div className="flex items-center justify-between mb-3">
                  <h4 className={`text-sm font-medium ${
                    isDarkMode ? 'text-slate-300' : 'text-gray-700'
                  }`}>REMOVED - Optimization Result</h4>
                </div>
                
                <div className={`p-4 rounded-md ${
                  isDarkMode 
                    ? 'bg-gray-700 text-gray-300' 
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  <p className="text-sm">This section has been removed.</p>
                </div>
              </div>
            </div>
          </div>
        ) : !isLoadingReaction && !reactionError && (
          <div className={`text-center py-12 rounded-xl border ${
            isDarkMode 
              ? 'bg-transparent text-slate-500 border-slate-800/50' 
              : 'bg-transparent text-gray-500 border-gray-200'
          }`}>
            Click &quot;Run&quot; to compute the EWMA Reaction Map
          </div>
        )}
      </div>

      {/* Unified Forecast Bands Card - Full Width */}
      <div className="mb-8">
        <div className={`p-6 border rounded-lg shadow-sm ${
          isDarkMode 
            ? 'bg-gray-800 border-gray-600' 
            : 'bg-white border-gray-200'
        }`} data-testid="card-forecast-bands">
          <h3 className={`text-xl font-semibold mb-4 ${
            isDarkMode ? 'text-white' : 'text-gray-900'
          }`}>REMOVED - Forecast Bands</h3>
          
          <div className={`p-4 rounded-md ${
            isDarkMode 
              ? 'bg-gray-700 text-gray-300' 
              : 'bg-gray-100 text-gray-600'
          }`}>
            <p className="text-sm">This section has been removed.</p>
          </div>
          </div>
        </div>

      {/* Data Preview Panel (A-2) */}
      {previewData && (
        <div className="mb-8 p-6 border rounded-lg bg-white shadow-sm">
          <h3 className="text-lg font-semibold mb-4">Data Preview</h3>
          
          {/* Head/Tail Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Head Table */}
            <div>
              <h4 className="font-medium text-gray-700 mb-3">First 5 rows</h4>
              <div className="bg-gray-50 p-3 rounded border overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="border-b border-gray-300">
                      <th className="text-left py-1 px-2">Date</th>
                      <th className="text-right py-1 px-2">Open</th>
                      <th className="text-right py-1 px-2">High</th>
                      <th className="text-right py-1 px-2">Low</th>
                      <th className="text-right py-1 px-2">Close</th>
                      <th className="text-right py-1 px-2">Adj</th>
                      <th className="text-right py-1 px-2">Vol</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Array.isArray(previewData.head) ? previewData.head : []).map((row, idx) => (
                      <tr key={idx} className="border-b border-gray-200">
                        <td className="py-1 px-2 text-gray-700">{row.date}</td>
                        <td className="py-1 px-2 text-right text-gray-600">{row.open}</td>
                        <td className="py-1 px-2 text-right text-gray-600">{row.high}</td>
                        <td className="py-1 px-2 text-right text-gray-600">{row.low}</td>
                        <td className="py-1 px-2 text-right text-gray-600">{row.close}</td>
                        <td className="py-1 px-2 text-right text-blue-600">{row.adj_close}</td>
                        <td className="py-1 px-2 text-right text-gray-500">{row.volume}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tail Table */}
            {previewData.tail.length > 0 && (
              <div>
                <h4 className="font-medium text-gray-700 mb-3">Last 5 rows</h4>
                <div className="bg-gray-50 p-3 rounded border overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-gray-300">
                        <th className="text-left py-1 px-2">Date</th>
                        <th className="text-right py-1 px-2">Open</th>
                        <th className="text-right py-1 px-2">High</th>
                        <th className="text-right py-1 px-2">Low</th>
                        <th className="text-right py-1 px-2">Close</th>
                        <th className="text-right py-1 px-2">Adj</th>
                        <th className="text-right py-1 px-2">Vol</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(Array.isArray(previewData.tail) ? previewData.tail : []).map((row, idx) => (
                        <tr key={idx} className="border-b border-gray-200">
                          <td className="py-1 px-2 text-gray-700">{row.date}</td>
                          <td className="py-1 px-2 text-right text-gray-600">{row.open}</td>
                          <td className="py-1 px-2 text-right text-gray-600">{row.high}</td>
                          <td className="py-1 px-2 text-right text-gray-600">{row.low}</td>
                          <td className="py-1 px-2 text-right text-gray-600">{row.close}</td>
                          <td className="py-1 px-2 text-right text-blue-600">{row.adj_close}</td>
                          <td className="py-1 px-2 text-right text-gray-500">{row.volume}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Gaps List */}
          {Array.isArray(previewData.gaps) && previewData.gaps.length > 0 && (
            <div>
              <h4 className="font-medium text-gray-700 mb-3">Missing Trading Days</h4>
              <div className="space-y-2">
                {previewData.gaps.map((gap, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-between p-2 rounded text-sm ${
                      gap.severity === 'warn'
                        ? 'bg-amber-50 border border-amber-200 text-amber-800'
                        : 'bg-blue-50 border border-blue-200 text-blue-800'
                    }`}
                  >
                    <span className="font-mono">
                      {gap.end ? `${gap.start} .. ${gap.end}` : gap.start}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      gap.severity === 'warn'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}>
                      ({gap.days} day{gap.days > 1 ? 's' : ''}) [{gap.severity === 'warn' ? 'Warn' : 'Info'}]
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Repairs & Audit Panel (A-3) */}
      <EnhancedRepairsPanel
        symbol={params.ticker}
        isOpen={showRepairsPanel}
        onClose={() => setShowRepairsPanel(false)}
      />

      {/* Data Contract Popover */}
      {showDataContract && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-6 border w-auto max-w-2xl shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-medium text-gray-900">
                  Data Contract
                </h3>
                <button
                  onClick={() => setShowDataContract(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              <div className="space-y-4">
                <h4 className="text-md font-medium text-gray-800">Required columns (canonical daily dataset)</h4>
                
                <div className="overflow-x-auto">
                  <table className="min-w-full border border-gray-300">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 border-b">Column</th>
                        <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 border-b">Type & Requirements</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      <tr className="border-b">
                        <td className="px-4 py-2 text-sm font-mono">date</td>
                        <td className="px-4 py-2 text-sm">YYYY-MM-DD, exchange local</td>
                      </tr>
                      <tr className="border-b">
                        <td className="px-4 py-2 text-sm font-mono">open, high, low, close</td>
                        <td className="px-4 py-2 text-sm">split-adjusted, &gt;0</td>
                      </tr>
                      <tr className="border-b">
                        <td className="px-4 py-2 text-sm font-mono">adj_close</td>
                        <td className="px-4 py-2 text-sm">split+dividend adjusted</td>
                      </tr>
                      <tr className="border-b">
                        <td className="px-4 py-2 text-sm font-mono">volume</td>
                        <td className="px-4 py-2 text-sm">int ≥ 0</td>
                      </tr>
                      <tr className="border-b">
                        <td className="px-4 py-2 text-sm font-mono">split_factor</td>
                        <td className="px-4 py-2 text-sm">float</td>
                      </tr>
                      <tr className="border-b">
                        <td className="px-4 py-2 text-sm font-mono">cash_dividend</td>
                        <td className="px-4 py-2 text-sm">float per share</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2 text-sm font-mono">source</td>
                        <td className="px-4 py-2 text-sm">string: vendor+timestamp</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                
                <div className="pt-2">
                  <a
                    href="/api/mapping"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 underline text-sm"
                  >
                    Column Mapping
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Column Mapping Modal (A-1) */}
      {showColumnMapping && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-8 mx-auto p-6 border w-auto max-w-4xl shadow-lg rounded-md bg-white">
            <div className="mt-3">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-medium text-gray-900">
                  Column Mapping
                </h3>
                <button
                  onClick={() => setShowColumnMapping(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Tab Navigation */}
              <div className="flex mb-6 border-b">
                <button
                  onClick={() => setMappingTab('template')}
                  className={`px-4 py-2 font-medium text-sm ${
                    mappingTab === 'template'
                      ? 'border-b-2 border-blue-600 text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Choose Template
                </button>
                <button
                  onClick={() => setMappingTab('custom')}
                  className={`px-4 py-2 font-medium text-sm ${
                    mappingTab === 'custom'
                      ? 'border-b-2 border-blue-600 text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Create/Edit Mapping
                </button>
              </div>

              {/* Template Tab */}
              {mappingTab === 'template' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Saved Mappings</label>
                    <select
                      value={selectedMapping || ''}
                      onChange={(e) => setSelectedMapping(e.target.value || null)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    >
                      <option value="">Select a mapping template...</option>
                      {columnMappings.map((mapping) => (
                        <option key={mapping.id} value={mapping.id}>
                          {mapping.name} ({mapping.vendor})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Preview selected mapping */}
                  {selectedMapping && (() => {
                    const mapping = columnMappings.find(m => m.id === selectedMapping);
                    return mapping ? (
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <h4 className="font-medium mb-2">{mapping.name}</h4>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="font-medium text-gray-700 mb-1">Source Columns:</p>
                            <ul className="space-y-1">
                              {Object.keys(mapping.map).map((source) => (
                                <li key={source} className="text-gray-600">{source}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <p className="font-medium text-gray-700 mb-1">Canonical Fields:</p>
                            <ul className="space-y-1">
                              {Object.values(mapping.map).map((target, idx) => (
                                <li key={idx} className="text-gray-600">{target}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    ) : null;
                  })()}
                </div>
              )}

              {/* Custom Tab */}
              {mappingTab === 'custom' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-6">
                    {/* Left: Detected Headers */}
                    <div>
                      <h4 className="font-medium mb-3 text-gray-700">Detected Headers</h4>
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {detectedHeaders.map((header, idx) => (
                          <div key={idx} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                            <span className="text-sm font-mono text-gray-700">{header}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Right: Canonical Fields */}
                    <div>
                      <h4 className="font-medium mb-3 text-gray-700">Map to Canonical Fields</h4>
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {detectedHeaders.map((header, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-20 truncate">{header}:</span>
                            <select
                              value={customMapping[header] || ''}
                              onChange={(e) => setCustomMapping(prev => {
                                const newMapping = { ...prev };
                                if (e.target.value) {
                                  newMapping[header] = e.target.value;
                                } else {
                                  delete newMapping[header];
                                }
                                return newMapping;
                              })}
                              className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                            >
                              <option value="">-- Skip --</option>
                              <option value="date">date</option>
                              <option value="open">open</option>
                              <option value="high">high</option>
                              <option value="low">low</option>
                              <option value="close">close</option>
                              <option value="adj_close">adj_close</option>
                              <option value="volume">volume</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Save Custom Mapping */}
                  <div className="border-t pt-4">
                    <div className="flex gap-4">
                      <input
                        type="text"
                        placeholder="Template name..."
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                        id="customMappingName"
                      />
                      <select
                        className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                        id="customMappingVendor"
                      >
                        <option value="unknown">Unknown</option>
                        <option value="yahoo">Yahoo</option>
                        <option value="bloomberg">Bloomberg</option>
                        <option value="refinitiv">Refinitiv</option>
                      </select>
                      <button
                        onClick={async () => {
                          const nameInput = document.getElementById('customMappingName') as HTMLInputElement;
                          const vendorSelect = document.getElementById('customMappingVendor') as HTMLSelectElement;
                          if (nameInput.value && Object.keys(customMapping).length > 0) {
                            await saveColumnMapping(nameInput.value, vendorSelect.value, customMapping);
                            nameInput.value = '';
                          }
                        }}
                        className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm"
                      >
                        Save Template
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowColumnMapping(false)}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    // Apply the selected mapping and close modal
                    setShowColumnMapping(false);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Apply Mapping
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Conflict Resolution Modal (A-4) */}
      {showConflictResolution && conflictData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b">
              <h2 className="text-xl font-semibold">Corporate Actions Conflicts</h2>
              <p className="text-gray-600 mt-1">
                {conflictData.conflicts.length} conflicts found. Choose how to resolve them:
              </p>
            </div>
            
            <div className="p-6 max-h-[60vh] overflow-y-auto">
              <div className="space-y-4">
                {conflictData.conflicts.map((conflict: any, idx: number) => (
                  <div key={idx} className="p-4 border rounded-lg bg-gray-50">
                    <div className="text-sm font-medium text-gray-700 mb-3">
                      Conflict #{idx + 1}: {conflict.date} - {conflict.existing.type}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      {/* Existing */}
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                        <div className="text-xs font-medium text-blue-800 mb-2">EXISTING</div>
                        <div className="text-sm">
                          <div><strong>Type:</strong> {conflict.existing.type}</div>
                          <div><strong>Description:</strong> {conflict.existing.description}</div>
                          {conflict.existing.amount && (
                            <div><strong>Amount:</strong> ${conflict.existing.amount}</div>
                          )}
                          {conflict.existing.ratio && (
                            <div><strong>Ratio:</strong> {conflict.existing.ratio}:1</div>
                          )}
                        </div>
                      </div>
                      
                      {/* Incoming */}
                      <div className="p-3 bg-orange-50 border border-orange-200 rounded">
                        <div className="text-xs font-medium text-orange-800 mb-2">INCOMING</div>
                        <div className="text-sm">
                          <div><strong>Type:</strong> {conflict.incoming.type}</div>
                          <div><strong>Description:</strong> {conflict.incoming.description}</div>
                          {conflict.incoming.amount && (
                            <div><strong>Amount:</strong> ${conflict.incoming.amount}</div>
                          )}
                          {conflict.incoming.ratio && (
                            <div><strong>Ratio:</strong> {conflict.incoming.ratio}:1</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="p-6 border-t bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  {conflictData.pendingActions.length} new actions will be added regardless of conflict resolution.
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowConflictResolution(false)}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => resolveConflicts('skip')}
                    disabled={isUploadingCorporateActions}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    Keep Existing
                  </button>
                  <button
                    onClick={() => resolveConflicts('overwrite')}
                    disabled={isUploadingCorporateActions}
                    className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50"
                  >
                    {isUploadingCorporateActions ? 'Processing...' : 'Replace with New'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delisting Override Modal (A-5) */}
      {showDelistingOverride && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full">
            <div className="p-6 border-b">
              <h2 className="text-xl font-semibold">Manual Delisting Override</h2>
              <p className="text-gray-600 mt-1">
                Override the delisting status for {params.ticker} to proceed with analysis.
              </p>
            </div>
            
            <div className="p-6">
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">
                  Reason for Override *
                </label>
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Explain why you're overriding the delisting status (e.g., 'Historical analysis for research purposes', 'Data quality validation needed')"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md h-24 resize-none"
                  maxLength={200}
                />
                <div className="text-xs text-gray-500 mt-1">
                  {overrideReason.length}/200 characters
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
                <div className="flex">
                  <svg className="h-5 w-5 text-yellow-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <div className="text-sm text-yellow-800">
                    <p className="font-medium">Warning</p>
                    <p>Overriding delisting status may affect data quality and analysis results. Use only when necessary and document your reasoning.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="p-6 border-t bg-gray-50 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowDelistingOverride(false);
                  setOverrideReason('');
                }}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={applyDelistingOverride}
                disabled={!overrideReason.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Apply Override
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Data Quality Modal */}
      {showDataQualityModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold">Data Quality</h2>
                <button 
                  onClick={() => setShowDataQualityModal(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {uploadResult ? (
                <>
                  {/* Badges */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
                    <Badge
                      label="Contract OK"
                      status={uploadResult.badges.contractOK}
                    />
                    <Badge
                      label="Calendar OK"
                      status={uploadResult.badges.calendarOK}
                    />
                    <Badge
                      label="TZ OK"
                      status={uploadResult.badges.tzOK}
                    />
                    <Badge
                      label="Corporate Actions OK"
                      status={uploadResult.badges.corpActionsOK}
                    />
                    <Badge
                      label="Validations OK"
                      status={uploadResult.badges.validationsOK}
                    />
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium">Repairs:</span>
                      <span className={`px-2 py-1 rounded text-sm ${
                        uploadResult.badges.repairsCount === 0 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {uploadResult.badges.repairsCount}
                      </span>
                    </div>
                  </div>

                  {/* Counts */}
                  <div className="mb-6">
                    <h3 className="text-lg font-medium mb-2">Summary</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">Input rows:</span>
                        <span className="ml-2 font-medium">{uploadResult.counts.input}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Canonical rows:</span>
                        <span className="ml-2 font-medium">{uploadResult.counts.canonical}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Invalid rows:</span>
                        <span className="ml-2 font-medium">{uploadResult.counts.invalid}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Missing days:</span>
                        <span className="ml-2 font-medium">{uploadResult.counts.missingDays}</span>
                      </div>
                    </div>
                  </div>

                  {/* Details */}
                  <details className="mb-4">
                    <summary className="cursor-pointer text-blue-600 hover:text-blue-800 font-medium">
                      View Details
                    </summary>
                    <div className="mt-4 space-y-4 text-sm">
                      <div>
                        <h4 className="font-medium">Metadata</h4>
                        <p>Symbol: {uploadResult.meta.symbol}</p>
                        <p>Exchange: {uploadResult.meta.exchange}</p>
                        <p>Timezone: {uploadResult.meta.exchange_tz}</p>
                        <p>Date Range: {uploadResult.meta.calendar_span.start} to {uploadResult.meta.calendar_span.end}</p>
                      </div>
                      
                      {uploadResult.meta.missing_trading_days.length > 0 && (
                        <div>
                          <h4 className="font-medium">Missing Trading Days</h4>
                          <p className="text-gray-600">
                            {uploadResult.meta.missing_trading_days.slice(0, 10).join(', ')}
                            {uploadResult.meta.missing_trading_days.length > 10 && '...'}
                          </p>
                        </div>
                      )}
                      
                      <div>
                        <h4 className="font-medium">Files Generated</h4>
                        <div className="space-y-1 text-xs text-gray-600">
                          <p>Raw: {uploadResult.paths.raw}</p>
                          <p>Canonical: {uploadResult.paths.canonical}</p>
                          <p>Audit: {uploadResult.paths.audit}</p>
                        </div>
                      </div>

                      {/* Repairs Section */}
                      {uploadResult.badges.repairsCount > 0 && (
                        <div>
                          <h4 className="font-medium">Repairs ({uploadResult.badges.repairsCount})</h4>
                          {isLoadingRepairs ? (
                            <p className="text-gray-500 text-xs">Loading repairs...</p>
                          ) : repairRecords.length > 0 ? (
                            <div className="space-y-1 text-xs">
                              {repairRecords.slice(0, 10).map((repair, idx) => (
                                <div key={idx} className="bg-yellow-50 p-2 rounded border">
                                  <p><strong>{repair.date}</strong> - {repair.field}</p>
                                  <p className="text-gray-600">{repair.oldValue} → {repair.newValue}</p>
                                  <p className="text-xs text-gray-500">{repair.reason}</p>
                                </div>
                              ))}
                              {repairRecords.length > 10 && (
                                <p className="text-gray-500">+ {repairRecords.length - 10} more repairs</p>
                              )}
                              <div className="mt-2">
                                <a 
                                  href={uploadResult.paths.audit} 
                                  className="text-blue-600 hover:text-blue-800 text-xs"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  📄 View full repairs log
                                </a>
                              </div>
                            </div>
                          ) : (
                            <p className="text-gray-500 text-xs">No repair records found</p>
                          )}
                        </div>
                      )}
                    </div>
                  </details>

                  {/* Methods */}
                  <details>
                    <summary className="cursor-pointer text-blue-600 hover:text-blue-800 font-medium">
                      Methods & Formulas
                    </summary>
                    <div className="mt-4 text-sm bg-gray-50 p-4 rounded">
                      <p><strong>Log returns:</strong> r_t = ln(adj_close_t / adj_close_{'{t−1}'})</p>
                      <p><strong>OHLC coherence:</strong> high ≥ max(open, close), low ≤ min(open, close), low ≤ high</p>
                      <p><strong>Calendar check:</strong> no gaps vs exchange calendar (weekday approximation for now)</p>
                      <p><strong>Delistings:</strong> keep history; mark delisted=true if applicable</p>
                    </div>
                  </details>
                </>
              ) : (
                <div className="text-center text-gray-500 py-8">
                  <p>No data quality information available.</p>
                  <p className="text-sm mt-2">Upload data first to see quality metrics.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upload Data Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b bg-white sticky top-0 z-10">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">Upload Data</h2>
                  <p className="text-gray-600 text-sm mt-1">
                    Upload and process historical price data for {params.ticker}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setShowUploadModal(false);
                    // Reset upload state when closing modal
                    setSelectedFile(null);
                    setParsedRows([]);
                    setError(null);
                    setUploadWarning(null);
                    setValidationSummary(null);
                  }}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div className="p-6">
              {/* Provenance Ribbon (M-5) - Audit trail information */}
              {provenanceData && (
                <div className="mb-6 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded text-xs text-indigo-700 font-mono">
                  <div className="font-medium mb-1">Current Data Source</div>
                  Vendor: {provenanceData.vendor} • Mapping: {provenanceData.mappingId} • File: {provenanceData.fileHash.substring(0, 7)} • Rows: {provenanceData.rows.toLocaleString()} • Range: {provenanceData.dateRange.first}→{provenanceData.dateRange.last} • Imported: {new Date(provenanceData.processedAt).toLocaleString()}
                </div>
              )}
              
              {/* Company Information Form */}
              <form onSubmit={saveCompanyInfo} className="mb-6 p-4 bg-gray-50 rounded-lg">
                <h3 className="text-lg font-medium mb-3">Company Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="modal-companyTicker" className="block text-sm font-medium mb-2">
                      Ticker *
                    </label>
                    <input
                      type="text"
                      id="modal-companyTicker"
                      name="companyTicker"
                      value={companyTicker}
                      onChange={(e) => setCompanyTicker(e.target.value.toUpperCase())}
                      required
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md uppercase"
                      placeholder="e.g., AAPL"
                    />
                  </div>
                  <div>
                    <label htmlFor="modal-companyName" className="block text-sm font-medium mb-2">
                      Company Name *
                    </label>
                    <input
                      type="text"
                      id="modal-companyName"
                      name="companyName"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      required
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="e.g., Apple Inc."
                    />
                  </div>
                  <div>
                    <label htmlFor="modal-companyExchange" className="block text-sm font-medium mb-2">
                      Exchange *
                    </label>
                    <select
                      id="modal-companyExchange"
                      name="companyExchange"
                      value={companyExchange ?? ''}
                      onChange={(e) => setCompanyExchange(e.target.value)}
                      required
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md"
                    >
                      <option value="">Select Exchange</option>
                      {Object.entries(exchangesByRegion).map(([region, exchanges]) => (
                        <optgroup key={region} label={region}>
                          {exchanges.map((exchange) => {
                            const exchangeInfo = getExchangeInfo(exchange);
                            return (
                              <option key={exchange} value={exchange}>
                                {exchange} ({exchangeInfo?.country} - {exchangeInfo?.currency})
                              </option>
                            );
                          })}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-4">
                  <button
                    type="submit"
                    disabled={isSavingCompany || !companyTicker || !companyName || !companyExchange}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSavingCompany ? 'Saving...' : 'Save Company'}
                  </button>
                  {companySaveSuccess && (
                    <span className="text-green-600 text-sm font-medium">✓ Company saved successfully!</span>
                  )}
                </div>
              </form>

              {/* M-4: Exchange Validation Warning Banner */}
              {exchangeWarning?.show && (
                <div className="mb-6 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                  <div className="flex items-start">
                    <div className="flex-shrink-0">
                      <svg className="h-5 w-5 text-orange-400 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3 flex-1">
                      <h3 className="text-sm font-medium text-orange-800">
                        Exchange Validation Warning
                      </h3>
                      <div className="mt-2 text-sm text-orange-700">
                        <p>{exchangeWarning.message}</p>
                        {exchangeWarning.details && (
                          <p className="mt-1 text-orange-600">{exchangeWarning.details}</p>
                        )}
                      </div>
                      <div className="mt-4 flex gap-3">
                        <button
                          onClick={() => setExchangeWarning(null)}
                          className="text-sm bg-orange-100 text-orange-800 px-3 py-1 rounded hover:bg-orange-200"
                        >
                          Proceed anyway
                        </button>
                        <button
                          onClick={() => {
                            setExchangeWarning(null);
                            // Focus on exchange dropdown for user to fix
                            document.getElementById('modal-companyExchange')?.focus();
                          }}
                          className="text-sm bg-orange-600 text-white px-3 py-1 rounded hover:bg-orange-700"
                        >
                          Fix exchange
                        </button>
                      </div>
                    </div>
                    <div className="ml-auto pl-3">
                      <button
                        onClick={() => setExchangeWarning(null)}
                        className="text-orange-400 hover:text-orange-600"
                      >
                        <span className="sr-only">Dismiss</span>
                        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Delisting Awareness Indicator (A-5) */}
              {delistingInfo && delistingInfo.status !== 'active' && (
                <div className={`mb-6 p-4 border rounded-lg ${
                  delistingInfo.status === 'delisted' 
                    ? 'bg-red-50 border-red-200' 
                    : delistingInfo.status === 'suspended'
                      ? 'bg-yellow-50 border-yellow-200'
                      : 'bg-orange-50 border-orange-200'
                }`}>
                  <div className="flex items-start">
                    <div className="flex-shrink-0">
                      <svg className={`h-5 w-5 mt-0.5 ${
                        delistingInfo.status === 'delisted' 
                          ? 'text-red-400' 
                          : delistingInfo.status === 'suspended'
                            ? 'text-yellow-400'
                            : 'text-orange-400'
                      }`} fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div className="ml-3 flex-1">
                      <h3 className={`text-sm font-medium ${
                        delistingInfo.status === 'delisted' 
                          ? 'text-red-800' 
                          : delistingInfo.status === 'suspended'
                            ? 'text-yellow-800'
                            : 'text-orange-800'
                      }`}>
                        {delistingInfo.status === 'delisted' 
                          ? 'Delisted Security' 
                          : delistingInfo.status === 'suspended'
                            ? 'Trading Suspended'
                            : 'Pending Delisting'}
                      </h3>
                      <div className={`mt-2 text-sm ${
                        delistingInfo.status === 'delisted' 
                          ? 'text-red-700' 
                          : delistingInfo.status === 'suspended'
                            ? 'text-yellow-700'
                            : 'text-orange-700'
                      }`}>
                        {delistingInfo.reason && <p className="mb-2">{delistingInfo.reason}</p>}
                        {delistingInfo.delistingDate && (
                          <p className="mb-2"><strong>Delisted:</strong> {delistingInfo.delistingDate}</p>
                        )}
                        {delistingInfo.lastTradingDate && (
                          <p className="mb-2"><strong>Last Trading Date:</strong> {delistingInfo.lastTradingDate}</p>
                        )}
                        
                        {/* Warnings */}
                        {delistingInfo.warnings.length > 0 && (
                          <div className="mt-3">
                            <p className="font-medium mb-1">Important Notes:</p>
                            <ul className="list-disc list-inside space-y-1">
                              {delistingInfo.warnings.map((warning, idx) => (
                                <li key={idx} className="text-xs">{warning}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Manual Override Info */}
                        {delistingInfo.manualOverride && (
                          <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded">
                            <p className="text-xs font-medium text-blue-800">Manual Override Active</p>
                            <p className="text-xs text-blue-700">
                              <strong>Date:</strong> {delistingInfo.manualOverride.overrideDate} | 
                              <strong> Reason:</strong> {delistingInfo.manualOverride.overrideReason}
                            </p>
                          </div>
                        )}
                      </div>
                      
                      {/* Action Buttons */}
                      {!delistingInfo.manualOverride && (
                        <div className="mt-4 flex gap-3">
                          <button
                            onClick={() => setShowDelistingOverride(true)}
                            className="text-sm bg-blue-600 text-white px-3 py-1 rounded-full hover:bg-blue-700"
                          >
                            Apply Manual Override
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* File Upload Form */}
              <form onSubmit={handleFileUpload} className="space-y-4">
                <h3 className="text-lg font-medium">Upload Data File (Excel or CSV)</h3>
                
                {/* Data Type Selection */}
                <div>
                  <label className="block text-sm font-medium mb-3">Data Type</label>
                  <div className="flex gap-2 items-center">
                    <select
                      value={selectedDataType}
                      onChange={(e) => setSelectedDataType(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-white text-sm"
                    >
                      {dataTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setShowAddDataType(true)}
                      className="px-3 py-2 bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 text-sm"
                      title="Add new data type"
                    >
                      (+)
                    </button>
                  </div>
                  
                  {/* Add New Data Type Input */}
                  {showAddDataType && (
                    <div className="mt-3 flex gap-2">
                      <input
                        type="text"
                        value={newDataTypeName}
                        onChange={(e) => setNewDataTypeName(e.target.value)}
                        onKeyDown={handleDataTypeKeyPress}
                        placeholder="Enter new data type name"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={addNewDataType}
                        disabled={!newDataTypeName.trim()}
                        className="px-3 py-2 bg-green-600 text-white rounded-full hover:bg-green-700 disabled:opacity-50 text-sm"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAddDataType(false);
                          setNewDataTypeName('');
                        }}
                        className="px-3 py-2 bg-gray-300 text-gray-700 rounded-full hover:bg-gray-400 text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                
                {/* Upload Mode Selection */}
                <div>
                  <label className="block text-sm font-medium mb-3">Processing Mode</label>
                  <div className="flex gap-4">
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="uploadMode"
                        value="replace"
                        checked={uploadMode === 'replace'}
                        onChange={(e) => setUploadMode(e.target.value as 'replace')}
                        className="mr-2"
                      />
                      <span className="text-sm">
                        <strong>Replace</strong> - Overwrite existing data completely
                      </span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="radio"
                        name="uploadMode"
                        value="incremental"
                        checked={uploadMode === 'incremental'}
                        onChange={(e) => setUploadMode(e.target.value as 'incremental')}
                        className="mr-2"
                      />
                      <span className="text-sm">
                        <strong>Incremental</strong> - Append new dates, skip overlaps
                      </span>
                    </label>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-3">
                    <input
                      type="file"
                      id="modal-file"
                      name="file"
                      accept=".xlsx,.csv"
                      required
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setSelectedFile(file);
                      }}
                    />
                    <label 
                      htmlFor="modal-file"
                      className="inline-flex items-center px-4 py-2 bg-blue-50 text-blue-700 text-sm font-semibold rounded-full border-0 hover:bg-blue-100 cursor-pointer"
                    >
                      {selectedFile ? 'Change File' : 'Choose File'}
                    </label>
                    {selectedFile && (
                      <span className="text-sm text-gray-600">
                        {selectedFile.name}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <button
                    type="submit"
                    disabled={isUploading || isReprocessing}
                    className="px-6 py-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isUploading ? 'Processing...' : 'Upload & Process'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDataContract(true)}
                    className="ml-3 px-4 py-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-full transition-colors"
                  >
                    View Data Contract
                  </button>
                </div>
              </form>
              
              {/* File Parse Success Indicator */}
              {Array.isArray(parsedRows) && parsedRows.length > 0 && (
                <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md">
                  <h4 className="font-medium text-green-800 mb-2">File Parsed Successfully!</h4>
                  <div className="text-sm text-green-700">
                    Found <strong>{parsedRows.length} valid rows</strong> with Date and Adj Close columns.
                    {parsedRows.length >= 252 ? (
                      <span className="text-green-600"> ✓ Meets minimum requirement (252+ rows)</span>
                    ) : (
                      <span className="text-orange-600"> ⚠ Below minimum requirement ({252 - parsedRows.length} more rows needed)</span>
                    )}
                  </div>
                  <div className="mt-2 text-xs text-green-600">
                    Date range: {parsedRows?.[0]?.date || 'N/A'} → {parsedRows?.[parsedRows.length - 1]?.date || 'N/A'}
                  </div>
                </div>
              )}
              
              {error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-red-600">{error}</p>
                </div>
              )}

              {/* Upload Warning Banner */}
              {uploadWarning && (
                <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
                  <p className="text-yellow-800">{uploadWarning}</p>
                </div>
              )}

              {/* Validation Summary Panel */}
              {validationSummary && (
                <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-md">
                  <h4 className="text-md font-medium mb-3 text-gray-900">Upload Summary</h4>
                  
                  {/* File Info */}
                  <div className="mb-4 text-sm">
                    <div className="flex items-center gap-4 mb-2">
                      <span className="font-medium">File:</span>
                      <span className="text-gray-700">{validationSummary.file.name}</span>
                      <span className="text-gray-500">({validationSummary.file.rows.toLocaleString()} rows)</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-medium">Date Range:</span>
                      <span className="text-gray-700">{validationSummary.dateRange.first} to {validationSummary.dateRange.last}</span>
                    </div>
                  </div>

                  {/* Validation Badges - simplified for modal view */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                    <div className={`p-2 rounded text-center ${
                      validationSummary.validation.ohlcCoherence.failCount === 0 
                        ? 'bg-green-100 border border-green-300' 
                        : 'bg-red-100 border border-red-300'
                    }`}>
                      <div className={`text-xs font-medium ${
                        validationSummary.validation.ohlcCoherence.failCount === 0 
                          ? 'text-green-800' 
                          : 'text-red-800'
                      }`}>
                        OHLC Coherence
                      </div>
                      <div className={`text-sm ${
                        validationSummary.validation.ohlcCoherence.failCount === 0 
                          ? 'text-green-700' 
                          : 'text-red-700'
                      }`}>
                        {validationSummary.validation.ohlcCoherence.failCount === 0 ? 'Pass' : `${validationSummary.validation.ohlcCoherence.failCount} fails`}
                      </div>
                    </div>

                    <div className={`p-2 rounded text-center ${
                      validationSummary.validation.missingDays.blocked
                        ? 'bg-red-100 border border-red-300' 
                        : validationSummary.validation.missingDays.totalMissing > 0
                          ? 'bg-amber-100 border border-amber-300'
                          : 'bg-green-100 border border-green-300'
                    }`}>
                      <div className={`text-xs font-medium ${
                        validationSummary.validation.missingDays.blocked
                          ? 'text-red-800' 
                          : validationSummary.validation.missingDays.totalMissing > 0
                            ? 'text-amber-800'
                            : 'text-green-800'
                      }`}>
                        Missing Days
                      </div>
                      <div className={`text-sm ${
                        validationSummary.validation.missingDays.blocked
                          ? 'text-red-700' 
                          : validationSummary.validation.missingDays.totalMissing > 0
                            ? 'text-amber-700'
                            : 'text-green-700'
                      }`}>
                        {validationSummary.validation.missingDays.totalMissing} missing
                      </div>
                    </div>

                    <div className={`p-2 rounded text-center ${
                      validationSummary.validation.duplicates.count === 0 
                        ? 'bg-green-100 border border-green-300' 
                        : 'bg-amber-100 border border-amber-300'
                    }`}>
                      <div className={`text-xs font-medium ${
                        validationSummary.validation.duplicates.count === 0 
                          ? 'text-green-800' 
                          : 'text-amber-800'
                      }`}>
                        Duplicates
                      </div>
                      <div className={`text-sm ${
                        validationSummary.validation.duplicates.count === 0 
                          ? 'text-green-700' 
                          : 'text-amber-700'
                      }`}>
                        {validationSummary.validation.duplicates.count} found
                      </div>
                    </div>
                  </div>

                  {/* Provenance */}
                  <div className="text-xs text-gray-600 border-t pt-2">
                    <span className="font-medium">Mode:</span> {validationSummary.mode || 'unknown'} • 
                    <span className="font-medium ml-2">Vendor:</span> {validationSummary.provenance.vendor} • 
                    <span className="font-medium ml-2">Processed:</span> {new Date(validationSummary.provenance.processedAt).toLocaleString()}
                  </div>

                  {/* Action buttons */}
                  <div className="mt-3 flex justify-end gap-3">
                    <button
                      onClick={exportCanonicalCSV}
                      disabled={isExporting}
                      className="px-4 py-2 bg-green-600 text-white text-sm rounded-full hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                      {isExporting ? 'Exporting...' : 'Export CSV'}
                    </button>
                    <button
                      onClick={() => {
                        setShowRepairsPanel(true);
                        setShowUploadModal(false); // Close modal when opening repairs panel
                      }}
                      className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-full hover:bg-indigo-700 transition-colors"
                    >
                      View Audit Trail
                    </button>
                  </div>

                  {/* Blocked Warning */}
                  {validationSummary.validation.missingDays.blocked && (
                    <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md">
                      <div className="flex items-center">
                        <svg className="w-5 h-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span className="text-sm font-medium text-red-800">
                          Too many missing days ({validationSummary.validation.missingDays.totalMissing}) - downstream analysis blocked
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* Export Error Display (A-6) */}
              {exportError && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
                  <div className="flex items-center">
                    <svg className="w-5 h-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <span className="text-sm font-medium text-red-800">Export Failed</span>
                      <p className="text-sm text-red-700">{exportError}</p>
                    </div>
                    <button
                      onClick={() => setExportError(null)}
                      className="ml-auto text-red-400 hover:text-red-600"
                    >
                      <span className="sr-only">Dismiss</span>
                      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Model Comparison Modal */}
      {isModelInfoOpen && modelScores && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className={`rounded-xl shadow-xl p-6 max-w-6xl w-full mx-4 max-h-[90vh] overflow-auto ${
            isDarkMode ? 'bg-gray-800' : 'bg-white'
          }`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-semibold ${
                isDarkMode ? 'text-gray-200' : 'text-gray-900'
              }`}>
                Model comparison for {params.ticker} – {targetSpecResult?.spec?.h || 5}D / {((targetSpecResult?.spec?.coverage || 0.95) * 100).toFixed(0)}%
              </h3>
              <button 
                onClick={() => setIsModelInfoOpen(false)}
                className={`p-2 rounded-full transition-colors ${
                  isDarkMode
                    ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200'
                    : 'hover:bg-gray-100 text-gray-600 hover:text-gray-900'
                }`}
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className={`min-w-full text-xs ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
                <thead className={`border-b ${isDarkMode ? 'border-gray-600 text-gray-400' : 'border-gray-200 text-gray-600'}`}>
                  <tr>
                    <th className="py-3 px-3 text-left">Model</th>
                    <th className="py-3 px-3 text-right">Score</th>
                    <th className="py-3 px-3 text-right">Interval Score</th>
                    <th className="py-3 px-3 text-right">Coverage</th>
                    <th className="py-3 px-3 text-right">Width (bp)</th>
                    <th className="py-3 px-3 text-right">POF p</th>
                    <th className="py-3 px-3 text-right">CC p</th>
                    <th className="py-3 px-3 text-center">Zone</th>
                  </tr>
                </thead>
                <tbody>
                  {modelScores
                    .slice()
                    .sort((a, b) => a.score - b.score)
                    .map(ms => {
                      const { model, score, metrics, noData } = ms;
                      const hasData = !noData &&
                        Number.isFinite(metrics.intervalScore) &&
                        Number.isFinite(metrics.empiricalCoverage) &&
                        Number.isFinite(metrics.avgWidthBp);
                      
                      const isBest = recommendedModel && model === recommendedModel;
                      const zoneClass =
                        metrics.trafficLight === "green"
                          ? "text-green-600"
                          : metrics.trafficLight === "yellow"
                          ? "text-amber-500"
                          : "text-red-600";

                      return (
                        <tr 
                          key={model} 
                          className={`border-b ${
                            isDarkMode ? 'border-gray-700' : 'border-gray-100'
                          } ${
                            isBest 
                              ? isDarkMode 
                                ? "bg-green-950/30" 
                                : "bg-green-50/60" 
                              : ""
                          }`}
                        >
                          <td className="py-2 px-3 font-medium">
                            {isBest && <span className="text-green-600 mr-1">★</span>}
                            {model}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {hasData ? score.toFixed(2) : "–"}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {hasData ? metrics.intervalScore.toFixed(3) : "No backtest"}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {hasData ? `${(metrics.empiricalCoverage * 100).toFixed(1)}%` : "–"}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {hasData ? metrics.avgWidthBp.toFixed(0) : "–"}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {hasData && Number.isFinite(metrics.kupiecPValue)
                              ? metrics.kupiecPValue.toFixed(2)
                              : "–"}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {hasData && Number.isFinite(metrics.ccPValue)
                              ? metrics.ccPValue.toFixed(2)
                              : "–"}
                          </td>
                          <td className="py-2 px-3 text-center font-medium">
                            {hasData ? (
                              <span className={zoneClass}>{metrics.trafficLight}</span>
                            ) : (
                              <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>no data</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            <div className={`mt-4 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              <p>• Lower scores are better. ★ indicates the recommended model.</p>
              <p>• Models with &quot;No backtest&quot; are shown for completeness but are not considered for the Best recommendation.</p>
              <p>• Interval Score: Proper scoring rule for prediction intervals (lower better)</p>
              <p>• Coverage: Empirical coverage vs nominal {((targetSpecResult?.spec?.coverage || 0.95) * 100).toFixed(0)}%</p>
              <p>• POF/CC p: Kupiec proportion of failures and Christoffersen conditional coverage test p-values</p>
              <p>• Zone: VaR traffic light (green = good, yellow = acceptable, red = concerning)</p>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
