import crypto from "node:crypto";
import { writeAdminLog } from "../_wallet.js";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const ADMIN_ROLES = new Set(["admin", "super_admin", "finance_admin"]);
const SUPER_ROLES = new Set(["super_admin"]);

const ENV_SECRET_KEYS = [
  { key: "SUPABASE_SERVICE_ROLE_KEY", label: "Supabase Service Role / Secret Key", source: "env" },
  { key: "SUPABASE_ANON_KEY", label: "Supabase Publishable / Anon Key", source: "env", aliases: ["SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY"] },
  { key: "SMTP_PASS", label: "SMTP 密码 / 邮件 API Key", source: "vault_or_env", vaultKey: "smtp_pass" },
  { key: "AI_API_KEY", label: "AI 喵管家 API Key", source: "vault_or_env", vaultKey: "ai_api_key" },
  { key: "PAYMENT_ENCRYPTION_KEY", label: "支付密钥加密主密钥", source: "env" },
  { key: "PLATFORM_SECRETS_ENCRYPTION_KEY", label: "平台密钥库加密主密钥", source: "env" },
  { key: "SMS_API_KEY", label: "短信验证码 API Key", source: "vault_or_env", vaultKey: "sms_api_key" },
  { key: "SMS_SECRET", label: "短信 Secret", source: "vault_or_env", vaultKey: "sms_secret" },
  { key: "DISCORD_BOT_TOKEN", label: "Discord Bot Token", source: "vault_or_env", vaultKey: "discord_bot_token" },
  { key: "WHATSAPP_API_KEY", label: "WhatsApp API Key", source: "vault_or_env", vaultKey: "whatsapp_api_key" },
  { key: "WHATSAPP_ACCESS_TOKEN", label: "WhatsApp Access Token", source: "vault_or_env", vaultKey: "whatsapp_access_token" },
  { key: "PAYMENT_API_KEY", label: "支付 API Key", source: "vault_or_env", vaultKey: "payment_api_key" },
  { key: "PAYMENT_SECRET_KEY", label: "支付 Secret Key", source: "vault_or_env", vaultKey: "payment_secret_key" },
];

/** Third-party services configurable from 系统设置 (public fields + vault secrets). */
const SERVICE_CATALOG = [
  {
    id: "payment",
    name: "支付服务",
    purpose: "充值与回调",
    check: "payment",
    publicFields: [
      { key: "paymentMerchantId", label: "Merchant ID" },
      { key: "paymentCallbackUrl", label: "Callback URL", placeholder: "/api/payment-callback" },
    ],
    secretFields: [
      { vaultKey: "payment_api_key", formKey: "apiKey", label: "API Key", envKey: "PAYMENT_API_KEY" },
      { vaultKey: "payment_secret_key", formKey: "secretKey", label: "Secret Key", envKey: "PAYMENT_SECRET_KEY" },
    ],
  },
  {
    id: "mail",
    name: "邮件服务",
    purpose: "通知与验证邮件",
    check: "mail",
    publicFields: [
      { key: "smtpHost", label: "SMTP Host" },
      { key: "smtpPort", label: "Port", type: "number" },
      { key: "smtpUsername", label: "Username" },
      { key: "mailFromName", label: "Sender Name" },
      { key: "mailFromEmail", label: "发件邮箱", type: "email" },
    ],
    secretFields: [
      { vaultKey: "smtp_pass", formKey: "password", label: "Password", envKey: "SMTP_PASS" },
    ],
  },
  {
    id: "discord",
    name: "Discord",
    purpose: "社群通知",
    check: "discord",
    optional: true,
    publicFields: [
      { key: "discordGuildId", label: "Guild ID" },
      { key: "discordInviteLink", label: "Invite Link" },
    ],
    secretFields: [
      { vaultKey: "discord_bot_token", formKey: "botToken", label: "Bot Token", envKey: "DISCORD_BOT_TOKEN" },
    ],
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    purpose: "客户触达",
    check: "whatsapp",
    optional: true,
    publicFields: [
      { key: "whatsappPhoneId", label: "Phone ID" },
    ],
    secretFields: [
      { vaultKey: "whatsapp_api_key", formKey: "apiKey", label: "API Key", envKey: "WHATSAPP_API_KEY" },
      { vaultKey: "whatsapp_access_token", formKey: "accessToken", label: "Access Token", envKey: "WHATSAPP_ACCESS_TOKEN" },
    ],
  },
  {
    id: "sms",
    name: "短信验证码",
    purpose: "登录/绑定验证",
    check: "sms",
    publicFields: [
      { key: "smsSender", label: "Sender" },
    ],
    secretFields: [
      { vaultKey: "sms_api_key", formKey: "apiKey", label: "API Key", envKey: "SMS_API_KEY" },
      { vaultKey: "sms_secret", formKey: "secret", label: "Secret", envKey: "SMS_SECRET" },
    ],
  },
  {
    id: "ai",
    name: "AI 喵管家",
    purpose: "智能客服辅助",
    check: "ai",
    publicFields: [
      { key: "aiModel", label: "Model" },
      { key: "aiBaseUrl", label: "Base URL（可选）", placeholder: "https://api.openai.com/v1" },
      { key: "aiEnabled", label: "启用 AI", type: "boolean" },
    ],
    secretFields: [
      { vaultKey: "ai_api_key", formKey: "apiKey", label: "API Key", envKey: "AI_API_KEY" },
    ],
  },
];

const ALLOWED_VAULT_KEYS = new Set(
  SERVICE_CATALOG.flatMap((s) => (s.secretFields || []).map((f) => f.vaultKey)).concat(["smtp_pass", "ai_api_key", "sms_api_key"])
);

const PAYMENT_CHANNELS = [
  { id: "tng", name: "TNG" },
  { id: "duitnow", name: "DuitNow QR" },
  { id: "bank-my", name: "银行转账" },
  { id: "alipay", name: "支付宝" },
  { id: "fpx", name: "FPX" },
  { id: "other", name: "其他支付渠道" },
];

