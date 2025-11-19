import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = params.symbol;
    const uploadsDir = path.join(process.cwd(), 'data', 'uploads');
    
    console.log(`[UPLOADS API] Looking for ${symbol} files in:`, uploadsDir);
    
    // Find the most recent upload file for this symbol
    const files = fs.readdirSync(uploadsDir);
    console.log(`[UPLOADS API] All files:`, files);
    
    const symbolFiles = files
      .filter(file => file.includes(symbol) && (file.endsWith('.xlsx') || file.endsWith('.csv')))
      .sort()
      .reverse(); // Get most recent first
    
    console.log(`[UPLOADS API] Files for ${symbol}:`, symbolFiles);
    
    if (symbolFiles.length === 0) {
      console.log(`[UPLOADS API] No files found for ${symbol}`);
      return NextResponse.json(
        { error: 'No uploaded data found for symbol' },
        { status: 404 }
      );
    }
    
    const filePath = path.join(uploadsDir, symbolFiles[0]);
    console.log(`[UPLOADS API] Using file:`, filePath);
    
    let data: any[] = [];
    
    // First try to determine if it's actually CSV content regardless of extension
    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const firstLine = fileContent.split('\n')[0];
      
      // Check if it looks like CSV (has commas and typical headers)
      if (firstLine.includes(',') && (firstLine.includes('Date') || firstLine.includes('Open'))) {
        console.log(`[UPLOADS API] File appears to be CSV format`);
        
        // Handle as CSV
        const lines = fileContent.split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        console.log(`[UPLOADS API] CSV Headers:`, headers);
        
        data = lines.slice(1)
          .filter(line => line.trim())
          .map(line => {
            const values = line.split(',');
            const row: any = {};
            headers.forEach((header, index) => {
              row[header] = values[index]?.trim();
            });
            return row;
          });
          
      } else if (symbolFiles[0].endsWith('.xlsx')) {
        console.log(`[UPLOADS API] Attempting to read as Excel file`);
        // Handle Excel file
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        data = XLSX.utils.sheet_to_json(worksheet);
      }
      
      console.log(`[UPLOADS API] Parsed ${data.length} rows`);
      console.log(`[UPLOADS API] Sample row:`, data[0]);
      
    } catch (readError) {
      console.error(`[UPLOADS API] Error reading file:`, readError);
      throw readError;
    }
    
    console.log(`[UPLOADS API] Raw data length:`, data.length);
    console.log(`[UPLOADS API] Raw data sample:`, data.slice(0, 2));
    
    // Normalize the data to match expected format
    const normalizedData = data
      .filter(row => row.Date && row.Open && row.High && row.Low && row.Close)
      .map(row => ({
        date: formatDate(row.Date),
        open: parseFloat(row.Open),
        high: parseFloat(row.High),
        low: parseFloat(row.Low),
        close: parseFloat(row.Close),
        adj_close: row['Adj. Close'] ? parseFloat(row['Adj. Close']) : parseFloat(row.Close),
        volume: row.Volume ? parseFloat(row.Volume.replace(/,/g, '')) : null,
        valid: true
      }))
      .filter(row => !isNaN(row.open) && !isNaN(row.high) && !isNaN(row.low) && !isNaN(row.close))
      .sort((a, b) => a.date.localeCompare(b.date));
    
    console.log(`[UPLOADS API] Normalized data length:`, normalizedData.length);
    console.log(`[UPLOADS API] Normalized sample:`, normalizedData.slice(0, 2));
    
    return NextResponse.json({
      rows: normalizedData,
      meta: {
        symbol: symbol,
        source: 'upload',
        filename: symbolFiles[0],
        rows: normalizedData.length,
        generated_at: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('[UPLOADS API] Error loading uploaded data:', error);
    return NextResponse.json(
      { error: 'Failed to load uploaded data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// Helper function to format date to YYYY-MM-DD
function formatDate(dateStr: string): string {
  try {
    // Handle different date formats
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      // Try parsing as MM/DD/YYYY or other formats
      const parts = dateStr.split(/[-\/]/);
      if (parts.length === 3) {
        // Assume MM/DD/YYYY if first part <= 12
        if (parseInt(parts[0]) <= 12) {
          const reformatted = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
          return reformatted;
        } else {
          // Assume YYYY-MM-DD or DD/MM/YYYY
          return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        }
      }
    }
    
    return date.toISOString().split('T')[0];
  } catch (error) {
    console.error('Error formatting date:', dateStr, error);
    return dateStr;
  }
}