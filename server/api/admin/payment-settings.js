import crypto from "node:crypto";
import { loadLocalEnv } from "../_load-env.js";

loadLocalEnv();

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const ADMIN_ROLES = new Set(["super_admin", "finance_admin", "admin"]);

/** Channels required for launch Payment Settings. */
const CHANNELS = [
  {
    id: "hitpay",
    name: "HitPay",
    icon: "HIT",
    paymentType: "API 在线支付",
    category: "api",
    currencies: ["MYR", "SGD", "USD"],
    requiredApi: ["apiKey", "apiSecret", "webhookSecret"],
    optionalApi: ["merchantId"],
    testEndpoint: { live: "https://api.hit-pay.com/v1", test: "https://api.sandbox.hit-pay.com/v1" },
  },
  {
    id: "toyyibpay",
    name: "ToyyibPay",
    icon: "TOY",
    paymentType: "API 在线支付",
    category: "api",
    currencies: ["MYR"],
    requiredApi: ["apiKey", "apiSecret", "webhookSecret"],
    optionalApi: ["merchantId"],
    testEndpoint: { live: "https://toyyibpay.com", test: "https://dev.toyyibpay.com" },
  },
  {
    id: "stripe",
    name: "Stripe",
    icon: "STR",
    paymentType: "API 在线支付",
    category: "api",
    currencies: ["MYR", "USD"],
    requiredApi: ["apiKey", "apiSecret", "webhookSecret"],
    optionalApi: ["merchantId"],
    testEndpoint: { live: "https://api.stripe.com", test: "https://api.stripe.com" },
  },
  {
    id: "duitnow",
    name: "DuitNow",
    icon: "QR",
    paymentType: "手动收款 / QR",
    category: "manual",
    currencies: ["MYR"],
    // Must match boss listBossPaymentMethods / manualUsable: DuitNow needs QR to be order-visible.
    requiredManual: ["receiverName", "duitnowId", "qrUrl"],
    requiredApi: [],
  },
  {
    id: "tng",
    name: "TNG",
    icon: "TNG",
    paymentType: "手动收款",
    category: "manual",
    currencies: ["MYR"],
    // Boss accepts phone OR qrUrl; require at least one via toggle check below.
    requiredManual: ["receiverName"],
    requiredApi: [],
  },
  {
    id: "bank-transfer",
    name: "银行转账",
    icon: "BANK",
    paymentType: "银行转账",
    category: "manual",
    currencies: ["MYR"],
    requiredManual: ["receiverName", "bankName", "bankAccount"],
    requiredApi: [],
  },
];

/** Selectable收款渠道 providers for the bank/e-wallet CRUD list (payment_bank_accounts). */
const BANK_PROVIDERS = [
  "Maybank",
  "CIMB",
  "Public Bank",
  "OCBC",
  "RHB",
  "Touch 'n Go",
  "支付宝",
  "微信支付",
  "USDT",
  "其他",
];
const PLATFORM_BANKS_KEY = "paymentBankAccounts";

const TABLES = {
  channels: "payment_channels",
  credentials: "payment_channel_credentials",
  banks: "payment_bank_accounts",
  rates: "payment_exchange_rates",
  webhooks: "payment_webhooks",
  transactions: "payment_transactions",
  logs: "payment_operation_logs",
  methods: "payment_methods",
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
  return false; // replaced by JWT requireAdmin below
}

async function assertPaymentAdmin(req) {
  const { requireAdmin } = await import("../_admin-auth.js");
  return requireAdmin(req, { allowRoles: ADMIN_ROLES });
}

function hasDatabaseConfig() {
  return REQUIRED_ENV.every((key) => process.env[key]);
}

