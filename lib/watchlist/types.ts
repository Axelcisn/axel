export type WatchlistRow = {
  symbol: string;
  as_of: string;  // ISO
  live?: number | null;

  deviation: {
    direction: "up" | "down" | "none";
    z_B?: number | null;
    z_excess_B?: number | null;
    pct_outside_B?: number | null;
    ndist_B?: number | null;
    vol_regime_pct?: number | null;
  };

  forecast: {
    source: "KM" | "Cox" | "AFT" | "none";
    T_hat_median: number | null;
    I60: [number, number] | null;
    I80: [number, number] | null;
    P_ge_k: Record<number, number>;     // e.g., {1:0.74,2:0.61,...}
    next_review_date: string | null;    // exchange local date
  };

  bands: {
    L_1: number | null;
    U_1: number | null;
    sigma_forecast: number | null;      // σ_{t+1|t} if available
    critical: { type: "normal" | "t" | "none"; value?: number; df?: number | null };
    conformal?: { mode?: string | null; delta_L?: number | null; delta_U?: number | null };
  };

  quality: {
    pi_coverage_250d?: number | null;
    interval_score?: number | null;
    c_index?: number | null;
    ibs_20d?: number | null;
    fdr_q?: number | null;
    pbo?: number | null;
    dsr?: number | null;
    regime?: { id?: number | null; break_date?: string | null } | null;
  };

  provenance: {
    pi_engine?: string | null;          // "GBM-CC"|"GARCH11-t"|...
    range_sigma?: string | null;        // "Range-YZ"|...
    conformal_mode?: string | null;     // "CQR"|...
    surv_model?: string | null;         // "Cox(efron,cluster)"|"AFT-lognormal"|...
    evaluation: "rolling-origin";
  };
};

export type WatchlistSummary = {
  as_of: string;
  rows: WatchlistRow[];
};

export type AlertRule = {
  id: string;                     // uuid
  symbol: string;
  created_at: string;
  enabled: boolean;

  // Conditions:
  threshold?: { k: number; p_min: number } | null;   // fire if P̂(T≥k) ≥ p_min today
  on_review?: boolean;                                // fire on next_review_date
  channel: "log" | "email" | "webhook";              // delivery type (impl: log now)
  webhook_url?: string | null;

  // Throttle & state:
  last_fired_at?: string | null;   // ISO (exchange TZ date boundary)
};

export type AlertFire = {
  id: string;
  symbol: string;
  fired_at: string;               // ISO
  reason: "threshold" | "next_review";
  payload: any;                   // snapshot of WatchlistRow
};

// Helper types for assembling watchlist rows
export type FinalPIRecord = {
  date: string;
  method: string;
  L: number;
  U: number;
  sigma_forecast?: number;
  critical?: { type: "normal" | "t" | "none"; value?: number; df?: number | null };
  conformal?: { mode?: string; delta_L?: number; delta_U?: number };
};

export type EventRecord = {
  symbol: string;
  date: string;
  direction: "up" | "down";
  z_B?: number;
  z_excess_B?: number;
  pct_outside_B?: number;
  ndist_B?: number;
  vol_regime_pct?: number;
};

export type MappingPrediction = {
  symbol: string;
  date: string;
  source: "KM" | "Cox" | "AFT";
  T_hat_median: number;
  I60: [number, number];
  I80: [number, number];
  P_ge_k: Record<number, number>;
};

export type BacktestQuality = {
  pi_coverage_250d?: number;
  interval_score?: number;
  c_index?: number;
  ibs_20d?: number;
  fdr_q?: number;
  pbo?: number;
  dsr?: number;
  regime?: { id?: number; break_date?: string };
};
