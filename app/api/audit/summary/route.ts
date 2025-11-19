import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

/**
 * GET /api/audit/summary?symbol=AMD
 * Get audit summary for EnhancedRepairsPanel
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const symbol = url.searchParams.get('symbol');

    if (!symbol) {
      return NextResponse.json(
        { error: 'Symbol is required' },
        { status: 400 }
      );
    }

    // Mock audit summary data for demo
    const mockSummary = {
      symbol,
      totalUploads: 12,
      dateRange: { start: '2020-01-02', end: '2024-11-08' },
      dataQuality: {
        averageQualityScore: 0.923,
        totalRepairs: 47,
        commonIssues: [
          { issue: 'OHLC coherence violations', count: 23 },
          { issue: 'Missing volume data', count: 12 },
          { issue: 'Date formatting inconsistencies', count: 8 },
          { issue: 'Outlier price movements', count: 4 }
        ]
      },
      vendors: [
        { vendor: 'yahoo', uploads: 7, lastUpload: '2024-11-08T16:30:00.000Z' },
        { vendor: 'bloomberg', uploads: 3, lastUpload: '2024-10-15T10:15:00.000Z' },
        { vendor: 'refinitiv', uploads: 1, lastUpload: '2024-09-20T14:45:00.000Z' },
        { vendor: 'unknown', uploads: 1, lastUpload: '2024-08-10T11:30:00.000Z' }
      ],
      recentActivity: [
        {
          id: `prov-${symbol}-recent-1`,
          symbol,
          uploadedAt: '2024-11-08T16:30:00.000Z',
          fileInfo: {
            originalName: `${symbol}-latest.xlsx`,
            fileHash: 'abc123def456789',
            sizeBytes: 1024 * 768
          },
          vendor: {
            name: 'yahoo',
            detectedFrom: 'filename pattern',
            confidence: 0.96
          },
          processing: {
            headerMappings: {
              'Date': 'date',
              'Open': 'open',
              'High': 'high',
              'Low': 'low',
              'Close': 'close',
              'Adj Close': 'adj_close',
              'Volume': 'volume'
            },
            rowsProcessed: 3021,
            rowsAccepted: 3018,
            rowsRejected: 3,
            dateRange: { start: '2012-05-18', end: '2024-11-08' }
          },
          validation: {
            validationPassed: true,
            warnings: ['3 rows with minor OHLC discrepancies'],
            errors: [],
            qualityScore: 0.994
          },
          transformations: {
            appliedRepairs: 2,
            computedFields: ['log_returns', 'volatility_estimate'],
            normalizations: ['price_scaling']
          }
        }
      ]
    };

    return NextResponse.json(mockSummary);

  } catch (error) {
    console.error('Audit summary error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve audit summary' },
      { status: 500 }
    );
  }
}