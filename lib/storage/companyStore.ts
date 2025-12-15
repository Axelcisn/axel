import { CompanyInfo, CompanyRegistry } from '../types/company';

export async function loadCompanyRegistry(): Promise<CompanyRegistry> {
  try {
    const response = await fetch('/data/companies.json');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    // Return empty registry if file doesn't exist
    return {};
  }
}

export async function saveCompanyRegistry(registry: CompanyRegistry): Promise<void> {
  // NOTE: In production with static files, we can't save company registry.
  // This would need to be handled via an API endpoint that stores data elsewhere
  console.warn('saveCompanyRegistry: Writing to static files not supported in production');
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