function encryptionKeyMaterial() {
  return (
    process.env.PAYMENT_ENCRYPTION_KEY ||
    process.env.PLATFORM_SECRETS_ENCRYPTION_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  );
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
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
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message = body?.message || body?.hint || body?.details || `数据库请求失败：${table}`;
    const err = new Error(message);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

function isMissingTable(error) {
  const msg = String(error?.message || error?.body?.message || "");
  return /relation|does not exist|Could not find the table|schema cache/i.test(msg);
}

async function readPlatformBanks() {
  try {
    const rows = await supabaseFetch("platform_settings", "?id=eq.global&select=id,data&limit=1");
    const data = Array.isArray(rows) ? rows[0]?.data : rows?.data;
    const list = data?.[PLATFORM_BANKS_KEY];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writePlatformBanks(banks = []) {
  const rows = await supabaseFetch("platform_settings", "?id=eq.global&select=id,data&limit=1").catch(() => []);
  const current = Array.isArray(rows) ? rows[0] : null;
  const data = { ...(current?.data && typeof current.data === "object" ? current.data : {}), [PLATFORM_BANKS_KEY]: banks };
  if (current?.id) {
    await supabaseFetch("platform_settings", `?id=eq.${encodeURIComponent(current.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
    });
  } else {
    await supabaseFetch("platform_settings", "", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify([{ id: "global", data, updated_at: new Date().toISOString() }]),
    });
  }
  return banks;
}

const PLATFORM_PAYMENT_BUCKET = "platform-payment";

async function syncChannelPublicConfig(channelId, patch = {}) {
  const rows = await supabaseFetch("platform_settings", "?id=eq.global&select=id,data&limit=1").catch(() => []);
  const current = Array.isArray(rows) ? rows[0] : null;
  const data = current?.data && typeof current.data === "object" ? { ...current.data } : {};
  const publicMap =
    data.paymentChannelsPublic && typeof data.paymentChannelsPublic === "object"
      ? { ...data.paymentChannelsPublic }
      : {};
  const prev = publicMap[channelId] && typeof publicMap[channelId] === "object" ? publicMap[channelId] : {};
  const next = {
    ...prev,
    ...patch,
  };
  if (patch.qrUrl !== undefined) next.qrUrl = String(patch.qrUrl || "").trim();
  if (patch.manual && typeof patch.manual === "object") {
    next.manual = { ...(prev.manual && typeof prev.manual === "object" ? prev.manual : {}), ...patch.manual };
  }
  publicMap[channelId] = next;
  data.paymentChannelsPublic = publicMap;
  const payload = { id: "global", data, updated_at: new Date().toISOString() };
  if (current?.id) {
    await supabaseFetch("platform_settings", `?id=eq.${encodeURIComponent(current.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ data: payload.data, updated_at: payload.updated_at }),
    });
  } else {
    await supabaseFetch("platform_settings", "", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify([payload]),
    });
  }
  return publicMap[channelId];
}

/** @deprecated use syncChannelPublicConfig */
async function syncChannelQrToPlatformSettings(channelId, qrUrl, extras = {}) {
  return syncChannelPublicConfig(channelId, { ...extras, qrUrl: String(qrUrl || "").trim() });
}

function publicConfigFromChannel(channel = {}, data = {}, qrUrl = "") {
  const manual = data.manual && typeof data.manual === "object" ? data.manual : {};
  const forOrder = data.forOrder != null ? data.forOrder !== false : true;
  const forRecharge = data.forRecharge != null ? data.forRecharge !== false : true;
  return {
    enabled: channel.enabled !== false,
    visible: channel.visible !== false,
    forOrder,
    forRecharge,
    publicLabel: data.publicLabel || channel.name || "",
    bankName: manual.bankName || "",
    accountName: manual.receiverName || "",
    receiverName: manual.receiverName || "",
    bankAccount: manual.bankAccount || "",
    phone: manual.phone || "",
    duitnowId: manual.duitnowId || "",
    qrUrl: String(qrUrl || manual.qrUrl || data.qrUrl || "").trim(),
    instructions: data.instructions || "",
    minAmount: data.minAmount,
    maxAmount: data.maxAmount,
    mode: channel.mode || "test",
    manual: {
      receiverName: manual.receiverName || "",
      bankName: manual.bankName || "",
      bankAccount: manual.bankAccount || "",
      phone: manual.phone || "",
      duitnowId: manual.duitnowId || "",
      qrUrl: String(qrUrl || manual.qrUrl || data.qrUrl || "").trim(),
    },
  };
}

async function uploadPlatformPayQrImage(dataUrl, channelId) {
  const {
    decodeDataUrl,
    assertImageUpload,
    ensurePublicBucket,
    publicObjectUrl,
  } = await import("../_companion-media-store.js");
  const decoded = assertImageUpload(decodeDataUrl(dataUrl));
  await ensurePublicBucket(PLATFORM_PAYMENT_BUCKET, ["image/jpeg", "image/png", "image/webp"]);
  const mime = String(decoded.contentType || "image/png").toLowerCase();
  const ext = mime.includes("webp") ? "webp" : mime.includes("png") ? "png" : "jpg";
  const safeId = String(channelId || "duitnow")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "duitnow";
  // Fixed path so re-upload overwrites the previous QR for this channel.
  const objectPath = `qr/${safeId}.${ext}`;
  const response = await fetch(
    `${process.env.SUPABASE_URL}/storage/v1/object/${PLATFORM_PAYMENT_BUCKET}/${objectPath}`,
    {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": decoded.contentType || "image/png",
        "x-upsert": "true",
      },
      body: decoded.buffer,
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(`二维码上传失败：${text || response.status}`), { status: 502 });
  }
  // Cache-bust so payment page refreshes immediately after overwrite.
  const base = publicObjectUrl(PLATFORM_PAYMENT_BUCKET, objectPath);
  return `${base}${base.includes("?") ? "&" : "?"}v=${Date.now()}`;
}

/** Current QR actually served on boss payment page (enabled + qrUrl). */
async function resolveActivePublicQr() {
  try {
    // Admin preview only — first enabled channel with QR. Boss order pay uses loadPlatformPayQr(method).
    const { loadAdminPreviewPayQr } = await import("../_platform-pay-qr.js");
    const info = await loadAdminPreviewPayQr();
    if (!info || !info.qrUrl || info.enabled === false) {
      return {
        available: false,
        qrUrl: "",
        channelId: "",
        title: "平台收款",
        instructions: "支付通道暂不可用",
        source: info?.source || "empty",
      };
    }
    return {
      available: true,
      qrUrl: info.qrUrl,
      channelId: info.channelId || "",
      title: info.title || "平台收款",
      receiverName: info.receiverName || "",
      bankName: info.bankName || "",
      instructions: info.instructions || "",
      source: info.source || "payment_channels",
      updatedHint: "老板支付页刷新后立即使用此二维码（无需重新部署）",
    };
  } catch (err) {
    return {
      available: false,
      qrUrl: "",
      channelId: "",
      title: "平台收款",
      instructions: "支付通道暂不可用",
      source: "error",
      error: String(err?.message || err).slice(0, 160),
    };
  }
}

