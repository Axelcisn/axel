import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

/**
 * Corporate Actions API
 * Handles upload and processing of corporate actions data
 */

interface CorporateAction {
  date: string; // YYYY-MM-DD
  type: 'split' | 'dividend' | 'spinoff' | 'merger';
  ratio?: number; // For splits (e.g., 2.0 for 2:1 split)
  amount?: number; // For dividends ($ amount)
  description: string;
  exDate?: string; // Ex-dividend/ex-split date
  payableDate?: string; // Payment date for dividends
  recordDate?: string; // Record date
}

interface CorporateActionsUploadResult {
  ok: boolean;
  symbol: string;
  actions: CorporateAction[];
  conflicts: Array<{
    date: string;
    existing: CorporateAction;
    incoming: CorporateAction;
    resolution: 'overwrite' | 'skip' | 'manual';
  }>;
  summary: {
    totalActions: number;
    newActions: number;
    conflictActions: number;
    splits: number;
    dividends: number;
    other: number;
  };
}

/**
 * POST /api/corporate-actions
 * Upload and process corporate actions file
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const symbol = formData.get('symbol') as string;
    const conflictResolution = formData.get('conflictResolution') as 'overwrite' | 'skip' | 'manual' || 'manual';

    if (!file || !symbol) {
      return NextResponse.json(
        { error: 'File and symbol are required' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.csv')) {
      return NextResponse.json(
        { error: 'Only .xlsx and .csv files are supported' },
        { status: 400 }
      );
    }

    // For demo purposes, return mock corporate actions data
    const mockActions: CorporateAction[] = [
      {
        date: '2024-05-15',
        type: 'dividend',
        amount: 0.25,
        description: 'Quarterly Cash Dividend',
        exDate: '2024-05-13',
        payableDate: '2024-05-30',
        recordDate: '2024-05-14'
      },
      {
        date: '2024-08-14',
        type: 'dividend',
        amount: 0.25,
        description: 'Quarterly Cash Dividend',
        exDate: '2024-08-12',
        payableDate: '2024-08-29',
        recordDate: '2024-08-13'
      },
      {
        date: '2023-11-20',
        type: 'split',
        ratio: 2.0,
        description: '2-for-1 Stock Split',
        exDate: '2023-11-20'
      },
      {
        date: '2024-11-13',
        type: 'dividend',
        amount: 0.25,
        description: 'Quarterly Cash Dividend',
        exDate: '2024-11-11',
        payableDate: '2024-11-28',
        recordDate: '2024-11-12'
      }
    ];

    // Check for existing corporate actions (mock)
    const existingActionsPath = path.join(process.cwd(), 'data', 'corporate-actions', `${symbol}.json`);
    let existingActions: CorporateAction[] = [];

    try {
      const existingData = await fs.readFile(existingActionsPath, 'utf-8');
      existingActions = JSON.parse(existingData);
    } catch (error) {
      // File doesn't exist, that's fine
      existingActions = [];
    }

    // Detect conflicts
    const conflicts: any[] = [];
    const newActions: CorporateAction[] = [];

    for (const action of mockActions) {
      const existing = existingActions.find(e => e.date === action.date && e.type === action.type);
      if (existing) {
        conflicts.push({
          date: action.date,
          existing,
          incoming: action,
          resolution: conflictResolution
        });
      } else {
        newActions.push(action);
      }
    }

    // Calculate summary
    const summary = {
      totalActions: mockActions.length,
      newActions: newActions.length,
      conflictActions: conflicts.length,
      splits: mockActions.filter(a => a.type === 'split').length,
      dividends: mockActions.filter(a => a.type === 'dividend').length,
      other: mockActions.filter(a => a.type !== 'split' && a.type !== 'dividend').length
    };

    // If there are conflicts and resolution is manual, return them for user decision
    if (conflicts.length > 0 && conflictResolution === 'manual') {
      return NextResponse.json({
        ok: false,
        requiresResolution: true,
        symbol,
        conflicts,
        summary,
        pendingActions: newActions
      });
    }

    // Save corporate actions (mock save)
    const allActions = [...newActions];
    if (conflictResolution === 'overwrite') {
      // Add overwritten actions
      allActions.push(...conflicts.map(c => c.incoming));
    }
    // If 'skip', we just don't add the conflicting actions

    // Ensure directory exists
    const corporateActionsDir = path.join(process.cwd(), 'data', 'corporate-actions');
    try {
      await fs.mkdir(corporateActionsDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    // Save to file (mock)
    await fs.writeFile(
      existingActionsPath,
      JSON.stringify([...existingActions.filter(e => !conflicts.some(c => c.date === e.date && c.type === e.type)), ...allActions], null, 2)
    );

    const result: CorporateActionsUploadResult = {
      ok: true,
      symbol,
      actions: allActions,
      conflicts: conflicts.map(c => ({ ...c, resolution: conflictResolution })),
      summary
    };

    return NextResponse.json(result);

  } catch (error) {
    console.error('Corporate actions upload error:', error);
    return NextResponse.json(
      { error: 'Failed to process corporate actions file' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/corporate-actions?symbol=AMD
 * Get existing corporate actions for a symbol
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

    // Try to read existing corporate actions
    const corporateActionsPath = path.join(process.cwd(), 'data', 'corporate-actions', `${symbol}.json`);
    
    try {
      const data = await fs.readFile(corporateActionsPath, 'utf-8');
      const actions = JSON.parse(data);
      
      return NextResponse.json({
        symbol,
        actions,
        count: actions.length
      });
    } catch (error) {
      // Return empty if file doesn't exist
      return NextResponse.json({
        symbol,
        actions: [],
        count: 0
      });
    }

  } catch (error) {
    console.error('Get corporate actions error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve corporate actions' },
      { status: 500 }
    );
  }
}