import fs from "fs";
import path from "path";
import dotenv from "dotenv";

const ROOT = process.cwd();

const files = [".env.local", ".env"];

for (const file of files) {
  const full = path.join(ROOT, file);
  if (fs.existsSync(full)) {
    dotenv.config({ path: full });
  }
}
