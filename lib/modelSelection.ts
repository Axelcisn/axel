/**
 * Model Selection and Dynamic Defaults System
 * 
 * Implements dynamic model selection based on:
 * - Interval Score (proper scoring rule for PIs)
 * - Empirical coverage vs nominal
 * - VaR diagnostics (Kupiec POF, Christoffersen CC, Traffic Light)
 * - Average band width (bps)
 */

import { computeVarDiagnostics, VarDiagnostics } from './var/backtest';
import { BacktestStorage, PISummary } from './backtest/store';
import { computeIntervalScore } from './backtest/scoring';
import fs from 'fs';
import path from 'path';

// ============================================================================
// TYPES
// ============================================================================

export type SupportedModel =
  | "GBM-CC"
  | "GARCH11-N"
  | "GARCH11-t"
  | "HAR-RV"
  | "Range-P"
  | "Range-GK"
  | "Range-RS"
  | "Range-YZ";

/**
 * Convert method string to SupportedModel format if possible
 */
export function toSupportedModel(method: string): SupportedModel | null {
  // Handle legacy GBM naming
  if (method === 'GBM' || method === 'GBM-CC') return 'GBM-CC';
  
  // All other models should match exactly
  const models: SupportedModel[] = [
    "GARCH11-N", "GARCH11-t", "HAR-RV", 
    "Range-P", "Range-GK", "Range-RS", "Range-YZ"
  ];
  
  if (models.includes(method as SupportedModel)) {
    return method as SupportedModel;
  }
  
  return null;
}

// Helper function to convert SupportedModel to VaR model format
function toVarModel(model: SupportedModel): "GBM" | "GARCH11-N" | "GARCH11-t" | "Range-P" | "Range-GK" | "Range-RS" | "Range-YZ" | null {
  // Map UI model names to VaR model names
  switch (model) {
    case "GBM-CC":
      return "GBM";
    case "GARCH11-N":
      return "GARCH11-N";
    case "GARCH11-t":
      return "GARCH11-t";
    case "Range-P":
      return "Range-P";
    case "Range-GK":
      return "Range-GK";
    case "Range-RS":
      return "Range-RS";
    case "Range-YZ":
      return "Range-YZ";
    case "HAR-RV":
      // HAR-RV not supported in VaR diagnostics yet
      return null;
    default:
      return null;
  }
}

/**
 * Parse method string back to UI state components
 */
export function parseMethodToUIState(method: SupportedModel): {
  volModel: 'GBM' | 'GARCH' | 'HAR-RV' | 'Range';
  garchEstimator?: 'Normal' | 'Student-t';
  rangeEstimator?: 'P' | 'GK' | 'RS' | 'YZ';
} {
  if (method === 'GBM-CC') {
    return { volModel: 'GBM' };
  }
  
  if (method === 'GARCH11-N') {
    return { volModel: 'GARCH', garchEstimator: 'Normal' };
  }
  
  if (method === 'GARCH11-t') {
    return { volModel: 'GARCH', garchEstimator: 'Student-t' };
  }
  
  if (method === 'HAR-RV') {
    return { volModel: 'HAR-RV' };
  }
  
  if (method.startsWith('Range-')) {
    const estimator = method.replace('Range-', '') as 'P' | 'GK' | 'RS' | 'YZ';
    return { volModel: 'Range', rangeEstimator: estimator };
  }
  
  throw new Error(`Unknown method: ${method}`);
}

export interface ModelPerformanceMetrics {
  model: SupportedModel;
  alpha: number;                // e.g. 0.05
  n: number;                    // # of days in the OOS window
  intervalScore: number;        // average Interval Score (lower better)
  coverage: number;             // empirical coverage (P(y in PI))
  coverageError: number;        // |coverage − (1 − alpha)|
  avgWidthBp: number;           // average width in basis points
  kupiecPValue: number;         // POF p-value
  ccPValue: number;             // Conditional coverage p-value
  trafficLight: "green" | "yellow" | "red";
}

