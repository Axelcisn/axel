import { PiComposeInput, PiComposeRecord } from './types';

/**
 * Compute GARCH(1,1) CUMULATIVE variance for h-period return (sum of h returns)
 * 
 * For GARCH(1,1): σ²_{t+i|t} = σ²_uncond + φ^{i-1} · (σ²_{t+1|t} − σ²_uncond)
 * where φ = α + β and σ²_uncond = ω / (1 − φ)
 * 
 * Cumulative variance of sum of h returns:
 * V_h = Σ_{i=1..h} σ²_{t+i|t}
 *     = h·σ²_uncond + (σ²_{t+1|t} − σ²_uncond) · Σ_{i=1..h} φ^{i-1}
 *     = h·σ²_uncond + (σ²_{t+1|t} − σ²_uncond) · (1 - φ^h) / (1 - φ)
 * 
 * This is the correct variance for the h-period log-return: ln(S_{t+h}/S_t)
 */
function computeGarchCumulativeVariance(opts: {
  sigma2_1d: number;
  omega: number;
  alpha: number;
  beta: number;
  horizonTrading: number;
}): number {
  const { sigma2_1d, omega, alpha, beta, horizonTrading } = opts;
  
  const phi = alpha + beta;
  if (phi <= 0 || phi >= 1) {
    // Fallback: IID case (α+β=0 or non-stationary)
    return sigma2_1d * horizonTrading;
  }
  
  const sigma2_uncond = omega / (1 - phi);
  const h = Math.max(1, horizonTrading);
  
  // Cumulative variance formula (accounts for mean-reversion)
  const phiPowerH = Math.pow(phi, h);
  const V_h = h * sigma2_uncond + (sigma2_1d - sigma2_uncond) * (1 - phiPowerH) / (1 - phi);
  
  return V_h;
}

/**
 * Compose PI using the exact GBM PI equations with time-varying σ
 * 
 * Formulas:
 * m_t(h) = ln(S_t) + h * mu_star_used
 * s_t(h) = sigma_forecast * sqrt(h)  [for IID models: GBM, HAR, Range]
 * s_t(h) = sqrt(V_h)                 [for GARCH: cumulative variance]
 * 
 * GARCH cumulative variance (mean-reverting):
 * V_h = h·σ²_uncond + (σ²_{t+1|t} − σ²_uncond) · (1 - φ^h) / (1 - φ)
 * 
 * Price PI bounds:
 * L_h = exp( m_t(h) − c * s_t(h) )
 * U_h = exp( m_t(h) + c * s_t(h) )
 * band_width_bp = 10000 * (U_1 / L_1 − 1)
 */
export function composePi(input: PiComposeInput): PiComposeRecord {
  const {
    h,
    mu_star_used,
    S_t,
    sigma_forecast,
    critical
  } = input;

  // m_t(h) = ln(S_t) + h * mu_star_used
  const m_log = Math.log(S_t) + h * mu_star_used;
  
  // s_t(h) computation depends on model type
  let s_scale: number;
  
  // Check if this is a GARCH forecast with parameters
  // Look for omega/alpha/beta directly in diagnostics (no nested garch_params)
  const isGarch = sigma_forecast.source.startsWith('GARCH11') && 
                  sigma_forecast.diagnostics?.omega !== undefined &&
                  sigma_forecast.diagnostics?.alpha !== undefined &&
                  sigma_forecast.diagnostics?.beta !== undefined;
  
  if (isGarch && sigma_forecast.diagnostics) {
    // Use GARCH cumulative variance formula (accounts for mean-reversion)
    const { omega, alpha, beta } = sigma_forecast.diagnostics;
    const V_h = computeGarchCumulativeVariance({
      sigma2_1d: sigma_forecast.sigma2_1d,
      omega,
      alpha,
      beta,
      horizonTrading: h
    });
    s_scale = Math.sqrt(V_h);
  } else {
    // For non-GARCH methods (GBM, HAR, Range), use standard √h scaling (IID)
    s_scale = sigma_forecast.sigma_1d * Math.sqrt(h);
  }
  
  // Critical value
  const c = critical.value;
  
  // L_h = exp( m_t(h) − c * s_t(h) )
  const L_h = Math.exp(m_log - c * s_scale);
  
  // U_h = exp( m_t(h) + c * s_t(h) )
  const U_h = Math.exp(m_log + c * s_scale);
  
  // band_width_bp = 10000 * (U_1 / L_1 − 1)
  // For this calculation, we need 1-day PI (always just sigma_1d, not scaled by horizon)
  const s_1d = sigma_forecast.sigma_1d;
  
  const m_1d = Math.log(S_t) + 1 * mu_star_used;
  const L_1 = Math.exp(m_1d - c * s_1d);
  const U_1 = Math.exp(m_1d + c * s_1d);
  const band_width_bp = 10000 * (U_1 / L_1 - 1);

  return {
    method: sigma_forecast.source,
    L_h,
    U_h,
    band_width_bp,
    m_log,
    s_scale
  };
}