import { NextRequest, NextResponse } from 'next/server';
import { computeVarDiagnostics } from '@/lib/var/backtest';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const model = searchParams.get('model') as "GBM" | "GARCH11-N" | "GARCH11-t" | "Range-P" | "Range-GK" | "Range-RS" | "Range-YZ" | null;
    const horizonStr = searchParams.get('horizon');
    const coverageStr = searchParams.get('coverage');

    // Validate required parameters
    if (!symbol || !model || !horizonStr || !coverageStr) {
      return NextResponse.json(
        { error: 'Missing required parameters: symbol, model, horizon, coverage' },
        { status: 400 }
      );
    }

    const horizon = parseInt(horizonStr, 10);
    const coverage = parseFloat(coverageStr);

    // Validate parameter values
    if (isNaN(horizon) || isNaN(coverage)) {
      return NextResponse.json(
        { error: 'Invalid numeric parameters' },
        { status: 400 }
      );
    }

    if (!['GBM', 'GARCH11-N', 'GARCH11-t', 'Range-P', 'Range-GK', 'Range-RS', 'Range-YZ'].includes(model)) {
      return NextResponse.json(
        { error: 'Invalid model. Must be GBM, GARCH11-N, GARCH11-t, Range-P, Range-GK, Range-RS, or Range-YZ' },
        { status: 400 }
      );
    }

    // Compute VaR diagnostics for the single model
    const diagnostics = await computeVarDiagnostics({
      symbol,
      models: [model],
      horizonTrading: horizon,
      coverage
    });

    const modelDiag = diagnostics[model];
    if (!modelDiag) {
      return NextResponse.json(
        { error: 'No diagnostics available for the specified model' },
        { status: 404 }
      );
    }

    // Return simplified diagnostics data
    const result = {
      alpha: modelDiag.coverage.alpha,
      n: modelDiag.coverage.n,
      I: modelDiag.kupiec.I,
      empiricalRate: modelDiag.coverage.empiricalRate,
      kupiec: { pValue: modelDiag.kupiec.pValue },
      christoffersen: { pValue_cc: modelDiag.christoffersen.pValue_cc },
      trafficLight: modelDiag.trafficLight
    };

    return NextResponse.json(result);

  } catch (error) {
    console.error('Error computing VaR diagnostics:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}