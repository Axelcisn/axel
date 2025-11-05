export type ConformalMode = "ICP" | "ICP-SCALED" | "CQR" | "EnbPI" | "ACI";
export type ConformalDomain = "log" | "price";   // default "log"

export type ConformalParams = {
  mode: ConformalMode;
  domain: ConformalDomain;        // default "log"
  cal_window: number;             // e.g., 250
  eta?: number | null;            // ACI step size (0.01, 0.02, 0.05)
  K?: number | null;              // EnbPI ensemble size (e.g., 20)
};

export type ConformalState = {
  symbol: string;
  mode: ConformalMode;
  domain: ConformalDomain;
  cal_window: number;
  params: {
    q_cal?: number | null;        // ICP/EnbPI
    q_cal_scaled?: number | null; // ICP-SCALED
    delta_L?: number | null;      // CQR
    delta_U?: number | null;      // CQR
    eta?: number | null;          // ACI
    theta?: number | null;        // ACI running offset
    K?: number | null;            // EnbPI
  };
  coverage: {
    last60: number | null;
    lastCal: number | null;
    miss_count: number;
  };
  updated_at: string;
};

export type ConformalApplyInput = {
  symbol: string;
  date_t?: string;            // as-of date (default latest)
  base_method?: string;       // e.g., "GARCH11-t", optional
  params: ConformalParams;
};

export type ConformalApplyResult = {
  record_path: string;        // persisted forecast path
  state: ConformalState;
};