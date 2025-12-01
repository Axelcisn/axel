import React from "react";
import { useDarkMode } from "@/lib/hooks/useDarkMode";

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

  if (!forecast) {
    return (
      <section className="mt-6">
        <div
          className={
            "rounded-xl border p-4 text-xs " +
            (isDarkMode
              ? "bg-[#05070A] border-white/10 text-muted-foreground"
              : "bg-white border-slate-200 text-slate-500")
          }
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Range Forecast Inspector</h2>
            <span className="text-[11px]">
              {symbol} • h={horizon} • {(coverage * 100).toFixed(1)}%
            </span>
          </div>
          <p className="mt-2">
            No Range forecast available for this configuration. Select a Range
            estimator and click Generate.
          </p>
        </div>
      </section>
    );
  }

  // Extract key values
  const dateT: string = forecast.date_t ?? "—";
  const horizonValue =
    typeof forecast.horizonTrading === "number"
      ? forecast.horizonTrading
      : typeof forecast.target?.h === "number"
      ? forecast.target.h
      : horizon ?? 1;
  const horizonLabel = `${horizonValue}D`;

  const center = forecast.y_hat;
  const L =
    forecast.intervals?.L_conf ??
    forecast.intervals?.L_h ??
    forecast.L_h;
  const U =
    forecast.intervals?.U_conf ??
    forecast.intervals?.U_h ??
    forecast.U_h;

  const centerDisplay =
    typeof center === "number" ? center.toFixed(2) : "—";
  const lowerDisplay = typeof L === "number" ? L.toFixed(2) : "—";
  const upperDisplay = typeof U === "number" ? U.toFixed(2) : "—";

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
      : estimatorTag || "—";

  // EWMA lambda and window
  const lambda =
    forecast.params?.ewma_lambda ??
    forecast.estimates?.ewma_lambda ??
    forecast.provenance?.params_snapshot?.range?.ewma_lambda;
  const windowSize =
    forecast.params?.window ??
    forecast.estimates?.window ??
    forecast.provenance?.params_snapshot?.range?.window ??
    forecast.target?.window_requirements?.min_days;

  const lambdaDisplay =
    typeof lambda === "number" ? lambda.toFixed(2) : "—";
  const windowDisplay =
    typeof windowSize === "number" ? windowSize.toString() : "—";

  // Conformal coverage shortcut
  const cov = conformalState?.coverage;

  return (
    <section className="mt-6">
      <div
        className={
          "rounded-xl border p-5 space-y-5 " +
          (isDarkMode
            ? "bg-[#05070A] border-white/10"
            : "bg-white border-slate-200")
        }
      >
        {/* Header + status */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">
              Range Forecast Inspector
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-muted-foreground">Status:</span>
              <span
                className={
                  "inline-flex items-center gap-1 " +
                  (forecastStatus === "ready"
                    ? "text-emerald-500"
                    : forecastStatus === "error"
                    ? "text-red-500"
                    : "text-muted-foreground")
                }
              >
                <span className="h-[6px] w-[6px] rounded-full bg-current" />
                <span>{forecastStatus}</span>
              </span>
              {volatilityError && (
                <span className="text-red-500">
                  • {volatilityError}
                </span>
              )}
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground text-right">
            {symbol} • h={horizonValue} • {(coverage * 100).toFixed(1)}%
          </div>
        </div>

        {/* Forecast summary */}
        <div className="border-t border-border/40 pt-4">
          <h3 className="mb-3 text-xs font-semibold text-muted-foreground">
            Forecast summary
          </h3>
          <div className="grid grid-cols-2 gap-y-2 gap-x-6">
            <div className="flex flex-col">
              <span className="text-[11px] text-muted-foreground">
                Date t
              </span>
              <span className="text-sm text-foreground">{dateT}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[11px] text-muted-foreground">
                Center (ŷ)
              </span>
              <span className="text-sm font-mono tabular-nums text-foreground">
                {centerDisplay}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] text-muted-foreground">
                Horizon
              </span>
              <span className="text-sm text-foreground">{horizonLabel}</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[11px] text-muted-foreground">
                Lower / Upper
              </span>
              <span className="text-sm font-mono tabular-nums text-foreground">
                {lowerDisplay} → {upperDisplay}
              </span>
            </div>
          </div>
        </div>

        {/* Range diagnostics */}
        <div className="border-t border-border/40 pt-4">
          <h3 className="mb-3 text-xs font-semibold text-muted-foreground">
            Range diagnostics
          </h3>
          <div className="grid grid-cols-3 gap-y-2 gap-x-6">
            <div className="flex flex-col">
              <span className="text-[11px] text-muted-foreground">
                Estimator
              </span>
              <span className="text-sm text-foreground">
                {prettyEstimatorName}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[11px] text-muted-foreground">
                EWMA λ
              </span>
              <span className="text-sm font-mono tabular-nums text-foreground">
                {lambdaDisplay}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[11px] text-muted-foreground">
                Window size
              </span>
              <span className="text-sm font-mono tabular-nums text-foreground">
                {windowDisplay}
              </span>
            </div>
          </div>
        </div>

        {/* Conformal coverage */}
        <div className="border-t border-border/40 pt-4">
          <h3 className="mb-3 text-xs font-semibold text-muted-foreground">
            Conformal coverage
          </h3>
          {cov ? (
            <div className="grid grid-cols-3 gap-y-2 gap-x-6">
              <div className="flex flex-col">
                <span className="text-[11px] text-muted-foreground">
                  Last 60d
                </span>
                <span className="text-sm font-mono tabular-nums text-foreground">
                  {((cov.last60 || 0) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[11px] text-muted-foreground">
                  Calibration
                </span>
                <span className="text-sm font-mono tabular-nums text-foreground">
                  {((cov.lastCal || 0) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[11px] text-muted-foreground">
                  Misses
                </span>
                <span className="text-sm font-mono tabular-nums text-foreground">
                  {cov.miss_count ?? 0}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              No conformal state available for this configuration. Generate base
              forecasts and run Conformal again.
            </p>
          )}
        </div>

        {/* Raw forecast widget */}
        {forecast && (
          <div className="border-t border-border/40 pt-3">
            <details className="text-[10px]">
              <summary
                className={
                  "inline-flex items-center gap-1 cursor-pointer rounded-full px-2 py-[3px] bg-muted text-muted-foreground hover:bg-muted/80"
                }
              >
                <span className="text-[9px] font-mono">{`</>`}</span>
                <span>Raw forecast JSON</span>
              </summary>
              <pre
                className={
                  "mt-2 max-h-64 overflow-auto rounded-lg p-2 font-mono text-[10px] " +
                  (isDarkMode
                    ? "bg-[#05070A] text-gray-300"
                    : "bg-slate-100 text-gray-700")
                }
              >
                {JSON.stringify(forecast, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </section>
  );
}