async function persistChannelQrUrl(channelId, qrUrl) {
  const tpl = channelTemplate(channelId);
  let existing = null;
  try {
    const rows = await supabaseFetch(
      TABLES.channels,
      `?channel_id=eq.${encodeURIComponent(tpl.id)}&select=*&limit=1`
    );
    existing = Array.isArray(rows) ? rows[0] : null;
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  const prevData = existing?.data && typeof existing.data === "object" ? existing.data : {};
  const prevManual = prevData.manual && typeof prevData.manual === "object" ? prevData.manual : {};
  const nextData = {
    ...prevData,
    qrUrl,
    manual: { ...prevManual, qrUrl },
  };
  const row = {
    id: tpl.id,
    channel_id: tpl.id,
    name: existing?.name || tpl.name,
    icon: existing?.icon || tpl.icon,
    payment_type: existing?.payment_type || tpl.paymentType,
    category: existing?.category || tpl.category,
    currencies: existing?.currencies || tpl.currencies,
    mode: existing?.mode === "live" ? "live" : "test",
    // Uploading a live QR implies this channel should be the active payment source.
    enabled: true,
    visible: true,
    sort: existing?.sort != null ? Number(existing.sort) : CHANNELS.findIndex((c) => c.id === tpl.id) + 1,
    data: nextData,
    config_status: "已启用",
    updated_at: new Date().toISOString(),
  };
  try {
    await upsert(TABLES.channels, channelDbRow(row));
  } catch (error) {
    if (isMissingTable(error)) {
      // Fall back to platform_settings only.
      await syncChannelPublicConfig(tpl.id, {
        enabled: true,
        visible: true,
        publicLabel: tpl.name,
        qrUrl,
        manual: { qrUrl },
      });
      return { channel: null, qrUrl, source: "platform_settings" };
    }
    throw error;
  }
  await syncChannelPublicConfig(tpl.id, {
    ...publicConfigFromChannel(row, nextData, qrUrl),
    enabled: row.enabled !== false,
    publicLabel: nextData.publicLabel || tpl.name,
  });
  return { channel: row, qrUrl, source: "payment_channels" };
}

async function upsert(table, rows, onConflict = "id") {
  return supabaseFetch(table, `?on_conflict=${encodeURIComponent(onConflict)}`, {
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
      instructions: "",
      manual: {},
      webhook: {},
      testEndpoint: channel.testEndpoint?.test || "",
      liveEndpoint: channel.testEndpoint?.live || "",
    },
    test_result: null,
    updated_at: null,
    credential_status: "未配置",
    credential_keys: [],
    has_credentials: false,
    required_fields: channel.category === "api" ? channel.requiredApi : channel.requiredManual,
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
      required_fields: base.required_fields,
    };
  });
}

async function readPaymentChannelsPublic() {
  try {
    const rows = await supabaseFetch("platform_settings", "?id=eq.global&select=id,data&limit=1");
    const data = Array.isArray(rows) ? rows[0]?.data : rows?.data;
    const map = data?.paymentChannelsPublic;
    return map && typeof map === "object" ? map : {};
  } catch {
    return {};
  }
}

/** Overlay QR / manual fields from platform_settings when payment_channels table is incomplete. */
function applyPublicPayOverlay(channels = [], publicMap = {}) {
  return (channels || []).map((ch) => {
    const id = ch.channel_id || ch.id;
    const pub = publicMap[id] || publicMap[id === "bank-transfer" ? "bank-my" : ""] || null;
    if (!pub || typeof pub !== "object") {
      const data0 = ch.data && typeof ch.data === "object" ? ch.data : {};
      return {
        ...ch,
        forOrder: data0.forOrder != null ? data0.forOrder !== false : true,
        forRecharge: data0.forRecharge != null ? data0.forRecharge !== false : true,
      };
    }
    const data = ch.data && typeof ch.data === "object" ? { ...ch.data } : {};
    const manual = data.manual && typeof data.manual === "object" ? { ...data.manual } : {};
    const pubManual = pub.manual && typeof pub.manual === "object" ? pub.manual : {};
    const qrUrl = String(manual.qrUrl || data.qrUrl || pubManual.qrUrl || pub.qrUrl || "").trim();
    if (qrUrl) {
      manual.qrUrl = qrUrl;
      data.qrUrl = qrUrl;
    }
    const receiverName = manual.receiverName || pubManual.receiverName || pub.accountName || pub.receiverName || "";
    const bankName = manual.bankName || pubManual.bankName || pub.bankName || "";
    const bankAccount = manual.bankAccount || pubManual.bankAccount || pub.bankAccount || "";
    const phone = manual.phone || pubManual.phone || pub.phone || "";
    const duitnowId = manual.duitnowId || pubManual.duitnowId || pub.duitnowId || "";
    if (receiverName) manual.receiverName = receiverName;
    if (bankName) manual.bankName = bankName;
    if (bankAccount) manual.bankAccount = bankAccount;
    if (phone) manual.phone = phone;
    if (duitnowId) manual.duitnowId = duitnowId;
    if (pub.publicLabel && !data.publicLabel) data.publicLabel = pub.publicLabel;
    if (pub.instructions != null && pub.instructions !== "" && !data.instructions) data.instructions = pub.instructions;
    if (pub.minAmount != null && data.minAmount == null) data.minAmount = pub.minAmount;
    if (pub.maxAmount != null && data.maxAmount == null) data.maxAmount = pub.maxAmount;
    if (pub.forOrder != null && data.forOrder == null) data.forOrder = pub.forOrder !== false;
    if (pub.forRecharge != null && data.forRecharge == null) data.forRecharge = pub.forRecharge !== false;
    data.manual = manual;
    // SoT: payment_channels.enabled / visible are separate. Do not invent a collapsed
    // "enabled" that disagrees with boss listBossPaymentMethods.
    const enabled = ch.enabled === true || ch.enabled === "true" || ch.enabled === 1;
    const visible = ch.visible !== false && ch.visible !== "false" && ch.visible !== 0;
    const configured = bossManualConfigured(id, { ...manual, qrUrl, phone, bankAccount, receiverName, duitnowId }, ch.category);
    const forOrder = data.forOrder != null ? data.forOrder !== false : true;
    const forRecharge = data.forRecharge != null ? data.forRecharge !== false : true;
    return {
      ...ch,
      enabled,
      visible,
      forOrder,
      forRecharge,
      configured,
      bossOrderOpen: !!(enabled && visible && configured && forOrder),
      bossRechargeOpen: !!(enabled && visible && configured && forRecharge),
      mode: ch.mode || pub.mode || "test",
      data,
      config_status: configured ? (enabled && visible ? "已启用" : "已配置") : ch.config_status || "未配置",
    };
  });
}

