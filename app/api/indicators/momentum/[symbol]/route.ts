import { NextResponse } from 'next/server';
import { loadCanonicalData } from '@/lib/storage/canonical';
import { computeMomentum } from '@/lib/indicators/momentum';

export async function GET(
  req: Request,
  { params }: { params: { symbol: string } }
) {
  const url = new URL(req.url);
  const periodParam = url.searchParams.get('period');
  const period = periodParam ? Math.max(1, parseInt(periodParam, 10) || 10) : 10;

  const symbol = params.symbol.toUpperCase();

  try {
    const rows = await loadCanonicalData(symbol);
    
    // Map rows to { date, close }
    const series = rows.map(r => ({
      date: r.date,
      close: r.close,
    }));

    const result = computeMomentum(series, period);

    return NextResponse.json({
      success: true,
      symbol,
      period: result.period,
      points: result.points,
      latest: result.latest,
    });
  } catch (err: any) {
    console.error('Momentum API error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err?.message ?? 'Failed to compute momentum',
      },
      { status: 500 }
    );
  }
}
