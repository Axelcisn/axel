import { NextRequest, NextResponse } from 'next/server';
import { ensureCanonicalOrHistory } from '@/lib/storage/canonical';

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = params.symbol.toUpperCase();
    const url = new URL(request.url);
    const fields = url.searchParams.get('fields');

    // Use ensureCanonicalOrHistory so Yahoo-only tickers still return meta
    try {
      const canonical = await ensureCanonicalOrHistory(symbol, { minRows: 0 });
      const meta = canonical.meta || {};
      const rowCount = canonical.rows ? canonical.rows.length : 0;

      return NextResponse.json({
        meta: {
          ...meta,
          rows: rowCount,
        },
        ...(fields?.includes('rv_head') ? { rv_head: [] } : {}),
      });
    } catch (error) {
      // File doesn't exist or no data could be fetched
      return NextResponse.json({ meta: null, ...(fields?.includes('rv_head') ? { rv_head: [] } : {}) });
    }
  } catch (error) {
    console.error('Error reading canonical data:', error);
    return NextResponse.json(
      { error: 'Failed to read canonical data' },
      { status: 500 }
    );
  }
}
