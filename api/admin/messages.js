const REQUIRED_ENV = ["ADMIN_DATABASE_URL", "ADMIN_DATABASE_SERVICE_KEY"];
const ADMIN_ROLES = new Set(["super_admin", "admin", "finance_admin"]);
const SERVICE_ROLES = new Set(["customer_service", "service"]);
const USER_ROLES = new Set(["boss", "customer", "player", "companion"]);
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
  "tool_quick"
]);

function roleFromRequest(req) {
  return String(req.headers["x-mcj-admin-role"] || req.headers["x-mcj-role"] || "").trim();
}

function canRead(role) {
  return ADMIN_ROLES.has(role) || SERVICE_ROLES.has(role) || USER_ROLES.has(role);
}

function hasDatabaseConfig() {
  return REQUIRED_ENV.every((key) => process.env[key]);
}

function json(res, status, data) {
  res.status(status).json(data);
}

export default async function handler(req, res) {
  const role = roleFromRequest(req);
  if (!canRead(role)) {
    return json(res, 403, { ok: false, message: "没有消息中心访问权限" });
  }

  if (req.method === "GET") {
    if (!hasDatabaseConfig()) {
      return json(res, 200, {
        ok: true,
        realtime: false,
        conversations: [],
        messages: [],
        profiles: {},
        message: "统一聊天数据库尚未配置，未返回任何模拟会话",
        schema: {
          conversations: [
            "id",
            "type",
            "name",
            "uid",
            "boss_id",
            "player_id",
            "phone",
            "avatar",
            "last_message",
            "last_time",
            "unread_count",
            "online_status",
            "assigned_service"
          ],
          messages: [
            "id",
            "conversation_id",
            "sender_id",
            "sender_role",
            "type",
            "content",
            "file_url",
            "card_payload",
            "quote_message_id",
            "read_at",
            "created_at",
            "deleted_at",
            "recalled_at"
          ],
          profileTables: [
            "users",
            "boss_profiles",
            "player_profiles",
            "customer_service_profiles",
            "orders",
            "wallets",
            "recharge_requests",
            "refunds",
            "invite_relations"
          ]
        }
      });
    }

    return json(res, 501, {
      ok: false,
      message: "消息数据库适配器尚未接入，请连接统一聊天表后读取真实会话"
    });
  }

  if (req.method === "POST") {
    const action = String(req.body?.action || "");
    const conversationId = String(req.body?.conversationId || "");
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
        message: "统一聊天数据库未配置，操作未保存"
      });
    }

    return json(res, 501, {
      ok: false,
      message: "消息写入适配器尚未接入，请先连接统一聊天数据库"
    });
  }

  res.setHeader("Allow", "GET, POST");
  return json(res, 405, { ok: false, message: "Method Not Allowed" });
}
