'use client';

import { useDarkMode } from '@/lib/hooks/useDarkMode';
import { resolveForecastHorizon } from '@/lib/forecastUtils';

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

  // Use the most current forecast (activeForecast preferred over baseForecast)
  const forecast = activeForecast || baseForecast;
  
  // Use shared horizon resolution logic
  const horizonResolution = forecast ? resolveForecastHorizon(forecast, horizon) : null;
  const horizonValue = horizonResolution?.horizonValue ?? horizon;

  // Get lower/upper values
  const lower = forecast?.intervals?.L_conf ??
    forecast?.pi?.L_h ??
    forecast?.intervals?.L_h ??
    forecast?.L_h;
  
  const upper = forecast?.intervals?.U_conf ??
    forecast?.pi?.U_h ??
    forecast?.intervals?.U_h ??
    forecast?.U_h;

  // Get mu* and sigma values
  const muStar = forecast?.estimates?.mu_star_used ?? forecast?.estimates?.mu_star_hat;
  const sigma = forecast?.estimates?.sigma_hat;
  const center = forecast?.y_hat;

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
      {/* Title - GBM */}
      <div className="flex flex-col items-center">
        <span className={`font-semibold text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
          GBM
        </span>
        <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          Model
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
            value={calculateTargetDate(forecast.date_t, horizonValue)} 
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
                {lower != null ? `$${lower.toFixed(2)}` : '—'}
              </span>
              <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>/</span>
              <span className={`font-mono text-sm ${isDarkMode ? 'text-cyan-400' : 'text-cyan-600'}`}>
                {upper != null ? `$${upper.toFixed(2)}` : '—'}
              </span>
            </div>
            <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              L / U
            </span>
          </div>

          <Divider />
          
          {/* μ* */}
          <MetricCell 
            value={muStar != null ? muStar.toExponential(2) : '—'} 
            label="μ*"
          />

          <Divider />
          
          {/* σ */}
          <MetricCell 
            value={sigma != null ? sigma.toFixed(4) : '—'} 
            label="σ"
          />
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