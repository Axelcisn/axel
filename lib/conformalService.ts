// Conformal Service - Placeholder for conformal prediction results

export interface ConformalInterval {
  lower: number;
  upper: number;
  date: Date;
  horizon: number;
  method: string;
}

export interface ConformalResults {
  method: 'ICP' | 'CQR' | 'EnbPI' | 'ACI';
  coverage: number;
  intervals: ConformalInterval[];
}

// Stub functions to satisfy imports until real implementation
export function computeConformalOffsets(data: any[]): { deltaL: number; deltaU: number } {
  throw new Error("computeConformalOffsets: stub implementation");
}

export function calcQCal(residuals: number[]): number {
  throw new Error("calcQCal: stub implementation");
}