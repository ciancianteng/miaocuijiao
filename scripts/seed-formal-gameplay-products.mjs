/**
 * Legacy: previously seeded [MCJ_GP] into announcements.
 * Now delegates to gameplay_products table seed (single source of truth).
 * node scripts/seed-formal-gameplay-products.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawnSync(process.execPath, [path.join(root, "scripts/seed-gameplay-products-table.mjs")], {
  stdio: "inherit",
  cwd: root,
  env: process.env,
});
process.exit(child.status ?? 1);
