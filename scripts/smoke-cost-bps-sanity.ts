import {
  simulateTrading212Cfd,
  type Trading212CfdConfig,
  type Trading212SimBar,
} from "@/lib/backtest/trading212Cfd";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function buildConfig(spreadBps: number): Trading212CfdConfig {
  return {
    leverage: 5,
    fxFeeRate: 0,
    dailyLongSwapRate: 0,
    dailyShortSwapRate: 0,
    spreadBps,
    marginCallLevel: 0.45,
    stopOutLevel: 0.25,
    positionFraction: 0.25,
  };
}

function main() {
  const initialEquity = 1_000;
  const bars: Trading212SimBar[] = [
    { date: "2024-01-02", price: 100, signal: "long" },
    { date: "2024-01-03", price: 100, signal: "flat" },
  ];

  const zeroCost = simulateTrading212Cfd(bars, initialEquity, buildConfig(0));
  assert(Math.abs(zeroCost.finalEquity - initialEquity) < 1e-6, "spread=0 should preserve equity at entry/exit");

  const spreadBps = 50; // 0.50% round-trip spread
  const spreadConfig = buildConfig(spreadBps);
  const withCost = simulateTrading212Cfd(bars, initialEquity, spreadConfig);

  const spread = (spreadBps / 10000) * bars[0].price;
  const exposure = initialEquity * spreadConfig.positionFraction * spreadConfig.leverage;
  const qty = exposure / bars[0].price;
  const expectedLoss = (spread / 2) * qty; // half-spread against us on entry
  const realizedLoss = initialEquity - withCost.finalEquity;

  assert(realizedLoss > 0, "spread cost should reduce equity when prices are flat");
  assert(
    Math.abs(realizedLoss - expectedLoss) / expectedLoss < 0.1,
    `loss ${realizedLoss.toFixed(4)} should be close to expected ${expectedLoss.toFixed(4)}`
  );

  console.log("spread=0 finalEquity", zeroCost.finalEquity.toFixed(4));
  console.log("spread=50bps finalEquity", withCost.finalEquity.toFixed(4), "expectedLoss", expectedLoss.toFixed(4));
  console.log("PASS");
}

main();
