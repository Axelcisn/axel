import { IngestionResult, CanonicalRow, CanonicalTableMeta, RepairRecord } from '../types/canonical';
import { resolveExchangeAndTZ, listTradingDays } from '../calendar/service';
import { parseExcelToRows, mapColumns } from './excel';
import { computeLogReturns, sortAndDedup, validateRows } from '../validation/rules';
import { computeBadges } from '../validation/badges';
import { saveRaw, saveCanonical, appendRepairs } from '../storage/fsStore';

export async function ingestExcel({
  filePath,
  fileBuffer,
  symbol,
  exchange
}: {
  filePath?: string;
  fileBuffer?: Buffer;
  symbol?: string;
  exchange?: string;
}): Promise<IngestionResult> {
  // Resolve symbol (param or from filename prefix)
  let resolvedSymbol = symbol;
  if (!resolvedSymbol && filePath) {
    const filename = filePath.split('/').pop() || '';
    const match = filename.match(/^([A-Z]+)/);
    if (match) {
      resolvedSymbol = match[1];
    }
  }
  if (!resolvedSymbol) {
    throw new Error('Symbol must be provided or derivable from filename');
  }

  // Resolve {exchange, tz}
  const { exchange: resolvedExchange, tz } = await resolveExchangeAndTZ(resolvedSymbol, exchange);

  // Save raw file first if buffer provided
  let rawPath = filePath || '';
  if (fileBuffer) {
    rawPath = await saveRaw(fileBuffer, resolvedSymbol);
  }

  // Parse & map rows
  const rawRows = await parseExcelToRows(rawPath);
  const mappedRows = mapColumns(rawRows);

  // Sort & dedup
  const { rows: dedupedRows, duplicates } = sortAndDedup(mappedRows);

  // Compute log returns on adj_close
  const rowsWithReturns = computeLogReturns(dedupedRows);

  // Validate OHLC coherence; collect issues; mark valid
  const validatedRows = validateRows(rowsWithReturns);

  // Calculate calendar span
  const dates = validatedRows.map(row => row.date).sort();
  const calendarSpan = {
    start: dates[0] || '',
    end: dates[dates.length - 1] || ''
  };

  // Detect calendar gaps (weekday approximation)
  const expectedDays = listTradingDays(tz, calendarSpan.start, calendarSpan.end);
  const actualDays = new Set(dates);
  const missingTradingDays = expectedDays.filter(day => !actualDays.has(day));

  // Compute counts
  const inputCount = rawRows.length;
  const canonicalCount = validatedRows.length;
  const invalidCount = validatedRows.filter(row => row.valid === false).length;
  const missingDaysCount = missingTradingDays.length;

  // Build meta with span and tz
  const meta: CanonicalTableMeta = {
    symbol: resolvedSymbol,
    exchange: resolvedExchange,
    exchange_tz: tz,
    calendar_span: calendarSpan,
    rows: canonicalCount,
    missing_trading_days: missingTradingDays,
    invalid_rows: invalidCount,
    generated_at: new Date().toISOString()
  };

  // Compute badges
  const badges = computeBadges(validatedRows, meta);

  // Collect repair records
  const repairs: RepairRecord[] = [];
  const timestamp = new Date().toISOString();
  
  validatedRows.forEach(row => {
    if (row.issues) {
      row.issues.forEach(issue => {
        repairs.push({
          symbol: resolvedSymbol,
          date: row.date,
          field: issue.includes('adj_close') ? 'adj_close' : 'validation',
          oldValue: null,
          newValue: null,
          reason: issue,
          timestamp
        });
      });
    }
  });

  if (duplicates.length > 0) {
    duplicates.forEach(date => {
      repairs.push({
        symbol: resolvedSymbol,
        date,
        field: 'date',
        oldValue: 'duplicate',
        newValue: 'removed',
        reason: 'duplicate_date_removed',
        timestamp
      });
    });
  }

  // Persist raw, canonical, repairs
  const canonicalPath = await saveCanonical(resolvedSymbol, { rows: validatedRows, meta });
  const auditPath = await appendRepairs(resolvedSymbol, repairs);

  // Return IngestionResult
  return {
    symbol: resolvedSymbol,
    paths: {
      raw: rawPath,
      canonical: canonicalPath,
      audit: auditPath
    },
    counts: {
      input: inputCount,
      canonical: canonicalCount,
      invalid: invalidCount,
      missingDays: missingDaysCount
    },
    meta,
    badges
  };
}