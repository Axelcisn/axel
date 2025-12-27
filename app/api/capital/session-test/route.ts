import { NextResponse } from "next/server";

const BASE_URL =
  process.env.CAPITAL_API_BASE_URL ?? "https://demo-api-capital.backend-capital.com";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function truncate(str: string, max = 200) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "..." : str;
}

export async function GET() {
  const apiKey = process.env.CAPITAL_API_KEY?.trim() || "";
  const identifier = process.env.CAPITAL_IDENTIFIER?.trim() || "";
  const password = process.env.CAPITAL_PASSWORD?.trim() || "";

  if (!apiKey || !identifier || !password) {
    return NextResponse.json(
      { ok: false, status: 400, message: "Missing env vars for Capital session." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const url = `${BASE_URL}/api/v1/session`;
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

    if (res.ok) {
      return NextResponse.json(
        { ok: true, status: res.status },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    const text = await res.text().catch(() => "");
    return NextResponse.json(
      {
        ok: false,
        status: res.status,
        bodySnippet: truncate(text),
      },
      { status: res.status, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, status: 500, bodySnippet: truncate(String(err)) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
