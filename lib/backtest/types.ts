export type ROConfig = {
  train_years: number;         // default 3
  step: "daily";               // fixed
  alpha: number;               // e.g., 0.05
  horizon_h: number;           // from Target Spec (default 1)
  start?: string;              // optional ISO start of OOS
  end?: string;                // optional ISO end of OOS
};

export type PIMetrics = {
  date: string;
  y: number;                   // realized AdjClose_{t+1} (or log-domained if needed)
  L: number;
  U: number;
  cover_hit: 0|1;
  interval_score: number;      // IS_α
  method: string;              // e.g., "GBM-CC", "GARCH11-t", "Range-YZ", "Conformal:CQR"
};

export type PICompare = {
  engineA: string;
  engineB: string;
  dm_stat: number;
  dm_pvalue: number;
  hac_lags: number;
};

export type SurvivalMetrics = {
  window: string;              // e.g., "20d"
  c_index?: number;
  ibs?: number;                // integrated Brier score over the window
};

export type BootstrapConfig = {
  method: "stationary";
  expected_block: number;      // ℓ
  reps: number;                // B
};

export type RegimeBreaks = {
  break_dates: string[];       // detected regime boundaries
};

export type Multiplicity = {
  fdr_q: number;               // target FDR level, e.g., 0.10
  adjusted: Array<{ id: string; p_raw: number; q_value: number }>;
};

export type OverfitGuards = {
  pbo?: number;                // Probability of Backtest Overfitting
  dsr?: number;                // Deflated Sharpe Ratio (if trading sim is enabled)
};

export type ROOutcome = {
  config: ROConfig;
  pi_metrics: PIMetrics[];     // one per OOS day per selected engine
  pi_compare?: PICompare;      // optional
  survival?: SurvivalMetrics;  // optional summary
  bootstrap?: {
    config: BootstrapConfig;
    ci: Record<string, [number, number]>; // e.g., { "coverage_250d":[0.93,0.96], "IS":[1.7,2.0] }
  };
  regimes?: RegimeBreaks;
  multiplicity?: Multiplicity;
  overfit?: OverfitGuards;
  updated_at: string;
};

// Backtest run configuration
export type BacktestRequest = {
  mode: "run";
  config: ROConfig;
  engines: string[];           // ["GBM-CC","GARCH11-t","Range-YZ","Conformal:CQR"]
  compare?: {
    A: string;
    B: string;
    hac_lags?: number;
  };
  bootstrap?: BootstrapConfig;
  regimes?: boolean;
  multiplicity?: {
    fdr_q: number;
  };
  survival?: {
    window: string;
  };
};

// Aggregated metrics for dashboard display
export type BacktestSummary = {
  coverage_60d: number;
  coverage_250d: number;
  avg_interval_score: number;
  c_index?: number;
  ibs?: number;
  dm_pvalue?: number;
  bootstrap_coverage_ci?: [number, number];
  bootstrap_is_ci?: [number, number];
  fdr_q?: number;
  regime_count?: number;
  pbo?: number;
  dsr?: number;
};