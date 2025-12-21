/**
 * Add N business days (trading days) to a given ISO date string.
 * Skips weekends (Saturday/Sunday). Does NOT skip holidays (v1).
 * 
 * @param dateISO - ISO date string "YYYY-MM-DD"
 * @param n - Number of business days to add
 * @returns ISO date string "YYYY-MM-DD" after adding N business days
 */
export function addBusinessDaysISO(dateISO: string, n: number): string {
  // Parse date in UTC to avoid timezone shifts
  const date = new Date(dateISO + 'T00:00:00Z');
  
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateISO}`);
  }
  
  let businessDaysAdded = 0;
  
  while (businessDaysAdded < n) {
    // Move to next day
    date.setUTCDate(date.getUTCDate() + 1);
    
    // Check if it's a weekday (Monday=1, Sunday=0)
    const dayOfWeek = date.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      // Not Saturday (6) or Sunday (0)
      businessDaysAdded++;
    }
  }
  
  // Format as YYYY-MM-DD
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}
