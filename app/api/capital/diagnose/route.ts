import { NextResponse } from "next/server";

const BASE_URL =
  process.env.CAPITAL_API_BASE_URL ?? "https://demo-api-capital.backend-capital.com";
const DEMO_URL = "https://demo-api-capital.backend-capital.com";
const LIVE_URL = "https://api-capital.backend-capital.com";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function truncate(str: string, max = 300): string {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "..." : str;
}

async function checkBase(base: string, apiKey: string | undefined) {
  try {
    const res = await fetch(`${base}/api/v1/session/encryptionKey`, {
      method: "GET",
      headers: {
        "X-CAP-API-KEY": apiKey?.trim() ?? "",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const text = await res.text().catch(() => "");
    return {
      status: res.status,
      ok: res.ok,
      bodySnippet: truncate(text),
    };
  } catch (err: any) {
    return {
      status: -1,
      ok: false,
      bodySnippet: truncate(String(err)),
    };
  }
}

export async function GET() {
  const apiKeyRaw = process.env.CAPITAL_API_KEY;
  const identifierRaw = process.env.CAPITAL_IDENTIFIER;
  const passwordRaw = process.env.CAPITAL_PASSWORD;
  const apiKey = apiKeyRaw?.trim();
  const identifier = identifierRaw?.trim();
  const password = passwordRaw?.trim();

  const hints: string[] = [];

  const checks = {
    demo: await checkBase(DEMO_URL, apiKey),
    live: await checkBase(LIVE_URL, apiKey),
  };

  const apiKeyRawLen = apiKeyRaw?.length ?? 0;
  const apiKeyTrimmedLen = apiKey?.length ?? 0;
  const apiKeyHasWhitespace = Boolean(apiKeyRaw && apiKeyRaw !== apiKey);
  const apiKeyHasAsterisks = Boolean(apiKeyRaw && apiKeyRaw.includes("*"));
  const apiKeyHasQuotes = Boolean(apiKeyRaw && (/^['"]/.test(apiKeyRaw) || /['"]$/.test(apiKeyRaw)));
  const apiKeyIsAscii = apiKeyRaw ? /^[\x00-\x7F]*$/.test(apiKeyRaw) : true;

  hints.push(`Key length is ${apiKeyTrimmedLen}; if Capital rejects it, it may be wrong/masked/paused/expired.`);
  if (!apiKey || !identifier || !password) {
    hints.push("Missing env vars; check .env.local and restart the dev server.");
  }
  if (apiKeyHasWhitespace) {
    hints.push("Your key has leading/trailing whitespace/newlines. Re-copy and ensure no spaces.");
  }
  if (apiKeyHasQuotes) {
    hints.push("Remove quotes in .env.local.");
  }
  if (apiKeyHasAsterisks) {
    hints.push("Key is masked; regenerate and copy at creation.");
  }
  if (checks.demo.status === 401 || checks.live.status === 401) {
    hints.push("Capital rejected the API key (error.invalid.api.key). Regenerate/enable the key in Capital.com Settings → API Integrations.");
  }
  const invalidDemo = checks.demo.status === 401 && checks.demo.bodySnippet.includes("error.invalid.api.key");
  const invalidLive = checks.live.status === 401 && checks.live.bodySnippet.includes("error.invalid.api.key");
  if (invalidDemo && invalidLive) {
    hints.push("Most often the key is masked/truncated/disabled/expired. Regenerate a new key and ensure it is Enabled/Play.");
  }

  return NextResponse.json(
    {
      baseUrl: BASE_URL,
      hasApiKey: Boolean(apiKeyRaw),
      apiKeyLen: apiKeyTrimmedLen,
      apiKeyRawLen,
      apiKeyTrimmedLen,
      apiKeyHasWhitespace,
      apiKeyHasAsterisks,
      apiKeyHasQuotes,
      apiKeyIsAscii,
      apiKeyLast4: apiKeyRaw ? apiKeyRaw.trim().slice(-4) : null,
      hasIdentifier: Boolean(identifier),
      hasPassword: Boolean(password),
      checks,
      hints,
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
