import path from "path";

export const DATA_ROOT = process.env.DATA_ROOT || path.join(process.cwd(), "data");

// Canonical, singular location for Target Spec files
export const TARGET_SPEC_DIR = path.join(DATA_ROOT, "specs");  // <- use existing specs folder

export function specFileFor(symbol: string) {
  const s = (symbol || "").trim().toUpperCase();
  return path.join(TARGET_SPEC_DIR, `${s}-target.json`);
}