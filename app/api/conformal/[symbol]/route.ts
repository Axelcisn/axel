import { NextRequest, NextResponse } from 'next/server';
import { ConformalApplyInput, ConformalState } from '@/lib/conformal/types';
import { calibrate, applyConformalToday } from '@/lib/conformal/calibration';
import { loadState, saveState } from '@/lib/conformal/store';
import { saveForecast } from '@/lib/forecast/store';
import { ForecastRecord } from '@/lib/forecast/types';
import { getTargetSpec } from '@/lib/storage/targetSpecStore';

export async function GET(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const { symbol } = params;
    
    // Load conformal state
    const state = await loadState(symbol);
    
    // Load latest conformal forecast if exists
    let latestForecast: ForecastRecord | null = null;
    try {
      const forecastsDir = `/data/forecasts/${symbol}`;
      // This would require file system access - simplified for now
    } catch (error) {
      // No forecasts available
    }
    
    return NextResponse.json({
      state,
      latestForecast
    });
    
  } catch (error: any) {
    console.error('Conformal GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const { symbol } = params;
    const body: ConformalApplyInput = await request.json();
    const { date_t, base_method, params: conformalParams, coverage: requestCoverage } = body;
    
    // Validate target specification exists
    const targetSpec = await getTargetSpec(symbol);
    if (!targetSpec) {
      return NextResponse.json(
        { error: 'Target specification not found' },
        { status: 400 }
      );
    }
    
    // Use request coverage if provided, otherwise fall back to target spec
    const effectiveCoverage = requestCoverage || targetSpec.coverage;
    
    // Check for domain conflicts with existing state
    const existingState = await loadState(symbol);
    if (existingState && existingState.domain !== conformalParams.domain) {
      const force = request.nextUrl.searchParams.get('force') === 'true';
      if (!force) {
        return NextResponse.json(
          { 
            error: 'Domain conflict: existing state uses different domain',
            code: 'DOMAIN_CONFLICT',
            existing_domain: existingState.domain,
            requested_domain: conformalParams.domain
          },
          { status: 409 }
        );
      }
    }
    
    try {
      // Apply conformal prediction
      const result = await applyConformalToday(symbol, conformalParams, base_method, effectiveCoverage);
      const { state, L, U, m_log, s_scale, critical } = result;
      
      // Create conformal forecast record
      const forecastRecord: ForecastRecord = {
        symbol,
        method: `Conformal:${conformalParams.mode}` as any,
        date_t: date_t || new Date().toISOString().split('T')[0],
        created_at: new Date().toISOString(),
        locked: true,
        target: {
          h: targetSpec.h,
          coverage: effectiveCoverage,
          window_requirements: {
            min_days: conformalParams.cal_window
          }
        },
        estimates: {
          mu_star_hat: 0, // Not applicable for conformal
          sigma_hat: Math.sqrt(s_scale * s_scale),
          mu_star_used: 0, // Not applicable for conformal
          window_start: new Date(Date.now() - conformalParams.cal_window * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          window_end: date_t || new Date().toISOString().split('T')[0],
          n: conformalParams.cal_window,
          sigma_forecast: Math.sqrt(s_scale * s_scale),
          sigma2_forecast: s_scale * s_scale,
          critical_value: critical.value,
          window_span: {
            start: new Date(Date.now() - conformalParams.cal_window * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            end: date_t || new Date().toISOString().split('T')[0]
          }
        },
        intervals: {
          L_h: L,
          U_h: U,
          band_width_bp: 10000 * (U / L - 1)
        },
        provenance: {
          rng_seed: conformalParams.mode === 'EnbPI' ? null : null, // TODO: Add RNG seed for EnbPI bagging
          params_snapshot: {
            mode: conformalParams.mode,
            domain: conformalParams.domain,
            cal_window: conformalParams.cal_window,
            coverage: effectiveCoverage,
            h: targetSpec.h,
            base_method: base_method || 'auto'
          },
          regime_tag: null, // TODO: Add regime detection from backtest
          conformal: {
            mode: conformalParams.mode,
            domain: conformalParams.domain,
            cal_window: conformalParams.cal_window,
            q_cal: state.params.q_cal,
            q_cal_scaled: state.params.q_cal_scaled,
            delta_L: state.params.delta_L,
            delta_U: state.params.delta_U,
            eta: state.params.eta,
            theta: state.params.theta,
            K: state.params.K
          }
        },
        diagnostics: {
          method_source: conformalParams.mode,
          m_log,
          s_scale,
          critical_type: critical.type,
          base_method: base_method || 'auto',
          conformal: {
            mode: conformalParams.mode,
            domain: conformalParams.domain,
            cal_window: conformalParams.cal_window,
            params: state.params,
            coverage: state.coverage
          },
          ...(critical.df ? { df: critical.df } : {})
        }
      };
      
      // Save forecast record
      const recordPath = await saveForecast(forecastRecord);
      
      // Save conformal state
      await saveState(symbol, state);
      
      return NextResponse.json({
        record_path: recordPath,
        state
      });
      
    } catch (error: any) {
      // Handle specific conformal errors
      if (error.message.includes('Insufficient base forecasts')) {
        return NextResponse.json(
          { error: error.message },
          { status: 422 }
        );
      }
      if (error.message.includes('EnbPI requires K >= 5')) {
        return NextResponse.json(
          { error: error.message },
          { status: 422 }
        );
      }
      if (error.message.includes('ACI requires positive eta')) {
        return NextResponse.json(
          { error: error.message },
          { status: 422 }
        );
      }
      if (error.message.includes('No base forecast found')) {
        return NextResponse.json(
          { error: error.message },
          { status: 422 }
        );
      }
      
      throw error; // Re-throw unexpected errors
    }
    
  } catch (error: any) {
    console.error('Conformal API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}