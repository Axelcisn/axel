import { NextRequest, NextResponse } from "next/server";
import { getPositions } from "@/lib/trading212/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get("ticker") ?? undefined;

    const positions = await getPositions(ticker);

    return NextResponse.json({ items: positions }, { status: 200 });
  } catch (err: unknown) {
    console.error("T212 positions error", err);
    return NextResponse.json(
      { error: "Trading212 positions failed" },
      { status: 500 }
    );
  }
}
