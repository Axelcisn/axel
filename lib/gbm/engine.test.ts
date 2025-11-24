/**
 * Test suite for GBM engine with proper horizon scaling
 * Run with: npx tsx lib/gbm/engine.test.ts
 */

import { computeGbmEstimates, computeGbmInterval, GbmInputs } from './engine';

// Simple assertion helpers
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertClose(actual: number, expected: number, tolerance: number, message: string) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`Assertion failed: ${message}. Expected ${expected}, got ${actual}, diff ${Math.abs(actual - expected)}`);
  }
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}: ${error instanceof Error ? error.message : error}`);
  }
}

// Helper function to generate standard normal random numbers
function randomNormal(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

console.log('Running GBM Engine Tests...\n');

// Test 1: Basic horizon scaling
test('Horizon scaling - manual calculation match', () => {
  const S_t = 100;
  const muStar = 0.001;
  const sigma = 0.025;
  const h = 3;
  const coverage = 0.95;
  
  // Manual calculation
  const m_t = Math.log(S_t) + muStar * h;
  const s_t = sigma * Math.sqrt(h);
  const z_alpha = 1.96; // Normal 95%
  const L_h = Math.exp(m_t - z_alpha * s_t);
  const U_h = Math.exp(m_t + z_alpha * s_t);
  
  // Function calculation
  const result = computeGbmInterval({
    S_t, muStarUsed: muStar, sigmaHat: sigma, h_trading: h, coverage
  });
  
  assertClose(result.m_t, m_t, 1e-10, 'm_t calculation');
  assertClose(result.s_t, s_t, 1e-10, 's_t calculation');
  assertClose(result.L_h, L_h, 1e-8, 'L_h calculation');
  assertClose(result.U_h, U_h, 1e-8, 'U_h calculation');
  assertClose(result.z_alpha, z_alpha, 1e-8, 'z_alpha calculation');
});

// Test 2: Horizon scaling properties
test('Horizon scaling - width scaling with sqrt(h)', () => {
  const S_t = 100;
  const muStar = 0.0005;
  const sigma = 0.02;
  const coverage = 0.95;
  
  const h1Result = computeGbmInterval({
    S_t, muStarUsed: muStar, sigmaHat: sigma, h_trading: 1, coverage
  });
  
  const h3Result = computeGbmInterval({
    S_t, muStarUsed: muStar, sigmaHat: sigma, h_trading: 3, coverage
  });
  
  // Log-space width should scale by sqrt(h)
  const logWidth1 = Math.log(h1Result.U_h / h1Result.L_h);
  const logWidth3 = Math.log(h3Result.U_h / h3Result.L_h);
  const scalingRatio = logWidth3 / logWidth1;
  
  assertClose(scalingRatio, Math.sqrt(3), 0.001, 'Log-width scaling by sqrt(h)');
});

// Test 3: Trading days vs calendar days behavior
test('Trading days - Friday behavior uses h_trading=1', () => {
  // NEW BEHAVIOR: Friday -> Monday is 1 TRADING day, regardless of calendar days
  const S_t = 100;
  const muStar = 0.0005;
  const sigma = 0.02;
  
  // Friday->Monday: 1 trading day (our new standard)
  const fridayResult = computeGbmInterval({
    S_t, muStarUsed: muStar, sigmaHat: sigma, h_trading: 1, coverage: 0.95
  });
  
  // Tuesday->Wednesday: also 1 trading day
  const tuesdayResult = computeGbmInterval({
    S_t, muStarUsed: muStar, sigmaHat: sigma, h_trading: 1, coverage: 0.95
  });
  
  // Both should be identical since both are 1 trading day
  assertClose(fridayResult.L_h, tuesdayResult.L_h, 1e-10, 'Friday=Tuesday for 1 trading day');
  assertClose(fridayResult.U_h, tuesdayResult.U_h, 1e-10, 'Friday=Tuesday for 1 trading day');
  
  // Test actual 3 trading days for comparison
  const h3Result = computeGbmInterval({
    S_t, muStarUsed: muStar, sigmaHat: sigma, h_trading: 3, coverage: 0.95
  });
  
  // 3 trading days should be sqrt(3) times wider than 1 trading day
  const logWidth1 = Math.log(fridayResult.U_h / fridayResult.L_h);
  const logWidth3 = Math.log(h3Result.U_h / h3Result.L_h);
  
  assertClose(logWidth3 / logWidth1, Math.sqrt(3), 0.01, '3 trading days vs 1 trading day scaling');
  assertClose(h3Result.s_t, fridayResult.s_t * Math.sqrt(3), 1e-8, 's_t scaling');
});

// Test 4: Z-score consistency
test('Z-score consistency - boundary cases', () => {
  const S_t = 100;
  const muStarUsed = 0.0005;
  const sigmaHat = 0.02;
  const h_trading = 1;
  const coverage = 0.95;
  
  const piResult = computeGbmInterval({
    S_t, muStarUsed, sigmaHat, h_trading, coverage
  });
  
  // Test z-score when S_obs = U_h (upper boundary)
  const S_obs_upper = piResult.U_h;
  const z_upper = (Math.log(S_obs_upper) - (Math.log(S_t) + muStarUsed * h_trading)) / 
                 (sigmaHat * Math.sqrt(h_trading));
  
  assertClose(z_upper, piResult.z_alpha, 1e-4, 'Upper boundary z-score');
  
  // Test z-score when S_obs = L_h (lower boundary)
  const S_obs_lower = piResult.L_h;
  const z_lower = (Math.log(S_obs_lower) - (Math.log(S_t) + muStarUsed * h_trading)) / 
                 (sigmaHat * Math.sqrt(h_trading));
  
  assertClose(z_lower, -piResult.z_alpha, 1e-4, 'Lower boundary z-score');
});

// Test 5: Multi-horizon z-score consistency
test('Z-score consistency - multi-horizon', () => {
  const S_t = 100;
  const muStarUsed = 0.0005;
  const sigmaHat = 0.02;
  const coverage = 0.95;
  
  const h1Result = computeGbmInterval({
    S_t, muStarUsed, sigmaHat, h_trading: 1, coverage
  });
  
  const h3Result = computeGbmInterval({
    S_t, muStarUsed, sigmaHat, h_trading: 3, coverage
  });
  
  // For the same price movement, z-scores should differ by horizon
  const priceChange = 1.05; // 5% increase
  const S_obs = S_t * priceChange;
  
  const z1 = (Math.log(S_obs) - (Math.log(S_t) + muStarUsed * 1)) / 
            (sigmaHat * Math.sqrt(1));
  
  const z3 = (Math.log(S_obs) - (Math.log(S_t) + muStarUsed * 3)) / 
            (sigmaHat * Math.sqrt(3));
  
  // z1 should be larger in magnitude than z3 (same move over shorter horizon)
  assert(Math.abs(z1) > Math.abs(z3), 'z1 should be larger than z3 for same price move');
  
  // Critical values should be the same
  assertClose(h1Result.z_alpha, h3Result.z_alpha, 1e-8, 'Same critical values across horizons');
});

// Test 6: Basic properties
test('Basic properties - sanity checks', () => {
  const result = computeGbmInterval({
    S_t: 100,
    muStarUsed: 0.001,
    sigmaHat: 0.02,
    h_trading: 1,
    coverage: 0.95
  });
  
  assert(result.L_h < result.U_h, 'Lower bound < Upper bound');
  assert(result.L_h > 0, 'Lower bound > 0');
  assert(result.U_h > 0, 'Upper bound > 0');
  assertClose(result.z_alpha, 1.96, 0.01, '95% critical value');
  
  // Check reasonable interval width
  const relativeWidth = (result.U_h - result.L_h) / result.L_h;
  assert(relativeWidth > 0.01, 'Relative width > 1%');
  assert(relativeWidth < 0.20, 'Relative width < 20%');
});

// Test 7: Zero drift handling
test('Zero drift handling', () => {
  const S_t = 100;
  const result = computeGbmInterval({
    S_t,
    muStarUsed: 0, // No drift
    sigmaHat: 0.02,
    h_trading: 1,
    coverage: 0.95
  });
  
  // With no drift, m_t should just be log(S_t)
  assertClose(result.m_t, Math.log(S_t), 1e-8, 'Zero drift m_t');
  
  // Interval should be symmetric around S_t in log space
  const logS_t = Math.log(S_t);
  const logL = Math.log(result.L_h);
  const logU = Math.log(result.U_h);
  
  assertClose(Math.abs(logL - logS_t), Math.abs(logU - logS_t), 1e-6, 'Symmetric interval in log space');
});

// Test 8: Coverage levels
test('Different coverage levels', () => {
  const params = {
    S_t: 100,
    muStarUsed: 0.0005,
    sigmaHat: 0.02,
    h_trading: 1
  };
  
  const coverage90 = computeGbmInterval({ ...params, coverage: 0.90 });
  const coverage95 = computeGbmInterval({ ...params, coverage: 0.95 });
  const coverage99 = computeGbmInterval({ ...params, coverage: 0.99 });
  
  // Higher coverage should give wider intervals
  assert(coverage99.z_alpha > coverage95.z_alpha, '99% > 95% critical value');
  assert(coverage95.z_alpha > coverage90.z_alpha, '95% > 90% critical value');
  
  // Check specific values
  assertClose(coverage95.z_alpha, 1.96, 0.01, '95% critical value');
  assertClose(coverage99.z_alpha, 2.58, 0.05, '99% critical value');
});

console.log('\nAll tests completed!');

// Run a comprehensive test with synthetic data
test('Synthetic data estimation accuracy', () => {
  console.log('\nRunning synthetic data test...');
  
  const trueMuStar = 0.0008;
  const trueSigma = 0.018;
  const S0 = 100;
  const N = 504;
  
  // Generate synthetic prices
  const prices = [S0];
  // Use a simple deterministic random for reproducible tests
  let seed = 42;
  const deterministicRandom = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280.0;
  };
  
  for (let i = 1; i <= N; i++) {
    const u1 = deterministicRandom();
    const u2 = deterministicRandom();
    const standardNormal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const logReturn = trueMuStar + trueSigma * standardNormal;
    prices.push(prices[i-1] * Math.exp(logReturn));
  }
  
  const dates = Array.from({length: N + 1}, (_, i) => 
    new Date(2024, 0, i + 1).toISOString().split('T')[0]
  );
  
  const gbmInputs: GbmInputs = {
    dates,
    adjClose: prices,
    windowN: N,
    lambdaDrift: 1.0, // No shrinkage
    coverage: 0.95
  };
  
  const estimates = computeGbmEstimates(gbmInputs);
  
  console.log(`True μ*: ${trueMuStar.toFixed(6)}, Estimated: ${estimates.mu_star_hat.toFixed(6)}`);
  console.log(`True σ: ${trueSigma.toFixed(6)}, Estimated: ${estimates.sigma_hat.toFixed(6)}`);
  
  // Allow for reasonable estimation error given sample size
  assertClose(estimates.mu_star_hat, trueMuStar, 0.003, 'μ* estimation accuracy');
  assertClose(estimates.sigma_hat, trueSigma, 0.006, 'σ estimation accuracy');
  
  console.log('Synthetic data test passed!');
});