export interface ModelScore {
  model: SupportedModel;
  score: number;                // lower is better
  metrics: ModelPerformanceMetrics;
  noData?: boolean;             // true when we have no real PI metrics
}

export interface ScoringWeights {
  wIntervalScore: number;
  wCoverageError: number;
  wWidthBp: number;
  wVaR: number;
}

export interface ModelSelectionOpts {
  symbol: string;
  models: SupportedModel[];
  horizonTrading: number;       // 1, 2, 3, 5
  coverage: number;             // e.g., 0.95
  startDate?: string;
  endDate?: string;
  weightsOverride?: Partial<ScoringWeights>;
}

export interface ModelSelectionResult {
  symbol: string;
  horizonTrading: number;
  coverage: number;
  modelScores: ModelScore[];
  defaultMethod: SupportedModel | null;
  selectionDate: string;
  weights: ScoringWeights;
}

export interface ModelDefaults {
  symbol: string;
  defaults: {
    [horizon: string]: {  // "1D", "2D", etc.
      [coverage: string]: SupportedModel;  // "0.95", "0.90", etc.
    };
  };
  lastUpdated: string;
}

// ============================================================================
// SCORING CONFIGURATION
// ============================================================================

const defaultWeights: ScoringWeights = {
  wIntervalScore: 1.0,          // Primary metric for PI quality
  wCoverageError: 10.0,         // Penalize miscoverage strongly
  wWidthBp: 0.01,              // Small penalty per bp of width
  wVaR: 5.0                    // Penalty for VaR test failures
};

// ============================================================================
// CORE SCORING FUNCTIONS
// ============================================================================

/**
 * Compute a single score for a model based on its performance metrics
 */
export function computeModelScore(
  metrics: ModelPerformanceMetrics,
  weights: ScoringWeights = defaultWeights
): ModelScore {
  const { 
    intervalScore, 
    coverageError, 
    avgWidthBp,
    kupiecPValue, 
    ccPValue, 
    trafficLight, 
    model 
  } = metrics;

  // VaR penalty calculation
  let varPenalty = 0;
  const minP = Math.min(kupiecPValue, ccPValue);

  // Penalize low p-values (indicating VaR test failures)
  if (minP < 0.1) {
    varPenalty += (0.1 - minP);  // Linear penalty for p < 0.1
  }

  // Additional penalty based on traffic light system
  if (trafficLight === "yellow") {
    varPenalty += 0.5;
  } else if (trafficLight === "red") {
    varPenalty += 1.0;
  }

  // Compute weighted score (lower is better)
  const score =
    weights.wIntervalScore * intervalScore +
    weights.wCoverageError * coverageError +
    weights.wWidthBp * avgWidthBp +
    weights.wVaR * varPenalty;

  return { model, score, metrics };
}

/**
 * Validate that a model has sufficient data for reliable scoring
 */
export function isModelEligible(metrics: ModelPerformanceMetrics): boolean {
  const { n, coverage } = metrics;
  
  // Minimum sample size
  if (n < 100) {
    return false;
  }
  
  // Check for degenerate coverage (all in or all out)
  const expectedBreaches = Math.round(n * (1 - coverage));
  const actualBreaches = Math.round(n * (1 - metrics.coverage));
  
  // Exclude models with zero breaches or all breaches
  if (actualBreaches <= 0 || actualBreaches >= n) {
    return false;
  }
  
  // Exclude models with NaN or infinite scores
  if (!isFinite(metrics.intervalScore) || !isFinite(metrics.avgWidthBp)) {
    return false;
  }
  
  return true;
}

// ============================================================================
// MODEL SELECTION ENGINE
// ============================================================================

/**
 * Compute model selection for a given symbol, horizon, and coverage
 */
/**
 * Enhanced PI backtest evaluation using new PISummary structure
 */
