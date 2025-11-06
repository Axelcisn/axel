import { NextRequest, NextResponse } from 'next/server';
import { mappingStorage } from '../../../../lib/mapping/storage';
import { PredictionInput, PredictionOutput } from '../../../../lib/mapping/types';

/**
 * POST /api/mapping/predict
 * Generate survival predictions for breakout events
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { symbol, z_abs, vol_regime, source, k_list = [1, 2, 3, 4, 5] }: PredictionInput & { symbol: string } = body;
    
    if (!symbol || typeof z_abs !== 'number') {
      return NextResponse.json(
        { error: 'symbol and z_abs are required' },
        { status: 400 }
      );
    }
    
    if (z_abs < 2.0) {
      return NextResponse.json(
        { error: 'z_abs must be >= 2.0 for mapping predictions' },
        { status: 400 }
      );
    }
    
    // Load mapping data
    const mappingSummary = await mappingStorage.loadMappingSummary(symbol);
    
    if (!mappingSummary) {
      return NextResponse.json(
        { error: `No mapping data available for ${symbol}` },
        { status: 404 }
      );
    }
    
    // Auto-select prediction source if not specified
    const selectedSource = source || selectOptimalSource(mappingSummary, z_abs, vol_regime);
    
    let prediction: PredictionOutput;
    
    switch (selectedSource) {
      case 'KM':
        prediction = generateKmPrediction(mappingSummary, z_abs, vol_regime, k_list);
        break;
      case 'Cox':
        prediction = generateCoxPrediction(mappingSummary, z_abs, vol_regime, k_list);
        break;
      case 'AFT':
        // For now, fallback to Cox - AFT would be implemented similarly
        prediction = generateCoxPrediction(mappingSummary, z_abs, vol_regime, k_list);
        break;
      default:
        return NextResponse.json(
          { error: `Unsupported prediction source: ${selectedSource}` },
          { status: 400 }
        );
    }
    
    return NextResponse.json({
      success: true,
      symbol,
      input: { z_abs, vol_regime, source: selectedSource, k_list },
      prediction
    });
    
  } catch (error) {
    console.error('Prediction error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * Auto-select optimal prediction source based on available data and input
 */
function selectOptimalSource(
  mappingSummary: any,
  z_abs: number,
  vol_regime?: string
): "KM" | "Cox" | "AFT" {
  // 1. Try to find matching KM bin first (most direct)
  if (mappingSummary.bins && mappingSummary.bins.length > 0) {
    const matchingBin = mappingSummary.bins.find((binStats: any) => {
      const bin = binStats.bin;
      
      // Check |z| bounds
      if (z_abs < bin.z_abs_lower || z_abs >= bin.z_abs_upper) {
        return false;
      }
      
      // Check vol regime if specified
      if (vol_regime && vol_regime !== "any" && bin.vol_regime && bin.vol_regime !== vol_regime) {
        return false;
      }
      
      return true;
    });
    
    if (matchingBin) {
      return "KM";
    }
  }
  
  // 2. Fallback to Cox if available
  if (mappingSummary.cox && mappingSummary.cox.PH_ok) {
    return "Cox";
  }
  
  // 3. Final fallback to KM with nearest bin
  if (mappingSummary.bins && mappingSummary.bins.length > 0) {
    return "KM";
  }
  
  // Should not reach here if mapping data exists
  throw new Error('No viable prediction source available');
}

/**
 * Generate prediction using KM bins
 */
function generateKmPrediction(
  mappingSummary: any,
  z_abs: number,
  vol_regime?: string,
  k_list: number[] = [1, 2, 3, 4, 5]
): PredictionOutput {
  
  // Find best matching bin
  let bestBin = null;
  let bestScore = -1;
  
  for (const binStats of mappingSummary.bins) {
    const bin = binStats.bin;
    let score = 0;
    
    // Primary match: |z| bounds
    if (z_abs >= bin.z_abs_lower && z_abs < bin.z_abs_upper) {
      score += 100; // Exact match
    } else {
      // Distance penalty for out-of-bounds
      const lowerDist = Math.abs(z_abs - bin.z_abs_lower);
      const upperDist = Math.abs(z_abs - bin.z_abs_upper);
      const minDist = Math.min(lowerDist, upperDist);
      score = Math.max(0, 50 - minDist * 10); // Penalty increases with distance
    }
    
    // Secondary match: vol regime
    if (vol_regime && vol_regime !== "any") {
      if (bin.vol_regime === vol_regime) {
        score += 20;
      } else if (bin.vol_regime === "any") {
        score += 10; // Partial match
      }
      // No bonus/penalty for unspecified vol_regime in bin
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestBin = binStats;
    }
  }
  
  if (!bestBin) {
    throw new Error('No suitable KM bin found');
  }
  
  // Extract predictions from best bin
  const P_ge_k: Record<number, number> = {};
  for (const k of k_list) {
    P_ge_k[k] = bestBin.S_at_k[k] || 0;
  }
  
  return {
    source: "KM",
    T_hat_median: bestBin.median_T_hat,
    I60: bestBin.I60,
    I80: bestBin.I80,
    P_ge_k
  };
}

/**
 * Generate prediction using Cox model
 */
function generateCoxPrediction(
  mappingSummary: any,
  z_abs: number,
  vol_regime?: string,
  k_list: number[] = [1, 2, 3, 4, 5]
): PredictionOutput {
  
  if (!mappingSummary.cox) {
    throw new Error('Cox model not available');
  }
  
  const cox = mappingSummary.cox;
  
  // Get hazard ratio for this |z_B|
  const beta_z = cox.coef["z_abs"] || 0;
  const hr = Math.exp(beta_z * z_abs);
  
  // For Cox model, we need a baseline survival function
  // This is a simplified approach - in production would use proper baseline
  const baselineMedian = 3.0; // Assume baseline median of 3 days
  
  // Adjust survival based on hazard ratio
  // Higher HR = higher hazard = lower survival times
  const adjustedMedian = baselineMedian / hr;
  
  // Approximate survival probabilities using exponential model
  // S(t) ≈ exp(-λt), where λ is related to median: λ ≈ ln(2)/median
  const lambda = Math.log(2) / adjustedMedian;
  
  const P_ge_k: Record<number, number> = {};
  for (const k of k_list) {
    P_ge_k[k] = Math.exp(-lambda * k);
  }
  
  // Approximate confidence intervals (simplified)
  const ciWidth = 1.5; // days
  const I60: [number, number] = [
    Math.max(1, adjustedMedian - ciWidth),
    adjustedMedian + ciWidth
  ];
  const I80: [number, number] = [
    Math.max(1, adjustedMedian - 2 * ciWidth),
    adjustedMedian + 2 * ciWidth
  ];
  
  return {
    source: "Cox",
    T_hat_median: adjustedMedian,
    I60,
    I80,
    P_ge_k
  };
}