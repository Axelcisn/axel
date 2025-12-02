import { runEwmaWalker } from './lib/volatility/ewmaWalker';

(async () => {
  const result = await runEwmaWalker({ symbol: 'AAPL' });
  const last = result.points.slice(-30);
  const missing: Array<{ prev: string; curr: string; diff: number }> = [];
  for (let i = 1; i < last.length; i++) {
    const prev = last[i - 1].date_tp1;
    const curr = last[i].date_tp1;
    const prevDate = new Date(prev + 'T00:00:00Z');
    const currDate = new Date(curr + 'T00:00:00Z');
    const diff = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diff > 3) {
      missing.push({ prev, curr, diff });
    }
  }
  console.log('missing intervals >3 days', missing);
})();
