import { NextRequest, NextResponse } from "next/server";
import { getQuoteFromCanonical } from "@/lib/quotes";
import type { Quote } from "@/lib/types/quotes";

export async function GET(
  _req: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = params.symbol;

    // TODO: first try real-time provider(s) here, then fall back to canonical.
    // const live = await getLiveQuoteFromProvider(symbol);
    // if (live) return NextResponse.json(live, { status: 200 });
    const quote: Quote = await getQuoteFromCanonical(symbol);

    return NextResponse.json(quote, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.toLowerCase().includes("no canonical data")) {
      return NextResponse.json(
        { error: `No quote for symbol ${params.symbol}` },
        { status: 404 }
      );
    }

    console.error("Quote API error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
