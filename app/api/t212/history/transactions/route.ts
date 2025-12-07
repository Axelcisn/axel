import { NextRequest, NextResponse } from "next/server";
import { getTransactions } from "@/lib/trading212/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? "50");
    const cursorPath = searchParams.get("cursorPath") ?? undefined;
    const timeFrom = searchParams.get("timeFrom") ?? undefined;

    const response = await getTransactions({ limit, cursorPath, timeFrom });

    return NextResponse.json(response, { status: 200 });
  } catch (err: unknown) {
    console.error("T212 transactions error", err);
    return NextResponse.json(
      { error: "Trading212 transactions failed" },
      { status: 500 }
    );
  }
}
