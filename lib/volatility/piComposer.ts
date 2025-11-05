import { PiComposeInput, PiComposeRecord } from './types';

/**
 * Compose PI using the exact GBM PI equations with time-varying σ
 * 
 * Formulas:
 * m_t(h) = ln(S_t) + h * mu_star_used
 * s_t(h) = sigma_forecast * sqrt(h)
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
  
  // s_t(h) = sigma_forecast * sqrt(h)
  const s_scale = sigma_forecast.sigma_1d * Math.sqrt(h);
  
  // Critical value
  const c = critical.value;
  
  // L_h = exp( m_t(h) − c * s_t(h) )
  const L_h = Math.exp(m_log - c * s_scale);
  
  // U_h = exp( m_t(h) + c * s_t(h) )
  const U_h = Math.exp(m_log + c * s_scale);
  
  // band_width_bp = 10000 * (U_1 / L_1 − 1)
  // For this calculation, we need 1-day PI
  const s_1d = sigma_forecast.sigma_1d * Math.sqrt(1);
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