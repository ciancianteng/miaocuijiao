/**
 * Apply boss_companion_relations migration to Staging only.
 * Hard-refuses Production (jqfaknpmcnqwqvatrwgo) and any non-staging ref.
 *
 * Usage: DATABASE_URL=... node scripts/apply-boss-companion-relations.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAGING_REF = "cfccwysniduwkjskiqgy";
const PRODUCTION_REF = "jqfaknpmcnqwqvatrwgo";
const SQL_REL = "supabase/migrations/20260901_boss_companion_relations.sql";

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
      if (k && v && !process.env[k]) process.env[k] = v;
    }
  }
}

function refFromSupabaseUrl(url) {
  try {
    const host = new URL(url).hostname;
    const m = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return m ? m[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

function refFromDatabaseUrl(dbUrl) {
  try {
    const u = new URL(dbUrl);
    const direct = u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (direct) return direct[1].toLowerCase();
    const user = decodeURIComponent(u.username || "");
    const fromUser = user.match(/^postgres\.([a-z0-9]+)$/i);
    if (fromUser) return fromUser[1].toLowerCase();
    return "";
  } catch {
    return "";
  }
}

loadEnv();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || "";
const urlRef = refFromSupabaseUrl(supabaseUrl);
const dbRef = refFromDatabaseUrl(dbUrl);

if (!dbUrl) {
  console.error("FAIL: DATABASE_URL missing — cannot apply SQL.");
  console.error(`Paste ${SQL_REL} into Staging Supabase SQL Editor (${STAGING_REF}).`);
  process.exit(2);
}
if (urlRef === PRODUCTION_REF || dbRef === PRODUCTION_REF) {
  console.error("FAIL: refusing Production project", PRODUCTION_REF);
  process.exit(2);
}
if (urlRef && urlRef !== STAGING_REF) {
  console.error(`FAIL: SUPABASE_URL project ${urlRef} != Staging ${STAGING_REF}`);
  process.exit(2);
}
if (dbRef && dbRef !== STAGING_REF) {
  console.error(`FAIL: DATABASE_URL project ${dbRef} != Staging ${STAGING_REF}`);
  process.exit(2);
}
if (!urlRef && !dbRef) {
  console.error("FAIL: cannot confirm project ref");
  process.exit(2);
}

const sql = fs.readFileSync(path.join(ROOT, SQL_REL), "utf8");
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  try {
    await client.query("notify pgrst, 'reload schema'");
  } catch {
    /* optional */
  }
  const check = await client.query(`
    select to_regclass('public.boss_companion_relations') as relations,
           to_regclass('public.boss_companion_relation_events') as events
  `);
  console.log("OK: migration applied on Staging", STAGING_REF);
  console.log(JSON.stringify(check.rows[0], null, 2));
} finally {
  await client.end();
}
