export type Provider = "yahoo" | "capital";

export type ParsedSymbol = {
  provider: Provider;
  id: string;
};

/**
 * Parse a symbol with optional provider prefix.
 * Examples:
 *  - "AAPL"        -> { provider: "yahoo", id: "AAPL" }
 *  - "cap:OIL_CRUDE" -> { provider: "capital", id: "OIL_CRUDE" }
 */
export function parseProviderSymbol(input: string): ParsedSymbol {
  const trimmed = (input ?? "").trim();
  if (/^cap:/i.test(trimmed)) {
    return {
      provider: "capital",
      id: trimmed.slice(4).trim(),
    };
  }
  return {
    provider: "yahoo",
    id: trimmed,
  };
}
