/**
 * Admin: companion email notification logs + retry.
 */
const ADMIN_ROLES = new Set(["super_admin", "admin", "finance_admin", "ops_admin"]);

function json(res, status, data) {
  res.status(status).json(data);
}

function hasDatabaseConfig() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export default async function handler(req, res) {
  let admin;
  try {
    admin = await (await import("../_admin-auth.js")).requireAdmin(req, { allowRoles: ADMIN_ROLES });
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "没有后台权限" });
  }

  if (!hasDatabaseConfig()) {
    return json(res, 200, { ok: true, configured: false, logs: [], message: "未配置数据库" });
  }

  try {
    const {
      listCompanionNotificationEmails,
      retryFailedCompanionOrderEmails,
    } = await import("../_companion-order-notify.js");

    if (req.method === "GET") {
      const url = new URL(req.url || "/", "http://localhost");
      const status = String(url.searchParams.get("status") || "").trim();
      const limit = Number(url.searchParams.get("limit") || 100) || 100;
      const logs = await listCompanionNotificationEmails({ limit, status });
      return json(res, 200, {
        ok: true,
        configured: true,
        logs,
        adminId: admin.id,
      });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const action = String(body.action || "").trim();
      if (action === "retry_failed" || action === "retry") {
        const limit = Math.min(40, Number(body.limit || 10) || 10);
        const result = await retryFailedCompanionOrderEmails({ limit });
        return json(res, 200, {
          ok: true,
          message: `已尝试重试 ${result.retried || 0} 条`,
          ...result,
        });
      }
      if (action === "retry_one") {
        const id = String(body.id || "").trim();
        if (!id) return json(res, 400, { ok: false, message: "缺少记录 ID" });
        // Reuse batch retry filter by temporarily listing and matching — call module internals via force list.
        const logs = await listCompanionNotificationEmails({ limit: 200 });
        const hit = logs.find((x) => x.id === id);
        if (!hit) return json(res, 404, { ok: false, message: "记录不存在" });
        const result = await retryFailedCompanionOrderEmails({ limit: 40 });
        return json(res, 200, {
          ok: true,
          message: "已触发重试队列",
          target: hit.notificationKey,
          ...result,
        });
      }
      return json(res, 400, { ok: false, message: "未知操作" });
    }

    return json(res, 405, { ok: false, message: "Method not allowed" });
  } catch (err) {
    return json(res, err.status || 500, { ok: false, message: err.message || "邮件通知记录接口异常" });
  }
}