async function evaluateModelPI(opts: {
  symbol: string;
  model: SupportedModel;
  horizonTrading: number;
  coverage: number;
  startDate?: string;
  endDate?: string;
}): Promise<{
  avgIntervalScore: number;
  empiricalCoverage: number;
  avgWidthBp: number;
  count: number;
} | null> {
  const { symbol, model, horizonTrading, coverage } = opts;
  
  try {
    // Use BacktestStorage to load structured PI summary
    const storage = new BacktestStorage();
    
    // Try to load structured PI summary first
    const summary = await storage.loadPISummary(symbol, horizonTrading, coverage);
    if (summary?.piMetrics[model]) {
      const metrics = summary.piMetrics[model];
      console.log(`    Found structured PI metrics for ${model}: n=${metrics.n}`);
      
      return {
        avgIntervalScore: metrics.intervalScore,
        empiricalCoverage: metrics.empiricalCoverage,
        avgWidthBp: metrics.avgWidthBp,
        count: metrics.n
      };
    }

    // Fallback: Load legacy backtest outcome and search for model
    const outcome = await storage.loadBacktest(symbol);
    if (!outcome) {
      console.log(`    No backtest data found for ${symbol}`);
      return null;
    }

    // Filter metrics by model - Note: model naming conventions may vary
    // Handle different naming patterns: "Range-YZ" vs "Range-YZ-CC-ICP"
    const relevantMetrics = outcome.pi_metrics.filter(metric => 
      metric.method === model || 
      metric.method.startsWith(model) ||
      (model.startsWith('Range-') && metric.method.includes(model.split('-')[1]))
    );

    if (relevantMetrics.length === 0) {
      console.log(`    No metrics found for ${model}`);
      return null;
    }

    let totalIntervalScore = 0;
    let totalCovered = 0;
    let totalWidthBp = 0;
    let count = 0;

    for (const metric of relevantMetrics) {
      if (!metric.y || !metric.L || !metric.U) {
        continue;
      }

      // Use existing computed values
      totalIntervalScore += metric.interval_score;
      totalCovered += metric.cover_hit;

      // Compute width in basis points
      const width = metric.U - metric.L;
      const center = (metric.L + metric.U) / 2;
      const widthBp = (width / center) * 10000;
      totalWidthBp += widthBp;

      count++;
    }

    if (count === 0) {
      return null;
    }

    return {
      avgIntervalScore: totalIntervalScore / count,
      empiricalCoverage: totalCovered / count,
      avgWidthBp: totalWidthBp / count,
      count
    };

  } catch (error: any) {
    console.warn(`Failed to evaluate PI for ${model}:`, error?.message || String(error));
    return null;
  }
}

