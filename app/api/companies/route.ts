import { NextResponse } from 'next/server';
import { getCompanies, saveCompanies, searchCompanies } from '@/lib/dataStore';
import { StockData } from '@/lib/csvUtils';

type SavePayload = {
  companies?: StockData[];
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SavePayload;

    if (!Array.isArray(body.companies)) {
      return NextResponse.json({ error: 'Invalid payload. Expected an array of companies.' }, { status: 400 });
    }

    saveCompanies(body.companies);

    return NextResponse.json({ success: true, count: body.companies.length });
  } catch (error) {
    return NextResponse.json({ error: 'Unable to save portfolio data.' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query') ?? '';
  const results = query ? searchCompanies(query) : getCompanies();

  return NextResponse.json({ results });
}
