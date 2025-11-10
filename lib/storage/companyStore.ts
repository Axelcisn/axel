import * as fs from 'fs';
import * as path from 'path';
import { CompanyInfo, CompanyRegistry } from '../types/company';

const DATA_ROOT = path.join(process.cwd(), 'data');
const COMPANIES_FILE = path.join(DATA_ROOT, 'companies.json');

export async function loadCompanyRegistry(): Promise<CompanyRegistry> {
  try {
    // Ensure data directory exists
    await fs.promises.mkdir(DATA_ROOT, { recursive: true });
    
    const data = await fs.promises.readFile(COMPANIES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // Return empty registry if file doesn't exist
    return {};
  }
}

export async function saveCompanyRegistry(registry: CompanyRegistry): Promise<void> {
  // Ensure data directory exists
  await fs.promises.mkdir(DATA_ROOT, { recursive: true });
  
  // Atomic write
  const tempFile = `${COMPANIES_FILE}.tmp`;
  await fs.promises.writeFile(tempFile, JSON.stringify(registry, null, 2), 'utf-8');
  await fs.promises.rename(tempFile, COMPANIES_FILE);
}

export async function saveCompany(companyInfo: CompanyInfo): Promise<void> {
  const registry = await loadCompanyRegistry();
  
  const now = new Date().toISOString();
  const existingCompany = registry[companyInfo.ticker];
  
  registry[companyInfo.ticker] = {
    ...companyInfo,
    createdAt: existingCompany?.createdAt || now,
    updatedAt: now
  };
  
  await saveCompanyRegistry(registry);
}

export async function getCompany(ticker: string): Promise<CompanyInfo | null> {
  const registry = await loadCompanyRegistry();
  return registry[ticker] || null;
}

export async function getAllCompanies(): Promise<CompanyInfo[]> {
  const registry = await loadCompanyRegistry();
  return Object.values(registry).sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export async function deleteCompany(ticker: string): Promise<void> {
  const registry = await loadCompanyRegistry();
  delete registry[ticker];
  await saveCompanyRegistry(registry);
}