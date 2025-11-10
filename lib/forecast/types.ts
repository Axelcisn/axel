export type ForecastMethod = "GBM-CC" | "GARCH11-N" | "GARCH11-t" | "HAR-RV" | "Range-P" | "Range-GK" | "Range-RS" | "Range-YZ";

export type ForecastParams = {
  window: number;            // 252 | 504 | 756 (default 504)
  lambda_drift: number;      // [0,1], default 0.25
  coverage: number;          // from Target Spec (e.g., 0.95)
  h: number;                 // from Target Spec (default 1)
};

export type GbmEstimates = {
  mu_star_hat: number;       // mean log-return (MLE denom N)
  sigma_hat: number;         // std log-return (MLE denom N)
  mu_star_used: number;      // lambda_drift * mu_star_hat
  window_start: string;      // YYYY-MM-DD
  window_end: string;        // YYYY-MM-DD
  n: number;                 // effective N
  S_t?: number;              // Current price (for volatility models)
  sigma_forecast?: number;   // Forecast volatility (for volatility models)
  sigma2_forecast?: number;  // Forecast variance (for volatility models)
  critical_value?: number;   // Critical value used
  window_span?: { start: string; end: string };
  volatility_diagnostics?: Record<string, any>;
};

export type ForecastRecord = {
  symbol: string;
  date_t: string;            // YYYY-MM-DD for S_t (as-of)
  method: ForecastMethod;    // "GBM-CC" | volatility models
  params?: ForecastParams;   // For GBM models
  estimates?: GbmEstimates;  // For GBM and volatility models
  target?: {                 // Target specification
    h: number;
    coverage: number;
    window_requirements?: { min_days: number };
  };
  intervals?: {              // Prediction intervals
    L_h: number;
    U_h: number;
    band_width_bp: number;
  };
  critical?: { type: "normal" | "t"; z_alpha?: number; value?: number; df?: number };
  m_log?: number;            // m_t(h) on log scale
  s_scale?: number;          // s_t(h)
  L_h?: number;              // Legacy - for backwards compatibility
  U_h?: number;              // Legacy - for backwards compatibility
  band_width_bp?: number;    // Legacy - for backwards compatibility
  diagnostics?: Record<string, any>; // Additional diagnostics
  provenance?: {
    rng_seed?: string | null;            // if any randomness used (e.g., EnbPI bagging, bootstrap)
    params_snapshot: Record<string, any>;// full params used (window, λ, dist, df, EWMA λ, etc.)
    regime_tag?: { id?: number|null, break_date?: string|null } | null;  // if latest regime detected
    conformal?: {
      mode?: string|null,
      domain?: "log"|"price"|null,
      cal_window?: number|null,
      q_cal?: number|null,
      q_cal_scaled?: number|null,
      delta_L?: number|null,
      delta_U?: number|null,
      eta?: number|null,
      theta?: number|null,
      K?: number|null
    } | null;
  };
  locked: true;              // immutability flag
  created_at: string;        // ISO
};