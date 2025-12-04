'use client';

interface GbmForecastInspectorProps {
  symbol: string;
  volModel: string;
  horizon: number;
  coverage: number;
  activeForecast: any | null;
  baseForecast: any | null;
  conformalState: any | null;
  forecastStatus: "idle" | "loading" | "ready" | "error";
  forecastError: string | null;
}

export function GbmForecastInspector(props: GbmForecastInspectorProps) {
  // Hide the inspector pill - all info is now in the chart tooltip
  return null;
}
