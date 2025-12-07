import { NextResponse } from "next/server";
import { getAccountSummary } from "@/lib/trading212/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const summary = await getAccountSummary();
    return NextResponse.json({ summary }, { status: 200 });
  } catch (err: unknown) {
    console.error("T212 account summary error", err);
    return NextResponse.json(
      { error: "Trading212 account summary failed" },
      { status: 500 }
    );
  }
}
