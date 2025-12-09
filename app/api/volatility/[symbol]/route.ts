import { NextRequest, NextResponse } from 'next/server';
import { fitAndForecastGarch } from '../../../../lib/volatility/garch';
import { fitAndForecastHar } from '../../../../lib/volatility/har';
import { computeRangeSigma } from '../../../../lib/volatility/range';
import { composePi } from '../../../../lib/volatility/piComposer';
import { SigmaSource, VolParams, SigmaForecast, PiComposeInput } from '../../../../lib/volatility/types';
import { getTargetSpec } from '../../../../lib/storage/targetSpecStore';
import { loadCanonicalData } from '../../../../lib/storage/canonical';
import { ForecastRecord, GbmEstimates } from '../../../../lib/forecast/types';
import { saveForecast, setActiveForecast } from '../../../../lib/forecast/store';
import { specFileFor } from '../../../../lib/paths';
import { getNormalCritical, getStudentTCritical } from '../../../../lib/forecast/critical';
import { 
  computeGbmEstimates, 
  computeGbmInterval, 
  computeGbmExpectedPrice,
  validateSeriesForGBM,
  type GbmInputs
} from '../../../../lib/gbm/engine';
import { getNthTradingCloseAfter } from '../../../../lib/calendar/service';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Compute a GBM forecast using pure functions from engine.ts
 * This replaces the I/O-heavy computeGbmForecast from engine_old.ts
 */