export async function computeModelSelection(
  opts: ModelSelectionOpts
): Promise<ModelSelectionResult> {
  const { 
    symbol, 
    models, 
    horizonTrading, 
    coverage, 
    startDate, 
    endDate,
    weightsOverride 
  } = opts;

  const weights: ScoringWeights = { ...defaultWeights, ...weightsOverride };
  const alpha = 1 - coverage;
  const modelScores: ModelScore[] = [];

  console.log(`Computing model selection for ${symbol}, h=${horizonTrading}, coverage=${coverage}`);

  // Process each model
  for (const model of models) {
    try {
      console.log(`  Evaluating ${model}...`);
      
      // Get PI evaluation metrics
      const piEvaluation = await evaluateModelPI({
        symbol,
        model,
        horizonTrading,
        coverage,
        startDate,
        endDate
      });

      if (!piEvaluation) {
        console.log(`    ❌ No PI data for ${model}, marking as no data`);
        
        // No PI backtest for this model - create noData entry
        const metrics: ModelPerformanceMetrics = {
          model,
          alpha,
          n: 0,
          intervalScore: Number.NaN,
          coverage: Number.NaN,
          coverageError: Number.NaN,
          avgWidthBp: Number.NaN,
          kupiecPValue: Number.NaN,
          ccPValue: Number.NaN,
          trafficLight: "red" as const
        };

        const ms: ModelScore = {
          model,
          score: Number.POSITIVE_INFINITY, // always worst
          metrics,
          noData: true,
        };

        modelScores.push(ms);
        // IMPORTANT: do NOT add to eligibleScores
        continue;
      }

      // Get VaR diagnostics (returns object with model keys)
      const varModel = toVarModel(model);
      if (!varModel) {
        console.log(`    ❌ VaR diagnostics not supported for ${model}`);
        // Continue without VaR metrics for this model
        const metrics: ModelPerformanceMetrics = {
          model,
          alpha,
          n: piEvaluation.count,
          intervalScore: piEvaluation.avgIntervalScore,
          coverage: piEvaluation.empiricalCoverage,
          coverageError: Math.abs(piEvaluation.empiricalCoverage - (1 - alpha)),
          avgWidthBp: piEvaluation.avgWidthBp,
          kupiecPValue: 0, // Not available
          ccPValue: 0, // Not available
          trafficLight: "red" // Conservative default
        };

        // Compute score without VaR component
        const scoreResult = computeModelScore(metrics, weights);
        modelScores.push(scoreResult);
        continue;
      }

      const varDiagnosticsResult = await computeVarDiagnostics({
        symbol,
        models: [varModel],
        horizonTrading,
        coverage,
        startDate,
        endDate
      });

      const varDiagnostics = varDiagnosticsResult[varModel];
      if (!varDiagnostics) {
        console.log(`    ❌ No VaR diagnostics for ${model}, using PI data only`);
        
        // Use PI data only with conservative VaR defaults
        const metrics: ModelPerformanceMetrics = {
          model,
          alpha,
          n: piEvaluation.count,
          intervalScore: piEvaluation.avgIntervalScore,
          coverage: piEvaluation.empiricalCoverage,
          coverageError: Math.abs(piEvaluation.empiricalCoverage - (1 - alpha)),
          avgWidthBp: piEvaluation.avgWidthBp,
          kupiecPValue: 0.001, // Conservative poor p-value
          ccPValue: 0.001, // Conservative poor p-value
          trafficLight: "red" as const // Conservative default
        };

        const scoreResult = computeModelScore(metrics, weights);
        modelScores.push(scoreResult);
        continue;
      }

      // Extract VaR metrics with proper property access
      const kupiecPValue = varDiagnostics.kupiec?.pValue || 0;
      const ccPValue = varDiagnostics.christoffersen?.pValue_cc || 0;
      const trafficLight = varDiagnostics.trafficLight || "red";
      
      // Get sample size from coverage summary
      const n = varDiagnostics.coverage?.n || piEvaluation.count;

      // Build performance metrics
      const metrics: ModelPerformanceMetrics = {
        model,
        alpha,
        n,
        intervalScore: piEvaluation.avgIntervalScore,
        coverage: piEvaluation.empiricalCoverage,
        coverageError: Math.abs(piEvaluation.empiricalCoverage - coverage),
        avgWidthBp: piEvaluation.avgWidthBp,
        kupiecPValue,
        ccPValue,
        trafficLight
      };

      // Compute model score
      const modelScore = computeModelScore(metrics, weights);
      modelScores.push(modelScore);
      
      console.log(`    ✅ ${model}: score=${modelScore.score.toFixed(3)}, IS=${metrics.intervalScore.toFixed(3)}, coverage=${(metrics.coverage*100).toFixed(1)}%`);

    } catch (error: any) {
      console.log(`    ❌ Failed to evaluate ${model}:`, error?.message || String(error));
    }
  }

  // Select default method
  const eligibleScores = modelScores.filter(ms => isModelEligible(ms.metrics));
  
  const defaultMethod = eligibleScores.length > 0
    ? eligibleScores.reduce((best, ms) => 
        ms.score < best.score ? ms : best, 
        eligibleScores[0]
      ).model
    : null;

  console.log(`  Selected default: ${defaultMethod} (${eligibleScores.length}/${models.length} eligible)`);

  return {
    symbol,
    horizonTrading,
    coverage,
    modelScores: modelScores.sort((a, b) => a.score - b.score), // Sort by score (best first)
    defaultMethod,
    selectionDate: new Date().toISOString().split('T')[0],
    weights
  };
}

// ============================================================================
// PERSISTENCE UTILITIES
// ============================================================================

