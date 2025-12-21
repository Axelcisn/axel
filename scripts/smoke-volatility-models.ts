#!/usr/bin/env node
/**
 * Smoke test for volatility models
 * 
 * Tests all volatility model variants (GBM, GARCH, Range, HAR) against
 * KO + random tickers to ensure the API returns valid forecasts.
 * 
 * Usage:
 *   npx tsx scripts/smoke-volatility-models.ts --baseUrl=http://localhost:3000 --symbols=KO --random=3 --seed=42
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CliArgs {
  baseUrl: string;
  symbols: string[];
  random: number;
  seed: number;
  h: number;
  cov: number;
  window: number;
  lambda: number;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    baseUrl: 'http://localhost:3000',
    symbols: ['KO'],
    random: 3,
    seed: 42,
    h: 1,
    cov: 0.95,
    window: 504,
    lambda: 0.94,
  };

  for (const arg of process.argv.slice(2)) {
    const [key, value] = arg.split('=');
    switch (key) {
      case '--baseUrl':
        args.baseUrl = value;
        break;
      case '--symbols':
        args.symbols = value.split(',').map(s => s.trim().toUpperCase());
        break;
      case '--random':
        args.random = parseInt(value, 10);
        break;
      case '--seed':
        args.seed = parseInt(value, 10);
        break;
      case '--h':
        args.h = parseInt(value, 10);
        break;
      case '--cov':
        args.cov = parseFloat(value);
        break;
      case '--window':
        args.window = parseInt(value, 10);
        break;
      case '--lambda':
        args.lambda = parseFloat(value);
        break;
    }
  }

  return args;
}

// ============================================================================
// Seeded Random Number Generator
// ============================================================================

class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    // Simple LCG (Linear Congruential Generator)
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

// ============================================================================
// Symbol Selection
// ============================================================================

function getAvailableSymbols(): string[] {
  const canonicalDir = path.join(process.cwd(), 'data', 'canonical');
  const files = fs.readdirSync(canonicalDir);
  
  return files
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .filter(s => /^[A-Z0-9]+$/.test(s)); // Only alphanumeric symbols
}

function selectRandomSymbols(
  available: string[],
  exclude: string[],
  count: number,
  seed: number
): string[] {
  const excludeSet = new Set(exclude.map(s => s.toUpperCase()));
  const candidates = available.filter(s => !excludeSet.has(s));
  
  if (candidates.length === 0) {
    console.warn('⚠️  No candidates available after exclusions');
    return [];
  }
  
  const rng = new SeededRandom(seed);
  const shuffled = rng.shuffle(candidates);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// ============================================================================
// Model Definitions
// ============================================================================

interface ModelSpec {
  name: string;
  model: string;
  params: any;
  optional?: boolean;
}

function buildModelSpecs(window: number, lambda: number): ModelSpec[] {
  return [
    // GBM
    {
      name: 'GBM',
      model: 'GBM-CC',
      params: {
        gbm: {
          windowN: window,
          lambdaDrift: lambda,
        },
      },
    },
    
    // GARCH Normal
    {
      name: 'GARCH11-N',
      model: 'GARCH11-N',
      params: {
        garch: {
          window,
          dist: 'normal',
        },
      },
    },
    
    // GARCH Student-t
    {
      name: 'GARCH11-t',
      model: 'GARCH11-t',
      params: {
        garch: {
          window,
          dist: 'student-t',
        },
      },
    },
    
    // Range estimators
    {
      name: 'Range-P',
      model: 'Range-P',
      params: {
        range: {
          window,
          ewma_lambda: lambda,
        },
      },
    },
    {
      name: 'Range-GK',
      model: 'Range-GK',
      params: {
        range: {
          window,
          ewma_lambda: lambda,
        },
      },
    },
    {
      name: 'Range-RS',
      model: 'Range-RS',
      params: {
        range: {
          window,
          ewma_lambda: lambda,
        },
      },
    },
    {
      name: 'Range-YZ',
      model: 'Range-YZ',
      params: {
        range: {
          window,
          ewma_lambda: lambda,
        },
      },
    },
    
    // HAR-RV (optional - may not have RV data)
    {
      name: 'HAR-RV',
      model: 'HAR-RV',
      params: {
        har: {
          window,
        },
      },
      optional: true,
    },
  ];
}

// ============================================================================
// API Testing
// ============================================================================

interface TestResult {
  symbol: string;
  modelName: string;
  status: number;
  outcome: 'OK' | 'FAIL' | 'SKIPPED';
  method?: string;
  sigma_1d?: number;
  y_hat?: number;
  L_h?: number;
  U_h?: number;
  bandWidthPct?: number;
  error?: string;
  mismatch?: boolean;
}

async function testVolatilityModel(
  baseUrl: string,
  symbol: string,
  spec: ModelSpec,
  h: number,
  coverage: number
): Promise<TestResult> {
  const url = `${baseUrl}/api/volatility/${symbol}`;
  const body = {
    model: spec.model,
    params: spec.params,
    h,
    coverage,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const data = await response.json();

    // Check for known HAR-RV unavailable errors
    if (spec.optional && !response.ok) {
      const errorMsg = data.error || '';
      const errorCode = data.code || '';
      if (
        errorCode === 'INSUFFICIENT_HAR_DATA' ||
        errorMsg.includes('HAR-RV disabled') ||
        errorMsg.includes('no realized volatility') ||
        errorMsg.includes('Insufficient RV data')
      ) {
        return {
          symbol,
          modelName: spec.name,
          status: response.status,
          outcome: 'SKIPPED',
          error: 'RV data not available',
        };
      }
    }

    // Check for success
    if (!response.ok) {
      return {
        symbol,
        modelName: spec.name,
        status: response.status,
        outcome: 'FAIL',
        error: data.error || data.message || `HTTP ${response.status}`,
      };
    }

    // Extract forecast data
    const method = data.method || '';
    const sigma_1d = data.estimates?.sigma_forecast || data.sigma_1d;
    const y_hat = data.y_hat;
    const L_h = data.L_h;
    const U_h = data.U_h;

    let bandWidthPct: number | undefined;
    if (y_hat && L_h !== undefined && U_h !== undefined && y_hat > 0) {
      bandWidthPct = ((U_h - L_h) / y_hat) * 100;
    }

    // Check for model mismatch
    const expectedPrefix = spec.model.split('-')[0]; // e.g., "Range" from "Range-GK"
    const mismatch = method && !method.startsWith(expectedPrefix);

    return {
      symbol,
      modelName: spec.name,
      status: response.status,
      outcome: mismatch ? 'FAIL' : 'OK',
      method,
      sigma_1d,
      y_hat,
      L_h,
      U_h,
      bandWidthPct,
      mismatch,
      error: mismatch ? `Expected ${spec.model}, got ${method}` : undefined,
    };
  } catch (error: any) {
    clearTimeout(timeout);
    
    if (error.name === 'AbortError') {
      return {
        symbol,
        modelName: spec.name,
        status: 0,
        outcome: 'FAIL',
        error: 'Request timeout (>20s)',
      };
    }

    return {
      symbol,
      modelName: spec.name,
      status: 0,
      outcome: 'FAIL',
      error: error.message || String(error),
    };
  }
}

// ============================================================================
// Output Formatting
// ============================================================================

function formatNumber(n: number | undefined, decimals: number = 4): string {
  if (n === undefined || n === null) return '-';
  return n.toFixed(decimals);
}

function printResults(results: TestResult[], symbol: string) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`SYMBOL: ${symbol}`);
  console.log('='.repeat(80));
  console.log(
    `${'Model'.padEnd(15)} ${'Status'.padEnd(8)} ${'Result'.padEnd(9)} ${'Method'.padEnd(12)} ${'σ₁d'.padEnd(10)} ${'ŷ'.padEnd(10)} ${'L_h'.padEnd(10)} ${'U_h'.padEnd(10)} ${'BW%'.padEnd(8)}`
  );
  console.log('-'.repeat(80));

  for (const result of results) {
    const statusStr = result.status > 0 ? String(result.status) : 'ERR';
    const outcomeColor =
      result.outcome === 'OK'
        ? '\x1b[32m' // green
        : result.outcome === 'SKIPPED'
        ? '\x1b[33m' // yellow
        : '\x1b[31m'; // red
    const resetColor = '\x1b[0m';

    console.log(
      `${result.modelName.padEnd(15)} ` +
        `${statusStr.padEnd(8)} ` +
        `${outcomeColor}${result.outcome.padEnd(9)}${resetColor} ` +
        `${(result.method || '-').padEnd(12)} ` +
        `${formatNumber(result.sigma_1d).padEnd(10)} ` +
        `${formatNumber(result.y_hat, 2).padEnd(10)} ` +
        `${formatNumber(result.L_h, 2).padEnd(10)} ` +
        `${formatNumber(result.U_h, 2).padEnd(10)} ` +
        `${formatNumber(result.bandWidthPct, 2).padEnd(8)}`
    );

    if (result.error) {
      console.log(`  └─ Error: ${result.error}`);
    }
    if (result.mismatch) {
      console.log(`  └─ ⚠️  Model mismatch!`);
    }
  }
}

function printSummary(allResults: TestResult[]) {
  const total = allResults.length;
  const ok = allResults.filter(r => r.outcome === 'OK').length;
  const failed = allResults.filter(r => r.outcome === 'FAIL').length;
  const skipped = allResults.filter(r => r.outcome === 'SKIPPED').length;

  console.log(`\n${'='.repeat(80)}`);
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total tests:    ${total}`);
  console.log(`\x1b[32m✓ Passed:       ${ok}\x1b[0m`);
  console.log(`\x1b[31m✗ Failed:       ${failed}\x1b[0m`);
  console.log(`\x1b[33m⊘ Skipped:      ${skipped}\x1b[0m`);
  console.log('='.repeat(80));

  if (failed > 0) {
    console.log('\n\x1b[31m❌ SMOKE TEST FAILED\x1b[0m');
    console.log('\nFailed tests:');
    allResults
      .filter(r => r.outcome === 'FAIL')
      .forEach(r => {
        console.log(`  - ${r.symbol} / ${r.modelName}: ${r.error || 'Unknown error'}`);
      });
  } else {
    console.log('\n\x1b[32m✅ SMOKE TEST PASSED\x1b[0m');
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('🔥 Volatility Models Smoke Test\n');

  const args = parseArgs();

  console.log('Configuration:');
  console.log(`  Base URL:       ${args.baseUrl}`);
  console.log(`  Horizon (h):    ${args.h}`);
  console.log(`  Coverage:       ${args.cov}`);
  console.log(`  Window:         ${args.window}`);
  console.log(`  Lambda:         ${args.lambda}`);
  console.log(`  Random count:   ${args.random}`);
  console.log(`  Seed:           ${args.seed}`);

  // Build symbol list
  const excludeSet = ['ABT', 'NUE', 'AIG', 'KMI', 'SWK', 'KO'];
  const available = getAvailableSymbols();
  const randomSymbols = selectRandomSymbols(available, excludeSet, args.random, args.seed);
  const allSymbols = Array.from(new Set([...args.symbols, ...randomSymbols]));

  console.log(`\nTesting ${allSymbols.length} symbols:`);
  console.log(`  Mandatory:      ${args.symbols.join(', ')}`);
  console.log(`  Random:         ${randomSymbols.join(', ')}`);

  // Build model specs
  const modelSpecs = buildModelSpecs(args.window, args.lambda);
  console.log(`\nTesting ${modelSpecs.length} models:`);
  modelSpecs.forEach(spec => {
    console.log(`  - ${spec.name}${spec.optional ? ' (optional)' : ''}`);
  });

  // Run tests
  const allResults: TestResult[] = [];

  for (const symbol of allSymbols) {
    const symbolResults: TestResult[] = [];

    for (const spec of modelSpecs) {
      const result = await testVolatilityModel(
        args.baseUrl,
        symbol,
        spec,
        args.h,
        args.cov
      );
      symbolResults.push(result);
      allResults.push(result);

      // Small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    printResults(symbolResults, symbol);
  }

  // Print summary
  printSummary(allResults);

  // Exit with error if any required model failed
  const requiredFailures = allResults.filter(
    r => r.outcome === 'FAIL' && !r.error?.includes('RV data')
  );

  if (requiredFailures.length > 0) {
    process.exit(1);
  }
}

// Run
main().catch(error => {
  console.error('\n\x1b[31mFatal error:\x1b[0m', error);
  process.exit(1);
});
