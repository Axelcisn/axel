import { NextRequest, NextResponse } from 'next/server';
import { fitAndForecastGarch } from '../../../../lib/volatility/garch';
import { fitAndForecastHar } from '../../../../lib/volatility/har';
import { computeRangeSigma } from '../../../../lib/volatility/range';
import { composePi } from '../../../../lib/volatility/piComposer';
import { SigmaSource, VolParams, SigmaForecast, PiComposeInput } from '../../../../lib/volatility/types';
import { getTargetSpec } from '../../../../lib/storage/targetSpecStore';
import { loadCanonicalData } from '../../../../lib/storage/canonical';
import { ForecastRecord } from '../../../../lib/forecast/types';
import { saveForecast, setActiveForecast } from '../../../../lib/forecast/store';
import { specFileFor } from '../../../../lib/paths';
import { getNormalCritical, getStudentTCritical } from '../../../../lib/forecast/critical';
import { computeGbmForecast } from '../../../../lib/gbm/engine_old';
import { computeGbmExpectedPrice } from '../../../../lib/gbm/engine';
import { getNthTradingCloseAfter } from '../../../../lib/calendar/service';
import * as fs from 'fs';
import * as path from 'path';

interface VolatilityRequest {
  model: SigmaSource;
  params: VolParams;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = (params.symbol || "").toUpperCase();
    const body: VolatilityRequest = await request.json();
    const { model, params: volParams } = body;

    console.log("[VOL-API] Received request:", {
      symbol,
      model,
      params: volParams,
      fullBody: body
    });

    // Debug logging for target spec path
    console.log("TARGET_SPEC_PATH", specFileFor(symbol));

    // Load target specification
    const specRes = await getTargetSpec(symbol);
    if (!specRes) {
      return new Response(JSON.stringify({ error: "Target specification not found" }), { status: 400 });
    }
    const { h, coverage, exchange_tz } = specRes;

    // Load canonical data to get latest price and determine date_t
    let canonicalData;
    try {
      canonicalData = await loadCanonicalData(symbol);
    } catch (error: any) {
      const message = error?.message || '';
      if (message.includes('No canonical data')) {
        return NextResponse.json(
          { error: `No canonical data found for ${symbol}` },
          { status: 404 }
        );
      }
      throw error;
    }

