import { NextResponse } from 'next/server';
import { ForecastRecord } from '@/lib/forecast/types';
import fs from 'fs';
import path from 'path';

export async function GET(
  _req: Request,
  { params }: { params: { symbol: string } }
) {
  const symbol = params.symbol;
  try {
    const forecastsDir = path.join(process.cwd(), 'data', 'forecasts', symbol);
    
    if (!fs.existsSync(forecastsDir)) {
      return NextResponse.json({ base_forecasts: 0 });
    }

    // Load all forecast files and count base forecasts
    const files = fs.readdirSync(forecastsDir)
      .filter(f => f.endsWith('.json') && f.includes('-'))
      .sort();

    let baseForecastCount = 0;

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(forecastsDir, file), 'utf-8');
        const forecast: ForecastRecord = JSON.parse(content);
        
        // Count only locked, non-Conformal forecasts (same logic as calibration)
        if (forecast.locked && !forecast.method.startsWith('Conformal:')) {
          baseForecastCount++;
        }
      } catch (err) {
        // Skip malformed files
        continue;
      }
    }

    return NextResponse.json({ base_forecasts: baseForecastCount });
  } catch (err) {
    console.error('[Conformal HEAD] error', err);
    return NextResponse.json({ base_forecasts: 0 }, { status: 200 });
  }
}