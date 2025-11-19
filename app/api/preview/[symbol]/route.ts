import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

/**
 * GET /api/preview/[symbol]?hash=<file_hash>
 * Get preview data (first/last 5 rows + gaps) for uploaded data
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = params.symbol;
    const url = new URL(request.url);
    const fileHash = url.searchParams.get('hash');

    if (!symbol) {
      return NextResponse.json(
        { error: 'Symbol is required' },
        { status: 400 }
      );
    }

    // Load canonical data
    const canonicalPath = path.join(process.cwd(), 'data', 'canonical', `${symbol}.json`);
    
    try {
      await fs.access(canonicalPath);
    } catch {
      return NextResponse.json(
        { error: 'No canonical data found for symbol' },
        { status: 404 }
      );
    }

    const canonicalData = JSON.parse(await fs.readFile(canonicalPath, 'utf-8'));
    
    if (!canonicalData.data || !Array.isArray(canonicalData.data)) {
      return NextResponse.json(
        { error: 'Invalid canonical data format' },
        { status: 500 }
      );
    }

    const data = canonicalData.data;
    
    // Get first and last 5 rows
    const head = data.slice(0, 5);
    const tail = data.length > 5 ? data.slice(-5) : [];

    // Generate mock gaps for demo (in real implementation, this would come from validation)
    const gaps = [];
    
    // Mock some missing days based on data
    if (data.length > 10) {
      // Find some date gaps (simplified logic for demo)
      for (let i = 1; i < Math.min(data.length, 20); i++) {
        const prevDate = new Date(data[i-1].date);
        const currDate = new Date(data[i].date);
        const daysDiff = Math.floor((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysDiff > 3) { // More than 3 days gap
          const startDate = new Date(prevDate);
          startDate.setDate(startDate.getDate() + 1);
          const endDate = new Date(currDate);
          endDate.setDate(endDate.getDate() - 1);
          
          gaps.push({
            start: startDate.toISOString().split('T')[0],
            end: daysDiff > 4 ? endDate.toISOString().split('T')[0] : undefined,
            days: daysDiff - 1,
            severity: daysDiff > 7 ? 'warn' : 'info'
          });
        }
      }
    }

    return NextResponse.json({
      head: head.map((row: any) => ({
        date: row.date,
        open: row.open?.toFixed(2) || 'N/A',
        high: row.high?.toFixed(2) || 'N/A', 
        low: row.low?.toFixed(2) || 'N/A',
        close: row.close?.toFixed(2) || 'N/A',
        adj_close: row.adj_close?.toFixed(2) || 'N/A',
        volume: row.volume?.toLocaleString() || 'N/A'
      })),
      tail: tail.map((row: any) => ({
        date: row.date,
        open: row.open?.toFixed(2) || 'N/A',
        high: row.high?.toFixed(2) || 'N/A',
        low: row.low?.toFixed(2) || 'N/A', 
        close: row.close?.toFixed(2) || 'N/A',
        adj_close: row.adj_close?.toFixed(2) || 'N/A',
        volume: row.volume?.toLocaleString() || 'N/A'
      })),
      gaps
    });

  } catch (error) {
    console.error('Preview error:', error);
    return NextResponse.json(
      { error: 'Failed to generate preview' },
      { status: 500 }
    );
  }
}