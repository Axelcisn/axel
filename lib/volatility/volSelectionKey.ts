export type VolModelKind = "GBM" | "GARCH" | "HAR-RV" | "Range";
export type GarchEstimatorKind = "Normal" | "Student-t";
export type RangeEstimatorKind = "P" | "GK" | "RS" | "YZ";

export interface VolSelectionKeyArgs {
  model: VolModelKind;
  h: number;
  coverage: number;
  garchEstimator?: GarchEstimatorKind;
  rangeEstimator?: RangeEstimatorKind;
}

/**
 * Stable key for storing/retrieving volatility forecasts in forecastByKey.
 * Mirrors previous inline construction: `${modelPart}|h=${h}|cov=${coverage}`
 * where modelPart reflects estimator variants.
 */
export function buildVolSelectionKey(args: VolSelectionKeyArgs): string {
  const { model, h, coverage, garchEstimator, rangeEstimator } = args;

  const modelPart =
    model === "GARCH"
      ? `GARCH-${garchEstimator ?? "Normal"}`
      : model === "Range"
        ? `Range-${rangeEstimator ?? "P"}`
        : model;

  return `${modelPart}|h=${h}|cov=${coverage}`;
}
