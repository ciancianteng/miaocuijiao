/**
 * Apply supabase/platform-config-center.sql (platform_secret_vault + logs).
 * Usage: node scripts/apply-platform-config-center.mjs
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

if (!url || !key) fail("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

async function probeVault() {
  const res = await fetch(`${url}/rest/v1/platform_secret_vault?select=secret_key&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (res.ok) return { ok: true, missing: false };
  if (/platform_secret_vault|Could not find|schema cache|does not exist|PGRST205/i.test(text)) {
    return { ok: true, missing: true, text: text.slice(0, 200) };
  }
  return { ok: false, missing: null, status: res.status, text: text.slice(0, 200) };
}

async function applyViaPostgres() {
  const sqlPath = resolve(root, "supabase/platform-config-center.sql");
  if (!existsSync(sqlPath)) fail("supabase/platform-config-center.sql not found");
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

const probe = await probeVault();
if (!probe.ok) fail(`Probe failed (HTTP ${probe.status}): ${probe.text || ""}`);

if (!probe.missing) {
  console.log("PASS: platform_secret_vault already exists — skip SQL.");
  process.exit(0);
}

console.log("platform_secret_vault missing — applying platform SQL…");
const settingsSql = resolve(root, "supabase/platform-settings.sql");
const centerSql = resolve(root, "supabase/platform-config-center.sql");
if (!existsSync(settingsSql)) fail("supabase/platform-settings.sql not found");
if (!existsSync(centerSql)) fail("supabase/platform-config-center.sql not found");

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
  console.log("→ platform-settings.sql");
  await client.query(readFileSync(settingsSql, "utf8"));
  console.log("→ platform-config-center.sql");
  await client.query(readFileSync(centerSql, "utf8"));
} finally {
  await client.end();
}

// brief wait for schema cache
await new Promise((r) => setTimeout(r, 2000));
const again = await probeVault();
if (!again.ok || again.missing) fail("Migration ran but platform_secret_vault still missing (schema cache?).");
console.log("PASS: platform_settings + platform_secret_vault ready.");
