import { loadCanonicalData } from '../lib/storage/canonical';

function trueRange(high: number, low: number, prevClose: number): number {
  const tr1 = high - low;
  const tr2 = Math.abs(high - prevClose);
  const tr3 = Math.abs(low - prevClose);
  return Math.max(tr1, tr2, tr3);
}

function wilderSmooth(values: number[], period: number): number[] {
  const smoothed: number[] = [];
  if (values.length === 0) return smoothed;

  // First smoothed value: simple average of first N values
  const first = Math.min(period, values.length);
  const firstSum = values.slice(0, first).reduce((a, b) => a + b, 0);
  smoothed[first - 1] = firstSum / first;

  // Wilder smoothing for the rest
  for (let i = first; i < values.length; i++) {
    const prev = smoothed[i - 1];
    smoothed[i] = prev - prev / period + values[i];
  }

  return smoothed;
}

function computeAdxLib(
  rows: { date: string; high: number; low: number; close: number }[],
  period: number = 14
) {
  if (!rows || rows.length === 0) {
    return { points: [], latest: null, period, trendStrength: null };
  }
  if (period < 1) period = 1;
  if (rows.length < 2) {
    return { points: [], latest: null, period, trendStrength: null };
  }

  const n = rows.length;
  const trRaw: number[] = [];
  const plusDMRaw: number[] = [];
  const minusDMRaw: number[] = [];
  const dates: string[] = [];

  for (let i = 1; i < n; i++) {
    const curr = rows[i];
    const prev = rows[i - 1];
    const tr = trueRange(curr.high, curr.low, prev.close);
    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;
    const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;
    trRaw.push(tr);
    plusDMRaw.push(plusDM);
    minusDMRaw.push(minusDM);
    dates.push(curr.date);
  }

  const smoothedTR = wilderSmooth(trRaw, period);
  const smoothedPlusDM = wilderSmooth(plusDMRaw, period);
  const smoothedMinusDM = wilderSmooth(minusDMRaw, period);

  const plusDI: number[] = [];
  const minusDI: number[] = [];
  const dx: number[] = [];

  for (let i = 0; i < smoothedTR.length; i++) {
    const sTR = smoothedTR[i];
    const sPlusDM = smoothedPlusDM[i];
    const sMinusDM = smoothedMinusDM[i];

    if (!isFinite(sTR) || sTR === 0 || !isFinite(sPlusDM) || !isFinite(sMinusDM)) {
      plusDI.push(NaN);
      minusDI.push(NaN);
      dx.push(NaN);
      continue;
    }

    const pDI = 100 * sPlusDM / sTR;
    const mDI = 100 * sMinusDM / sTR;
    plusDI.push(pDI);
    minusDI.push(mDI);
    const diSum = pDI + mDI;
    dx.push(diSum !== 0 ? 100 * Math.abs(pDI - mDI) / diSum : 0);
  }

  let firstValidDxIndex = 0;
  for (let i = 0; i < dx.length; i++) {
    if (isFinite(dx[i])) {
      firstValidDxIndex = i;
      break;
    }
  }
  const validDx = dx.slice(firstValidDxIndex);
  const adxSmoothed = new Array(dx.length).fill(NaN);
  if (validDx.length >= period) {
    const firstAdx =
      validDx.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
    const firstAdxIndex = firstValidDxIndex + period - 1;
    adxSmoothed[firstAdxIndex] = firstAdx;

    for (let i = firstAdxIndex + 1; i < dx.length; i++) {
      const prev = adxSmoothed[i - 1];
      const currDx = dx[i];
      if (!isFinite(prev) || !isFinite(currDx)) {
        adxSmoothed[i] = NaN;
        continue;
      }
      adxSmoothed[i] = prev - prev / period + currDx / period;
    }
  }

  const points: { date: string; plusDI: number; minusDI: number; adx: number }[] = [];

  for (let i = 0; i < adxSmoothed.length; i++) {
    const adxVal = adxSmoothed[i];
    const pDI = plusDI[i];
    const mDI = minusDI[i];
    if (!isFinite(adxVal) || !isFinite(pDI) || !isFinite(mDI)) continue;
    points.push({
      date: dates[i],
      plusDI: pDI,
      minusDI: mDI,
      adx: adxVal,
    });
  }

  const latest = points.length > 0 ? points[points.length - 1] : null;

  return {
    points,
    latest,
    period,
    trendStrength: null,
  };
}

type Ohlc = { date: string; high: number; low: number; close: number };

type ReferenceOutput = {
  points: { date: string; plusDI: number; minusDI: number; adx: number }[];
  adxArray: number[];
  plusDI: number[];
  minusDI: number[];
  dx: number[];
  trRaw: number[];
  plusDMRaw: number[];
  minusDMRaw: number[];
  smTR: number[];
  smPlusDM: number[];
  smMinusDM: number[];
  dates: string[];
};

