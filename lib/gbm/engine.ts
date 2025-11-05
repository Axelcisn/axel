import * as fs from 'fs';
import * as path from 'path';
import { ForecastRecord, ForecastParams, GbmEstimates } from '../forecast/types';
import { TargetSpec } from '../types/targetSpec';
import { CanonicalRow, CanonicalTableMeta } from '../types/canonical';
import { saveForecast } from '../forecast/store';

// Normal inverse CDF approximation (Beasley-Springer-Moro algorithm)
function normalInverse(p: number): number {
  const a = [0, -3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [0, -5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [0, -7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [0, 7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];

  if (p <= 0 || p >= 1) {
    throw new Error("p must be between 0 and 1");
  }

  let q = p - 0.5;
  
  if (Math.abs(q) <= 0.425) {
    let r = 0.180625 - q * q;
    return q * (((((((a[7] * r + a[6]) * r + a[5]) * r + a[4]) * r + a[3]) * r + a[2]) * r + a[1]) * r + a[0]) /
      (((((((b[7] * r + b[6]) * r + b[5]) * r + b[4]) * r + b[3]) * r + b[2]) * r + b[1]) * r + 1);
  }
  
  let r = q < 0 ? p : 1 - p;
  r = Math.sqrt(-Math.log(r));
  
  let x;
  if (r <= 5) {
    r -= 1.6;
    x = (((((((c[7] * r + c[6]) * r + c[5]) * r + c[4]) * r + c[3]) * r + c[2]) * r + c[1]) * r + c[0]) /
      ((((((d[6] * r + d[5]) * r + d[4]) * r + d[3]) * r + d[2]) * r + d[1]) * r + 1);
  } else {
    r -= 5;
    x = (((((((c[7] * r + c[6]) * r + c[5]) * r + c[4]) * r + c[3]) * r + c[2]) * r + c[1]) * r + c[0]) /
      ((((((d[6] * r + d[5]) * r + d[4]) * r + d[3]) * r + d[2]) * r + d[1]) * r + 1);
  }
  
  return q < 0 ? -x : x;
}

interface ComputeGbmForecastParams {
  symbol: string;
  date_t?: string;
  window?: number;
  lambda_drift?: number;
}

export async function computeGbmForecast({
  symbol,
  date_t,
  window = 504,
  lambda_drift = 0.25
}: ComputeGbmForecastParams): Promise<ForecastRecord> {
  
  // Read Target Spec
  const targetSpecPath = path.join(process.cwd(), 'data', 'specs', `${symbol}-target.json`);
  let targetSpec: TargetSpec;
  
  try {
    const targetSpecContent = await fs.promises.readFile(targetSpecPath, 'utf-8');
    targetSpec = JSON.parse(targetSpecContent);
  } catch (error) {
    throw new Error('Target Spec required (h, coverage)');
  }
  
  const { h, coverage } = targetSpec;
  
  // Read canonical data
  const canonicalPath = path.join(process.cwd(), 'data', 'canonical', `${symbol}.json`);
  let canonicalData: { rows: CanonicalRow[], meta: CanonicalTableMeta };
  
  try {
    const canonicalContent = await fs.promises.readFile(canonicalPath, 'utf-8');
    canonicalData = JSON.parse(canonicalContent);
  } catch (error) {
    throw new Error('Canonical dataset not found');
  }
  
  const { rows } = canonicalData;
  
  // Sort rows by date and filter valid rows
  const validRows = rows
    .filter(row => row.valid !== false && row.adj_close && row.adj_close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  
  if (validRows.length === 0) {
    throw new Error('No valid price data found');
  }
  
  // Determine date_t (latest canonical date if not provided)
  const effectiveDate = date_t || validRows[validRows.length - 1].date;
  
  // Find the index for date_t
  const dateIndex = validRows.findIndex(row => row.date === effectiveDate);
  if (dateIndex === -1) {
    throw new Error(`Date ${effectiveDate} not found in canonical data`);
  }
  
  // Get the current price S_t
  const S_t = validRows[dateIndex].adj_close!;
  if (S_t <= 0) {
    throw new Error('Non-positive price at date_t');
  }
  
  // Build r_window for last N valid days (up to and including date_t)
  const endIndex = dateIndex;
  const startIndex = Math.max(0, endIndex - window + 1);
  
  if (endIndex - startIndex + 1 < window) {
    throw new Error(`Insufficient history (N<window)`);
  }
  
  // Extract log returns for the window
  const windowRows = validRows.slice(startIndex, endIndex + 1);
  const logReturns: number[] = [];
  
  for (let i = 1; i < windowRows.length; i++) {
    const prev = windowRows[i - 1].adj_close!;
    const curr = windowRows[i].adj_close!;
    if (prev > 0 && curr > 0) {
      logReturns.push(Math.log(curr / prev));
    }
  }
  
  const N = logReturns.length;
  if (N < window - 1) {
    throw new Error(`Insufficient history (N<window)`);
  }
  
  // Compute MLE estimates with denominator N
  const mu_star_hat = logReturns.reduce((sum, r) => sum + r, 0) / N;
  
  const variance = logReturns.reduce((sum, r) => sum + Math.pow(r - mu_star_hat, 2), 0) / N;
  const sigma_hat = Math.sqrt(variance);
  
  if (sigma_hat < 1e-8) {
    throw new Error('Vol too small to form PI');
  }
  
  // Apply drift shrinkage
  const mu_star_used = lambda_drift * mu_star_hat;
  
  // PI components (log scale)
  const m_log = Math.log(S_t) + h * mu_star_used;  // m_t(h)
  const s_scale = sigma_hat * Math.sqrt(h);        // s_t(h)
  
  // Critical value
  const alpha = 1 - coverage;
  const z_alpha = normalInverse(1 - alpha / 2);
  
  // Prediction intervals
  const L_h = Math.exp(m_log - z_alpha * s_scale);
  const U_h = Math.exp(m_log + z_alpha * s_scale);
  
  // Band width in basis points (for h=1)
  const band_width_bp = h === 1 ? 10000 * (U_h / L_h - 1) : 10000 * (Math.exp(z_alpha * s_scale / Math.sqrt(h)) - Math.exp(-z_alpha * s_scale / Math.sqrt(h)));
  
  // Build estimates
  const estimates: GbmEstimates = {
    mu_star_hat,
    sigma_hat,
    mu_star_used,
    window_start: windowRows[0].date,
    window_end: windowRows[windowRows.length - 1].date,
    n: N
  };
  
  // Build forecast record
  const forecastRecord: ForecastRecord = {
    symbol,
    date_t: effectiveDate,
    method: "GBM-CC",
    params: {
      window,
      lambda_drift,
      coverage,
      h
    },
    estimates,
    critical: {
      type: "normal",
      z_alpha
    },
    m_log,
    s_scale,
    L_h,
    U_h,
    band_width_bp,
    locked: true,
    created_at: new Date().toISOString()
  };
  
  // Persist and return
  await saveForecast(forecastRecord);
  return forecastRecord;
}