const crypto = require("crypto");

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const ADMIN_ROLES = new Set(["super_admin", "finance_admin"]);

const CHANNELS = [
  { id: "tng", name: "Touch 'n Go", icon: "TNG", paymentType: "手动收款", category: "manual", currencies: ["MYR"], requiredManual: ["receiverName", "phone", "qrUrl"], requiredApi: [] },
  { id: "duitnow", name: "DuitNow QR", icon: "QR", paymentType: "手动收款", category: "manual", currencies: ["MYR"], requiredManual: ["receiverName", "duitnowId", "qrUrl"], requiredApi: [] },
  { id: "bank-my", name: "马来西亚银行转账", icon: "BANK", paymentType: "手动收款", category: "manual", currencies: ["MYR"], requiredManual: ["receiverName", "bankName", "bankAccount"], requiredApi: [] },
  { id: "alipay", name: "支付宝", icon: "ALI", paymentType: "手动收款 / API", category: "hybrid", currencies: ["CNY", "MYR"], requiredManual: ["receiverName", "alipayAccount", "qrUrl"], requiredApi: ["appId", "merchantId", "privateKey", "publicKey", "apiEndpoint"] },
  { id: "stripe", name: "Stripe", icon: "STR", paymentType: "API 在线支付", category: "api", currencies: ["MYR", "USD"], requiredManual: [], requiredApi: ["publishableKey", "secretKey", "webhookSecret"] },
  { id: "xendit", name: "Xendit", icon: "XEN", paymentType: "API 在线支付", category: "api", currencies: ["MYR", "IDR", "PHP", "USD"], requiredManual: [], requiredApi: ["publicApiKey", "secretApiKey", "callbackToken"] },
  { id: "hitpay", name: "HitPay", icon: "HIT", paymentType: "API 在线支付", category: "api", currencies: ["MYR", "SGD", "USD"], requiredManual: [], requiredApi: ["apiKey", "salt", "webhookSecret"] },
];

const TABLES = {
  channels: "payment_channels",
  credentials: "payment_channel_credentials",
  banks: "payment_bank_accounts",
  rates: "payment_exchange_rates",
  webhooks: "payment_webhooks",
  transactions: "payment_transactions",
  logs: "payment_operation_logs",
};

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function roleFrom(req) {
  return String(req.headers["x-mcj-admin-role"] || req.headers["x-user-role"] || "").trim();
}

function canManagePayment(req) {
  return ADMIN_ROLES.has(roleFrom(req));
}

