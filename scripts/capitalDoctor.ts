import "./_loadEnv";
import { setTimeout as delay } from "timers/promises";

const DEMO_BASE = process.env.CAPITAL_API_BASE_URL?.trim() || "https://demo-api-capital.backend-capital.com";

function truncate(str: string, max = 200) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "..." : str;
}

function metaForKey(raw: string) {
  const trimmed = raw.trim();
  return {
    keyTrimmedLen: trimmed.length,
    keyLast4: trimmed.slice(-4),
    hasWhitespace: raw !== trimmed,
    hasAsterisks: raw.includes("*"),
    hasQuotes: /^['"]/.test(raw) || /['"]$/.test(raw),
  };
}

async function checkEncryptionKey(base: string, apiKey: string) {
  const url = `${base}/api/v1/session/encryptionKey`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "X-CAP-API-KEY": apiKey, Accept: "application/json" },
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  return { status: res.status, ok: res.ok, bodySnippet: truncate(text) };
}

async function trySession(base: string, apiKey: string, identifier: string, password: string) {
  const url = `${base}/api/v1/session`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-CAP-API-KEY": apiKey,
    },
    body: JSON.stringify({
      identifier,
      password,
      encryptedPassword: false,
    }),
    cache: "no-store",
  });
  const text = await res.text().catch(() => "");
  return { status: res.status, ok: res.ok, bodySnippet: truncate(text) };
}

async function main() {
  const apiKeyRaw = process.env.CAPITAL_API_KEY || "";
  const apiKey = apiKeyRaw.trim();
  const identifier = (process.env.CAPITAL_IDENTIFIER || "").trim();
  const password = (process.env.CAPITAL_PASSWORD || "").trim();
  const passwordAlt = (process.env.CAPITAL_PASSWORD_ALT || "").trim();

  const keyMeta = metaForKey(apiKeyRaw);

  if (!apiKey || !identifier || !password) {
    console.error("Missing CAPITAL_API_KEY or CAPITAL_IDENTIFIER or CAPITAL_PASSWORD.");
    console.error(`keyTrimmedLen=${keyMeta.keyTrimmedLen} keyLast4=${keyMeta.keyLast4} hasWhitespace=${keyMeta.hasWhitespace} hasQuotes=${keyMeta.hasQuotes} hasAsterisks=${keyMeta.hasAsterisks}`);
    process.exit(1);
  }

  console.log(`Checking API key on DEMO ${DEMO_BASE} ...`);
  const enc = await checkEncryptionKey(DEMO_BASE, apiKey);
  console.log(`encryptionKey status=${enc.status} ok=${enc.ok} body=${enc.bodySnippet} keyTrimmedLen=${keyMeta.keyTrimmedLen} keyLast4=${keyMeta.keyLast4} hasWhitespace=${keyMeta.hasWhitespace} hasQuotes=${keyMeta.hasQuotes} hasAsterisks=${keyMeta.hasAsterisks}`);

  if (enc.status === 401 && enc.bodySnippet.includes("error.invalid.api.key")) {
    console.error("API KEY REJECTED (invalid.api.key).");
    console.error("Password does NOT matter yet — API key is rejected upstream.");
    console.error("NEXT STEPS:");
    console.error("  1) Regenerate a NEW key and copy it at creation time (one-time reveal; later it’s masked)");
    console.error("  2) Ensure key is Enabled/Play");
    console.error("  3) Paste into .env.local and restart dev server");
    console.error("  4) Run npm run capital:doctor again");
    process.exit(2);
  }

  if (!enc.ok) {
    console.error("API key check failed (non-401). Resolve this before testing passwords.");
    process.exit(2);
  }

  console.log("API KEY ACCEPTED on DEMO. Testing session with password candidate(s)...");
  const candidates = [password, passwordAlt].filter((p, idx, arr) => p && arr.indexOf(p) === idx);

  for (let i = 0; i < candidates.length; i++) {
    const label = `candidate #${i + 1}`;
    const res = await trySession(DEMO_BASE, apiKey, identifier, candidates[i]);
    if (res.ok) {
      console.log(`SESSION OK using ${label}`);
      console.log("NEXT STEPS:");
      console.log("  - Run: curl -s http://localhost:3001/api/capital/quote/OIL_CRUDE");
      console.log("  - Open /capital-demo");
      process.exit(0);
    }
    console.error(`SESSION FAILED ${label}: status=${res.status} body=${res.bodySnippet}`);
  }

  console.error("API KEY ACCEPTED, PASSWORD FAILED.");
  console.error("NEXT STEPS:");
  console.error("  - Use the API-key custom password (not the account password)");
  console.error("  - Set CAPITAL_PASSWORD_ALT in .env.local to test a second candidate");
  console.error("  - Restart dev server if needed and rerun npm run capital:doctor");
  process.exit(3);
}

main().catch(async (err) => {
  console.error(err);
  await delay(1);
  process.exit(1);
});