const DEFAULT_SETTINGS = {
  siteName: "妙脆角",
  siteNameEn: "Meow Cui Jiao",
  companyName: "MEOW CUI JIAO ENTERPRISE",
  contactEmail: "",
  supportContact: "",
  timezone: "Asia/Kuala_Lumpur",
  defaultCurrency: "RM",
  catFoodDisplayName: "猫粮",
  maintenanceMessage: "",
  termsUrl: "",
  privacyUrl: "",
  registerOpen: true,
  allowBossOrder: true,
  allowCompanionApply: true,
  allowCustomerServiceLogin: true,
  allowCompanionGrab: true,
  allowWithdraw: true,
  allowRecharge: true,
  maintenanceMode: false,
  showAnnouncements: true,
  gameplayMallOpen: true,
  defaultCommissionRate: 20,
  /** Boss share of platform_fee (%). 0 allowed; settle skips when null/empty and no relation override. */
  defaultBossCommissionRate: 0,
  defaultRebateRate: 0,
  defaultDeposit: 100,
  defaultLevel: "Lv1",
  sessionHours: 168,
  loginFailLockCount: 5,
  adminTwoFactorRequired: false,
  sensitiveChangeReverify: true,
  mailFromName: "MEOW CUI JIAO",
  mailFromEmail: "",
  smtpHost: "",
  smtpPort: 587,
  smtpTls: true,
  smtpUsername: "",
  aiEnabled: false,
  aiModel: "",
  aiBaseUrl: "",
  aiSystemPrompt: "",
  aiDailyLimit: 100,
  aiHandoffRule: "用户要求人工或敏感纠纷时转客服",
  paymentMerchantId: "",
  paymentCallbackUrl: "/api/payment-callback",
  discordGuildId: "",
  discordInviteLink: "",
  whatsappPhoneId: "",
  smsSender: "",
  paymentChannelsPublic: {},
  /** Homepage「组队大厅」singleton — enable + jump URL (Discord or other). */
  teamLobbyEnabled: false,
  teamLobbyLink: "",
};

function json(res, status, data) {
  return res.status(status).json(data);
}
function hasDb() {
  return REQUIRED_ENV.every((k) => !!process.env[k] || (k === "SUPABASE_URL" && process.env.VITE_SUPABASE_URL));
}
function supabaseUrl() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
}
function publishableKey() {
  return (
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ""
  );
}
function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
}
function restUrl(table, query = "") {
  return `${supabaseUrl()}/rest/v1/${table}${query}`;
}
function authUrl(path) {
  return `${supabaseUrl()}/auth/v1/${path}`;
}
function serviceHeaders(extra = {}) {
  const key = serviceKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}
