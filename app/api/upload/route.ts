import { NextRequest, NextResponse } from 'next/server';
import { parseHistoricalPriceXlsx, parseHistoricalPriceCsv } from '@/lib/ingestion/excel';
import * as fs from 'fs';
import * as path from 'path';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    
    if (!ticker) {
      return NextResponse.json({ error: 'Ticker parameter required' }, { status: 400 });
    }

    const uploadsDir = path.join(process.cwd(), 'data', 'uploads');
    
    try {
      const files = await fs.promises.readdir(uploadsDir);
      const tickerFiles = files.filter(file => 
        file.toLowerCase().includes(ticker.toLowerCase()) && 
        (file.endsWith('.xlsx') || file.endsWith('.csv') || file.endsWith('.xls'))
      );
      
      if (tickerFiles.length > 0) {
        return NextResponse.json({ hasUploads: true, files: tickerFiles });
      } else {
        return NextResponse.json({ hasUploads: false, files: [] });
      }
    } catch (error) {
      // Directory doesn't exist or is inaccessible
      return NextResponse.json({ hasUploads: false, files: [] });
    }
  } catch (error) {
    console.error('Error checking uploads:', error);
    return NextResponse.json(
      { error: 'Failed to check uploads' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const fd = await req.formData();
    const file = fd.get("file") as File | null;
    
    if (!file) {
      return NextResponse.json({ 
        ok: false, 
        rows: [], 
        error: "Missing file" 
      }, { status: 400 });
    }

    let rows: any[] = [];
    
    if (file.name.toLowerCase().endsWith(".xlsx")) {
      const ab = await file.arrayBuffer();
      rows = parseHistoricalPriceXlsx(ab);
    } else if (file.name.toLowerCase().endsWith(".csv")) {
      const text = await file.text();
      rows = await parseHistoricalPriceCsv(text);
    } else {
      return NextResponse.json({ 
        ok: false, 
        rows: [], 
        error: "Unsupported file type. Use .xlsx or .csv" 
      }, { status: 415 });
    }

    // Ensure we always return an array
    if (!Array.isArray(rows)) {
      rows = [];
    }

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return NextResponse.json({ 
      ok: false, 
      rows: [], 
      error: `Upload failed: ${e?.message ?? "unknown error"}` 
    }, { status: 400 });
  }
}