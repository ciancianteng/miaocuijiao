/**
 * Apply supabase/migrations/20260731_payment_settings.sql if needed.
 * Loads SUPABASE_* from .env.local. Never prints secrets.
 *
 * Usage: node scripts/apply-payment-settings.mjs
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

loadEnvFile(".env.vercel.tmp");
loadEnvFile(".env.local");
loadEnvFile(".env");

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const dbUrl =
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.POSTGRES_URL ||
  process.env.DIRECT_URL ||
  "";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

if (!url || !key) fail("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set in .env.local).");

async function probeChannels() {
  const res = await fetch(`${url}/rest/v1/payment_channels?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (res.ok) return { ok: true, missing: false };
  if (/payment_channels|Could not find|schema cache|does not exist/i.test(text)) {
    return { ok: true, missing: true };
  }
  return { ok: false, missing: null, status: res.status, text: text.slice(0, 200) };
}

async function applyViaPostgres() {
  const sqlPath = resolve(root, "supabase/migrations/20260731_payment_settings.sql");
  if (!existsSync(sqlPath)) fail("migration SQL not found");
  const sql = readFileSync(sqlPath, "utf8");
  let pg;
  try {
    pg = await import("pg");
  } catch {
    fail("Package 'pg' not installed. Run: npm i -D pg");
  }
  if (!dbUrl) fail("Missing DATABASE_URL / SUPABASE_DB_URL / POSTGRES_URL for DDL apply.");
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

const probe = await probeChannels();
if (!probe.ok) fail(`Probe failed (HTTP ${probe.status}): ${probe.text || ""}`);

if (!probe.missing) {
  console.log("PASS: payment_channels already exists — skip SQL.");
  process.exit(0);
}

console.log("payment_channels missing — applying migration via Postgres…");
await applyViaPostgres();

const again = await probeChannels();
if (!again.ok || again.missing) fail("Migration ran but payment_channels still missing (schema cache?).");
console.log("PASS: payment settings tables ready.");
