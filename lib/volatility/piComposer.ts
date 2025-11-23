import { PiComposeInput, PiComposeRecord } from './types';

/**
 * Compute GARCH(1,1) multi-step variance forecast
 * 
 * Formula: σ²_{t+h|t} = σ²_uncond + φ^{h−1} · (σ²_{t+1|t} − σ²_uncond)
 * where φ = α + β and σ²_uncond = ω / (1 − φ)
 */
function computeGarchMultiStepVariance(opts: {
  sigma2_1d: number;
  omega: number;
  alpha: number;
  beta: number;
  horizonTrading: number;
}): number {
  const { sigma2_1d, omega, alpha, beta, horizonTrading } = opts;
  
  const phi = alpha + beta;
  if (phi <= 0 || phi >= 1) {
    // Fallback: just scale 1-day variance by h as before
    return sigma2_1d * horizonTrading;
  }
  
  const sigma2_uncond = omega / (1 - phi);
  const h = Math.max(1, horizonTrading);
  const sigma2_h = sigma2_uncond + Math.pow(phi, h - 1) * (sigma2_1d - sigma2_uncond);
  
  return sigma2_h;
}

/**
 * Compose PI using the exact GBM PI equations with time-varying σ
 * 
 * Formulas:
 * m_t(h) = ln(S_t) + h * mu_star_used
 * s_t(h) = sigma_forecast * sqrt(h)  [for non-GARCH]
 * s_t(h) = sqrt(σ²_{t+h|t})         [for GARCH multi-step]
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
  const isGarch = sigma_forecast.source.startsWith('GARCH11') && 
                  sigma_forecast.diagnostics?.garch_params;
  
  if (isGarch && sigma_forecast.diagnostics?.garch_params) {
    const garchParams = sigma_forecast.diagnostics.garch_params;
    const sigma2_h = computeGarchMultiStepVariance({
      sigma2_1d: sigma_forecast.sigma2_1d,
      omega: garchParams.omega,
      alpha: garchParams.alpha,
      beta: garchParams.beta,
      horizonTrading: h
    });
    s_scale = Math.sqrt(sigma2_h);
  } else {
    // For non-GARCH methods, use standard √h scaling
    s_scale = sigma_forecast.sigma_1d * Math.sqrt(h);
  }
  
  // Critical value
  const c = critical.value;
  
  // L_h = exp( m_t(h) − c * s_t(h) )
  const L_h = Math.exp(m_log - c * s_scale);
  
  // U_h = exp( m_t(h) + c * s_t(h) )
  const U_h = Math.exp(m_log + c * s_scale);
  
  // band_width_bp = 10000 * (U_1 / L_1 − 1)
  // For this calculation, we need 1-day PI
  let s_1d: number;
  if (isGarch && sigma_forecast.diagnostics?.garch_params) {
    // Use actual 1-day GARCH forecast
    s_1d = sigma_forecast.sigma_1d;
  } else {
    s_1d = sigma_forecast.sigma_1d * Math.sqrt(1);
  }
  
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