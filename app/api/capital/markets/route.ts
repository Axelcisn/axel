import { NextRequest, NextResponse } from "next/server";
import { searchCapitalMarkets } from "@/lib/marketData/capital";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const searchTerm = searchParams.get("searchTerm") || "";

  if (!searchTerm.trim()) {
    return NextResponse.json({ error: "searchTerm required" }, { status: 400 });
  }

  try {
    const results = await searchCapitalMarkets(searchTerm, 20);
    return NextResponse.json(results, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: "search_failed",
        message: err?.message ?? "Unknown error",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
