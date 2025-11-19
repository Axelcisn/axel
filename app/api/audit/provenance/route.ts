import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

/**
 * GET /api/audit/provenance?symbol=AMD
 * Get provenance information for audit trail
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

    // Mock provenance data for now - in real implementation this would come from database
    const mockProvenance = [
      {
        id: `prov-${symbol}-1`,
        symbol,
        uploadedAt: '2024-11-10T14:30:00.000Z',
        fileInfo: {
          originalName: `${symbol}-history-v2.xlsx`,
          fileHash: 'a1b2c3d4e5f6789012345678',
          sizeBytes: 1024 * 512 // 512KB
        },
        vendor: {
          name: 'yahoo',
          detectedFrom: 'filename pattern',
          confidence: 0.95
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
          rowsProcessed: 2547,
          rowsAccepted: 2545,
          rowsRejected: 2,
          dateRange: { start: '2014-01-02', end: '2024-11-08' }
        },
        validation: {
          validationPassed: true,
          warnings: ['2 missing trading days detected'],
          errors: [],
          qualityScore: 0.987
        },
        transformations: {
          appliedRepairs: 3,
          computedFields: ['log_returns', 'volatility_estimate'],
          normalizations: ['price_scaling', 'volume_normalization']
        }
      },
      {
        id: `prov-${symbol}-2`,
        symbol,
        uploadedAt: '2024-11-09T09:15:00.000Z',
        fileInfo: {
          originalName: `${symbol}-daily-data.xlsx`,
          fileHash: 'f9e8d7c6b5a4321098765432',
          sizeBytes: 1024 * 256 // 256KB
        },
        vendor: {
          name: 'bloomberg',
          detectedFrom: 'column headers',
          confidence: 0.87
        },
        processing: {
          headerMappings: {
            'Date': 'date',
            'PX_OPEN': 'open',
            'PX_HIGH': 'high', 
            'PX_LOW': 'low',
            'PX_LAST': 'close',
            'PX_LAST_ADJ': 'adj_close',
            'PX_VOLUME': 'volume'
          },
          rowsProcessed: 1205,
          rowsAccepted: 1201,
          rowsRejected: 4,
          dateRange: { start: '2019-03-15', end: '2024-11-08' }
        },
        validation: {
          validationPassed: false,
          warnings: ['Non-standard date format detected'],
          errors: ['OHLC coherence violations in 4 rows'],
          qualityScore: 0.832
        },
        transformations: {
          appliedRepairs: 7,
          computedFields: ['log_returns'],
          normalizations: ['date_formatting']
        }
      }
    ];

    return NextResponse.json(mockProvenance);

  } catch (error) {
    console.error('Provenance error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve provenance data' },
      { status: 500 }
    );
  }
}