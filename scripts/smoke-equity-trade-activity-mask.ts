/**
 * Smoke test for masking simulation equity to active trade windows.
 *
 * Run:
 *   npx tsc --noEmit
 *   npx tsx scripts/smoke-equity-trade-activity-mask.ts
 */

import {
  applyActivityMaskToEquitySeries,
  computeTradeActivityWindow,
  type SimulationEquityPoint,
} from "../lib/backtest/equityActivity";
import type { Trading212AccountSnapshot } from "../lib/backtest/trading212Cfd";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function makeSnapshots(dates: string[], sides: Array<Trading212AccountSnapshot["side"]>): Trading212AccountSnapshot[] {
  return dates.map((date, idx) => ({
    date,
    price: 100,
    equity: 10000,
    freeCash: 10000,
    marginUsed: 0,
    freeMargin: 10000,
    marginStatus: 100,
    unrealisedPnl: 0,
    realisedPnl: 0,
    swapFeesAccrued: 0,
    fxFeesAccrued: 0,
    side: sides[idx],
    quantity: 0,
  }));
}

function makeEquitySeries(dates: string[]): SimulationEquityPoint[] {
  return dates.map((date) => ({
    date,
    equity: 100,
    equityDelta: 0,
    marginUsed: 0,
    freeMargin: 100,
  }));
}

function runCase(
  name: string,
  dates: string[],
  sides: Array<Trading212AccountSnapshot["side"]>,
  prevSideBefore: Trading212AccountSnapshot["side"] | null,
  expectedStart: string | null,
  expectedEnd: string | null,
  expectedActiveDates: string[]
) {
  const history = makeSnapshots(dates, sides);
  const { activityStartDate, activityEndDate } = computeTradeActivityWindow(history, prevSideBefore);
  assert(activityStartDate === expectedStart, `${name}: expected start ${expectedStart}, got ${activityStartDate}`);
  assert(activityEndDate === expectedEnd, `${name}: expected end ${expectedEnd}, got ${activityEndDate}`);

  const series = makeEquitySeries(dates);
  const masked = applyActivityMaskToEquitySeries(series, activityStartDate, activityEndDate);
  const activeDates = masked.filter((p) => p.equity != null).map((p) => p.date);
  assert(
    JSON.stringify(activeDates) === JSON.stringify(expectedActiveDates),
    `${name}: active dates mismatch. Expected ${expectedActiveDates.join(",")}, got ${activeDates.join(",")}`
  );

  // Also verify masked-out regions are null
  masked.forEach((pt) => {
    const shouldBeActive = expectedActiveDates.includes(pt.date);
    if (shouldBeActive) {
      assert(pt.equity !== null, `${name}: expected equity on ${pt.date}`);
    } else {
      assert(pt.equity === null && pt.equityDelta === null, `${name}: expected null equity on ${pt.date}`);
    }
  });

  console.log(`✓ ${name} PASS`);
}

function main() {
  const dates = [
    "2020-01-01",
    "2020-01-02",
    "2020-01-03",
    "2020-01-04",
    "2020-01-05",
    "2020-01-06",
    "2020-01-07",
    "2020-01-08",
    "2020-01-09",
  ];

  // Case 1: single open/close inside window
  runCase(
    "Case 1",
    dates,
    [null, null, null, "long", "long", "long", null, null, null],
    null,
    "2020-01-04",
    "2020-01-07",
    ["2020-01-04", "2020-01-05", "2020-01-06", "2020-01-07"]
  );

  // Case 2: open but no close inside window -> extend to end
  runCase(
    "Case 2",
    dates,
    [null, null, null, "long", "long", "long", "long", "long", "long"],
    null,
    "2020-01-04",
    "2020-01-09",
    ["2020-01-04", "2020-01-05", "2020-01-06", "2020-01-07", "2020-01-08", "2020-01-09"]
  );

  // Case 3: multiple trades => span first open to last close
  runCase(
    "Case 3",
    dates,
    [null, "long", null, null, "short", null, null, null, null],
    null,
    "2020-01-02",
    "2020-01-06",
    ["2020-01-02", "2020-01-03", "2020-01-04", "2020-01-05", "2020-01-06"]
  );
}

main();
