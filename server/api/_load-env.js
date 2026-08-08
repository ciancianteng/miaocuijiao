/**
 * Load project-root .env.local into process.env (fill missing keys only).
 * Safe for Vercel: missing file is a no-op; cloud uses process.env.
 */
import fs from "node:fs";
import path from "node:path";

let loaded = false;

export function loadLocalEnv() {
  if (loaded) return;
  loaded = true;
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}

loadLocalEnv();
