/**
 * Apply 20260807_chat_side_isolation.sql locally when DATABASE_URL is present.
 * Staging cfccwysniduwkjskiqgy and Production jqfaknpmcnqwqvatrwgo stay separate.
 * SQL runs only when the database project ref parses and matches SUPABASE_URL
 * when that URL is set. An unparseable ref refuses execution.
 *
 * Usage: node scripts/apply-chat-side-isolation.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";
import {
  STAGING_SUPABASE_REF,
  PRODUCTION_SUPABASE_REF,
  supabaseProjectRef,
  databaseProjectRef,
} from "./lib/prod-guard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KNOWN_PROJECT_REFS = new Set([STAGING_SUPABASE_REF, PRODUCTION_SUPABASE_REF]);
const SQL_REL = "supabase/migrations/20260807_chat_side_isolation.sql";

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^['"]|['']$/g, "");
      if (k && v && !process.env[k]) process.env[k] = v;
    }
  }
}

loadEnv();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || "";
const urlRef = supabaseProjectRef(supabaseUrl);
const dbRef = databaseProjectRef(dbUrl);

if (!dbUrl) {
  console.error("FAIL: DATABASE_URL missing — cannot apply SQL. Use admin /api/admin/chat-side-isolation for REST scrub, or paste SQL in the current project's Supabase SQL Editor.");
  process.exit(2);
}
if (!dbRef || !KNOWN_PROJECT_REFS.has(dbRef) || (urlRef && urlRef !== dbRef)) {
  console.error("FAIL: DATABASE_URL 与 SUPABASE_URL 不是同一个 Staging 或 Production 项目，或项目号无法确认");
  process.exit(2);
}

const sql = fs.readFileSync(path.join(ROOT, SQL_REL), "utf8");
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const before = await client.query(`
    select count(*)::int as n from public.conversations
    where boss_id is not null and companion_id is not null
      and coalesce(conversation_type, 'order_support') in ('order_support', 'general_support', '')
  `);
  console.log("before_leaked", before.rows[0].n, "project", urlRef || dbRef);

  await client.query("begin");
  await client.query(sql);
  await client.query("commit");

  const after = await client.query(`
    select count(*)::int as n from public.conversations
    where boss_id is not null and companion_id is not null
      and coalesce(conversation_type, 'order_support') in ('order_support', 'general_support', '')
  `);
  const policies = await client.query(`
    select cls.relname as table, pol.polname as name
    from pg_policy pol
    join pg_class cls on cls.oid = pol.polrelid
    join pg_namespace nsp on nsp.oid = cls.relnamespace
    where nsp.nspname='public' and cls.relname in ('conversations','messages')
      and pol.polname in ('conversations_role_read','messages_role_read')
    order by 1,2
  `);
  try {
    await client.query(`notify pgrst, 'reload schema'`);
  } catch {
    /* ignore */
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectRef: urlRef || dbRef,
        beforeLeaked: before.rows[0].n,
        afterLeaked: after.rows[0].n,
        policies: policies.rows,
      },
      null,
      2
    )
  );
} catch (e) {
  try {
    await client.query("rollback");
  } catch {
    /* ignore */
  }
  console.error("FAIL", e.message || e);
  process.exit(1);
} finally {
  await client.end();
}
