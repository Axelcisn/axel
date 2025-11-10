import { NextRequest, NextResponse } from 'next/server';
import { loadRepairs } from '@/lib/storage/fsStore';

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const { symbol } = params;
    
    const repairs = await loadRepairs(symbol);
    
    return NextResponse.json(repairs);
  } catch (error) {
    console.error('Failed to load repairs:', error);
    return NextResponse.json(
      { error: 'Failed to load repairs' },
      { status: 500 }
    );
  }
}