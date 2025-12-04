'use client';

interface GarchForecastInspectorProps {
  symbol: string;
  volModel: string;
  garchEstimator: 'Normal' | 'Student-t';
  horizon: number;
  coverage: number;
  activeForecast: any | null;
  baseForecast: any | null;
  conformalState: any | null;
  forecastStatus: "idle" | "loading" | "ready" | "error";
  forecastError: string | null;
}

export function GarchForecastInspector(props: GarchForecastInspectorProps) {
  // Hide the inspector pill - all info is now in the chart tooltip
  return null;
}
