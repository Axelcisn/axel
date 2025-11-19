import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

/**
 * GET /api/audit/repairs?symbol=AMD&hash=<sha>
 * Get specific repairs for a file hash
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const symbol = url.searchParams.get('symbol');
    const hash = url.searchParams.get('hash');

    if (!symbol) {
      return NextResponse.json(
        { error: 'Symbol is required' },
        { status: 400 }
      );
    }

    // Try to load actual repairs if available
    if (hash) {
      try {
        const repairsPath = path.join(process.cwd(), 'data', 'audit', `repairs-${symbol}.json`);
        const repairsData = JSON.parse(await fs.readFile(repairsPath, 'utf-8'));
        
        // Filter repairs by hash if specified
        const filteredRepairs = repairsData.repairs?.filter((repair: any) => 
          repair.fileHash === hash || !repair.fileHash
        ) || [];

        return NextResponse.json({
          symbol,
          fileHash: hash,
          repairs: filteredRepairs
        });
      } catch (fileError) {
        // Fall through to mock data if file not found
      }
    }

    // Mock repairs data for demo
    const mockRepairs = [
      {
        id: 'repair-001',
        date: '2024-03-15',
        field: 'high',
        oldValue: '150.25',
        newValue: '149.85',
        reason: 'OHLC coherence: high < close violation corrected',
        confidence: 0.95,
        method: 'interpolation',
        timestamp: '2024-11-10T14:30:15.000Z'
      },
      {
        id: 'repair-002', 
        date: '2024-07-22',
        field: 'volume',
        oldValue: '0',
        newValue: '2450000',
        reason: 'Zero volume replaced with 5-day average',
        confidence: 0.78,
        method: 'statistical_imputation',
        timestamp: '2024-11-10T14:30:16.000Z'
      },
      {
        id: 'repair-003',
        date: '2024-09-03',
        field: 'adj_close',
        oldValue: '142.50',
        newValue: '71.25',
        reason: 'Stock split adjustment (2:1) applied retroactively',
        confidence: 0.99,
        method: 'corporate_action',
        timestamp: '2024-11-10T14:30:17.000Z'
      }
    ];

    return NextResponse.json({
      symbol,
      fileHash: hash || 'unknown',
      repairs: mockRepairs
    });

  } catch (error) {
    console.error('Repairs error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve repairs data' },
      { status: 500 }
    );
  }
}