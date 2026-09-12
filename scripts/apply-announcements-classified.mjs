/**
 * Apply supabase/announcements-classified.sql if needed.
 * Usage: node scripts/apply-announcements-classified.mjs
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

if (!url || !key) fail("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");

async function probe() {
  const res = await fetch(`${url}/rest/v1/announcements?select=id,category,audience,start_at,end_at,is_scrolling,sort_order&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (res.ok) return { ok: true, missing: false };
  if (/category|audience|start_at|is_scrolling|sort_order|Could not find|schema cache/i.test(text)) {
    return { ok: true, missing: true, detail: text.slice(0, 200) };
  }
  return { ok: false, status: res.status, detail: text.slice(0, 200) };
}

async function applyViaPostgres() {
  const sqlPath = resolve(root, "supabase/announcements-classified.sql");
  if (!existsSync(sqlPath)) fail("supabase/announcements-classified.sql not found");
  const sql = readFileSync(sqlPath, "utf8");
  let pg;
  try {
    pg = await import("pg");
  } catch {
    fail("Package 'pg' not installed. Run: npm i -D pg");
  }
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

const result = await probe();
if (!result.ok) fail(`Probe failed (HTTP ${result.status}): ${result.detail || ""}`);
if (!result.missing) {
  console.log("PASS: announcements classified columns already exist — skip SQL.");
  process.exit(0);
}

if (!dbUrl) {
  fail(
    "Columns missing, but no DATABASE_URL / SUPABASE_DB_URL / POSTGRES_URL. Paste supabase/announcements-classified.sql into Supabase SQL Editor, then re-run."
  );
}

console.log("Applying supabase/announcements-classified.sql …");
await applyViaPostgres();
const again = await probe();
if (!again.ok || again.missing) fail("SQL applied but columns still missing (schema cache?). Wait a few seconds and retry probe.");
console.log("PASS: announcements classified columns ready.");
