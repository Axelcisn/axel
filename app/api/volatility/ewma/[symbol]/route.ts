import { NextRequest, NextResponse } from 'next/server';
import { runEwmaWalker, summarizeEwmaWalkerResults } from '@/lib/volatility/ewmaWalker';

interface RouteParams {
  params: { symbol: string };
}

/**
 * GET /api/volatility/ewma/[symbol]
 * 
 * Query params:
 * - lambda: EWMA decay factor (default: 0.94)
 * - startDate: Start date for walk (ISO string)
 * - endDate: End date for walk (ISO string)
 * - initialWindow: Initial window size (default: 252)
 * - coverage: Target coverage level (default: 0.95)
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const symbol = (params.symbol || '').toUpperCase();
    if (!symbol) {
      return NextResponse.json(
        { error: 'Symbol is required' },
        { status: 400 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const lambda = parseFloat(searchParams.get('lambda') || '0.94');
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const initialWindow = parseInt(searchParams.get('initialWindow') || '252', 10);
    const coverage = parseFloat(searchParams.get('coverage') || '0.95');

    // Validate parameters
    if (isNaN(lambda) || lambda <= 0 || lambda >= 1) {
      return NextResponse.json(
        { error: 'lambda must be between 0 and 1' },
        { status: 400 }
      );
    }
    if (isNaN(coverage) || coverage <= 0 || coverage >= 1) {
      return NextResponse.json(
        { error: 'coverage must be between 0 and 1' },
        { status: 400 }
      );
    }
    if (isNaN(initialWindow) || initialWindow < 10) {
      return NextResponse.json(
        { error: 'initialWindow must be at least 10' },
        { status: 400 }
      );
    }

    // Run EWMA walker
    const result = await runEwmaWalker({
      symbol,
      lambda,
      startDate,
      endDate,
      initialWindow,
      coverage
    });

    // Compute summary statistics
    const summary = summarizeEwmaWalkerResults(result);

    return NextResponse.json({
      success: true,
      symbol,
      points: result.points,
      piMetrics: {
        empiricalCoverage: summary.coverage,
        coverage: summary.targetCoverage,
        intervalScore: summary.intervalScore,
        avgWidth: summary.avgWidth,
        nPoints: summary.nPoints
      },
      zMean: summary.zMean,
      zStd: summary.zStd,
      directionHitRate: summary.directionHitRate,
      volatilityStats: summary.volatilityStats,
      dateRange: summary.dateRange,
      params: result.params
    });
  } catch (error) {
    console.error('[EWMA API] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/volatility/ewma/[symbol]
 * 
 * Body:
 * {
 *   lambda?: number,
 *   startDate?: string,
 *   endDate?: string,
 *   initialWindow?: number,
 *   coverage?: number
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const symbol = (params.symbol || '').toUpperCase();
    if (!symbol) {
      return NextResponse.json(
        { error: 'Symbol is required' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const {
      lambda = 0.94,
      startDate,
      endDate,
      initialWindow = 252,
      coverage = 0.95
    } = body;

    // Validate parameters
    if (typeof lambda !== 'number' || lambda <= 0 || lambda >= 1) {
      return NextResponse.json(
        { error: 'lambda must be a number between 0 and 1' },
        { status: 400 }
      );
    }
    if (typeof coverage !== 'number' || coverage <= 0 || coverage >= 1) {
      return NextResponse.json(
        { error: 'coverage must be a number between 0 and 1' },
        { status: 400 }
      );
    }
    if (typeof initialWindow !== 'number' || initialWindow < 10) {
      return NextResponse.json(
        { error: 'initialWindow must be a number >= 10' },
        { status: 400 }
      );
    }

    // Run EWMA walker
    const result = await runEwmaWalker({
      symbol,
      lambda,
      startDate,
      endDate,
      initialWindow,
      coverage
    });

    // Compute summary statistics
    const summary = summarizeEwmaWalkerResults(result);

    return NextResponse.json({
      success: true,
      symbol,
      points: result.points,
      piMetrics: {
        empiricalCoverage: summary.coverage,
        coverage: summary.targetCoverage,
        intervalScore: summary.intervalScore,
        avgWidth: summary.avgWidth,
        nPoints: summary.nPoints
      },
      zMean: summary.zMean,
      zStd: summary.zStd,
      directionHitRate: summary.directionHitRate,
      volatilityStats: summary.volatilityStats,
      dateRange: summary.dateRange,
      summary: {
        totalPoints: result.points.length,
        averageVolatility: summary.volatilityStats.avg,
        directionAccuracy: summary.directionHitRate,
        dateRange: summary.dateRange
      },
      aggregatedMetrics: result.aggregatedMetrics,
      params: result.params
    });
  } catch (error) {
    console.error('[EWMA API] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
