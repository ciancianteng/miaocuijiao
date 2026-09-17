#!/usr/bin/env node
/**
 * Apply companion_tags SQL to Production ONLY (jqfaknpmcnqwqvatrwgo).
 *
 * Human emergency gates (both required):
 *   ALLOW_PROD_SUPABASE_WRITE=1
 *   CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK
 *
 * Usage:
 *   ALLOW_PROD_SUPABASE_WRITE=1 CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK \
 *     PRODUCTION_DATABASE_URL='postgresql://postgres.jqfaknpmcnqwqvatrwgo:***@…' \
 *     node scripts/apply-companion-tags-production.mjs
 *
 * SQL is idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING). No DROP/TRUNCATE.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadEnvFiles,
  PRODUCTION_SUPABASE_REF,
  supabaseProjectRef,
} from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles(root);
// Worktrees may not carry local .env*; also load sibling checkout / cwd.
loadEnvFiles(process.cwd());
const sibling = path.resolve(root, "..", "meow-cuijiao-homepage");
if (sibling !== root) loadEnvFiles(sibling);

const SQL_CANDIDATES = [
  "supabase/migrations/20260915_companion_tags.sql",
  "supabase/companion-tags.sql",
  "server/api/_sql/companion-tags.sql",
];

function projectRefFromDatabaseUrl(dbUrl) {
  try {
    const u = new URL(String(dbUrl || ""));
    const host = (u.hostname || "").toLowerCase();
    const direct = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (direct) return direct[1].toLowerCase();
    const user = decodeURIComponent(u.username || "");
    const fromUser = user.match(/^postgres\.([a-z0-9]+)$/i);
    if (fromUser) return fromUser[1].toLowerCase();
    if (host.includes(PRODUCTION_SUPABASE_REF)) return PRODUCTION_SUPABASE_REF;
    return "";
  } catch {
    return "";
  }
}

function readSql() {
  for (const rel of SQL_CANDIDATES) {
    const full = path.join(root, rel);
    if (fs.existsSync(full)) {
      return { path: full, sql: fs.readFileSync(full, "utf8") };
    }
  }
  throw new Error(`SQL not found: ${SQL_CANDIDATES.join(" | ")}`);
}

async function main() {
  if (process.env.ALLOW_PROD_SUPABASE_WRITE !== "1") {
    throw new Error("Refusing: set ALLOW_PROD_SUPABASE_WRITE=1");
  }
  if (process.env.CONFIRM_PROD_WRITE !== "I_UNDERSTAND_PROD_RISK") {
    throw new Error('Refusing: set CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK');
  }

  const dbUrl = String(
    process.env.PRODUCTION_DATABASE_URL || process.env.DATABASE_URL || ""
  ).trim();
  if (!dbUrl) throw new Error("Missing PRODUCTION_DATABASE_URL / DATABASE_URL");

  const ref = projectRefFromDatabaseUrl(dbUrl);
  if (ref !== PRODUCTION_SUPABASE_REF) {
    throw new Error(
      `Refusing: DATABASE_URL ref=${ref || "(unknown)"} is not Production ${PRODUCTION_SUPABASE_REF}`
    );
  }

  // Belt-and-suspenders: also refuse if SUPABASE_URL is somehow Staging.
  const sbRef = supabaseProjectRef(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "");
  if (sbRef && sbRef !== PRODUCTION_SUPABASE_REF) {
    throw new Error(`Refusing: SUPABASE_URL ref=${sbRef} is not Production`);
  }

  const { path: sqlPath, sql } = readSql();
  if (/drop\s+table|truncate\s+/i.test(sql)) {
    throw new Error("Refusing destructive SQL (DROP/TRUNCATE detected)");
  }

  console.log(`[apply-prod] sql=${sqlPath}`);
  console.log(`[apply-prod] targetRef=${PRODUCTION_SUPABASE_REF}`);

  const { createRequire } = await import("node:module");
  let pg;
  try {
    pg = await import("pg");
  } catch {
    const require = createRequire(path.join(sibling, "package.json"));
    pg = { default: require("pg") };
  }
  const client = new pg.default.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 25000,
  });
  await client.connect();
  try {
    const ident = await client.query(`
      select current_database() as db,
             current_user as usr,
             inet_server_addr()::text as addr
    `);
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    try {
      await client.query(`notify pgrst, 'reload schema'`);
    } catch {
      /* optional */
    }
    const count = await client.query(`select count(*)::int as n from public.companion_tags`);
    const sample = await client.query(
      `select id, name, tag_group, sort_order, is_enabled from public.companion_tags order by sort_order asc, name asc limit 20`
    );
    console.log(
      JSON.stringify(
        {
          ok: true,
          via: "postgres",
          identity: ident.rows[0] || null,
          rowCount: count.rows[0]?.n ?? null,
          sample: sample.rows,
        },
        null,
        2
      )
    );
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[apply-prod] failed:", err.message || err);
  process.exit(1);
});
