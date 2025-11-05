import { NextRequest, NextResponse } from 'next/server';
import { ingestExcel } from '@/lib/ingestion/pipeline';

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