function hasDatabaseConfig() {
  return REQUIRED_ENV.every((key) => process.env[key]);
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function endpoint(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function supabaseFetch(table, query = "", init = {}) {
  const response = await fetch(endpoint(table, query), {
    ...init,
    headers: supabaseHeaders(init.headers || {}),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const message = body?.message || body?.hint || body?.details || `数据库请求失败：${table}`;
    throw new Error(message);
  }
  return body;
}

async function upsert(table, rows) {
  return supabaseFetch(table, "?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
}

function defaults() {
  return CHANNELS.map((channel, index) => ({
    id: channel.id,
    channel_id: channel.id,
    name: channel.name,
    icon: channel.icon,
    payment_type: channel.paymentType,
    category: channel.category,
    currencies: channel.currencies,
    config_status: "未配置",
    mode: "test",
    enabled: false,
    visible: false,
    sort: index + 1,
    data: {
      adminLabel: channel.name,
      publicLabel: channel.name,
      minAmount: 10,
      maxAmount: 5000,
      fixedFee: 0,
      percentFee: 0,
      officialDashboardUrl: "",
      officialDocsUrl: "",
      instructions: "",
      manual: {},
      webhook: {},
    },
    test_result: null,
    updated_at: null,
    credential_status: "未配置",
    credential_keys: [],
  }));
}

function mergeChannels(rows = [], credentials = []) {
  const credentialMap = new Map(credentials.map((row) => [row.channel_id, row]));
  return defaults().map((base) => {
    const row = rows.find((item) => item.channel_id === base.channel_id || item.id === base.id);
    const credential = credentialMap.get(base.channel_id);
    return {
      ...base,
      ...(row || {}),
      data: { ...base.data, ...(row?.data || {}) },
      credential_status: credential?.credential_status || base.credential_status,
      credential_keys: credential?.credential_keys || base.credential_keys,
      has_credentials: Boolean(credential?.credential_status === "已配置"),
    };
  });
}

function encryptPayload(payload) {
  if (!process.env.PAYMENT_ENCRYPTION_KEY) {
    throw new Error("缺少 PAYMENT_ENCRYPTION_KEY，不能保存 API Secret / Private Key 等敏感密钥。");
  }
  const key = crypto.createHash("sha256").update(String(process.env.PAYMENT_ENCRYPTION_KEY)).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

function safeKeys(payload = {}) {
  return Object.keys(payload).filter((key) => String(payload[key] || "").trim());
}

function channelTemplate(id) {
  return CHANNELS.find((item) => item.id === id) || CHANNELS[0];
}

function computeStatus(channel, credentialKeys = []) {
  const tpl = channelTemplate(channel.channel_id || channel.id);
  const data = channel.data || {};
  const manual = data.manual || {};
  const apiMode = data.paymentMode === "api" || tpl.category === "api";
  const required = apiMode ? tpl.requiredApi : tpl.requiredManual;
  const source = apiMode ? Object.fromEntries((credentialKeys || []).map((key) => [key, "configured"])) : manual;
  const missing = required.filter((key) => !String(source[key] || "").trim());
  if (missing.length === required.length) return "未配置";
  if (missing.length) return "配置不完整";
  if (channel.test_result?.status === "success") return channel.enabled ? "已启用" : "测试通过";
  return apiMode ? "待测试" : (channel.enabled ? "已启用" : "已停用");
}

function testChannel(channel, credentialKeys = []) {
  const tpl = channelTemplate(channel.channel_id || channel.id);
  const data = channel.data || {};
  const manual = data.manual || {};
  const apiMode = data.paymentMode === "api" || tpl.category === "api";
  const required = apiMode ? tpl.requiredApi : tpl.requiredManual;
  const source = apiMode ? Object.fromEntries((credentialKeys || []).map((key) => [key, "configured"])) : manual;
  const missing = required.filter((key) => !String(source[key] || "").trim());
  const steps = [
    { label: "检查必填字段", ok: !missing.length, message: missing.length ? `缺少：${missing.join("、")}` : "必填字段已填写" },
    { label: "验证接口地址", ok: !apiMode || Boolean(data.apiEndpoint || data.testEndpoint || data.liveEndpoint), message: apiMode ? (data.apiEndpoint || data.testEndpoint || data.liveEndpoint ? "接口地址已填写" : "接口地址缺失") : "手动收款不需要接口地址" },
    { label: "验证商户身份", ok: !apiMode || credentialKeys.length > 0, message: apiMode ? (credentialKeys.length ? "密钥已保存为已配置状态" : "API 密钥未配置") : "手动收款无需商户接口验证" },
    { label: "验证 Webhook 配置", ok: !apiMode || Boolean(data.webhook?.successUrl || data.webhook?.paymentSuccessUrl), message: apiMode ? (data.webhook?.successUrl || data.webhook?.paymentSuccessUrl ? "Webhook 已填写" : "Webhook URL 缺失") : "手动收款无需 Webhook" },
  ];
  const failed = steps.find((step) => !step.ok);
  return {
    status: failed ? "failed" : "success",
    mode: channel.mode || "test",
    testedAt: new Date().toISOString(),
    responseTimeMs: 0,
    supportedCurrencies: channel.currencies || tpl.currencies,
    message: failed ? failed.message : "配置校验通过。未发起真实扣款。",
    steps,
  };
}

async function writeLog(req, action, targetId, beforeValue, afterValue) {
  try {
    await upsert(TABLES.logs, {
      id: `paylog-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      action,
      target_id: targetId,
      operator_role: roleFrom(req),
      ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "",
      device: req.headers["user-agent"] || "",
      before_value: beforeValue || null,
      after_value: afterValue || null,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Logs must not hide the main payment setting result.
  }
}

async function loadState() {
  const [channels, credentials, banks, rates, webhooks, transactions, logs] = await Promise.all([
    supabaseFetch(TABLES.channels, "?order=sort.asc,updated_at.desc"),
    supabaseFetch(TABLES.credentials, "?select=id,channel_id,credential_status,credential_keys,updated_at"),
    supabaseFetch(TABLES.banks, "?order=updated_at.desc"),
    supabaseFetch(TABLES.rates, "?order=updated_at.desc"),
    supabaseFetch(TABLES.webhooks, "?order=updated_at.desc"),
    supabaseFetch(TABLES.transactions, "?order=created_at.desc&limit=100"),
    supabaseFetch(TABLES.logs, "?order=created_at.desc&limit=100"),
  ]);
  return { channels: mergeChannels(channels, credentials), banks, rates, webhooks, transactions, logs };
}

async function handler(req, res) {
  if (!canManagePayment(req)) {
    return json(res, 403, { ok: false, message: "没有支付设置权限。仅超级管理员和财务管理员可访问。" });
  }

  if (!hasDatabaseConfig()) {
    return json(res, req.method === "GET" ? 200 : 503, {
      ok: req.method === "GET",
      configured: false,
      channels: defaults(),
      banks: [],
      rates: [],
      webhooks: [],
      transactions: [],
      logs: [],
      message: "未配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，支付资料没有写入本地或 localStorage。",
      requiredEnv: REQUIRED_ENV,
      requiredTables: Object.values(TABLES),
    });
  }

  try {
    if (req.method === "GET") {
      const state = await loadState();
      return json(res, 200, { ok: true, configured: true, ...state, templates: CHANNELS });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const body = await readBody(req);
    const action = String(body.action || "");

    if (action === "save_channel") {
      const input = body.channel || {};
      const tpl = channelTemplate(input.channel_id || input.id);
      const credentialInput = input.credentials || {};
      const credentialKeys = safeKeys(credentialInput);
      const channel = {
        id: tpl.id,
        channel_id: tpl.id,
        name: String(input.name || tpl.name),
        icon: String(input.icon || tpl.icon),
        payment_type: String(input.payment_type || tpl.paymentType),
        category: String(input.category || tpl.category),
        currencies: input.currencies || tpl.currencies,
        mode: input.mode === "live" ? "live" : "test",
        enabled: Boolean(input.enabled),
        visible: Boolean(input.visible),
        sort: Number(input.sort || 100),
        data: input.data || {},
        updated_at: new Date().toISOString(),
      };
      channel.config_status = computeStatus(channel, credentialKeys);
      const rows = await upsert(TABLES.channels, channel);
      if (credentialKeys.length) {
        await upsert(TABLES.credentials, {
          id: `cred-${tpl.id}`,
          channel_id: tpl.id,
          credential_status: "已配置",
          credential_keys: credentialKeys,
          encrypted_payload: encryptPayload(credentialInput),
          updated_at: new Date().toISOString(),
        });
      }
      await writeLog(req, "save_channel", tpl.id, null, { ...channel, credentials: credentialKeys });
      return json(res, 200, { ok: true, message: "支付渠道配置已保存", channel: rows?.[0] || channel });
    }

    if (action === "test_channel") {
      const id = String(body.channelId || "");
      const state = await loadState();
      const channel = state.channels.find((item) => item.channel_id === id || item.id === id);
      if (!channel) return json(res, 404, { ok: false, message: "支付渠道不存在" });
      const result = testChannel(channel, channel.credential_keys || []);
      const next = { ...channel, test_result: result, updated_at: new Date().toISOString() };
      next.config_status = result.status === "success" ? "测试通过" : "配置异常";
      await upsert(TABLES.channels, next);
      await writeLog(req, "test_channel", id, null, { status: result.status, message: result.message });
      return json(res, 200, { ok: true, message: result.status === "success" ? "测试通过" : "测试失败", result });
    }

    if (action === "toggle_channel") {
      const id = String(body.channelId || "");
      const enabled = Boolean(body.enabled);
      const state = await loadState();
      const channel = state.channels.find((item) => item.channel_id === id || item.id === id);
      if (!channel) return json(res, 404, { ok: false, message: "支付渠道不存在" });
      if (enabled && channel.test_result?.status !== "success") {
        return json(res, 400, { ok: false, message: "未测试通过，不能启用正式支付渠道。" });
      }
      const next = { ...channel, enabled, visible: enabled ? channel.visible : false, config_status: enabled ? "已启用" : "已停用", updated_at: new Date().toISOString() };
      await upsert(TABLES.channels, next);
      await writeLog(req, enabled ? "enable_channel" : "disable_channel", id, channel, next);
      return json(res, 200, { ok: true, message: enabled ? "支付渠道已启用" : "支付渠道已停用", channel: next });
    }

    if (action === "save_bank") {
      const bank = body.bank || {};
      const row = {
        id: bank.id || `bank-${Date.now()}`,
        bank_name: String(bank.bankName || ""),
        account_name: String(bank.accountName || ""),
        enterprise_name: String(bank.enterpriseName || ""),
        account_number_mask: String(bank.accountNumber || "").replace(/\s+/g, "").replace(/^(.+)(.{4})$/, "**** $2"),
        encrypted_payload: encryptPayload({ accountNumber: bank.accountNumber || "", swift: bank.swift || "" }),
        currency: String(bank.currency || "MYR"),
        usage: String(bank.usage || "充值收款"),
        is_default: Boolean(bank.isDefault),
        enabled: bank.enabled !== false,
        updated_at: new Date().toISOString(),
      };
      const rows = await upsert(TABLES.banks, row);
      await writeLog(req, "save_bank", row.id, null, { ...row, encrypted_payload: "[encrypted]" });
      return json(res, 200, { ok: true, message: "银行账户已保存", bank: rows?.[0] || row });
    }

    if (action === "save_rate") {
      const rate = body.rate || {};
      const current = Number(rate.auto ? rate.apiRate : rate.manualRate) || 0;
      const markup = Number(rate.markup || 0);
      const row = {
        id: `${rate.base || "MYR"}-${rate.target || "CNY"}`,
        base_currency: String(rate.base || "MYR"),
        target_currency: String(rate.target || "CNY"),
        api_rate: Number(rate.apiRate || 0),
        manual_rate: Number(rate.manualRate || 0),
        auto_update: Boolean(rate.auto),
        markup_percent: markup,
        final_rate: current ? Number((current * (1 + markup / 100)).toFixed(6)) : 0,
        updated_at: new Date().toISOString(),
      };
      const rows = await upsert(TABLES.rates, row);
      await writeLog(req, "save_rate", row.id, null, row);
      return json(res, 200, { ok: true, message: "汇率设置已保存", rate: rows?.[0] || row });
    }

    if (action === "save_webhook") {
      const webhook = body.webhook || {};
      const row = {
        id: webhook.id || `webhook-${Date.now()}`,
        event_name: String(webhook.eventName || ""),
        webhook_url: String(webhook.webhookUrl || ""),
        secret_status: webhook.secret ? "已配置" : "未配置",
        encrypted_secret: webhook.secret ? encryptPayload({ secret: webhook.secret }) : null,
        enabled: Boolean(webhook.enabled),
        last_status: "未测试",
        updated_at: new Date().toISOString(),
      };
      const rows = await upsert(TABLES.webhooks, row);
      await writeLog(req, "save_webhook", row.id, null, { ...row, encrypted_secret: row.encrypted_secret ? "[encrypted]" : null });
      return json(res, 200, { ok: true, message: "Webhook 已保存", webhook: rows?.[0] || row });
    }

    if (action === "test_webhook") {
      return json(res, 200, {
        ok: true,
        message: "Webhook 测试事件已生成。当前接口只做测试事件校验，不会修改订单或猫粮余额。",
        result: { status: "test_only", testedAt: new Date().toISOString(), statusCode: null },
      });
    }

    return json(res, 400, { ok: false, message: "未知支付设置操作" });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "支付设置接口异常" });
  }
}

module.exports = handler;
