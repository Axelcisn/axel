/**
 * Trading days utilities for chart components
 */

/**
 * Get the next N trading dates after a given date from a list of dates
 * @param startDate - Starting date in YYYY-MM-DD format
 * @param count - Number of trading dates to get
 * @param allDates - Array of all available dates in YYYY-MM-DD format
 * @returns Array of trading dates
 */
export function getNextTradingDates(
  startDate: string, 
  count: number, 
  allDates: string[]
): string[] {
  const startIndex = allDates.indexOf(startDate);
  if (startIndex === -1) {
    return [];
  }
  
  // Get the next count dates after startDate
  return allDates.slice(startIndex + 1, startIndex + 1 + count);
}

/**
 * Generate future trading dates by adding business days
 * Note: This is a simplified version that adds business days (Mon-Fri)
 * For accurate trading calendars, use the calendar service instead
 * @param startDate - Starting date in YYYY-MM-DD format
 * @param count - Number of trading dates to generate
 * @returns Array of generated trading dates
 */
export function generateFutureTradingDates(startDate: string, count: number): string[] {
  const dates: string[] = [];
  let currentDate = new Date(startDate + 'T00:00:00Z');
  
  while (dates.length < count) {
    // Move to next day
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    
    // Skip weekends (Saturday = 6, Sunday = 0)
    const dayOfWeek = currentDate.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      dates.push(currentDate.toISOString().split('T')[0]);
    }
  }
  
  return dates;
}