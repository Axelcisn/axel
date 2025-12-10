import { NextRequest, NextResponse } from "next/server";

interface YahooQuoteSummary {
  quoteSummary: {
    result: Array<{
      price?: {
        shortName?: string;
        longName?: string;
        symbol?: string;
        exchange?: string;
        exchangeName?: string;
      };
    }> | null;
    error: null | { code: string; description: string };
  };
}

/**
 * Fetches company info (name, exchange) from Yahoo Finance.
 * GET /api/company-info/[symbol]
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = params.symbol.toUpperCase();

    // Use Yahoo Finance quoteSummary endpoint to get company details
    const url = new URL(
      `/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`,
      "https://query2.finance.yahoo.com"
    );
    url.searchParams.set("modules", "price");

    const res = await fetch(url.toString(), { 
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
      }
    });

    if (!res.ok) {
      // Try alternative endpoint if quoteSummary fails
      return await fetchFromQuoteEndpoint(symbol);
    }

    const data = (await res.json()) as YahooQuoteSummary;

    if (!data.quoteSummary || data.quoteSummary.error || !data.quoteSummary.result?.[0]) {
      return await fetchFromQuoteEndpoint(symbol);
    }

    const priceInfo = data.quoteSummary.result[0].price;
    
    return NextResponse.json({
      symbol,
      name: priceInfo?.longName || priceInfo?.shortName || null,
      shortName: priceInfo?.shortName || null,
      exchange: priceInfo?.exchangeName || priceInfo?.exchange || null,
    });

  } catch (error) {
    console.error("Company info API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch company info" },
      { status: 500 }
    );
  }
}

/**
 * Fallback: Use the v6/finance/quote endpoint
 */
async function fetchFromQuoteEndpoint(symbol: string) {
  try {
    const url = new URL(
      "/v6/finance/quote",
      "https://query2.finance.yahoo.com"
    );
    url.searchParams.set("symbols", symbol);

    const res = await fetch(url.toString(), { 
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
      }
    });

    if (!res.ok) {
      return NextResponse.json(
        { symbol, name: null, shortName: null, exchange: null },
        { status: 200 }
      );
    }

    const data = await res.json();
    const quote = data.quoteResponse?.result?.[0];

    if (!quote) {
      return NextResponse.json(
        { symbol, name: null, shortName: null, exchange: null },
        { status: 200 }
      );
    }

    return NextResponse.json({
      symbol,
      name: quote.longName || quote.shortName || null,
      shortName: quote.shortName || null,
      exchange: quote.fullExchangeName || quote.exchange || null,
    });

  } catch (error) {
    console.error("Quote endpoint fallback error:", error);
    return NextResponse.json(
      { symbol, name: null, shortName: null, exchange: null },
      { status: 200 }
    );
  }
}
