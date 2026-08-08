/**
 * Super-admin: apply 20260807_chat_side_isolation.sql to the acceptance Supabase.
 * Hard-guards project ref so we never touch a non-staging DB.
 *
 * - With DATABASE_URL matching the same project: run full SQL (data scrub + RLS).
 * - Without DATABASE_URL: scrub mislinked companion_id / types via service-role REST only;
 *   RLS policies still require SQL Editor (reported clearly in the response).
 */
import fs from "node:fs";
import path from "node:path";
import { loadLocalEnv } from "../_load-env.js";

loadLocalEnv();

const ADMIN_ROLES = new Set(["super_admin", "admin"]);
/** Fixed acceptance / staging Supabase project — refuse anything else. */
const EXPECTED_PROJECT_REF = "jqfaknpmcnqwqvatrwgo";
const MIGRATION_REL = "supabase/migrations/20260807_chat_side_isolation.sql";

function json(res, status, data) {
  res.status(status).json(data);
}

function envValue(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return process.env[key] || "";
}

function projectRefFromUrl(url) {
  try {
    const host = new URL(String(url || "")).hostname || "";
    const m = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return m ? m[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

function projectRefFromDatabaseUrl(dbUrl) {
  try {
    const u = new URL(String(dbUrl || ""));
    const host = (u.hostname || "").toLowerCase();
    // db.<ref>.supabase.co or pooler username postgres.<ref>
    const direct = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (direct) return direct[1].toLowerCase();
    const user = decodeURIComponent(u.username || "");
    const fromUser = user.match(/^postgres\.([a-z0-9]+)$/i);
    if (fromUser) return fromUser[1].toLowerCase();
    return "";
  } catch {
    return "";
  }
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

function restUrl(table, query = "") {
  return `${envValue("SUPABASE_URL").replace(/\/$/, "")}/rest/v1/${table}${query}`;
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

async function countLeakedBossRooms() {
  const rows = await supabaseJson(
    restUrl(
      "conversations",
      "?select=id,boss_id,companion_id,conversation_type&boss_id=not.is.null&companion_id=not.is.null&limit=2000"
    ),
    { headers: serviceHeaders() }
  );
  const list = Array.isArray(rows) ? rows : [];
  const leaked = list.filter(isBossCsType);
  return { scanned: list.length, leaked: leaked.length, sampleIds: leaked.slice(0, 8).map((r) => r.id) };
}

async function scrubViaRest() {
  const report = {
    detachedCompanionFromBossRooms: 0,
    typedCompanionSupport: 0,
    errors: [],
  };

  // 1) Detach companions from boss↔CS rooms
  const stamped = await supabaseJson(
    restUrl(
      "conversations",
      "?select=id,boss_id,companion_id,conversation_type&boss_id=not.is.null&companion_id=not.is.null&limit=5000"
    ),
    { headers: serviceHeaders() }
  );
  const toDetach = (Array.isArray(stamped) ? stamped : []).filter(isBossCsType);
  for (const row of toDetach) {
    try {
      const saved = await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(row.id)}`), {
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
      "conversations",
      "?select=id,boss_id,companion_id,conversation_type&companion_id=not.is.null&boss_id=is.null&or=(conversation_type.is.null,conversation_type.eq.)&limit=5000"
    ),
    { headers: serviceHeaders() }
  ).catch(() => []);
  const toType = (Array.isArray(companionOnly) ? companionOnly : []).filter((r) => !String(r.conversation_type || "").trim());
  for (const row of toType) {
    try {
      const saved = await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(row.id)}`), {
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

  const supabaseUrl = envValue("SUPABASE_URL");
  const ref = projectRefFromUrl(supabaseUrl);
  if (!ref || ref !== EXPECTED_PROJECT_REF) {
    return json(res, 409, {
      ok: false,
      message: `拒绝执行：当前 SUPABASE_URL 项目不是验收库 ${EXPECTED_PROJECT_REF}（got ${ref || "empty"}）`,
      expectedProjectRef: EXPECTED_PROJECT_REF,
      supabaseHost: (() => {
        try {
          return new URL(supabaseUrl).hostname;
        } catch {
          return "";
        }
      })(),
    });
  }

  if (!envValue("SUPABASE_SERVICE_ROLE_KEY")) {
    return json(res, 503, { ok: false, message: "缺少 SUPABASE_SERVICE_ROLE_KEY" });
  }

  const before = await countLeakedBossRooms().catch((err) => ({
    error: String(err.message || err).slice(0, 160),
  }));

  const databaseUrl = String(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || "").trim();
  const dbRef = databaseUrl ? projectRefFromDatabaseUrl(databaseUrl) : "";

  if (databaseUrl) {
    if (dbRef && dbRef !== EXPECTED_PROJECT_REF) {
      return json(res, 409, {
        ok: false,
        message: `拒绝执行：DATABASE_URL 指向其他项目 ${dbRef}，不是验收库 ${EXPECTED_PROJECT_REF}`,
        expectedProjectRef: EXPECTED_PROJECT_REF,
        databaseProjectRef: dbRef,
      });
    }
    try {
      const sqlResult = await applySqlMigration(databaseUrl);
      const after = await countLeakedBossRooms().catch(() => null);
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
        message: "已在验收库执行完整 chat_side_isolation migration（数据清理 + RLS）。",
      });
    } catch (err) {
      return json(res, 500, {
        ok: false,
        message: `SQL migration 失败：${String(err.message || err).slice(0, 240)}`,
        projectRef: ref,
        before,
      });
    }
  }

  // No DATABASE_URL on Vercel — scrub data via service role; RLS must be applied in SQL Editor.
  try {
    const scrub = await scrubViaRest();
    const after = await countLeakedBossRooms().catch(() => null);
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
        "验收库历史越权 companion_id 已清理；但本环境未配置 DATABASE_URL，RLS 策略未能自动创建。请在 Supabase SQL Editor（项目 jqfaknpmcnqwqvatrwgo）执行 supabase/migrations/20260807_chat_side_isolation.sql。",
      manualSqlRequired: true,
      sqlFile: MIGRATION_REL,
    });
  } catch (err) {
    return json(res, 500, {
      ok: false,
      message: String(err.message || err).slice(0, 240),
      projectRef: ref,
      before,
    });
  }
}
