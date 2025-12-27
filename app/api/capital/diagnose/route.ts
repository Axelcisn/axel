import { NextResponse } from "next/server";

const BASE_URL =
  process.env.CAPITAL_API_BASE_URL ?? "https://demo-api-capital.backend-capital.com";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function truncate(str: string, max = 300): string {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "..." : str;
}

export async function GET() {
  const apiKey = process.env.CAPITAL_API_KEY;
  const identifier = process.env.CAPITAL_IDENTIFIER;
  const password = process.env.CAPITAL_PASSWORD;

  let encryptionKeyCheck: { status: number | null; ok: boolean; bodySnippet: string } = {
    status: null,
    ok: false,
    bodySnippet: "",
  };

  try {
    const res = await fetch(`${BASE_URL}/api/v1/session/encryptionKey`, {
      method: "GET",
      headers: {
        "X-CAP-API-KEY": apiKey ?? "",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const text = await res.text().catch(() => "");
    encryptionKeyCheck = {
      status: res.status,
      ok: res.ok,
      bodySnippet: truncate(text),
    };
  } catch (err: any) {
    encryptionKeyCheck = {
      status: -1,
      ok: false,
      bodySnippet: truncate(String(err)),
    };
  }

  return NextResponse.json(
    {
      baseUrl: BASE_URL,
      hasApiKey: Boolean(apiKey),
      apiKeyLen: apiKey?.length ?? 0,
      apiKeyLast4: apiKey ? apiKey.slice(-4) : null,
      hasIdentifier: Boolean(identifier),
      hasPassword: Boolean(password),
      encryptionKeyCheck,
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
