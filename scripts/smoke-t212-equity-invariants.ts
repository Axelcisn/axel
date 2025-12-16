/**
 * Synthetic equity/free-margin smoke test for the Trading212 CFD simulator.
 *
 * Run:
 *   npx tsc --noEmit
 *   npx tsx scripts/smoke-t212-equity-invariants.ts
 */

import {
  simulateTrading212Cfd,
  Trading212CfdConfig,
  Trading212SimBar,
} from "../lib/backtest/trading212Cfd";

const BASE_CONFIG: Trading212CfdConfig = {
  leverage: 5,
  fxFeeRate: 0,
  dailyLongSwapRate: 0,
  dailyShortSwapRate: 0,
  spreadBps: 0,
  marginCallLevel: 0.45,
  stopOutLevel: 0.25,
  positionFraction: 0.25,
};

type CaseDefinition = {
  name: string;
  bars: Trading212SimBar[];
  description: string;
};

type SnapshotRow = {
  date: string;
  signal: Trading212SimBar["signal"];
  price: number;
  side: string | null;
  equity: number;
  marginUsed: number;
  freeCash: number;
  freeMargin: number;
  deltaEquity: number;
};

function runCase(def: CaseDefinition) {
  const initialEquity = 10_000;
  const result = simulateTrading212Cfd(def.bars, initialEquity, BASE_CONFIG);

  const rows: SnapshotRow[] = result.accountHistory.map((snap, idx, arr) => {
    const prevEquity = idx > 0 ? arr[idx - 1].equity : snap.equity;
    const freeMargin = snap.equity - snap.marginUsed;
    return {
      date: snap.date,
      signal: def.bars[idx]?.signal ?? "flat",
      price: snap.price,
      side: snap.side,
      equity: snap.equity,
      marginUsed: snap.marginUsed,
      freeCash: snap.freeCash,
      freeMargin,
      deltaEquity: snap.equity - prevEquity,
    };
  });

  const flatRows = rows.filter((r) => r.side === null);
  const equityConstantOnFlat = flatRows.every(
    (r) => Math.abs(r.deltaEquity) < 1e-6
  );

  // Entry day: first bar where side switches from null -> non-null
  const entryIndex = rows.findIndex((r, idx) => {
    const prevSide = idx > 0 ? rows[idx - 1].side : null;
    return prevSide === null && r.side !== null;
  });
  const entryDelta = entryIndex >= 0 ? rows[entryIndex].deltaEquity : 0;
  const equityUnchangedAtEntry = Math.abs(entryDelta) < 1e-6;

  const marginOnlyWhileOpen = rows.every((r) =>
    r.side === null ? r.marginUsed === 0 : r.marginUsed > 0
  );

  printCase(def, rows, {
    equityConstantOnFlat,
    equityUnchangedAtEntry,
    marginOnlyWhileOpen,
  });
}

function printCase(
  def: CaseDefinition,
  rows: SnapshotRow[],
  checks: {
    equityConstantOnFlat: boolean;
    equityUnchangedAtEntry: boolean;
    marginOnlyWhileOpen: boolean;
  }
) {
  console.log(`\n=== ${def.name} ===`);
  console.log(def.description);
  console.log(
    "Date       Sig   Price   Side   Equity      MarginUsed  FreeCash    FreeMargin  ΔEquity"
  );
  console.log(
    "---------  ----  ------  -----  ----------  ----------  ----------  -----------  --------"
  );
  rows.forEach((r) => {
    const side = r.side ?? "flat";
    console.log(
      `${r.date}  ${r.signal.padEnd(5)}  ${r.price
        .toFixed(2)
        .padStart(6)}  ${side.padEnd(5)}  ${r.equity
        .toFixed(2)
        .padStart(10)}  ${r.marginUsed
        .toFixed(2)
        .padStart(10)}  ${r.freeCash
        .toFixed(2)
        .padStart(10)}  ${r.freeMargin
        .toFixed(2)
        .padStart(11)}  ${r.deltaEquity >= 0 ? "+" : ""}${r.deltaEquity
        .toFixed(2)
        .padStart(7)}`
    );
  });

  const nonZeroDeltaDates = rows
    .filter((r) => Math.abs(r.deltaEquity) > 1e-6)
    .map((r) => `${r.date} (${r.side ?? "flat"})`);
  console.log(
    `Δ Equity dates: ${nonZeroDeltaDates.length > 0 ? nonZeroDeltaDates.join(", ") : "none"}`
  );

  console.log("\nChecks:");
  console.log(
    `- Equity constant when flat & no costs: ${checks.equityConstantOnFlat ? "PASS" : "FAIL"}`
  );
  console.log(
    `- Equity unchanged at entry when price constant: ${checks.equityUnchangedAtEntry ? "PASS" : "FAIL"}`
  );
  console.log(
    `- usedMargin > 0 only when position open: ${checks.marginOnlyWhileOpen ? "PASS" : "FAIL"}`
  );
}

function main() {
  const case1: CaseDefinition = {
    name: "Case 1: Constant price, open + close",
    description:
      "Price constant at 100, open on day 4, hold days 5-6, close day 7. Expect equity to stay exactly 10000 and only freeMargin to drop on entry.",
    bars: [
      { date: "2020-01-01", price: 100, signal: "flat" },
      { date: "2020-01-02", price: 100, signal: "flat" },
      { date: "2020-01-03", price: 100, signal: "flat" },
      { date: "2020-01-04", price: 100, signal: "long" },
      { date: "2020-01-05", price: 100, signal: "long" },
      { date: "2020-01-06", price: 100, signal: "long" },
      { date: "2020-01-07", price: 100, signal: "flat" },
      { date: "2020-01-08", price: 100, signal: "flat" },
      { date: "2020-01-09", price: 100, signal: "flat" },
    ],
  };

  const case2: CaseDefinition = {
    name: "Case 2: Price moves while holding, then flat",
    description:
      "Open on day 4, hold days 5-6 with price moves, close day 7. Equity should only change on holding days; flat days should stay constant.",
    bars: [
      { date: "2020-02-01", price: 100, signal: "flat" },
      { date: "2020-02-02", price: 100, signal: "flat" },
      { date: "2020-02-03", price: 100, signal: "flat" },
      { date: "2020-02-04", price: 100, signal: "long" },
      { date: "2020-02-05", price: 95, signal: "long" },
      { date: "2020-02-06", price: 105, signal: "long" },
      { date: "2020-02-07", price: 105, signal: "flat" },
      { date: "2020-02-08", price: 110, signal: "flat" },
      { date: "2020-02-09", price: 90, signal: "flat" },
    ],
  };

  const case3: CaseDefinition = {
    name: "Case 3: Date alignment sanity",
    description:
      "Open on day 2, hold day 3 with price move, close day 4, then price moves while flat on days 5-6. Equity changes should align with holding days only.",
    bars: [
      { date: "2020-03-01", price: 100, signal: "flat" },
      { date: "2020-03-02", price: 100, signal: "long" },
      { date: "2020-03-03", price: 110, signal: "long" },
      { date: "2020-03-04", price: 110, signal: "flat" },
      { date: "2020-03-05", price: 90, signal: "flat" },
      { date: "2020-03-06", price: 95, signal: "flat" },
    ],
  };

  runCase(case1);
  runCase(case2);
  runCase(case3);
}

main();
