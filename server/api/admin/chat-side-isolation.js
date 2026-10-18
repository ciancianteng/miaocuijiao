/**
 * Super-admin: apply 20260807_chat_side_isolation.sql on the current environment.
 * Staging cfccwysniduwkjskiqgy and Production jqfaknpmcnqwqvatrwgo are separate.
 * SQL runs only when SUPABASE_URL and DATABASE_URL resolve to that same project.
 * An unparseable project ref refuses SQL. It does not switch the target.
 *
 * - With a matching DATABASE_URL: run full SQL (data scrub + RLS).
 * - Without DATABASE_URL: scrub mislinked companion_id / types via service-role REST only;
 *   RLS policies still require SQL Editor (reported clearly in the response).
 */
import fs from "node:fs";
import path from "node:path";
import { loadLocalEnv } from "../_load-env.js";
import {
  STAGING_SUPABASE_REF,
  PRODUCTION_SUPABASE_REF,
  supabaseProjectRef,
  assertSameSupabaseProject,
} from "../../../scripts/lib/prod-guard.mjs";

loadLocalEnv();

const ADMIN_ROLES = new Set(["super_admin", "admin"]);
const KNOWN_PROJECT_REFS = new Set([STAGING_SUPABASE_REF, PRODUCTION_SUPABASE_REF]);
const MIGRATION_REL = "supabase/migrations/20260807_chat_side_isolation.sql";

function json(res, status, data) {
  res.status(status).json(data);
}

function envValue(key) {
  return process.env[key] || "";
}

function resolvedSupabaseUrl() {
  const primary = String(process.env.SUPABASE_URL || "").trim();
  const vite = String(process.env.VITE_SUPABASE_URL || "").trim();
  const primaryRef = supabaseProjectRef(primary);
  const viteRef = supabaseProjectRef(vite);
  if (primary && vite && primaryRef && viteRef && primaryRef !== viteRef) {
    return { ok: false };
  }
  if (primary && !primaryRef && vite) return { ok: false };
  const supabaseUrl = primary || vite;
  return { ok: true, supabaseUrl, ref: supabaseProjectRef(supabaseUrl) };
}

function jwtProjectRef(token) {
  const part = String(token || "").split(".")[1] || "";
  if (!part) return "";
  try {
    const json = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return String(json.ref || "").toLowerCase();
  } catch {
    return "";
  }
}

function publicError(err) {
  return String(err?.message || err)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]")
    .slice(0, 240);
}

