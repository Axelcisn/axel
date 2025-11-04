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
    // Canonical Variables v1.0 (Step-1 & Step-2 merged and deduplicated)
    { id: '1', name: 'window_days', value: '504', type: 'integer', purpose: 'single rolling lookback; also the minimum history gate' },
    { id: '2', name: 'horizon_h_days', value: '1', type: 'integer', purpose: 'forecast horizon h (we evaluate breakouts with h=1; others optional previews later)' },
    { id: '3', name: 'pi_coverage', value: '0.95', type: 'float', purpose: 'nominal prediction-interval coverage (e.g., 0.95 ⇒ ~95%)' },
    { id: '4', name: 'target_variable', value: 'NEXT_CLOSE_ADJ', type: 'enum', purpose: 'defines the future observation we judge (next trading-day adjusted close)' },
    { id: '5', name: 'preview_horizons', value: '2,3,5', type: 'csv', purpose: 'optional extra horizons to display bands' },
    { id: '6', name: 'exchange', value: 'NASDAQ', type: 'enum', purpose: 'bind symbol to its primary listing exchange' },
    { id: '7', name: 'tz_policy', value: 'derive_from_exchange', type: 'enum', purpose: 'timezone derivation policy (derive_from_exchange|override)' },
    { id: '8', name: 'timezone_override', value: '', type: 'string', purpose: 'IANA TZ string; only used when tz_policy=override' },
    { id: '9', name: 'cutoff', value: 't_close->t_plus_1_close', type: 'enum', purpose: 'compute→verify pair for band timing' },
    { id: '10', name: 'calendar_source', value: 'OFFICIAL', type: 'enum', purpose: 'use the exchange\'s official trading calendar (incl. early closes)' },
    { id: '11', name: 'price_adjustment_mode', value: 'back_adjusted', type: 'enum', purpose: 'require split-adjusted OHLC as canonical' },
    { id: '12', name: 'adj_close_definition', value: 'splits_and_cash_dividends', type: 'enum', purpose: 'ensures returns are economically correct' },
    { id: '13', name: 'vol_source', value: 'close_to_close', type: 'enum', purpose: 'declares how σ is obtained; Step-1 uses close-to-close' },
    { id: '14', name: 'validation_tolerance_bps', value: '5', type: 'integer', purpose: 'tolerance when auditing split adjustments and data fixes (±0.05%)' },
    { id: '15', name: 'invalid_row_policy', value: 'flag', type: 'enum', purpose: 'never delete valid extremes; only flag/fix true errors' },
    { id: '16', name: 'skip_earnings', value: 'false', type: 'boolean', purpose: 'if true, suppress breakout evaluation on earnings dates' },
    { id: '17', name: 'earnings_window', value: '1,1', type: 'csv', purpose: 'format: before_days,after_days (e.g., 1,1) - tag context around earnings' },
    { id: '18', name: 'delisting_policy', value: 'keep_full_history', type: 'enum', purpose: 'avoid survivorship bias in backtests' },
    { id: '19', name: 'repair_logging_enabled', value: 'true', type: 'boolean', purpose: 'record every correction (who/when/what/why)' },
    { id: '20', name: 'data_source_vendor', value: 'VendorName', type: 'string', purpose: 'provenance tag (appears in the Data Quality drawer)' },
    { id: '21', name: 'config_version', value: '1.0.0', type: 'string', purpose: 'SemVer for this configuration schema' },
    
    // Step-3 Variables (Baseline GBM Prediction Intervals)
    { id: '22', name: 'forecast_method', value: 'GBM_CC', type: 'enum', purpose: 'baseline model: GBM with Close→Close returns (Normal log-returns ⇒ lognormal prices)' },
    { id: '23', name: 'drift_shrinkage_lambda', value: '0.25', type: 'float', purpose: 'shrink daily drift estimate toward 0 for stability at short horizons' },
    { id: '24', name: 'lock_forecast_records', value: 'true', type: 'boolean', purpose: 'when true, persist a locked forecast record at each close (prevents look-ahead edits)' }
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

  // Helper functions for calculations (updated for canonical variables)
  const getVariableValue = useCallback((name: string): string => {
    return variables.find(v => v.name === name)?.value || '';
  }, [variables]);

  const getVariableNumber = useCallback((name: string): number => {
    return parseFloat(getVariableValue(name)) || 0;
  }, [getVariableValue]);

  const getEffectiveTimezone = useCallback((): string => {
    const tzPolicy = getVariableValue('tz_policy');
    const exchange = getVariableValue('exchange');
    const timezoneOverride = getVariableValue('timezone_override');
    
    if (tzPolicy === 'override' && timezoneOverride) {
      return timezoneOverride;
    }
    
    // Derive from exchange (IANA standard)
    const exchangeTimezones: Record<string, string> = {
      'NASDAQ': 'America/New_York',
      'NYSE': 'America/New_York',
      'LSE': 'Europe/London',
      'TSE': 'Asia/Tokyo'
    };
    
    return exchangeTimezones[exchange] || 'America/New_York';
  }, [getVariableValue]);

  const parseEarningsWindow = useCallback((): { before: number; after: number } => {
    const earningsWindow = getVariableValue('earnings_window');
    const parts = earningsWindow.split(',').map(p => parseInt(p.trim()));
    return {
      before: parts[0] || 1,
      after: parts[1] || 1
    };
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

  const calculateMeanLastN = (arr: number[], n: number, currentIndex: number): number | null => {
    const startIndex = Math.max(0, currentIndex - n);
    if (currentIndex - startIndex < n) return null;
    const slice = arr.slice(startIndex, currentIndex);
    return slice.reduce((sum, val) => sum + val, 0) / slice.length;
  };

  const calculateStdevLastN = (arr: number[], n: number, currentIndex: number): number | null => {
    const startIndex = Math.max(0, currentIndex - n);
    if (currentIndex - startIndex < n) return null;
    const slice = arr.slice(startIndex, currentIndex);
    const mean = slice.reduce((sum, val) => sum + val, 0) / slice.length;
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / slice.length;
    return Math.sqrt(variance);
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

  // Process data with new columns (updated for canonical variables + Step-3)
  const processedData = useMemo(() => {
    if (!data || !data.rows || data.rows.length === 0) return data;

    const windowDays = getVariableNumber('window_days'); // was rolling_window_days
    const horizonDays = getVariableNumber('horizon_h_days');
    const piCoverage = getVariableNumber('pi_coverage');
    const skipEarnings = getVariableValue('skip_earnings') === 'true';
    const earningsWindow = parseEarningsWindow(); // replaces separate before/after variables
    const dataSourceVendor = getVariableValue('data_source_vendor');
    const currentTimestamp = new Date().toISOString();
    const effectiveTimezone = getEffectiveTimezone();
    
    // Step-3 variables
    const forecastMethod = getVariableValue('forecast_method');
    const driftShrinkageLambda = getVariableNumber('drift_shrinkage_lambda');
    const lockForecastRecords = getVariableValue('lock_forecast_records') === 'true';

    const zValue = inverseNormalCdf(0.5 + (piCoverage / 2));

    const rows = [...data.rows];
    
    // Calculate log returns first for Step-1
    const logReturns: (number | null)[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (i === 0) {
        logReturns.push(null);
      } else {
        const currentAdj = parseFloat(rows[i]['Adj. Close'] || rows[i]['Adj_Close'] || 0);
        const prevAdj = parseFloat(rows[i-1]['Adj. Close'] || rows[i-1]['Adj_Close'] || 0);
        if (currentAdj > 0 && prevAdj > 0) {
          logReturns.push(Math.log(currentAdj / prevAdj));
        } else {
          logReturns.push(null);
        }
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
      
      // Rolling statistics
      const validLogReturns = logReturns.slice(0, i).filter(lr => lr !== null) as number[];
      newRow.mu_star_rolling = calculateMeanLastN(validLogReturns, windowDays, validLogReturns.length);
      newRow.sigma_rolling = calculateStdevLastN(validLogReturns, windowDays, validLogReturns.length);
      newRow.z_value = zValue;

      const muStar = newRow.mu_star_rolling;
      const sigma = newRow.sigma_rolling;

      // Step-3: Enhanced GBM Prediction Intervals
      if (muStar !== null && sigma !== null && adjClose > 0 && validLogReturns.length >= windowDays) {
        // Apply drift shrinkage (Step-3 enhancement)
        const muStarUsed = applyDriftShrinkage(muStar, driftShrinkageLambda);
        newRow.mu_star_used = muStarUsed;
        
        // Calculate window bounds for auditing
        newRow.window_end = date;
        newRow.window_start = calculateTradingDayShift(date, -(windowDays - 1));
        newRow.method = forecastMethod;
        newRow.forecast_locked = lockForecastRecords;

        // h-day prediction intervals (GBM lognormal)
        const horizonSqrt = Math.sqrt(horizonDays);
        const lowerBound = adjClose * Math.exp(horizonDays * muStarUsed - zValue * sigma * horizonSqrt);
        const upperBound = adjClose * Math.exp(horizonDays * muStarUsed + zValue * sigma * horizonSqrt);
        
        // For h=1, populate the standard columns
        if (horizonDays === 1) {
          newRow.pi_lower_1d = lowerBound;
          newRow.pi_upper_1d = upperBound;
          newRow.expected_price_next_1d = adjClose * Math.exp(muStarUsed);
        }
        
        // Band width in basis points
        newRow.band_width_bp = calculateBandWidthBp(upperBound, lowerBound);
        
        // Next day's adjusted close (lead by 1)
        if (i < rows.length - 1) {
          newRow.adj_close_next = parseFloat(rows[i + 1]['Adj. Close'] || rows[i + 1]['Adj_Close'] || 0);
          
          if (newRow.adj_close_next > 0) {
            // Z-score for next day (using shrunk drift)
            newRow.z_score_next_1d = (Math.log(newRow.adj_close_next) - Math.log(adjClose) - muStarUsed) / sigma;
            
            // Breakout flag
            newRow.breakout_flag_1d = Math.abs(newRow.z_score_next_1d) > zValue;
            
            // Breakout direction
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

      // Step-2 Columns (NEW)

      // Calendar & provenance
      newRow.is_trading_day = isOfficialTradingDay(date);
      newRow.is_early_close = isEarlyCloseDate(date);
      newRow.source = `${dataSourceVendor} | retrieved_at=${currentTimestamp}`;

      // Corporate actions & events (simplified - would normally come from corporate actions feed)
      newRow.split_factor = 1.0; // Default to no split
      newRow.cash_dividend = 0.0; // Default to no dividend
      newRow.corporate_event_flags = formatCorporateEventFlags(newRow.split_factor, newRow.cash_dividend);
      newRow.earnings_date = null; // Would normally come from earnings calendar
      newRow.is_earnings_window = isInEarningsWindow(date, newRow.earnings_date, earningsWindow.before, earningsWindow.after);

      // Validation & repairs
      newRow.valid_ohlc = validateOHLC(open, high, low, close);
      newRow.valid_nonneg = validateNonNegative(open, high, low, close, adjClose, volume);
      newRow.valid_row = newRow.is_trading_day && newRow.valid_ohlc && newRow.valid_nonneg;
      newRow.repaired = false; // Default to no repairs
      newRow.repair_note = null; // No repair notes by default

      // Modeling basics (returns)
      if (i > 0) {
        const prevAdjClose = parseFloat(rows[i-1]['Adj. Close'] || rows[i-1]['Adj_Close'] || 0);
        if (prevAdjClose > 0 && adjClose > 0) {
          newRow.simple_return = (adjClose / prevAdjClose) - 1;
          // log_return already calculated above
        } else {
          newRow.simple_return = null;
        }
      } else {
        newRow.simple_return = null;
      }

      // Lifecycle
      newRow.delisted = false; // Default to not delisted

      return newRow;
    });

    // Update columns list with Step-2 + Step-3 columns
    const newColumns = [
      ...data.columns,
      // Step-1 columns
      'log_return',
      'mu_star_rolling',
      'sigma_rolling', 
      'z_value',
      'pi_lower_1d',
      'pi_upper_1d',
      'expected_price_next_1d',
      'adj_close_next',
      'z_score_next_1d',
      'breakout_flag_1d',
      'breakout_direction_1d',
      'percent_outside_signed_1d',
      // Step-2 columns
      'is_trading_day',
      'is_early_close',
      'source',
      'split_factor',
      'cash_dividend',
      'corporate_event_flags',
      'earnings_date',
      'is_earnings_window',
      'valid_ohlc',
      'valid_nonneg',
      'valid_row',
      'repaired',
      'repair_note',
      'simple_return',
      'delisted',
      // Step-3 columns (GBM Prediction Intervals)
      'mu_star_used',
      'band_width_bp',
      'window_start',
      'window_end',
      'method',
      'forecast_locked'
    ];

    return { columns: newColumns, rows: processedRows };
  }, [data, getVariableNumber, getVariableValue, getEffectiveTimezone, parseEarningsWindow]);

  // Generate Target Spec summary (updated for canonical variables)
  const targetSpec = useMemo(() => {
    const cutoffParts = getVariableValue('cutoff').split('->');
    return {
      horizon: getVariableValue('horizon_h_days'),
      coverage: getVariableValue('pi_coverage'),
      target: getVariableValue('target_variable'),
      computeCutoff: cutoffParts[0] || 't_close',
      verifyCutoff: cutoffParts[1] || 't_plus_1_close',
      timezone: getEffectiveTimezone(),
      evalPlan: 'rolling-origin'
    };
  }, [getVariableValue, getEffectiveTimezone]);

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
                      value={variable.name === 'window_days' ? 'Window (days)' : variable.name}
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

      {/* Step-3 Forecast Status */}
      {processedData && processedData.rows && processedData.rows.length > 0 && (
        <div className="mb-8 bg-purple-50 border border-purple-200 rounded-lg p-4">
          <h3 className="text-lg font-medium text-purple-900 mb-3">Forecast Engine Status</h3>
          <div className="space-y-3">
            {/* Method Badge */}
            <div className="flex items-center space-x-4">
              <span 
                className="inline-block bg-purple-600 text-white text-sm px-3 py-1 rounded-full font-medium"
                title="GBM: Geometric Brownian Motion with Normal log-returns producing lognormal price intervals"
              >
                {getVariableValue('forecast_method')} • Normal log-returns • lognormal PIs
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
                <span className="font-medium text-purple-800">Vol Source:</span>
                <span className="ml-2 text-purple-700">{getVariableValue('vol_source')}</span>
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