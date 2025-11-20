export type SigmaSource =
  | "GBM-CC"
  | "GARCH11-N"
  | "GARCH11-t"
  | "HAR-RV"
  | "Range-P"
  | "Range-GK"
  | "Range-RS"
  | "Range-YZ";

export type VolParams = {
  // GBM (baseline)
  gbm?: {
    windowN: number;              // 252 | 504 | 756
    lambdaDrift: number;          // 0..1, shrinkage factor
  };
  // GARCH(1,1)
  garch?: {
    window: number;               // e.g., 1000
    variance_targeting: boolean;  // default true
    dist: "normal" | "student-t"; // default "normal"
    df?: number | null;           // ν if student-t
  };
  // HAR-RV
  har?: {
    window: number;               // in days for OLS fit
    use_intraday_rv: boolean;     // must be true to enable
  };
  // Range-based
  range?: {
    estimator: "P" | "GK" | "RS" | "YZ"; // default "YZ"
    window: number;               // e.g., 63
    ewma_lambda?: number | null;  // e.g., 0.94
  };
};

export type SigmaForecast = {
  source: SigmaSource;
  sigma_1d: number;                // σ_{t+1|t} (daily)
  sigma2_1d: number;               // variance forecast
  diagnostics?: Record<string, any>;
};

export type PiComposeInput = {
  symbol: string;
  date_t: string;                  // as-of date (t)
  h: number;                       // from Target Spec
  coverage: number;                // from Target Spec
  mu_star_used: number;            // from GBM drift with shrinkage λ
  S_t: number;                     // adj_close at t
  sigma_forecast: SigmaForecast;   // from selected model
  critical: { type: "normal" | "t"; value: number; df?: number };
  window_span?: { start: string; end: string };
};

export type PiComposeRecord = {
  method: SigmaSource;
  L_h: number;
  U_h: number;
  band_width_bp: number;
  m_log: number;
  s_scale: number;
};