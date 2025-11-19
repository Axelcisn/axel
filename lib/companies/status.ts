/**
 * Company status and delisting management
 */

export interface CompanyStatus {
  symbol: string;
  exchange: string;
  status: 'active' | 'delisted' | 'suspended' | 'inactive';
  lastTradingDate?: string;
  delistingDate?: string;
  delistingReason?: string;
  statusCheckedAt: string;
  autoDetected: boolean;
}

export interface StatusUpdateResult {
  symbol: string;
  previousStatus: string;
  newStatus: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  requiresManualReview: boolean;
}

/**
 * Automatically detect if a symbol should be marked as delisted
 */
export function detectDelistingStatus(
  symbol: string,
  lastDataDate: string,
  currentDate: string = new Date().toISOString().split('T')[0],
  thresholdDays: number = 90
): StatusUpdateResult | null {
  const lastDate = new Date(lastDataDate);
  const today = new Date(currentDate);
  const daysSinceLastData = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

  if (daysSinceLastData <= thresholdDays) {
    return null; // Not old enough to consider delisted
  }

  // Determine confidence based on how old the data is
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (daysSinceLastData > 365) confidence = 'high';
  else if (daysSinceLastData > 180) confidence = 'medium';

  return {
    symbol,
    previousStatus: 'active',
    newStatus: 'inactive',
    reason: `No trading data for ${daysSinceLastData} days (last: ${lastDataDate})`,
    confidence,
    requiresManualReview: confidence !== 'high'
  };
}

/**
 * Save company status to storage
 */
export async function saveCompanyStatus(status: CompanyStatus): Promise<string> {
  const fs = await import('fs');
  const path = await import('path');
  
  const statusDir = path.join(process.cwd(), 'data', 'company-status');
  await fs.promises.mkdir(statusDir, { recursive: true });
  
  const filePath = path.join(statusDir, `${status.symbol}.json`);
  await fs.promises.writeFile(filePath, JSON.stringify(status, null, 2));
  
  return filePath;
}

/**
 * Load company status from storage
 */
export async function loadCompanyStatus(symbol: string): Promise<CompanyStatus | null> {
  const fs = await import('fs');
  const path = await import('path');
  
  const filePath = path.join(process.cwd(), 'data', 'company-status', `${symbol}.json`);
  
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content) as CompanyStatus;
  } catch (e) {
    return null;
  }
}

/**
 * Update company status after data ingestion
 */
export async function updateCompanyStatusAfterIngestion(
  symbol: string,
  exchange: string,
  dataDateRange: { start: string; end: string },
  forceCheck: boolean = false
): Promise<StatusUpdateResult | null> {
  let existingStatus = await loadCompanyStatus(symbol);
  const now = new Date().toISOString();

  // Skip check if recently checked (unless forced)
  if (!forceCheck && existingStatus && existingStatus.statusCheckedAt) {
    const lastChecked = new Date(existingStatus.statusCheckedAt);
    const hoursSinceCheck = (new Date().getTime() - lastChecked.getTime()) / (1000 * 60 * 60);
    if (hoursSinceCheck < 24) {
      return null; // Checked within last 24 hours
    }
  }

  // Detect potential delisting
  const delistingDetection = detectDelistingStatus(symbol, dataDateRange.end);

  if (delistingDetection) {
    // Update status
    const newStatus: CompanyStatus = {
      symbol,
      exchange,
      status: delistingDetection.newStatus as 'inactive',
      lastTradingDate: dataDateRange.end,
      statusCheckedAt: now,
      autoDetected: true,
      ...(delistingDetection.newStatus === 'delisted' && {
        delistingDate: dataDateRange.end,
        delistingReason: 'Auto-detected: extended period without trading data'
      })
    };

    await saveCompanyStatus(newStatus);
    return delistingDetection;
  } else {
    // Update to active status
    const activeStatus: CompanyStatus = {
      symbol,
      exchange,
      status: 'active',
      lastTradingDate: dataDateRange.end,
      statusCheckedAt: now,
      autoDetected: false
    };

    await saveCompanyStatus(activeStatus);
    
    if (existingStatus && existingStatus.status !== 'active') {
      return {
        symbol,
        previousStatus: existingStatus.status,
        newStatus: 'active',
        reason: 'Recent trading data received',
        confidence: 'high',
        requiresManualReview: false
      };
    }
  }

  return null;
}

/**
 * Get all companies with status issues requiring attention
 */
export async function getCompaniesRequiringStatusReview(): Promise<{
  pendingReview: CompanyStatus[];
  recentlyDelisted: CompanyStatus[];
  staleStatuses: CompanyStatus[];
}> {
  const fs = await import('fs');
  const path = await import('path');
  
  const statusDir = path.join(process.cwd(), 'data', 'company-status');
  
  try {
    const files = await fs.promises.readdir(statusDir);
    const statuses: CompanyStatus[] = [];
    
    for (const file of files.filter(f => f.endsWith('.json'))) {
      try {
        const content = await fs.promises.readFile(path.join(statusDir, file), 'utf-8');
        statuses.push(JSON.parse(content));
      } catch (e) {
        console.warn(`Failed to parse status file: ${file}`);
      }
    }

    const now = new Date();
    const pendingReview = statuses.filter(s => {
      if (s.status === 'inactive' && s.autoDetected) {
        return true; // Auto-detected inactive symbols need review
      }
      return false;
    });

    const recentlyDelisted = statuses.filter(s => {
      if (s.status === 'delisted' && s.delistingDate) {
        const delistedDate = new Date(s.delistingDate);
        const daysSince = (now.getTime() - delistedDate.getTime()) / (1000 * 60 * 60 * 24);
        return daysSince <= 30; // Delisted within last 30 days
      }
      return false;
    });

    const staleStatuses = statuses.filter(s => {
      const checkedDate = new Date(s.statusCheckedAt);
      const daysSinceCheck = (now.getTime() - checkedDate.getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceCheck > 7; // Not checked in over a week
    });

    return { pendingReview, recentlyDelisted, staleStatuses };
  } catch (e) {
    return { pendingReview: [], recentlyDelisted: [], staleStatuses: [] };
  }
}

/**
 * Manually override company status (for corrections)
 */
export async function manuallySetCompanyStatus(
  symbol: string,
  exchange: string,
  status: CompanyStatus['status'],
  reason: string,
  delistingDate?: string
): Promise<CompanyStatus> {
  const companyStatus: CompanyStatus = {
    symbol,
    exchange,
    status,
    statusCheckedAt: new Date().toISOString(),
    autoDetected: false,
    ...(delistingDate && status === 'delisted' && {
      delistingDate,
      delistingReason: reason
    })
  };

  await saveCompanyStatus(companyStatus);
  return companyStatus;
}