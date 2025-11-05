import { NextRequest, NextResponse } from 'next/server';
import { fitAndForecastGarch } from '@/lib/volatility/garch';
import { fitAndForecastHar } from '@/lib/volatility/har';
import { computeRangeSigma } from '@/lib/volatility/range';
import { composePi } from '@/lib/volatility/piComposer';
import { SigmaSource, VolParams, SigmaForecast, PiComposeInput } from '@/lib/volatility/types';
import { getTargetSpec } from '@/lib/storage/targetSpecStore';
import { loadCanonicalData } from '@/lib/storage/canonical';
import { ForecastRecord } from '@/lib/forecast/types';
import { saveForecast } from '@/lib/forecast/store';
import fs from 'fs';
import path from 'path';

interface VolatilityRequest {
  model: SigmaSource;
  params: VolParams;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const { symbol } = params;
    const body: VolatilityRequest = await request.json();
    const { model, params: volParams } = body;

    // Load target specification
    const targetSpec = await getTargetSpec(symbol);
    if (!targetSpec) {
      return NextResponse.json(
        { error: 'Target specification not found' },
        { status: 400 }
      );
    }

    // Load canonical data to get latest price and determine date_t
    const canonicalData = await loadCanonicalData(symbol);
    if (!canonicalData || canonicalData.length === 0) {
      return NextResponse.json(
        { error: 'Canonical dataset not found' },
        { status: 400 }
      );
    }

