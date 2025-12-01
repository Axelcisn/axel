'use client';

import { useDarkMode } from '@/lib/hooks/useDarkMode';

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

export function GarchForecastInspector({
  symbol,
  volModel,
  garchEstimator,
  horizon,
  coverage,
  activeForecast,
  baseForecast,
  conformalState,
  forecastStatus,
  forecastError
}: GarchForecastInspectorProps) {
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

  // Extract values
  const yHat = forecast?.y_hat;
  const lower = forecast?.intervals?.L_conf ?? forecast?.intervals?.L_h ?? forecast?.L_h;
  const upper = forecast?.intervals?.U_conf ?? forecast?.intervals?.U_h ?? forecast?.U_h;
  
  // GARCH diagnostics
  const diag = forecast?.estimates?.volatility_diagnostics;
  const omega = diag?.omega;
  const alpha = diag?.alpha;
  const beta = diag?.beta;
  const alphaPlusBeta = diag?.alpha_plus_beta;
  const uncondVar = diag?.unconditional_var;

  // Status indicator
  const statusColor = forecastStatus === "ready" 
    ? "text-emerald-500" 
    : forecastStatus === "error" 
    ? "text-red-500" 
    : forecastStatus === "loading"
    ? "text-amber-500"
    : isDarkMode ? "text-gray-500" : "text-gray-400";

  const statusText = forecastStatus === "ready" 
    ? "Ready" 
    : forecastStatus === "error" 
    ? "Error" 
    : forecastStatus === "loading"
    ? "Loading..."
    : "Idle";

  // Distribution label
  const distLabel = garchEstimator === 'Student-t' ? 'Student-t' : 'Normal';

  // Divider component for cleaner code
  const Divider = () => (
    <div className={`w-px h-8 ${isDarkMode ? 'bg-gray-600' : 'bg-gray-300'}`} />
  );

  // Metric cell with value on top, label below
  const MetricCell = ({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) => (
    <div className="flex flex-col items-center">
      <span className={`font-mono text-xs ${valueColor || (isDarkMode ? 'text-gray-200' : 'text-gray-700')}`}>
        {value}
      </span>
      <span className={`text-[10px] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
        {label}
      </span>
    </div>
  );

  return (
    <div className={`inline-flex items-center gap-3 px-4 py-2 rounded-full text-xs font-medium ${
      isDarkMode 
        ? 'bg-gray-800/80 border border-gray-700' 
        : 'bg-gray-100 border border-gray-200'
    }`}>
      {/* Title - Distribution */}
      <div className="flex flex-col items-center">
        <span className={`font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
          {distLabel}
        </span>
        <span className={`text-[10px] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          GARCH
        </span>
      </div>
      
      <Divider />
      
      {/* Status */}
      <div className="flex flex-col items-center">
        <span className={statusColor}>●</span>
        <span className={`text-[10px] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          {statusText}
        </span>
      </div>

      {forecast ? (
        <>
          <Divider />
          
          {/* Center (ŷ) */}
          <MetricCell 
            value={yHat != null ? `$${yHat.toFixed(2)}` : '—'} 
            label="ŷ"
            valueColor={isDarkMode ? 'text-blue-400' : 'text-blue-600'}
          />

          <Divider />
          
          {/* Lower / Upper */}
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-1">
              <span className={`font-mono text-xs ${isDarkMode ? 'text-cyan-400' : 'text-cyan-600'}`}>
                {lower != null ? `$${lower.toFixed(2)}` : '—'}
              </span>
              <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>/</span>
              <span className={`font-mono text-xs ${isDarkMode ? 'text-cyan-400' : 'text-cyan-600'}`}>
                {upper != null ? `$${upper.toFixed(2)}` : '—'}
              </span>
            </div>
            <span className={`text-[10px] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              L / U
            </span>
          </div>

          {diag && (
            <>
              <Divider />
              <MetricCell value={omega != null ? omega.toExponential(2) : '—'} label="ω" />
              
              <Divider />
              <MetricCell value={alpha != null ? alpha.toFixed(4) : '—'} label="α" />
              
              <Divider />
              <MetricCell value={beta != null ? beta.toFixed(4) : '—'} label="β" />
              
              <Divider />
              <MetricCell value={alphaPlusBeta != null ? alphaPlusBeta.toFixed(4) : '—'} label="α+β" />
              
              <Divider />
              <MetricCell value={uncondVar != null ? uncondVar.toExponential(2) : '—'} label="σ²∞" />
            </>
          )}
        </>
      ) : (
        <>
          <Divider />
          <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>
            No forecast
          </span>
        </>
      )}
    </div>
  );
}