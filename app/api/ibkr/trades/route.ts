import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const bridgeUrl = process.env.IBKR_BRIDGE_URL;

async function proxy(path: string) {
  if (!bridgeUrl) {
    return NextResponse.json(
      { error: 'IBKR bridge not configured', hint: 'Set IBKR_BRIDGE_URL to enable live trades' },
      { status: 503 },
    );
  }

  const target = `${bridgeUrl.replace(/\/$/, '')}${path}`;

  try {
    const res = await fetch(target, { cache: 'no-store' });
    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json(
        {
          error: 'IBKR bridge returned an error',
          status: res.status,
          details: body?.slice(0, 500),
        },
        { status: 503 },
      );
    }

    const data = await res.json();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'IBKR bridge request failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 },
    );
  }
}

export async function GET() {
  return proxy('/trades');
}
