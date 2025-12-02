import React from "react";
import { useDarkMode } from "@/lib/hooks/useDarkMode";
import { resolveForecastHorizon } from "@/lib/forecastUtils";

// Helper function to calculate target date (Date t+h) accounting for business days
function calculateTargetDate(dateT: string | null, horizon: number): string {
  if (!dateT) return "—";
  
  try {
    const date = new Date(dateT);
    if (isNaN(date.getTime())) return "—";
    
    let businessDaysAdded = 0;
    let currentDate = new Date(date);
    
    while (businessDaysAdded < horizon) {
      currentDate.setDate(currentDate.getDate() + 1);
      const dayOfWeek = currentDate.getDay();
      
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        businessDaysAdded++;
      }
    }
    
    // Format as MM-DD
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    return `${month}-${day}`;
  } catch (error) {
    return "—";
  }
}

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
  const {
    symbol,
    volModel,
    horizon,
    coverage,
    activeForecast,
    baseForecast,
    conformalState,
    forecastStatus,
    volatilityError,
  } = props;

  const isDarkMode = useDarkMode();

  // Only show for Range model
  if (volModel !== "Range") return null;

  // Pick forecast and ensure it's a Range method
  const candidate = activeForecast || baseForecast;
  const method: string | undefined = candidate?.method;
  const isRangeMethod = method && method.startsWith("Range-");
  const forecast = isRangeMethod ? candidate : null;

  // Extract key values
  const dateT: string = forecast?.date_t ?? null;
  
  // Use shared horizon resolution logic
  const horizonResolution = resolveForecastHorizon(forecast, horizon);
  const { horizonValue } = horizonResolution;

  const center = forecast?.y_hat;
  const L = forecast?.intervals?.L_conf ?? forecast?.intervals?.L_h ?? forecast?.L_h;
  const U = forecast?.intervals?.U_conf ?? forecast?.intervals?.U_h ?? forecast?.U_h;

  // Estimator mapping from method
  const estimatorTag = method?.split("-")[1] ?? "";
  const prettyEstimatorName =
    estimatorTag === "P"
      ? "Parkinson"
      : estimatorTag === "GK"
      ? "Garman–Klass"
      : estimatorTag === "RS"
      ? "Rogers–Satchell"
      : estimatorTag === "YZ"
      ? "Yang–Zhang"
      : "Range";

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

  // Divider component
  const Divider = () => (
    <div className={`w-px h-10 ${isDarkMode ? 'bg-gray-600' : 'bg-gray-300'}`} />
  );

  // Metric cell with value on top, label below
  const MetricCell = ({ value, label, valueColor }: { value: string; label: string; valueColor?: string }) => (
    <div className="flex flex-col items-center">
      <span className={`font-mono text-sm ${valueColor || (isDarkMode ? 'text-gray-200' : 'text-gray-700')}`}>
        {value}
      </span>
      <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
        {label}
      </span>
    </div>
  );

  return (
    <div className={`w-full flex items-center justify-evenly px-4 py-2 rounded-full text-sm font-medium ${
      isDarkMode 
        ? 'bg-gray-800/80 border border-gray-700' 
        : 'bg-gray-100 border border-gray-200'
    }`}>
      {/* Title - Estimator Name */}
      <div className="flex flex-col items-center">
        <span className={`font-semibold text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
          {prettyEstimatorName}
        </span>
        <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          Range
        </span>
      </div>
      
      <Divider />
      
      {/* Status */}
      <div className="flex flex-col items-center">
        <span className={statusColor}>●</span>
        <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          {statusText}
        </span>
      </div>

      {forecast ? (
        <>
          <Divider />
          
          {/* Date t+h */}
          <MetricCell 
            value={calculateTargetDate(dateT, horizonValue)} 
            label={`t+${horizonValue}`}
          />

          <Divider />
          
          {/* Center (ŷ) */}
          <MetricCell 
            value={center != null ? `$${center.toFixed(2)}` : '—'} 
            label="ŷ"
            valueColor={isDarkMode ? 'text-blue-400' : 'text-blue-600'}
          />

          <Divider />
          
          {/* Lower / Upper */}
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-1">
              <span className={`font-mono text-sm ${isDarkMode ? 'text-cyan-400' : 'text-cyan-600'}`}>
                {L != null ? `$${L.toFixed(2)}` : '—'}
              </span>
              <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>/</span>
              <span className={`font-mono text-sm ${isDarkMode ? 'text-cyan-400' : 'text-cyan-600'}`}>
                {U != null ? `$${U.toFixed(2)}` : '—'}
              </span>
            </div>
            <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              L / U
            </span>
          </div>
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