/**
 * Save model selection results to JSON file
 */
export async function saveModelSelectionResult(
  symbol: string, 
  result: ModelSelectionResult
): Promise<void> {
  const dir = path.join(process.cwd(), 'data', 'modelSelection');
  
  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = path.join(dir, `${symbol}.json`);
  
  // Read existing data or create new structure
  let existingData: { [key: string]: ModelSelectionResult } = {};
  if (fs.existsSync(filePath)) {
    try {
      existingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error: any) {
      console.warn(`Failed to read existing model selection data for ${symbol}:`, error?.message || String(error));
    }
  }

  // Update with new result (keyed by horizon_coverage)
  const key = `${result.horizonTrading}D_${(result.coverage * 100).toFixed(0)}`;
  existingData[key] = result;

  // Write updated data
  fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2));
  console.log(`Saved model selection result: ${filePath} [${key}]`);
}

/**
 * Load model selection result from JSON file
 */
export function loadModelSelectionResult(
  symbol: string, 
  horizonTrading: number, 
  coverage: number
): ModelSelectionResult | null {
  const filePath = path.join(process.cwd(), 'data', 'modelSelection', `${symbol}.json`);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const key = `${horizonTrading}D_${(coverage * 100).toFixed(0)}`;
    return data[key] || null;
  } catch (error: any) {
    console.warn(`Failed to load model selection data for ${symbol}:`, error?.message || String(error));
    return null;
  }
}

/**
 * Generate and save model defaults structure
 */
export async function generateModelDefaults(
  symbol: string,
  configurations: Array<{ horizonTrading: number; coverage: number }>
): Promise<ModelDefaults> {
  const defaults: ModelDefaults['defaults'] = {};

  for (const config of configurations) {
    const { horizonTrading, coverage } = config;
    
    // Define reasonable model set for evaluation
    const models: SupportedModel[] = [
      "GBM-CC", 
      "GARCH11-N", 
      "GARCH11-t", 
      "HAR-RV",
      "Range-P", 
      "Range-GK", 
      "Range-RS", 
      "Range-YZ"
    ];

    try {
      const result = await computeModelSelection({
        symbol,
        models,
        horizonTrading,
        coverage
      });

      await saveModelSelectionResult(symbol, result);

      if (result.defaultMethod) {
        const horizonKey = `${horizonTrading}D`;
        const coverageKey = coverage.toFixed(2);
        
        if (!defaults[horizonKey]) {
          defaults[horizonKey] = {};
        }
        
        defaults[horizonKey][coverageKey] = result.defaultMethod;
      }
    } catch (error: any) {
      console.error(`Failed to compute selection for ${symbol} ${horizonTrading}D ${coverage}:`, error?.message || String(error));
    }
  }

  const modelDefaults: ModelDefaults = {
    symbol,
    defaults,
    lastUpdated: new Date().toISOString().split('T')[0]
  };

  // Save defaults summary
  const defaultsPath = path.join(process.cwd(), 'data', 'specs', `${symbol}-defaults.json`);
  fs.writeFileSync(defaultsPath, JSON.stringify(modelDefaults, null, 2));
  
  return modelDefaults;
}

/**
 * Load model defaults for a symbol
 */
export function loadModelDefaults(symbol: string): ModelDefaults | null {
  const filePath = path.join(process.cwd(), 'data', 'specs', `${symbol}-defaults.json`);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error: any) {
    console.warn(`Failed to load model defaults for ${symbol}:`, error?.message || String(error));
    return null;
  }
}

/**
 * Get recommended default model for specific symbol/horizon/coverage
 */
export function getDefaultModel(
  symbol: string, 
  horizonTrading: number, 
  coverage: number
): SupportedModel | null {
  const defaults = loadModelDefaults(symbol);
  
  if (!defaults) {
    return null;
  }

  const horizonKey = `${horizonTrading}D`;
  const coverageKey = coverage.toFixed(2);
  
  return defaults.defaults[horizonKey]?.[coverageKey] || null;
}