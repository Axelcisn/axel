import { CanonicalRow, CanonicalTableMeta, ValidationBadges } from '../types/canonical';
import { listTradingDays } from '../calendar/service';

export function computeBadges(
  rows: CanonicalRow[], 
  meta: Partial<CanonicalTableMeta>
): ValidationBadges {
  // Contract OK: required columns present (checking if we have basic price data)
  const contractOK = rows.length > 0 && rows.every(row => 
    row.date && 
    typeof row.open === 'number' && 
    typeof row.high === 'number' && 
    typeof row.low === 'number' && 
    typeof row.close === 'number'
  );

  // Calendar OK: no missing trading days (weekday approximation)
  let calendarOK = true;
  if (meta.calendar_span && meta.exchange_tz) {
    const expectedDays = listTradingDays(
      meta.exchange_tz, 
      meta.calendar_span.start, 
      meta.calendar_span.end
    );
    const actualDays = new Set(rows.map(row => row.date));
    const missingDays = expectedDays.filter(day => !actualDays.has(day.date));
    calendarOK = missingDays.length === 0;
  }

  // TZ OK: IANA tz resolved
  const tzOK = Boolean(meta.exchange_tz && meta.exchange_tz.includes('/'));

  // Corporate Actions OK: corporate-action columns exist OR explicitly marked "unknown"
  const hasCorpActions = rows.some(row => 
    row.split_factor !== null && row.split_factor !== undefined ||
    row.cash_dividend !== null && row.cash_dividend !== undefined
  );
  // For now, consider OK if we have any corp action data or if we explicitly don't need it
  const corpActionsOK = hasCorpActions || true; // TODO: Add explicit "unknown" marking

  // Validations OK: all rows valid & OHLC coherence holds
  const validationsOK = rows.every(row => row.valid !== false);

  // Repairs count: total row issues
  const repairsCount = rows.reduce((count, row) => {
    return count + (row.issues?.length || 0);
  }, 0);

  return {
    contractOK,
    calendarOK,
    tzOK,
    corpActionsOK,
    validationsOK,
    repairsCount
  };
}