/** Same usability rules as server/api/_platform-pay-qr.js manualUsable / API key gate. */
function bossManualConfigured(channelId, manual = {}, category = "manual") {
  const id = String(channelId || "").toLowerCase();
  const m = manual || {};
  if (category === "api") return false; // API uses credentials; filled later in enrich
  if (id === "duitnow") return Boolean(String(m.qrUrl || "").trim());
  if (id === "tng") return Boolean(String(m.phone || "").trim() || String(m.qrUrl || "").trim());
  if (id === "bank-transfer" || id === "bank-my") {
    return Boolean(String(m.bankAccount || "").trim() && String(m.receiverName || "").trim()) || Boolean(String(m.qrUrl || "").trim());
  }
  if (id === "alipay") return Boolean(String(m.qrUrl || "").trim());
  return Boolean(String(m.qrUrl || m.bankAccount || m.phone || m.duitnowId || "").trim());
}

/** Strip UI-only fields before writing payment_channels. */
function channelDbRow(channel) {
  return {
    id: channel.id || channel.channel_id,
    channel_id: channel.channel_id || channel.id,
    name: channel.name || "",
    icon: channel.icon || "",
    payment_type: channel.payment_type || "",
    category: channel.category || "api",
    currencies: channel.currencies || [],
    config_status: channel.config_status || "未配置",
    mode: channel.mode === "live" ? "live" : "test",
    enabled: Boolean(channel.enabled),
    visible: Boolean(channel.visible),
    sort: Number(channel.sort || 100),
    data: channel.data || {},
    test_result: channel.test_result || null,
    updated_at: channel.updated_at || new Date().toISOString(),
  };
}

function encryptPayload(payload) {
  const material = encryptionKeyMaterial();
  if (!material) {
    throw new Error("缺少 PAYMENT_ENCRYPTION_KEY（或 PLATFORM_SECRETS_ENCRYPTION_KEY），不能保存 API Secret。");
  }
  const key = crypto.createHash("sha256").update(String(material)).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

function decryptPayload(blob) {
  if (!blob) return {};
  const material = encryptionKeyMaterial();
  if (!material) return {};
  const [ivB64, tagB64, dataB64] = String(blob).split(".");
  if (!ivB64 || !tagB64 || !dataB64) return {};
  const key = crypto.createHash("sha256").update(String(material)).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(plain);
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
  const apiMode = tpl.category === "api";
  const required = apiMode ? tpl.requiredApi || [] : tpl.requiredManual || [];
  const source = apiMode
    ? Object.fromEntries((credentialKeys || []).map((key) => [key, "configured"]))
    : manual;
  const missing = required.filter((key) => !String(source[key] || "").trim());
  if (!required.length) return channel.enabled ? "已启用" : "已停用";
  if (missing.length === required.length) return "未配置";
  if (missing.length) return "配置不完整";
  if (channel.test_result?.status === "success") return channel.enabled ? "已启用" : "测试通过";
  return apiMode ? "待测试" : channel.enabled ? "已启用" : "已停用";
}

async function loadCredentialPayload(channelId) {
  try {
    const rows = await supabaseFetch(
      TABLES.credentials,
      `?channel_id=eq.${encodeURIComponent(channelId)}&select=encrypted_payload,credential_keys&limit=1`
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row?.encrypted_payload) return {};
    return decryptPayload(row.encrypted_payload);
  } catch {
    return {};
  }
}

async function probeApiChannel(tpl, channel, credentials) {
  const mode = channel.mode === "live" ? "live" : "test";
  const secret = String(credentials.apiSecret || credentials.secretKey || "").trim();
  const apiKey = String(credentials.apiKey || credentials.publishableKey || "").trim();
  if (!secret && !apiKey) {
    return { ok: false, message: "缺少 API Key / API Secret，无法测试连接。" };
  }

  if (tpl.id === "stripe") {
    const key = secret || apiKey;
    const response = await fetch("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!response.ok) {
      return {
        ok: false,
        message: body?.error?.message || `Stripe 连接失败 (HTTP ${response.status})`,
      };
    }
    return { ok: true, message: "连接成功。Stripe 余额接口可访问。" };
  }

  if (tpl.id === "hitpay") {
    const base = mode === "live" ? tpl.testEndpoint.live : tpl.testEndpoint.test;
    const response = await fetch(`${base}/payment-requests?page=1&limit=1`, {
      headers: {
        "X-BUSINESS-API-KEY": apiKey || secret,
        "Content-Type": "application/json",
      },
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: `HitPay 鉴权失败 (HTTP ${response.status})，请检查 API Key。` };
    }
    if (!response.ok && response.status !== 404) {
      const text = await response.text();
      return { ok: false, message: text?.slice?.(0, 180) || `HitPay 连接失败 (HTTP ${response.status})` };
    }
    return { ok: true, message: "连接成功。HitPay API 可访问。" };
  }

  if (tpl.id === "toyyibpay") {
    const base = mode === "live" ? tpl.testEndpoint.live : tpl.testEndpoint.test;
    const response = await fetch(`${base}/index.php/api/getBank`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ userSecretKey: secret || apiKey }).toString(),
    });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, message: `ToyyibPay 连接失败 (HTTP ${response.status})` };
    }
    if (/invalid|error|fail/i.test(text) && !/\[/.test(text)) {
      return { ok: false, message: `ToyyibPay 返回错误：${text.slice(0, 160)}` };
    }
    return { ok: true, message: "连接成功。ToyyibPay 接口可访问。" };
  }

  return { ok: true, message: "连接成功。配置校验通过。" };
}

