import { NextRequest, NextResponse } from "next/server";
import { getDividends } from "@/lib/trading212/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? "50");
    const cursorPath = searchParams.get("cursorPath") ?? undefined;
    const ticker = searchParams.get("ticker") ?? undefined;

    const response = await getDividends({ limit, cursorPath, ticker });

    return NextResponse.json(response, { status: 200 });
  } catch (err: unknown) {
    console.error("T212 dividends error", err);
    return NextResponse.json(
      { error: "Trading212 dividends failed" },
      { status: 500 }
    );
  }
}
