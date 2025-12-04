'use client';

interface RangeForecastInspectorProps {
  symbol: string;
  volModel: string;
  horizon: number;
  coverage: number;
  activeForecast: any | null;
  baseForecast: any | null;
  conformalState: any | null;
  forecastStatus: "idle" | "loading" | "ready" | "error";
  volatilityError: string | null;
}

export function RangeForecastInspector(props: RangeForecastInspectorProps) {
  // Hide the inspector pill - all info is now in the chart tooltip
  return null;
}
