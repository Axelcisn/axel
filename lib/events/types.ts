export type EventDirection = 1 | -1;  // +1 up, -1 down

export type EventRecord = {
  id: string;                          // uuid
  symbol: string;
  B_date: string;                      // breakout date (t+1)
  t_date: string;                      // forecast date (t)
  direction: EventDirection;           // +1 (up) or -1 (down)
  // Magnitudes at breakout:
  z_B: number;
  z_excess_B: number;                  // |z_B| − c
  pct_outside_B: number;               // % outside band at breakout
  ndist_B: number;                     // |ln(S_{t+1}) − m_t(1)| / (c*s_t)
  L_1_B: number;                       // band at t used to verify at t+1
  U_1_B: number;
  band_width_bp_B: number;
  // Regime & provenance:
  sigma_forecast_1d: number | null;    // σ_{t+1|t} if available
  vol_regime_percentile: number | null;// percentile vs trailing 3y
  earnings_window_flag?: boolean;      // optional tagging
  method_provenance: {
    base_method: string;               // e.g., "GARCH11-t" (or "GBM-CC" / "Range-YZ")
    conformal_mode?: string | null;    // e.g., "CQR" if applied
    coverage_nominal: number;          // e.g., 0.95
    critical: { type: "normal" | "t"; value: number; df?: number | null };
  };
  // Engine state:
  event_open: boolean;                 // true on creation (Step 8 will close it)
  created_at: string;                  // ISO
};