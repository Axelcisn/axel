import { loadCanonicalData } from '@/lib/storage/canonical';
import { computeAdx, type AdxPoint } from '@/lib/indicators/adx';

interface SyntheticResult {
  name: string;
  points: AdxPoint[];
  minAdx: number;
  maxAdx: number;
  last: AdxPoint | null;
  plusAvg: number;
  minusAvg: number;
  pass: boolean;
  notes: string[];
}

function buildSyntheticSeries(opts: { name: string; length: number; start: number; step: number; flat?: boolean }) {
  const rows = [] as { date: string; high: number; low: number; close: number }[];
  let price = opts.start;
  for (let i = 0; i < opts.length; i++) {
    if (!opts.flat) {
      price = opts.start + i * opts.step;
    }
    const close = opts.flat ? opts.start : price;
    rows.push({
      date: `synthetic-${opts.name}-${i}`,
      high: close + 1,
      low: close - 1,
      close,
    });
  }
  return rows;
}

function analyzeSynthetic(name: string, points: AdxPoint[]): SyntheticResult {
  let minAdx = Infinity;
  let maxAdx = -Infinity;
  let sumPlus = 0;
  let sumMinus = 0;
  let count = 0;
  for (const p of points) {
    if (!Number.isFinite(p.adx)) continue;
    minAdx = Math.min(minAdx, p.adx);
    maxAdx = Math.max(maxAdx, p.adx);
    sumPlus += p.plusDI;
    sumMinus += p.minusDI;
    count++;
  }
  const plusAvg = count ? sumPlus / count : 0;
  const minusAvg = count ? sumMinus / count : 0;
  const last = points.length ? points[points.length - 1] : null;
  const notes: string[] = [];
  let pass = true;

  if (name === 'uptrend') {
    if (!(maxAdx > 25)) {
      pass = false;
      notes.push('ADX never exceeded 25 in uptrend');
    }
    if (!(plusAvg > minusAvg)) {
      pass = false;
      notes.push('+DI not dominating -DI in uptrend');
    }
  }

  if (name === 'flat') {
    if (maxAdx > 20) {
      pass = false;
      notes.push('ADX too high in flat market');
    }
  }

  if (!Number.isFinite(minAdx)) minAdx = 0;
  if (!Number.isFinite(maxAdx)) maxAdx = 0;

  return { name, points, minAdx, maxAdx, last, plusAvg, minusAvg, pass, notes };
}

async function testAdxSynthetic(): Promise<boolean> {
  let allOk = true;
  console.log('\n=== ADX synthetic ===');

  const uptrendRows = buildSyntheticSeries({ name: 'uptrend', length: 60, start: 100, step: 1 });
  const flatRows = buildSyntheticSeries({ name: 'flat', length: 60, start: 100, step: 0, flat: true });

  const uptrendRes = analyzeSynthetic('uptrend', computeAdx(uptrendRows, 14).points);
  const flatRes = analyzeSynthetic('flat', computeAdx(flatRows, 14).points);

  const summarize = (res: SyntheticResult) => {
    const lastAdx = res.last?.adx ?? NaN;
    console.log(
      `[${res.name}] last ADX: ${Number.isFinite(lastAdx) ? lastAdx.toFixed(1) : '—'}, min: ${res.minAdx.toFixed(
        1
      )}, max: ${res.maxAdx.toFixed(1)}, +DI avg: ${res.plusAvg.toFixed(1)}, -DI avg: ${res.minusAvg.toFixed(1)}${
        res.pass ? ' → PASS' : ' → FAIL'
      }`
    );
    if (res.notes.length) {
      for (const n of res.notes) console.log(`  note: ${n}`);
    }
  };

  summarize(uptrendRes);
  summarize(flatRes);

  if (!uptrendRes.pass || !flatRes.pass) allOk = false;
  return allOk;
}

async function testAdxReal(): Promise<boolean> {
  let allOk = true;
  console.log('\n=== ADX real-data ===');
  const symbols = ['TSLA', 'AAPL', 'MSFT'];

  for (const symbol of symbols) {
    const rows = await loadCanonicalData(symbol);
    const res = computeAdx(rows, 14);
    const pts = res.points;
    const window = pts.slice(-252);

    const adxVals = window.map((p) => p.adx).filter((v) => Number.isFinite(v));
    const minADX = adxVals.length ? Math.min(...adxVals) : NaN;
    const maxADX = adxVals.length ? Math.max(...adxVals) : NaN;
    const last = window.length ? window[window.length - 1] : null;

    let pass = true;
    if (!adxVals.length || minADX < 0 || maxADX > 100) {
      pass = false;
      allOk = false;
      console.log(`[${symbol}] FAIL: ADX out of bounds or empty`);
      continue;
    }

    const hasAbove25 = adxVals.some((v) => v > 25);
    const hasBelow20 = adxVals.some((v) => v < 20);
    if (!hasAbove25 || !hasBelow20) {
      pass = false;
      allOk = false;
    }

    console.log(
      `[${symbol}] N=${window.length} ADX min=${minADX.toFixed(1)} max=${maxADX.toFixed(1)} last=${
        last ? last.adx.toFixed(1) : '—'
      } last +DI=${last ? last.plusDI.toFixed(1) : '—'} -DI=${last ? last.minusDI.toFixed(1) : '—'}${
        pass ? ' → PASS' : ' → FAIL (range check)'
      }`
    );
  }

  return allOk;
}

async function main() {
  let allOk = true;
  const synOk = await testAdxSynthetic();
  const realOk = await testAdxReal();
  allOk = synOk && realOk;

  console.log(`\n[RESULT] ADX smoke: ${allOk ? 'PASS' : 'FAIL'}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
