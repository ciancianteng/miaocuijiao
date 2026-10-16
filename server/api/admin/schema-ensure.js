/**
 * Super-admin only: apply companion order notify SQL when DATABASE_URL is present.
 * Safe to call repeatedly. SQL runs only when DATABASE_URL and SUPABASE_URL match.
 */
import { assertSameSupabaseProject } from "../../../scripts/lib/prod-guard.mjs";
const ADMIN_ROLES = new Set(["super_admin", "admin"]);

function json(res, status, data) {
  res.status(status).json(data);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method not allowed" });
  let admin;
  try {
    admin = await (await import("../_admin-auth.js")).requireAdmin(req, { allowRoles: ADMIN_ROLES });
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "无权" });
  }

  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    return json(res, 200, {
      ok: false,
      skipped: true,
      message: "未配置 DATABASE_URL，无法在线执行 DDL。请在 Supabase SQL 执行 migrations/20260806_companion_order_realtime_notify.sql。广播+轮询兜底仍可用。",
      adminId: admin.id,
    });
  }

  const same = assertSameSupabaseProject(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "", databaseUrl);
  if (!same.ok) {
    return json(res, 409, {
      ok: false,
      message: "拒绝执行 SQL：DATABASE_URL 与当前 SUPABASE_URL 不是同一个 Supabase 项目，或项目号无法确认",
      supabaseProjectRef: same.supabaseRef,
      databaseProjectRef: same.databaseRef,
      adminId: admin.id,
    });
  }

  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { default: pg } = await import("pg");
    const sqlPath = path.join(process.cwd(), "supabase", "migrations", "20260806_companion_order_realtime_notify.sql");
    const sql = fs.readFileSync(sqlPath, "utf8");
    const client = new pg.Client({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 20000,
    });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
    return json(res, 200, { ok: true, message: "已执行 companion order realtime/notify migration。" });
  } catch (err) {
    return json(res, 500, { ok: false, message: err.message || "DDL 执行失败" });
  }
}