    if (!canonicalData || canonicalData.length === 0) {
      return NextResponse.json(
        { error: 'Canonical dataset not found' },
        { status: 404 }
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

    // For volatility models, horizonTrading = h (trading days horizon)
    const horizonTrading = h;
    console.log(`[VOL-API] Initial values: date_t=${date_t}, h=${h}, horizonTrading=${horizonTrading}`);
    
    // Compute calendar-based fields for consistency with GBM
    const tz = exchange_tz || 'America/New_York';
    let verifyDate: string;
    let h_eff_days: number;
    
    try {
      const { verifyDate: calcVerifyDate, calendarDays } = getNthTradingCloseAfter(date_t, horizonTrading, tz);
      verifyDate = calcVerifyDate;
      h_eff_days = calendarDays;
      console.log(`[VOL-API] Calendar computation: ${date_t} + ${horizonTrading}D = ${verifyDate} (h_eff=${h_eff_days})`);
    } catch (error) {
      console.warn('Could not compute calendar fields for', date_t, 'h=', horizonTrading, 'error:', error);
      verifyDate = date_t; // Fallback to current date
      h_eff_days = horizonTrading; // Fallback approximation
      console.log(`[VOL-API] Calendar fallback: verifyDate=${verifyDate}, h_eff_days=${h_eff_days}`);
    }

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

    try {
      switch (model) {
        case 'GBM-CC':
          if (!volParams.gbm) {
            return NextResponse.json(
              { error: 'GBM parameters required' },
              { status: 400 }
            );
          }
          
          // Call the GBM computation function directly and return the ForecastRecord
          const gbmForecast = await computeGbmForecast({
            symbol,
            date_t,
            window: volParams.gbm.windowN,
            lambda_drift: volParams.gbm.lambdaDrift
          });
          
          // Save and activate the forecast
          await setActiveForecast(symbol, date_t, 'GBM-CC');
          
          return NextResponse.json({
            ...gbmForecast,
            is_active: true,
            saved_at: new Date().toISOString(),
            success: true
          });
        
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

    // Derive method string from the chosen model
    const method =
      volParams.garch
        ? (volParams.garch.dist === 'student-t' ? 'GARCH11-t' : 'GARCH11-N')
        : volParams.har
          ? 'HAR-RV'
          : volParams.range
            ? `Range-${String(model.split('-')[1] || '').toUpperCase()}`
            : 'UNKNOWN';

    // Build accurate window span for the fitted portion
    const nObs =
      (volParams.garch?.window)
      ?? (volParams.har?.window)
      ?? (volParams.range?.window)
      ?? canonicalData.length;

    const endIdx = canonicalData.length - 1;
    const startIdx = Math.max(0, canonicalData.length - nObs);
    const windowStart = canonicalData[startIdx].date;
    const windowEnd = canonicalData[endIdx].date;

    // Choose critical from server-side result (prefer server-estimated nu)
    const dist = volParams.garch?.dist ?? 'normal';
    const df = (sigmaForecast.diagnostics?.nu ?? volParams.garch?.df);

    const critical = (dist === 'student-t' && typeof df === 'number' && df > 2)
      ? { type: 't' as const, value: getStudentTCritical(df, coverage), df }
      : { type: 'normal' as const, value: getNormalCritical(coverage) };

    // Compose prediction interval using TRADING DAYS ONLY
    const piComposeInput: PiComposeInput = {
      symbol,
      date_t,
      h: horizonTrading,  // Use trading days, NOT calendar days
      coverage: coverage,
      mu_star_used,
      S_t,
      sigma_forecast: sigmaForecast,
      critical,
      window_span: {
        start: windowStart,
        end: windowEnd
      }
    };

    const piResult = composePi(piComposeInput);

    // Compute explicit predicted price (y_hat) using GBM formula
    // For volatility models, we use the estimated drift and h=1 for one-step-ahead prediction
    const gbmEst = {
      mu_star_hat: 0, // Not needed for prediction, only mu_star_used matters
      sigma_hat: sigmaForecast.sigma_1d,
      mu_star_used,
      z_alpha: critical.value // Not needed for prediction
    };
    const y_hat = computeGbmExpectedPrice(S_t, gbmEst, horizonTrading);

    // Create forecast record
    console.log(`[VOL-API] Creating forecast with horizonTrading=${horizonTrading}, h_eff_days=${h_eff_days}, verifyDate=${verifyDate}`);
    const forecastRecord: ForecastRecord = {
      symbol,
      method: method as any, // Cast to handle the type mismatch for now
      date_t,
      horizonTrading,  // Add trading days horizon
      h_eff_days,      // Add effective horizon in calendar days
      verifyDate,      // Add verification date
      domain: 'log',   // Volatility models work in log domain
      created_at: new Date().toISOString(),
      locked: true,
      y_hat, // Add explicit predicted price
      target: {
        h: h,
        coverage: coverage,
        window_requirements: {
          min_days: nObs
        }
      },
      estimates: {
        mu_star_hat: 0, // Placeholder for volatility models
        sigma_hat: sigmaForecast.sigma_1d,
        mu_star_used,
        window_start: windowStart,
        window_end: windowEnd,
        n: canonicalData.length,
        S_t,
        sigma_forecast: sigmaForecast.sigma_1d,
        sigma2_forecast: sigmaForecast.sigma2_1d,
        critical_value: critical.value,
        window_span: piComposeInput.window_span,
        volatility_diagnostics: sigmaForecast.diagnostics || {
          alpha: 0,
          beta: 0,
          omega: 0,
          alpha_plus_beta: 0,
          unconditional_var: 0,
          dist,
          ...(df ? { nu: df } : {})
        }
      },
      intervals: {
        L_h: piResult.L_h,
        U_h: piResult.U_h,
        band_width_bp: piResult.band_width_bp
      },
      provenance: {
        rng_seed: null, // Most volatility models don't use randomness (except EnbPI)
        params_snapshot: {
          model: method,
          h: h,
          coverage: coverage,
          ...volParams // Include all model-specific parameters
        },
        regime_tag: null, // TODO: Add regime detection from backtest
        conformal: null   // Not a conformal method yet
      },
      diagnostics: {
        method_source: method as any,
        m_log: piResult.m_log,
        s_scale: piResult.s_scale,
        critical_type: critical.type,
        ...(critical.df ? { df: critical.df } : {})
      }
    };

    // Add additional properties for UI consumption
    (forecastRecord as any).critical = critical;
    (forecastRecord as any).window_period = { 
      start: windowStart, 
      end: windowEnd, 
      n_obs: nObs 
    };

    // Save forecast record
    await saveForecast(forecastRecord);

    // Deactivate other forecasts for this date and mark this one as active
    await setActiveForecast(symbol, date_t, model);
    
    // Mark this forecast as active
    forecastRecord.is_active = true;

    // Return the full active record
    return NextResponse.json(forecastRecord, { status: 200 });

  } catch (error: any) {
    console.error('Volatility API error:', error);
    console.error('Error stack:', error.stack);
    console.error('Error message:', error.message);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}