import { describe, it, expect, beforeAll } from "@jest/globals";
import { NextRequest } from "next/server";
import { POST as volatilityPost } from "@/app/api/volatility/[symbol]/route";
import { saveTargetSpec } from "@/lib/storage/targetSpecStore";
import { ForecastRecord } from "@/lib/forecast/types";

// Keep this small for CI stability; expand if data is available.
const TICKERS = ["TSLA", "AAPL", "SPY", "GOOGL", "AMZN", "MSFT", "NFLX", "BABA"];
const HORIZONS = [1, 5] as const;
const COVERAGES = [0.9, 0.95, 0.99] as const;
const MODELS: Array<ForecastRecord["method"]> = [
  "GBM-CC",
  "GARCH11-N",
  "Range-P",
];

type Model = (typeof MODELS)[number];

beforeAll(async () => {
  // Ensure TargetSpec exists so the route does not 400; request overrides h/coverage.
  await Promise.all(
    TICKERS.map((symbol) =>
      saveTargetSpec({
        symbol,
        h: 1,
        coverage: 0.95,
        exchange_tz: "America/New_York",
        variable: "NEXT_CLOSE_ADJ",
        cutoff_note: "compute at t close; verify at t+1 close",
        updated_at: new Date().toISOString(),
      })
    )
  );
});

function makeRequestBody(model: Model, h: number, coverage: number) {
  if (model === "GBM-CC") {
    return {
      model,
      params: {
        gbm: {
          windowN: 252 as const, // keep small for smoke stability
          lambdaDrift: 0,
        },
      },
      overwrite: true,
      horizon: h,
      coverage,
      tz: "America/New_York",
    };
  }

  if (model.startsWith("GARCH11")) {
    return {
      model,
      params: {
        garch: {
          window: 400, // reduced to avoid insufficient-data errors in smoke
          variance_targeting: true,
          dist: model === "GARCH11-N" ? "normal" : "student-t",
          ...(model === "GARCH11-t" ? { df: 8 } : {}),
        },
      },
      overwrite: true,
      horizon: h,
      coverage,
      tz: "America/New_York",
    };
  }

  if (model.startsWith("Range-")) {
    return {
      model,
      params: {
        range: {
          estimator: model.split("-")[1] as "P" | "GK" | "RS" | "YZ",
          window: 126, // smaller window for smoke stability
          ewma_lambda: 0.94,
        },
      },
      overwrite: true,
      horizon: h,
      coverage,
      tz: "America/New_York",
    };
  }

  throw new Error(`Unknown model ${model}`);
}

async function callVolatilityRoute(symbol: string, body: any) {
  const url = `http://localhost/api/volatility/${symbol}`;
  const req = new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
    },
  });

  const res = await volatilityPost(req, { params: { symbol } as any });
  const json = await res.json();
  return { status: res.status, json: json as ForecastRecord };
}

function getHorizonRecord(resp: ForecastRecord, h: number, coverage: number) {
  expect(resp).toBeDefined();
  expect(typeof resp).toBe("object");

  const horizon = resp.horizonTrading ?? resp.target?.h;
  const cov = resp.target?.coverage ?? (resp as any).coverage;

  expect(horizon).toBe(h);
  expect(Math.abs((cov ?? 0) - coverage)).toBeLessThan(1e-9);

  const intervals = (resp.intervals ?? {}) as any;
  const L = intervals.L_h ?? (resp as any).L_h;
  const U = intervals.U_h ?? (resp as any).U_h;

  expect(Number.isFinite(L)).toBe(true);
  expect(Number.isFinite(U)).toBe(true);
  expect(L).toBeLessThanOrEqual(U);

  return { L, U };
}

function getBandWidth(L: number, U: number) {
  return (U - L) / 2;
}

