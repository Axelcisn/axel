import { NextRequest, NextResponse } from 'next/server';
import { computeGbmEstimates, computeGbmPI, validateSeriesForGBM, GbmInputs } from '@/lib/gbm/engine';
import { getForecasts, saveForecast, GbmForecast } from '@/lib/storage/fsStore';
import { loadCanonical } from '@/lib/storage/canonical';

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = (params.symbol || "").toUpperCase();
    const forecasts = await getForecasts(symbol);
    
    if (forecasts.length === 0) {
      return NextResponse.json(
        { error: 'No forecasts found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json(forecasts);
    
  } catch (error) {
    console.error('Error fetching forecasts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch forecasts' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = (params.symbol || "").toUpperCase();
    const body = await request.json();
    
    const { 
      windowN = 504, 
      lambdaDrift = 0.25, 
      coverage = 0.95 
    } = body;
    
    // Validate parameters
    if (![252, 504, 756].includes(windowN)) {
      return NextResponse.json(
        { error: 'Invalid windowN. Must be 252, 504, or 756' },
        { status: 422 }
      );
    }
    
    if (lambdaDrift < 0 || lambdaDrift > 1) {
      return NextResponse.json(
        { error: 'Invalid lambdaDrift. Must be between 0 and 1' },
        { status: 422 }
      );
    }
    
    if (coverage <= 0 || coverage >= 1) {
      return NextResponse.json(
        { error: 'Invalid coverage. Must be between 0 and 1' },
        { status: 422 }
      );
    }
    
    // Load canonical data
    const canonical = await loadCanonical(symbol);
    if (!canonical) {
      return NextResponse.json(
        { error: 'Canonical data not found' },
        { status: 400 }
      );
    }
    
    // Filter valid rows and sort by date
    const validRows = canonical.rows
      .filter(row => row.adj_close != null && row.adj_close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    
    if (validRows.length < windowN + 1) {
      return NextResponse.json(
        { error: `Insufficient data: need ${windowN + 1} observations, have ${validRows.length}` },
        { status: 422 }
      );
    }
    
    // Prepare inputs for GBM computation
    const dates = validRows.map(row => row.date);
    const adjClose = validRows.map(row => row.adj_close!);  // Non-null assertion safe after filter
    const date_t = dates[dates.length - 1];
    const S_t = adjClose[adjClose.length - 1];
    
    const gbmInputs: GbmInputs = {
      dates,
      adjClose,
      windowN,
      lambdaDrift,
      coverage
    };
    
    // Compute GBM estimates and prediction intervals
    const estimates = computeGbmEstimates(gbmInputs);
    const pi = computeGbmPI(S_t, estimates);
    
    // Create window period info
    const window_period = {
      start: dates[0],
      end: dates[dates.length - 1],
      n_obs: dates.length
    };
    
    // Create forecast record
    const forecast: GbmForecast = {
      symbol,
      date_t,
      date_forecast: new Date().toISOString(),
      S_t,
      estimates,
      pi,
      params: {
        windowN,
        lambdaDrift,
        coverage
      },
      window_period,
      meta: {
        tz: 'America/New_York' // Default timezone - would be derived from target spec in production
      }
    };
    
    // Save forecast
    await saveForecast(forecast);
    
    return NextResponse.json(forecast);
    
  } catch (error) {
    console.error('Error computing forecast:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Handle specific error cases
    if (errorMessage.includes('Non-positive price') || 
        errorMessage.includes('Insufficient data') ||
        errorMessage.includes('same length')) {
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