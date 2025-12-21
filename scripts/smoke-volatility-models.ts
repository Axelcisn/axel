#!/usr/bin/env node
/**
 * Smoke test for volatility models
 * 
 * Tests all volatility model variants (GBM, GARCH, Range, HAR) against
 * KO + random tickers to ensure the API returns valid forecasts.
 * 
 * Usage:
 *   npx tsx scripts/smoke-volatility-models.ts --baseUrl=http://localhost:3000 --symbols=KO --random=3 --seed=42 --h=1 --cov=0.95 --window=504 --lambda=0.94
 */

import * as fs from "node:fs";
import * as path from "node:path";

type Args = {
  baseUrl: string;
  symbols: string[];
  random: number;
  seed: number;
  h: number;
  cov: number;
  window: number;
  lambda: number;
  timeoutMs: number;
};

type VolModelSpec = {
  name: string;
  model: string; // request model string
  required: boolean;
  buildParams: (a: Args) => any;
  // Return true if response method matches the requested model family
  methodOk: (respMethod: string | null | undefined) => boolean;
  // Whether a non-200 can be treated as SKIPPED (HAR-RV only)
  isSkippable?: (status: number, body: any) => boolean;
};

function parseArgs(argv: string[]): Args {
  const out: any = {};
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const [k, vRaw] = raw.slice(2).split("=");
    out[k] = vRaw ?? "true";
  }

  const symbols = String(out.symbols ?? "KO")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);

  return {
    baseUrl: String(out.baseUrl ?? "http://localhost:3000").replace(/\/$/, ""),
    symbols,
    random: Number(out.random ?? 3),
    seed: Number(out.seed ?? 42),
    h: Number(out.h ?? 1),
    cov: Number(out.cov ?? 0.95),
    window: Number(out.window ?? 504),
    lambda: Number(out.lambda ?? 0.94),
    timeoutMs: Number(out.timeoutMs ?? 20_000),
  };
}

// Seeded RNG (Mulberry32)
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function listCanonicalSymbols(): string[] {
  const dir = path.join(process.cwd(), "data", "canonical");
  const files = fs.readdirSync(dir);
  return files
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .map((f) => f.replace(/\.json$/i, ""))
    .filter((s) => /^[A-Z0-9]+$/.test(s.toUpperCase()))
    .map((s) => s.toUpperCase());
}

function padRight(s: string, n: number) {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

function fmtNum(x: any, digits = 4): string {
  if (x == null || !Number.isFinite(Number(x))) return "-";
  return Number(x).toFixed(digits);
}

function fmtPct(x: any, digits = 2): string {
  if (x == null || !Number.isFinite(Number(x))) return "-";
  return (Number(x) * 100).toFixed(digits) + "%";
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await resp.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { _raw: text };
    }
    return { resp, json };
  } finally {
    clearTimeout(t);
  }
}

// Extractors (be tolerant to schema evolution)
function getMethod(body: any): string | null {
  return body?.method ?? body?.meta?.method ?? null;
}
function getSigma1d(body: any): number | null {
  return (
    body?.estimates?.sigma_forecast ??
    body?.estimates?.sigma_1d ??
    body?.sigma_forecast ??
    body?.sigma_1d ??
    null
  );
}
function getYHat(body: any): number | null {
  return body?.y_hat ?? body?.yHat ?? null;
}
function getL(body: any): number | null {
  return body?.intervals?.L_h ?? body?.intervals?.lower ?? body?.L_h ?? body?.lower ?? null;
}
function getU(body: any): number | null {
  return body?.intervals?.U_h ?? body?.intervals?.upper ?? body?.U_h ?? body?.upper ?? null;
}
function getBwPct(body: any): number | null {
  const y = getYHat(body);
  const L = getL(body);
  const U = getU(body);
  if (y == null || L == null || U == null) return null;
  if (!Number.isFinite(y) || y <= 0) return null;
  return (U - L) / y;
}

function isHarRvUnavailable(status: number, body: any): boolean {
  if (status === 422) return true;
  const msg = String(body?.error ?? body?.details ?? body?.code ?? "").toLowerCase();
  return msg.includes("rv") || msg.includes("realized") || msg.includes("har");
}

