import { GET } from '@/app/api/yahoo/chart/route';

const symbols = ['NFLX', 'AAPL', 'TSLA'];
const intervals = ['1m', '15m', '60m'];

async function fetchCandles(symbol: string, interval: string) {
  const url = `http://localhost/api/yahoo/chart?ticker=${encodeURIComponent(
    symbol
  )}&interval=${encodeURIComponent(interval)}&rangeDays=30`;
  const res = await GET(new Request(url));
  const json = await res.json();
  const candles = json?.candles ?? [];
  const first = candles[0]?.t ?? null;
  const last = candles[candles.length - 1]?.t ?? null;
  // eslint-disable-next-line no-console
  console.log(`${symbol} ${interval}: ${candles.length} candles (first=${first} last=${last})`);
  if ((interval === '15m' || interval === '60m') && candles.length === 0) {
    throw new Error(`${symbol} ${interval} returned no candles`);
  }
  return candles.length;
}

async function main() {
  for (const symbol of symbols) {
    for (const interval of intervals) {
      await fetchCandles(symbol, interval);
    }
  }
  // eslint-disable-next-line no-console
  console.log('Timing smoke test passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
