export type BinSpec = {
  z_abs_lower: number;   // inclusive
  z_abs_upper: number;   // exclusive; use Infinity for open-ended
  vol_regime?: "low" | "mid" | "high" | "any";   // optional stratification
  label: string;         // e.g., "[2.5, 3.0)"
};

export type KmBinStats = {
  bin: BinSpec;
  n_events: number;
  n_censored: number;
  S_at_k: Record<number, number>;  // k → Ŝ(k) = P̂(T≥k)
  median_T_hat: number | null;     // min{ t : Ŝ(t) ≤ 0.5 }
  I60: [number, number] | null;    // 20th–80th percentiles
  I80: [number, number] | null;    // 10th–90th percentiles
  greenwood_ci?: Record<number, [number, number]>; // optional CI bands by t
  updated_at: string;
};

export type CoxSpec = {
  formula: string;                 // "Surv(T, status) ~ |z_B| + VolReg + Earnings + ..."
  ties: "efron";
  cluster: "symbol";
};

export type CoxFit = {
  coef: Record<string, number>;
  se:   Record<string, number>;
  HR:   Record<string, number>;        // exp(beta)
  HR_CI: Record<string, [number, number]>;
  PH_ok: boolean;
  diagnostics: { schoenfeld_p?: Record<string, number> };
  performance?: { c_index?: number; ibs?: number; window?: string };
  updated_at: string;
};

export type MappingSummary = {
  symbol: string;
  bins: KmBinStats[];
  cox?: CoxFit;
  updated_at: string;
};

export type PredictionInput = {
  z_abs: number;             // |z_B| today
  vol_regime?: "low" | "mid" | "high" | "any";
  earnings?: 0 | 1;
  market5d?: number | null;  // optional covariate
  source?: "auto" | "KM" | "Cox" | "AFT";
  k_list?: number[];         // default [1,2,3,4,5]
};

export type PredictionOutput = {
  source: "KM" | "Cox" | "AFT";
  T_hat_median: number | null;
  I60: [number, number] | null;
  I80: [number, number] | null;
  P_ge_k: Record<number, number>;
};