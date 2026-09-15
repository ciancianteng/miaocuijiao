/**
 * Read-only Boss VIP historical spend preview.
 * Never writes. Never uses Production smoke / real-account mutation.
 *
 *   node scripts/boss-vip-backfill-preview.mjs
 *
 * Uses current process env (.env.local). Do not --apply from this script.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { previewBossVipBackfill } from "../server/api/_boss-vip.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env.local");
if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}

const outDir = path.join(root, "artifacts", "boss-vip");
fs.mkdirSync(outDir, { recursive: true });

const preview = await previewBossVipBackfill();
const outFile = path.join(outDir, "backfill-preview.json");
fs.writeFileSync(outFile, JSON.stringify(preview, null, 2));
console.log(
  JSON.stringify(
    {
      ok: preview.ok !== false,
      tablesReady: preview.tablesReady !== false,
      message: preview.message || "",
      count: preview.count || 0,
      totalConfirmedSpend: preview.totalConfirmedSpend || 0,
      outFile,
    },
    null,
    2
  )
);
if (preview.ok === false) process.exit(1);
