const REQUIRED_ENV = ["ADMIN_DATABASE_URL", "ADMIN_DATABASE_SERVICE_KEY"];
const RESERVED_BOSS_IDS = ["admin", "system", "official", "root", "support", "service"];

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function roleFrom(req) {
  return req.headers["x-mcj-admin-role"] || req.headers["x-user-role"] || "";
}

function canManageBosses(req) {
  return roleFrom(req) === "super_admin" || roleFrom(req) === "finance_admin";
}

function validateBossId(value) {
  const id = String(value || "");
  if (!/^[A-Za-z0-9_]{4,20}$/.test(id)) return "老板 ID 只能使用 4-20 位字母、数字和下划线";
  if (RESERVED_BOSS_IDS.includes(id.toLowerCase())) return "老板 ID 属于系统保留词";
  return "";
}

module.exports = async function handler(req, res) {
  if (!canManageBosses(req)) {
    return json(res, 403, { ok: false, message: "没有老板管理权限" });
  }

  if (req.method === "GET") {
    return json(res, 200, {
      ok: true,
      fields: [
        "avatar",
        "nickname",
        "system_uid",
        "boss_id",
        "phone",
        "email",
        "game_accounts",
        "registered_at",
        "last_login_at",
        "vip_level",
        "balance",
        "total_recharge",
        "total_spent",
        "total_orders",
        "refund_amount",
        "inviter_uid",
        "account_status",
      ],
      accountStatuses: ["正常", "限制下单", "限制充值", "冻结", "已注销", "黑名单"],
      loginStatuses: ["在线", "离线"],
      reservedBossIds: RESERVED_BOSS_IDS,
    });
  }

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body = {};
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch (e) {}

  if (body.action === "boss-id") {
    const error = validateBossId(body.payload && body.payload.bossId);
    if (error) return json(res, 400, { ok: false, message: error });
  }

  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    return json(res, 503, {
      ok: false,
      message: "真实数据库未配置，老板管理修改未保存",
      requiredEnv: missing,
    });
  }

  return json(res, 501, {
    ok: false,
    message: "老板管理数据库适配器尚未接入",
  });
};
