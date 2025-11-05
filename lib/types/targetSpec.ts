export type TargetVariable = "NEXT_CLOSE_ADJ";

export type TargetSpec = {
  symbol: string;
  exchange?: string | null;
  exchange_tz: string;           // IANA, required to save
  h: number;                     // horizon in trading days
  coverage: number;              // e.g., 0.95
  variable: TargetVariable;      // "NEXT_CLOSE_ADJ"
  cutoff_note: string;           // "compute at t close; verify at t+1 close"
  updated_at: string;            // ISO timestamp
};

export type TargetSpecResult = {
  spec: TargetSpec;
  meta: { hasTZ: boolean; source: "canonical" | "resolved" | "unknown" };
};