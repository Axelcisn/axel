import "./_loadEnv";
import { setTimeout as delay } from "timers/promises";

const DEMO = "https://demo-api-capital.backend-capital.com";
const LIVE = "https://api-capital.backend-capital.com";

type CheckResult = { base: string; status: number; ok: boolean; bodySnippet: string };

function truncate(str: string, max = 200) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "..." : str;
}

async function check(base: string, apiKey: string) : Promise<CheckResult> {
  const url = `${base}/api/v1/session/encryptionKey`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-CAP-API-KEY": apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const text = await res.text().catch(() => "");
    return { base, status: res.status, ok: res.ok, bodySnippet: truncate(text) };
  } catch (err: any) {
    return { base, status: -1, ok: false, bodySnippet: truncate(String(err)) };
  }
}

async function main() {
  const apiKeyRaw = process.env.CAPITAL_API_KEY || "";
  const apiKey = apiKeyRaw.trim();
  const identifier = (process.env.CAPITAL_IDENTIFIER || "").trim();
  const password = (process.env.CAPITAL_PASSWORD || "").trim();

  const keyRawLen = apiKeyRaw.length;
  const keyTrimmedLen = apiKey.length;
  const hasWhitespace = apiKeyRaw !== apiKey;
  const hasAsterisks = apiKeyRaw.includes("*");
  const hasQuotes = /^['"]/.test(apiKeyRaw) || /['"]$/.test(apiKeyRaw);

  if (!apiKey || !identifier || !password) {
    console.error("Missing CAPITAL_API_KEY / CAPITAL_IDENTIFIER / CAPITAL_PASSWORD in env.");
    process.exit(1);
  }

  const results = await Promise.all([check(DEMO, apiKey), check(LIVE, apiKey)]);

  console.log(`keyRawLen=${keyRawLen} keyTrimmedLen=${keyTrimmedLen} hasWhitespace=${hasWhitespace} hasAsterisks=${hasAsterisks} hasQuotes=${hasQuotes}`);

  for (const r of results) {
    console.log(
      `${r.base}: status=${r.status} ok=${r.ok} body=${r.bodySnippet} keyLen=${apiKey.length} keyLast4=${apiKey.slice(-4)}`
    );
  }

  if (!results.some((r) => r.ok)) {
    process.exit(2);
  }
}

main().catch(async (err) => {
  console.error(err);
  await delay(1);
  process.exit(1);
});