async function computeGbmForecastPure(params: {
  symbol: string;
  date_t: string;
  window: number;
  lambda_drift: number;
  canonicalData: Array<{ date: string; adj_close: number | null }>;
  h: number;
  coverage: number;
}): Promise<ForecastRecord> {
  const { symbol, date_t, window: windowN, lambda_drift, canonicalData, h, coverage } = params;

  // Filter valid rows and sort by date
  const validRows = canonicalData
    .filter(row => row.adj_close !== null && row.adj_close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const requiredPrices = windowN + 1;

  if (process.env.NODE_ENV === "development") {
    console.info("[VOL][GBM] prep", {
      symbol,
      windowN,
      validRows: validRows.length,
    });
  }

  if (validRows.length === 0) {
    throw new Error('No valid price data found');
  }

  // Find index for date_t
  const dateIndex = validRows.findIndex(row => row.date === date_t);
  if (dateIndex === -1) {
    throw new Error(`Date ${date_t} not found in canonical data`);
  }

  // Get S_t
  const S_t = validRows[dateIndex].adj_close!;
  if (S_t <= 0) {
    throw new Error('Non-positive price at date_t');
  }

  // Get window slice
  const endIndex = dateIndex;
  const startIndex = Math.max(0, endIndex - requiredPrices + 1);
  
  if (endIndex - startIndex + 1 < requiredPrices) {
    throw new Error(`Insufficient history (N<window): have ${endIndex - startIndex + 1}, need ${requiredPrices}`);
  }

  const windowRows = validRows.slice(startIndex, endIndex + 1);

  if (process.env.NODE_ENV === "development") {
    console.info("[VOL][GBM] slice", {
      symbol,
      windowN,
      requiredPrices,
      startIndex,
      endIndex,
      windowRows: windowRows.length,
    });
  }

  const dates = windowRows.map(r => r.date);
  const adjClose = windowRows.map(r => r.adj_close!);

  // Use pure GBM estimation
  const gbmInput: GbmInputs = {
    dates,
    adjClose,
    windowN: windowN as 252 | 504 | 756,
    lambdaDrift: lambda_drift,
    coverage
  };

  const estimates = computeGbmEstimates(gbmInput);

  // Compute interval for horizon h
  const interval = computeGbmInterval({
    S_t,
    muStarUsed: estimates.mu_star_used,
    sigmaHat: estimates.sigma_hat,
    h_trading: h,
    coverage
  });

  // Compute expected price (y_hat)
  const y_hat = S_t * Math.exp(estimates.mu_star_used * h);

  // Band width in basis points
  const band_width_bp = Math.round(10000 * (interval.U_h / interval.L_h - 1));

  // Build estimates object matching the expected shape
  const forecastEstimates: GbmEstimates = {
    mu_star_hat: estimates.mu_star_hat,
    sigma_hat: estimates.sigma_hat,
    mu_star_used: estimates.mu_star_used,
    window_start: windowRows[0].date,
    window_end: windowRows[windowRows.length - 1].date,
    n: windowRows.length - 1 // Number of returns
  };

  // Build forecast record
  const forecastRecord: ForecastRecord = {
    symbol,
    date_t,
    method: "GBM-CC",
    y_hat,
    params: {
      window: windowN,
      lambda_drift,
      coverage,
      h
    },
    estimates: forecastEstimates,
    target: {
      h,
      coverage
    },
    S_t,
    critical: {
      type: "normal",
      z_alpha: estimates.z_alpha
    },
    m_log: interval.m_t,
    s_scale: interval.s_t,
    L_h: interval.L_h,
    U_h: interval.U_h,
    band_width_bp,
    provenance: {
      rng_seed: null,
      params_snapshot: {
        window: windowN,
        lambda_drift,
        coverage,
        h,
        method: "GBM-CC"
      },
      regime_tag: null,
      conformal: null
    },
    locked: true,
    created_at: new Date().toISOString()
  };

  // Persist forecast
  await saveForecast(forecastRecord);
  
  return forecastRecord;
}

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
    const body: VolatilityRequest & {
      horizon?: number;
      horizonTrading?: number;
      h?: number;
      coverage?: number;
    } = await request.json();
    const { model, params: volParams } = body;

    // Request-supplied overrides for horizon/coverage take precedence over TargetSpec
    const bodyH = (body as any).horizonTrading ?? (body as any).h ?? (body as any).horizon;
    const bodyCoverage = (body as any).coverage;

    console.log("[VOL-API] Received request:", {
      symbol,
      model,
      params: volParams,
      fullBody: body,
      bodyH,
      bodyCoverage
    });

    // Debug logging for target spec path
    console.log("TARGET_SPEC_PATH", specFileFor(symbol));

    // Load target specification
    const specRes = await getTargetSpec(symbol);
    if (!specRes) {
      return new Response(JSON.stringify({ error: "Target specification not found" }), { status: 400 });
    }
    const { h, coverage, exchange_tz } = specRes;

    // Effective horizon/coverage: request override > stored target spec > defaults
    const DEFAULT_H = 1;
    const effectiveH = (bodyH ?? h ?? DEFAULT_H) as number;
    const effectiveCoverage = (bodyCoverage ?? coverage ?? 0.95) as number;

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

    // For volatility models, horizonTrading = effectiveH (trading days horizon)
    const horizonTrading = effectiveH;
    console.log(`[VOL-API] Initial values: date_t=${date_t}, h=${effectiveH}, horizonTrading=${horizonTrading}, coverage=${effectiveCoverage}`);
    
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
          try {
            // Use pure GBM computation with canonical data already loaded
            const gbmForecast = await computeGbmForecastPure({
              symbol,
              date_t,
              window: volParams.gbm.windowN,
              lambda_drift: volParams.gbm.lambdaDrift,
              canonicalData,
              h: effectiveH,
              coverage: effectiveCoverage
            });
            
            // Activate the forecast
            await setActiveForecast(symbol, date_t, 'GBM-CC');
            
            return NextResponse.json({
              ...gbmForecast,
              is_active: true,
              saved_at: new Date().toISOString(),
              success: true
            });
          } catch (err: any) {
            const message = err?.message || '';
            if (
              message.includes('Insufficient history') ||
              message.includes('Insufficient data') ||
              message.includes('sigma') ||
              message.includes('σ²') ||
              message.includes('σ≈0')
            ) {
              if (process.env.NODE_ENV === "development") {
                console.info("[VOL][GBM] insufficient data", { symbol, windowN: volParams.gbm.windowN, reason: message });
              }
              return NextResponse.json(
                { error: message, code: 'INSUFFICIENT_GBM_DATA' },
                { status: 422 }
              );
            }
            throw err;
          }
        
        case 'GARCH11-N':
        case 'GARCH11-t':
          if (!volParams.garch) {
            return NextResponse.json(
              { error: 'GARCH parameters required' },
              { status: 400 }
            );
          }
          try {
            // Build adaptive window based on usable returns
            const filtered = date_t ? canonicalData.filter(row => row.date <= date_t) : canonicalData;
            const returnsAll = filtered
              .map((row: any) => row.r)
              .filter((r: number | null | undefined): r is number => r !== null && r !== undefined);

            let returns = returnsAll;
            let returnsLen = returnsAll.length;

            if (returnsLen === 0) {
              // Fallback: recompute returns from prices when r is missing
              const prices: number[] = [];
              for (const row of filtered) {
                const p = row.adj_close ?? row.close;
                if (typeof p === 'number' && p > 0) {
                  prices.push(p);
                }
              }
              const recomputed: number[] = [];
              for (let i = 1; i < prices.length; i++) {
                const prev = prices[i - 1];
                const curr = prices[i];
                if (prev > 0 && curr > 0) {
                  recomputed.push(Math.log(curr / prev));
                }
              }
              returns = recomputed;
              returnsLen = recomputed.length;
              if (process.env.NODE_ENV === 'development') {
                console.info('[VOL][GARCH] recomputed returns from price', {
                  symbol,
                  canonicalRows: filtered.length,
                  recomputedReturnsLen: returnsLen,
                });
              }
            }
            const configWindow = volParams.garch.window;
            const garchMinWindow = 500;
            const garchMaxWindowCap = configWindow;
            const maxFeasibleWindow = Math.min(garchMaxWindowCap, returnsLen + 1);

            if (process.env.NODE_ENV === 'development') {
              console.info('[VOL][GARCH] window-precheck', {
                symbol,
                returnsLen,
                configWindow,
                maxFeasibleWindow,
                garchMinWindow,
              });
            }

            if (maxFeasibleWindow < garchMinWindow) {
              if (process.env.NODE_ENV === 'development') {
                console.info('[VOL][GARCH] pre-window insufficient', {
                  symbol,
                  returnsLen,
                  garchMinWindow,
                  configWindow
                });
              }
              return NextResponse.json(
                {
                  error: `Insufficient returns for GARCH estimation: have ${returnsLen}, need at least ${garchMinWindow - 1}`,
                  code: 'INSUFFICIENT_GARCH_DATA'
                },
                { status: 422 }
              );
            }

            const effectiveGarchWindow = maxFeasibleWindow;
            if (process.env.NODE_ENV === 'development') {
              console.info('[VOL][GARCH] window-effective', {
                symbol,
                window: effectiveGarchWindow,
                returnsLen,
              });
            }

            const returnsForFit = returns.slice(-(effectiveGarchWindow - 1));

            sigmaForecast = await fitAndForecastGarch({
              symbol,
              date_t,
              window: effectiveGarchWindow,
              dist: volParams.garch.dist,
              variance_targeting: volParams.garch.variance_targeting,
              df: volParams.garch.df,
              returns: returnsForFit
            });

            if (process.env.NODE_ENV === 'development') {
              const minRequired = effectiveGarchWindow - 1;
              console.info('[VOL][GARCH] forecast ok', { symbol, returnsLen, minRequired, effectiveGarchWindow });
            }
          } catch (error: any) {
            const message = error?.message || '';
            if (message.includes('Insufficient returns for GARCH estimation')) {
              const filtered = date_t ? canonicalData.filter(row => row.date <= date_t) : canonicalData;
              const windowData = filtered.slice(-volParams.garch.window);
              const returnsLen = windowData
                .map((row: any) => row.r)
                .filter((r: number | null | undefined): r is number => r !== null && r !== undefined)
                .length;
              const minRequired = volParams.garch.window - 1;

              if (process.env.NODE_ENV === 'development') {
                console.info('[VOL][GARCH] insufficient data', { symbol, returnsLen, minRequired });
              }

              return NextResponse.json(
                {
                  error: 'Insufficient returns for GARCH estimation',
                  code: 'INSUFFICIENT_GARCH_DATA'
                },
                { status: 422 }
              );
            }
            if (
              message.includes('Insufficient data') ||
              message.includes('window') && message.includes('600') ||
              message.includes('Invalid variance forecast') ||
              message.includes('σ²') ||
              message.includes('σ≈0')
            ) {
              if (process.env.NODE_ENV === 'development') {
                console.info('[VOL][GARCH] insufficient data', {
                  symbol,
                  windowN: volParams.garch.window,
                  msg: message
                });
              }
              return NextResponse.json(
                {
                  error: message,
                  code: 'INSUFFICIENT_GARCH_DATA'
                },
                { status: 422 }
              );
            }

            // Unexpected, let outer handler treat as internal error
            throw error;
          }
          break;

        case 'HAR-RV':
          if (!volParams.har) {
            return NextResponse.json(
              { error: 'HAR parameters required' },
              { status: 400 }
            );
          }
          
          try {
            sigmaForecast = await fitAndForecastHar({
              symbol,
              date_t,
              window: volParams.har.window,
              use_intraday_rv: volParams.har.use_intraday_rv
            });
          } catch (error: any) {
            const message = error?.message || '';
            if (
              message.includes('Insufficient RV data') ||
              message.includes('HAR-RV disabled') ||
              message.includes('no realized volatility') ||
              message.includes('Insufficient data')
            ) {
              if (process.env.NODE_ENV === 'development') {
                console.info('[VOL][HAR] insufficient data', { symbol, window: volParams.har.window, msg: message });
              }
              return NextResponse.json(
                { error: message, code: 'INSUFFICIENT_HAR_DATA' },
                { status: 422 }
              );
            }
            throw error;
          }
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
          try {
            // Compute adaptive window for range estimators
            const filtered = date_t ? canonicalData.filter(row => row.date <= date_t) : canonicalData;
            const availableRows = filtered.length;
            const configWindow = volParams.range.window;
            const rangeMinWindow = 252;
            const rangeMaxWindowCap = configWindow;
            const maxFeasibleWindow = Math.min(rangeMaxWindowCap, Math.max(0, availableRows - 1));

            if (maxFeasibleWindow < rangeMinWindow) {
              if (process.env.NODE_ENV === 'development') {
                console.info('[VOL][Range] pre-window insufficient', {
                  symbol,
                  estimator,
                  availableRows,
                  rangeMinWindow,
                  configWindow
                });
              }
              return NextResponse.json(
                {
                  error: `Insufficient data for range estimator: have ${availableRows} rows, need at least ${rangeMinWindow + 1}`,
                  code: 'INSUFFICIENT_RANGE_DATA'
                },
                { status: 422 }
              );
            }

            const effectiveRangeWindow = maxFeasibleWindow;

            sigmaForecast = await computeRangeSigma({
              symbol,
              date_t,
              estimator,
              window: effectiveRangeWindow,
              ewma_lambda: volParams.range.ewma_lambda
            });
          } catch (error: any) {
            const message = error?.message || '';
            if (
              message.includes('Insufficient variance estimates') ||
              message.includes('Insufficient data') ||
              message.includes('σ²') ||
              message.includes('σ≈0')
            ) {
              if (process.env.NODE_ENV === 'development') {
                console.info('[VOL][Range] insufficient data', {
                  symbol,
                  estimator,
                  window: volParams.range.window,
                  msg: message
                });
              }
              return NextResponse.json(
                { error: message, code: 'INSUFFICIENT_RANGE_DATA' },
                { status: 422 }
              );
            }
            throw error;
          }
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
      ? { type: 't' as const, value: getStudentTCritical(df, effectiveCoverage), df }
      : { type: 'normal' as const, value: getNormalCritical(effectiveCoverage) };

    // Compose prediction interval using TRADING DAYS ONLY
    const piComposeInput: PiComposeInput = {
      symbol,
      date_t,
      h: horizonTrading,  // Use trading days, NOT calendar days
      coverage: effectiveCoverage,
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
        h: effectiveH,
        coverage: effectiveCoverage,
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
          h: effectiveH,
          coverage: effectiveCoverage,
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
