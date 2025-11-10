import { NextRequest, NextResponse } from 'next/server';
import { ingestExcel } from '@/lib/ingestion/pipeline';
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

export async function POST(request: NextRequest) {
  try {
    // Parse multipart/form-data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const symbol = formData.get('symbol') as string;
    const exchange = formData.get('exchange') as string;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided', detail: 'File is required' },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // Process through ingestion pipeline
    const result = await ingestExcel({
      fileBuffer,
      symbol: symbol || undefined,
      exchange: exchange || undefined
    });

    return NextResponse.json(result, { status: 200 });

  } catch (error) {
    console.error('Upload error:', error);
    
    return NextResponse.json(
      { 
        error: 'Ingestion failed', 
        detail: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}