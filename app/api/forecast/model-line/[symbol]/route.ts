// app/api/forecast/model-line/[symbol]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { loadPredictionSeries } from '@/lib/forecast/predictionSeries';

// This API returns a model prediction line for a given symbol + method
// Uses ONLY y_hat values for true forward-looking predictions
// Response shape: { data: Array<{ date: string; model_price: number }> }
export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  const symbol = params.symbol;
  const searchParams = request.nextUrl.searchParams;

  const method = searchParams.get('method') || 'GBM-CC';
  const windowParam = searchParams.get('window');
  const window = windowParam ? parseInt(windowParam, 10) : 250;

  if (!symbol) {
    return NextResponse.json(
      { error: 'Symbol is required' },
      { status: 400 }
    );
  }

  try {
    // Use dedicated prediction series loader (y_hat only)
    const data = await loadPredictionSeries(symbol, window, method);

    // Log summary for debugging
    console.log(`[MODEL-LINE API] ${symbol} ${method}: ${data.length} prediction points in window ${window}`);
    if (data.length > 0) {
      console.log(`[MODEL-LINE API] Sample points:`, data.slice(-5));
    }

    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('Error loading model prediction line', err);
    return NextResponse.json(
      { error: err?.message ?? 'Internal error loading model line' },
      { status: 500 }
    );
  }
}