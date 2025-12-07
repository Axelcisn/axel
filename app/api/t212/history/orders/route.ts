import { NextRequest, NextResponse } from "next/server";
import { getHistoricalOrders } from "@/lib/trading212/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? "50");
    const cursorPath = searchParams.get("cursorPath") ?? undefined;
    const ticker = searchParams.get("ticker") ?? undefined;

    const response = await getHistoricalOrders({ limit, cursorPath, ticker });

    return NextResponse.json(response, { status: 200 });
  } catch (err: unknown) {
    console.error("T212 historical orders error", err);
    return NextResponse.json(
      { error: "Trading212 historical orders failed" },
      { status: 500 }
    );
  }
}
