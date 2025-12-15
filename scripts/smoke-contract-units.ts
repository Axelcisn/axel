import {
  simulateTrading212Cfd,
  type Trading212CfdConfig,
  type Trading212SimBar,
} from "@/lib/backtest/trading212Cfd";

function bpsToFrac(bps: number): number {
  return bps / 10000;
}

function fracToBps(frac: number): number {
  return frac * 10000;
}

function assertClose(label: string, actual: number, expected: number, tol = 1e-9) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${label} expected ${expected} but got ${actual}`);
  }
}

function printTinyTable() {
  const rows = [1, 10, 100].map((bps) => ({
    bps,
    frac: bpsToFrac(bps),
  }));
  console.log("bps -> fraction (1bp = 0.01%)");
  rows.forEach((r) => {
    console.log(`${r.bps.toString().padEnd(4)}bp -> ${r.frac.toFixed(6)}`);
  });
}

function assertRoundTrips() {
  const samples = [0, 1, 10, 25, 100, 250, 500];
  samples.forEach((bps) => {
    const frac = bpsToFrac(bps);
    assertClose(`bpsToFrac(${bps})`, frac, bps / 10000);
    const back = fracToBps(frac);
    assertClose(`fracToBps(bpsToFrac(${bps}))`, back, bps);
  });
}

function assertSpreadConversion() {
  const spreadBps = 10;
  const price = 100;
  const bars: Trading212SimBar[] = [
    { date: "2024-01-01", price, signal: "long" },
    { date: "2024-01-02", price, signal: "flat" },
    { date: "2024-01-03", price, signal: "short" },
    { date: "2024-01-04", price, signal: "flat" },
  ];

  const config: Trading212CfdConfig = {
    leverage: 5,
    fxFeeRate: 0,
    dailyLongSwapRate: 0,
    dailyShortSwapRate: 0,
    spreadBps,
    marginCallLevel: 0.45,
    stopOutLevel: 0.25,
    positionFraction: 0.5,
  };

  const sim = simulateTrading212Cfd(bars, 10000, config);
  if (sim.trades.length < 2) {
    throw new Error("Expected both long and short trades to be produced.");
  }

  const longTrade = sim.trades.find((t) => t.side === "long");
  const shortTrade = sim.trades.find((t) => t.side === "short");
  if (!longTrade || !shortTrade) {
    throw new Error("Missing long or short trade for spread assertion.");
  }

  const expectedHalfSpread = bpsToFrac(spreadBps) * price * 0.5;
  assertClose(
    "long entry spread",
    longTrade.entryPrice - price,
    expectedHalfSpread,
    1e-6
  );
  assertClose(
    "short entry spread",
    price - shortTrade.entryPrice,
    expectedHalfSpread,
    1e-6
  );
}

function main() {
  assertRoundTrips();
  assertSpreadConversion();
  printTinyTable();
  console.log("Unit conversion contract OK.");
}

main();
