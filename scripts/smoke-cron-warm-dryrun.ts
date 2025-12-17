import { NextRequest } from "next/server";
import { GET as warmLambdaCalmar } from "@/app/api/cron/warm-lambda-calmar/route";

async function main() {
  const url = new URL("http://localhost/api/cron/warm-lambda-calmar");
  url.searchParams.set("batch", "0");
  url.searchParams.set("batchSize", "2");
  url.searchParams.set("dryRun", "true");
  url.searchParams.set("symbols", "AAPL,MSFT");
  url.searchParams.set("shrinkFactor", "0.5");
  url.searchParams.set("offsets", "63");

  const res = await warmLambdaCalmar(new NextRequest(url));
  const json = await res.json();

  if (!json.success) {
    throw new Error(json.error || "Cron warm dry-run failed");
  }

  const results = Array.isArray(json.results) ? json.results : [];
  console.log(`dryRun warmed=${json.warmed} symbols=${(json.symbols || []).join(",")}`);
  results.forEach((r: any) => {
    console.log(`${r.symbol} ${r.rangeStart} -> ${r.cacheKey}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
