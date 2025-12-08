export type DivergenceType = 'bullish' | 'bearish';

export interface DivergenceSignal {
  type: DivergenceType;
  priceSwingDate: string;
  oscSwingDate: string;
  barsAgo: number;
}

export interface SeriesPoint {
  date: string;
  value: number;
}

export function findSwingHighs(series: SeriesPoint[], k: number = 3): number[] {
  const indices: number[] = [];
  for (let i = k; i < series.length - k; i++) {
    const v = series[i].value;
    let isHigh = true;
    for (let j = i - k; j <= i + k; j++) {
      if (series[j].value > v) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) indices.push(i);
  }
  return indices;
}

export function findSwingLows(series: SeriesPoint[], k: number = 3): number[] {
  const indices: number[] = [];
  for (let i = k; i < series.length - k; i++) {
    const v = series[i].value;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (series[j].value < v) {
        isLow = false;
        break;
      }
    }
    if (isLow) indices.push(i);
  }
  return indices;
}

export function findLatestDivergence(
  price: SeriesPoint[],
  osc: SeriesPoint[],
  lookback: number = 120,
  swingWindow: number = 3
): DivergenceSignal | null {
  if (!price.length || !osc.length) return null;

  const n = Math.min(price.length, osc.length);
  const start = Math.max(0, n - lookback);

  const priceSlice = price.slice(start, n);
  const oscSlice = osc.slice(start, n);

  const highsP = findSwingHighs(priceSlice, swingWindow);
  const lowsP = findSwingLows(priceSlice, swingWindow);
  const highsO = findSwingHighs(oscSlice, swingWindow);
  const lowsO = findSwingLows(oscSlice, swingWindow);

  if ((highsP.length < 2 && lowsP.length < 2) || (highsO.length < 2 && lowsO.length < 2)) {
    return null;
  }

  let divergence: DivergenceSignal | null = null;

  // Bearish divergence: price higher highs, oscillator lower highs
  if (highsP.length >= 2 && highsO.length >= 2) {
    const i2p = highsP[highsP.length - 1];
    const i1p = highsP[highsP.length - 2];
    const i2o = highsO[highsO.length - 1];
    const i1o = highsO[highsO.length - 2];

    const p1 = priceSlice[i1p].value;
    const p2 = priceSlice[i2p].value;
    const o1 = oscSlice[i1o].value;
    const o2 = oscSlice[i2o].value;

    if (p2 > p1 && o2 < o1) {
      const globalIndex = start + i2p;
      divergence = {
        type: 'bearish',
        priceSwingDate: priceSlice[i2p].date,
        oscSwingDate: oscSlice[i2o].date,
        barsAgo: n - 1 - globalIndex,
      };
    }
  }

  // Bullish divergence: price lower lows, oscillator higher lows
  if (!divergence && lowsP.length >= 2 && lowsO.length >= 2) {
    const i2p = lowsP[lowsP.length - 1];
    const i1p = lowsP[lowsP.length - 2];
    const i2o = lowsO[lowsO.length - 1];
    const i1o = lowsO[lowsO.length - 2];

    const p1 = priceSlice[i1p].value;
    const p2 = priceSlice[i2p].value;
    const o1 = oscSlice[i1o].value;
    const o2 = oscSlice[i2o].value;

    if (p2 < p1 && o2 > o1) {
      const globalIndex = start + i2p;
      divergence = {
        type: 'bullish',
        priceSwingDate: priceSlice[i2p].date,
        oscSwingDate: oscSlice[i2o].date,
        barsAgo: n - 1 - globalIndex,
      };
    }
  }

  return divergence;
}
