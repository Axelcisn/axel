import { NextRequest, NextResponse } from 'next/server';
import { generateBaseForecastsForWindow } from '@/lib/forecast/generateBaseForecasts';

/**
 * POST /api/conformal/generate/[symbol]
 * Generate base forecasts for conformal prediction calibration
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  const symbol = params.symbol;
  
  try {
    const body = await request.json();
    const baseMethod = body.base_method as string;
    const calWindow = Number(body.cal_window);
    const domain = (body.domain as 'log' | 'price') ?? 'log';
    const horizon = body.horizon ? Number(body.horizon) : undefined;
    const coverage = body.coverage ? Number(body.coverage) : undefined;

    // Validate inputs
    if (!symbol || !baseMethod || !calWindow || calWindow <= 0) {
      return NextResponse.json(
        { 
          error: 'Missing or invalid parameters. Required: base_method, cal_window > 0',
          received: { symbol, baseMethod, calWindow, domain, horizon, coverage }
        },
        { status: 400 }
      );
    }

    if (calWindow > 20000) {
      return NextResponse.json(
        { error: 'Calibration window too large. Maximum allowed: 20000 days' },
        { status: 400 }
      );
    }

    console.log(`[Conformal] Generating base forecasts for ${symbol}:`, {
      baseMethod,
      calWindow,
      domain,
      horizon,
      coverage
    });

    // Generate base forecasts
    const result = await generateBaseForecastsForWindow({
      symbol,
      baseMethod,
      calWindow,
      domain,
      horizon,
      coverage
    });

    console.log(`[Conformal] Generation complete for ${symbol}:`, result);

    return NextResponse.json({
      success: true,
      symbol,
      base_method: baseMethod,
      cal_window: calWindow,
      domain,
      ...result,
      generatedFileIds: result.generatedFileIds,  // Include file IDs for cleanup tracking
      message: `Generated ${result.created} new forecasts. ${result.alreadyExisting} already existed.${result.errors > 0 ? ` ${result.errors} errors occurred.` : ''}`
    });

  } catch (error) {
    console.error('[Conformal] Generate base forecasts error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { 
        error: 'Failed to generate base forecasts',
        details: errorMessage,
        symbol 
      },
      { status: 500 }
    );
  }
}