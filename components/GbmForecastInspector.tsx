'use client';

import { useDarkMode } from '@/lib/hooks/useDarkMode';

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
  const {
    symbol,
    volModel,
    horizon,
    coverage,
    activeForecast,
    baseForecast,
    conformalState,
    forecastStatus,
    forecastError,
  } = props;

  const isDarkMode = useDarkMode();

  if (volModel !== "GBM") {
    return null;
  }

  // Filter forecast to match current horizon setting
  let forecast = null;
  
  // Check activeForecast first
  if (activeForecast && isHorizonMatch(activeForecast, horizon)) {
    forecast = activeForecast;
  }
  // Fallback to baseForecast if it matches horizon
  else if (baseForecast && isHorizonMatch(baseForecast, horizon)) {
    forecast = baseForecast;
  }
  
  // Helper function to check if forecast matches current horizon
  function isHorizonMatch(forecastData: any, targetHorizon: number): boolean {
    // Check various horizon fields in the forecast data
    const forecastHorizon = 
      forecastData?.horizonTrading ?? 
      forecastData?.target?.h ?? 
      forecastData?.params?.h ?? 
      1; // Default to 1 if no horizon found
    
    return forecastHorizon === targetHorizon;
  }

  return (
    <section className="mt-6">
      <div className={`rounded-xl border p-4 space-y-3 ${
        isDarkMode 
          ? 'bg-gray-800 border-gray-600' 
          : 'bg-white border-gray-200'
      }`}>
        <div className="flex items-center justify-between">
          <h2 className={`text-sm font-semibold ${
            isDarkMode ? 'text-white' : 'text-gray-900'
          }`}>
            GBM Forecast Inspector
          </h2>
          <span className={`text-[11px] ${
            isDarkMode ? 'text-gray-400' : 'text-gray-500'
          }`}>
            {symbol} • h={horizon} • {(coverage * 100).toFixed(1)}%
          </span>
        </div>

        {/* Status + error */}
        <div className="flex items-center justify-between text-xs">
          <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
            Status:{" "}
            <span className={
              forecastStatus === "ready"
                ? "text-emerald-600"
                : forecastStatus === "error"
                ? "text-red-600"
                : forecastStatus === "loading"
                ? "text-blue-600"
                : isDarkMode ? "text-gray-400" : "text-gray-500"
            }>
              {forecastStatus}
            </span>
          </span>
          {forecastError && (
            <span className="text-red-600 text-xs">
              {forecastError}
            </span>
          )}
        </div>

        {/* Forecast summary */}
        {forecast ? (
          <div className="text-xs space-y-1">
            <h3 className={`font-semibold ${
              isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>Forecast summary</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Date t</div>
                <div className={`font-mono ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  {forecast.date_t ?? "—"}
                </div>
              </div>
              <div>
                <div className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Horizon</div>
                <div className={`font-mono ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  {forecast.horizonTrading ?? forecast.target?.h ?? forecast.params?.h ?? "—"}D
                  {forecast.h_eff_days && forecast.h_eff_days !== (forecast.horizonTrading ?? forecast.target?.h ?? forecast.params?.h) && 
                    ` (${forecast.h_eff_days} cal)`}
                </div>
              </div>
              <div>
                <div className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Center (y_hat)</div>
                <div className={`font-mono ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  {forecast.y_hat?.toFixed?.(2) ?? "—"}
                </div>
              </div>
              <div>
                <div className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Lower / Upper</div>
                <div className={`font-mono ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  {forecast.intervals?.L_conf?.toFixed?.(2) ??
                   forecast.pi?.L_h?.toFixed?.(2) ??
                   forecast.intervals?.L_h?.toFixed?.(2) ??
                   forecast.L_h?.toFixed?.(2) ??
                   "—"}
                  {"  →  "}
                  {forecast.intervals?.U_conf?.toFixed?.(2) ??
                   forecast.pi?.U_h?.toFixed?.(2) ??
                   forecast.intervals?.U_h?.toFixed?.(2) ??
                   forecast.U_h?.toFixed?.(2) ??
                   "—"}
                </div>
              </div>
              <div>
                <div className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>μ*, σ (daily)</div>
                <div className={`font-mono ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                  {forecast.estimates?.mu_star_used?.toExponential?.(2) ??
                   forecast.estimates?.mu_star_hat?.toExponential?.(2) ??
                   "—"}
                  {" ; "}
                  {forecast.estimates?.sigma_hat?.toFixed?.(4) ?? "—"}
                </div>
              </div>
            </div>

            {/* Optional debug block */}
            <details className="mt-2 text-[10px]">
              <summary className={`cursor-pointer ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Raw forecast (debug)
              </summary>
              <pre className={`p-2 rounded-md overflow-x-auto text-[9px] ${
                isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'
              }`}>
                {JSON.stringify(forecast, null, 2)}
              </pre>
            </details>
          </div>
        ) : (
          <p className={`text-xs ${
            isDarkMode ? 'text-gray-400' : 'text-gray-500'
          }`}>
            No GBM forecast available for h={horizon}D. Click Generate to create a
            {horizon}D GBM forecast, or switch to a horizon with existing forecasts.
          </p>
        )}
      </div>
    </section>
  );
}