    // Get latest valid row
    const validRows = canonicalData
      .filter(row => row.adj_close !== null && row.adj_close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (validRows.length === 0) {
      return NextResponse.json(
        { error: 'No valid price data found' },
        { status: 400 }
      );
    }

    const latestRow = validRows[validRows.length - 1];
    const date_t = latestRow.date;
    const S_t = latestRow.adj_close!;

    // Load latest GBM estimates to get mu_star_used
    const gbmPath = path.join(process.cwd(), 'data', 'forecasts', symbol);
    let mu_star_used = 0; // Default drift

    try {
      const files = await fs.promises.readdir(gbmPath);
      const gbmFiles = files.filter(f => f.includes('-GBM.json')).sort().reverse();
      
      if (gbmFiles.length > 0) {
        const latestGbmPath = path.join(gbmPath, gbmFiles[0]);
        const gbmContent = await fs.promises.readFile(latestGbmPath, 'utf-8');
        const gbmRecord: ForecastRecord = JSON.parse(gbmContent);
        
        if (gbmRecord.estimates?.mu_star_used !== undefined) {
          mu_star_used = gbmRecord.estimates.mu_star_used;
        }
      }
    } catch (error) {
      console.warn('Could not load GBM estimates, using default drift');
    }

    // Generate sigma forecast based on selected model
    let sigmaForecast: SigmaForecast;
    let critical: { type: "normal" | "t"; value: number; df?: number };

    try {
      switch (model) {
        case 'GARCH11-N':
        case 'GARCH11-t':
          if (!volParams.garch) {
            return NextResponse.json(
              { error: 'GARCH parameters required' },
              { status: 400 }
            );
          }
          
          sigmaForecast = await fitAndForecastGarch({
            symbol,
            date_t,
            window: volParams.garch.window,
            dist: volParams.garch.dist,
            variance_targeting: volParams.garch.variance_targeting,
            df: volParams.garch.df
          });

          // Set critical value
          if (volParams.garch.dist === 'student-t' && volParams.garch.df) {
            critical = { 
              type: 't', 
              value: getStudentTCritical(volParams.garch.df, targetSpec.coverage),
              df: volParams.garch.df
            };
          } else {
            critical = { 
              type: 'normal', 
              value: getNormalCritical(targetSpec.coverage) 
            };
          }
          break;

        case 'HAR-RV':
          if (!volParams.har) {
            return NextResponse.json(
              { error: 'HAR parameters required' },
              { status: 400 }
            );
          }
          
          sigmaForecast = await fitAndForecastHar({
            symbol,
            date_t,
            window: volParams.har.window,
            use_intraday_rv: volParams.har.use_intraday_rv
          });

          critical = { 
            type: 'normal', 
            value: getNormalCritical(targetSpec.coverage) 
          };
          break;

        case 'Range-P':
        case 'Range-GK':
        case 'Range-RS':
        case 'Range-YZ':
          if (!volParams.range) {
            return NextResponse.json(
              { error: 'Range parameters required' },
              { status: 400 }
            );
          }
          
          const estimator = model.split('-')[1] as "P" | "GK" | "RS" | "YZ";
          sigmaForecast = await computeRangeSigma({
            symbol,
            date_t,
            estimator,
            window: volParams.range.window,
            ewma_lambda: volParams.range.ewma_lambda
          });

          critical = { 
            type: 'normal', 
            value: getNormalCritical(targetSpec.coverage) 
          };
          break;

        default:
          return NextResponse.json(
            { error: `Unknown model: ${model}` },
            { status: 400 }
          );
      }
    } catch (error: any) {
      // Handle specific volatility model errors
      if (error.message.includes('non-stationary') || error.message.includes('α + β ≥ 1')) {
        return NextResponse.json(
          { error: error.message },
          { status: 422 }
        );
      }
      if (error.message.includes('HAR-RV disabled') || error.message.includes('no realized volatility')) {
        return NextResponse.json(
          { error: error.message },
          { status: 422 }
        );
      }
      if (error.message.includes('Insufficient data') || error.message.includes('σ≈0') || error.message.includes('σ² ≤ 0')) {
        return NextResponse.json(
          { error: error.message },
          { status: 422 }
        );
      }
      
      throw error; // Re-throw unexpected errors
    }

    // Compose prediction interval
    const piComposeInput: PiComposeInput = {
      symbol,
      date_t,
      h: targetSpec.h,
      coverage: targetSpec.coverage,
      mu_star_used,
      S_t,
      sigma_forecast: sigmaForecast,
      critical,
      window_span: {
        start: canonicalData[Math.max(0, canonicalData.length - (volParams.garch?.window || volParams.har?.window || volParams.range?.window || 252))].date,
        end: date_t
      }
    };

    const piResult = composePi(piComposeInput);

    // Create forecast record
    const forecastRecord: ForecastRecord = {
      symbol,
      method: model,
      date_t,
      created_at: new Date().toISOString(),
      locked: true,
      target: {
        h: targetSpec.h,
        coverage: targetSpec.coverage,
        window_requirements: {
          min_days: volParams.garch?.window || volParams.har?.window || volParams.range?.window || 252
        }
      },
      estimates: {
        S_t,
        mu_star_used,
        sigma_forecast: sigmaForecast.sigma_1d,
        sigma2_forecast: sigmaForecast.sigma2_1d,
        critical_value: critical.value,
        window_span: piComposeInput.window_span,
        volatility_diagnostics: sigmaForecast.diagnostics
      },
      intervals: {
        L_h: piResult.L_h,
        U_h: piResult.U_h,
        band_width_bp: piResult.band_width_bp
      },
      diagnostics: {
        method_source: model,
        m_log: piResult.m_log,
        s_scale: piResult.s_scale,
        critical_type: critical.type,
        ...(critical.df ? { df: critical.df } : {})
      }
    };

    // Save forecast record
    await saveForecast(forecastRecord);

    return NextResponse.json(forecastRecord);

  } catch (error: any) {
    console.error('Volatility API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Get normal critical value for given coverage
 */
function getNormalCritical(coverage: number): number {
  const alpha = 1 - coverage;
  
  // Inverse normal CDF approximation (Beasley-Springer-Moro)
  // For common coverage levels
  if (coverage === 0.95) return 1.96;
  if (coverage === 0.99) return 2.576;
  if (coverage === 0.90) return 1.645;
  
  // Approximation for other levels
  const p = 1 - alpha / 2;
  const t = Math.sqrt(-2 * Math.log(1 - p));
  const c0 = 2.515517;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;
  
  return t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
}

/**
 * Get Student-t critical value for given degrees of freedom and coverage
 */
function getStudentTCritical(df: number, coverage: number): number {
  // Simplified approximation - in practice would use proper t-distribution
  const normalCrit = getNormalCritical(coverage);
  
  if (df <= 1) return Infinity;
  if (df >= 100) return normalCrit;
  
  // Rough approximation: t_critical ≈ normal_critical * sqrt(df/(df-2))
  return normalCrit * Math.sqrt(df / (df - 2));
}