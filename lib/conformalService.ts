// Conformal Service - Placeholder for conformal prediction results

export interface ConformalResults {
  method: 'ICP' | 'CQR' | 'EnbPI' | 'ACI';
  coverage: number;
  intervals: Array<{
    lower: number;
    upper: number;
    date: Date;
  }>;
}