#!/usr/bin/env node
/**
 * Production DDL apply for companion_voice_types.
 * Bypasses staging-only helper (intentionally). Requires:
 *   ALLOW_PROD_SUPABASE_WRITE=1
 *   CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROD_REF = "jqfaknpmcnqwqvatrwgo";
const SQL_REL = "supabase/pending-prod/17_companion_voice_types.sql";

function parseEnv(p) {
  const o = {};
  if (!fs.existsSync(p)) return o;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[m[1]] = v;
  }
  return o;
}

function projectRefFromDatabaseUrl(url) {
  try {
    const u = new URL(String(url || "").replace(/^postgresql:/i, "postgres:"));
    const host = u.hostname || "";
    const m = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i) || host.match(/^([a-z0-9]+)\.pooler\.supabase\.com$/i);
    if (m) return m[1];
    // pooler user form: postgres.REF
    const user = decodeURIComponent(u.username || "");
    const um = user.match(/^postgres\.([a-z0-9]+)$/i);
    return um ? um[1] : "";
  } catch {
    return "";
  }
}

async function main() {
  if (
    process.env.ALLOW_PROD_SUPABASE_WRITE !== "1" ||
    process.env.CONFIRM_PROD_WRITE !== "I_UNDERSTAND_PROD_RISK"
  ) {
    throw new Error("Refusing prod write without ALLOW_PROD_SUPABASE_WRITE + CONFIRM_PROD_WRITE");
  }
  const env = {
    ...parseEnv(path.join(root, "../meow-cuijiao-homepage/.env.local")),
    ...parseEnv(path.join(root, ".env.local")),
  };
  const dbUrl = String(process.env.PRODUCTION_DATABASE_URL || env.DATABASE_URL || "").trim();
  const ref = projectRefFromDatabaseUrl(dbUrl);
  if (ref !== PROD_REF) throw new Error(`Expected prod ref ${PROD_REF}, got ${ref || "(none)"}`);
  const sql = fs.readFileSync(path.join(root, SQL_REL), "utf8");
  console.log(`[voice-types-prod] applying ${SQL_REL} -> ${ref}`);
  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });
  await client.connect();
  try {
    await client.query(sql);
    const check = await client.query(
      `select count(*)::int as n from public.companion_voice_types`
    );
    console.log("[voice-types-prod] ok rows=", check.rows[0]?.n);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[voice-types-prod] FAILED", err.message || err);
  process.exit(1);
});
