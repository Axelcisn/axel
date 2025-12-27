import { GET as yahooChart } from '@/app/api/yahoo/chart/route';

type Candle = { t: number; c: number };

const tickers = ['AAPL', 'MSFT', 'SPY'] as const;
const intervals = ['1d', '1wk', '1mo'] as const;
const emaPeriods = [5, 20, 200] as const;
const rangeDaysByInterval: Record<(typeof intervals)[number], number> = {
  '1d': 1200,
  '1wk': 8000,
  '1mo': 20000,
};

const spacingExpectations: Record<(typeof intervals)[number], { min: number; max: number; target: number }> = {
  '1d': { min: 0.8, max: 1.3, target: 1 },
  '1wk': { min: 6, max: 8.5, target: 7 },
  '1mo': { min: 26, max: 33, target: 30 },
};

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const medianSpacingDays = (candles: Candle[]) => {
  if (candles.length < 2) return null;
  const diffs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    diffs.push(candles[i].t - candles[i - 1].t);
  }
  const medianSec = median(diffs);
  return medianSec == null ? null : medianSec / 86_400;
};

const computeEma = (closes: number[], period: number) => {
  if (closes.length < period) return null;
  const seed = closes.slice(0, period);
  const sma = seed.reduce((sum, v) => sum + v, 0) / period;
  const alpha = 2 / (period + 1);
  let ema = sma;
  for (let i = period; i < closes.length; i += 1) {
    ema = alpha * closes[i] + (1 - alpha) * ema;
  }
  return ema;
};

const fetchCandles = async (ticker: string, interval: (typeof intervals)[number]) => {
  const rangeDays = rangeDaysByInterval[interval];
  const url = `http://localhost/api/yahoo/chart?ticker=${encodeURIComponent(ticker)}&interval=${interval}&rangeDays=${rangeDays}`;
  const res = await yahooChart(new Request(url));
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Chart request failed for ${ticker} ${interval}: ${json?.error ?? res.statusText}`);
  }
  const candles: Candle[] = (json?.candles ?? [])
    .map((c: any) => ({ t: Number(c?.t), c: Number(c?.c) }))
    .filter((c: Candle) => Number.isFinite(c.t) && Number.isFinite(c.c))
    .sort((a: Candle, b: Candle) => a.t - b.t);
  return candles;
};

const formatNumber = (value: number | null, decimals = 2) => {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toFixed(decimals);
};

async function main() {
  const rows: Array<{
    ticker: string;
    interval: (typeof intervals)[number];
    bars: number;
    lastClose: number | null;
    ema5: number | null;
    ema20: number | null;
    ema200: number | null;
    gap5: number | null;
    gap20: number | null;
    gap200: number | null;
  }> = [];
  let spacingIssue = false;

  for (const ticker of tickers) {
    for (const interval of intervals) {
      const candles = await fetchCandles(ticker, interval);
      const spacingDays = medianSpacingDays(candles);
      const expected = spacingExpectations[interval];
      if (spacingDays == null || spacingDays < expected.min || spacingDays > expected.max) {
        // eslint-disable-next-line no-console
        console.log(
          `[${ticker} ${interval}] FAIL interval not honored (median ${
            spacingDays == null ? 'n/a' : spacingDays.toFixed(2)
          }d, target ~${expected.target}d)`
        );
        spacingIssue = true;
      }

      const closes = candles.map((c) => c.c);
      const lastClose = closes.length ? closes[closes.length - 1] : null;
      const ema5 = computeEma(closes, emaPeriods[0]);
      const ema20 = computeEma(closes, emaPeriods[1]);
      const ema200 = computeEma(closes, emaPeriods[2]);

      rows.push({
        ticker,
        interval,
        bars: candles.length,
        lastClose,
        ema5,
        ema20,
        ema200,
        gap5: lastClose != null && ema5 != null ? lastClose - ema5 : null,
        gap20: lastClose != null && ema20 != null ? lastClose - ema20 : null,
        gap200: lastClose != null && ema200 != null ? lastClose - ema200 : null,
      });
    }
  }

  const headers = ['Ticker', 'Interval', 'Bars', 'LastClose', 'EMA5', 'Gap5', 'EMA20', 'Gap20', 'EMA200', 'Gap200'];
  const divider = headers.map(() => '---');
  // eslint-disable-next-line no-console
  console.log(`| ${headers.join(' | ')} |`);
  // eslint-disable-next-line no-console
  console.log(`| ${divider.join(' | ')} |`);

  for (const row of rows) {
    const line = [
      row.ticker,
      row.interval,
      String(row.bars),
      formatNumber(row.lastClose),
      formatNumber(row.ema5),
      formatNumber(row.gap5),
      formatNumber(row.ema20),
      formatNumber(row.gap20),
      formatNumber(row.ema200),
      formatNumber(row.gap200),
    ];
    // eslint-disable-next-line no-console
    console.log(`| ${line.join(' | ')} |`);
  }

  if (spacingIssue) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
