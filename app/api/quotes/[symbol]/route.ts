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
 * Fetch live quote from Yahoo Finance chart endpoint (primary)
 */
async function getYahooLiveQuote(symbol: string): Promise<Quote | null> {
  try {
    const url = new URL(
      `/v8/finance/chart/${encodeURIComponent(symbol)}`,
      "https://query1.finance.yahoo.com" // Use query1 as primary
    );
    url.searchParams.set("range", "1d");
    url.searchParams.set("interval", "1m");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const res = await fetch(url.toString(), {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
      }
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[Quotes] Yahoo primary failed for ${symbol}: ${res.status}`);
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
    if ((err as Error).name === 'AbortError') {
      console.warn(`[Quotes] Yahoo request timed out for ${symbol}`);
    } else {
      console.warn(`[Quotes] Yahoo quote fetch error for ${symbol}:`, err);
    }
    return null;
  }
}

/**
 * Fetch live quote from Yahoo Finance (backup endpoint)
 */
async function getYahooLiveQuoteBackup(symbol: string): Promise<Quote | null> {
  try {
    const url = new URL(
      `/v8/finance/chart/${encodeURIComponent(symbol)}`,
      "https://query2.finance.yahoo.com" // Backup endpoint
    );
    url.searchParams.set("range", "1d");
    url.searchParams.set("interval", "1m");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url.toString(), {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
      }
    });

    clearTimeout(timeoutId);

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
    return null;
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { symbol: string } }
) {
  try {
    const symbol = params.symbol;

    // Try primary Yahoo endpoint
    let liveQuote = await getYahooLiveQuote(symbol);
    
    // Try backup endpoint if primary fails
    if (!liveQuote) {
      liveQuote = await getYahooLiveQuoteBackup(symbol);
    }
    
    if (liveQuote) {
      return NextResponse.json(liveQuote, { 
        status: 200,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        }
      });
    }

    // Fallback to canonical data
    try {
      const quote: Quote = await getQuoteFromCanonical(symbol);
      return NextResponse.json(quote, { 
        status: 200,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        }
      });
    } catch (canonicalErr) {
      // Both live and canonical failed - return a more helpful error
      console.warn(`[Quotes] All sources failed for ${symbol}`);
      return NextResponse.json(
        { 
          error: `Quote temporarily unavailable for ${symbol}`,
          retryable: true 
        },
        { status: 503 } // Service unavailable, but retryable
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Quote API error", err);
    return NextResponse.json(
      { error: "Internal server error", message },
      { status: 500 }
    );
  }
}
