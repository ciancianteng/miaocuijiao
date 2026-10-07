import { requireAdmin } from "../_admin-auth.js";
import { listStaffNotifications, markStaffNotificationRead } from "../_staff-notify.js";

function json(res, status, data) {
  res.status(status).json(data);
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  let admin;
  try {
    admin = await requireAdmin(req);
  } catch (err) {
    return json(res, err.status || 401, { ok: false, message: err.message || "请先登录后台" });
  }
  try {
    if (req.method === "GET") {
      const notifications = await listStaffNotifications(admin.id, 40);
      return json(res, 200, {
        ok: true,
        unread: notifications.filter((item) => !item.readAt).length,
        notifications,
      });
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      if (String(body.action || "") === "mark_read") {
        const marked = await markStaffNotificationRead(admin.id, body.id || "");
        return json(res, 200, { ok: true, marked });
      }
      return json(res, 400, { ok: false, message: "未知操作" });
    }
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  } catch (err) {
    return json(res, 500, { ok: false, message: err.message || "通知读取失败" });
  }
}
