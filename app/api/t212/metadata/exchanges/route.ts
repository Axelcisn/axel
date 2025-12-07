import { NextResponse } from "next/server";
import { getExchanges } from "@/lib/trading212/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const exchanges = await getExchanges();
    return NextResponse.json({ items: exchanges }, { status: 200 });
  } catch (err: unknown) {
    console.error("T212 exchanges error", err);
    return NextResponse.json(
      { error: "Trading212 exchanges failed" },
      { status: 500 }
    );
  }
}
