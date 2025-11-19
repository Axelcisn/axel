import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

/**
 * CSV Export API
 * Exports canonical daily dataset as CSV for reproducibility and handoffs
 */

interface CanonicalRecord {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adj_close: number;
  volume: number;
  [key: string]: any; // Additional fields
}

/**
 * GET /api/export/canonical?symbol=AMD&format=csv
 * Export canonical daily dataset as CSV
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const symbol = url.searchParams.get('symbol')?.toUpperCase();
    const format = url.searchParams.get('format') || 'csv';
    const startDate = url.searchParams.get('startDate'); // YYYY-MM-DD
    const endDate = url.searchParams.get('endDate'); // YYYY-MM-DD

    if (!symbol) {
      return NextResponse.json(
        { error: 'Symbol is required' },
        { status: 400 }
      );
    }

    if (format !== 'csv') {
      return NextResponse.json(
        { error: 'Only CSV format is currently supported' },
        { status: 400 }
      );
    }

    // Read canonical data
    const canonicalPath = path.join(process.cwd(), 'data', 'canonical', `${symbol}.json`);
    
    let canonicalData: CanonicalRecord[];
    try {
      const fileContent = await fs.readFile(canonicalPath, 'utf-8');
      const jsonData = JSON.parse(fileContent);
      canonicalData = jsonData.data || jsonData; // Handle different JSON structures
    } catch (error) {
      return NextResponse.json(
        { error: `No canonical data found for symbol ${symbol}` },
        { status: 404 }
      );
    }

    // Validate data structure
    if (!Array.isArray(canonicalData) || canonicalData.length === 0) {
      return NextResponse.json(
        { error: `Invalid or empty canonical data for symbol ${symbol}` },
        { status: 422 }
      );
    }

    // Filter by date range if provided
    let filteredData = canonicalData;
    if (startDate || endDate) {
      filteredData = canonicalData.filter(record => {
        const recordDate = record.date;
        if (startDate && recordDate < startDate) return false;
        if (endDate && recordDate > endDate) return false;
        return true;
      });
    }

    if (filteredData.length === 0) {
      return NextResponse.json(
        { error: 'No data found in specified date range' },
        { status: 422 }
      );
    }

    // Sort by date to ensure consistent output
    filteredData.sort((a, b) => a.date.localeCompare(b.date));

    // Determine CSV headers from first record
    const firstRecord = filteredData[0];
    const csvHeaders = Object.keys(firstRecord);

    // Ensure standard fields are in proper order
    const standardHeaders = ['date', 'open', 'high', 'low', 'close', 'adj_close', 'volume'];
    const otherHeaders = csvHeaders.filter(h => !standardHeaders.includes(h));
    const orderedHeaders = [...standardHeaders.filter(h => csvHeaders.includes(h)), ...otherHeaders];

    // Generate CSV content
    const csvLines: string[] = [];
    
    // Header row
    csvLines.push(orderedHeaders.join(','));
    
    // Data rows
    for (const record of filteredData) {
      const row = orderedHeaders.map(header => {
        const value = record[header];
        
        // Handle different data types
        if (value === null || value === undefined) {
          return '';
        }
        
        if (typeof value === 'string') {
          // Escape quotes and wrap in quotes if contains comma
          if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        }
        
        return String(value);
      });
      
      csvLines.push(row.join(','));
    }

    const csvContent = csvLines.join('\n');

    // Generate filename
    const today = new Date().toISOString().split('T')[0];
    const startDateStr = startDate || filteredData[0].date;
    const endDateStr = endDate || filteredData[filteredData.length - 1].date;
    const filename = `${symbol}_canonical_${startDateStr}_to_${endDateStr}_exported_${today}.csv`;

    // Set response headers for file download
    const responseHeaders = new Headers({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': Buffer.byteLength(csvContent, 'utf8').toString()
    });

    return new NextResponse(csvContent, { headers: responseHeaders });

  } catch (error) {
    console.error('CSV export error:', error);
    return NextResponse.json(
      { error: 'Failed to export canonical data' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/export/canonical/info?symbol=AMD
 * Get export information (metadata) without downloading
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbol } = body;

    if (!symbol) {
      return NextResponse.json(
        { error: 'Symbol is required' },
        { status: 400 }
      );
    }

    // Read canonical data to get metadata
    const canonicalPath = path.join(process.cwd(), 'data', 'canonical', `${symbol.toUpperCase()}.json`);
    
    try {
      const fileContent = await fs.readFile(canonicalPath, 'utf-8');
      const jsonData = JSON.parse(fileContent);
      const canonicalData = jsonData.data || jsonData;

      if (!Array.isArray(canonicalData) || canonicalData.length === 0) {
        return NextResponse.json(
          { error: `No canonical data available for ${symbol}` },
          { status: 404 }
        );
      }

      // Sort to get date range
      const sortedData = [...canonicalData].sort((a, b) => a.date.localeCompare(b.date));
      const dateRange = {
        start: sortedData[0].date,
        end: sortedData[sortedData.length - 1].date
      };

      // Get available fields
      const sampleRecord = sortedData[0];
      const fields = Object.keys(sampleRecord);

      const metadata = {
        symbol: symbol.toUpperCase(),
        totalRecords: canonicalData.length,
        dateRange,
        fields,
        sampleData: sortedData.slice(0, 3), // First 3 records as preview
        exportReady: true
      };

      return NextResponse.json(metadata);

    } catch (error) {
      return NextResponse.json(
        { error: `No canonical data found for symbol ${symbol.toUpperCase()}` },
        { status: 404 }
      );
    }

  } catch (error) {
    console.error('Export info error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve export information' },
      { status: 500 }
    );
  }
}