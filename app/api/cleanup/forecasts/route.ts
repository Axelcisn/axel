import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

const DATA_ROOT = process.env.NODE_ENV === 'production' 
  ? '/tmp/data' 
  : path.join(process.cwd(), 'data');
const FORECASTS_DIR = path.join(DATA_ROOT, 'forecasts');

interface CleanupRequest {
  symbol: string;
  fileIds: string[];
}

/**
 * POST /api/cleanup/forecasts
 * Delete specific forecast files by file IDs
 */
export async function POST(request: NextRequest) {
  try {
    const body: CleanupRequest = await request.json();
    const { symbol, fileIds } = body;

    if (!symbol || !Array.isArray(fileIds)) {
      return NextResponse.json(
        { error: 'Invalid request. Symbol and fileIds array required.' },
        { status: 400 }
      );
    }

    const symbolDir = path.join(FORECASTS_DIR, symbol);
    
    // Check if symbol directory exists
    if (!fs.existsSync(symbolDir)) {
      return NextResponse.json(
        { error: `Symbol directory not found: ${symbol}` },
        { status: 404 }
      );
    }

    const deletedFiles: string[] = [];
    const failedFiles: string[] = [];

    for (const fileId of fileIds) {
      try {
        // Find files that match the fileId pattern
        const files = fs.readdirSync(symbolDir);
        const matchingFiles = files.filter(file => file.includes(fileId));

        for (const file of matchingFiles) {
          const filePath = path.join(symbolDir, file);
          
          // Safety check - only delete .json files in forecasts directory
          if (path.extname(file) === '.json' && filePath.includes('forecasts')) {
            fs.unlinkSync(filePath);
            deletedFiles.push(file);
            console.log(`[Cleanup] Deleted forecast file: ${file}`);
          }
        }
      } catch (err) {
        console.error(`[Cleanup] Failed to delete files for ID ${fileId}:`, err);
        failedFiles.push(fileId);
      }
    }

    return NextResponse.json({
      success: true,
      deletedFiles,
      failedFiles,
      message: `Deleted ${deletedFiles.length} files, ${failedFiles.length} failures`
    });

  } catch (error) {
    console.error('[Cleanup] API error:', error);
    return NextResponse.json(
      { error: 'Internal server error during cleanup' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/cleanup/forecasts?symbol=AAPL&pattern=2025-11-28
 * Delete all forecast files matching a date pattern for a symbol
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const pattern = searchParams.get('pattern');

    if (!symbol) {
      return NextResponse.json(
        { error: 'Symbol parameter required' },
        { status: 400 }
      );
    }

    const symbolDir = path.join(FORECASTS_DIR, symbol);
    
    if (!fs.existsSync(symbolDir)) {
      return NextResponse.json(
        { error: `Symbol directory not found: ${symbol}` },
        { status: 404 }
      );
    }

    const files = fs.readdirSync(symbolDir);
    const deletedFiles: string[] = [];

    for (const file of files) {
      // If pattern is provided, only delete files matching the pattern
      if (pattern && !file.includes(pattern)) {
        continue;
      }

      // Only delete .json forecast files
      if (path.extname(file) === '.json') {
        const filePath = path.join(symbolDir, file);
        try {
          fs.unlinkSync(filePath);
          deletedFiles.push(file);
          console.log(`[Cleanup] Deleted forecast file: ${file}`);
        } catch (err) {
          console.error(`[Cleanup] Failed to delete ${file}:`, err);
        }
      }
    }

    return NextResponse.json({
      success: true,
      deletedFiles,
      message: `Deleted ${deletedFiles.length} forecast files`
    });

  } catch (error) {
    console.error('[Cleanup] DELETE API error:', error);
    return NextResponse.json(
      { error: 'Internal server error during cleanup' },
      { status: 500 }
    );
  }
}