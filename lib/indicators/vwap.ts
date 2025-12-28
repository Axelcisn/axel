export interface VwapInputBar {
  time?: string | number | Date;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  volume?: number | null;
}

export type SessionVwapSeries = Array<number | null>;

const toNumber = (v: unknown): number | null => {
  if (typeof v === "number") {
    return Number.isFinite(v) ? v : null;
  }
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const computeHlc3 = (bar: VwapInputBar): number | null => {
  const h = toNumber(bar.high);
  const l = toNumber(bar.low);
  const c = toNumber(bar.close);
  if (h == null || l == null || c == null) return null;
  return (h + l + c) / 3;
};

/**
 * Compute a per-bar VWAP using HLC3 as the price input and resetting on session boundaries.
 * The sessionKeyFn defines when to reset (e.g., YYYY-MM-DD in exchange timezone).
 */
export function computeSessionVwap<T extends VwapInputBar>(
  bars: T[],
  sessionKeyFn: (bar: T, index: number) => string | number | null | undefined
): SessionVwapSeries {
  const series: SessionVwapSeries = [];
  if (!Array.isArray(bars) || bars.length === 0) return series;

  let prevSession: string | number | null | undefined;
  let cumPV = 0;
  let cumV = 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const sessionKey = sessionKeyFn(bar, i);

    if (i === 0 || sessionKey !== prevSession) {
      cumPV = 0;
      cumV = 0;
      prevSession = sessionKey;
    }

    const tp = computeHlc3(bar);
    const vol = toNumber(bar.volume);

    if (tp == null || vol == null || !Number.isFinite(tp) || !Number.isFinite(vol) || vol < 0) {
      series.push(cumV > 0 ? cumPV / cumV : null);
      continue;
    }

    if (vol > 0) {
      cumPV += tp * vol;
      cumV += vol;
    }

    const vwap = cumV > 0 ? cumPV / cumV : null;
    series.push(vwap);
  }

  return series;
}
