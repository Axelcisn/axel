import { NextRequest, NextResponse } from "next/server";

interface YahooChartMeta {
  symbol: string;
  longName?: string;
  shortName?: string;
  exchangeName?: string;
  fullExchangeName?: string;
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
 * Fetches company info (name, exchange) from Yahoo Finance chart endpoint.
 * GET /api/company-info/[symbol]
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = params.symbol.toUpperCase();

    // Use Yahoo Finance chart endpoint - includes company name in meta
    const url = new URL(
      `/v8/finance/chart/${encodeURIComponent(symbol)}`,
      "https://query2.finance.yahoo.com"
    );
    url.searchParams.set("range", "1d");
    url.searchParams.set("interval", "1d");

    const res = await fetch(url.toString(), { 
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
      }
    });

    if (!res.ok) {
      console.error(`Yahoo chart request failed: ${res.status}`);
      return NextResponse.json(
        { symbol, name: null, shortName: null, exchange: null },
        { status: 200 }
      );
    }

    const data = (await res.json()) as YahooChartResponse;

    if (!data.chart || data.chart.error || !data.chart.result?.[0]) {
      console.error("Yahoo chart response error:", data.chart?.error);
      return NextResponse.json(
        { symbol, name: null, shortName: null, exchange: null },
        { status: 200 }
      );
    }

    const meta = data.chart.result[0].meta;
    
    return NextResponse.json({
      symbol,
      name: meta.longName || meta.shortName || null,
      shortName: meta.shortName || null,
      exchange: meta.fullExchangeName || meta.exchangeName || null,
    });

  } catch (error) {
    console.error("Company info API error:", error);
    return NextResponse.json(
      { symbol, name: null, shortName: null, exchange: null },
      { status: 200 }
    );
  }
}
