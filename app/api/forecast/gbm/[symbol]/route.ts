import { NextRequest, NextResponse } from 'next/server';
import { computeGbmEstimates, computeGbmInterval, validateSeriesForGBM, GbmInputs } from '@/lib/gbm/engine';
import { getForecasts, saveForecast, GbmForecast } from '@/lib/storage/fsStore';
import { loadCanonical } from '@/lib/storage/canonical';
import { getNthTradingCloseAfter, computeEffectiveHorizonDays } from '@/lib/calendar/service';

type GbmRequestBody = {
  windowN?: 252 | 504 | 756;
  lambdaDrift?: number;
  coverage?: number;
  horizonTrading?: 1 | 2 | 3 | 5;
};

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
    const body: GbmRequestBody = await request.json();
    
    const { 
      windowN = 504, 
      lambdaDrift = 0.25, 
      coverage = 0.95,
      horizonTrading = 1
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

    if (![1, 2, 3, 5].includes(horizonTrading)) {
      return NextResponse.json(
        { error: 'Invalid horizonTrading. Must be 1, 2, 3, or 5' },
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
    
    // Compute horizon information
    const tz = canonical.meta?.exchange_tz || 'America/New_York';
    const { verifyDate, calendarDays } = getNthTradingCloseAfter(date_t, horizonTrading, tz);
    
    const gbmInputs: GbmInputs = {
      dates,
      adjClose,
      windowN,
      lambdaDrift,
      coverage
    };
    
    // Compute GBM estimates and prediction intervals using TRADING DAYS ONLY
    const estimates = computeGbmEstimates(gbmInputs);
    const piResult = computeGbmInterval({
      S_t,
      muStarUsed: estimates.mu_star_used,
      sigmaHat: estimates.sigma_hat,
      h_trading: horizonTrading,  // Use trading days, NOT calendar days
      coverage
    });
    
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
      method: "GBM",
      horizonTrading,
      h_eff_days: calendarDays,  // Store calendar days for display
      verifyDate,
      domain: "log",
      estimates,
      pi: {
        L_h: piResult.L_h,
        U_h: piResult.U_h,
        m_t: piResult.m_t,
        s_t: piResult.s_t,
        band_width_bp: Math.round(10000 * (piResult.U_h / piResult.L_h - 1))
      },
      params: {
        windowN,
        lambdaDrift,
        coverage,
        horizonTrading
      },
      window_period,
      meta: {
        tz
      },
      locked: true
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
        errorMessage.includes('same length') ||
        errorMessage.includes('trading day') ||
        errorMessage.includes('Not enough trading days')) {
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