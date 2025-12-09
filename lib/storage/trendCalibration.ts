import fs from 'fs/promises';
import path from 'path';

export interface TrendWeightCalibration {
  calibrationDate: string;
  horizon: number;
  shortWindow: number;
  longWindow: number;
  lookback: number;
  symbols: string[];
  rowCount: number;
  beta0: number;
  beta1: number;
  beta2: number;
  r2: number;
  corrYBase: number;
  corrYTrend: number;
  beta2Raw?: number;
  trendSignalWeightGlobal: number;
}

const CALIBRATION_RELATIVE_PATH = path.join('data', 'calibration', 'trend-weight.json');

export async function loadTrendWeightCalibration(): Promise<TrendWeightCalibration | null> {
  try {
    const calibrationPath = path.join(process.cwd(), CALIBRATION_RELATIVE_PATH);
    const raw = await fs.readFile(calibrationPath, 'utf8');
    const parsed = JSON.parse(raw) as TrendWeightCalibration;

    if (
      !parsed ||
      typeof parsed.trendSignalWeightGlobal !== 'number' ||
      !Number.isFinite(parsed.trendSignalWeightGlobal)
    ) {
      return null;
    }

    return parsed;
  } catch (err: any) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      return null;
    }
    console.error('[TrendCalibration] Failed to load trend-weight calibration:', err);
    return null;
  }
}