function makeSpecs(): VolModelSpec[] {
  const exact = (m: string) => (respMethod: string | null | undefined) => {
    if (!respMethod) return false;
    return respMethod === m;
  };
  const gbmOk = (respMethod: string | null | undefined) => {
    if (!respMethod) return false;
    return respMethod === "GBM" || respMethod === "GBM-CC" || respMethod.startsWith("GBM");
  };

  return [
    {
      name: "GBM",
      model: "GBM",
      required: true,
      buildParams: (a) => ({ gbm: { window: a.window } }),
      methodOk: gbmOk,
    },
    {
      name: "GARCH11-N",
      model: "GARCH11-N",
      required: true,
      buildParams: (a) => ({ garch: { window: a.window, dist: "normal" } }),
      methodOk: exact("GARCH11-N"),
    },
    {
      name: "GARCH11-t",
      model: "GARCH11-t",
      required: true,
      buildParams: (a) => ({ garch: { window: a.window, dist: "student-t" } }),
      methodOk: exact("GARCH11-t"),
    },
    {
      name: "Range-P",
      model: "Range-P",
      required: true,
      buildParams: (a) => ({ range: { window: a.window, ewma_lambda: a.lambda } }),
      methodOk: exact("Range-P"),
    },
    {
      name: "Range-GK",
      model: "Range-GK",
      required: true,
      buildParams: (a) => ({ range: { window: a.window, ewma_lambda: a.lambda } }),
      methodOk: exact("Range-GK"),
    },
    {
      name: "Range-RS",
      model: "Range-RS",
      required: true,
      buildParams: (a) => ({ range: { window: a.window, ewma_lambda: a.lambda } }),
      methodOk: exact("Range-RS"),
    },
    {
      name: "Range-YZ",
      model: "Range-YZ",
      required: true,
      buildParams: (a) => ({ range: { window: a.window, ewma_lambda: a.lambda } }),
      methodOk: exact("Range-YZ"),
    },
    {
      name: "HAR-RV",
      model: "HAR-RV",
      required: false,
      buildParams: (a) => ({ har: { window: a.window } }),
      methodOk: exact("HAR-RV"),
      isSkippable: isHarRvUnavailable,
    },
  ];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const exclude = new Set(["ABT", "NUE", "AIG", "KMI", "SWK", "KO"]);
  const canonical = listCanonicalSymbols();
  const rnd = mulberry32(args.seed);

  const mandatory = args.symbols.map((s) => s.toUpperCase());
  for (const s of mandatory) exclude.add(s);

  const pool = canonical.filter((s) => !exclude.has(s));
  const picked = shuffle(pool, rnd).slice(0, Math.max(0, args.random));
  const symbols = Array.from(new Set([...mandatory, ...picked]));

  const specs = makeSpecs();

  console.log("\n🔥 Volatility Models Smoke Test\n");
  console.log("Config:");
  console.log(`  baseUrl: ${args.baseUrl}`);
  console.log(`  h:       ${args.h}`);
  console.log(`  cov:     ${args.cov}`);
  console.log(`  window:  ${args.window}`);
  console.log(`  lambda:  ${args.lambda}`);
  console.log(`  seed:    ${args.seed}`);
  console.log(`  symbols: ${symbols.join(", ")}\n`);

  let failures = 0;
  let skipped = 0;
  let passed = 0;
  let total = 0;

  for (const symbol of symbols) {
    console.log("=".repeat(92));
    console.log(`SYMBOL: ${symbol}`);
    console.log("=".repeat(92));
    console.log(
      [
        padRight("Model", 14),
        padRight("Status", 8),
        padRight("Result", 9),
        padRight("Method", 12),
        padRight("σ₁d", 10),
        padRight("ŷ", 12),
        padRight("L_h", 12),
        padRight("U_h", 12),
        padRight("BW%", 8),
      ].join(" ")
    );
    console.log("-".repeat(92));

    for (const spec of specs) {
      total += 1;
      const url = `${args.baseUrl}/api/volatility/${symbol}`;
      const body = {
        model: spec.model,
        params: spec.buildParams(args),
        h: args.h,
        coverage: args.cov,
      };

      let status = 0;
      let result = "FAIL";
      let method = "-";
      let sigma = "-";
      let yhat = "-";
      let L = "-";
      let U = "-";
      let bw = "-";
      let extraNote = "";

      try {
        const { resp, json } = await fetchJsonWithTimeout(
          url,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
          args.timeoutMs
        );

        status = resp.status;
        const respMethod = getMethod(json);
        method = respMethod ?? "-";
        sigma = fmtNum(getSigma1d(json), 6);
        yhat = fmtNum(getYHat(json), 2);
        L = fmtNum(getL(json), 2);
        U = fmtNum(getU(json), 2);
        bw = fmtPct(getBwPct(json), 2);

        const methodMatches = spec.methodOk(respMethod);

        if (resp.ok && methodMatches) {
          result = "OK";
          passed += 1;
        } else if (!resp.ok && spec.isSkippable?.(resp.status, json)) {
          result = "SKIPPED";
          skipped += 1;
          extraNote = String(json?.error ?? json?.details ?? json?.code ?? "").slice(0, 80);
        } else {
          result = "FAIL";
          failures += 1;

          if (resp.ok && !methodMatches) {
            extraNote = `method mismatch (wanted ${spec.model}, got ${respMethod ?? "null"})`;
          } else {
            extraNote = String(json?.error ?? json?.details ?? json?.code ?? "unknown error").slice(0, 80);
          }
        }
      } catch (e: any) {
        status = 0;
        result = "FAIL";
        failures += 1;
        extraNote = e?.name === "AbortError" ? "timeout" : String(e?.message ?? e);
      }

      // Required models fail the run if not OK
      const requiredFail = spec.required && result !== "OK";

      const line =
        [
          padRight(spec.name, 14),
          padRight(String(status || "-"), 8),
          padRight(requiredFail ? "FAIL*" : result, 9),
          padRight(method, 12),
          padRight(sigma, 10),
          padRight(yhat, 12),
          padRight(L, 12),
          padRight(U, 12),
          padRight(bw, 8),
        ].join(" ") + (extraNote ? `  └─ ${extraNote}` : "");

      console.log(line);

      // gentle pacing
      await new Promise((r) => setTimeout(r, 100));
    }

    console.log("");
  }

  console.log("=".repeat(92));
  console.log("SUMMARY");
  console.log("=".repeat(92));
  console.log(`Total tests: ${total}`);
  console.log(`✓ Passed:    ${passed}`);
  console.log(`⊘ Skipped:   ${skipped}`);
  console.log(`✗ Failed:    ${failures}`);
  console.log("=".repeat(92));

  if (failures > 0) {
    console.error("\n❌ SMOKE TEST FAILED\n");
    process.exit(1);
  } else {
    console.log("\n✅ SMOKE TEST PASSED\n");
    process.exit(0);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
