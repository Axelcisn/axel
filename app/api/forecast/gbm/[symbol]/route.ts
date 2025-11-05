import { NextRequest, NextResponse } from 'next/server';
import { computeGbmForecast } from '@/lib/gbm/engine';
import { getForecast } from '@/lib/forecast/store';

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = params.symbol;
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date');
    
    const forecast = await getForecast(symbol, date || undefined);
    
    if (!forecast) {
      return NextResponse.json(
        { error: 'No forecast found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(forecast);
    
  } catch (error) {
    console.error('Error fetching forecast:', error);
    return NextResponse.json(
      { error: 'Failed to fetch forecast' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = params.symbol;
    const body = await request.json();
    
    const { date_t, window, lambda_drift } = body;
    
    // Validate parameters
    if (window !== undefined && (window < 1 || ![252, 504, 756].includes(window))) {
      return NextResponse.json(
        { error: 'Invalid window size. Must be 252, 504, or 756' },
        { status: 422 }
      );
    }
    
    if (lambda_drift !== undefined && (lambda_drift < 0 || lambda_drift > 1)) {
      return NextResponse.json(
        { error: 'Invalid lambda_drift. Must be between 0 and 1' },
        { status: 422 }
      );
    }
    
    // Compute forecast
    const forecast = await computeGbmForecast({
      symbol,
      date_t: date_t || undefined,
      window: window || 504,
      lambda_drift: lambda_drift !== undefined ? lambda_drift : 0.25
    });
    
    return NextResponse.json(forecast);
    
  } catch (error) {
    console.error('Error computing forecast:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Handle specific error cases
    if (errorMessage.includes('Target Spec required') || errorMessage.includes('Canonical dataset not found')) {
      return NextResponse.json(
        { error: errorMessage },
        { status: 400 }
      );
    }
    
    if (errorMessage.includes('Insufficient history') || errorMessage.includes('Vol too small')) {
      return NextResponse.json(
        { error: errorMessage },
        { status: 422 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to compute forecast' },
      { status: 500 }
    );
  }
}