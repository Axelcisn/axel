import { NextResponse } from "next/server";
import { getAccountCash } from "@/lib/trading212/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cash = await getAccountCash();
    return NextResponse.json({ cash }, { status: 200 });
  } catch (err: unknown) {
    console.error("T212 account cash error", err);
    return NextResponse.json(
      { error: "Trading212 account cash failed" },
      { status: 500 }
    );
  }
}
