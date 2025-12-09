import { NextResponse } from 'next/server';
import { loadTrendWeightCalibration, type TrendWeightCalibration } from '@/lib/storage/trendCalibration';

export async function GET() {
  const calibration = await loadTrendWeightCalibration();

  return NextResponse.json<{ calibration: TrendWeightCalibration | null }>({
    calibration,
  });
}
