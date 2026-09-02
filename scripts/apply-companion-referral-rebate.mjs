/**
 * Apply Companion referral rebate migration to Staging only.
 * Hard-refuses Production.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/apply-companion-referral-rebate.mjs
 *   STAGING_DB_PASSWORD=... node scripts/apply-companion-referral-rebate.mjs
 *   SUPABASE_ACCESS_TOKEN=... node scripts/apply-companion-referral-rebate.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAGING_REF = "cfccwysniduwkjskiqgy";
const PRODUCTION_REF = "jqfaknpmcnqwqvatrwgo";
const SQL_REL = "supabase/migrations/20260904_companion_referral_rebate.sql";
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

function buildPoolerUri(password, region = "ap-southeast-1") {
  const u = new URL(`postgresql://x@aws-0-${region}.pooler.supabase.com:5432/postgres`);
  u.username = "postgres." + STAGING_REF;
  u.password = password;
  return u.toString();
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
      select to_regclass('public.referral_relations')::text as relations,
             to_regclass('public.referral_commission_rules')::text as rules,
             to_regclass('public.referral_commission_records')::text as records,
             to_regclass('public.referral_wallets')::text as wallets,
             (
               select count(*)::int from information_schema.columns
               where table_schema = 'public' and table_name = 'companion_withdrawals'
                 and column_name in (
                   'service_income_withdrawn_amount',
                   'referral_rebate_withdrawn_amount'
                 )
             ) as withdrawal_stream_cols
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
  const verifyRes = await fetch(MGMT_QUERY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      query: `
        select to_regclass('public.referral_relations')::text as relations,
               to_regclass('public.referral_commission_rules')::text as rules,
               to_regclass('public.referral_commission_records')::text as records,
               to_regclass('public.referral_wallets')::text as wallets
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

async function verifyViaRest() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || `https://${STAGING_REF}.supabase.co`;
  const anon =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    "";
  if (!anon) return { checked: false };
  const probes = {};
  for (const table of ["referral_relations", "referral_commission_rules", "referral_commission_records", "referral_wallets"]) {
    const col = table === "referral_wallets" ? "user_id" : "id";
    const url = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${table}?select=${col}&limit=1`;
    const res = await fetch(url, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    const body = await res.text();
    probes[table] = { status: res.status, body: body.slice(0, 120) };
  }
  return { checked: true, probes };
}

async function main() {
  loadEnv();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const oneshotPassword =
    process.env.STAGING_DB_PASSWORD ||
    process.env.SUPABASE_DB_PASSWORD ||
    process.env.DATABASE_PASSWORD ||
    process.env.DB_PASSWORD ||
    "";
  let dbUrl = process.env.DATABASE_URL || process.env.STAGING_DATABASE_URL || process.env.SUPABASE_DB_URL || "";
  if (!dbUrl && oneshotPassword) {
    dbUrl = buildPoolerUri(oneshotPassword);
    console.log("Constructed Staging pooler URI from STAGING_DB_PASSWORD");
  }
  const accessToken =
    process.env.SUPABASE_ACCESS_TOKEN ||
    process.env.SUPABASE_MANAGEMENT_TOKEN ||
    process.env.SUPABASE_PAT ||
    "";
  const urlRef = refFromSupabaseUrl(supabaseUrl);
  const dbRef = refFromDatabaseUrl(dbUrl);

  if (urlRef === PRODUCTION_REF || dbRef === PRODUCTION_REF || /jqfaknpmcnqwqvatrwgo/i.test(dbUrl)) {
    console.error("FAIL: Production refused");
    process.exit(2);
  }
  if (urlRef && urlRef !== STAGING_REF) {
    console.error("FAIL: SUPABASE_URL ref", urlRef, "!= Staging", STAGING_REF);
    process.exit(2);
  }
  if (dbRef && dbRef !== STAGING_REF) {
    console.error("FAIL: DATABASE_URL ref", dbRef, "!= Staging", STAGING_REF);
    process.exit(2);
  }

  const sqlPath = path.join(ROOT, SQL_REL);
  if (!fs.existsSync(sqlPath)) {
    console.error("FAIL: missing", SQL_REL);
    process.exit(2);
  }
  const sql = fs.readFileSync(sqlPath, "utf8");
  console.log("Applying", SQL_REL, "to Staging", STAGING_REF);

  if (dbUrl) {
    if (!urlRef && !dbRef) {
      console.error("FAIL: cannot confirm project ref");
      process.exit(2);
    }
    const candidates = [dbUrl];
    if (oneshotPassword) {
      for (const region of ["ap-southeast-1", "ap-northeast-1", "us-east-1", "eu-west-1"]) {
        const next = buildPoolerUri(oneshotPassword, region);
        if (!candidates.includes(next)) candidates.push(next);
      }
    }
    let check = null;
    let lastErr = null;
    for (const candidate of candidates) {
      try {
        console.log("Applying via Postgres", redactDbUrl(candidate));
        check = await applyViaPg(candidate, sql);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.error("Postgres attempt failed:", String(err?.message || err).slice(0, 200));
      }
    }
    if (!check) {
      console.error("FAIL:", String(lastErr?.message || lastErr).slice(0, 400));
      process.exit(1);
    }
    console.log(JSON.stringify({ ok: true, via: "postgres", verify: check }, null, 2));
  } else if (accessToken) {
    console.log("Applying via Management API");
    const result = await applyViaManagementApi(accessToken, sql);
    console.log(JSON.stringify({ ok: true, via: "management_api", verify: result.verify }, null, 2));
  } else {
    console.error("FAIL: set DATABASE_URL / STAGING_DB_PASSWORD / SUPABASE_ACCESS_TOKEN");
    process.exit(2);
  }

  try {
    const rest = await verifyViaRest();
    if (rest.checked) console.log("REST probe:", JSON.stringify(rest.probes));
  } catch (err) {
    console.log("REST probe skipped:", String(err?.message || err).slice(0, 120));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
