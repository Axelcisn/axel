#!/usr/bin/env node

// Cross-check script for GBM vs GARCH11-N forecasts on AAPL 2025-10-10
const fs = require('fs');

// Load the forecast files
const gbmForecast = JSON.parse(fs.readFileSync('/Users/trombadaria/Desktop/axel-1/data/forecasts/AAPL/2025-10-10-GBM-CC.json', 'utf8'));
const garchForecast = JSON.parse(fs.readFileSync('/Users/trombadaria/Desktop/axel-1/data/forecasts/AAPL/2025-10-10-GARCH11-N.json', 'utf8'));

console.log('=== 1) FORECAST DATA EXTRACTION ===');
console.log();

// 1.1 GBM Extract
const gbmData = {
  date_t: gbmForecast.date_t,
  method: gbmForecast.method,
  horizonTrading: gbmForecast.params?.h || gbmForecast.target?.h,
  h_eff_days: gbmForecast.params?.h || gbmForecast.target?.h, // GBM doesn't have h_eff_days separately
  verifyDate: "N/A", // GBM doesn't have verifyDate
  S_t: gbmForecast.S_t,
  mu_star_used: gbmForecast.estimates.mu_star_used,
  sigma_hat: gbmForecast.estimates.sigma_hat,
  pi: { L: gbmForecast.L_h, U: gbmForecast.U_h }
};

console.log('GBM:');
console.log(JSON.stringify(gbmData, null, 2));
console.log();

// 1.2 GARCH11-N Extract
const garchData = {
  date_t: garchForecast.date_t,
  method: garchForecast.method,
  horizonTrading: garchForecast.horizonTrading,
  h_eff_days: garchForecast.h_eff_days,
  verifyDate: garchForecast.verifyDate,
  S_t: garchForecast.estimates.S_t,
  estimates: {
    sigma_forecast: garchForecast.estimates.sigma_forecast,
    sigma2_forecast: garchForecast.estimates.sigma2_forecast
  },
  volatility_diagnostics: {
    omega: garchForecast.estimates.volatility_diagnostics.omega,
    alpha: garchForecast.estimates.volatility_diagnostics.alpha,
    beta: garchForecast.estimates.volatility_diagnostics.beta
  },
  pi: { L: garchForecast.intervals.L_h, U: garchForecast.intervals.U_h }
};

console.log('GARCH11-N:');
console.log(JSON.stringify(garchData, null, 2));
console.log();

console.log('=== 2) RECOMPUTE THEORETICAL BANDS ===');
console.log();

// 2.1 GBM Theoretical Bands
const S_t = gbmForecast.S_t;
const mu_star_used = gbmForecast.estimates.mu_star_used;
const sigma_hat = gbmForecast.estimates.sigma_hat;
const h_eff_days = gbmForecast.params.h; // For GBM, h = h_eff_days
const coverage = gbmForecast.target.coverage;
const c_gbm = gbmForecast.critical.z_alpha; // Normal critical value

const m_gbm = Math.log(S_t) + mu_star_used * h_eff_days;
const s_gbm = sigma_hat * Math.sqrt(h_eff_days);

const L_gbm_theory = Math.exp(m_gbm - c_gbm * s_gbm);
const U_gbm_theory = Math.exp(m_gbm + c_gbm * s_gbm);

console.log('2.1 GBM Theoretical:');
console.log(`  m_gbm = ln(${S_t}) + ${mu_star_used} * ${h_eff_days} = ${m_gbm.toFixed(6)}`);
console.log(`  s_gbm = ${sigma_hat} * sqrt(${h_eff_days}) = ${s_gbm.toFixed(6)}`);
console.log(`  c_gbm = ${c_gbm.toFixed(6)} (Normal critical for ${coverage * 100}%)`);
console.log(`  L_gbm_theory = exp(${m_gbm.toFixed(6)} - ${c_gbm.toFixed(6)} * ${s_gbm.toFixed(6)}) = ${L_gbm_theory.toFixed(6)}`);
console.log(`  U_gbm_theory = exp(${m_gbm.toFixed(6)} + ${c_gbm.toFixed(6)} * ${s_gbm.toFixed(6)}) = ${U_gbm_theory.toFixed(6)}`);

const L_gbm_stored = gbmForecast.L_h;
const U_gbm_stored = gbmForecast.U_h;

console.log(`  L_gbm_stored = ${L_gbm_stored.toFixed(6)}`);
console.log(`  U_gbm_stored = ${U_gbm_stored.toFixed(6)}`);
console.log(`  L difference: ${(L_gbm_theory - L_gbm_stored).toFixed(8)} (${((L_gbm_theory / L_gbm_stored - 1) * 100).toFixed(4)}%)`);
console.log(`  U difference: ${(U_gbm_theory - U_gbm_stored).toFixed(8)} (${((U_gbm_theory / U_gbm_stored - 1) * 100).toFixed(4)}%)`);
console.log();

// 2.2 GARCH11-N Theoretical Bands
const S_t_garch = garchForecast.estimates.S_t;
const sigma2_1d = garchForecast.estimates.sigma2_forecast;
const omega = garchForecast.estimates.volatility_diagnostics.omega;
const alpha = garchForecast.estimates.volatility_diagnostics.alpha;
const beta = garchForecast.estimates.volatility_diagnostics.beta;
const h_garch = garchForecast.horizonTrading;
const h_eff_garch = garchForecast.h_eff_days;
const coverage_garch = garchForecast.target.coverage;
const c_garch = garchForecast.critical.value; // Normal critical value

const phi = alpha + beta;
const sigma2_uncond = omega / (1 - phi);

