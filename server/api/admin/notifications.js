import { requireAdmin } from "../_admin-auth.js";
import { listStaffNotifications, markAllStaffNotificationsRead, markStaffNotificationRead } from "../_staff-notify.js";

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
        const notifications = await listStaffNotifications(admin.id, 40);
        const unread = notifications.filter((item) => !item.readAt).length;
        if (!marked) {
          /* Already read counts as success so the badge can sync. */
          const target = notifications.find((n) => String(n.id) === String(body.id || ""));
          if (target && target.readAt) {
            return json(res, 200, { ok: true, marked: 1, unread, notifications });
          }
          return json(res, 409, { ok: false, message: "已读状态写入失败", unread, notifications });
        }
        return json(res, 200, { ok: true, marked, unread, notifications });
      }
      if (String(body.action || "") === "mark_all_read") {
        const marked = await markAllStaffNotificationsRead(admin.id);
        const notifications = await listStaffNotifications(admin.id, 40);
        const unread = notifications.filter((item) => !item.readAt).length;
        if (unread > 0) {
          return json(res, 409, {
            ok: false,
            message: "部分通知未能标记已读，请重试",
            marked,
            unread,
            notifications,
          });
        }
        return json(res, 200, { ok: true, marked, unread: 0, notifications });
      }
      return json(res, 400, { ok: false, message: "未知操作" });
    }
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  } catch (err) {
    return json(res, 500, { ok: false, message: err.message || "通知读取失败" });
  }
}
