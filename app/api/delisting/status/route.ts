import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

/**
 * Delisting Status API
 * Provides information about security delisting status
 */

interface DelistingInfo {
  symbol: string;
  status: 'active' | 'delisted' | 'suspended' | 'pending_delisting';
  delistingDate?: string; // YYYY-MM-DD
  reason?: string;
  exchange: string;
  lastTradingDate?: string;
  warnings: string[];
  manualOverride?: {
    overridden: boolean;
    overrideDate: string;
    overrideReason: string;
    overriddenBy: string;
  };
}

interface DelistingDatabase {
  [symbol: string]: DelistingInfo;
}

// Mock delisting database for demo purposes
const mockDelistingData: DelistingDatabase = {
  'AMD': {
    symbol: 'AMD',
    status: 'active',
    exchange: 'NASDAQ',
    warnings: []
  },
  'PLTR': {
    symbol: 'PLTR', 
    status: 'active',
    exchange: 'NYSE',
    warnings: []
  },
  // Example delisted stock
  'ENRN': {
    symbol: 'ENRN',
    status: 'delisted',
    delistingDate: '2001-12-02',
    reason: 'Bankruptcy and accounting fraud',
    exchange: 'NYSE',
    lastTradingDate: '2001-11-30',
    warnings: [
      'Security was delisted due to bankruptcy',
      'Historical data may be incomplete',
      'Corporate actions data may be unreliable'
    ]
  },
  // Example suspended stock
  'ZOOM': {
    symbol: 'ZOOM',
    status: 'suspended',
    reason: 'Trading halt pending news',
    exchange: 'NASDAQ',
    warnings: [
      'Trading currently suspended',
      'Data updates may be delayed'
    ]
  },
  // Example pending delisting
  'ACME': {
    symbol: 'ACME',
    status: 'pending_delisting',
    reason: 'Non-compliance with listing requirements',
    exchange: 'NASDAQ',
    warnings: [
      'Pending delisting notification received',
      'May be delisted within 180 days if requirements not met'
    ]
  }
};

/**
 * GET /api/delisting/status?symbol=AMD
 * Get delisting status for a symbol
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const symbol = url.searchParams.get('symbol')?.toUpperCase();

    if (!symbol) {
      return NextResponse.json(
        { error: 'Symbol is required' },
        { status: 400 }
      );
    }

    // Check for user overrides first
    const overridesPath = path.join(process.cwd(), 'data', 'delisting-overrides', `${symbol}.json`);
    let userOverride = null;

    try {
      const overrideData = await fs.readFile(overridesPath, 'utf-8');
      userOverride = JSON.parse(overrideData);
    } catch (error) {
      // No override file, that's fine
    }

    // Get base delisting info (mock data for demo)
    let delistingInfo = mockDelistingData[symbol] || {
      symbol,
      status: 'active' as const,
      exchange: 'UNKNOWN',
      warnings: []
    };

    // Apply user override if exists
    if (userOverride) {
      delistingInfo = {
        ...delistingInfo,
        manualOverride: userOverride
      };
    }

    // Add additional warnings based on status
    if (delistingInfo.status === 'delisted') {
      delistingInfo.warnings = [
        ...delistingInfo.warnings,
        'Historical analysis may be affected by delisting',
        'Consider data quality implications for modeling'
      ];
    }

    return NextResponse.json(delistingInfo);

  } catch (error) {
    console.error('Delisting status error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve delisting status' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/delisting/status
 * Set manual override for delisting status
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbol, overrideReason, overriddenBy } = body;

    if (!symbol || !overrideReason) {
      return NextResponse.json(
        { error: 'Symbol and override reason are required' },
        { status: 400 }
      );
    }

    // Create override record
    const override = {
      overridden: true,
      overrideDate: new Date().toISOString().split('T')[0],
      overrideReason,
      overriddenBy: overriddenBy || 'unknown_user'
    };

    // Ensure directory exists
    const overridesDir = path.join(process.cwd(), 'data', 'delisting-overrides');
    try {
      await fs.mkdir(overridesDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    // Save override
    const overridesPath = path.join(overridesDir, `${symbol}.json`);
    await fs.writeFile(overridesPath, JSON.stringify(override, null, 2));

    // Return updated status
    let delistingInfo = mockDelistingData[symbol] || {
      symbol,
      status: 'active' as const,
      exchange: 'UNKNOWN',
      warnings: []
    };

    delistingInfo.manualOverride = override;

    return NextResponse.json({
      success: true,
      message: 'Manual override applied successfully',
      delistingInfo
    });

  } catch (error) {
    console.error('Delisting override error:', error);
    return NextResponse.json(
      { error: 'Failed to apply manual override' },
      { status: 500 }
    );
  }
}