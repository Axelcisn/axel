// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server';
import { runRollingOriginPI } from '@/lib/backtest/runner';
import { backtestStorage } from '@/lib/backtest/store';
import { ROConfig } from '@/lib/backtest/types';

/**
 * POST /api/backtest - Run a new backtest
 * GET /api/backtest?symbol=SPY - Get latest backtest results
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      symbol,
      train_years = 3,
      alpha = 0.10,
      horizon_h = [1, 5, 20],
      engines = ['garch_bootstrap', 'exp_smooth', 'linear'],
      start_date,
      end_date
    } = body;

    // Validate required parameters
    if (!symbol) {
      return NextResponse.json(
        { error: 'symbol is required' },
        { status: 400 }
      );
    }

    console.log(`Starting backtest for ${symbol}...`);

    // Build configuration
    const config: ROConfig = {
      train_years,
      step: "daily" as const,
      alpha,
      horizon_h: horizon_h[0] || 1, // Take first horizon for now
      start: start_date,
      end: end_date
    };

    // Run rolling-origin backtest
    const outcome = await runRollingOriginPI(symbol, config, engines);

    // Save results
    const filePath = await backtestStorage.saveBacktest(symbol, outcome);

    return NextResponse.json({
      success: true,
      symbol,
      outcome,
      saved_to: filePath,
      summary: {
        total_predictions: outcome.pi_metrics.length,
        date_range: outcome.pi_metrics.length > 0 ? {
          start: outcome.pi_metrics[0].date,
          end: outcome.pi_metrics[outcome.pi_metrics.length - 1].date
        } : null,
        coverage_rates: outcome.pi_metrics.length > 0 ? {
          overall: outcome.pi_metrics.reduce((sum, m) => sum + m.cover_hit, 0) / outcome.pi_metrics.length
        } : {},
        dm_test: outcome.pi_compare ? {
          statistic: outcome.pi_compare.dm_stat,
          p_value: outcome.pi_compare.dm_pvalue
        } : null,
        overfit_analysis: outcome.overfit ? {
          pbo: outcome.overfit.pbo,
          dsr: outcome.overfit.dsr
        } : null
      }
    });

  } catch (error) {
    console.error('Backtest error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to run backtest',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const timestamp = searchParams.get('timestamp');
    const action = searchParams.get('action') || 'get';

    // List all symbols
    if (action === 'list') {
      const symbols = await backtestStorage.listBacktestedSymbols();
      return NextResponse.json({ symbols });
    }

    // Symbol required for other actions
    if (!symbol) {
      return NextResponse.json(
        { error: 'symbol parameter is required' },
        { status: 400 }
      );
    }

    // Get history for symbol
    if (action === 'history') {
      const history = await backtestStorage.listBacktestHistory(symbol);
      return NextResponse.json({ symbol, history });
    }

    // Get summary for symbol
    if (action === 'summary') {
      const summary = await backtestStorage.getBacktestSummary(symbol);
      if (!summary) {
        return NextResponse.json(
          { error: `No backtest data found for ${symbol}` },
          { status: 404 }
        );
      }
      return NextResponse.json({ symbol, summary });
    }

    // Get specific or latest backtest
    const outcome = timestamp 
      ? await backtestStorage.loadBacktestByTimestamp(symbol, timestamp)
      : await backtestStorage.loadBacktest(symbol);

    if (!outcome) {
      return NextResponse.json(
        { error: `No backtest data found for ${symbol}${timestamp ? `@${timestamp}` : ''}` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      symbol,
      timestamp: timestamp || 'latest',
      outcome,
      summary: {
        total_predictions: outcome.pi_metrics.length,
        engines: Array.from(new Set(outcome.pi_metrics.map(m => m.method))),
        date_range: outcome.pi_metrics.length > 0 ? {
          start: outcome.pi_metrics[0].date,
          end: outcome.pi_metrics[outcome.pi_metrics.length - 1].date
        } : null
      }
    });

  } catch (error) {
    console.error('Backtest GET error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to retrieve backtest data',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const timestamp = searchParams.get('timestamp');

    if (!symbol) {
      return NextResponse.json(
        { error: 'symbol parameter is required' },
        { status: 400 }
      );
    }

    await backtestStorage.deleteBacktest(symbol, timestamp || undefined);

    return NextResponse.json({
      success: true,
      message: `Deleted backtest data for ${symbol}${timestamp ? `@${timestamp}` : ''}`
    });

  } catch (error) {
    console.error('Backtest DELETE error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to delete backtest data',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
