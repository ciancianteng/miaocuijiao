const REQUIRED_ENV = ["ADMIN_DATABASE_URL", "ADMIN_DATABASE_SERVICE_KEY"];
const ADMIN_ROLES = new Set(["super_admin", "admin", "finance_admin"]);
const ACTIONS = new Set([
  "send_message",
  "take-over",
  "transfer",
  "blacklist",
  "delete",
  "export",
  "view-profile",
  "orders",
  "refund",
  "create-order",
  "recharge",
  "recall",
  "copy",
  "forward",
  "reply",
  "tool_image",
  "tool_voice",
  "tool_emoji",
  "tool_quick",
]);

function hasDatabaseConfig() {
  return (
    REQUIRED_ENV.every((key) => process.env[key]) ||
    !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  );
}

function json(res, status, data) {
  res.status(status).json(data);
}

function restUrl(table, query = "") {
  return `${process.env.SUPABASE_URL || process.env.ADMIN_DATABASE_URL}/rest/v1/${table}${query}`;
}

function serviceHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.ADMIN_DATABASE_SERVICE_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
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
    const detail = body?.message || body?.error_description || body?.hint || text || "";
    throw new Error(detail || `Supabase HTTP ${response.status}`);
  }
  return body;
}

export default async function handler(req, res) {
  let adminProfile;
  try {
    adminProfile = await (await import("../_admin-auth.js")).requireAdmin(req, { allowRoles: ADMIN_ROLES });
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "没有消息中心访问权限" });
  }
  const role = String(adminProfile.role || "");

  if (req.method === "GET") {
    if (!hasDatabaseConfig()) {
      return json(res, 200, {
        ok: true,
        realtime: false,
        conversations: [],
        messages: [],
        profiles: {},
        message: "统一聊天数据库尚未配置，未返回任何模拟会话",
      });
    }
    try {
      const rows = await supabaseJson(
        restUrl("conversations", "?order=updated_at.desc&limit=80"),
        { headers: serviceHeaders() }
      );
      return json(res, 200, {
        ok: true,
        realtime: true,
        conversations: Array.isArray(rows) ? rows : [],
        messages: [],
        profiles: {},
      });
    } catch (err) {
      return json(res, 500, { ok: false, message: err.message || "读取会话失败" });
    }
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const action = String(body.action || "");
    const conversationId = String(body.conversationId || body.conversation_id || body.id || "");
    if (!ACTIONS.has(action)) {
      return json(res, 400, { ok: false, message: "未知消息中心操作" });
    }
    if (!conversationId) {
      return json(res, 400, { ok: false, message: "缺少真实会话 ID" });
    }
    if (!ADMIN_ROLES.has(role) && /take-over|transfer|blacklist|delete|export/.test(action)) {
      return json(res, 403, { ok: false, message: "当前角色无权执行管理员聊天操作" });
    }
    if (!hasDatabaseConfig()) {
      return json(res, 503, {
        ok: false,
        message: "统一聊天数据库未配置，操作未保存",
      });
    }

    if (action === "take-over" || action === "transfer") {
      const existing = (
        await supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}&limit=1`), {
          headers: serviceHeaders(),
        })
      )?.[0];
      if (!existing) return json(res, 404, { ok: false, message: "会话不存在" });
      if (existing.status === "closed" || existing.status === "ended") {
        return json(res, 400, { ok: false, message: "会话已结束，无法接管" });
      }
      const targetId = String(body.target_cs_id || body.targetCsId || body.to_cs_id || adminProfile.id).trim();
      const targetRows = await supabaseJson(
        restUrl("profiles", `?id=eq.${encodeURIComponent(targetId)}&limit=1`),
        { headers: serviceHeaders() }
      );
      const target = Array.isArray(targetRows) ? targetRows[0] : null;
      if (!target) return json(res, 400, { ok: false, message: "目标客服不存在" });
      const prev = existing.customer_service_id
        ? (
            await supabaseJson(
              restUrl("profiles", `?id=eq.${encodeURIComponent(existing.customer_service_id)}&limit=1`),
              { headers: serviceHeaders() }
            )
          )?.[0]
        : null;
      const now = new Date().toISOString();
      const patched = await supabaseJson(
        restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}`),
        {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({
            customer_service_id: target.id,
            status: "active",
            accepted_at: now,
            updated_at: now,
          }),
        }
      ).catch(async () =>
        supabaseJson(restUrl("conversations", `?id=eq.${encodeURIComponent(conversationId)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({
            customer_service_id: target.id,
            status: "serving",
            updated_at: now,
          }),
        })
      );
      const fromName = String(prev?.display_name || "").trim() || "客服";
      const toName = String(target.display_name || "").trim() || "客服";
      const sys =
        action === "take-over"
          ? `管理员已将该订单从【${fromName}】转交给【${toName}】。`
          : `该订单已由【${fromName}】转交给【${toName}】。`;
      try {
        await supabaseJson(restUrl("messages", ""), {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify({
            conversation_id: conversationId,
            sender_id: adminProfile.id,
            sender_role: "customer_service",
            message_type: "system",
            content: sys,
            created_at: now,
          }),
        });
      } catch (_) {}
      try {
        await supabaseJson(restUrl("conversation_lock_logs", ""), {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify({
            conversation_id: conversationId,
            order_id: existing.order_id || null,
            action: action === "take-over" ? "admin_takeover" : "admin_transfer",
            from_cs_id: existing.customer_service_id || null,
            to_cs_id: target.id,
            operator_id: adminProfile.id,
            operator_role: role,
            detail: sys,
            created_at: now,
          }),
        });
      } catch (_) {}
      return json(res, 200, {
        ok: true,
        message: action === "take-over" ? "已强制接管" : "已转交",
        conversation: Array.isArray(patched) ? patched[0] : existing,
      });
    }

    return json(res, 501, {
      ok: false,
      message: "该消息中心操作尚未接入，请使用客服端会话能力。",
    });
  }

  res.setHeader("Allow", "GET, POST");
  return json(res, 405, { ok: false, message: "Method Not Allowed" });
}
