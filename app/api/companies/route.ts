import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { saveCompany, getCompany, getAllCompanies } from '@/lib/storage/companyStore';
import { CompanyInfo } from '@/lib/types/company';

/**
 * Check if canonical data exists for a ticker
 */
async function hasCanonicalData(ticker: string): Promise<boolean> {
  const canonicalPath = path.join(process.cwd(), 'data', 'canonical', `${ticker}.json`);
  try {
    await fs.access(canonicalPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if uploads exist for a ticker
 */
async function hasUploadsData(ticker: string): Promise<boolean> {
  const uploadsDir = path.join(process.cwd(), 'data', 'uploads');
  try {
    const files = await fs.readdir(uploadsDir);
    return files.some(file => 
      file.toLowerCase().includes(ticker.toLowerCase()) && 
      (file.endsWith('.xlsx') || file.endsWith('.csv') || file.endsWith('.xls'))
    );
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    
    if (ticker) {
      // Get specific company with existence flags
      const company = await getCompany(ticker);
      if (!company) {
        return NextResponse.json({ error: 'Company not found' }, { status: 404 });
      }
      
      // Enrich with existence flags
      const [hasCanonical, hasUploads] = await Promise.all([
        hasCanonicalData(ticker),
        hasUploadsData(ticker)
      ]);
      
      return NextResponse.json({
        ...company,
        hasCanonical,
        hasUploads
      });
    } else {
      // Get all companies with existence flags
      const companies = await getAllCompanies();
      
      // Enrich each company with existence flags in parallel
      const enrichedCompanies = await Promise.all(
        companies.map(async (company) => {
          const [hasCanonical, hasUploads] = await Promise.all([
            hasCanonicalData(company.ticker),
            hasUploadsData(company.ticker)
          ]);
          return {
            ...company,
            hasCanonical,
            hasUploads
          };
        })
      );
      
      return NextResponse.json(enrichedCompanies);
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