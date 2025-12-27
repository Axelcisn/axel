import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import * as path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATA_ROOT = process.env.NODE_ENV === 'production' 
  ? '/tmp/data' 
  : path.join(process.cwd(), 'data');
const FORECASTS_DIR = path.join(DATA_ROOT, 'forecasts');

interface CleanupRequest {
  symbol: string;
  fileIds: string[];
}

export async function GET() {
  return NextResponse.json(
    { status: 'ok' },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
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
    try {
      await fs.stat(symbolDir);
    } catch {
      return NextResponse.json(
        { error: `Symbol directory not found: ${symbol}` },
        { status: 404 }
      );
    }

    // Read directory ONCE and find all files to delete
    const allFiles = await fs.readdir(symbolDir);
    
    // Build set of files to delete based on fileIds
    const filesToDelete = allFiles.filter(file => 
      fileIds.some(fileId => file.includes(fileId)) &&
      path.extname(file) === '.json'
    );

    const deletedFiles: string[] = [];
    const failedFiles: string[] = [];

    // Delete all matching files in parallel
    await Promise.all(
      filesToDelete.map(async (file) => {
        const filePath = path.join(symbolDir, file);
        try {
          // Safety check - only delete files in forecasts directory
          if (filePath.includes('forecasts')) {
            await fs.unlink(filePath);
            deletedFiles.push(file);
            console.log(`[Cleanup] Deleted forecast file: ${file}`);
          }
        } catch (err) {
          console.error(`[Cleanup] Failed to delete file ${file}:`, err);
          failedFiles.push(file);
        }
      })
    );

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
    
    // Check if symbol directory exists
    try {
      await fs.stat(symbolDir);
    } catch {
      return NextResponse.json(
        { error: `Symbol directory not found: ${symbol}` },
        { status: 404 }
      );
    }

    const allFiles = await fs.readdir(symbolDir);
    const deletedFiles: string[] = [];

    // Filter files based on pattern and extension
    const filesToDelete = allFiles.filter(file => {
      if (pattern && !file.includes(pattern)) return false;
      return path.extname(file) === '.json';
    });

    // Delete files in parallel
    await Promise.all(
      filesToDelete.map(async (file) => {
        const filePath = path.join(symbolDir, file);
        try {
          await fs.unlink(filePath);
          deletedFiles.push(file);
          console.log(`[Cleanup] Deleted forecast file: ${file}`);
        } catch (err) {
          console.error(`[Cleanup] Failed to delete ${file}:`, err);
        }
      })
    );

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
