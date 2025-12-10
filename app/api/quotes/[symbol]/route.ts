import { NextRequest, NextResponse } from "next/server";
import { getQuoteFromCanonical } from "@/lib/quotes";
import type { Quote } from "@/lib/types/quotes";

interface YahooChartMeta {
  symbol: string;
  regularMarketPrice: number;
  chartPreviousClose: number;
  currency: string;
}

interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: YahooChartMeta;
    }> | null;
    error: null | { code: string; description: string };
  };
}

/**
 * Fetch live quote from Yahoo Finance chart endpoint
 */
async function getYahooLiveQuote(symbol: string): Promise<Quote | null> {
  try {
    const url = new URL(
      `/v8/finance/chart/${encodeURIComponent(symbol)}`,
      "https://query2.finance.yahoo.com"
    );
    url.searchParams.set("range", "1d");
    url.searchParams.set("interval", "1m");

    const res = await fetch(url.toString(), {
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
      }
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as YahooChartResponse;

    if (!data.chart || data.chart.error || !data.chart.result?.[0]) {
      return null;
    }

    const meta = data.chart.result[0].meta;
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose;
    const change = price - prevClose;
    const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;

    return {
      symbol: meta.symbol,
      price,
      prevClose,
      change,
      changePct,
      currency: meta.currency || "USD",
      asOf: new Date().toISOString(),
    };
  } catch (err) {
    console.error("Yahoo quote fetch error:", err);
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = params.symbol;

    // First try Yahoo Finance for live quote
    const liveQuote = await getYahooLiveQuote(symbol);
    if (liveQuote) {
      return NextResponse.json(liveQuote, { status: 200 });
    }

    // Fallback to canonical data
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
