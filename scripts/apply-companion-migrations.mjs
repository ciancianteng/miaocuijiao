/**
 * Apply companion migrations; prefers IPv4 pooler when direct db.* is IPv6-only.
 * Never prints secrets / connection strings.
 *
 * Usage: node scripts/apply-companion-migrations.mjs
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import dns from "node:dns/promises";

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
const dbUrlRaw =
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
if (!dbUrlRaw) fail("Missing DATABASE_URL / SUPABASE_DB_URL / POSTGRES_URL / DIRECT_URL");

const files = [
  "supabase/migrations/20260731_companion_media.sql",
  "supabase/companion-admin-data.sql",
];

function parseDbUrl(raw) {
  const u = new URL(raw);
  return {
    protocol: u.protocol,
    username: decodeURIComponent(u.username || "postgres"),
    password: decodeURIComponent(u.password || ""),
    hostname: u.hostname,
    port: u.port || "5432",
    database: (u.pathname || "/postgres").replace(/^\//, "") || "postgres",
  };
}

function projectRefFromEnv() {
  try {
    return new URL(url).hostname.split(".")[0] || "";
  } catch {
    return "";
  }
}

async function candidateConfigs(parsed) {
  const ref = projectRefFromEnv();
  const out = [];
  // 1) as-configured
  out.push({
    label: "configured",
    config: {
      connectionString: dbUrlRaw,
      ssl: { rejectUnauthorized: false },
    },
  });
  // 2) direct host via resolved IPv6 literal (when AAAA-only)
  try {
    const records = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
    const v6 = records.find((r) => r.family === 6);
    const v4 = records.find((r) => r.family === 4);
    console.log(`DNS ${parsed.hostname}: v4=${v4 ? "yes" : "no"} v6=${v6 ? "yes" : "no"}`);
    if (v6 && !v4) {
      out.push({
        label: "direct-ipv6-literal",
        config: {
          host: v6.address,
          port: Number(parsed.port),
          user: parsed.username,
          password: parsed.password,
          database: parsed.database,
          ssl: { rejectUnauthorized: false, servername: parsed.hostname },
        },
      });
    }
  } catch (e) {
    console.log(`DNS lookup failed for ${parsed.hostname}: ${e.code || e.message}`);
  }
  // 3) Supabase pooler IPv4 endpoints (session mode, port 5432)
  if (ref) {
    const regions = ["ap-southeast-1", "ap-northeast-1", "us-east-1"];
    for (const region of regions) {
      for (const aws of ["aws-1", "aws-0"]) {
        const host = `${aws}-${region}.pooler.supabase.com`;
        out.push({
          label: `pooler:${host}`,
          config: {
            host,
            port: 5432,
            user: `postgres.${ref}`,
            password: parsed.password,
            database: parsed.database,
            ssl: { rejectUnauthorized: false },
          },
        });
      }
    }
  }
  return out;
}

async function probe(table, select = "id") {
  const res = await fetch(`${url}/rest/v1/${table}?select=${select}&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (res.ok) return { ok: true, missing: false };
  if (/Could not find the table|schema cache|does not exist/i.test(text)) {
    return { ok: true, missing: true };
  }
  return { ok: false, missing: null, status: res.status, text: text.slice(0, 240) };
}

async function probeColumn(column) {
  const res = await fetch(`${url}/rest/v1/companion_profiles?select=${column}&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (res.ok) return { ok: true, missing: false };
  if (/Could not find the|schema cache/i.test(text)) return { ok: true, missing: true };
  return { ok: false, status: res.status, text: text.slice(0, 240) };
}

let pg;
try {
  pg = await import("pg");
} catch {
  fail("Package 'pg' not installed. Run: npm i -D pg");
}

const parsed = parseDbUrl(dbUrlRaw);
const candidates = await candidateConfigs(parsed);

async function tryConnect(label, config) {
  const c = new pg.default.Client({
    ...config,
    connectionTimeoutMillis: 8000,
  });
  try {
    await c.connect();
    return c;
  } catch (e) {
    try {
      await c.end();
    } catch {
      /* ignore */
    }
    const code = e.code || "";
    console.log(`SKIP ${label}: ${code || e.message.split("\n")[0]}`);
    return null;
  }
}

let client = null;
let usedLabel = "";
for (const item of candidates) {
  const c = await tryConnect(item.label, item.config);
  if (c) {
    client = c;
    usedLabel = item.label;
    console.log(`CONNECTED via ${usedLabel}`);
    break;
  }
}

if (!client) fail("Could not connect to Postgres (direct IPv6 / pooler all failed)");

try {
  for (const rel of files) {
    const sqlPath = resolve(root, rel);
    if (!existsSync(sqlPath)) fail(`SQL not found: ${rel}`);
    const sql = readFileSync(sqlPath, "utf8");
    console.log(`APPLY: ${rel}`);
    try {
      await client.query(sql);
      console.log(`OK: ${rel}`);
    } catch (error) {
      console.error(`FAIL applying ${rel}:`, error.message || error);
      throw error;
    }
  }

  const expected = [
    "companion_media",
    "companion_identity_verifications",
    "companion_payment_accounts",
    "companion_deposits",
  ];
  const listed = await client.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_name = any($1::text[])
     order by 1`,
    [expected]
  );
  console.log(`DB_TABLES=${listed.rows.map((r) => r.table_name).join(",") || "(none)"}`);
  const missingInDb = expected.filter((t) => !listed.rows.some((r) => r.table_name === t));
  if (missingInDb.length) {
    fail(`Tables missing in Postgres after SQL: ${missingInDb.join(",")}`);
  }
  try {
    await client.query(`notify pgrst, 'reload schema'`);
    console.log("SCHEMA_RELOAD=notified");
  } catch (e) {
    console.log(`SCHEMA_RELOAD=skip (${e.message || e})`);
  }
} finally {
  await client.end();
}

// Give PostgREST a moment to pick up new relations.
await new Promise((r) => setTimeout(r, 2500));

const checks = [
  ["companion_media", "id"],
  ["companion_identity_verifications", "id"],
  ["companion_payment_accounts", "id"],
  ["companion_deposits", "id"],
];

let failed = 0;
for (const [table, select] of checks) {
  const p = await probe(table, select);
  if (!p.ok) {
    console.error(`VERIFY FAIL ${table}: HTTP ${p.status}`);
    failed += 1;
  } else if (p.missing) {
    console.error(`VERIFY FAIL ${table}: still missing after migration`);
    failed += 1;
  } else {
    console.log(`VERIFY OK: ${table}`);
  }
}

for (const col of ["age", "media_reject_reason", "tags", "contact_phone"]) {
  const p = await probeColumn(col);
  if (!p.ok || p.missing) {
    console.error(`VERIFY FAIL companion_profiles.${col}`);
    failed += 1;
  } else {
    console.log(`VERIFY OK: companion_profiles.${col}`);
  }
}

if (failed) fail(`${failed} verification check(s) failed`);
console.log("PASS: companion migrations applied and verified.");
