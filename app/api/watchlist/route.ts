import { NextRequest, NextResponse } from 'next/server';
import { assembleWatchlist, loadWatchlistSummary, getLatestWatchlistSummary, getCanonicalSymbols } from '@/lib/watchlist/assembler';
import { WatchlistSummary } from '@/lib/watchlist/types';

/**
 * POST /api/watchlist - Assemble and persist watchlist
 * GET /api/watchlist - Get latest or specific watchlist
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      symbols,
      as_of
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

    console.log(`Assembling watchlist for ${targetSymbols.length} symbols as of ${as_of}...`);

    // Assemble watchlist
    const summary = await assembleWatchlist(targetSymbols, as_of);

    return NextResponse.json({
      success: true,
      summary,
      metadata: {
        symbols_requested: targetSymbols.length,
        symbols_processed: summary.rows.length,
        complete_rows: summary.rows.filter(row => 
          row.forecast.source !== "none" && 
          row.bands.L_1 !== null && 
          row.bands.U_1 !== null
        ).length,
        processing_timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Watchlist assembly error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to assemble watchlist',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const asOf = searchParams.get('as_of');
    const action = searchParams.get('action') || 'get';

    // Get latest if no specific date requested
    if (action === 'latest' || !asOf) {
      const summary = await getLatestWatchlistSummary();
      
      if (!summary) {
        return NextResponse.json(
          { error: 'No watchlist data found. Try assembling one first.' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        summary,
        metadata: {
          is_latest: true,
          symbols_count: summary.rows.length,
          complete_rows: summary.rows.filter(row => 
            row.forecast.source !== "none" && 
            row.bands.L_1 !== null && 
            row.bands.U_1 !== null
          ).length
        }
      });
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      return NextResponse.json(
        { error: 'as_of must be in YYYY-MM-DD format' },
        { status: 400 }
      );
    }

    // Get specific date
    const summary = await loadWatchlistSummary(asOf);
    
    if (!summary) {
      return NextResponse.json(
        { error: `No watchlist data found for ${asOf}` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      summary,
      metadata: {
        is_latest: false,
        requested_date: asOf,
        symbols_count: summary.rows.length,
        complete_rows: summary.rows.filter(row => 
          row.forecast.source !== "none" && 
          row.bands.L_1 !== null && 
          row.bands.U_1 !== null
        ).length
      }
    });

  } catch (error) {
    console.error('Watchlist GET error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to retrieve watchlist data',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const asOf = searchParams.get('as_of');

    if (!asOf) {
      return NextResponse.json(
        { error: 'as_of parameter is required' },
        { status: 400 }
      );
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      return NextResponse.json(
        { error: 'as_of must be in YYYY-MM-DD format' },
        { status: 400 }
      );
    }

    // Delete watchlist file
    const { promises: fs } = await import('fs');
    const path = await import('path');
    const filePath = path.join(process.cwd(), 'data', 'watchlist', `${asOf}.json`);
    
    try {
      await fs.unlink(filePath);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return NextResponse.json(
          { error: `No watchlist data found for ${asOf}` },
          { status: 404 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: `Deleted watchlist data for ${asOf}`
    });

  } catch (error) {
    console.error('Watchlist DELETE error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to delete watchlist data',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}