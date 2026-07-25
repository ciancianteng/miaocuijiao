const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
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
  return roleFrom(req) === "super_admin" || roleFrom(req) === "finance_admin" || roleFrom(req) === "admin";
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
    const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
    if (missing.length) {
      return json(res, 200, {
        ok: true,
        configured: false,
        bosses: [],
        message: "真实老板数据库未配置，未返回任何模拟老板",
        requiredEnv: missing,
      });
    }
    try {
      const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/boss_profiles?order=created_at.desc&limit=100`, {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });
      const text = await response.text();
      let rows = [];
      try { rows = text ? JSON.parse(text) : []; } catch (e) {}
      if (!response.ok) {
        return json(res, 500, { ok: false, message: rows.message || rows.hint || "老板数据库读取失败" });
      }
      return json(res, 200, {
        ok: true,
        configured: true,
        bosses: Array.isArray(rows) ? rows : [],
        accountStatuses: ["正常", "限制下单", "限制充值", "冻结", "已注销", "黑名单"],
        loginStatuses: ["在线", "离线"],
        reservedBossIds: RESERVED_BOSS_IDS,
      });
    } catch (error) {
      return json(res, 500, { ok: false, message: error.message || "老板管理接口异常" });
    }
  }

  if (req.method === "OPTIONS") {
    return json(res, 200, {
      ok: true,
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
