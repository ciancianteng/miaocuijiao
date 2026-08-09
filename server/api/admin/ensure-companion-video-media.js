/**
 * Super-admin only: apply companion media video SQL when DATABASE_URL is present.
 * Also ensures Storage companion-video bucket via service role (no DB required).
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
  const action = String(body.action || "ensure_companion_video_media").trim();

  const out = { ok: true, adminId: admin.id, action, storage: null, ddl: null };

  try {
    const { ensureCompanionBuckets, PRIVATE_BUCKETS } = await import("../_companion-media-store.js");
    await ensureCompanionBuckets();
    out.storage = { ok: true, videoBucket: PRIVATE_BUCKETS.video };
  } catch (err) {
    out.storage = { ok: false, message: err.message || String(err) };
  }

  const databaseUrl = String(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || "").trim();
  if (!databaseUrl) {
    out.ddl = {
      ok: false,
      skipped: true,
      message:
        "未配置 DATABASE_URL。Storage 桶已尽量确保；请在 Supabase SQL Editor 执行 supabase/migrations/20260809_companion_media_video.sql。",
    };
    return json(res, 200, out);
  }

  if (action !== "ensure_companion_video_media" && action !== "apply_migration") {
    return json(res, 400, { ok: false, message: "未知 action" });
  }

  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { default: pg } = await import("pg");
    const sqlPath = path.join(process.cwd(), "supabase", "migrations", "20260809_companion_media_video.sql");
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
    out.ddl = { ok: true, message: "已执行 companion_media video migration。" };
    return json(res, 200, out);
  } catch (err) {
    out.ok = false;
    out.ddl = { ok: false, message: err.message || "DDL 执行失败" };
    return json(res, 500, out);
  }
}
