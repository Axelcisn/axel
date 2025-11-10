import { NextRequest, NextResponse } from 'next/server';
import { saveCompany, getCompany, getAllCompanies } from '@/lib/storage/companyStore';
import { CompanyInfo } from '@/lib/types/company';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    
    if (ticker) {
      // Get specific company
      const company = await getCompany(ticker);
      if (!company) {
        return NextResponse.json({ error: 'Company not found' }, { status: 404 });
      }
      return NextResponse.json(company);
    } else {
      // Get all companies
      const companies = await getAllCompanies();
      return NextResponse.json(companies);
    }
  } catch (error) {
    console.error('Company GET error:', error);
    return NextResponse.json({ 
      error: 'Failed to retrieve company', 
      details: error instanceof Error ? error.message : String(error) 
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticker, name, exchange } = body;
    
    if (!ticker || !name) {
      return NextResponse.json({ 
        error: 'Invalid company data', 
        details: 'Ticker and name are required' 
      }, { status: 400 });
    }
    
    const companyInfo: CompanyInfo = {
      ticker: ticker.toUpperCase(),
      name,
      exchange,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await saveCompany(companyInfo);
    
    return NextResponse.json({ 
      success: true, 
      company: companyInfo 
    }, { status: 201 });
    
  } catch (error) {
    console.error('Company POST error:', error);
    return NextResponse.json({ 
      error: 'Failed to save company', 
      details: error instanceof Error ? error.message : String(error) 
    }, { status: 500 });
  }
}