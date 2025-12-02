import fs from 'fs';
import { sliceByRange } from './lib/chart/ranges';
import { runEwmaWalker } from './lib/volatility/ewmaWalker';

const normalize = (d: string) => d;

(async () => {
  const canonical = JSON.parse(fs.readFileSync('data/canonical/AAPL.json', 'utf-8'));
  const rows = canonical.rows.filter((r: any) => r.valid !== false).map((r: any) => ({ date: r.date, adj_close: r.adj_close || r.close }));
  const data = sliceByRange(rows, '1M');
  const chartData = data.map((p: any) => ({ date: p.date, value: p.adj_close, isFuture: false }));
  const ewma = await runEwmaWalker({ symbol: 'AAPL' });
  const map = new Map<string, number>();
  ewma.points.forEach((p: any) => {
    map.set(p.date_tp1, p.y_hat_tp1);
  });
  const missingDates = ['2025-09-18','2025-09-19','2025-09-22'];
  missingDates.forEach(d => map.delete(d));
  const result = chartData.map(point => {
    const e = map.get(point.date);
    return { ...point, ewma_forecast: e ?? null };
  });
  for (let i = 0; i < result.length; i++) {
    if (result[i].ewma_forecast != null) continue;
    const gapStartIndex = i - 1;
    if (gapStartIndex < 0 || result[gapStartIndex].ewma_forecast == null) continue;
    let gapEndIndex = i;
    while (gapEndIndex < result.length && result[gapEndIndex].ewma_forecast == null) {
      gapEndIndex++;
    }
    if (gapEndIndex >= result.length || result[gapEndIndex].ewma_forecast == null) break;
    const prev = result[gapStartIndex];
    const next = result[gapEndIndex];
    const totalSteps = gapEndIndex - gapStartIndex;
    for (let step = 1; step < totalSteps; step++) {
      const idx = gapStartIndex + step;
      const t = step / totalSteps;
      result[idx] = {
        ...result[idx],
        ewma_forecast: prev.ewma_forecast! + t * (next.ewma_forecast! - prev.ewma_forecast!),
      };
    }
    i = gapEndIndex;
  }
  console.log(result.map(p => ({ date: p.date, v: p.ewma_forecast })));
})();