function serviceHeaders(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const base = {
    apikey: key,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
  if (key && !key.startsWith("sb_secret_")) base.Authorization = `Bearer ${key}`;
  return base;
}

function restUrl(supabaseUrl, table, query = "") {
  return `${String(supabaseUrl || "").replace(/\/$/, "")}/rest/v1/${table}${query}`;
}

async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message =
      body?.message || body?.hint || body?.details || (typeof body === "string" ? body : "") || `HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

function isBossCsType(row) {
  const t = String(row.conversation_type || "").trim().toLowerCase();
  return !t || t === "order_support" || t === "general_support";
}

async function countLeakedBossRooms(supabaseUrl) {
  const rows = await supabaseJson(
    restUrl(
      supabaseUrl,
      "conversations",
      "?select=id,boss_id,companion_id,conversation_type&boss_id=not.is.null&companion_id=not.is.null&limit=2000"
    ),
    { headers: serviceHeaders() }
  );
  const list = Array.isArray(rows) ? rows : [];
  const leaked = list.filter(isBossCsType);
  return { scanned: list.length, leaked: leaked.length, sampleIds: leaked.slice(0, 8).map((r) => r.id) };
}

async function scrubViaRest(supabaseUrl) {
  const report = {
    detachedCompanionFromBossRooms: 0,
    typedCompanionSupport: 0,
    errors: [],
  };

  // 1) Detach companions from boss↔CS rooms
  const stamped = await supabaseJson(
    restUrl(
      supabaseUrl,
      "conversations",
      "?select=id,boss_id,companion_id,conversation_type&boss_id=not.is.null&companion_id=not.is.null&limit=5000"
    ),
    { headers: serviceHeaders() }
  );
  const toDetach = (Array.isArray(stamped) ? stamped : []).filter(isBossCsType);
  for (const row of toDetach) {
    try {
      const saved = await supabaseJson(restUrl(supabaseUrl, "conversations", `?id=eq.${encodeURIComponent(row.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ companion_id: null, updated_at: new Date().toISOString() }),
      });
      if (Array.isArray(saved) ? saved.length : saved) report.detachedCompanionFromBossRooms += 1;
    } catch (err) {
      report.errors.push(`detach ${row.id}: ${String(err.message || err).slice(0, 120)}`);
    }
  }

  // 2) Type companion-only rows as companion_support when type is empty
  const companionOnly = await supabaseJson(
    restUrl(
      supabaseUrl,
      "conversations",
      "?select=id,boss_id,companion_id,conversation_type&companion_id=not.is.null&boss_id=is.null&or=(conversation_type.is.null,conversation_type.eq.)&limit=5000"
    ),
    { headers: serviceHeaders() }
  ).catch(() => []);
  const toType = (Array.isArray(companionOnly) ? companionOnly : []).filter((r) => !String(r.conversation_type || "").trim());
  for (const row of toType) {
    try {
      const saved = await supabaseJson(restUrl(supabaseUrl, "conversations", `?id=eq.${encodeURIComponent(row.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({ conversation_type: "companion_support", updated_at: new Date().toISOString() }),
      });
      if (Array.isArray(saved) ? saved.length : saved) report.typedCompanionSupport += 1;
    } catch (err) {
      report.errors.push(`type ${row.id}: ${String(err.message || err).slice(0, 120)}`);
    }
  }

  return report;
}

async function applySqlMigration(databaseUrl) {
  const { default: pg } = await import("pg");
  const sqlPath = path.join(process.cwd(), MIGRATION_REL);
  const sql = fs.readFileSync(sqlPath, "utf8");
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 25000,
  });
  await client.connect();
  try {
    // Identity check inside the live session
    const ident = await client.query(`
      select current_database() as db,
             current_user as usr,
             inet_server_addr()::text as addr
    `);
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");

    // Verify policies exist
    const policies = await client.query(`
      select pol.polname as name, cls.relname as table
      from pg_policy pol
      join pg_class cls on cls.oid = pol.polrelid
      join pg_namespace nsp on nsp.oid = cls.relnamespace
      where nsp.nspname = 'public'
        and cls.relname in ('conversations', 'messages')
        and pol.polname in ('conversations_role_read', 'messages_role_read')
      order by cls.relname, pol.polname
    `);

    const leaked = await client.query(`
      select count(*)::int as n
      from public.conversations
      where boss_id is not null
        and companion_id is not null
        and coalesce(conversation_type, 'order_support') in ('order_support', 'general_support', '')
    `);

    try {
      await client.query(`notify pgrst, 'reload schema'`);
    } catch {
      /* optional */
    }

    return {
      ok: true,
      mode: "sql",
      identity: ident.rows[0] || null,
      policies: policies.rows,
      leakedRemaining: leaked.rows[0]?.n ?? null,
    };
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, message: "Method not allowed" });
  }

  let admin;
  try {
    admin = await (await import("../_admin-auth.js")).requireAdmin(req, { allowRoles: ADMIN_ROLES });
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "无权" });
  }

  const resolved = resolvedSupabaseUrl();
  if (!resolved.ok) {
    return json(res, 409, {
      ok: false,
      message: "拒绝执行：SUPABASE_URL 与 VITE_SUPABASE_URL 不是同一个项目，禁止跨环境回退",
    });
  }
  const supabaseUrl = resolved.supabaseUrl;
  const ref = resolved.ref;
  if (!KNOWN_PROJECT_REFS.has(ref)) {
    return json(res, 409, {
      ok: false,
      message: `拒绝执行：当前 SUPABASE_URL 不是 Staging（${STAGING_SUPABASE_REF}）或 Production（${PRODUCTION_SUPABASE_REF}）`,
      supabaseProjectRef: ref,
      supabaseHost: (() => {
        try {
          return new URL(supabaseUrl).hostname;
        } catch {
          return "";
        }
      })(),
    });
  }

  const serviceKey = envValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    return json(res, 503, { ok: false, message: "缺少 SUPABASE_SERVICE_ROLE_KEY" });
  }
  const keyRef = jwtProjectRef(serviceKey);
  if (keyRef && keyRef !== ref) {
    return json(res, 409, {
      ok: false,
      message: "拒绝执行：service role 不属于当前 SUPABASE_URL 项目",
      supabaseProjectRef: ref,
      serviceRoleProjectRef: keyRef,
    });
  }

  const before = await countLeakedBossRooms(supabaseUrl).catch((err) => ({
    error: publicError(err),
  }));

  const databaseUrl = String(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || "").trim();

  if (databaseUrl) {
    const same = assertSameSupabaseProject(supabaseUrl, databaseUrl);
    if (!same.ok || !KNOWN_PROJECT_REFS.has(same.databaseRef)) {
      return json(res, 409, {
        ok: false,
        message: "拒绝执行 SQL：DATABASE_URL 与当前 SUPABASE_URL 不是同一个 Staging 或 Production 项目，或项目号无法确认",
        supabaseProjectRef: same.supabaseRef,
        databaseProjectRef: same.databaseRef,
      });
    }
    try {
      const sqlResult = await applySqlMigration(databaseUrl);
      const after = await countLeakedBossRooms(supabaseUrl).catch(() => null);
      return json(res, 200, {
        ok: true,
        migration: MIGRATION_REL,
        projectRef: ref,
        mode: "full_sql",
        rlsApplied: true,
        dataScrubbed: true,
        before,
        after,
        sqlResult,
        adminId: admin.id,
        message: "已在当前项目执行完整 chat_side_isolation migration（数据清理 + RLS）。",
      });
    } catch (err) {
      return json(res, 500, {
        ok: false,
        message: `SQL migration 失败：${publicError(err)}`,
        projectRef: ref,
        before,
      });
    }
  }

  // No DATABASE_URL on Vercel — scrub data via service role; RLS must be applied in SQL Editor.
  try {
    const scrub = await scrubViaRest(supabaseUrl);
    const after = await countLeakedBossRooms(supabaseUrl).catch(() => null);
    return json(res, 200, {
      ok: true,
      migration: MIGRATION_REL,
      projectRef: ref,
      mode: "rest_data_scrub_only",
      rlsApplied: false,
      dataScrubbed: true,
      before,
      after,
      scrub,
      adminId: admin.id,
      message:
        `历史越权 companion_id 已清理；但本环境未配置 DATABASE_URL，RLS 策略未能自动创建。请在当前项目 ${ref} 的 Supabase SQL Editor 执行 supabase/migrations/20260807_chat_side_isolation.sql。`,
      manualSqlRequired: true,
      sqlFile: MIGRATION_REL,
    });
  } catch (err) {
    return json(res, 500, {
      ok: false,
      message: publicError(err),
      projectRef: ref,
      before,
    });
  }
}
