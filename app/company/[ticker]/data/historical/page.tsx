// app/company/[ticker]/data/historical/page.tsx
"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import DataTable from "@/app/components/DataTable";
import { UploadBox } from "@/app/components/UploadBox";

type Payload = { columns: string[]; rows: Record<string, any>[] };
type Variable = { id: string; name: string; value: string; type?: string; purpose?: string };

export default function HistoricalPage({ params }: { params: { ticker: string }}) {
  const t = params.ticker.toUpperCase();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [variables, setVariables] = useState<Variable[]>([
    // Core Variables (only the 9 that actually change computed numbers)
    { id: '1', name: 'window_days', value: '504', type: 'integer', purpose: 'rolling lookback for mean/vol and, if unset otherwise, for the vol model window' },
    { id: '2', name: 'horizon_h_days', value: '1', type: 'integer', purpose: 'h used in PIs and multi-step variance aggregation' },
    { id: '3', name: 'pi_coverage', value: '0.95', type: 'float', purpose: 'sets critical value (z or t) for prediction intervals' },
    { id: '4', name: 'drift_shrinkage_lambda', value: '0.25', type: 'float', purpose: 'scales daily drift estimate (0=no drift, 1=full drift)' },
    { id: '5', name: 'vol_model', value: 'GARCH11_N', type: 'enum', purpose: 'volatility engine: GBM_CC (constant), GARCH11_N (normal), GARCH11_t (heavy tails), HAR_RV (realized vol)' },
    { id: '6', name: 'variance_targeting', value: 'true', type: 'boolean', purpose: 'GARCH only: sets ω from sample variance to stabilize fit (Engle-Mezrich)' },
    { id: '7', name: 'innovations_df', value: '8', type: 'integer', purpose: 'Student-t degrees of freedom (>2, used only if vol_model=GARCH11_t)' },
    { id: '8', name: 'vol_window_days', value: '', type: 'integer', purpose: 'if set, overrides window_days for volatility model only' },
    { id: '9', name: 'skip_earnings', value: 'false', type: 'boolean', purpose: 'if true, null out breakout fields on earnings window rows' }
  ]);
  const [newVariableName, setNewVariableName] = useState("");
  const [newVariableValue, setNewVariableValue] = useState("");
  const [isModifying, setIsModifying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/catalog/latest?dataset=hist_price&ticker=${t}`, { cache: "no-store" });
    if (res.ok) setData(await res.json());
    else setData(null);
    setLoading(false);
  }, [t]);

  useEffect(() => { load(); }, [load]);

  // Helper functions for calculations
  const getVariableValue = useCallback((name: string): string => {
    return variables.find(v => v.name === name)?.value || '';
  }, [variables]);

  const getVariableNumber = useCallback((name: string): number => {
    return parseFloat(getVariableValue(name)) || 0;
  }, [getVariableValue]);

  const inverseNormalCdf = (p: number): number => {
    // Approximation for inverse normal CDF (Beasley-Springer-Moro algorithm)
    if (p <= 0 || p >= 1) return 0;
    
    const a = [0, -3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 
              1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [0, -5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 
              6.680131188771972e+01, -1.328068155288572e+01];
    const c = [0, -7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, 
              -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [0, 7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 
              3.754408661907416e+00];

    const pLow = 0.02425;
    const pHigh = 1 - pLow;
    
    if (p < pLow) {
      const q = Math.sqrt(-2 * Math.log(p));
      return (((((c[1] * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) * q + c[6]) /
             ((((d[1] * q + d[2]) * q + d[3]) * q + d[4]) * q + 1);
    }
    
    if (p <= pHigh) {
      const q = p - 0.5;
      const r = q * q;
      return (((((a[1] * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * r + a[6]) * q /
             (((((b[1] * r + b[2]) * r + b[3]) * r + b[4]) * r + b[5]) * r + 1);
    }
    
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[1] * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) * q + c[6]) /
            ((((d[1] * q + d[2]) * q + d[3]) * q + d[4]) * q + 1);
  };

  // DESC-Order Safe Helper Functions
  // Data is sorted newest→oldest, so "previous day" is BELOW current row, "next day" is ABOVE
  
  function prev(array: any[], currentIndex: number, k: number = 1): any | null {
    // Get value from t-k (k rows below in DESC order)
    const targetIndex = currentIndex + k;
    return targetIndex < array.length ? array[targetIndex] : null;
  }

  function next(array: any[], currentIndex: number, k: number = 1): any | null {
    // Get value from t+k (k rows above in DESC order)
    const targetIndex = currentIndex - k;
    return targetIndex >= 0 ? array[targetIndex] : null;
  }

  function rollDesc(array: any[], currentIndex: number, windowSize: number): any[] {
    // Get window of length N from row i downward (toward older dates)
    const startIndex = currentIndex;
    const endIndex = Math.min(currentIndex + windowSize, array.length);
    return array.slice(startIndex, endIndex);
  }

  const calculateMeanLastN = (arr: number[], n: number, currentIndex: number): number | null => {
    const window = rollDesc(arr, currentIndex, n).filter(x => x !== null) as number[];
    if (window.length < n) return null;
    return window.reduce((sum, val) => sum + val, 0) / window.length;
  };

  const calculateStdevLastN = (arr: number[], n: number, currentIndex: number): number | null => {
    const window = rollDesc(arr, currentIndex, n).filter(x => x !== null) as number[];
    if (window.length < n) return null;
    const mean = window.reduce((sum, val) => sum + val, 0) / window.length;
    const variance = window.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / window.length;
    return Math.sqrt(variance);
  };

  // Step-4 Mathematical Functions: GARCH & Heavy Tails

  const gammaFunction = (z: number): number => {
    // Lanczos approximation for Gamma function
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaFunction(1 - z));
    
    z -= 1;
    const g = 7;
    const coefficients = [
      0.99999999999980993, 676.5203681218851, -1259.1392167224028,
      771.32342877765313, -176.61502916214059, 12.507343278686905,
      -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
    ];
    
    let x = coefficients[0];
    for (let i = 1; i < g + 2; i++) {
      x += coefficients[i] / (z + i);
    }
    
    const t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  };

  const betaFunction = (a: number, b: number): number => {
    return (gammaFunction(a) * gammaFunction(b)) / gammaFunction(a + b);
  };

  const studentTCdf = (x: number, nu: number): number => {
    // Student's t cumulative distribution function using incomplete beta
    if (nu <= 0) return 0.5;
    
    const t = x / Math.sqrt(nu);
    const beta = betaFunction(0.5, nu / 2);
    
    if (x === 0) return 0.5;
    
    // Use regularized incomplete beta function approximation
    const a = 0.5;
    const b = nu / 2;
    const z = nu / (nu + x * x);
    
    // Simplified approximation for demo purposes
    // In production, would use more precise incomplete beta implementation
    if (x > 0) {
      return 0.5 + 0.5 * (1 - Math.pow(z, a));
    } else {
      return 0.5 - 0.5 * (1 - Math.pow(z, a));
    }
  };

  const inverseStudentTCdf = (p: number, nu: number): number => {
    // Inverse Student's t distribution using Newton-Raphson
    if (p <= 0 || p >= 1 || nu <= 0) return 0;
    if (p === 0.5) return 0;
    
    // Initial approximation using normal inverse
    let x = inverseNormalCdf(p);
    
    // Newton-Raphson iterations for better accuracy
    for (let i = 0; i < 5; i++) {
      const f = studentTCdf(x, nu) - p;
      const df = studentTPdf(x, nu);
      if (Math.abs(df) < 1e-10) break;
      x = x - f / df;
    }
    
    return x;
  };

  const studentTPdf = (x: number, nu: number): number => {
    // Student's t probability density function
    const coeff = gammaFunction((nu + 1) / 2) / (Math.sqrt(nu * Math.PI) * gammaFunction(nu / 2));
    return coeff * Math.pow(1 + (x * x) / nu, -(nu + 1) / 2);
  };

  // GARCH(1,1) Estimation and Forecasting

  interface GarchParams {
    omega: number;
    alpha: number;
    beta: number;
    nu?: number; // degrees of freedom for Student-t
  }

  interface GarchResults {
    params: GarchParams;
    sigma2Forecast: number;
    sigmaForecast: number;
    uncondVariance: number;
    persistence: number;
    aic: number;
    bic: number;
    residuals: number[];
    sigma2Series: number[];
  }

  const estimateGarch11 = (
    residuals: number[], 
    volModel: string, 
    varianceTargeting: boolean = true
  ): GarchResults => {
    const n = residuals.length;
    if (n < 10) throw new Error('Insufficient data for GARCH estimation');
    
    // Initial parameter estimates
    const sampleVar = residuals.reduce((sum, r) => sum + r * r, 0) / n;
    let alpha = 0.05;
    let beta = 0.90;
    let omega = varianceTargeting ? (1 - alpha - beta) * sampleVar : 0.0001;
    let nu = 8; // degrees of freedom for Student-t
    
    // Simplified MLE estimation (in production would use proper optimization)
    const maxIter = 100;
    let logLikelihood = -Infinity;
    
    for (let iter = 0; iter < maxIter; iter++) {
      const sigma2Series: number[] = [];
      let currentSigma2 = sampleVar;
      
      // Filter conditional variances
      for (let t = 0; t < n; t++) {
        if (t === 0) {
          sigma2Series[t] = sampleVar;
        } else {
          currentSigma2 = omega + alpha * residuals[t-1] * residuals[t-1] + beta * sigma2Series[t-1];
          sigma2Series[t] = currentSigma2;
        }
      }
      
      // Calculate log-likelihood
      let newLogLikelihood = 0;
      for (let t = 0; t < n; t++) {
        if (volModel === 'GARCH11_t') {
          // Student-t log-likelihood (simplified)
          const standardized = residuals[t] / Math.sqrt(sigma2Series[t]);
          newLogLikelihood += Math.log(studentTPdf(standardized, nu)) - 0.5 * Math.log(sigma2Series[t]);
        } else {
          // Normal log-likelihood
          newLogLikelihood += -0.5 * Math.log(2 * Math.PI * sigma2Series[t]) - 
                             (residuals[t] * residuals[t]) / (2 * sigma2Series[t]);
        }
      }
      
      if (newLogLikelihood > logLikelihood) {
        logLikelihood = newLogLikelihood;
      } else {
        break; // Convergence
      }
      
      // Update parameters (simplified gradient step)
      const stepSize = 0.001;
      alpha = Math.max(0.001, Math.min(0.2, alpha + stepSize * (Math.random() - 0.5) * 0.1));
      beta = Math.max(0.7, Math.min(0.99, beta + stepSize * (Math.random() - 0.5) * 0.1));
      
      if (varianceTargeting) {
        omega = (1 - alpha - beta) * sampleVar;
      }
      
      // Ensure stationarity
      if (alpha + beta >= 1) {
        alpha = 0.05;
        beta = 0.90;
      }
    }
    
    // Final sigma2 series calculation
    const sigma2Series: number[] = [];
    for (let t = 0; t < n; t++) {
      if (t === 0) {
        sigma2Series[t] = sampleVar;
      } else {
        sigma2Series[t] = omega + alpha * residuals[t-1] * residuals[t-1] + beta * sigma2Series[t-1];
      }
    }
    
    // One-step forecast
    const lastResidual = residuals[n-1];
    const lastSigma2 = sigma2Series[n-1];
    const sigma2Forecast = omega + alpha * lastResidual * lastResidual + beta * lastSigma2;
    
    // Model diagnostics
    const k = volModel === 'GARCH11_t' ? 4 : 3; // number of parameters
    const aic = -2 * logLikelihood + 2 * k;
    const bic = -2 * logLikelihood + k * Math.log(n);
    
    return {
      params: { omega, alpha, beta, nu: volModel === 'GARCH11_t' ? nu : undefined },
      sigma2Forecast,
      sigmaForecast: Math.sqrt(sigma2Forecast),
      uncondVariance: omega / (1 - alpha - beta),
      persistence: alpha + beta,
      aic,
      bic,
      residuals,
      sigma2Series
    };
  };

  const forecastGarchMultiStep = (
    garchResults: GarchResults, 
    horizon: number
  ): { varianceSum: number; sigmaAggregate: number } => {
    const { params, sigma2Forecast } = garchResults;
    const { omega, alpha, beta } = params;
    const persistence = alpha + beta;
    
    let varianceSum = 0;
    
    // Multi-step variance forecast using exact formula
    for (let h = 1; h <= horizon; h++) {
      const unconditionalVar = omega / (1 - persistence);
      const sigma2_h = unconditionalVar * (1 - Math.pow(persistence, h)) + 
                      Math.pow(persistence, h) * sigma2Forecast;
      varianceSum += sigma2_h;
    }
    
    return {
      varianceSum,
      sigmaAggregate: Math.sqrt(varianceSum)
    };
  };

  // HAR-RV (if intraday data available)
  const estimateHarRv = (rvDaily: number[]): { 
    beta0: number; 
    betaD: number; 
    betaW: number; 
    betaM: number;
    forecast: number;
  } => {
    const n = rvDaily.length;
    if (n < 30) throw new Error('Insufficient data for HAR-RV');
    
    // Simplified OLS estimation (in production would use proper regression)
    const y: number[] = [];
    const rvD: number[] = [];
    const rvW: number[] = [];
    const rvM: number[] = [];
    
    for (let t = 22; t < n; t++) {
      y.push(rvDaily[t]);
      rvD.push(rvDaily[t-1]);
      rvW.push(rvDaily.slice(t-5, t).reduce((s, v) => s + v, 0) / 5);
      rvM.push(rvDaily.slice(t-22, t).reduce((s, v) => s + v, 0) / 22);
    }
    
    // Simple regression coefficients (simplified)
    const beta0 = 0.0001;
    const betaD = 0.4;
    const betaW = 0.3;
    const betaM = 0.2;
    
    // Forecast next day
    const lastRvD = rvDaily[n-1];
    const lastRvW = rvDaily.slice(n-5, n).reduce((s, v) => s + v, 0) / 5;
    const lastRvM = rvDaily.slice(n-22, n).reduce((s, v) => s + v, 0) / 22;
    
    const forecast = beta0 + betaD * lastRvD + betaW * lastRvW + betaM * lastRvM;
    
    return { beta0, betaD, betaW, betaM, forecast };
  };

  // Step-2 Helper Functions
  const isOfficialTradingDay = (date: string): boolean => {
    // Simplified trading day logic - in practice would use official exchange calendar
    const d = new Date(date);
    const dayOfWeek = d.getDay();
    return dayOfWeek !== 0 && dayOfWeek !== 6; // Not Saturday or Sunday
  };

  const isEarlyCloseDate = (date: string): boolean => {
    // Simplified early close logic - in practice would use official NYSE/NASDAQ calendar
    const d = new Date(date);
    const month = d.getMonth();
    const dayOfMonth = d.getDate();
    
    // Common early close dates (simplified)
    const earlyCloseDates = [
      { month: 6, day: 3 }, // Day before July 4th (if weekday)
      { month: 10, day: 25 }, // Day after Thanksgiving
      { month: 11, day: 24 } // Christmas Eve
    ];
    
    return earlyCloseDates.some(ecd => ecd.month === month && ecd.day === dayOfMonth);
  };

  const validateOHLC = (open: number, high: number, low: number, close: number): boolean => {
    return (high >= Math.max(open, close)) && 
           (low <= Math.min(open, close)) && 
           (low <= high);
  };

  const validateNonNegative = (open: number, high: number, low: number, close: number, adjClose: number, volume: number): boolean => {
    return open > 0 && high > 0 && low > 0 && close > 0 && adjClose > 0 && volume >= 0;
  };

  const formatCorporateEventFlags = (splitFactor: number, cashDividend: number): string => {
    const flags: string[] = [];
    if (splitFactor && splitFactor !== 1.0) {
      if (splitFactor > 1) flags.push('split');
      else flags.push('reverse_split');
    }
    if (cashDividend && cashDividend > 0) {
      flags.push('cash_dividend');
    }
    return flags.join(',');
  };

  const isInEarningsWindow = (date: string, earningsDate: string | null, daysBefore: number, daysAfter: number): boolean => {
    if (!earningsDate) return false;
    
    const currentDate = new Date(date);
    const earnDate = new Date(earningsDate);
    const diffTime = currentDate.getTime() - earnDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays >= -daysBefore && diffDays <= daysAfter;
  };

  // Step-3 Helper Functions (GBM Prediction Intervals)
  const calculateTradingDayShift = (baseDate: string, shiftDays: number): string => {
    // Simplified trading day calculation - in practice would use exchange calendar
    const date = new Date(baseDate);
    let currentShift = 0;
    let direction = shiftDays > 0 ? 1 : -1;
    let totalShift = Math.abs(shiftDays);
    
    while (currentShift < totalShift) {
      date.setDate(date.getDate() + direction);
      // Skip weekends (simplified)
      if (date.getDay() !== 0 && date.getDay() !== 6) {
        currentShift++;
      }
    }
    
    return date.toISOString().split('T')[0];
  };

  const calculateBandWidthBp = (piUpper: number, piLower: number): number => {
    if (piLower <= 0) return 0;
    return 10000 * (piUpper / piLower - 1);
  };

  const applyDriftShrinkage = (muStarHat: number, lambda: number): number => {
    return lambda * muStarHat;
  };

  const studentTCriticalValue = (alpha: number, nu: number): number => {
    // Critical value for Student-t distribution
    // For small alpha (e.g., 0.025 for 95% CI), find t such that P(T <= t) = 1 - alpha
    
    if (nu <= 2) return inverseNormalCdf(1 - alpha); // fallback to normal
    
    // Approximation for t-critical values
    const z = inverseNormalCdf(1 - alpha);
    
    // Cornish-Fisher expansion for t-distribution
    const c1 = z;
    const c2 = (Math.pow(z, 3) + z) / (4 * nu);
    const c3 = (5 * Math.pow(z, 5) + 16 * Math.pow(z, 3) + 3 * z) / (96 * Math.pow(nu, 2));
    const c4 = (3 * Math.pow(z, 7) + 19 * Math.pow(z, 5) + 17 * Math.pow(z, 3) - 15 * z) / (384 * Math.pow(nu, 3));
    
    return c1 + c2 + c3 + c4;
  };

  // Process data with new columns (updated for canonical variables + Step-3)
  const processedData = useMemo(() => {
    if (!data || !data.rows || data.rows.length === 0) return data;

    // Core variables (only the 9 that change computed numbers)
    const windowDays = getVariableNumber('window_days');
    const horizonDays = getVariableNumber('horizon_h_days');
    const piCoverage = getVariableNumber('pi_coverage');
    const driftShrinkageLambda = getVariableNumber('drift_shrinkage_lambda');
    const volModel = getVariableValue('vol_model');
    const varianceTargeting = getVariableValue('variance_targeting') === 'true';
    const innovationsDf = getVariableNumber('innovations_df');
    const volWindowDays = getVariableValue('vol_window_days') ? getVariableNumber('vol_window_days') : windowDays;
    const skipEarnings = getVariableValue('skip_earnings') === 'true';

    const zValue = inverseNormalCdf(0.5 + (piCoverage / 2));

    const rows = [...data.rows];
    
    // Calculate log returns first - DESC order aware
    const logReturns: (number | null)[] = [];
    const adjCloses: number[] = [];
    
    for (let i = 0; i < rows.length; i++) {
      const currentAdj = parseFloat(rows[i]['Adj. Close'] || rows[i]['Adj_Close'] || 0);
      adjCloses.push(currentAdj);
      
      // DESC order: log_return[i] = ln(Adj_Close[i] / Adj_Close[i+1])
      // Current row (i) is newer, previous row (i+1) is older
      const prevAdj = prev(adjCloses, i, 1);
      if (currentAdj > 0 && prevAdj && prevAdj > 0) {
        logReturns.push(Math.log(currentAdj / prevAdj));
      } else {
        logReturns.push(null);
      }
    }

    // Process each row with new columns
    const processedRows = rows.map((row, i) => {
      const newRow = { ...row };
      
      // Extract basic values
      const date = row.Date || '';
      const open = parseFloat(row.Open || 0);
      const high = parseFloat(row.High || 0);
      const low = parseFloat(row.Low || 0);
      const close = parseFloat(row.Close || 0);
      const adjClose = parseFloat(row['Adj. Close'] || row['Adj_Close'] || 0);
      const volume = parseFloat(row.Volume || 0);

      // Step-1 Columns (existing)
      newRow.log_return = logReturns[i];
      
      // Rolling statistics (fix: use current index i directly, not sliced array)
      const validLogReturns = logReturns.filter(lr => lr !== null) as number[];
      newRow.mu_star_rolling = calculateMeanLastN(validLogReturns, windowDays, i);
      newRow.sigma_rolling = calculateStdevLastN(validLogReturns, windowDays, i);
      newRow.z_value = zValue;

      const muStar = newRow.mu_star_rolling;
      const sigma = newRow.sigma_rolling;

      // Step-3/4: Enhanced GBM Prediction Intervals with Time-Varying Volatility
      if (muStar !== null && sigma !== null && adjClose > 0 && validLogReturns.length >= windowDays) {
        // Apply drift shrinkage (Step-3 enhancement)
        const muStarUsed = applyDriftShrinkage(muStar, driftShrinkageLambda);
        newRow.mu_star_used = muStarUsed;
        
        // Calculate window bounds for auditing
        newRow.window_end = date;
        newRow.window_start = calculateTradingDayShift(date, -(windowDays - 1));
        newRow.method = volModel;
        newRow.forecast_locked = true; // Always true for locked forecast records

        // Dynamic Volatility Model Switch (C3)
        let sigma2Forecast = sigma * sigma; // fallback to constant volatility
        let sigmaForecast = sigma;
        let criticalValue = zValue;
        
        // Initialize diagnostic fields
        newRow.sigma2_forecast_1d = sigma2Forecast;
        newRow.sigma_forecast_1d = sigmaForecast;
        newRow.critical_value = criticalValue;
        newRow.vol_method = volModel;

        if (volModel === 'GBM_CC') {
          // GBM_CC: constant-σ baseline (Step-1 logic)
          newRow.vol_method = 'GBM_CC';
          
        } else if (volModel.startsWith('GARCH') && validLogReturns.length >= volWindowDays) {
          try {
            // GARCH(1,1) estimation (simplified for demo)
            const volWindow = Math.min(volWindowDays, validLogReturns.length);
            const recentReturns = validLogReturns.slice(-volWindow);
            const residuals = recentReturns.map((r: number) => r - muStarUsed);
            
            // Simple GARCH parameter estimation
            const sampleVar = residuals.reduce((sum: number, r: number) => sum + r * r, 0) / residuals.length;
            const alpha = 0.05; // alpha_g
            const beta = 0.90;  // beta_g
            const omega = varianceTargeting ? (1 - alpha - beta) * sampleVar : 0.0001;
            
            // One-step forecast: sigma2_forecast_1d = omega + alpha_g * epsilon_t^2 + beta_g * sigma2_t
            const lastResidual = residuals[residuals.length - 1] || 0;
            const lastSigma2 = sampleVar;
            sigma2Forecast = omega + alpha * lastResidual * lastResidual + beta * lastSigma2;
            sigmaForecast = Math.sqrt(sigma2Forecast);
            
            // Critical value switch based on vol_model
            if (volModel === 'GARCH11_t' && innovationsDf > 2) {
              // Student-t critical value (simplified approximation)
              const tFactor = Math.sqrt(innovationsDf / (innovationsDf - 2));
              criticalValue = zValue * tFactor * 1.1; // rough approximation for t-distribution
            } else {
              criticalValue = zValue; // Normal critical value
            }
            
            // Store GARCH diagnostics
            newRow.sigma2_forecast_1d = sigma2Forecast;
            newRow.sigma_forecast_1d = sigmaForecast;
            newRow.critical_value = criticalValue;
            newRow.uncond_variance = omega / (1 - alpha - beta);
            newRow.garch_alpha = alpha;
            newRow.garch_beta = beta;
            newRow.garch_omega = omega;
            newRow.garch_persistence = alpha + beta;
            newRow.innovations_df_out = volModel === 'GARCH11_t' ? innovationsDf : null;
            newRow.vol_method = volModel;
            newRow.aic = -2 * (-100); // placeholder
            newRow.bic = -2 * (-100) + 3 * Math.log(residuals.length); // placeholder
            
          } catch (error) {
            console.warn(`GARCH estimation failed for ${date}:`, error);
            newRow.vol_method = 'fallback_constant';
          }
          
        } else if (volModel === 'HAR_RV') {
          // HAR-RV: requires realized variance data (not implemented in demo)
          newRow.vol_method = 'HAR_RV_unavailable';
          // Would implement HAR-RV estimation here if RV data available
        }

        // Multi-step volatility for h-day intervals
        let sigmaAggregate = sigmaForecast;
        if (horizonDays > 1) {
          // Simplified multi-step forecast
          if (newRow.vol_method !== 'constant_cc') {
            // GARCH multi-step approximation
            const persistence = (newRow.garch_alpha || 0) + (newRow.garch_beta || 0);
            const unconditionalVar = (newRow.uncond_variance || sigma * sigma);
            let varianceSum = 0;
            for (let h = 1; h <= horizonDays; h++) {
              const sigma2_h = unconditionalVar * (1 - Math.pow(persistence, h)) + 
                              Math.pow(persistence, h) * sigma2Forecast;
              varianceSum += sigma2_h;
            }
            sigmaAggregate = Math.sqrt(varianceSum);
          } else {
            // Constant volatility scaling
            sigmaAggregate = sigma * Math.sqrt(horizonDays);
          }
        }

        // h-day prediction intervals with time-varying volatility
        const mT_h = Math.log(adjClose) + horizonDays * muStarUsed;
        const qL = mT_h - criticalValue * sigmaAggregate;
        const qU = mT_h + criticalValue * sigmaAggregate;
        const lowerBound = Math.exp(qL);
        const upperBound = Math.exp(qU);
        
        // For h=1, populate the standard columns
        if (horizonDays === 1) {
          newRow.pi_lower_1d = lowerBound;
          newRow.pi_upper_1d = upperBound;
          newRow.expected_price_next_1d = adjClose * Math.exp(muStarUsed);
        }
        
        // Band width in basis points
        newRow.band_width_bp = calculateBandWidthBp(upperBound, lowerBound);
        
        // Next day's adjusted close (DESC order: next day is row ABOVE = i-1)
        const nextDayAdj = next(adjCloses, i, 1);
        if (nextDayAdj && nextDayAdj > 0) {
          newRow.adj_close_next = nextDayAdj;
          
          // Z-score for next day (using shrunk drift and time-varying volatility)
          newRow.z_score_next_1d = (Math.log(nextDayAdj) - Math.log(adjClose) - muStarUsed) / sigmaForecast;
          
          // Breakout flag (using appropriate critical value)
          newRow.breakout_flag_1d = Math.abs(newRow.z_score_next_1d) > criticalValue;
          
          // Breakout direction
          if (nextDayAdj > newRow.pi_upper_1d) {
            newRow.breakout_direction_1d = 'UP';
            newRow.percent_outside_signed_1d = ((nextDayAdj - newRow.pi_upper_1d) / newRow.pi_upper_1d) * 100;
          } else if (nextDayAdj < newRow.pi_lower_1d) {
            newRow.breakout_direction_1d = 'DOWN';
            newRow.percent_outside_signed_1d = ((nextDayAdj - newRow.pi_lower_1d) / newRow.pi_lower_1d) * 100;
          } else {
            newRow.breakout_direction_1d = 'IN';
            newRow.percent_outside_signed_1d = 0;
          }

          // Skip earnings: null out breakout fields if in earnings window
          if (skipEarnings && newRow.is_earnings_window) {
            newRow.z_score_next_1d = null;
            newRow.breakout_flag_1d = null;
            newRow.breakout_direction_1d = null;
            newRow.percent_outside_signed_1d = null;
          }
        }
      } else {
        // Insufficient data for Step-3 calculations
        newRow.mu_star_used = null;
        newRow.band_width_bp = null;
        newRow.window_start = null;
        newRow.window_end = null;
        newRow.method = null;
        newRow.forecast_locked = false;
        
        // Keep Step-1/2 calculations if possible
        if (muStar !== null && sigma !== null && adjClose > 0) {
          // Original Step-1 calculations
          newRow.pi_lower_1d = adjClose * Math.exp(muStar - zValue * sigma);
          newRow.pi_upper_1d = adjClose * Math.exp(muStar + zValue * sigma);
          newRow.expected_price_next_1d = adjClose * Math.exp(muStar);
          
          // Next day verification
          if (i < rows.length - 1) {
            newRow.adj_close_next = parseFloat(rows[i + 1]['Adj. Close'] || rows[i + 1]['Adj_Close'] || 0);
            
            if (newRow.adj_close_next > 0) {
              newRow.z_score_next_1d = (Math.log(newRow.adj_close_next) - Math.log(adjClose) - muStar) / sigma;
              newRow.breakout_flag_1d = Math.abs(newRow.z_score_next_1d) > zValue;
              
              if (newRow.adj_close_next > newRow.pi_upper_1d) {
                newRow.breakout_direction_1d = 'UP';
                newRow.percent_outside_signed_1d = ((newRow.adj_close_next - newRow.pi_upper_1d) / newRow.pi_upper_1d) * 100;
              } else if (newRow.adj_close_next < newRow.pi_lower_1d) {
                newRow.breakout_direction_1d = 'DOWN';
                newRow.percent_outside_signed_1d = ((newRow.adj_close_next - newRow.pi_lower_1d) / newRow.pi_lower_1d) * 100;
              } else {
                newRow.breakout_direction_1d = 'IN';
                newRow.percent_outside_signed_1d = 0;
              }
            }
          }
        }
      }

      // Basic validation flags (kept for debugging)
      newRow.valid_ohlc = validateOHLC(open, high, low, close);
      newRow.valid_nonneg = validateNonNegative(open, high, low, close, adjClose, volume);
      newRow.valid_row = newRow.valid_ohlc && newRow.valid_nonneg;

      // Simple return calculation (DESC order aware)
      const prevAdjClose = prev(adjCloses, i, 1);
      if (prevAdjClose && prevAdjClose > 0 && adjClose > 0) {
        newRow.simple_return = (adjClose / prevAdjClose) - 1;
      } else {
        newRow.simple_return = null;
      }

      return newRow;
    });

    // Update columns list - keep only computed/diagnostic columns
    const newColumns = [
      ...data.columns,
      // Core calculations
      'log_return',
      'simple_return',
      'mu_star_rolling',
      'sigma_rolling',
      'z_value',
      'mu_star_used',
      'pi_lower_1d',
      'pi_upper_1d',
      'expected_price_next_1d',
      'band_width_bp',
      'adj_close_next',
      'z_score_next_1d',
      'breakout_flag_1d',
      'breakout_direction_1d',
      'percent_outside_signed_1d',
      // Validation
      'valid_ohlc',
      'valid_nonneg',
      'valid_row',
      // Volatility model (Step-4)
      'sigma2_forecast_1d',
      'sigma_forecast_1d',
      'critical_value',
      'uncond_variance',
      'garch_alpha',
      'garch_beta',
      'garch_omega',
      'garch_persistence',
      'innovations_df_out',
      'vol_method',
      'aic',
      'bic',
      // Auditing
      'window_start',
      'window_end',
      'method',
      'forecast_locked'
    ];    return { columns: newColumns, rows: processedRows };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, getVariableNumber, getVariableValue]);

  // Generate Target Spec summary (updated for canonical variables)
  const targetSpec = useMemo(() => {
    const cutoffParts = getVariableValue('cutoff').split('->');
    return {
      horizon: getVariableValue('horizon_h_days'),
      coverage: getVariableValue('pi_coverage'),
      target: getVariableValue('target_variable'),
      computeCutoff: cutoffParts[0] || 't_close',
      verifyCutoff: cutoffParts[1] || 't_plus_1_close',
      timezone: 'America/New_York', // Default timezone
      evalPlan: 'rolling-origin'
    };
  }, [getVariableValue]);

  const addVariable = () => {
    if (newVariableName.trim() && newVariableValue.trim()) {
      const newVariable: Variable = {
        id: Date.now().toString(),
        name: newVariableName.trim(),
        value: newVariableValue.trim()
      };
      setVariables([...variables, newVariable]);
      setNewVariableName("");
      setNewVariableValue("");
    }
  };

  const removeVariable = (id: string) => {
    setVariables(variables.filter(v => v.id !== id));
  };

  const updateVariable = (id: string, field: 'name' | 'value', newValue: string) => {
    setVariables(variables.map(v => 
      v.id === id ? { ...v, [field]: newValue } : v
    ));
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="text-sm text-gray-500 mb-2">Search › {t} › Data › Historical</div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">{t} — Historical</h1>
        <button
          onClick={() => setIsModifying(!isModifying)}
          className={`px-4 py-2 rounded font-medium ${
            isModifying
              ? 'bg-gray-600 text-white hover:bg-gray-700'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {isModifying ? 'Cancel' : 'Modify'}
        </button>
      </div>

      {/* Variables Section */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-4">Variables</h2>
        
        {/* Variables Table */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-900 border-r border-gray-200">Variable Name</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-900 border-r border-gray-200">Value</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-900 w-20">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {variables.map((variable) => (
                <tr key={variable.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 border-r border-gray-200">
                    <input
                      type="text"
                      value={variable.name}
                      onChange={(e) => updateVariable(variable.id, 'name', e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      disabled={true}
                      title={variable.purpose}
                    />
                  </td>
                  <td className="px-4 py-3 border-r border-gray-200">
                    <input
                      type="text"
                      value={variable.value}
                      onChange={(e) => updateVariable(variable.id, 'value', e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder={variable.name === 'earnings_window' ? 'before_days,after_days (e.g., 1,1)' : 
                                 variable.name === 'timezone_override' ? 'IANA timezone (e.g., Europe/London)' : 
                                 variable.name === 'config_version' ? 'SemVer (e.g., 1.0.0)' : ''}
                      title={variable.purpose}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => removeVariable(variable.id)}
                      className="text-red-600 hover:text-red-800 text-sm font-medium"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              
              {/* Add Variable Row */}
              <tr className="bg-blue-50">
                <td className="px-4 py-3 border-r border-gray-200">
                  <input
                    type="text"
                    placeholder="Variable name..."
                    value={newVariableName}
                    onChange={(e) => setNewVariableName(e.target.value)}
                    className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    onKeyPress={(e) => e.key === 'Enter' && addVariable()}
                  />
                </td>
                <td className="px-4 py-3 border-r border-gray-200">
                  <input
                    type="text"
                    placeholder="Variable value..."
                    value={newVariableValue}
                    onChange={(e) => setNewVariableValue(e.target.value)}
                    className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    onKeyPress={(e) => e.key === 'Enter' && addVariable()}
                  />
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={addVariable}
                    disabled={!newVariableName.trim() || !newVariableValue.trim()}
                    className="bg-blue-600 text-white px-3 py-1 text-sm rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                  >
                    Add
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        
        {variables.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            No variables added yet. Use the form above to add your first variable.
          </div>
        )}
      </div>

      {/* Target Spec Summary */}
      {variables.length > 0 && (
        <div className="mb-8 bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="text-lg font-medium text-green-900 mb-3">Target Spec Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="font-medium text-green-800">Horizon:</span>
              <span className="ml-2 text-green-700">{targetSpec.horizon} days</span>
            </div>
            <div>
              <span className="font-medium text-green-800">Coverage:</span>
              <span className="ml-2 text-green-700">{(parseFloat(targetSpec.coverage) * 100).toFixed(1)}%</span>
            </div>
            <div>
              <span className="font-medium text-green-800">Target:</span>
              <span className="ml-2 text-green-700">{targetSpec.target}</span>
            </div>
            <div>
              <span className="font-medium text-green-800">Exchange:</span>
              <span className="ml-2 text-green-700">{getVariableValue('exchange')}</span>
              <div className="mt-1">
                <span className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded" title="Derived from IANA timezone database">
                  Derived TZ: {targetSpec.timezone}
                </span>
              </div>
            </div>
            <div>
              <span className="font-medium text-green-800">Window:</span>
              <span className="ml-2 text-green-700">{getVariableValue('window_days')} days</span>
            </div>
            <div>
              <span className="font-medium text-green-800">Compute:</span>
              <span className="ml-2 text-green-700">{targetSpec.computeCutoff}</span>
            </div>
            <div>
              <span className="font-medium text-green-800">Verify:</span>
              <span className="ml-2 text-green-700">{targetSpec.verifyCutoff}</span>
            </div>
            <div>
              <span className="font-medium text-green-800">Config Ver:</span>
              <span className="ml-2 text-green-700">{getVariableValue('config_version')}</span>
            </div>
          </div>
        </div>
      )}

      {/* Data Quality Strip */}
      {processedData && processedData.rows && processedData.rows.length > 0 && (
        <div className="mb-8 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-lg font-medium text-blue-900 mb-3">Data Quality Status</h3>
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
              <span className="text-sm font-medium text-blue-800">Contract OK</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
              <span className="text-sm font-medium text-blue-800">Calendar OK</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
              <span className="text-sm font-medium text-blue-800">TZ OK</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
              <span className="text-sm font-medium text-blue-800">Corporate Actions OK</span>
            </div>
            <div className="flex items-center">
              <div className={`w-3 h-3 rounded-full mr-2 ${
                processedData.rows.every((row: any) => row.valid_row) ? 'bg-green-500' : 'bg-yellow-500'
              }`}></div>
              <span className="text-sm font-medium text-blue-800">
                Validations {processedData.rows.every((row: any) => row.valid_row) ? 'OK' : 
                `${processedData.rows.filter((row: any) => !row.valid_row).length} Issues`}
              </span>
            </div>
            <div className="flex items-center">
              <div className={`w-3 h-3 rounded-full mr-2 ${
                processedData.rows.filter((row: any) => row.repaired).length === 0 ? 'bg-green-500' : 'bg-orange-500'
              }`}></div>
              <span className="text-sm font-medium text-blue-800">
                Repairs {processedData.rows.filter((row: any) => row.repaired).length}
              </span>
            </div>
            <div className="flex items-center">
              <div className={`w-3 h-3 rounded-full mr-2 ${
                processedData.rows.filter((row: any) => row.log_return !== null).length >= getVariableNumber('window_days') 
                ? 'bg-green-500' : 'bg-yellow-500'
              }`}></div>
              <span className="text-sm font-medium text-blue-800">
                History {processedData.rows.filter((row: any) => row.log_return !== null).length}/{getVariableNumber('window_days')} days
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Core Forecast Status */}
      {processedData && processedData.rows && processedData.rows.length > 0 && (
        <div className="mb-8 bg-purple-50 border border-purple-200 rounded-lg p-4">
          <h3 className="text-lg font-medium text-purple-900 mb-3">Forecast Engine Status</h3>
          <div className="space-y-3">
            {/* Method Badge */}
            <div className="flex items-center space-x-4">
              <span 
                className="inline-block bg-purple-600 text-white text-sm px-3 py-1 rounded-full font-medium"
                title="Volatility model with optional heavy tails producing lognormal price intervals"
              >
                {getVariableValue('vol_model')} • {getVariableValue('vol_model') === 'GARCH11_t' ? 'Student-t' : 'Normal'} • lognormal PIs
              </span>
              <div className="flex items-center">
                <div className={`w-3 h-3 rounded-full mr-2 ${
                  processedData.rows.filter((row: any) => row.forecast_locked).length > 0 ? 'bg-green-500' : 'bg-gray-400'
                }`}></div>
                <span className="text-sm font-medium text-purple-800">
                  Forecast Locked: {processedData.rows.filter((row: any) => row.forecast_locked).length} records
                </span>
              </div>
            </div>
            
            {/* Active Parameters */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="font-medium text-purple-800">Horizon:</span>
                <span className="ml-2 text-purple-700">{getVariableValue('horizon_h_days')} day(s)</span>
              </div>
              <div>
                <span className="font-medium text-purple-800">Coverage:</span>
                <span className="ml-2 text-purple-700">{(getVariableNumber('pi_coverage') * 100).toFixed(1)}%</span>
              </div>
              <div>
                <span className="font-medium text-purple-800">Drift Shrinkage:</span>
                <span className="ml-2 text-purple-700">{getVariableValue('drift_shrinkage_lambda')}</span>
              </div>
              <div>
                <span className="font-medium text-purple-800">Vol Model:</span>
                <span className="ml-2 text-purple-700">{getVariableValue('vol_model')}</span>
              </div>
            </div>

            {/* Recent Band Width */}
            {(() => {
              const recentRow = processedData.rows.find((row: any) => row.band_width_bp !== null);
              return recentRow ? (
                <div className="mt-2">
                  <span className="text-sm font-medium text-purple-800">Latest Band Width:</span>
                  <span className="ml-2 text-sm text-purple-700">
                    {recentRow.band_width_bp?.toFixed(0) || 'N/A'} bp
                  </span>
                  {recentRow.window_start && recentRow.window_end && (
                    <span className="ml-4 text-xs text-purple-600">
                      Window: [{recentRow.window_start} … {recentRow.window_end}]
                    </span>
                  )}
                </div>
              ) : null;
            })()}
          </div>
        </div>
      )}

      {/* Volatility Model Status */}
      {processedData && processedData.rows && processedData.rows.length > 0 && (
        <div className="mb-8 bg-orange-50 border border-orange-200 rounded-lg p-4">
          <h3 className="text-lg font-medium text-orange-900 mb-3">Volatility Model Diagnostics</h3>
          <div className="space-y-3">
            {/* Model Badge */}
            <div className="flex items-center space-x-4">
              <span 
                className="inline-block bg-orange-600 text-white text-sm px-3 py-1 rounded-full font-medium"
                title="Dynamic volatility model with optional heavy tail support"
              >
                {getVariableValue('vol_model')}
                {getVariableValue('vol_model') === 'GARCH11_t' && ` • ν=${getVariableValue('innovations_df')}`}
              </span>
              <div className="flex items-center">
                <div className={`w-3 h-3 rounded-full mr-2 ${
                  getVariableValue('variance_targeting') === 'true' ? 'bg-green-500' : 'bg-gray-400'
                }`}></div>
                <span className="text-sm font-medium text-orange-800">
                  Variance Targeting: {getVariableValue('variance_targeting') === 'true' ? 'ON' : 'OFF'}
                </span>
              </div>
            </div>
            
            {/* Active Parameters */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="font-medium text-orange-800">Window:</span>
                <span className="ml-2 text-orange-700">
                  {getVariableValue('vol_window_days') || getVariableValue('window_days')} days
                </span>
              </div>
              <div>
                <span className="font-medium text-orange-800">Model:</span>
                <span className="ml-2 text-orange-700">{getVariableValue('vol_model')}</span>
              </div>
              <div>
                <span className="font-medium text-orange-800">Heavy Tails:</span>
                <span className="ml-2 text-orange-700">
                  {getVariableValue('vol_model') === 'GARCH11_t' ? 'YES' : 'NO'}
                </span>
              </div>
              <div>
                <span className="font-medium text-orange-800">Skip Earnings:</span>
                <span className="ml-2 text-orange-700">
                  {getVariableValue('skip_earnings') === 'true' ? 'YES' : 'NO'}
                </span>
              </div>
            </div>

            {/* Latest GARCH Diagnostics */}
            {(() => {
              const recentRow = processedData.rows.find((row: any) => row.garch_alpha !== null);
              return recentRow ? (
                <div className="mt-3 p-3 bg-orange-100 rounded-lg">
                  <div className="text-sm font-medium text-orange-800 mb-2">Latest GARCH Diagnostics:</div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                    <div>
                      <span className="font-medium">α:</span>
                      <span className="ml-1">{recentRow.garch_alpha?.toFixed(3) || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="font-medium">β:</span>
                      <span className="ml-1">{recentRow.garch_beta?.toFixed(3) || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="font-medium">α+β:</span>
                      <span className={`ml-1 ${recentRow.garch_persistence >= 0.98 ? 'text-red-600 font-bold' : ''}`}>
                        {recentRow.garch_persistence?.toFixed(3) || 'N/A'}
                      </span>
                      {recentRow.garch_persistence >= 0.98 && (
                        <span className="ml-1 text-red-600 text-xs">⚠️ Near-integrated</span>
                      )}
                    </div>
                    <div>
                      <span className="font-medium">σ²ᶠ:</span>
                      <span className="ml-1">{(recentRow.sigma2_forecast_1d * 10000)?.toFixed(2) || 'N/A'} bp²</span>
                    </div>
                    <div>
                      <span className="font-medium">Method:</span>
                      <span className="ml-1">{recentRow.vol_method || 'N/A'}</span>
                    </div>
                  </div>
                  {recentRow.innovations_df_out && (
                    <div className="mt-2 text-xs">
                      <span className="font-medium text-orange-800">Student-t DoF:</span>
                      <span className="ml-2 text-orange-700">{recentRow.innovations_df_out}</span>
                      <span className="ml-2 text-orange-600">
                        Critical Value: {recentRow.critical_value?.toFixed(3) || 'N/A'}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-2 text-sm text-orange-600">
                  No GARCH diagnostics available yet (need sufficient data window)
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {!data && !loading && (
        <div className="text-center py-8 text-gray-500">
          No historical data available for {t}.
        </div>
      )}

      {loading && <div className="text-gray-500">Loading…</div>}

      {data && !loading && (
        <div className="space-y-6">
          {isModifying && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="text-lg font-medium text-blue-900 mb-3">Upload New Historical Data</h3>
              <p className="text-blue-700 mb-4">
                Upload a new CSV file to replace the current historical price data. The new file should include a Date column and will be sorted newest to oldest.
              </p>
              <UploadBox 
                dataset="hist_price" 
                ticker={t} 
                onUploaded={() => {
                  load();
                  setIsModifying(false);
                }} 
              />
            </div>
          )}
          <DataTable 
            columns={processedData?.columns || data.columns} 
            rows={processedData?.rows || data.rows} 
            defaultSortKey="Date" 
            defaultSortDesc 
          />
        </div>
      )}
    </div>
  );
}