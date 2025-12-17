import { NextRequest, NextResponse } from "next/server";
import { getAllCompanies } from "@/lib/storage/companyStore";

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const q = (searchParams.get("q") || "").trim();

    if (!q) {
      return NextResponse.json([], { status: 200 });
    }

    const needle = q.toLowerCase();
    const companies = await getAllCompanies();

    const matches = companies
      .filter((c) => {
        const nameMatch = (c.name || "").toLowerCase().includes(needle);
        const tickerMatch = (c.ticker || "").toLowerCase().startsWith(needle);
        return nameMatch || tickerMatch;
      })
      .slice(0, 10)
      .map((c) => ({
        symbol: c.ticker,
        name: c.name,
        exchange: (c as any).exchange,
      }));

    return NextResponse.json(matches, { status: 200 });
  } catch (err: unknown) {
    console.error("Companies search error", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
