import { NextRequest, NextResponse } from 'next/server';
import { alertsStore } from '@/lib/alerts/store';

/**
 * GET /api/alerts/fires - Lightweight endpoint to read fired alerts from logs
 * 
 * Query params:
 *   - date (YYYY-MM-DD): Return fires for a specific date
 *   - days (number, default 7): Return recent fires for the last N days (if date not provided)
 *   - symbol (string, optional): Filter fires by symbol
 * 
 * This endpoint reads directly from fire logs WITHOUT recomputing alerts,
 * making it much faster than GET /api/alerts/run for display purposes.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    const daysParam = searchParams.get('days');
    const symbol = searchParams.get('symbol')?.toUpperCase() ?? null;

    const days = daysParam ? parseInt(daysParam, 10) : 7;

    let fires;

    if (date) {
      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json(
          { error: 'date must be in YYYY-MM-DD format' },
          { status: 400 }
        );
      }
      fires = await alertsStore.getFires(date);
    } else {
      // Get recent fires for the last N days
      fires = await alertsStore.getRecentFires(days);
    }

    // Filter by symbol if provided
    if (symbol) {
      fires = fires.filter(f => f.symbol === symbol);
    }

    return NextResponse.json({ fires });

  } catch (error) {
    console.error('Failed to load alert fires:', error);
    return NextResponse.json(
      { error: 'Failed to load alert fires' },
      { status: 500 }
    );
  }
}
