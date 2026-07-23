const REQUIRED_ENV = ["ADMIN_DATABASE_URL", "ADMIN_DATABASE_SERVICE_KEY"];

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function roleFrom(req) {
  return req.headers["x-mcj-admin-role"] || req.headers["x-user-role"] || "";
}

function canManageCompanions(req) {
  return roleFrom(req) === "super_admin";
}

module.exports = async function handler(req, res) {
  if (!canManageCompanions(req)) {
    return json(res, 403, { ok: false, message: "没有陪玩管理权限" });
  }

  if (req.method === "GET") {
    return json(res, 200, {
      ok: true,
      fields: [
        "avatar",
        "uid",
        "nickname",
        "club_id",
        "direct_boss_id",
        "level_id",
        "current_price",
        "order_commission_rate",
        "direct_rebate_rate",
        "platform_share_rate",
        "order_status",
        "online_status",
        "total_orders",
        "total_income",
        "monthly_income",
        "total_withdraw",
        "withdrawable_amount",
        "deposit_status",
        "identity_status",
        "contact_phone",
        "bank_account_id",
        "audit_status",
      ],
      removedFields: [],
    });
  }

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }

  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    return json(res, 503, {
      ok: false,
      message: "真实数据库未配置，陪玩管理修改未保存",
      requiredEnv: missing,
    });
  }

  return json(res, 501, {
    ok: false,
    message: "陪玩管理数据库适配器尚未接入",
  });
};
