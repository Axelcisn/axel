import { ensureCanonicalOrHistory } from "@/lib/storage/canonical";
import { GET as lambdaCalmarGet } from "@/app/api/volatility/ewma-lambda-calmar/[symbol]/route";
import { NextRequest } from "next/server";

const DEFAULT_SYMBOLS = ["ZBRA", "ODFL", "PAYX", "KR", "CMI"];

async function pickRangeStart(symbol: string, offset = 63): Promise<string> {
  const { rows } = await ensureCanonicalOrHistory(symbol, { interval: "1d", minRows: 260 });
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const idx = Math.max(0, sorted.length - 1 - offset);
  return sorted[idx]?.date ?? sorted[0].date;
}

async function callApi(symbol: string, rangeStart: string) {
  const url = new URL(`http://localhost/api/volatility/ewma-lambda-calmar/${symbol}`);
  url.searchParams.set("rangeStart", rangeStart);
  url.searchParams.set("h", "1");
  url.searchParams.set("coverage", "0.95");
  url.searchParams.set("equity", "1000");
  url.searchParams.set("leverage", "5");
  url.searchParams.set("posFrac", "0.25");
  url.searchParams.set("costBps", "0");
  url.searchParams.set("signalRule", "z");

  const req = new NextRequest(url);
  const res = await lambdaCalmarGet(req, { params: { symbol } });
  const json = await res.json();
  if (!json.success) {
    throw new Error(`API failure for ${symbol}: ${json.error}`);
  }
  return json;
}

async function main() {
  const symbolsArg = process.argv.find((a) => a.startsWith("--symbols="));
  const symbols = symbolsArg ? symbolsArg.replace("--symbols=", "").split(",") : DEFAULT_SYMBOLS;

  for (const sym of symbols) {
    const symbol = sym.toUpperCase();
    const rangeStart = await pickRangeStart(symbol);
    const first = await callApi(symbol, rangeStart);
    const second = await callApi(symbol, rangeStart);

    const msg = `${symbol} rs=${rangeStart} λ*=${first.lambdaStar.toFixed(2)} calmar=${first.calmarScore.toFixed(4)} cache1=${!!first.cacheHit} cache2=${!!second.cacheHit}`;
    console.log(msg);

    if (first.lambdaStar !== second.lambdaStar || first.calmarScore !== second.calmarScore) {
      throw new Error(`${symbol}: cache result mismatch`);
    }
    if (!second.cacheHit) {
      throw new Error(`${symbol}: expected cache hit on second call`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