// Multi-step variance formula: σ²_{t+h|t} = σ²_uncond + φ^{h−1} * (σ²_{t+1|t} − σ²_uncond)
const sigma2_h = sigma2_uncond + Math.pow(phi, h_garch - 1) * (sigma2_1d - sigma2_uncond);
const s_garch = Math.sqrt(sigma2_h);

// Use same drift as GBM for comparison (mu_star_used from GBM)
const m_garch = Math.log(S_t_garch) + mu_star_used * h_eff_garch;

const L_garch_theory = Math.exp(m_garch - c_garch * s_garch);
const U_garch_theory = Math.exp(m_garch + c_garch * s_garch);

console.log('2.2 GARCH11-N Theoretical:');
console.log(`  phi = α + β = ${alpha} + ${beta} = ${phi.toFixed(6)}`);
console.log(`  σ²_uncond = ω / (1 - φ) = ${omega.toExponential(6)} / (1 - ${phi.toFixed(6)}) = ${sigma2_uncond.toExponential(6)}`);
console.log(`  σ²_1d = ${sigma2_1d.toExponential(6)}`);
console.log(`  h = ${h_garch}`);
console.log(`  σ²_h = σ²_uncond + φ^(h-1) * (σ²_1d - σ²_uncond)`);
console.log(`       = ${sigma2_uncond.toExponential(6)} + ${phi.toFixed(6)}^${h_garch-1} * (${sigma2_1d.toExponential(6)} - ${sigma2_uncond.toExponential(6)})`);
console.log(`       = ${sigma2_h.toExponential(6)}`);
console.log(`  s_garch = sqrt(σ²_h) = ${s_garch.toFixed(6)}`);
console.log(`  m_garch = ln(${S_t_garch}) + ${mu_star_used} * ${h_eff_garch} = ${m_garch.toFixed(6)}`);
console.log(`  c_garch = ${c_garch.toFixed(6)} (Normal critical for ${coverage_garch * 100}%)`);
console.log(`  L_garch_theory = exp(${m_garch.toFixed(6)} - ${c_garch.toFixed(6)} * ${s_garch.toFixed(6)}) = ${L_garch_theory.toFixed(6)}`);
console.log(`  U_garch_theory = exp(${m_garch.toFixed(6)} + ${c_garch.toFixed(6)} * ${s_garch.toFixed(6)}) = ${U_garch_theory.toFixed(6)}`);

const L_garch_stored = garchForecast.intervals.L_h;
const U_garch_stored = garchForecast.intervals.U_h;

console.log(`  L_garch_stored = ${L_garch_stored.toFixed(6)}`);
console.log(`  U_garch_stored = ${U_garch_stored.toFixed(6)}`);
console.log(`  L difference: ${(L_garch_theory - L_garch_stored).toFixed(8)} (${((L_garch_theory / L_garch_stored - 1) * 100).toFixed(4)}%)`);
console.log(`  U difference: ${(U_garch_theory - U_garch_stored).toFixed(8)} (${((U_garch_theory / U_garch_stored - 1) * 100).toFixed(4)}%)`);
console.log();

console.log('=== 3) MODEL COMPARISON ===');
console.log();

// 3.1 & 3.2 Compare widths and centers
function computeStats(L, U) {
  const width = U - L;
  const center = (L + U) / 2;
  const width_bp = 10000 * (U / L - 1);
  return { L, U, center, width, width_bp };
}

const gbmStats = computeStats(L_gbm_stored, U_gbm_stored);
const garchStats = computeStats(L_garch_stored, U_garch_stored);

const comparison = {
  GBM: gbmStats,
  "GARCH11-N": garchStats
};

console.log('Model Comparison:');
console.log(JSON.stringify(comparison, null, 2));
console.log();

// Summary
const widthRatio = garchStats.width / gbmStats.width;
const centerDiff = garchStats.center - gbmStats.center;
const bpDiff = garchStats.width_bp - gbmStats.width_bp;

console.log('SUMMARY:');
console.log(`For AAPL on 2025-10-10 with horizon=1D and coverage=95%:`);
console.log(`• GARCH11-N band is ${widthRatio > 1 ? ((widthRatio - 1) * 100).toFixed(1) + '% wider' : ((1 - widthRatio) * 100).toFixed(1) + '% narrower'} than GBM`);
console.log(`• Center differs by $${centerDiff.toFixed(2)} (GARCH center ${centerDiff > 0 ? 'higher' : 'lower'})`);
console.log(`• Width difference: ${bpDiff.toFixed(1)} basis points`);
console.log(`• GBM uses σ_hat = ${sigma_hat.toFixed(6)}, GARCH uses σ_garch = ${s_garch.toFixed(6)}`);
console.log();

// Accuracy check
const gbm_accuracy = Math.abs(L_gbm_theory - L_gbm_stored) < 1e-6 && Math.abs(U_gbm_theory - U_gbm_stored) < 1e-6;
const garch_accuracy = Math.abs(L_garch_theory - L_garch_stored) < 1e-6 && Math.abs(U_garch_theory - U_garch_stored) < 1e-6;

console.log('ACCURACY CHECK:');
console.log(`• GBM theoretical vs stored: ${gbm_accuracy ? '✅ MATCH' : '❌ DISCREPANCY'}`);
console.log(`• GARCH theoretical vs stored: ${garch_accuracy ? '✅ MATCH' : '❌ DISCREPANCY'}`);

if (!gbm_accuracy || !garch_accuracy) {
  console.log('⚠️  Discrepancies found! Check implementation details.');
}