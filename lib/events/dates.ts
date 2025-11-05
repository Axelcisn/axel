/** Return the next trading date after `iso` using the exchange calendar (weekday approximation ok). */
export function nextTradingDate(iso: string, tz: string): string {
  const date = new Date(iso);
  
  // Add one day and find next weekday
  do {
    date.setDate(date.getDate() + 1);
  } while (date.getDay() === 0 || date.getDay() === 6); // Skip weekends
  
  return date.toISOString().split('T')[0];
}

/** True if `iso` is a trading date; else false. */
export function isTradingDate(iso: string, tz: string): boolean {
  const date = new Date(iso);
  const dayOfWeek = date.getDay();
  
  // Simple weekday check (0 = Sunday, 6 = Saturday)
  return dayOfWeek !== 0 && dayOfWeek !== 6;
}

/** Get previous trading date before `iso` */
export function previousTradingDate(iso: string, tz: string): string {
  const date = new Date(iso);
  
  // Subtract one day and find previous weekday
  do {
    date.setDate(date.getDate() - 1);
  } while (date.getDay() === 0 || date.getDay() === 6); // Skip weekends
  
  return date.toISOString().split('T')[0];
}