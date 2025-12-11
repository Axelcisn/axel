import { getTargetSpec, saveTargetSpec } from '@/lib/storage/targetSpecStore';
import { TargetSpec } from '@/lib/types/targetSpec';

interface EnsureDefaultSpecOptions {
  h?: number;
  coverage?: number;
  exchangeTz?: string;
  variable?: TargetSpec['variable'];
}

/**
 * Ensure a target spec exists for a symbol. If missing, create a sensible default
 * so downstream routes (e.g., volatility) can operate without manual setup.
 */
export async function ensureDefaultTargetSpec(
  symbol: string,
  opts: EnsureDefaultSpecOptions = {}
): Promise<TargetSpec> {
  const existing = await getTargetSpec(symbol);
  if (existing) return existing;

  const now = new Date().toISOString();
  const h = opts.h ?? 1;
  const coverage = opts.coverage ?? 0.95;
  const exchange_tz = opts.exchangeTz ?? 'America/New_York';

  const spec: TargetSpec = {
    symbol,
    h,
    coverage,
    exchange_tz,
    variable: opts.variable ?? 'NEXT_CLOSE_ADJ',
    cutoff_note: 'compute at t close; verify at t+1 close',
    updated_at: now,
  };

  return saveTargetSpec(spec);
}
