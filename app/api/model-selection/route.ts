import { NextRequest, NextResponse } from 'next/server';
import { computeModelSelection } from '@/lib/modelSelection';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const symbol = searchParams.get('symbol');
    const horizonTradingStr = searchParams.get('horizonTrading');
    const coverageStr = searchParams.get('coverage');

    // Validate required parameters
    if (!symbol || !horizonTradingStr || !coverageStr) {
      return NextResponse.json(
        { error: 'Missing required parameters: symbol, horizonTrading, coverage' },
        { status: 400 }
      );
    }

    const horizonTrading = parseInt(horizonTradingStr, 10);
    const coverage = parseFloat(coverageStr);

    // Validate parameters
    if (isNaN(horizonTrading) || horizonTrading < 1 || horizonTrading > 10) {
      return NextResponse.json(
        { error: 'Invalid horizonTrading: must be a number between 1 and 10' },
        { status: 400 }
      );
    }

    if (isNaN(coverage) || coverage <= 0 || coverage >= 1) {
      return NextResponse.json(
        { error: 'Invalid coverage: must be a number between 0 and 1' },
        { status: 400 }
      );
    }

    // Get the full model selection with scores
    const modelSelection = await computeModelSelection({
      symbol: symbol.toUpperCase(),
      models: ["GBM-CC", "GARCH11-N", "GARCH11-t", "Range-P", "Range-GK", "Range-RS", "Range-YZ"],
      horizonTrading,
      coverage
    });
    
    const result = {
      symbol: symbol.toUpperCase(),
      horizonTrading,
      coverage,
      defaultModel: modelSelection.defaultMethod,
      modelScores: modelSelection.modelScores.map(score => ({
        model: score.model,
        score: score.score,
        metrics: {
          alpha: score.metrics.alpha,
          n: score.metrics.n,
          intervalScore: score.metrics.intervalScore,
          empiricalCoverage: score.metrics.coverage,
          coverageError: score.metrics.coverageError,
          avgWidthBp: score.metrics.avgWidthBp,
          kupiecPValue: score.metrics.kupiecPValue,
          ccPValue: score.metrics.ccPValue,
          trafficLight: score.metrics.trafficLight
        },
        noData: score.noData
      })),
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(result);

  } catch (error) {
    console.error('Error getting model recommendations:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}