function anonHeaders(extra = {}) {
  const key = publishableKey();
  return { apikey: key, "Content-Type": "application/json", ...extra };
}
function isMissingTable(error) {
  return /PGRST205|Could not find the table|schema cache|does not exist/i.test(String(error?.message || ""));
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
    throw Object.assign(new Error(body?.message || body?.hint || text || `HTTP ${response.status}`), {
      status: response.status,
      body,
    });
  }
  return body;
}
function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}
function roleHeader(req) {
  return String(req.headers["x-mcj-admin-role"] || "").trim();
}
function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "").split(",")[0].trim();
}
async function requireAdmin(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先使用管理员账号登录后台。"), { status: 401 });
  const user = await supabaseJson(authUrl("user"), { headers: anonHeaders({ Authorization: `Bearer ${token}` }) });
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(user.id)}&limit=1`), {
    headers: serviceHeaders(),
  });
  const profile = rows[0];
  if (!profile || !ADMIN_ROLES.has(profile.role)) {
    throw Object.assign(new Error("无权访问系统设置。"), { status: 403 });
  }
  if (profile.status !== "active") throw Object.assign(new Error("管理员账号已停用。"), { status: 403 });
  return profile;
}
function isSuper(profile, req) {
  return SUPER_ROLES.has(profile.role) || SUPER_ROLES.has(roleHeader(req));
}
async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}
function bool(v, fallback = false) {
  if (v === undefined || v === null || v === "") return fallback;
  return v === true || v === "true" || v === 1 || v === "1";
}
function normalizeSettings(input = {}) {
  const paymentChannelsPublic =
    input.paymentChannelsPublic && typeof input.paymentChannelsPublic === "object" ? input.paymentChannelsPublic : {};
  return {
    siteName: String(input.siteName || DEFAULT_SETTINGS.siteName).trim() || DEFAULT_SETTINGS.siteName,
    siteNameEn: String(input.siteNameEn || DEFAULT_SETTINGS.siteNameEn).trim() || DEFAULT_SETTINGS.siteNameEn,
    companyName: String(input.companyName || DEFAULT_SETTINGS.companyName).trim(),
    contactEmail: String(input.contactEmail || "").trim(),
    supportContact: String(input.supportContact || "").trim(),
    timezone: String(input.timezone || DEFAULT_SETTINGS.timezone).trim(),
    defaultCurrency: String(input.defaultCurrency || "RM").trim() || "RM",
    catFoodDisplayName: String(input.catFoodDisplayName || "猫粮").trim() || "猫粮",
    maintenanceMessage: String(input.maintenanceMessage || "").trim(),
    termsUrl: String(input.termsUrl || "").trim(),
    privacyUrl: String(input.privacyUrl || "").trim(),
    registerOpen: bool(input.registerOpen, true),
    allowBossOrder: bool(input.allowBossOrder, true),
    allowCompanionApply: bool(input.allowCompanionApply, true),
    allowCustomerServiceLogin: bool(input.allowCustomerServiceLogin, true),
    allowCompanionGrab: bool(input.allowCompanionGrab, true),
    allowWithdraw: bool(input.allowWithdraw, true),
    allowRecharge: bool(input.allowRecharge, true),
    maintenanceMode: bool(input.maintenanceMode, false),
    showAnnouncements: bool(input.showAnnouncements, true),
    gameplayMallOpen: bool(input.gameplayMallOpen, true),
    defaultCommissionRate: Math.max(0, Math.min(100, Number(input.defaultCommissionRate ?? 20) || 20)),
    defaultBossCommissionRate: Math.max(
      0,
      Math.min(
        100,
        Number(
          input.defaultBossCommissionRate != null
            ? input.defaultBossCommissionRate
            : input.default_boss_commission_rate != null
              ? input.default_boss_commission_rate
              : 0
        ) || 0
      )
    ),
    defaultRebateRate: Math.max(0, Math.min(100, Number(input.defaultRebateRate ?? 0) || 0)),
    defaultDeposit: Math.max(0, Number(input.defaultDeposit ?? 100) || 100),
    defaultLevel: String(input.defaultLevel || "Lv1"),
    sessionHours: Math.max(1, Number(input.sessionHours ?? 168) || 168),
    loginFailLockCount: Math.max(1, Number(input.loginFailLockCount ?? 5) || 5),
    adminTwoFactorRequired: bool(input.adminTwoFactorRequired, false),
    sensitiveChangeReverify: bool(input.sensitiveChangeReverify, true),
    mailFromName: String(input.mailFromName || DEFAULT_SETTINGS.mailFromName).trim(),
    mailFromEmail: String(input.mailFromEmail || "").trim(),
    smtpHost: String(input.smtpHost || "").trim(),
    smtpPort: Math.max(1, Number(input.smtpPort ?? 587) || 587),
    smtpTls: bool(input.smtpTls, true),
    smtpUsername: String(input.smtpUsername || "").trim(),
    aiEnabled: bool(input.aiEnabled, false),
    aiModel: String(input.aiModel || "").trim(),
    aiBaseUrl: String(input.aiBaseUrl || "").trim(),
    aiSystemPrompt: String(input.aiSystemPrompt || "").trim(),
    aiDailyLimit: Math.max(0, Number(input.aiDailyLimit ?? 100) || 0),
    aiHandoffRule: String(input.aiHandoffRule || DEFAULT_SETTINGS.aiHandoffRule).trim(),
    paymentMerchantId: String(input.paymentMerchantId || "").trim(),
    paymentCallbackUrl: String(input.paymentCallbackUrl || DEFAULT_SETTINGS.paymentCallbackUrl).trim() || DEFAULT_SETTINGS.paymentCallbackUrl,
    discordGuildId: String(input.discordGuildId || "").trim(),
    discordInviteLink: String(input.discordInviteLink || "").trim(),
    whatsappPhoneId: String(input.whatsappPhoneId || "").trim(),
    smsSender: String(input.smsSender || "").trim(),
    paymentChannelsPublic,
    teamLobbyEnabled: bool(input.teamLobbyEnabled, false),
    teamLobbyLink: String(input.teamLobbyLink || input.discordInviteLink || "").trim(),
  };
}

async function loadSettingsRow() {
  const rows = await supabaseJson(restUrl("platform_settings", "?id=eq.global&limit=1"), { headers: serviceHeaders() });
  return rows?.[0] || null;
}

async function saveSettings(settings, adminId) {
  const now = new Date().toISOString();
  const rows = await supabaseJson(restUrl("platform_settings", "?on_conflict=id"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify({ id: "global", data: settings, updated_at: now, updated_by: adminId || null }),
  });
  return normalizeSettings((rows[0] && rows[0].data) || settings);
}

function encryptionKey() {
  const raw =
    process.env.PLATFORM_SECRETS_ENCRYPTION_KEY ||
    process.env.PAYMENT_ENCRYPTION_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  if (!raw) return null;
  return crypto.createHash("sha256").update(String(raw)).digest();
}

function encryptSecret(plain) {
  const key = encryptionKey();
  if (!key) throw Object.assign(new Error("缺少 PLATFORM_SECRETS_ENCRYPTION_KEY，无法安全保存密钥。请先在服务器环境变量配置。"), { status: 503 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

function decryptSecret(blob) {
  const key = encryptionKey();
  if (!key || !blob) return "";
  const [ivB64, tagB64, dataB64] = String(blob).split(".");
  if (!ivB64 || !tagB64 || !dataB64) return "";
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

function maskSecret(value) {
  const s = String(value || "");
  if (!s) return "";
  if (s.length <= 4) return "••••";
  return "••••" + s.slice(-4);
}

function parseMaskFromNote(note) {
  const text = String(note || "");
  const m = text.match(/masked:([•\*\.xX\u2022]{2,}.{0,8})/);
  if (m) return m[1];
  const last4 = text.match(/末四位\s*([A-Za-z0-9]{2,8})/);
  if (last4) return "••••" + last4[1];
  return "";
}

async function upsertVaultSecret(vaultKey, plain, adminId, label) {
  const value = String(plain || "").trim();
  if (!value) return null;
  const ciphertext = encryptSecret(value);
  const masked = maskSecret(value);
  const note = `已加密存储，不可回显 · masked:${masked}`;
  await supabaseJson(restUrl("platform_secret_vault", "?on_conflict=secret_key"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify({
      secret_key: vaultKey,
      ciphertext,
      configured: true,
      updated_at: new Date().toISOString(),
      updated_by: adminId || null,
      note,
    }),
  });
  return { vaultKey, status: "已配置", masked, label: label || vaultKey };
}

async function resolveVaultPlain(vaultKey, envKey) {
  if (envKey && process.env[envKey]) return String(process.env[envKey]);
  const vault = await loadVaultCipher(vaultKey);
  if (vault?.ciphertext) return decryptSecret(vault.ciphertext);
  return "";
}

function serviceById(id) {
  return SERVICE_CATALOG.find((s) => s.id === id) || null;
}

function publicValuesForService(service, settings) {
  const out = {};
  (service.publicFields || []).forEach((f) => {
    if (f.type === "boolean") out[f.key] = !!settings[f.key];
    else if (f.type === "number") out[f.key] = settings[f.key];
    else out[f.key] = settings[f.key] != null ? String(settings[f.key]) : "";
  });
  return out;
}

async function secretMetaForService(service, vaultMap) {
  const fields = [];
  for (const f of service.secretFields || []) {
    const vaultRow = vaultMap[f.vaultKey];
    const fromEnv = !!(f.envKey && process.env[f.envKey]);
    const fromVault = !!(vaultRow && vaultRow.configured);
    const configured = fromEnv || fromVault;
    fields.push({
      vaultKey: f.vaultKey,
      formKey: f.formKey,
      label: f.label,
      configured,
      status: configured ? "已配置" : "未配置",
      masked: configured ? parseMaskFromNote(vaultRow?.note) || "••••已配置" : "",
      updatedAt: vaultRow?.updated_at || "",
      source: fromEnv ? "env" : fromVault ? "vault" : "none",
    });
  }
  return fields;
}

async function buildServiceConfigs(settings) {
  let vault = [];
  try {
    vault = await loadVaultRows();
  } catch {
    vault = [];
  }
  const vaultMap = (vault || []).reduce((m, r) => {
    m[r.secret_key] = r;
    return m;
  }, {});
  const list = [];
  for (const service of SERVICE_CATALOG) {
    const secrets = await secretMetaForService(service, vaultMap);
    const publicValues = publicValuesForService(service, settings);
    const hasPublic = Object.values(publicValues).some((v) => v !== "" && v !== false && v != null);
    const hasSecret = secrets.some((s) => s.configured);
    list.push({
      id: service.id,
      name: service.name,
      purpose: service.purpose,
      optional: !!service.optional,
      configurable: true,
      publicFields: service.publicFields,
      secretFields: secrets,
      publicValues,
      status: hasSecret || hasPublic ? "已配置" : "未配置",
      configured: hasSecret || hasPublic,
    });
  }
  return list;
}

async function testServiceConnection(serviceId, settings) {
  const service = serviceById(serviceId);
  if (!service) throw Object.assign(new Error("未知服务"), { status: 400 });

  if (serviceId === "mail") {
    const host = process.env.SMTP_HOST || settings.smtpHost;
    const pass = await resolveVaultPlain("smtp_pass", "SMTP_PASS");
    const user = process.env.SMTP_USER || settings.smtpUsername || settings.mailFromEmail;
    if (!host) return { ok: false, status: "missing", message: "未配置 SMTP Host，请先保存邮件配置。" };
    if (!pass) return { ok: false, status: "missing", message: "未配置 SMTP Password，请先保存密钥。" };
    return {
      ok: true,
      status: "ok",
      message: `邮件配置完整：SMTP ${host}:${settings.smtpPort || 587}（用户 ${user || "未填"}，密码已保存，未实际发信）`,
    };
  }

  if (serviceId === "payment") {
    const apiKey = await resolveVaultPlain("payment_api_key", "PAYMENT_API_KEY");
    const secret = await resolveVaultPlain("payment_secret_key", "PAYMENT_SECRET_KEY");
    const merchantId = settings.paymentMerchantId || "";
    const callbackUrl = settings.paymentCallbackUrl || "/api/payment-callback";
    if (!apiKey || !secret) {
      return { ok: false, status: "missing", message: "未配置 API Key / Secret Key，请先保存支付配置。" };
    }
    return {
      ok: true,
      status: "ok",
      message: `支付密钥已配置（Merchant ${merchantId || "未填"}，回调 ${callbackUrl}）。渠道细调见左侧「支付设置」。`,
    };
  }

  if (serviceId === "ai") {
    if (!settings.aiEnabled) {
      return { ok: false, status: "missing", message: "AI 功能未启用，请先在配置中开启。" };
    }
    const key = await resolveVaultPlain("ai_api_key", "AI_API_KEY");
    if (!key) return { ok: false, status: "missing", message: "缺少 AI API Key，请先保存。" };
    const base = settings.aiBaseUrl || "（默认提供商）";
    return {
      ok: true,
      status: "ok",
      message: `AI 已配置：模型 ${settings.aiModel || "未命名"}，Base URL ${base}`,
    };
  }

  if (serviceId === "sms") {
    const apiKey = await resolveVaultPlain("sms_api_key", "SMS_API_KEY");
    const secret = await resolveVaultPlain("sms_secret", "SMS_SECRET");
    if (!apiKey) return { ok: false, status: "missing", message: "缺少短信 API Key，请先保存。" };
    return {
      ok: true,
      status: "ok",
      message: `短信已配置：Sender ${settings.smsSender || "未填"}，Secret ${secret ? "已保存" : "未填（可选）"}`,
    };
  }

  if (serviceId === "discord") {
    const token = await resolveVaultPlain("discord_bot_token", "DISCORD_BOT_TOKEN");
    if (!token) return { ok: false, status: "missing", message: "缺少 Discord Bot Token，请先保存。" };
    if (!settings.discordGuildId) {
      return { ok: false, status: "missing", message: "缺少 Guild ID，请先保存公开配置。" };
    }
    try {
      const response = await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(settings.discordGuildId)}`, {
        headers: { Authorization: `Bot ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, status: "error", message: `Discord Token/权限无效（HTTP ${response.status}）` };
      }
      if (response.status === 404) {
        return { ok: false, status: "error", message: "Guild ID 不存在或 Bot 未加入该服务器" };
      }
      if (!response.ok) {
        const text = await response.text();
        return { ok: false, status: "error", message: `Discord API HTTP ${response.status}: ${String(text).slice(0, 120)}` };
      }
      const body = await response.json().catch(() => ({}));
      return {
        ok: true,
        status: "ok",
        message: `Discord 连接成功：${body.name || settings.discordGuildId}${settings.discordInviteLink ? " · 邀请链接已配置" : ""}`,
      };
    } catch (e) {
      return { ok: false, status: "error", message: e.message || "Discord 请求失败" };
    }
  }

  if (serviceId === "whatsapp") {
    const apiKey = await resolveVaultPlain("whatsapp_api_key", "WHATSAPP_API_KEY");
    const token = await resolveVaultPlain("whatsapp_access_token", "WHATSAPP_ACCESS_TOKEN");
    if (!apiKey && !token) {
      return { ok: false, status: "missing", message: "缺少 WhatsApp API Key / Access Token，请先保存。" };
    }
    if (!settings.whatsappPhoneId) {
      return { ok: false, status: "missing", message: "缺少 Phone ID，请先保存公开配置。" };
    }
    return {
      ok: true,
      status: "ok",
      message: `WhatsApp 配置完整：Phone ID ${settings.whatsappPhoneId}（密钥已保存，未实际发消息）`,
    };
  }

  return { ok: false, status: "missing", message: "该服务暂不支持测试连接" };
}

async function loadVaultRows() {
  try {
    return await supabaseJson(restUrl("platform_secret_vault", "?select=secret_key,configured,updated_at,updated_by,note"), {
      headers: serviceHeaders(),
    });
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
}

async function loadVaultCipher(secretKey) {
  try {
    const rows = await supabaseJson(
      restUrl("platform_secret_vault", `?secret_key=eq.${encodeURIComponent(secretKey)}&limit=1`),
      { headers: serviceHeaders() }
    );
    return rows?.[0] || null;
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

function envConfigured(entry) {
  if (process.env[entry.key]) return true;
  return (entry.aliases || []).some((k) => !!process.env[k]);
}

async function secretStatuses() {
  const vault = await loadVaultRows();
  const vaultMap = (vault || []).reduce((m, r) => {
    m[r.secret_key] = r;
    return m;
  }, {});
  return ENV_SECRET_KEYS.map((entry) => {
    const fromEnv = envConfigured(entry);
    const vaultRow = entry.vaultKey ? vaultMap[entry.vaultKey] : null;
    const fromVault = !!(vaultRow && vaultRow.configured);
    const configured = entry.source === "env" ? fromEnv : fromEnv || fromVault;
    return {
      key: entry.key,
      vaultKey: entry.vaultKey || "",
      label: entry.label,
      source: entry.source,
      status: configured ? "已配置" : "未配置",
      configured,
      updatable: entry.source !== "env",
      envOnly: entry.source === "env",
      updatedAt: vaultRow?.updated_at || "",
      masked: configured && entry.vaultKey ? parseMaskFromNote(vaultRow?.note) || (fromEnv ? "••••env" : "••••已配置") : "",
      note: entry.source === "env" ? "仅可通过服务器环境变量 / Vercel Secrets 配置，页面不可回显" : vaultRow?.note || "",
    };
  });
}

async function writeConfigLog({ admin, configType, action, beforeStatus, afterStatus, reason, ip }) {
  try {
    await supabaseJson(restUrl("platform_config_logs"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        admin_id: admin?.id || null,
        admin_role: admin?.role || "",
        config_type: configType || "",
        action: action || "",
        before_status: beforeStatus || "",
        after_status: afterStatus || "",
        reason: reason || "",
        ip: ip || "",
        created_at: new Date().toISOString(),
      }),
    });
  } catch {
    /* table may be missing */
  }
  await writeAdminLog({
    module: "platform_config",
    action: action || configType,
    targetType: configType,
    targetId: configType,
    operatorId: admin?.id,
    operatorRole: admin?.role,
    reason,
    before: { status: beforeStatus },
    after: { status: afterStatus },
  });
}

function maskUrl(url) {
  const text = String(url || "");
  if (!text) return "";
  try {
    const u = new URL(text);
    return `${u.protocol}//${u.host}`;
  } catch {
    return text.slice(0, 32) + (text.length > 32 ? "…" : "");
  }
}

