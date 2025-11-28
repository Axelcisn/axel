import { useDarkMode } from '@/lib/hooks/useDarkMode';

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

export function RangeForecastInspector({
  symbol,
  volModel,
  horizon,
  coverage,
  activeForecast,
  baseForecast,
  conformalState,
  forecastStatus,
  volatilityError,
}: RangeForecastInspectorProps) {
  const isDarkMode = useDarkMode();

  // Only show for Range volatility model
  if (volModel !== "Range") {
    return null;
  }

  // Choose the forecast (only if it's a Range method)
  const forecastCandidate = activeForecast || baseForecast;

  const isRangeMethod =
    forecastCandidate &&
    typeof forecastCandidate.method === "string" &&
    forecastCandidate.method.startsWith("Range-"); // e.g. "Range-P", "Range-GK"

  const forecast = isRangeMethod ? forecastCandidate : null;

  if (forecast) {
    const lower =
      forecast.intervals?.L_conf ??
      forecast.intervals?.L_h ??
      forecast.L_h;
    const upper =
      forecast.intervals?.U_conf ??
      forecast.intervals?.U_h ??
      forecast.U_h;

    const method = forecast.method ?? "Range";
    // Extract estimator tag from method, e.g. "Range-P" -> "P"
    const estimatorTag = method.split("-")[1] ?? "?";

    return (
      <section className="mt-6">
        <div className={`rounded-xl border p-4 space-y-3 ${
          isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        }`}>
          <div className="flex items-center justify-between">
            <h2 className={`text-sm font-semibold ${
              isDarkMode ? 'text-gray-100' : 'text-gray-900'
            }`}>Range Forecast Inspector</h2>
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
            {volatilityError && (
              <span className="text-red-600">{volatilityError}</span>
            )}
          </div>

          <div className="text-xs space-y-1">
            <h3 className={`font-semibold ${
              isDarkMode ? 'text-gray-200' : 'text-gray-800'
            }`}>Forecast summary</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Date t</div>
                <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                  {forecast.date_t ?? "—"}
                </div>
              </div>
              <div>
                <div className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Center (y_hat)</div>
                <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                  {forecast.y_hat?.toFixed?.(2) ?? "—"}
                </div>
              </div>
              <div>
                <div className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Horizon</div>
                <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                  {forecast.horizonTrading ?? forecast.target?.h ?? horizon}D
                </div>
              </div>
              <div>
                <div className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Lower / Upper</div>
                <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                  {lower != null ? lower.toFixed?.(2) : "—"}
                  {"  →  "}
                  {upper != null ? upper.toFixed?.(2) : "—"}
                </div>
              </div>
            </div>
          </div>

          <div className={`text-xs space-y-1 border-t pt-3 mt-2 ${
            isDarkMode ? 'border-gray-700' : 'border-gray-200'
          }`}>
            <h3 className={`font-semibold ${
              isDarkMode ? 'text-gray-200' : 'text-gray-800'
            }`}>Range diagnostics</h3>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Estimator</div>
                <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                  {estimatorTag === "P" && "Parkinson"}
                  {estimatorTag === "GK" && "Garman–Klass"}
                  {estimatorTag === "RS" && "Rogers–Satchell"}
                  {estimatorTag === "YZ" && "Yang–Zhang"}
                  {["P","GK","RS","YZ"].indexOf(estimatorTag) === -1 && estimatorTag}
                </div>
              </div>
              <div>
                <div className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>EWMA λ</div>
                <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                  {forecast.params?.ewma_lambda ??
                   forecast.estimates?.ewma_lambda ??
                   forecast.provenance?.params_snapshot?.range?.ewma_lambda ??
                   "—"}
                </div>
              </div>
              <div>
                <div className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Window size</div>
                <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                  {forecast.params?.window ?? 
                   forecast.estimates?.window ?? 
                   forecast.provenance?.params_snapshot?.range?.window ?? 
                   "—"}
                </div>
              </div>
            </div>
          </div>

          {conformalState && conformalState.coverage ? (
            <div className={`text-xs space-y-1 border-t pt-3 mt-2 ${
              isDarkMode ? 'border-gray-700' : 'border-gray-200'
            }`}>
              <h3 className={`font-semibold ${
                isDarkMode ? 'text-gray-200' : 'text-gray-800'
              }`}>Conformal coverage</h3>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Last 60d</div>
                  <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                    {((conformalState.coverage.last60 || 0) * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Calibration</div>
                  <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                    {((conformalState.coverage.lastCal || 0) * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>Misses</div>
                  <div className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                    {conformalState.coverage.miss_count ?? 0}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className={`text-xs ${
              isDarkMode ? 'text-gray-400' : 'text-gray-500'
            }`}>
              No conformal state set for this Range run. Generate base forecasts and then
              click Generate to run conformal calibration for the selected estimator and horizon.
            </p>
          )}

          {forecast && (
            <details className="mt-2 text-[10px]">
              <summary className={`cursor-pointer ${
                isDarkMode ? 'text-gray-400' : 'text-gray-500'
              }`}>
                Show raw forecast (debug)
              </summary>
              <pre className={`p-2 rounded-md overflow-x-auto ${
                isDarkMode ? 'bg-gray-900 text-gray-300' : 'bg-gray-100 text-gray-700'
              }`}>
                {JSON.stringify(forecast, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="mt-6">
      <div className={`rounded-xl border p-4 space-y-3 text-xs ${
        isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-400' : 'bg-white border-gray-200 text-gray-500'
      }`}>
        <h2 className={`text-sm font-semibold mb-1 ${
          isDarkMode ? 'text-gray-200' : 'text-gray-800'
        }`}>Range Forecast Inspector</h2>
        <p>
          No Range forecast available for h={horizon}D. Select a Range estimator and
          click Generate to compute a Range-based volatility forecast.
        </p>
      </div>
    </section>
  );
}