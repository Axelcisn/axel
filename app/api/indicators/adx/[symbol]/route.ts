import { NextResponse } from 'next/server';
import { loadCanonicalDataWithYahooSupplement } from '@/lib/storage/canonical';
import { computeAdx } from '@/lib/indicators/adx';

export async function GET(
  req: Request,
  { params }: { params: { symbol: string } }
) {
  const url = new URL(req.url);
  const periodParam = url.searchParams.get('period');
  const period = periodParam ? Math.max(1, parseInt(periodParam, 10) || 14) : 14;

  const symbol = params.symbol.toUpperCase();

  try {
    const rows = await loadCanonicalDataWithYahooSupplement(symbol);
    
    // Map rows to { date, high, low, close }, preferring adjusted close and filtering invalids
    const series = rows
      .map(r => ({
        date: r.date,
        high: r.high,
        low: r.low,
        close: r.adj_close ?? r.close,
      }))
      .filter(r =>
        Number.isFinite(r.high) &&
        Number.isFinite(r.low) &&
        Number.isFinite(r.close)
      );

    const result = computeAdx(series, period);

    return NextResponse.json({
      success: true,
      symbol,
      period: result.period,
      points: result.points,
      latest: result.latest,
      trendStrength: result.trendStrength,
    });
  } catch (err: any) {
    console.error('ADX API error:', err);
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Failed to compute ADX' },
      { status: 500 }
    );
  }
}
