import { runAllAssertions, AssertResult } from './assertions';

export type ScenarioResult = {
  scenario: string;
  symbol: string;
  timestamp: string;
  success: boolean;
  assertions: AssertResult[];
  totalPassed: number;
  totalFailed: number;
  duration: number;
};

export type QAReport = {
  timestamp: string;
  scenarios: ScenarioResult[];
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  duration: number;
};

/**
 * Run a single scenario (all assertions for one symbol)
 */
export async function runScenario(scenario: string, symbol: string): Promise<ScenarioResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  
  try {
    const assertions = await runAllAssertions(symbol);
    const totalPassed = assertions.filter(a => a.pass).length;
    const totalFailed = assertions.filter(a => !a.pass).length;
    const success = totalFailed === 0;
    
    return {
      scenario,
      symbol,
      timestamp,
      success,
      assertions,
      totalPassed,
      totalFailed,
      duration: Date.now() - startTime
    };
  } catch (error) {
    const failedResult: AssertResult = {
      pass: false,
      message: `Scenario failed with error: ${error}`
    };
    
    return {
      scenario,
      symbol,
      timestamp,
      success: false,
      assertions: [failedResult],
      totalPassed: 0,
      totalFailed: 1,
      duration: Date.now() - startTime
    };
  }
}

/**
 * Run multiple scenarios
 */
export async function runMultipleScenarios(scenarios: Array<{ name: string; symbol: string }>): Promise<QAReport> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  
  const scenarioResults: ScenarioResult[] = [];
  
  for (const scenario of scenarios) {
    const result = await runScenario(scenario.name, scenario.symbol);
    scenarioResults.push(result);
  }
  
  const passedScenarios = scenarioResults.filter(s => s.success).length;
  const failedScenarios = scenarioResults.filter(s => !s.success).length;
  
  return {
    timestamp,
    scenarios: scenarioResults,
    totalScenarios: scenarioResults.length,
    passedScenarios,
    failedScenarios,
    duration: Date.now() - startTime
  };
}

/**
 * Create synthetic test scenarios for common use cases
 */
export function createTestScenarios(): Array<{ name: string; symbol: string }> {
  return [
    { name: 'Tech Stock - High Volatility', symbol: 'NVDA' },
    { name: 'Blue Chip - Stable', symbol: 'AAPL' },
    { name: 'Financial - Cyclical', symbol: 'JPM' },
    { name: 'Energy - Commodity', symbol: 'XOM' },
    { name: 'Biotech - Growth', symbol: 'GILD' }
  ];
}

/**
 * Run a quick smoke test with one symbol
 */
export async function runSmokeTest(symbol: string = 'AAPL'): Promise<ScenarioResult> {
  return runScenario('Smoke Test', symbol);
}

/**
 * Run comprehensive test suite
 */
export async function runFullTestSuite(): Promise<QAReport> {
  const scenarios = createTestScenarios();
  return runMultipleScenarios(scenarios);
}