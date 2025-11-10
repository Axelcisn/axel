import { NextRequest, NextResponse } from 'next/server';
import { globalGates } from '@/lib/validation/gates';

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const gates = await globalGates(params.symbol);
    return NextResponse.json(gates);
  } catch (error) {
    console.error('Gates validation error:', error);
    return NextResponse.json({ 
      error: 'Gates validation failed', 
      details: error instanceof Error ? error.message : String(error) 
    }, { status: 500 });
  }
}