import { NextRequest, NextResponse } from 'next/server';
import { getTargetSpec, saveTargetSpec } from '@/lib/storage/targetSpecStore';
import { resolveExchangeAndTZ } from '@/lib/calendar/service';

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  const symbol = (params.symbol || "").toUpperCase();
  const res = await getTargetSpec(symbol);
  if (!res) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ spec: res, meta: { hasTZ: !!res.exchange_tz, source: "canonical" } });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = (params.symbol || "").toUpperCase();
    const body = await request.json();
    
    // Require exchange_tz in the request
    if (!body?.exchange_tz || !String(body.exchange_tz).includes("/")) {
      return NextResponse.json(
        { error: "exchange_tz required (IANA tz)" },
        { status: 400 }
      );
    }
    
    const savedSpec = await saveTargetSpec({ 
      symbol,
      h: body.h, 
      coverage: body.coverage, 
      exchange_tz: body.exchange_tz,
      variable: "NEXT_CLOSE_ADJ",
      cutoff_note: "compute at t close; verify at t+1 close",
      updated_at: new Date().toISOString()
    });
    
    return NextResponse.json(savedSpec);
  } catch (error) {
    console.error('Error in target spec POST:', error);
    return NextResponse.json(
      { error: 'Failed to save target spec' },
      { status: 500 }
    );
  }
}