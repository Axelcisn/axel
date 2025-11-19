import fs from "fs/promises";
import { specFileFor, TARGET_SPEC_DIR } from "../paths";

export type TargetSpec = {
  symbol: string;
  exchange?: string | null;
  exchange_tz: string;        // IANA TZ
  h: number;
  coverage: number;           // 0..1
  variable: string;
  cutoff_note: string;
  updated_at: string;
};

export type TargetSpecResult = {
  spec: TargetSpec | null;
  meta: { hasTZ: boolean; source: string };
};

export async function getTargetSpec(symbol: string): Promise<TargetSpecResult | null> {
  try {
    await fs.mkdir(TARGET_SPEC_DIR, { recursive: true });
    const file = specFileFor(symbol);
    const raw = await fs.readFile(file, "utf-8");
    const spec: TargetSpec = JSON.parse(raw);
    return { spec, meta: { hasTZ: !!spec.exchange_tz, source: "file" } };
  } catch {
    return null;
  }
}

export async function saveTargetSpec(symbol: string, partialSpec: { h: number; coverage: number; exchange_tz: string }): Promise<void> {
  await fs.mkdir(TARGET_SPEC_DIR, { recursive: true });
  const file = specFileFor(symbol);
  
  const fullSpec: TargetSpec = {
    symbol: symbol.toUpperCase(),
    exchange: null,
    exchange_tz: partialSpec.exchange_tz,
    h: partialSpec.h,
    coverage: partialSpec.coverage,
    variable: "NEXT_CLOSE_ADJ",
    cutoff_note: "compute at t close; verify at t+1 close",
    updated_at: new Date().toISOString()
  };
  
  await fs.writeFile(file, JSON.stringify(fullSpec, null, 2), "utf-8");
}