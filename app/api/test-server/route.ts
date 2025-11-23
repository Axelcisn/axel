import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ status: 'server working', timestamp: new Date().toISOString() });
}