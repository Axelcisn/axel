import { NextRequest, NextResponse } from 'next/server';
import { runAlertsForSymbols, checkPendingAlerts, getAlertSummary } from '@/lib/alerts/engine';
import { getCanonicalSymbols } from '@/lib/watchlist/assembler';

/**
 * POST /api/alerts/run - Run alerts for symbols
 * GET /api/alerts/run - Check pending alerts without firing
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      symbols,
      as_of,
      exchange_tz = "America/New_York"
    } = body;

    // Validate required parameters
    if (!as_of) {
      return NextResponse.json(
        { error: 'as_of date is required (YYYY-MM-DD format)' },
        { status: 400 }
      );
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(as_of)) {
      return NextResponse.json(
        { error: 'as_of must be in YYYY-MM-DD format' },
        { status: 400 }
      );
    }

    // Get symbols (use provided or canonical)
    let targetSymbols: string[] = [];
    if (symbols && Array.isArray(symbols)) {
      targetSymbols = symbols.filter(s => typeof s === 'string' && s.trim().length > 0);
    } else {
      // Use canonical symbols from data files
      targetSymbols = await getCanonicalSymbols();
    }

    if (targetSymbols.length === 0) {
      return NextResponse.json(
        { error: 'No symbols provided and no canonical symbols found' },
        { status: 400 }
      );
    }

    console.log(`Running alerts for ${targetSymbols.length} symbols on ${as_of} (${exchange_tz})`);

    // Run alerts
    const fires = await runAlertsForSymbols(targetSymbols, as_of, exchange_tz);

    return NextResponse.json({
      success: true,
      fires,
      metadata: {
        symbols_checked: targetSymbols.length,
        alerts_fired: fires.length,
        exchange_tz,
        run_timestamp: new Date().toISOString(),
        fired_symbols: Array.from(new Set(fires.map(f => f.symbol))),
        reasons: {
          threshold: fires.filter(f => f.reason === 'threshold').length,
          next_review: fires.filter(f => f.reason === 'next_review').length
        }
      }
    });

  } catch (error) {
    console.error('Alerts run error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to run alerts',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');
    const asOf = searchParams.get('as_of');
    const exchangeTz = searchParams.get('exchange_tz') || "America/New_York";
    const action = searchParams.get('action') || 'check';

    // Use today if no date specified
    const targetDate = asOf || new Date().toISOString().split('T')[0];

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return NextResponse.json(
        { error: 'as_of must be in YYYY-MM-DD format' },
        { status: 400 }
      );
    }

    // Parse symbols
    let targetSymbols: string[] = [];
    if (symbolsParam) {
      targetSymbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(s => s.length > 0);
    } else {
      targetSymbols = await getCanonicalSymbols();
    }

    if (targetSymbols.length === 0) {
      return NextResponse.json(
        { error: 'No symbols provided and no canonical symbols found' },
        { status: 400 }
      );
    }

    if (action === 'summary') {
      // Get alert summary
      const summary = await getAlertSummary(targetSymbols, targetDate, exchangeTz);
      
      return NextResponse.json({
        summary,
        metadata: {
          symbols_checked: targetSymbols.length,
          as_of: targetDate,
          exchange_tz: exchangeTz
        }
      });
    }

    // Check pending alerts for each symbol
    const pending = [];
    
    for (const symbol of targetSymbols) {
      try {
        const symbolPending = await checkPendingAlerts(symbol, targetDate, exchangeTz);
        
        if (symbolPending.threshold_alerts.length > 0 || symbolPending.review_alerts.length > 0) {
          pending.push({
            symbol,
            ...symbolPending
          });
        }
      } catch (error) {
        console.warn(`Failed to check pending alerts for ${symbol}:`, error);
      }
    }

    return NextResponse.json({
      pending_alerts: pending,
      metadata: {
        symbols_checked: targetSymbols.length,
        symbols_with_pending: pending.length,
        total_threshold_alerts: pending.reduce((sum, p) => sum + p.threshold_alerts.length, 0),
        total_review_alerts: pending.reduce((sum, p) => sum + p.review_alerts.length, 0),
        as_of: targetDate,
        exchange_tz: exchangeTz,
        check_timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Alerts check error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to check pending alerts',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}