import { NextResponse } from "next/server";
import { getCapitalQuote } from "@/lib/marketData/capital";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { epic: string } }
) {
  try {
    const epic = decodeURIComponent(params.epic);
    const quote = await getCapitalQuote(epic);

    return NextResponse.json(quote, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
