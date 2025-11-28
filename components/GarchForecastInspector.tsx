'use client';

import { useState } from 'react';
import { useDarkMode } from '@/lib/hooks/useDarkMode';

interface GarchForecastInspectorProps {
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

export function GarchForecastInspector({
  symbol,
  volModel,
  horizon,
  coverage,
  activeForecast,
  baseForecast,
  conformalState,
  forecastStatus,
  forecastError
}: GarchForecastInspectorProps) {
  const [showRawForecast, setShowRawForecast] = useState(false);
  const isDarkMode = useDarkMode();

  // Only render when volModel is GARCH
  if (volModel !== "GARCH") {
    return null;
  }

  // Choose the forecast, but only if the method is GARCH
  const forecastCandidate = activeForecast || baseForecast;

  const isGarchMethod =
    forecastCandidate &&
    typeof forecastCandidate.method === "string" &&
    (forecastCandidate.method.startsWith("GARCH11-") ||
     forecastCandidate.method.startsWith("GARCH(1,1)"));

  const forecast = isGarchMethod ? forecastCandidate : null;

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
            GARCH(1,1) Forecast Inspector
          </h2>
          <span className={`text-[11px] ${
            isDarkMode ? 'text-gray-400' : 'text-gray-500'
          }`}>
            {symbol} • h={horizon} • {(coverage * 100).toFixed(1)}%
          </span>
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
            Status:{" "}
            <span className={
              forecastStatus === "ready"
                ? "text-emerald-600"
                : forecastStatus === "error"
                ? "text-red-600"
                : isDarkMode ? "text-gray-400" : "text-gray-500"
            }>
              {forecastStatus}
            </span>
          </span>
          {forecastError && (
            <span className="text-red-600">{forecastError}</span>
          )}
        </div>

        {forecast ? (
          <>
            {/* Forecast Summary */}
            <div className="text-xs space-y-1">
              <h3 className={`font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                Forecast summary
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Date t</div>
                  <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                    {forecast.date_t ?? "—"}
                  </div>
                </div>
                <div>
                  <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Center (y_hat)</div>
                  <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                    {forecast.y_hat?.toFixed?.(2) ?? "—"}
                  </div>
                </div>
                <div>
                  <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Horizon</div>
                  <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                    {forecast.horizonTrading ?? forecast.target?.h ?? horizon}D
                  </div>
                </div>
                <div>
                  <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Lower / Upper</div>
                  <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                    {(() => {
                      const lower =
                        forecast.intervals?.L_conf ??
                        forecast.intervals?.L_h ??
                        forecast.L_h;
                      const upper =
                        forecast.intervals?.U_conf ??
                        forecast.intervals?.U_h ??
                        forecast.U_h;
                      
                      return (
                        <>
                          {lower != null ? lower.toFixed?.(2) : "—"}
                          {"  →  "}
                          {upper != null ? upper.toFixed?.(2) : "—"}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>

            {/* GARCH Diagnostics */}
            {forecast?.estimates?.volatility_diagnostics && (
              <div className={`text-xs space-y-1 border-t pt-3 mt-2 ${
                isDarkMode ? 'border-gray-600' : 'border-gray-200'
              }`}>
                <h3 className={`font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  GARCH diagnostics
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>ω</div>
                    <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                      {forecast.estimates.volatility_diagnostics.omega?.toExponential?.(2) ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>α</div>
                    <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                      {forecast.estimates.volatility_diagnostics.alpha?.toFixed?.(4) ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>β</div>
                    <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                      {forecast.estimates.volatility_diagnostics.beta?.toFixed?.(4) ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>α+β</div>
                    <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                      {forecast.estimates.volatility_diagnostics.alpha_plus_beta?.toFixed?.(4) ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Uncond. var</div>
                    <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                      {forecast.estimates.volatility_diagnostics.unconditional_var?.toExponential?.(2) ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Dist / ν</div>
                    <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                      {forecast.estimates.volatility_diagnostics.dist ?? "—"}
                      {forecast.estimates.volatility_diagnostics.nu != null ? ` / ν=${forecast.estimates.volatility_diagnostics.nu}` : ""}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Conformal Coverage */}
            {conformalState && conformalState.coverage ? (
              <div className={`text-xs space-y-1 border-t pt-3 mt-2 ${
                isDarkMode ? 'border-gray-600' : 'border-gray-200'
              }`}>
                <h3 className={`font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  Conformal coverage
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Last 60d</div>
                    <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                      {((conformalState.coverage.last60 || 0) * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Calibration</div>
                    <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                      {((conformalState.coverage.lastCal || 0) * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <div className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Misses</div>
                    <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                      {conformalState.coverage.miss_count ?? 0}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className={`text-xs space-y-1 border-t pt-3 mt-2 ${
                isDarkMode ? 'border-gray-600' : 'border-gray-200'
              }`}>
                <h3 className={`font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  Conformal coverage
                </h3>
                <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                  No conformal state set for this run. Generate base forecasts and then click
                  Generate to run conformal calibration for the selected model and horizon.
                </p>
              </div>
            )}

            {/* Raw Forecast Debug */}
            <div className={`border-t pt-3 mt-2 ${
              isDarkMode ? 'border-gray-600' : 'border-gray-200'
            }`}>
              <button
                onClick={() => setShowRawForecast(!showRawForecast)}
                className={`text-xs transition-colors ${
                  isDarkMode 
                    ? 'text-gray-400 hover:text-gray-200' 
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {showRawForecast ? "Hide" : "Show"} raw forecast (debug)
              </button>
              
              {showRawForecast && (
                <div className={`mt-2 p-2 rounded text-xs overflow-auto max-h-48 ${
                  isDarkMode 
                    ? 'bg-gray-700 text-gray-200' 
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  <pre className="whitespace-pre-wrap font-mono text-[10px]">
                    {JSON.stringify(forecast, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            No GARCH forecast available. Select GARCH model and click Generate to create a forecast.
          </div>
        )}
      </div>
    </section>
  );
}