async function probe(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    return {
      id: name,
      status: result.status || "ok",
      statusText: result.statusText || ({ ok: "正常", error: "异常", missing: "未配置" }[result.status] || result.status),
      detail: result.detail || "",
      checkedAt: new Date().toISOString(),
      ms: Date.now() - started,
    };
  } catch (e) {
    return {
      id: name,
      status: "error",
      statusText: "异常",
      detail: e.message || "检测失败",
      checkedAt: new Date().toISOString(),
      ms: Date.now() - started,
    };
  }
}

async function runDiagnostics() {
  const base = supabaseUrl();
  const anon = publishableKey();
  const service = serviceKey();

  const checks = await Promise.all([
    probe("supabase_project", async () => {
      if (!base) return { status: "missing", statusText: "未配置", detail: "缺少 SUPABASE_URL" };
      return { status: "ok", statusText: "已连接", detail: maskUrl(base) };
    }),
    probe("database", async () => {
      if (!base || !service) return { status: "missing", detail: "缺少 URL 或 service_role" };
      await supabaseJson(restUrl("profiles", "?select=id&limit=1"), { headers: serviceHeaders() });
      return { status: "ok", detail: "profiles 可读" };
    }),
    probe("auth", async () => {
      if (!base || !anon) return { status: "missing", detail: "缺少 Publishable/Anon Key" };
      const response = await fetch(`${base}/auth/v1/health`, { headers: anonHeaders() });
      if (!response.ok) {
        // some projects return 401/404 on health; try settings
        const settingsRes = await fetch(`${base}/auth/v1/settings`, { headers: anonHeaders() });
        if (!settingsRes.ok) throw new Error(`Auth HTTP ${response.status}/${settingsRes.status}`);
      }
      return { status: "ok", detail: "Auth 可达" };
    }),
    probe("storage", async () => {
      if (!base || !service) return { status: "missing", detail: "缺少 service_role" };
      const response = await fetch(`${base}/storage/v1/bucket`, { headers: serviceHeaders() });
      const text = await response.text();
      if (!response.ok) throw new Error(text || `Storage HTTP ${response.status}`);
      let buckets = [];
      try {
        buckets = JSON.parse(text);
      } catch {
        buckets = [];
      }
      return { status: "ok", detail: `Buckets: ${(buckets || []).length}` };
    }),
    probe("realtime", async () => {
      if (!base || !anon) return { status: "missing", detail: "缺少 URL 或 Publishable Key" };
      const response = await fetch(`${base}/realtime/v1/`, { headers: anonHeaders() });
      // Realtime root often 404; any network response that is not DNS failure counts as reachable stack
      if (response.status >= 500) throw new Error(`Realtime HTTP ${response.status}`);
      return {
        status: response.status < 500 ? "ok" : "error",
        detail: `HTTP ${response.status}（端点可达）`,
      };
    }),
    probe("payment_callback", async () => {
      if (!base || !service) return { status: "missing", detail: "数据库未配置" };
      try {
        await supabaseJson(restUrl("payment_orders", "?select=id&limit=1"), { headers: serviceHeaders() });
        return { status: "ok", detail: "回调入口 /api/payment-callback，订单表可读" };
      } catch (e) {
        if (isMissingTable(e)) return { status: "missing", detail: "payment_orders 表不存在" };
        throw e;
      }
    }),
    probe("mail", async () => {
      const host = process.env.SMTP_HOST || "";
      const settings = normalizeSettings((await loadSettingsRow())?.data || {});
      const smtpHost = host || settings.smtpHost;
      const pass = process.env.SMTP_PASS || "";
      const vault = await loadVaultCipher("smtp_pass");
      const hasPass = !!pass || !!(vault && vault.configured);
      if (!smtpHost) return { status: "missing", detail: "未配置 SMTP Host" };
      if (!hasPass) return { status: "missing", detail: "SMTP 已填 Host，但密码未配置" };
      return { status: "ok", detail: `SMTP ${smtpHost}（密码已配置，未在此发送）` };
    }),
    probe("payment", async () => {
      const settings = normalizeSettings((await loadSettingsRow())?.data || {});
      const result = await testServiceConnection("payment", settings);
      return { status: result.status === "ok" ? "ok" : result.status || "missing", detail: result.message };
    }),
    probe("sms", async () => {
      const settings = normalizeSettings((await loadSettingsRow())?.data || {});
      const result = await testServiceConnection("sms", settings);
      return { status: result.status === "ok" ? "ok" : result.status || "missing", detail: result.message };
    }),
    probe("ai", async () => {
      const settings = normalizeSettings((await loadSettingsRow())?.data || {});
      if (!settings.aiEnabled) return { status: "missing", detail: "AI 功能未启用" };
      const envKey = !!process.env.AI_API_KEY;
      const vault = await loadVaultCipher("ai_api_key");
      if (!envKey && !(vault && vault.configured)) return { status: "missing", detail: "缺少 AI_API_KEY" };
      return { status: "ok", detail: `模型 ${settings.aiModel || "未命名"}${settings.aiBaseUrl ? " · " + settings.aiBaseUrl : ""}` };
    }),
    probe("discord", async () => {
      const settings = normalizeSettings((await loadSettingsRow())?.data || {});
      const result = await testServiceConnection("discord", settings);
      return { status: result.status === "ok" ? "ok" : result.status || "missing", detail: result.message };
    }),
    probe("whatsapp", async () => {
      const settings = normalizeSettings((await loadSettingsRow())?.data || {});
      const result = await testServiceConnection("whatsapp", settings);
      return { status: result.status === "ok" ? "ok" : result.status || "missing", detail: result.message };
    }),
    probe("file_upload", async () => {
      if (!base || !service) return { status: "missing", detail: "Storage 未配置" };
      const response = await fetch(`${base}/storage/v1/bucket`, { headers: serviceHeaders() });
      if (!response.ok) throw new Error(`Storage HTTP ${response.status}`);
      return { status: "ok", detail: "可列取 Storage Bucket，上传走服务端接口" };
    }),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    projectUrl: maskUrl(base),
    publishableKeyStatus: anon ? "已配置" : "未配置",
    serviceRoleStatus: service ? "已配置" : "未配置",
    forbiddenFrontendKeys: {
      VITE_SUPABASE_SERVICE_ROLE_KEY: !!process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
      VITE_SUPABASE_SECRET_KEY: !!process.env.VITE_SUPABASE_SECRET_KEY,
    },
    checks,
  };
}

async function paymentChannelSummary(settings) {
  const publicMap = settings.paymentChannelsPublic || {};
  let dbChannels = [];
  try {
    dbChannels = await supabaseJson(restUrl("payment_channels", "?select=*&order=sort.asc"), { headers: serviceHeaders() });
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
  let credentials = [];
  try {
    credentials = await supabaseJson(restUrl("payment_channel_credentials", "?select=channel_id,credential_status,updated_at"), {
      headers: serviceHeaders(),
    });
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
  const credMap = (credentials || []).reduce((m, r) => {
    m[r.channel_id] = r;
    return m;
  }, {});
  const dbMap = (dbChannels || []).reduce((m, r) => {
    m[r.channel_id || r.id] = r;
    return m;
  }, {});

  return PAYMENT_CHANNELS.map((ch) => {
    const row = dbMap[ch.id] || {};
    const pub = publicMap[ch.id] || {};
    const cred = credMap[ch.id];
    const data = row.data || {};
    const manual = data.manual || pub.manual || {};
    return {
      id: ch.id,
      name: ch.name,
      enabled: pub.enabled != null ? !!pub.enabled : !!row.enabled,
      mode: pub.mode || row.mode || "test",
      merchantName: pub.merchantName || data.adminLabel || row.name || ch.name,
      merchantNo: pub.merchantNo || manual.merchantId || "",
      callbackUrl: pub.callbackUrl || data.webhook?.callbackUrl || "/api/payment-callback",
      connectionStatus: cred?.credential_status === "已配置" || row.config_status === "已配置" ? "已配置" : "未配置",
      secretStatus: cred?.credential_status === "已配置" ? "已配置" : "未配置",
      lastCheckedAt: cred?.updated_at || row.updated_at || "",
      bankName: manual.bankName || pub.bankName || "",
      accountName: manual.receiverName || pub.accountName || "",
      accountLast4: String(manual.bankAccount || pub.accountNumber || "")
        .replace(/\s+/g, "")
        .slice(-4),
      duitnowId: manual.duitnowId || pub.duitnowId || "",
      qrUrl: manual.qrUrl || pub.qrUrl || "",
    };
  });
}

function thirdPartyCards(settings, secrets, diagnostics, serviceConfigs) {
  const byId = (diagnostics.checks || []).reduce((m, c) => {
    m[c.id] = c;
    return m;
  }, {});
  const secretBy = (secrets || []).reduce((m, s) => {
    m[s.key] = s;
    return m;
  }, {});
  const cfgBy = (serviceConfigs || []).reduce((m, s) => {
    m[s.id] = s;
    return m;
  }, {});
  const cards = [
    { id: "supabase", name: "Supabase", purpose: "数据库 / Auth / Storage", check: "database", configurable: false },
    { id: "mail", name: "邮件服务", purpose: "通知与验证邮件", check: "mail", secret: "SMTP_PASS", configurable: true },
    { id: "payment", name: "支付服务", purpose: "充值与回调", check: "payment", configurable: true },
    { id: "sms", name: "短信验证码", purpose: "登录/绑定验证", secret: "SMS_API_KEY", check: "sms", configurable: true },
    { id: "storage", name: "图片存储", purpose: "证件 / 收据 / 媒体", check: "storage", configurable: false },
    { id: "ai", name: "AI 喵管家", purpose: "智能客服辅助", check: "ai", secret: "AI_API_KEY", configurable: true },
    { id: "discord", name: "Discord", purpose: "社群通知", check: "discord", optional: true, configurable: true },
    { id: "whatsapp", name: "WhatsApp", purpose: "客户触达", check: "whatsapp", optional: true, configurable: true },
    { id: "telegram", name: "Telegram", purpose: "客服通道", optional: true, configurable: false },
  ];
  return cards.map((c) => {
    const check = byId[c.check];
    const secret = c.secret ? secretBy[c.secret] : null;
    const cfg = cfgBy[c.id];
    let status = "未配置";
    if (check) status = check.statusText || check.status;
    else if (cfg?.configured) status = "已配置";
    else if (secret) status = secret.status;
    else if (c.optional) status = "未配置";
    const secretMasks = (cfg?.secretFields || [])
      .filter((s) => s.configured)
      .map((s) => `${s.label} ${s.masked || "••••"}`)
      .join(" · ");
    return {
      id: c.id,
      name: c.name,
      purpose: c.purpose,
      status,
      mode: c.id === "ai" ? (settings.aiEnabled ? "已启用" : "关闭") : "—",
      lastCheckedAt: check?.checkedAt || "",
      detail: check?.detail || secretMasks || secret?.note || "",
      configurable: !!c.configurable,
      configured: !!(cfg?.configured || (secret && secret.configured) || (check && check.status === "ok")),
    };
  });
}

async function sendTestMail({ to, settings, admin }) {
  const host = process.env.SMTP_HOST || settings.smtpHost;
  const port = Number(process.env.SMTP_PORT || settings.smtpPort || 587);
  const user = process.env.SMTP_USER || settings.smtpUsername || settings.mailFromEmail;
  let pass = process.env.SMTP_PASS || "";
  if (!pass) {
    const vault = await loadVaultCipher("smtp_pass");
    if (vault?.ciphertext) pass = decryptSecret(vault.ciphertext);
  }
  if (!host || !pass) {
    throw Object.assign(new Error("邮件未完整配置：需要 SMTP Host 与密码（环境变量或密钥库）。"), { status: 400 });
  }
  // Lightweight SMTP-less fallback: if nodemailer not installed, report configuration-only success path via fetch to a mail API is not available.
  // Use raw socket-free approach: try dynamic import nodemailer; if missing, return actionable error.
  let nodemailer;
  try {
    const mod = await import("nodemailer");
    nodemailer = mod.default || mod;
  } catch {
    throw Object.assign(
      new Error("服务器未安装 nodemailer。请执行 npm install nodemailer 后重试；SMTP 密码不会回显。"),
      { status: 503 }
    );
  }
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
    requireTLS: !!settings.smtpTls && port !== 465,
  });
  const fromName = settings.mailFromName || "MEOW CUI JIAO";
  const fromEmail = settings.mailFromEmail || user;
  const info = await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject: `[${settings.siteName || "妙脆角"}] 系统设置测试邮件`,
    text: `这是一封由管理员 ${admin.email || admin.id} 触发的测试邮件。时间：${new Date().toISOString()}`,
  });
  return { messageId: info.messageId || "", accepted: info.accepted || [] };
}

