#!/usr/bin/env node

// Verify Student-t critical value approximation accuracy
console.log('=== STUDENT-T CRITICAL VALUE VERIFICATION ===');
console.log();

// Current implementation from lib/forecast/critical.ts
function getNormalCritical(coverage) {
  if (coverage === 0.95) return 1.96;
  if (coverage === 0.99) return 2.576;
  if (coverage === 0.90) return 1.645;
  
  const alpha = 1 - coverage;
  const p = 1 - alpha / 2;
  const t = Math.sqrt(-2 * Math.log(1 - p));
  const c0 = 2.515517;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;
  
  return t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
}

function getStudentTCritical(df, coverage) {
  const normalCrit = getNormalCritical(coverage);
  if (df <= 1) return Infinity;
  if (df >= 100) return normalCrit;
  return normalCrit * Math.sqrt(df / (df - 2));
}

// More accurate t-distribution approximation using Wilson-Hilferty transformation
function getStudentTCriticalAccurate(df, coverage) {
  const z = getNormalCritical(coverage);
  
  if (df <= 2) return Infinity;
  if (df >= 100) return z;
  
  // For reasonable accuracy, use better approximation
  if (df >= 30) {
    // Simple correction for moderate df
    return z * Math.sqrt(df / (df - 2));
  }
  
  // More accurate for small df using Cornish-Fisher expansion
  const h = 2 / (9 * df);
  const term1 = 1 - h;
  const term2 = z * Math.sqrt(h);
  const term3 = h * z * z / 3;
  
  return z * Math.sqrt((df - 2) / df) * (1 + (z * z + 1) / (4 * df) + (5 * z * z * z * z + 16 * z * z + 3) / (96 * df * df));
}

// Known exact values for comparison (from statistical tables)
const exactValues = {
  // df: { 90%: value, 95%: value, 99%: value }
  3:  { 90: 2.353, 95: 3.182, 99: 5.841 },
  4:  { 90: 2.132, 95: 2.776, 99: 4.604 },
  5:  { 90: 2.015, 95: 2.571, 99: 4.032 },
  6:  { 90: 1.943, 95: 2.447, 99: 3.707 },
  7:  { 90: 1.895, 95: 2.365, 99: 3.499 },
  8:  { 90: 1.860, 95: 2.306, 99: 3.355 },
  10: { 90: 1.812, 95: 2.228, 99: 3.169 },
  15: { 90: 1.753, 95: 2.131, 99: 2.947 },
  20: { 90: 1.725, 95: 2.086, 99: 2.845 },
  30: { 90: 1.697, 95: 2.042, 99: 2.750 }
};

console.log('1) CRITICAL VALUE ACCURACY COMPARISON');
console.log('=====================================');
console.log();

console.log('Coverage = 95%:');
console.log('df    Exact    Simple    Error(%)   Accurate  Error(%)');
console.log('----  ------   ------    --------   --------  --------');

for (const [df, values] of Object.entries(exactValues)) {
  const dfNum = parseInt(df);
  const exact = values[95];
  const simple = getStudentTCritical(dfNum, 0.95);
  const accurate = getStudentTCriticalAccurate(dfNum, 0.95);
  
  const errorSimple = ((simple - exact) / exact * 100);
  const errorAccurate = ((accurate - exact) / exact * 100);
  
  console.log(`${df.padStart(2)}    ${exact.toFixed(3)}    ${simple.toFixed(3)}     ${errorSimple.toFixed(1).padStart(5)}%    ${accurate.toFixed(3)}     ${errorAccurate.toFixed(1).padStart(5)}%`);
}

console.log();

console.log('2) SPECIFIC VERIFICATION FOR OUR FORECAST');
console.log('==========================================');
console.log();

// Check our specific case: df=8, coverage=0.95
const df = 8;
const coverage = 0.95;
const exact8_95 = 2.306; // From t-table
const stored_value = 2.263213055223333; // From our GARCH11-t forecast
const simple8 = getStudentTCritical(df, coverage);
const accurate8 = getStudentTCriticalAccurate(df, coverage);