async function testChannel(channel) {
  const tpl = channelTemplate(channel.channel_id || channel.id);
  const data = channel.data || {};
  const manual = data.manual || {};
  const apiMode = tpl.category === "api";
  const required = apiMode ? tpl.requiredApi || [] : tpl.requiredManual || [];
  const credentials = apiMode ? await loadCredentialPayload(tpl.id) : {};
  const source = apiMode ? credentials : manual;
  const missing = required.filter((key) => !String(source[key] || "").trim());
  const steps = [
    {
      label: "检查必填字段",
      ok: !missing.length,
      message: missing.length ? `缺少：${missing.join("、")}` : "必填字段已填写",
    },
  ];

  if (missing.length) {
    return {
      status: "failed",
      mode: channel.mode || "test",
      testedAt: new Date().toISOString(),
      message: `测试失败：缺少 ${missing.join("、")}`,
      steps,
    };
  }

  if (apiMode) {
    try {
      const probe = await probeApiChannel(tpl, channel, credentials);
      steps.push({ label: "第三方接口连通", ok: probe.ok, message: probe.message });
      return {
        status: probe.ok ? "success" : "failed",
        mode: channel.mode || "test",
        testedAt: new Date().toISOString(),
        message: probe.ok ? "连接成功。" : probe.message,
        steps,
      };
    } catch (error) {
      return {
        status: "failed",
        mode: channel.mode || "test",
        testedAt: new Date().toISOString(),
        message: error.message || "测试连接异常",
        steps: steps.concat([{ label: "第三方接口连通", ok: false, message: error.message || "请求失败" }]),
      };
    }
  }

  steps.push({ label: "手动收款资料", ok: true, message: "收款资料已填写" });
  return {
    status: "success",
    mode: channel.mode || "test",
    testedAt: new Date().toISOString(),
    message: "连接成功。手动收款配置校验通过。",
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
    /* ignore */
  }
}

