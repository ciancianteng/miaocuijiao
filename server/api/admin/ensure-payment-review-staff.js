/**
 * Super-admin only: apply payment review staff snapshot SQL when DATABASE_URL is present.
 */
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

  const body = typeof req.body === "object" && req.body ? req.body : {};
  const action = String(body.action || "ensure_payment_review_staff").trim();
  const out = { ok: true, adminId: admin.id, action, ddl: null };

  const databaseUrl = String(
    process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || ""
  ).trim();
  if (!databaseUrl) {
    out.ddl = {
      ok: false,
      skipped: true,
      message:
        "未配置 DATABASE_URL。请在 Supabase SQL Editor 执行 supabase/migrations/20260810_payment_review_staff_snapshot.sql。运行时已 dual-write payment_operation_logs 作为审核人快照兜底。",
    };
    return json(res, 200, out);
  }

  if (action !== "ensure_payment_review_staff" && action !== "apply_migration") {
    return json(res, 400, { ok: false, message: "未知 action" });
  }

  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { default: pg } = await import("pg");
    const sqlPath = path.join(process.cwd(), "supabase", "migrations", "20260810_payment_review_staff_snapshot.sql");
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
    out.ddl = { ok: true, message: "已执行 payment review staff snapshot migration。" };
    return json(res, 200, out);
  } catch (err) {
    out.ok = false;
    out.ddl = { ok: false, message: err.message || "DDL 执行失败" };
    return json(res, 500, out);
  }
}
