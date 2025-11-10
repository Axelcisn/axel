import { loadCanonicalData } from '@/lib/storage/canonical';
import { getTargetSpec } from '@/lib/storage/targetSpecStore';
import { loadState as loadConformalState } from '@/lib/conformal/store';
import { getLatestFinalForecast } from '@/lib/forecast/store';

export type GateStatus = {
  ok: boolean;
  errors: string[];     // blocking
  warnings: string[];   // non-blocking
};

/**
 * Global validation gates - check all blocking conditions before allowing actions
 */
export async function globalGates(symbol: string): Promise<GateStatus> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Gate 1: Missing TZ/calendar → error "block compute"
    const targetSpec = await getTargetSpec(symbol);
    if (!targetSpec) {
      errors.push("Target specification required - exchange time zone not resolved");
    }

    // Gate 2: Check if canonical data exists
    const canonicalData = await loadCanonicalData(symbol);
    if (!canonicalData || canonicalData.length === 0) {
      errors.push("Canonical dataset not found - upload data first");
    } else {
      // Gate 3: N < window (active engine window) → error
      const minRequiredData = 252; // Default minimum for most models
      if (canonicalData.length < minRequiredData) {
        errors.push(`Insufficient data: ${canonicalData.length} rows available, minimum ${minRequiredData} required`);
      }

      // Gate 4: σ≈0 → error "disable"
      const validRows = canonicalData.filter(row => row.adj_close !== null && row.adj_close > 0);
      if (validRows.length > 1) {
        const returns = validRows
          .slice(1)
          .map((row, i) => Math.log(row.adj_close! / validRows[i].adj_close!))
          .filter(r => isFinite(r));
        
        if (returns.length > 0) {
          const mean = returns.reduce((s, val) => s + val, 0) / returns.length;
          const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
          const sigma = Math.sqrt(variance);
          
          if (sigma < 1e-6) {
            errors.push("Volatility too low (σ≈0) - disable volatility models");
          }
        }
      }
    }

    // Gate 5: Conformal domain change since last state → error 409-style
    const conformalState = await loadConformalState(symbol);
    const latestForecast = await getLatestFinalForecast(symbol);
    
    if (conformalState && latestForecast?.provenance?.conformal) {
      const currentDomain = latestForecast.provenance.conformal.domain;
      const stateDomain = conformalState.domain;
      
      if (currentDomain && stateDomain && currentDomain !== stateDomain) {
        errors.push(`Conformal domain conflict: existing state uses '${stateDomain}' but latest forecast uses '${currentDomain}' - recalibration required`);
      }
    }

    // Gate 6: GARCH near-integrated → warning "α+β≈1"
    if (latestForecast?.estimates?.volatility_diagnostics) {
      const diagnostics = latestForecast.estimates.volatility_diagnostics;
      if (diagnostics.alpha_plus_beta && diagnostics.alpha_plus_beta >= 0.98) {
        warnings.push(`GARCH model near-integrated (α+β=${diagnostics.alpha_plus_beta.toFixed(3)}) - consider alternative specification`);
      }
    }

    // Gate 7: Thin KM bins → warning
    // This would require checking KM model outputs, but since that's in Step 9:
    // TODO: Add thin KM bins check when KM models are available
    // warnings.push("Thin KM bins detected (n<40) - KM suppressed, fallback to Cox");

    // Gate 8: Bootstrap CI display requires metadata → warning if missing
    // This would check backtest results for bootstrap metadata
    // TODO: Add bootstrap metadata check when backtest results are available
    // warnings.push("Bootstrap CI metadata missing - display limited");

  } catch (error) {
    console.error('Gates validation error:', error);
    errors.push('Internal validation error - check system status');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Check gates for specific action with custom parameters
 */
export async function checkGatesForAction(
  symbol: string, 
  action: string, 
  params?: Record<string, any>
): Promise<GateStatus> {
  const baseGates = await globalGates(symbol);
  
  // Action-specific additional checks
  switch (action) {
    case 'volatility':
      if (params?.garch?.window || params?.har?.window || params?.range?.window) {
        const requiredWindow = params.garch?.window || params.har?.window || params.range?.window;
        const canonicalData = await loadCanonicalData(symbol);
        
        if (canonicalData && canonicalData.length < requiredWindow) {
          baseGates.errors.push(`Insufficient data for ${requiredWindow}-day window: only ${canonicalData.length} days available`);
          baseGates.ok = false;
        }
      }
      break;
      
    case 'conformal':
      if (params?.cal_window) {
        const canonicalData = await loadCanonicalData(symbol);
        
        if (canonicalData && canonicalData.length < params.cal_window) {
          baseGates.errors.push(`Insufficient data for ${params.cal_window}-day calibration window: only ${canonicalData.length} days available`);
          baseGates.ok = false;
        }
      }
      break;
  }
  
  return baseGates;
}