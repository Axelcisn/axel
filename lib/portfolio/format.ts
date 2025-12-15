const compactCurrencyFormatters = new Map<string, Intl.NumberFormat>();
const currencyFormatters = new Map<string, Intl.NumberFormat>();

const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

function getCompactCurrencyFormatter(currency: string) {
  const cached = compactCurrencyFormatters.get(currency);
  if (cached) return cached;

  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });

  compactCurrencyFormatters.set(currency, formatter);
  return formatter;
}

function getCurrencyFormatter(currency: string, decimals: number) {
  const key = `${currency}-${decimals}`;
  const cached = currencyFormatters.get(key);
  if (cached) return cached;

  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });

  currencyFormatters.set(key, formatter);
  return formatter;
}

export function formatCompactCurrency(value: number, currency = 'USD') {
  return getCompactCurrencyFormatter(currency).format(value);
}

export function formatCurrency(value: number, decimals = 2, currency = 'USD') {
  return getCurrencyFormatter(currency, decimals).format(value);
}

export function formatNumber(value: number, decimals = 2) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(value);
}

export function formatPercent(value: number, decimals = 2) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function toneForNumber(value: number) {
  if (value > 0) return 'text-emerald-400';
  if (value < 0) return 'text-rose-400';
  return 'text-white/70';
}

export function softNumber(value: number) {
  return numberFormatter.format(value);
}
