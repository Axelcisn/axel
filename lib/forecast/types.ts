export type ForecastMethod = "GBM-CC";

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
};

export type ForecastRecord = {
  symbol: string;
  date_t: string;            // YYYY-MM-DD for S_t (as-of)
  method: ForecastMethod;    // "GBM-CC"
  params: ForecastParams;
  estimates: GbmEstimates;
  critical: { type: "normal"; z_alpha: number };
  m_log: number;             // m_t(h) on log scale
  s_scale: number;           // s_t(h)
  L_h: number;
  U_h: number;
  band_width_bp: number;
  locked: true;              // immutability flag
  created_at: string;        // ISO
};