async function syncPaymentMethod(channel, credentials = {}) {
  const tpl = channelTemplate(channel.channel_id || channel.id);
  const mode = channel.mode === "live" ? "live" : "test";
  const endpointBase =
    mode === "live"
      ? channel.data?.liveEndpoint || tpl.testEndpoint?.live || ""
      : channel.data?.testEndpoint || tpl.testEndpoint?.test || "";
  const row = {
    code: tpl.id,
    name: channel.name || tpl.name,
    is_enabled: Boolean(channel.enabled),
    sort_order: Number(channel.sort || 100),
    mode,
    category: tpl.category,
    api_base_url: String(endpointBase || ""),
    merchant_id: String(credentials.merchantId || ""),
    api_key: String(credentials.apiKey || credentials.publishableKey || ""),
    api_secret: String(credentials.apiSecret || credentials.secretKey || ""),
    callback_secret: String(credentials.webhookSecret || credentials.callbackToken || ""),
    redirect_url: String(channel.data?.webhook?.successUrl || ""),
    callback_url: String(channel.data?.webhook?.callbackUrl || ""),
    updated_at: new Date().toISOString(),
  };
  try {
    await upsert(TABLES.methods, row, "code");
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
}

async function loadState() {
  try {
    const [channels, credentials, banks, rates, webhooks, transactions, logs, publicMap] = await Promise.all([
      supabaseFetch(TABLES.channels, "?order=sort.asc,updated_at.desc"),
      supabaseFetch(TABLES.credentials, "?select=id,channel_id,credential_status,credential_keys,updated_at"),
      supabaseFetch(TABLES.banks, "?order=updated_at.desc").catch(() => null),
      supabaseFetch(TABLES.rates, "?order=updated_at.desc").catch(() => []),
      supabaseFetch(TABLES.webhooks, "?order=updated_at.desc").catch(() => []),
      supabaseFetch(TABLES.transactions, "?order=created_at.desc&limit=100").catch(() => []),
      supabaseFetch(TABLES.logs, "?order=created_at.desc&limit=100").catch(() => []),
      readPaymentChannelsPublic(),
    ]);
    let bankRows = banks;
    let bankSource = "table";
    if (bankRows == null) {
      bankRows = await readPlatformBanks();
      bankSource = "platform_settings";
    }
    return {
      channels: applyPublicPayOverlay(mergeChannels(channels, credentials), publicMap),
      banks: bankRows || [],
      rates: rates || [],
      webhooks: webhooks || [],
      transactions: transactions || [],
      logs: logs || [],
      tablesReady: true,
      bankSource,
    };
  } catch (error) {
    if (isMissingTable(error)) {
      const [banks, publicMap] = await Promise.all([readPlatformBanks(), readPaymentChannelsPublic()]);
      return {
        channels: applyPublicPayOverlay(defaults(), publicMap),
        banks,
        rates: [],
        webhooks: [],
        transactions: [],
        logs: [],
        tablesReady: true,
        bankSource: "platform_settings",
        message: banks.length
          ? "支付渠道表未建全；收款账户 / 二维码已使用 platform_settings 兜底存储。"
          : "支付渠道表未建全；收款账户 / 二维码将写入 platform_settings 兜底存储。",
      };
    }
    throw error;
  }
}

async function handler(req, res) {
  try {
    await assertPaymentAdmin(req);
  } catch (err) {
    return json(res, err.status || 403, {
      ok: false,
      message: err.message || "没有支付设置权限。仅管理员 / 超级管理员 / 财务管理员可访问。",
    });
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
      message: "未配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY。",
      templates: CHANNELS,
      bankProviders: BANK_PROVIDERS,
    });
  }

  try {
    if (req.method === "GET") {
      const state = await loadState();
      const activePublicQr = await resolveActivePublicQr();
      // Enrich with the SAME open flags boss /api/recharge uses (no separate criteria).
      let bossOrderCodes = [];
      let bossRechargeCodes = [];
      try {
        const { listBossOrderPaymentMethods, listBossPaymentMethods, filterBossRechargeMethods } = await import(
          "../_platform-pay-qr.js"
        );
        const orderListed = await listBossOrderPaymentMethods([]);
        const listed = await listBossPaymentMethods([]);
        bossOrderCodes = (orderListed.methods || []).map((m) => m.code).filter((c) => c && c !== "catfood");
        bossRechargeCodes = filterBossRechargeMethods(listed.methods || []).map((m) => m.code);
        state.channels = (state.channels || []).map((ch) => {
          const id = ch.channel_id || ch.id;
          const hit = (listed.methods || []).find((m) => m.code === id);
          const configured = hit ? !!hit.configured : !!ch.configured;
          const open = hit ? !!hit.open : !!(ch.enabled && configured);
          const forOrder = ch.forOrder !== false && (ch.data?.forOrder !== false);
          const forRecharge = ch.forRecharge !== false && (ch.data?.forRecharge !== false);
          return {
            ...ch,
            configured,
            open,
            bossOrderOpen: bossOrderCodes.includes(id),
            bossRechargeOpen: bossRechargeCodes.includes(id),
            forOrder,
            forRecharge,
            config_status: open ? (ch.enabled ? "已启用" : "已配置") : configured ? (ch.enabled ? "已启用(缺资料)" : "已配置") : ch.config_status || "未配置",
          };
        });
      } catch {
        /* keep overlay flags */
      }
      return json(res, 200, {
        ok: true,
        configured: true,
        ...state,
        bossOrderMethods: bossOrderCodes,
        bossRechargeMethods: bossRechargeCodes,
        sot: "payment_channels",
        activePublicQr,
        templates: CHANNELS,
        bankProviders: BANK_PROVIDERS,
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const body = await readBody(req);
    const action = String(body.action || "");

    if (action === "ensure_schema" || action === "apply_migration") {
      // Probe payment_channels; optionally apply SQL when DATABASE_URL is present on the server.
      let tableReady = false;
      let probeError = "";
      try {
        await supabaseFetch(TABLES.channels, "?select=id&limit=1");
        tableReady = true;
      } catch (error) {
        tableReady = !isMissingTable(error);
        if (!tableReady) probeError = String(error?.message || error).slice(0, 240);
        else throw error;
      }
      if (tableReady) {
        return json(res, 200, {
          ok: true,
          tableReady: true,
          message: "payment_channels 已就绪",
          migration: "supabase/migrations/20260731_payment_settings.sql",
        });
      }
      const dbUrl =
        process.env.DATABASE_URL ||
        process.env.SUPABASE_DB_URL ||
        process.env.POSTGRES_URL ||
        process.env.DIRECT_URL ||
        "";
      if (!dbUrl) {
        return json(res, 200, {
          ok: true,
          tableReady: false,
          applied: false,
          message:
            "payment_channels 尚未创建。服务端未配置 DATABASE_URL，无法自动执行 DDL。请在 Supabase SQL Editor 执行 supabase/migrations/20260731_payment_settings.sql。保存接口已可写入 platform_settings 兜底。",
          migration: "supabase/migrations/20260731_payment_settings.sql",
          probeError,
        });
      }
      try {
        const { readFileSync } = await import("node:fs");
        const { resolve } = await import("node:path");
        const pg = await import("pg");
        const sqlPath = resolve(process.cwd(), "supabase/migrations/20260731_payment_settings.sql");
        const sql = readFileSync(sqlPath, "utf8");
        const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
        await client.connect();
        try {
          await client.query(sql);
        } finally {
          await client.end();
        }
        await supabaseFetch(TABLES.channels, "?select=id&limit=1");
        return json(res, 200, {
          ok: true,
          tableReady: true,
          applied: true,
          message: "已执行 payment_settings 迁移，payment_channels 可用",
          migration: "supabase/migrations/20260731_payment_settings.sql",
        });
      } catch (error) {
        return json(res, 503, {
          ok: false,
          tableReady: false,
          applied: false,
          message: `自动迁移失败：${error.message || error}`,
          migration: "supabase/migrations/20260731_payment_settings.sql",
        });
      }
    }

    if (action === "upload_qr" || action === "upload_pay_qr") {
      const channelId = String(body.channelId || body.channel_id || body.id || "duitnow").trim() || "duitnow";
      const dataUrl = String(body.dataUrl || body.data_url || body.imageData || body.fileDataUrl || "").trim();
      if (!dataUrl) return json(res, 400, { ok: false, message: "请先选择二维码图片（PNG / JPG / WEBP）。" });
      let qrUrl = "";
      try {
        qrUrl = await uploadPlatformPayQrImage(dataUrl, channelId);
      } catch (err) {
        return json(res, err.status || 400, { ok: false, message: err.message || "二维码上传失败" });
      }
      const saved = await persistChannelQrUrl(channelId, qrUrl);
      await writeLog(req, "upload_qr", channelId, null, { qrUrl, source: saved.source });
      const activePublicQr = await resolveActivePublicQr();
      return json(res, 200, {
        ok: true,
        message: "二维码已上传并写入支付配置；老板支付页刷新即可看到最新二维码",
        channelId,
        qrUrl,
        source: saved.source,
        channel: saved.channel,
        activePublicQr,
      });
    }

    if (action === "save_channel") {
      const input = body.channel || {};
      const tpl = channelTemplate(input.channel_id || input.id);
      const credentialInput = input.credentials || {};
      // Keep existing secrets when fields left blank.
      const existingCreds = await loadCredentialPayload(tpl.id);
      const mergedCreds = { ...existingCreds };
      Object.keys(credentialInput).forEach((key) => {
        const value = String(credentialInput[key] || "").trim();
        if (value) mergedCreds[key] = value;
      });
      const credentialKeys = safeKeys(mergedCreds);
      const incomingData = input.data && typeof input.data === "object" ? input.data : {};
      const incomingManual =
        incomingData.manual && typeof incomingData.manual === "object" ? incomingData.manual : {};
      // Preserve existing QR URL when admin leaves upload field empty (no more manual https paste).
      let existingQr = "";
      try {
        const prevRows = await supabaseFetch(
          TABLES.channels,
          `?channel_id=eq.${encodeURIComponent(tpl.id)}&select=data&limit=1`
        );
        const prev = Array.isArray(prevRows) ? prevRows[0] : null;
        existingQr = String(prev?.data?.manual?.qrUrl || prev?.data?.qrUrl || "").trim();
      } catch {
        existingQr = "";
      }
      if (!existingQr) {
        try {
          const publicMap = await readPaymentChannelsPublic();
          const pub = publicMap[tpl.id] || {};
          existingQr = String(pub.qrUrl || pub.manual?.qrUrl || "").trim();
        } catch {
          /* ignore */
        }
      }
      const qrUrl = String(incomingManual.qrUrl || incomingData.qrUrl || "").trim() || existingQr;
      const data = {
        ...incomingData,
        qrUrl,
        manual: { ...incomingManual, qrUrl },
      };
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
        visible: Boolean(input.visible ?? input.enabled),
        sort: Number(input.sort || CHANNELS.findIndex((c) => c.id === tpl.id) + 1),
        data,
        updated_at: new Date().toISOString(),
      };
      channel.config_status = computeStatus(channel, credentialKeys);
      let rows;
      let saveSource = "payment_channels";
      try {
        rows = await upsert(TABLES.channels, channelDbRow(channel));
      } catch (error) {
        if (isMissingTable(error)) {
          // Table missing: still persist full manual config so payment page can read it.
          saveSource = "platform_settings";
          try {
            await syncChannelPublicConfig(tpl.id, publicConfigFromChannel(channel, data, qrUrl));
          } catch (syncErr) {
            return json(res, 503, {
              ok: false,
              message:
                "支付设置数据表未初始化，且兜底写入失败。请先执行 supabase/migrations/20260731_payment_settings.sql。",
              detail: String(syncErr?.message || syncErr).slice(0, 200),
            });
          }
          if (credentialKeys.length) {
            /* credentials table likely missing too — skip soft */
          }
          await writeLog(req, "save_channel", tpl.id, null, {
            ...channel,
            credentials: credentialKeys,
            source: saveSource,
          });
          const activePublicQrFallback = await resolveActivePublicQr();
          return json(res, 200, {
            ok: true,
            message:
              "支付渠道配置已保存（payment_channels 表未初始化，已写入 platform_settings；请尽快执行 supabase/migrations/20260731_payment_settings.sql）",
            channel,
            source: saveSource,
            migration: "supabase/migrations/20260731_payment_settings.sql",
            activePublicQr: activePublicQrFallback,
          });
        }
        throw error;
      }
      if (credentialKeys.length) {
        await upsert(TABLES.credentials, {
          id: `cred-${tpl.id}`,
          channel_id: tpl.id,
          credential_status: "已配置",
          credential_keys: credentialKeys,
          encrypted_payload: encryptPayload(mergedCreds),
          updated_at: new Date().toISOString(),
        });
      }
      await syncPaymentMethod(channel, mergedCreds);
      try {
        await syncChannelPublicConfig(tpl.id, publicConfigFromChannel(channel, data, qrUrl));
      } catch {
        /* soft-fail public mirror */
      }
      await writeLog(req, "save_channel", tpl.id, null, { ...channel, credentials: credentialKeys, source: saveSource });
      const activePublicQr = await resolveActivePublicQr();
      return json(res, 200, {
        ok: true,
        message: "支付渠道配置已保存；老板支付页将立即读取最新启用二维码",
        channel: rows?.[0] || channel,
        source: saveSource,
        activePublicQr,
      });
    }

    if (action === "test_channel") {
      const id = String(body.channelId || "");
      const state = await loadState();
      const channel = state.channels.find((item) => item.channel_id === id || item.id === id);
      if (!channel) return json(res, 404, { ok: false, message: "支付渠道不存在" });
      const result = await testChannel(channel);
      const next = {
        id: channel.id || id,
        channel_id: channel.channel_id || id,
        name: channel.name,
        icon: channel.icon,
        payment_type: channel.payment_type,
        category: channel.category,
        currencies: channel.currencies,
        mode: channel.mode,
        enabled: channel.enabled,
        visible: channel.visible,
        sort: channel.sort,
        data: channel.data,
        test_result: result,
        updated_at: new Date().toISOString(),
        config_status: result.status === "success" ? (channel.enabled ? "已启用" : "测试通过") : "配置异常",
      };
      try {
        await upsert(TABLES.channels, channelDbRow(next));
      } catch (error) {
        if (!isMissingTable(error)) throw error;
      }
      await writeLog(req, "test_channel", id, null, { status: result.status, message: result.message });
      return json(res, 200, {
        ok: result.status === "success",
        message: result.status === "success" ? "连接成功。" : result.message || "测试失败",
        result,
      });
    }

    if (action === "toggle_channel") {
      const id = String(body.channelId || "");
      const enabled = Boolean(body.enabled);
      const state = await loadState();
      const channel = state.channels.find((item) => item.channel_id === id || item.id === id);
      if (!channel) return json(res, 404, { ok: false, message: "支付渠道不存在" });
      if (enabled && channel.category === "api" && channel.test_result?.status !== "success") {
        return json(res, 400, { ok: false, message: "API 渠道需先测试连接成功后才能启用。" });
      }
      if (enabled && channel.category === "manual") {
        const tpl = channelTemplate(id);
        const manual = {
          ...(channel.data?.manual || {}),
          qrUrl: String(channel.data?.manual?.qrUrl || channel.data?.qrUrl || "").trim(),
        };
        const missing = (tpl.requiredManual || []).filter((key) => !String(manual[key] || "").trim());
        if (missing.length) {
          return json(res, 400, { ok: false, message: `请先保存收款资料（缺少：${missing.join("、")}）再启用。` });
        }
        // Align with boss open gate (manualUsable): TNG needs phone or QR.
        if (id === "tng" && !String(manual.phone || "").trim() && !String(manual.qrUrl || "").trim()) {
          return json(res, 400, { ok: false, message: "请先保存 TNG 手机号或收款二维码后再启用。" });
        }
        if (id === "duitnow" && !String(manual.qrUrl || "").trim()) {
          return json(res, 400, { ok: false, message: "请先上传 DuitNow 收款二维码后再启用（老板端需要二维码才可见）。" });
        }
      }
      const next = {
        id: channel.id || id,
        channel_id: channel.channel_id || id,
        name: channel.name,
        icon: channel.icon,
        payment_type: channel.payment_type,
        category: channel.category,
        currencies: channel.currencies,
        mode: channel.mode,
        enabled,
        visible: enabled,
        sort: channel.sort,
        data: channel.data,
        test_result: channel.test_result || null,
        config_status: enabled ? "已启用" : "已停用",
        updated_at: new Date().toISOString(),
      };
      try {
        await upsert(TABLES.channels, channelDbRow(next));
      } catch (error) {
        if (!isMissingTable(error)) throw error;
        // No payment_channels table: enabled flag lives in platform_settings public mirror.
      }
      try {
        const creds = await loadCredentialPayload(id);
        await syncPaymentMethod(next, creds);
      } catch {
        /* soft-fail payment_methods when schema incomplete */
      }
      // Enable/disable must sync public mirror so boss payment page updates without redeploy.
      try {
        const qrUrl = String(next.data?.manual?.qrUrl || next.data?.qrUrl || "").trim();
        await syncChannelPublicConfig(id, publicConfigFromChannel(next, next.data || {}, qrUrl));
      } catch (syncErr) {
        return json(res, 503, {
          ok: false,
          message: `启用状态同步失败：${String(syncErr?.message || syncErr).slice(0, 160)}`,
        });
      }
      await writeLog(req, enabled ? "enable_channel" : "disable_channel", id, channel, next);
      const activePublicQr = await resolveActivePublicQr();
      return json(res, 200, {
        ok: true,
        message: enabled ? "支付渠道已启用" : "支付渠道已停用",
        channel: next,
        activePublicQr,
      });
    }

    if (action === "save_bank") {
      const bank = body.bank || body || {};
      const id = String(bank.id || "").trim();
      let existing = null;
      let usePlatform = false;
      if (id) {
        try {
          const rows = await supabaseFetch(TABLES.banks, `?id=eq.${encodeURIComponent(id)}&limit=1`);
          existing = rows?.[0] || null;
        } catch (error) {
          if (isMissingTable(error)) usePlatform = true;
          else throw error;
        }
      }
      const accountNumber = String(bank.accountNumber || bank.account_number || "").trim();
      const row = {
        id: id || `bank-${Date.now()}`,
        bank_name: String(bank.bankName || bank.bank_name || bank.provider || (existing && existing.bank_name) || ""),
        account_name: String(bank.accountName || bank.account_name || ""),
        enterprise_name: String(bank.enterpriseName || bank.enterprise_name || ""),
        account_number_mask: accountNumber
          ? accountNumber.replace(/\s+/g, "").replace(/^(.+)(.{4})$/, "**** $2")
          : String((existing && existing.account_number_mask) || ""),
        encrypted_payload: accountNumber
          ? encryptPayload({ accountNumber, swift: bank.swift || "" })
          : existing?.encrypted_payload || null,
        currency: String(bank.currency || "MYR"),
        usage: String(bank.usage || "充值收款"),
        is_default: Boolean(bank.isDefault ?? bank.is_default),
        enabled: bank.enabled !== false,
        updated_at: new Date().toISOString(),
      };
      if (!BANK_PROVIDERS.includes(row.bank_name) && row.bank_name !== "其他") {
        // Allow custom but keep known providers first.
      }
      try {
        if (usePlatform) throw Object.assign(new Error("Could not find the table"), { status: 404 });
        const rows = await upsert(TABLES.banks, row);
        await writeLog(req, "save_bank", row.id, existing, { ...row, encrypted_payload: "[encrypted]" });
        return json(res, 200, { ok: true, message: "收款渠道已保存", bank: rows?.[0] || row });
      } catch (error) {
        if (!isMissingTable(error)) throw error;
        const list = await readPlatformBanks();
        const idx = list.findIndex((b) => String(b.id) === String(row.id));
        const next = idx >= 0 ? list.map((b, i) => (i === idx ? row : b)) : [row, ...list];
        await writePlatformBanks(next);
        await writeLog(req, "save_bank", row.id, existing, { ...row, encrypted_payload: "[encrypted]", source: "platform_settings" });
        return json(res, 200, { ok: true, message: "收款渠道已保存", bank: row, bankSource: "platform_settings" });
      }
    }

    if (action === "delete_bank") {
      const id = String(body.id || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少收款渠道 ID" });
      try {
        await supabaseFetch(TABLES.banks, `?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch (error) {
        if (!isMissingTable(error)) throw error;
        const next = (await readPlatformBanks()).filter((b) => String(b.id) !== id);
        await writePlatformBanks(next);
      }
      await writeLog(req, "delete_bank", id, null, null);
      return json(res, 200, { ok: true, message: "收款渠道已删除" });
    }

    if (action === "toggle_bank") {
      const id = String(body.id || "").trim();
      if (!id) return json(res, 400, { ok: false, message: "缺少收款渠道 ID" });
      const enabled = Boolean(body.enabled);
      try {
        const rows = await supabaseFetch(TABLES.banks, `?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled, updated_at: new Date().toISOString() }),
        });
        await writeLog(req, enabled ? "enable_bank" : "disable_bank", id, null, { enabled });
        return json(res, 200, { ok: true, message: enabled ? "收款渠道已启用" : "收款渠道已停用", bank: rows?.[0] || null });
      } catch (error) {
        if (!isMissingTable(error)) throw error;
        const list = await readPlatformBanks();
        const next = list.map((b) => (String(b.id) === id ? { ...b, enabled, updated_at: new Date().toISOString() } : b));
        await writePlatformBanks(next);
        const bank = next.find((b) => String(b.id) === id) || null;
        await writeLog(req, enabled ? "enable_bank" : "disable_bank", id, null, { enabled, source: "platform_settings" });
        return json(res, 200, { ok: true, message: enabled ? "收款渠道已启用" : "收款渠道已停用", bank });
      }
    }

    return json(res, 400, { ok: false, message: "未知支付设置操作" });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "支付设置接口异常" });
  }
}

export default handler;
