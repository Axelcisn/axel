import { NextRequest, NextResponse } from 'next/server';
import { getTargetSpec, saveTargetSpec } from '@/lib/storage/targetSpecStore';
import { TargetSpec, TargetSpecResult } from '@/lib/types/targetSpec';
import { resolveExchangeAndTZ } from '@/lib/calendar/service';

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = params.symbol;
    
    // Try to get existing spec
    const existingSpec = await getTargetSpec(symbol);
    if (existingSpec) {
      const result: TargetSpecResult = {
        spec: existingSpec,
        meta: { hasTZ: Boolean(existingSpec.exchange_tz), source: "canonical" }
      };
      return NextResponse.json(result);
    }
    
    // No existing spec, create default proposal
    let exchange_tz = "";
    let exchange = "";
    let source: "canonical" | "resolved" | "unknown" = "unknown";
    
    // Try to get TZ from canonical data first
    try {
      const canonicalResponse = await fetch(
        `${request.url.replace(`/target-spec/${symbol}`, '')}/canonical/${symbol}`,
        { method: 'GET' }
      );
      
      if (canonicalResponse.ok) {
        const canonicalData = await canonicalResponse.json();
        if (canonicalData.meta?.exchange_tz) {
          exchange_tz = canonicalData.meta.exchange_tz;
          exchange = canonicalData.meta.exchange || "";
          source = "canonical";
        }
      }
    } catch (error) {
      console.log('Could not fetch canonical data, trying calendar service');
    }
    
    // Fall back to calendar service if no TZ from canonical
    if (!exchange_tz) {
      try {
        const resolved = await resolveExchangeAndTZ(symbol);
        exchange_tz = resolved.tz;
        exchange = resolved.exchange;
        source = "resolved";
      } catch (error) {
        console.log('Could not resolve exchange/TZ via calendar service');
        source = "unknown";
      }
    }
    
    const defaultSpec: TargetSpec = {
      symbol,
      exchange: exchange || null,
      exchange_tz,
      h: 1,
      coverage: 0.95,
      variable: "NEXT_CLOSE_ADJ",
      cutoff_note: "compute at t close; verify at t+1 close",
      updated_at: new Date().toISOString()
    };
    
    const result: TargetSpecResult = {
      spec: defaultSpec,
      meta: { hasTZ: Boolean(exchange_tz), source }
    };
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error('Error in target spec GET:', error);
    return NextResponse.json(
      { error: 'Failed to get target spec' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = params.symbol;
    const body = await request.json();
    
    const { h, coverage, variable, cutoff_note } = body;
    
    // Validate inputs
    if (h < 1) {
      return NextResponse.json(
        { error: 'Horizon must be >= 1' },
        { status: 400 }
      );
    }
    
    if (coverage <= 0.50 || coverage > 0.995) {
      return NextResponse.json(
        { error: 'Coverage must be in range (0.50, 0.995]' },
        { status: 400 }
      );
    }
    
    // Get exchange_tz from canonical data or resolve it
    let exchange_tz = "";
    let exchange = "";
    
    // Try canonical data first
    try {
      const canonicalResponse = await fetch(
        `${request.url.replace(`/target-spec/${symbol}`, '')}/canonical/${symbol}`,
        { method: 'GET' }
      );
      
      if (canonicalResponse.ok) {
        const canonicalData = await canonicalResponse.json();
        if (canonicalData.meta?.exchange_tz) {
          exchange_tz = canonicalData.meta.exchange_tz;
          exchange = canonicalData.meta.exchange || "";
        }
      }
    } catch (error) {
      console.log('Could not fetch canonical data for POST');
    }
    
    // Fall back to calendar service
    if (!exchange_tz) {
      try {
        const resolved = await resolveExchangeAndTZ(symbol);
        exchange_tz = resolved.tz;
        exchange = resolved.exchange;
      } catch (error) {
        return NextResponse.json(
          { error: 'Exchange timezone not resolved. Upload canonical data or set primary listing.' },
          { status: 400 }
        );
      }
    }
    
    if (!exchange_tz) {
      return NextResponse.json(
        { error: 'Exchange timezone not resolved. Upload canonical data or set primary listing.' },
        { status: 400 }
      );
    }
    
    const targetSpec: TargetSpec = {
      symbol,
      exchange: exchange || null,
      exchange_tz,
      h,
      coverage,
      variable: variable || "NEXT_CLOSE_ADJ",
      cutoff_note: cutoff_note || "compute at t close; verify at t+1 close",
      updated_at: new Date().toISOString()
    };
    
    const savedSpec = await saveTargetSpec(targetSpec);
    
    return NextResponse.json(savedSpec);
    
  } catch (error) {
    console.error('Error in target spec POST:', error);
    return NextResponse.json(
      { error: 'Failed to save target spec' },
      { status: 500 }
    );
  }
}