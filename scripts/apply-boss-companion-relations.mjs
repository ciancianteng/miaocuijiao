/**
 * Apply boss_companion_relations migration to Staging only.
 * Hard-refuses Production (jqfaknpmcnqwqvatrwgo) and any non-staging ref.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/apply-boss-companion-relations.mjs
 *   SUPABASE_ACCESS_TOKEN=... node scripts/apply-boss-companion-relations.mjs
 *     (Management API database/query — Staging ref only)
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAGING_REF = "cfccwysniduwkjskiqgy";
const PRODUCTION_REF = "jqfaknpmcnqwqvatrwgo";
const SQL_REL = "supabase/migrations/20260901_boss_companion_relations.sql";
const MGMT_QUERY = `https://api.supabase.com/v1/projects/${STAGING_REF}/database/query`;

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

function redactDbUrl(dbUrl) {
  try {
    const x = new URL(dbUrl);
    return `${x.protocol}//${x.username}:***@${x.hostname}:${x.port}${x.pathname}`;
  } catch {
    return "(unparseable)";
  }
}

async function verifyViaRest() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || `https://${STAGING_REF}.supabase.co`;
  const anon =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    "";
  if (!anon) return { checked: false };
  const url = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/boss_companion_relations?select=id&limit=1`;
  const res = await fetch(url, {
    headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  });
  const body = await res.text();
  return { checked: true, status: res.status, body: body.slice(0, 240) };
}

async function applyViaPg(dbUrl, sql) {
  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
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
    return check.rows[0];
  } finally {
    await client.end();
  }
}

async function applyViaManagementApi(token, sql) {
  const res = await fetch(MGMT_QUERY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = json?.message || json?.error || text.slice(0, 400);
    throw new Error(`Management API ${res.status}: ${msg}`);
  }
  // Verify tables via a follow-up query
  const verifyRes = await fetch(MGMT_QUERY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      query: `
        select to_regclass('public.boss_companion_relations')::text as relations,
               to_regclass('public.boss_companion_relation_events')::text as events
      `,
    }),
  });
  const verifyText = await verifyRes.text();
  let verifyJson = null;
  try {
    verifyJson = JSON.parse(verifyText);
  } catch {
    verifyJson = verifyText;
  }
  return { apply: json, verify: verifyJson };
}

loadEnv();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || process.env.DIRECT_URL || "";
const accessToken =
  process.env.SUPABASE_ACCESS_TOKEN ||
  process.env.SUPABASE_MANAGEMENT_TOKEN ||
  process.env.SUPABASE_PAT ||
  "";
const urlRef = refFromSupabaseUrl(supabaseUrl);
const dbRef = refFromDatabaseUrl(dbUrl);

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

const sql = fs.readFileSync(path.join(ROOT, SQL_REL), "utf8");

if (dbUrl) {
  if (!urlRef && !dbRef) {
    console.error("FAIL: cannot confirm project ref from SUPABASE_URL / DATABASE_URL");
    process.exit(2);
  }
  console.log("Applying via Postgres", redactDbUrl(dbUrl));
  const check = await applyViaPg(dbUrl, sql);
  console.log("OK: migration applied on Staging", STAGING_REF);
  console.log(JSON.stringify(check, null, 2));
} else if (accessToken) {
  console.log("No DATABASE_URL — applying via Supabase Management API for", STAGING_REF);
  const result = await applyViaManagementApi(accessToken, sql);
  console.log("OK: migration applied via Management API on Staging", STAGING_REF);
  console.log(JSON.stringify(result.verify ?? result, null, 2));
} else {
  console.error("FAIL: DATABASE_URL and SUPABASE_ACCESS_TOKEN both missing — cannot apply SQL.");
  console.error(`Paste ${SQL_REL} into Staging Supabase SQL Editor (${STAGING_REF}).`);
  process.exit(2);
}

try {
  const rest = await verifyViaRest();
  if (rest.checked) {
    console.log("REST probe:", rest.status, rest.body);
  }
} catch (err) {
  console.log("REST probe skipped:", String(err?.message || err).slice(0, 120));
}