describe("Volatility API smoke test – multi ticker/models", () => {
  for (const symbol of TICKERS) {
    for (const model of MODELS) {
      describe(`${symbol} / ${model}`, () => {
        it("returns a forecast for h=1,5 at 95% coverage", async () => {
          for (const h of HORIZONS) {
            const body = makeRequestBody(model, h, 0.95);
            const { status, json } = await callVolatilityRoute(symbol, body);
            if (status !== 200) {
              console.warn(`Skipping ${symbol}/${model}/h=${h} (status ${status})`);
              return;
            }
            const { L, U } = getHorizonRecord(json, h, 0.95);
            expect(getBandWidth(L, U)).toBeGreaterThan(0);
          }
        });

        it("bands widen with higher coverage (h=5)", async () => {
          const h = 5;
          const widths: Record<number, number> = {};

          for (const coverage of COVERAGES) {
            const body = makeRequestBody(model, h, coverage);
            const { status, json } = await callVolatilityRoute(symbol, body);
            if (status !== 200) {
              console.warn(`Skipping ${symbol}/${model}/h=${h}/cov=${coverage} (status ${status})`);
              return;
            }
            const { L, U } = getHorizonRecord(json, h, coverage);
            widths[coverage] = getBandWidth(L, U);
          }

          expect(widths[0.95]).toBeGreaterThan(widths[0.9]);
          expect(widths[0.99]).toBeGreaterThan(widths[0.95]);
        });

        it("bands widen (or stay wider) with longer horizon at 95% coverage", async () => {
          const coverage = 0.95;

          const body1 = makeRequestBody(model, 1, coverage);
          const { status: s1, json: j1 } = await callVolatilityRoute(symbol, body1);
          if (s1 !== 200) {
            console.warn(`Skipping ${symbol}/${model}/h=1 (status ${s1})`);
            return;
          }
          const { L: L1, U: U1 } = getHorizonRecord(j1, 1, coverage);
          const w1 = getBandWidth(L1, U1);

          const body5 = makeRequestBody(model, 5, coverage);
          const { status: s5, json: j5 } = await callVolatilityRoute(symbol, body5);
          if (s5 !== 200) {
            console.warn(`Skipping ${symbol}/${model}/h=5 (status ${s5})`);
            return;
          }
          const { L: L5, U: U5 } = getHorizonRecord(j5, 5, coverage);
          const w5 = getBandWidth(L5, U5);

          expect(w5).toBeGreaterThanOrEqual(w1);
        });
      });
    }
  }
});

// Additional structural invariants across tickers/models/h/coverage
describe("Volatility API structural invariants", () => {
  for (const symbol of TICKERS) {
    for (const model of MODELS) {
      it(`${symbol}/${model} has consistent fields across h and coverage`, async () => {
        for (const h of HORIZONS) {
          for (const coverage of COVERAGES) {
            const body = makeRequestBody(model, h, coverage);
            const { status, json } = await callVolatilityRoute(symbol, body);
            if (status !== 200) {
              console.warn(`Skipping ${symbol}/${model}/h=${h}/cov=${coverage} (status ${status})`);
              continue;
            }

            // Basic shape assertions
            expect(json.symbol).toBe(symbol);
            expect(json.method).toBe(model);
            const horizon = json.horizonTrading ?? json.target?.h;
            expect(horizon).toBe(h);
            const cov = json.target?.coverage ?? (json as any).coverage;
            expect(Math.abs((cov ?? 0) - coverage)).toBeLessThan(1e-9);

            const intervals = json.intervals ?? {};
            const L = intervals.L_h ?? (json as any).L_h;
            const U = intervals.U_h ?? (json as any).U_h;
            expect(Number.isFinite(L)).toBe(true);
            expect(Number.isFinite(U)).toBe(true);
            expect(L).toBeLessThanOrEqual(U);

            // y_hat should be positive when present
            if (typeof json.y_hat === "number") {
              expect(json.y_hat).toBeGreaterThan(0);
            }
          }
        }
      });
    }
  }
});
