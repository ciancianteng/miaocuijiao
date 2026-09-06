/**
 * Staging-only SQL apply helpers.
 * Hard-refuse Production (jqfaknpmcnqwqvatrwgo) and any non-Staging ref.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STAGING_PROJECT_REF = "cfccwysniduwkjskiqgy";
export const PRODUCTION_PROJECT_REF = "jqfaknpmcnqwqvatrwgo";

export function projectRefFromSupabaseUrl(url) {
  try {
    const host = new URL(String(url || "")).hostname || "";
    const m = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return m ? m[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

export function projectRefFromDatabaseUrl(dbUrl) {
  try {
    const u = new URL(String(dbUrl || ""));
    const host = (u.hostname || "").toLowerCase();
    const direct = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (direct) return direct[1].toLowerCase();
    const user = decodeURIComponent(u.username || "");
    const fromUser = user.match(/^postgres\.([a-z0-9]+)$/i);
    if (fromUser) return fromUser[1].toLowerCase();
    if (host.includes(STAGING_PROJECT_REF)) return STAGING_PROJECT_REF;
    if (host.includes(PRODUCTION_PROJECT_REF)) return PRODUCTION_PROJECT_REF;
    return "";
  } catch {
    return "";
  }
}

export function assertStagingOnly({ supabaseUrl = "", databaseUrl = "" } = {}) {
  const fromSb = projectRefFromSupabaseUrl(supabaseUrl);
  const fromDb = projectRefFromDatabaseUrl(databaseUrl);
  const refs = [fromSb, fromDb].filter(Boolean);
  for (const ref of refs) {
    if (ref === PRODUCTION_PROJECT_REF) {
      const err = new Error(`拒绝执行：目标是 Production（${PRODUCTION_PROJECT_REF}）。仅允许 Staging（${STAGING_PROJECT_REF}）。`);
      err.status = 403;
      throw err;
    }
    if (ref !== STAGING_PROJECT_REF) {
      const err = new Error(`拒绝执行：项目 ref=${ref} 不是 Staging（${STAGING_PROJECT_REF}）。`);
      err.status = 403;
      throw err;
    }
  }
  if (fromDb && fromDb !== STAGING_PROJECT_REF) {
    const err = new Error(`拒绝执行：DATABASE_URL 不是 Staging。`);
    err.status = 403;
    throw err;
  }
  return { stagingRef: STAGING_PROJECT_REF, fromSb, fromDb };
}

export function buildStagingPoolerUrl(password) {
  const pass = String(password || "").trim();
  if (!pass) return "";
  const u = new URL("postgresql://x@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres");
  u.username = `postgres.${STAGING_PROJECT_REF}`;
  u.password = pass;
  return u.toString();
}

export function resolveSqlFile(relCandidates) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const roots = [process.cwd(), path.join(here, "..", ".."), path.join(here, "_sql")];
  for (const rel of relCandidates) {
    for (const root of roots) {
      const full = path.isAbsolute(rel) ? rel : path.join(root, rel);
      if (fs.existsSync(full)) return full;
    }
    const bundled = path.join(here, "_sql", path.basename(rel));
    if (fs.existsSync(bundled)) return bundled;
  }
  return "";
}

export function readSqlFile(relCandidates) {
  const full = resolveSqlFile(relCandidates);
  if (!full) {
    const err = new Error(`找不到 SQL 文件：${relCandidates.join(" | ")}`);
    err.status = 500;
    throw err;
  }
  return { path: full, sql: fs.readFileSync(full, "utf8") };
}

export async function applySqlViaPostgres(databaseUrl, sql) {
  assertStagingOnly({ databaseUrl });
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: databaseUrl,
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
    return { ok: true, via: "postgres", identity: ident.rows[0] || null };
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

export async function applySqlViaManagementApi(accessToken, sql) {
  const endpoint = `https://api.supabase.com/v1/projects/${STAGING_PROJECT_REF}/database/query`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 400);
    try {
      const j = JSON.parse(text);
      msg = j.message || j.error || msg;
    } catch {
      /* keep */
    }
    throw new Error(`Management API ${res.status}: ${msg}`);
  }
  return { ok: true, via: "management_api" };
}
