import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

// Column mapping interface
interface ColumnMapping {
  id: string;
  name: string;
  vendor: 'yahoo' | 'bloomberg' | 'refinitiv' | 'unknown';
  map: Record<string, string>; // source_column -> canonical_field
  created_at: string;
  updated_at: string;
}

const MAPPINGS_DIR = path.join(process.cwd(), 'data', 'mappings');

/**
 * GET /api/mappings?vendor=yahoo
 * Retrieve saved column mappings, optionally filtered by vendor
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const vendor = url.searchParams.get('vendor');

    // Ensure mappings directory exists
    try {
      await fs.access(MAPPINGS_DIR);
    } catch {
      await fs.mkdir(MAPPINGS_DIR, { recursive: true });
      return NextResponse.json([]);
    }

    const files = await fs.readdir(MAPPINGS_DIR);
    const mappings: ColumnMapping[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = await fs.readFile(path.join(MAPPINGS_DIR, file), 'utf-8');
          const mapping: ColumnMapping = JSON.parse(content);
          
          // Filter by vendor if specified
          if (!vendor || mapping.vendor === vendor) {
            mappings.push(mapping);
          }
        } catch (error) {
          console.warn(`Failed to parse mapping file ${file}:`, error);
        }
      }
    }

    // Sort by updated_at descending
    mappings.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

    return NextResponse.json(mappings);
  } catch (error) {
    console.error('Failed to load mappings:', error);
    return NextResponse.json(
      { error: 'Failed to load mappings' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mappings
 * Save a new column mapping
 * Body: { "name": "yahoo-v1", "vendor": "yahoo", "map": { "Date":"date", "Adj Close":"adj_close", ... } }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, vendor, map } = body;

    if (!name || !vendor || !map) {
      return NextResponse.json(
        { error: 'name, vendor, and map are required' },
        { status: 400 }
      );
    }

    if (!['yahoo', 'bloomberg', 'refinitiv', 'unknown'].includes(vendor)) {
      return NextResponse.json(
        { error: 'Invalid vendor. Must be yahoo, bloomberg, refinitiv, or unknown' },
        { status: 400 }
      );
    }

    // Validate map structure
    if (typeof map !== 'object' || Array.isArray(map)) {
      return NextResponse.json(
        { error: 'map must be an object with string keys and values' },
        { status: 400 }
      );
    }

    // Ensure mappings directory exists
    await fs.mkdir(MAPPINGS_DIR, { recursive: true });

    // Generate unique ID
    const id = `${vendor}-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`;
    const now = new Date().toISOString();

    const mapping: ColumnMapping = {
      id,
      name,
      vendor,
      map,
      created_at: now,
      updated_at: now
    };

    // Save to file
    const filename = `${id}.json`;
    const filepath = path.join(MAPPINGS_DIR, filename);
    await fs.writeFile(filepath, JSON.stringify(mapping, null, 2));

    return NextResponse.json(mapping, { status: 201 });
  } catch (error) {
    console.error('Failed to save mapping:', error);
    return NextResponse.json(
      { error: 'Failed to save mapping' },
      { status: 500 }
    );
  }
}