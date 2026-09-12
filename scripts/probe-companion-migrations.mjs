/**
 * Probe companion migration objects. Never prints secrets.
 * Usage: node scripts/probe-companion-migrations.mjs
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnvFile(name) {
  const path = resolve(root, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!url || !key) {
  console.error("FAIL: missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };

async function checkTable(t) {
  const r = await fetch(`${url}/rest/v1/${t}?select=id&limit=1`, { headers });
  const text = await r.text();
  const missing = /Could not find the table|schema cache|does not exist/i.test(text);
  console.log(`table ${t}: ${r.ok ? "OK" : missing ? "MISSING" : `ERR ${r.status}`}`);
}
async function checkCol(c) {
  const r = await fetch(`${url}/rest/v1/companion_profiles?select=${c}&limit=1`, { headers });
  const text = await r.text();
  const missing = /Could not find the|schema cache/i.test(text);
  console.log(`col companion_profiles.${c}: ${r.ok ? "OK" : missing ? "MISSING" : `ERR ${r.status}`}`);
}

for (const t of [
  "companion_media",
  "companion_identity_verifications",
  "companion_payment_accounts",
  "companion_deposits",
]) {
  await checkTable(t);
}
for (const c of ["age", "media_reject_reason", "tags", "contact_phone", "game_id"]) {
  await checkCol(c);
}

const hasDb = !!(
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.POSTGRES_URL ||
  process.env.DIRECT_URL
);
console.log(`has_database_url: ${hasDb}`);
