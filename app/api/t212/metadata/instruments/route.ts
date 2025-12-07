import { NextResponse } from "next/server";
import { getInstruments } from "@/lib/trading212/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const instruments = await getInstruments();
    return NextResponse.json({ items: instruments }, { status: 200 });
  } catch (err: unknown) {
    console.error("T212 instruments error", err);
    return NextResponse.json(
      { error: "Trading212 instruments failed" },
      { status: 500 }
    );
  }
}
