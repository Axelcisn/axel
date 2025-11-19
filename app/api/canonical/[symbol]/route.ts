import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = params.symbol;
    const canonicalPath = path.join(process.cwd(), 'data', 'canonical', `${symbol}.json`);
    
    try {
      const content = await fs.promises.readFile(canonicalPath, 'utf-8');
      const data = JSON.parse(content);
      
      // Include row count in the response
      const meta = data.meta || {};
      const rowCount = data.rows ? data.rows.length : 0;
      
      return NextResponse.json({ 
        meta: {
          ...meta,
          rows: rowCount
        }
      });
    } catch (error) {
      // File doesn't exist or is invalid
      return NextResponse.json({ meta: null });
    }
  } catch (error) {
    console.error('Error reading canonical data:', error);
    return NextResponse.json(
      { error: 'Failed to read canonical data' },
      { status: 500 }
    );
  }
}