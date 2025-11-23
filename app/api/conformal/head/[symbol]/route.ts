import { NextResponse } from 'next/server';
import { ForecastRecord } from '@/lib/forecast/types';
import { isMatchingBaseForecast } from '@/lib/conformal/calibration';
import fs from 'fs';
import path from 'path';

export async function GET(
  request: Request,
  { params }: { params: { symbol: string } }
) {
  const symbol = params.symbol;
  const url = new URL(request.url);
  const baseMethod = url.searchParams.get('base_method');
  const domain = url.searchParams.get('domain') as 'log' | 'price' | null;
  const horizon = url.searchParams.get('h') ? parseInt(url.searchParams.get('h')!) : undefined;
  const coverage = url.searchParams.get('coverage') ? parseFloat(url.searchParams.get('coverage')!) : undefined;
  
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
        
        // Use the same unified selector as calibration
        if (isMatchingBaseForecast(forecast, {
          symbol,
          baseMethod: baseMethod || undefined,
          domain: domain || undefined,
          horizon,
          coverage
        })) {
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