function computeAdxReference(rows: Ohlc[], period = 14): ReferenceOutput {
  const n = rows.length;
  if (n < 2) {
    return {
      points: [],
      adxArray: [],
      plusDI: [],
      minusDI: [],
      dx: [],
      trRaw: [],
      plusDMRaw: [],
      minusDMRaw: [],
      smTR: [],
      smPlusDM: [],
      smMinusDM: [],
      dates: [],
    };
  }

  // Step 1: raw TR, +DM, -DM (length n-1)
  const trRaw: number[] = [];
  const plusDMRaw: number[] = [];
  const minusDMRaw: number[] = [];
  const dates: string[] = [];

  for (let i = 1; i < n; i++) {
    const curr = rows[i];
    const prev = rows[i - 1];
    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;
    trRaw.push(tr);
    plusDMRaw.push(plusDM);
    minusDMRaw.push(minusDM);
    dates.push(curr.date);
  }

  const smooth = (arr: number[]) => {
    const out: number[] = new Array(arr.length).fill(NaN);
    if (arr.length === 0) return out;
    const first = Math.min(period, arr.length);
    const firstSum = arr.slice(0, first).reduce((a, b) => a + b, 0);
    out[first - 1] = firstSum / first;
    for (let i = first; i < arr.length; i++) {
      out[i] = out[i - 1] - out[i - 1] / period + arr[i];
    }
    return out;
  };

  const smTR = smooth(trRaw);
  const smPlusDM = smooth(plusDMRaw);
  const smMinusDM = smooth(minusDMRaw);

  const plusDI: number[] = [];
  const minusDI: number[] = [];
  const dx: number[] = [];

  for (let i = 0; i < smTR.length; i++) {
    const sTR = smTR[i];
    const sPlus = smPlusDM[i];
    const sMinus = smMinusDM[i];
    if (!isFinite(sTR) || sTR === 0 || !isFinite(sPlus) || !isFinite(sMinus)) {
      plusDI.push(NaN);
      minusDI.push(NaN);
      dx.push(NaN);
      continue;
    }
    const p = 100 * sPlus / sTR;
    const m = 100 * sMinus / sTR;
    plusDI.push(p);
    minusDI.push(m);
    const sum = p + m;
    dx.push(sum !== 0 ? 100 * Math.abs(p - m) / sum : 0);
  }

  // ADX smoothing
  const adx: number[] = new Array(dx.length).fill(NaN);
  // first valid dx index
  let firstValid = dx.findIndex((v) => isFinite(v));
  if (firstValid === -1) firstValid = 0;
  const dxValid = dx.slice(firstValid).filter((v) => isFinite(v));
  if (dxValid.length >= period) {
    const firstAdx = dxValid.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const firstAdxIndex = firstValid + period - 1;
    adx[firstAdxIndex] = firstAdx;
    for (let i = firstAdxIndex + 1; i < dx.length; i++) {
      if (!isFinite(dx[i])) continue;
      const prev = adx[i - 1];
      adx[i] = prev - prev / period + dx[i] / period;
    }
  }

  const points = adx.map((a, idx) => {
    if (!isFinite(a) || !isFinite(plusDI[idx]) || !isFinite(minusDI[idx])) return null;
    return {
      date: dates[idx],
      plusDI: plusDI[idx],
      minusDI: minusDI[idx],
      adx: a,
    };
  }).filter(Boolean) as { date: string; plusDI: number; minusDI: number; adx: number }[];

  return { points, adxArray: adx, plusDI, minusDI, dx, trRaw, plusDMRaw, minusDMRaw, smTR, smPlusDM, smMinusDM, dates };
}

async function main() {
  const rows = await loadCanonicalData('TSLA');
  const ohlc: Ohlc[] = rows.map((r: any) => ({
    date: r.date,
    high: r.high,
    low: r.low,
    close: r.close,
  }));

  const ours = computeAdxLib(ohlc, 14);
  const ref = computeAdxReference(ohlc, 14);

  console.log('=== Last 40 bars (ours) ===');
  ours.points.slice(-40).forEach((p) => {
    console.log(`${p.date}  +DI=${p.plusDI.toFixed(2)}  -DI=${p.minusDI.toFixed(2)}  ADX=${p.adx.toFixed(2)}`);
  });

  console.log('\n=== Reference vs ours (last 40 bars) ===');
  const refMap = new Map(ref.points.map((p) => [p.date, p]));
  let maxDiff = 0;
  ours.points.slice(-40).forEach((p) => {
    const r = refMap.get(p.date);
    const refAdx = r?.adx;
    const diff = refAdx != null ? p.adx - refAdx : NaN;
    if (refAdx != null) {
      maxDiff = Math.max(maxDiff, Math.abs(diff));
      console.log(`${p.date}  ours=${p.adx.toFixed(2)}  ref=${refAdx.toFixed(2)}  diff=${diff >= 0 ? '+' : ''}${diff.toFixed(2)}`);
    }
  });
  console.log(`\nMax absolute ADX diff (last 40 bars): ${maxDiff.toFixed(4)}`);

  console.log('\n=== Intermediate arrays (first 30 raw slots) ===');
  const limit = 30;
  for (let i = 0; i < Math.min(limit, ref.trRaw.length); i++) {
    console.log(
      `${ref.dates[i]} | TR=${ref.trRaw[i]?.toFixed(4) ?? 'NaN'} | +DM=${ref.plusDMRaw[i]?.toFixed(4) ?? 'NaN'} | -DM=${ref.minusDMRaw[i]?.toFixed(4) ?? 'NaN'} | smTR=${ref.smTR[i]?.toFixed(4) ?? 'NaN'} | sm+DM=${ref.smPlusDM[i]?.toFixed(4) ?? 'NaN'} | sm-DM=${ref.smMinusDM[i]?.toFixed(4) ?? 'NaN'} | +DI=${ref.plusDI[i]?.toFixed(2) ?? 'NaN'} | -DI=${ref.minusDI[i]?.toFixed(2) ?? 'NaN'} | DX=${ref.dx[i]?.toFixed(2) ?? 'NaN'} | ADX=${ref.adxArray[i]?.toFixed(2) ?? 'NaN'}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
