export interface CanonicalRow {
  date: string;            // YYYY-MM-DD (exchange local date)
  open: number;
  high: number;
  low: number;
  close: number;
  adj_close: number | null;
  volume: number | null;
  split_factor?: number | null;
  cash_dividend?: number | null;
  r?: number | null;       // log return (computed)
  valid?: boolean;         // row-level validity
  issues?: string[];       // per-row issues
}

export interface CanonicalTableMeta {
  symbol: string;
  exchange?: string;
  exchange_tz: string;      // IANA
  calendar_span: { start: string; end: string };
  rows: number;
  missing_trading_days: string[];      // ISO dates
  invalid_rows: number;
  generated_at: string;
}

export interface ValidationBadges {
  contractOK: boolean;
  calendarOK: boolean;
  tzOK: boolean;
  corpActionsOK: boolean;
  validationsOK: boolean;
  repairsCount: number;
}

export interface RepairRecord {
  symbol: string;
  date: string;
  field: string;
  oldValue: any;
  newValue: any;
  reason: string;
  timestamp: string;
}

export interface IngestionResult {
  symbol: string;
  paths: { raw: string; canonical: string; audit: string };
  counts: { input: number; canonical: number; invalid: number; missingDays: number };
  meta: CanonicalTableMeta;
  badges: ValidationBadges;
}