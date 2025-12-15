import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const bridgeUrl = process.env.IBKR_BRIDGE_URL;

async function proxyEquity() {
  if (!bridgeUrl) {
    return NextResponse.json(
      { error: 'IBKR bridge not configured', hint: 'Set IBKR_BRIDGE_URL to enable live equity series' },
      { status: 503 },
    );
  }

  const base = bridgeUrl.replace(/\/$/, '');
  const targets = [`${base}/equity`, `${base}/portfolio/equity`];

  let lastError: { status?: number; details?: string; message?: string } | null = null;

  for (const target of targets) {
    try {
      const res = await fetch(target, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data, { status: 200 });
      }

      lastError = { status: res.status, details: (await res.text())?.slice(0, 500) };
    } catch (error) {
      lastError = { message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  return NextResponse.json(
    {
      error: 'IBKR bridge request failed',
      status: lastError?.status ?? 503,
      details: lastError?.details,
      message: lastError?.message,
    },
    { status: 503 },
  );
}

export async function GET() {
  return proxyEquity();
}
