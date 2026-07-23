const REQUIRED_ENV = ["ADMIN_DATABASE_URL", "ADMIN_DATABASE_SERVICE_KEY"];

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function roleFrom(req) {
  return req.headers["x-mcj-admin-role"] || req.headers["x-user-role"] || "";
}

module.exports = async function handler(req, res) {
  if (roleFrom(req) !== "super_admin") {
    return json(res, 403, { ok: false, message: "没有陪玩等级管理权限" });
  }

  if (req.method === "GET") {
    return json(res, 200, {
      ok: true,
      fields: [
        "level_name",
        "level_icon",
        "min_price",
        "max_price",
        "upgrade_condition",
        "application_open",
        "level_color",
        "description",
        "sort_order",
        "enabled",
      ],
    });
  }

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }

  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    return json(res, 503, {
      ok: false,
      message: "真实数据库未配置，陪玩等级修改未保存",
      requiredEnv: missing,
    });
  }

  return json(res, 501, {
    ok: false,
    message: "陪玩等级数据库适配器尚未接入",
  });
};
