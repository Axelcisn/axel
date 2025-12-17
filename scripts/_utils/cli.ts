export function parseSymbolsFromArgv(argv: string[], defaults: string[]): string[] {
  // Look for --symbols=... or --symbols ...
  let symbolsArg: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--symbols=")) {
      symbolsArg = arg.split("=")[1] || "";
      break;
    }
    if (arg === "--symbols") {
      symbolsArg = argv[i + 1] ?? "";
      break;
    }
  }

  const positional = argv.filter((a) => !a.startsWith("--"));

  const raw = symbolsArg ?? (positional.length > 0 ? positional.join(",") : "");
  const tokens = raw
    .split(/[, \t\r\n]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (tokens.length === 0) return defaults;
  return tokens;
}

export function parseSymbolsFromArgs(
  argv: string[],
  opts: { defaultSymbols: string[] }
): { symbols: string[] } {
  return { symbols: parseSymbolsFromArgv(argv, opts.defaultSymbols) };
}