export default async function handler(req, res) {
  if (!hasDb()) {
    return json(res, req.method === "GET" ? 200 : 503, {
      ok: req.method === "GET",
      configured: false,
      settings: DEFAULT_SETTINGS,
      message: "数据库未配置（缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY）",
    });
  }

  try {
    if (req.method === "GET") {
      const action = String(req.query.action || "bootstrap").trim();
      // Allow public-ish bootstrap only for authenticated admins
      const profile = await requireAdmin(req);
      const row = await loadSettingsRow().catch((e) => {
        if (isMissingTable(e)) return null;
        throw e;
      });
      const settings = normalizeSettings(row?.data || {});
      if (action === "settings_only") {
        return json(res, 200, { ok: true, configured: !!row, settings, source: row ? "supabase" : "default" });
      }

      const [secrets, diagnostics, payments, logs, serviceConfigs] = await Promise.all([
        secretStatuses(),
        runDiagnostics(),
        paymentChannelSummary(settings),
        supabaseJson(restUrl("platform_config_logs", "?order=created_at.desc&limit=50"), { headers: serviceHeaders() }).catch(
          (e) => (isMissingTable(e) ? [] : Promise.reject(e))
        ),
        buildServiceConfigs(settings),
      ]);

      const viteLeak = diagnostics.forbiddenFrontendKeys || {};
      return json(res, 200, {
        ok: true,
        configured: !!row,
        role: profile.role,
        canEditSecrets: isSuper(profile, req) || profile.role === "admin" || profile.role === "finance_admin",
        settings,
        secrets,
        diagnostics,
        payments,
        serviceConfigs,
        thirdParties: thirdPartyCards(settings, secrets, diagnostics, serviceConfigs),
        keyPolicy: {
          frontendAllowed: ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_ANON_KEY"],
          frontendForbidden: ["VITE_SUPABASE_SERVICE_ROLE_KEY", "VITE_SUPABASE_SECRET_KEY"],
          frontendKeyType: publishableKey()
            ? process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
              ? "publishable"
              : "anon"
            : "none",
          serviceRoleLocation: "服务器环境变量 SUPABASE_SERVICE_ROLE_KEY（禁止 VITE_ / 前端 / Git）",
          paymentCallback: "/api/payment-callback",
          viteLeakDetected: !!(viteLeak.VITE_SUPABASE_SERVICE_ROLE_KEY || viteLeak.VITE_SUPABASE_SECRET_KEY),
          secretsStorage: "platform_secret_vault（AES-256-GCM 加密）+ 可选环境变量覆盖",
        },
        logs: (logs || []).map((l) => ({
          id: l.id,
          adminId: l.admin_id,
          adminRole: l.admin_role,
          configType: l.config_type,
          action: l.action,
          beforeStatus: l.before_status,
          afterStatus: l.after_status,
          reason: l.reason,
          ip: l.ip,
          createdAt: l.created_at,
        })),
        message: row ? "" : "缺少 platform_settings 行，将使用默认值；请执行 supabase/platform-settings.sql 与 platform-config-center.sql",
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const profile = await requireAdmin(req);
    const body = await parseBody(req);
    const action = String(body.action || "save").trim();
    const current = normalizeSettings((await loadSettingsRow())?.data || {});

    if (action === "save_team_lobby") {
      if (!isSuper(profile, req) && profile.role !== "admin" && profile.role !== "finance_admin" && profile.role !== "ops_admin") {
        return json(res, 403, { ok: false, message: "无权保存组队大厅设置" });
      }
      const enabled = bool(body.teamLobbyEnabled ?? body.enabled, false);
      const link = String(body.teamLobbyLink ?? body.link ?? body.url ?? "").trim();
      if (enabled && !link) {
        return json(res, 400, { ok: false, message: "启用前必须填写跳转链接" });
      }
      if (link && !/^https:\/\//i.test(link)) {
        return json(res, 400, { ok: false, message: "跳转链接必须是 https:// 开头的完整地址" });
      }
      const next = normalizeSettings({
        ...current,
        teamLobbyEnabled: enabled,
        teamLobbyLink: link,
      });
      const saved = await saveSettings(next, profile.id);
      await writeConfigLog({
        admin: profile,
        configType: "team_lobby",
        action: "save_team_lobby",
        beforeStatus: current.teamLobbyEnabled ? "启用" : "停用",
        afterStatus: saved.teamLobbyEnabled ? "启用" : "停用",
        reason: body.reason || "保存组队大厅设置",
        ip: clientIp(req),
      }).catch(() => null);
      return json(res, 200, {
        ok: true,
        message: "组队大厅设置已保存",
        settings: {
          teamLobbyEnabled: saved.teamLobbyEnabled,
          teamLobbyLink: saved.teamLobbyLink,
        },
      });
    }

    if (action === "save" || action === "save_platform_info" || action === "save_features" || action === "save_security" || action === "save_mail_public" || action === "save_ai_public" || action === "save_payments_public") {
      const next = normalizeSettings({ ...current, ...(body.settings || body) });
      // Never accept secret fields from settings payload
      delete next.smtpPass;
      delete next.aiApiKey;
      delete next.serviceRoleKey;
      const saved = await saveSettings(next, profile.id);
      // Bridge: 支付接入 must not be a second SoT. Mirror bank-my / channel public enables
      // into payment_channels so boss orderPayMethods stays consistent.
      if (action === "save_payments_public") {
        try {
          const pub = saved.paymentChannelsPublic || next.paymentChannelsPublic || {};
          const bankPub = pub["bank-my"] || pub["bank-transfer"] || null;
          if (bankPub && typeof bankPub === "object") {
            const enabled = bankPub.enabled !== false;
            const qrUrl = String(bankPub.qrUrl || bankPub.manual?.qrUrl || "").trim();
            const row = {
              id: "bank-transfer",
              channel_id: "bank-transfer",
              name: "银行转账",
              icon: "BANK",
              payment_type: "银行转账",
              category: "manual",
              currencies: ["MYR"],
              config_status: enabled ? "已启用" : "已停用",
              mode: "test",
              enabled,
              visible: enabled,
              sort: 6,
              data: {
                publicLabel: "银行卡",
                forOrder: bankPub.forOrder !== false,
                forRecharge: bankPub.forRecharge !== false,
                instructions: bankPub.instructions || "",
                qrUrl,
                manual: {
                  receiverName: bankPub.accountName || bankPub.receiverName || "",
                  bankName: bankPub.bankName || "",
                  bankAccount: bankPub.bankAccount || "",
                  duitnowId: bankPub.duitnowId || "",
                  qrUrl,
                },
              },
              updated_at: new Date().toISOString(),
            };
            await supabaseJson(restUrl("payment_channels"), {
              method: "POST",
              headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
              body: JSON.stringify([row]),
            });
          }
        } catch (bridgeErr) {
          console.warn("[platform-settings] payment_channels bridge failed", bridgeErr?.message || bridgeErr);
        }
      }
      await writeConfigLog({
        admin: profile,
        configType: action,
        action: "update_public_config",
        beforeStatus: "已配置",
        afterStatus: "已更新",
        reason: body.reason || "保存平台公开配置",
        ip: clientIp(req),
      });
      return json(res, 200, { ok: true, message: "配置已保存到 platform_settings", settings: saved });
    }

    if (action === "update_secret") {
      if (!isSuper(profile, req) && profile.role !== "admin" && profile.role !== "finance_admin") {
        return json(res, 403, { ok: false, message: "仅管理员可以替换敏感密钥" });
      }
      const vaultKey = String(body.vaultKey || body.secretKey || "").trim();
      const value = String(body.value || body.secret || "").trim();
      const reason = String(body.reason || "").trim();
      if (!vaultKey) return json(res, 400, { ok: false, message: "缺少密钥标识" });
      if (!value) return json(res, 400, { ok: false, message: "请输入新密钥" });
      if (!reason) return json(res, 400, { ok: false, message: "请填写修改原因" });
      if (/service_role|SUPABASE_SERVICE|SUPABASE_SECRET/i.test(vaultKey)) {
        return json(res, 400, {
          ok: false,
          message: "Supabase service_role / secret key 只能在服务器环境变量或 Vercel Secrets 中配置，不能通过网页写入。",
        });
      }
      if (!ALLOWED_VAULT_KEYS.has(vaultKey)) return json(res, 400, { ok: false, message: "不支持的密钥类型" });

      const before = await loadVaultCipher(vaultKey);
      const beforeStatus = before?.configured ? "已配置" : "未配置";
      const savedSecret = await upsertVaultSecret(vaultKey, value, profile.id);
      await writeConfigLog({
        admin: profile,
        configType: vaultKey,
        action: beforeStatus === "已配置" ? "replace_secret" : "configure_secret",
        beforeStatus,
        afterStatus: beforeStatus === "已配置" ? "已替换" : "已配置",
        reason,
        ip: clientIp(req),
      });
      return json(res, 200, {
        ok: true,
        message: "密钥已安全保存（加密存储，不会回显）",
        secret: { vaultKey, status: "已配置", masked: savedSecret?.masked || "••••", updatedAt: new Date().toISOString() },
      });
    }

    if (action === "save_service_config") {
      if (!isSuper(profile, req) && profile.role !== "admin" && profile.role !== "finance_admin") {
        return json(res, 403, { ok: false, message: "无权保存第三方服务配置" });
      }
      const serviceId = String(body.serviceId || body.service || "").trim();
      const service = serviceById(serviceId);
      if (!service) return json(res, 400, { ok: false, message: "未知服务" });
      const publicInput = body.public && typeof body.public === "object" ? body.public : body.settings || {};
      const secretsInput = body.secrets && typeof body.secrets === "object" ? body.secrets : {};
      const reason = String(body.reason || `保存 ${service.name} 配置`).trim();

      const nextPatch = {};
      for (const f of service.publicFields || []) {
        if (!Object.prototype.hasOwnProperty.call(publicInput, f.key)) continue;
        if (f.type === "boolean") nextPatch[f.key] = bool(publicInput[f.key], false);
        else if (f.type === "number") nextPatch[f.key] = Number(publicInput[f.key]);
        else nextPatch[f.key] = String(publicInput[f.key] ?? "").trim();
      }
      // Never accept secret plaintext into platform_settings
      delete nextPatch.smtpPass;
      delete nextPatch.aiApiKey;
      delete nextPatch.apiKey;
      delete nextPatch.secretKey;
      delete nextPatch.password;
      delete nextPatch.botToken;
      delete nextPatch.accessToken;

      const saved = await saveSettings(normalizeSettings({ ...current, ...nextPatch }), profile.id);

      const secretResults = [];
      for (const f of service.secretFields || []) {
        const raw = secretsInput[f.formKey] ?? secretsInput[f.vaultKey];
        const value = raw == null ? "" : String(raw).trim();
        if (!value) continue;
        // Skip if client sent the masked placeholder back
        if (/^•+|^\*+|已配置|留空/.test(value)) continue;
        const before = await loadVaultCipher(f.vaultKey);
        const beforeStatus = before?.configured ? "已配置" : "未配置";
        const savedSecret = await upsertVaultSecret(f.vaultKey, value, profile.id, f.label);
        secretResults.push({
          vaultKey: f.vaultKey,
          formKey: f.formKey,
          status: "已配置",
          masked: savedSecret?.masked || maskSecret(value),
        });
        await writeConfigLog({
          admin: profile,
          configType: `${serviceId}:${f.vaultKey}`,
          action: beforeStatus === "已配置" ? "replace_secret" : "configure_secret",
          beforeStatus,
          afterStatus: beforeStatus === "已配置" ? "已替换" : "已配置",
          reason,
          ip: clientIp(req),
        });
      }

      await writeConfigLog({
        admin: profile,
        configType: `service:${serviceId}`,
        action: "save_service_config",
        beforeStatus: "—",
        afterStatus: "已保存",
        reason,
        ip: clientIp(req),
      });

      const serviceConfigs = await buildServiceConfigs(saved);
      const cfg = serviceConfigs.find((s) => s.id === serviceId);
      return json(res, 200, {
        ok: true,
        message: `${service.name} 配置已保存（密钥加密存储，响应仅回显脱敏）`,
        settings: saved,
        serviceConfig: cfg,
        secretsUpdated: secretResults,
      });
    }

    if (action === "test_service") {
      const serviceId = String(body.serviceId || body.service || "").trim();
      if (!serviceId) return json(res, 400, { ok: false, message: "缺少 serviceId" });
      const result = await testServiceConnection(serviceId, current);
      await writeConfigLog({
        admin: profile,
        configType: `service:${serviceId}`,
        action: "test_service",
        beforeStatus: "—",
        afterStatus: result.ok ? "测试通过" : result.status || "失败",
        reason: result.message || "",
        ip: clientIp(req),
      });
      return json(res, result.ok ? 200 : 400, {
        ok: result.ok,
        status: result.status,
        message: result.message,
        serviceId,
      });
    }

    if (action === "run_diagnostics") {
      const diagnostics = await runDiagnostics();
      await writeConfigLog({
        admin: profile,
        configType: "diagnostics",
        action: "run_diagnostics",
        beforeStatus: "-",
        afterStatus: "已检测",
        reason: "一键接入检测",
        ip: clientIp(req),
      });
      return json(res, 200, { ok: true, diagnostics, message: "检测完成" });
    }

    if (action === "send_test_email") {
      if (!isSuper(profile, req) && profile.role !== "admin") {
        // allow admin to test if mail configured; secrets still not exposed
      }
      const to = String(body.to || body.email || "").trim();
      if (!to) return json(res, 400, { ok: false, message: "请输入测试邮箱" });
      const result = await sendTestMail({ to, settings: current, admin: profile });
      await writeConfigLog({
        admin: profile,
        configType: "mail",
        action: "send_test_email",
        beforeStatus: "已配置",
        afterStatus: "测试已发送",
        reason: `to=${to}`,
        ip: clientIp(req),
      });
      return json(res, 200, { ok: true, message: `测试邮件已发送至 ${to}`, result });
    }

    return json(res, 400, { ok: false, message: "未知系统设置操作" });
  } catch (error) {
    if (isMissingTable(error)) {
      return json(res, 503, {
        ok: false,
        configured: false,
        message: "缺少相关数据表，请执行 supabase/platform-settings.sql 与 supabase/platform-config-center.sql",
      });
    }
    return json(res, error.status || 500, { ok: false, message: error.message || "系统设置接口异常" });
  }
}
