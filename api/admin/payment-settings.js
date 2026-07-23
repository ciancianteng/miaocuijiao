const CHANNELS = [
  "Touch 'n Go",
  "DuitNow QR",
  "马来西亚银行转账",
  "支付宝",
  "微信支付",
  "Stripe",
  "Xendit",
  "HitPay",
];

const TABLES = [
  "payment_channels",
  "payment_channel_credentials",
  "payment_bank_accounts",
  "payment_qr_codes",
  "payment_exchange_rates",
  "payment_webhooks",
  "payment_webhook_logs",
  "payment_transactions",
  "payment_operation_logs",
];

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function roleFrom(req) {
  return req.headers["x-mcj-admin-role"] || req.headers["x-user-role"] || "";
}

function canManagePayment(req) {
  const role = roleFrom(req);
  return role === "super_admin" || role === "finance_admin";
}

module.exports = async function handler(req, res) {
  if (!canManagePayment(req)) {
    return json(res, 403, { ok: false, message: "没有支付设置权限" });
  }

  if (req.method === "GET") {
    return json(res, 200, {
      ok: true,
      channels: CHANNELS.map((name) => ({ name, status: "未配置", enabled: false })),
      tables: TABLES,
      message: "支付设置接口已建立，等待连接加密数据库后启用保存。",
    });
  }

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }

  if (!process.env.PAYMENT_DATABASE_URL || !process.env.PAYMENT_ENCRYPTION_KEY) {
    return json(res, 503, {
      ok: false,
      message: "支付安全数据库或加密密钥未配置，未保存任何支付资料",
      requiredEnv: ["PAYMENT_DATABASE_URL", "PAYMENT_ENCRYPTION_KEY"],
    });
  }

  return json(res, 501, {
    ok: false,
    message: "支付安全持久化适配器尚未接入",
  });
};