console.log(`For df=${df}, coverage=${coverage}:`);
console.log(`Exact (t-table):        ${exact8_95}`);
console.log(`Current approximation:  ${simple8.toFixed(6)} (error: ${((simple8 - exact8_95) / exact8_95 * 100).toFixed(2)}%)`);
console.log(`Better approximation:   ${accurate8.toFixed(6)} (error: ${((accurate8 - exact8_95) / exact8_95 * 100).toFixed(2)}%)`);
console.log(`Stored value:           ${stored_value.toFixed(6)} (error: ${((stored_value - exact8_95) / exact8_95 * 100).toFixed(2)}%)`);
console.log();

console.log('3) IMPACT ON PREDICTION INTERVALS');
console.log('=================================');
console.log();

// From our GARCH forecast
const S_t = 245.27;
const sigma = 0.016997;
const m = 5.502360;

console.log(`Current implementation produces:`);
console.log(`c = ${simple8.toFixed(6)}`);
console.log(`L = exp(${m.toFixed(6)} - ${simple8.toFixed(6)} * ${sigma.toFixed(6)}) = ${Math.exp(m - simple8 * sigma).toFixed(6)}`);
console.log(`U = exp(${m.toFixed(6)} + ${simple8.toFixed(6)} * ${sigma.toFixed(6)}) = ${Math.exp(m + simple8 * sigma).toFixed(6)}`);

const width_current = Math.exp(m + simple8 * sigma) - Math.exp(m - simple8 * sigma);
console.log(`Width: $${width_current.toFixed(2)}`);
console.log();

console.log(`With exact t-critical:`);
console.log(`c = ${exact8_95.toFixed(6)}`);
console.log(`L = exp(${m.toFixed(6)} - ${exact8_95.toFixed(6)} * ${sigma.toFixed(6)}) = ${Math.exp(m - exact8_95 * sigma).toFixed(6)}`);
console.log(`U = exp(${m.toFixed(6)} + ${exact8_95.toFixed(6)} * ${sigma.toFixed(6)}) = ${Math.exp(m + exact8_95 * sigma).toFixed(6)}`);

const width_exact = Math.exp(m + exact8_95 * sigma) - Math.exp(m - exact8_95 * sigma);
console.log(`Width: $${width_exact.toFixed(2)}`);
console.log();

console.log(`Width difference: $${Math.abs(width_exact - width_current).toFixed(3)} (${((width_exact - width_current) / width_current * 100).toFixed(2)}%)`);

console.log();
console.log('4) RECOMMENDATIONS');
console.log('==================');
console.log();

const maxError = Math.max(...Object.values(exactValues).map(vals => 
  Math.abs(getStudentTCritical(Object.keys(exactValues).find(k => exactValues[k] === vals), 0.95) - vals[95]) / vals[95] * 100
));

console.log(`Current approximation maximum error: ${maxError.toFixed(2)}%`);

if (maxError > 5) {
  console.log('⚠️  Consider improving the t-critical approximation for better accuracy');
} else {
  console.log('✅ Current approximation is reasonably accurate for practical use');
}

console.log();
console.log('The current Student-t approximation:');
console.log('• Uses simple sqrt(df/(df-2)) correction');
console.log('• Provides reasonable accuracy for df ≥ 5');
console.log('• Could be improved with Cornish-Fisher expansion for small df');
console.log('• Impact on PI width is typically < 2-3%');
console.log();

if (Math.abs(stored_value - exact8_95) > 0.01) {
  console.log('🔍 Note: The stored critical value differs from both approximations.');
  console.log('   This suggests it might be computed using a different method,');
  console.log('   possibly during parameter estimation or from a lookup table.');
} else {
  console.log('✅ Stored critical value matches expected t-distribution value');
}