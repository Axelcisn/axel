import { EventRecord } from '../events/types';
import { BinSpec, KmBinStats } from './types';

/**
 * Compute KM survival estimates for events bucketed by |z_B| and optionally vol_regime
 */
export async function computeKmBins(
  events: EventRecord[], 
  binSpecs: BinSpec[],
  stratifyVol: boolean = false
): Promise<KmBinStats[]> {
  
  const results: KmBinStats[] = [];
  
  // If stratifying by vol regime, create vol regime terciles
  let volRegimeBins: Array<"low" | "mid" | "high"> = ["any"] as any;
  if (stratifyVol) {
    volRegimeBins = ["low", "mid", "high"];
  }
  
  for (const binSpec of binSpecs) {
    for (const volRegime of volRegimeBins) {
      const effectiveBin = stratifyVol 
        ? { ...binSpec, vol_regime: volRegime, label: `${binSpec.label} (${volRegime})` }
        : binSpec;
      
      // Filter events for this bin
      const binEvents = filterEventsForBin(events, effectiveBin, stratifyVol);
      
      // Only publish if n >= 40
      if (binEvents.length < 40) {
        // Don't add bins with insufficient data
        continue;
      }
      
      const kmStats = computeKmForBin(binEvents, effectiveBin);
      results.push(kmStats);
    }
  }
  
  return results;
}

/**
 * Filter events for a specific bin based on |z_B| and optionally vol_regime
 */
function filterEventsForBin(
  events: EventRecord[], 
  bin: BinSpec, 
  stratifyVol: boolean
): EventRecord[] {
  return events.filter(event => {
    // Must be closed (not open)
    if (event.event_open) return false;
    
    // Must have T value
    if (!event.T) return false;
    
    // Check |z_B| bounds
    const z_abs = Math.abs(event.z_B);
    if (z_abs < bin.z_abs_lower || z_abs >= bin.z_abs_upper) return false;
    
    // Check vol regime if stratifying
    if (stratifyVol && bin.vol_regime && bin.vol_regime !== "any") {
      const eventVolRegime = getVolRegimeCategory(event.vol_regime_percentile);
      if (eventVolRegime !== bin.vol_regime) return false;
    }
    
    return true;
  });
}

/**
 * Categorize vol regime percentile into terciles
 */
function getVolRegimeCategory(percentile: number | null): "low" | "mid" | "high" {
  if (percentile === null) return "mid"; // default
  
  if (percentile <= 0.33) return "low";
  if (percentile <= 0.67) return "mid";
  return "high";
}

/**
 * Compute KM survival estimates for a single bin
 */
function computeKmForBin(events: EventRecord[], bin: BinSpec): KmBinStats {
  const n_events = events.length;
  const n_censored = events.filter(e => e.censored).length;
  
  // Prepare data for KM computation
  const survivalData = events.map(event => ({
    time: event.T!,
    status: event.censored ? 0 : 1 // 1 = event (reverted), 0 = censored
  })).sort((a, b) => a.time - b.time);
  
  // Compute KM survival function
  const survivalFunction = computeKaplanMeier(survivalData);
  
  // Compute survival probabilities at specific time points
  const S_at_k: Record<number, number> = {};
  for (let k = 1; k <= 5; k++) {
    S_at_k[k] = getSurvivalProbability(survivalFunction, k);
  }
  
  // Compute median T̂
  const median_T_hat = computeMedianSurvival(survivalFunction);
  
  // Compute quantile intervals
  const I60 = computeQuantileInterval(survivalFunction, 0.20, 0.80);
  const I80 = computeQuantileInterval(survivalFunction, 0.10, 0.90);
  
  return {
    bin,
    n_events,
    n_censored,
    S_at_k,
    median_T_hat,
    I60,
    I80,
    updated_at: new Date().toISOString()
  };
}

/**
 * Compute Kaplan-Meier survival function
 * Ŝ(t) = Π_j (1 − d_j / r_j)
 */
function computeKaplanMeier(data: Array<{time: number, status: number}>) {
  const uniqueTimes = Array.from(new Set(data.map(d => d.time))).sort((a, b) => a - b);
  const survivalFunction: Array<{time: number, survival: number}> = [];
  
  let cumulativeSurvival = 1.0;
  
  for (const t of uniqueTimes) {
    // Number at risk at time t
    const r_j = data.filter(d => d.time >= t).length;
    
    // Number of events at time t
    const d_j = data.filter(d => d.time === t && d.status === 1).length;
    
    if (r_j > 0 && d_j > 0) {
      // Update cumulative survival
      cumulativeSurvival *= (1 - d_j / r_j);
    }
    
    survivalFunction.push({
      time: t,
      survival: cumulativeSurvival
    });
  }
  
  return survivalFunction;
}

/**
 * Get survival probability at specific time point
 */
function getSurvivalProbability(survivalFunction: Array<{time: number, survival: number}>, t: number): number {
  // Find largest time <= t
  let survival = 1.0; // Default if no events before t
  
  for (const point of survivalFunction) {
    if (point.time <= t) {
      survival = point.survival;
    } else {
      break;
    }
  }
  
  return survival;
}

/**
 * Compute median survival time
 * median_T_hat = min{ t : Ŝ(t) ≤ 0.5 }
 */
function computeMedianSurvival(survivalFunction: Array<{time: number, survival: number}>): number | null {
  for (const point of survivalFunction) {
    if (point.survival <= 0.5) {
      return point.time;
    }
  }
  return null; // Median not reached
}

/**
 * Compute quantile interval from survival function
 * I60 = [Q0.20, Q0.80], I80 = [Q0.10, Q0.90]
 * Q_p = inf{ t : F(t) ≥ p }, F(t) = 1 − Ŝ(t)
 */
function computeQuantileInterval(
  survivalFunction: Array<{time: number, survival: number}>,
  lowerP: number,
  upperP: number
): [number, number] | null {
  
  const lowerQuantile = computeQuantile(survivalFunction, lowerP);
  const upperQuantile = computeQuantile(survivalFunction, upperP);
  
  if (lowerQuantile !== null && upperQuantile !== null) {
    return [lowerQuantile, upperQuantile];
  }
  
  return null;
}

/**
 * Compute specific quantile from survival function
 */
function computeQuantile(
  survivalFunction: Array<{time: number, survival: number}>,
  p: number
): number | null {
  
  // We want F(t) = 1 - S(t) >= p
  // So S(t) <= 1 - p
  const targetSurvival = 1 - p;
  
  for (const point of survivalFunction) {
    if (point.survival <= targetSurvival) {
      return point.time;
    }
  }
  
  return null; // Quantile not reached
}