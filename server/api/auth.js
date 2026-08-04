import fs from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import { formatBossCode, parseBossCodeNumber, resolveBossPublicCode } from "./_account-codes.js";
import {
  decodeDataUrl,
  ensurePublicBucket,
  uploadPrivateObject,
  publicObjectUrl,
  buildObjectPath,
} from "./_companion-media-store.js";
import { sendEmailOtp, sendSmsOtp, mailProviderStatus } from "./_mail.js";
import {
  storeOtp,
  findOtp,
  markOtpVerified,
  findRegisterVerified as findRegisterVerifiedRow,
  consumeRegisterVerified,
  randomOtpCode as sharedRandomOtpCode,
} from "./_otp-store.js";

const VALID_ROLES = new Set(["boss", "companion", "customer_service", "admin", "super_admin"]);
const TABLES = ["profiles", "companion_profiles", "orders", "conversations", "messages", "transactions", "banners", "announcements", "customer_service_reports"];
const BOSS_AVATAR_BUCKET = String(process.env.SUPABASE_AVATAR_BUCKET || "avatars").trim() || "avatars";
const BOSS_AVATAR_MAX_BYTES = 4 * 1024 * 1024;
const BOSS_AVATAR_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const COUNTRY_DIAL = {
  MY: "+60",
  CN: "+86",
  SG: "+65",
  TW: "+886",
  HK: "+852",
  JP: "+81",
  KR: "+82",
  TH: "+66",
  ID: "+62",
  PH: "+63",
  VN: "+84",
  US: "+1",
  GB: "+44",
  AU: "+61",
  CA: "+1",
  DE: "+49",
  FR: "+33",
};

loadLocalEnv();

function isMissingColumnError(error) {
  const msg = String(error?.message || error || "");
  return /country_code|phone_e164|Could not find the '|schema cache|PGRST204|42703/i.test(msg);
}

function normalizeCountryCode(value) {
  const code = String(value || "MY").trim().toUpperCase() || "MY";
  return /^[A-Z]{2}$/.test(code) ? code : "MY";
}

function dialForCountry(code) {
  return COUNTRY_DIAL[normalizeCountryCode(code)] || "+60";
}

function nationalPhoneDigits(value) {
  let digits = String(value || "").replace(/\D+/g, "");
  if (digits.charAt(0) === "0") digits = digits.slice(1);
  return digits.slice(0, 30);
}

function normalizeE164(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return "";
  return raw.startsWith("+") ? `+${digits}` : `+${digits}`;
}

/** Phone uniqueness for bosses (and any profile with phone_e164). Empty phone skips check. */
async function assertPhoneAvailable(phoneE164, exceptUserId = "") {
  const e164 = normalizeE164(phoneE164);
  if (!e164 || e164.length < 8) return;
  try {
    let query = `?phone_e164=eq.${encodeURIComponent(e164)}&select=id,email,role&limit=1`;
    if (exceptUserId) query += `&id=neq.${encodeURIComponent(exceptUserId)}`;
    const rows = await supabaseJson(restUrl("profiles", query), { headers: headersWithServiceRole() });
    if (Array.isArray(rows) && rows.length) {
      throw Object.assign(new Error("该手机号已注册，请更换号码或直接登录。"), { status: 400 });
    }
  } catch (error) {
    if (error?.status === 400) throw error;
    if (isMissingColumnError(error)) return;
    throw error;
  }
}

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}

function envValue(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  if (key === "SUPABASE_ANON_KEY") return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  return process.env[key] || "";
}

function envStatus() {
  const missing = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].filter((key) => !envValue(key));
  return { configured: missing.length === 0, missing };
}

function json(res, status, data) {
  res.status(status).json(data);
}

function applyCors(req, res) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return false;
  const configured = String(process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowed =
    configured.includes(origin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin) ||
    /^https:\/\/[\w.-]+\.vercel\.app$/i.test(origin);
  if (!allowed) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, x-mcj-access-token");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");
  return true;
}

function headersWithServiceRole(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const base = {
    apikey: key,
    "Content-Type": "application/json",
    "User-Agent": "MCJ-Server/1.0",
    ...extra,
  };
  if (!key.startsWith("sb_secret_")) base.Authorization = `Bearer ${key}`;
  return base;
}

function authHeaders(extra = {}) {
  return {
    apikey: envValue("SUPABASE_ANON_KEY"),
    "Content-Type": "application/json",
    ...extra,
  };
}

function authUrl(route) {
  return `${envValue("SUPABASE_URL")}/auth/v1/${route}`;
}

function restUrl(table, query = "") {
  return `${envValue("SUPABASE_URL")}/rest/v1/${table}${query}`;
}

function redirectFor(role) {
  const key = String(role || "").trim();
  if (key === "super_admin") return "/admin/";
  return {
    boss: "/index.html",
    companion: "/companion/dashboard/",
    customer_service: "/customer-service/dashboard/",
    admin: "/admin/",
  }[key] || "/index.html";
}

function metaBossUid(authUser = {}) {
  return String(authUser?.user_metadata?.boss_uid || authUser?.app_metadata?.boss_uid || "").trim();
}

function safeProfile(profile = {}, authUser = {}) {
  let role = String(profile.role || "").trim();
  const roleLower = role.toLowerCase();
  // Frontend historically used "customer" for the same boss account.
  if (roleLower === "customer" || roleLower === "owner" || roleLower === "user") role = "boss";
  const bossUid = resolveBossPublicCode(profile, { bossUid: metaBossUid(authUser) });
  const isSelf = true; // session payload is always the authenticated user
  const countryCode = normalizeCountryCode(profile.country_code || profile.countryCode || "MY");
  const phoneE164 = String(profile.phone_e164 || profile.phoneE164 || "").trim();
  const dialCode = dialForCountry(countryCode);
  const out = {
    id: profile.id || authUser.id || "",
    bossUid,
    boss_uid: bossUid,
    uid: bossUid || profile.id || authUser.id || "",
    role,
    displayName: profile.display_name || authUser.user_metadata?.display_name || "",
    avatarUrl: profile.avatar_url || "",
    status: profile.status || "pending",
    createdAt: profile.created_at || authUser.created_at || "",
    lastSignInAt: authUser.last_sign_in_at || profile.last_sign_in_at || "",
    countryCode,
    country_code: countryCode,
    phoneE164,
    phone_e164: phoneE164,
    dialCode,
  };
  // Self-facing: boss/CS/companion may see own email/phone; never return password/secrets.
  if (isSelf && (role === "boss" || role === "companion" || role === "customer_service" || role === "admin" || role === "super_admin")) {
    out.email = profile.email || authUser.email || "";
    out.phone = profile.phone || authUser.phone || "";
  }
  if (role === "customer_service" && !out.displayName) out.displayName = "客服";
  if ((role === "admin" || role === "super_admin") && !out.displayName) out.displayName = "管理员";
  return out;
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
    const detail = body?.error_description || body?.msg || body?.message || body?.hint || body?.details || (typeof body === "string" ? body : "") || `${response.status} ${response.statusText}`;
    throw new Error(detail);
  }
  return body;
}

async function profileFor(userId) {
  const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(userId)}&limit=1`), {
    headers: headersWithServiceRole(),
  });
  return Array.isArray(rows) ? rows[0] : null;
}

function randomOtpCode() {
  return sharedRandomOtpCode();
}

function maskPhoneHint(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length < 7) return "";
  return `${d.slice(0, 3)}****${d.slice(-4)}`;
}

function maskEmailHint(email) {
  const s = String(email || "").trim();
  const at = s.indexOf("@");
  if (at < 1) return "";
  return `${s.slice(0, 1)}***${s.slice(at)}`;
}

function allowStagingOtp() {
  if (String(process.env.ALLOW_STAGING_OTP || "") === "1" || String(process.env.MCJ_OTP_DEBUG || "") === "1") {
    return true;
  }
  // Never expose OTP codes on production deployments.
  if (String(process.env.VERCEL_ENV || "").toLowerCase() === "production") return false;
  const base = String(process.env.MCJ_PUBLIC_BASE || process.env.VERCEL_URL || "");
  return /staging|localhost|127\.0\.0\.1/i.test(base) || String(process.env.VERCEL_ENV || "").toLowerCase() === "preview";
}

function normalizeForgotRole(roleRaw) {
  const role = String(roleRaw || "").trim().toLowerCase();
  if (role === "cs" || role === "service" || role === "customer-service") return "customer_service";
  if (role === "player" || role === "pw") return "companion";
  if (role === "customer" || role === "owner" || role === "user") return "boss";
  if (role === "companion" || role === "customer_service" || role === "boss") return role;
  return "boss";
}

function roleFilterSql(role) {
  if (role === "boss") return "or=(role.eq.boss,role.eq.customer,role.eq.owner,role.eq.user)";
  if (role === "companion") return "role=eq.companion";
  if (role === "customer_service") return "role=eq.customer_service";
  return `role=eq.${encodeURIComponent(role)}`;
}

async function profilesLookup(query) {
  return supabaseJson(restUrl("profiles", query), { headers: headersWithServiceRole() }).catch(() => []);
}

function profileMatchesRole(profile, role) {
  const r = String(profile?.role || "").trim().toLowerCase();
  if (role === "boss") return r === "boss" || r === "customer" || r === "owner" || r === "user";
  return r === role;
}

async function resolveForgotAccount(accountRaw, roleRaw) {
  const role = normalizeForgotRole(roleRaw);
  const account = String(accountRaw || "").trim();
  if (!account) return null;
  const select = "id,email,phone,phone_e164,display_name,status,role,boss_uid";

  // MVP: email is the auth recovery identity. Phone lookup is intentionally not used.
  if (/@/.test(account)) {
    const byEmail = await profilesLookup(
      `?email=eq.${encodeURIComponent(account.toLowerCase())}&select=${select}&limit=3`
    );
    const hit = (byEmail || []).find((row) => profileMatchesRole(row, role));
    if (hit?.id) return { profile: hit, via: "email", role };
  }

  return null;
}

function forgotAccountKey(profile) {
  return String(profile?.id || profile?.email || "").trim().toLowerCase();
}

function roleLabelOf(role) {
  if (role === "companion") return "陪玩端";
  if (role === "customer_service") return "客服端";
  if (role === "admin" || role === "super_admin") return "后台";
  return "老板端";
}

async function storeForgotOtp(accountKey, role, code, kind = "otp") {
  return storeOtp({ accountKey, role, code, kind });
}

async function findForgotOtp(accountKey, role, kind = "otp") {
  return findOtp(accountKey, role, kind);
}

async function createSessionForUserId(userId, email) {
  const link = await supabaseJson(authUrl("admin/generate_link"), {
    method: "POST",
    headers: headersWithServiceRole(),
    body: JSON.stringify({
      type: "magiclink",
      email: String(email || "").trim().toLowerCase(),
    }),
  });
  const hashed =
    link?.hashed_token ||
    link?.properties?.hashed_token ||
    link?.email_otp_hash ||
    "";
  if (!hashed) {
    throw Object.assign(new Error("无法创建登录会话，请改用密码登录或稍后重试。"), { status: 500 });
  }
  let verified;
  try {
    verified = await supabaseJson(authUrl("verify"), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ type: "magiclink", token_hash: hashed }),
    });
  } catch {
    verified = await supabaseJson(authUrl("verify"), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ type: "email", token_hash: hashed }),
    });
  }
  if (!verified?.access_token) {
    throw Object.assign(new Error("验证码登录失败，请改用密码登录。"), { status: 401 });
  }
  return verified;
}

async function handleForgotSendOtp(body, res) {
  const role = normalizeForgotRole(body.role);
  const account = String(body.email || body.account || body.phone || "").trim();
  const genericOk = {
    ok: true,
    message: "如该邮箱已绑定账号，将收到验证码邮件。请查收后继续。",
    channel: "email",
    expiresInSec: 900,
  };
  if (!account) return json(res, 400, { ok: false, message: "请输入绑定邮箱。" });
  if (!/@/.test(account)) {
    return json(res, 400, { ok: false, message: "请输入有效邮箱地址。" });
  }
  const resolved = await resolveForgotAccount(account, role);
  if (!resolved?.profile || resolved.profile.status === "disabled") return json(res, 200, genericOk);
  const profile = resolved.profile;
  const email = String(profile.email || account).trim().toLowerCase();
  if (!email || !/@/.test(email)) return json(res, 200, genericOk);
  const code = randomOtpCode();
  const key = forgotAccountKey(profile);
  await storeForgotOtp(key, role, code, "otp");
  // MVP: email only. SMS stub kept for later international release.
  void sendSmsOtp({ phone: profile.phone || profile.phone_e164 || "", code, purpose: "forgot" });
  let mailOk = false;
  let mailError = "";
  try {
    await sendEmailOtp({ to: email, code, purpose: "forgot", roleLabel: roleLabelOf(role) });
    mailOk = true;
  } catch (err) {
    mailError = String(err?.message || err || "");
  }
  const mailStatus = mailProviderStatus();
  const out = {
    ok: true,
    message: mailOk
      ? `验证码已发送至邮箱 ${maskEmailHint(email)}。`
      : allowStagingOtp()
        ? mailStatus.resend
          ? `验证码邮件发送失败：${mailError || "Resend 错误"}。已生成 Staging 调试验证码（${maskEmailHint(email)}）。`
          : `邮件服务暂不可用（未读到 RESEND_API_KEY），已生成 Staging 调试验证码（${maskEmailHint(email)}）。`
        : `如该邮箱已绑定账号，将收到验证码邮件。请查收后继续。`,
    channel: "email",
    emailMasked: maskEmailHint(email),
    phoneMasked: "",
    expiresInSec: 900,
    role,
    mail: mailStatus,
  };
  // Only expose Staging debug OTP when mail actually failed.
  if (!mailOk && allowStagingOtp()) out.devCode = code;
  if (!mailOk && allowStagingOtp() && mailError) out.mailWarning = mailError;
  if (!mailOk) console.error("[auth/forgot_send_otp] mail failed", mailError, mailStatus);
  return json(res, 200, out);
}

async function handleLoginSendOtp(body, res) {
  const role = normalizeForgotRole(body.role || "boss");
  if (role === "customer_service" || role === "admin" || role === "super_admin") {
    return json(res, 400, { ok: false, message: "该端请使用邮箱密码登录。" });
  }
  const email = String(body.email || body.account || "").trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return json(res, 400, { ok: false, message: "请输入有效邮箱。" });
  }
  const generic = {
    ok: true,
    message: "如该邮箱已注册，将收到登录验证码。",
    channel: "email",
    expiresInSec: 900,
  };
  const resolved = await resolveForgotAccount(email, role);
  if (!resolved?.profile || resolved.profile.status === "disabled") return json(res, 200, generic);
  const profile = resolved.profile;
  const code = randomOtpCode();
  const key = forgotAccountKey(profile);
  try {
    await storeForgotOtp(key, role, code, "login_otp");
  } catch (storeErr) {
    return json(res, storeErr?.status || 503, {
      ok: false,
      message: storeErr?.message || "验证码存储失败，请稍后重试。",
      mail: mailProviderStatus(),
    });
  }
  void sendSmsOtp({ phone: profile.phone || "", code, purpose: "login" });
  let mailOk = false;
  let mailError = "";
  try {
    await sendEmailOtp({ to: String(profile.email || email).toLowerCase(), code, purpose: "login", roleLabel: roleLabelOf(role) });
    mailOk = true;
  } catch (err) {
    mailError = String(err?.message || err || "");
  }
  const mailStatus = mailProviderStatus();
  const out = {
    ok: true,
    message: mailOk
      ? `登录验证码已发送至 ${maskEmailHint(profile.email || email)}。`
      : allowStagingOtp()
        ? mailStatus.resend
          ? `验证码邮件发送失败：${mailError || "Resend 错误"}。已生成 Staging 调试验证码。`
          : "邮件服务暂不可用（未读到 RESEND_API_KEY），已生成 Staging 调试验证码。"
        : generic.message,
    channel: "email",
    emailMasked: maskEmailHint(profile.email || email),
    expiresInSec: 900,
    role,
    mail: mailStatus,
  };
  // Only expose Staging debug OTP when mail actually failed.
  if (!mailOk && allowStagingOtp()) out.devCode = code;
  if (!mailOk && allowStagingOtp() && mailError) out.mailWarning = mailError;
  if (!mailOk) console.error("[auth/send_login_otp] mail failed", mailError, mailStatus);
  return json(res, 200, out);
}

async function handleLoginWithOtp(body, res) {
  const role = normalizeForgotRole(body.role || "boss");
  if (role === "customer_service" || role === "admin" || role === "super_admin") {
    return json(res, 400, { ok: false, message: "该端请使用邮箱密码登录。" });
  }
  const email = String(body.email || body.account || "").trim().toLowerCase();
  const code = String(body.code || body.otp || "").trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { ok: false, message: "请输入有效邮箱。" });
  if (!/^\d{4,8}$/.test(code)) return json(res, 400, { ok: false, message: "验证码无效或已过期" });
  const resolved = await resolveForgotAccount(email, role);
  if (!resolved?.profile) return json(res, 400, { ok: false, message: "验证码无效或已过期" });
  const profile0 = resolved.profile;
  if (profile0.status && profile0.status !== "active") {
    return json(res, 403, { ok: false, message: "账号未启用或正在审核。" });
  }
  const key = forgotAccountKey(profile0);
  const stored = await findForgotOtp(key, role, "login_otp");
  if (!stored?.code || String(stored.code) !== code || Number(stored.exp) <= Date.now()) {
    return json(res, 400, { ok: false, message: "验证码无效或已过期" });
  }
  const auth = await createSessionForUserId(profile0.id, profile0.email || email);
  let profile = await profileFor(auth.user?.id || profile0.id);
  if (!profile) profile = profile0;
  if (["boss", "customer", "owner", "user"].includes(String(profile.role || "").trim().toLowerCase())) {
    try {
      profile = await ensureBossUid({ ...profile, role: "boss" }, auth.user);
    } catch {
      /* keep login usable */
    }
  }
  const user = safeProfile(profile, {
    ...(auth.user || {}),
    user_metadata: { ...((auth.user && auth.user.user_metadata) || {}), boss_uid: profile.boss_uid || metaBossUid(auth.user) },
  });
  if (!VALID_ROLES.has(user.role)) return json(res, 403, { ok: false, message: "账号角色无效。" });
  if (user.status !== "active") return json(res, 403, { ok: false, message: "账号未启用或正在审核。" });
  if (stored.id) {
    await supabaseJson(restUrl("password_reset_requests", `?id=eq.${encodeURIComponent(stored.id)}`), {
      method: "PATCH",
      headers: headersWithServiceRole(),
      body: JSON.stringify({ status: `used_login:${Date.now()}` }),
    }).catch(() => null);
  }
  return json(res, 200, {
    ok: true,
    message: "登录成功",
    session: {
      accessToken: auth.access_token,
      refreshToken: auth.refresh_token,
      expiresAt: auth.expires_at,
      user,
    },
    redirect: redirectFor(user.role),
  });
}

/** Register OTP is keyed by email (account may not exist yet). */
function registerOtpAccountKey(email) {
  return String(email || "").trim().toLowerCase();
}

async function markRegisterVerified(emailKey, role, rowId, token) {
  return markOtpVerified(emailKey, role, "register_otp", rowId, token, 30 * 60 * 1000);
}

async function findRegisterVerified(emailKey, role, token) {
  return findRegisterVerifiedRow(emailKey, role, token);
}

/**
 * Consume a one-time register email verification token.
 * Used by companion register so accounts cannot be created without OTP.
 */
export async function consumeRegisterEmailToken(emailRaw, tokenRaw, roleRaw = "companion") {
  const role = normalizeForgotRole(roleRaw || "companion");
  const email = registerOtpAccountKey(emailRaw);
  const token = String(tokenRaw || "").trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    throw Object.assign(new Error("请输入有效邮箱。"), { status: 400 });
  }
  if (!token) {
    throw Object.assign(new Error("请先完成邮箱验证。"), { status: 400 });
  }
  return consumeRegisterVerified(email, role, token);
}

/** Companion API consumes register tokens without importing the full auth handler. */
export async function assertRegisterEmailVerified(emailRaw, tokenRaw, roleRaw = "companion") {
  return consumeRegisterEmailToken(emailRaw, tokenRaw, roleRaw);
}

async function handleSendRegisterOtp(body, res) {
  const role = normalizeForgotRole(body.role || "companion");
  if (role !== "companion" && role !== "boss") {
    return json(res, 400, { ok: false, message: "该端不支持邮箱注册验证码。" });
  }
  const email = registerOtpAccountKey(body.email || body.account);
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return json(res, 400, { ok: false, message: "请输入有效邮箱。" });
  }
  const existing = await profilesLookup(
    `?email=eq.${encodeURIComponent(email)}&select=id,email,role,status&limit=5`
  ).catch(() => []);
  const companionHit = (existing || []).find((row) => String(row.role || "").toLowerCase() === "companion");
  if (companionHit) {
    return json(res, 409, { ok: false, message: "该邮箱已有陪玩账号，请切换到「已有账号登录」。" });
  }
  const otherHit = (existing || []).find((row) => String(row.role || "").toLowerCase() !== "companion");
  if (otherHit) {
    return json(res, 409, {
      ok: false,
      message: "该邮箱已被其他角色占用，请更换邮箱后再注册陪玩。",
    });
  }
  const code = randomOtpCode();
  try {
    await storeForgotOtp(email, role, code, "register_otp");
  } catch (storeErr) {
    return json(res, storeErr?.status || 503, {
      ok: false,
      message: storeErr?.message || "验证码存储失败，请稍后重试。",
      mail: mailProviderStatus(),
    });
  }
  let mailOk = false;
  let mailError = "";
  try {
    await sendEmailOtp({ to: email, code, purpose: "register", roleLabel: roleLabelOf(role) });
    mailOk = true;
  } catch (err) {
    mailError = String(err?.message || err || "");
  }
  const mailStatus = mailProviderStatus();
  const out = {
    ok: true,
    message: mailOk
      ? `注册验证码已发送至 ${maskEmailHint(email)}。`
      : allowStagingOtp()
        ? mailStatus.resend
          ? `验证码邮件发送失败：${mailError || "Resend 错误"}。已生成 Staging 调试验证码。`
          : "邮件服务暂不可用（未读到 RESEND_API_KEY），已生成 Staging 调试验证码。"
        : "如邮箱可用，将收到注册验证码，请查收后继续。",
    channel: "email",
    emailMasked: maskEmailHint(email),
    expiresInSec: 900,
    role,
    mail: mailStatus,
  };
  if (!mailOk && allowStagingOtp()) out.devCode = code;
  if (!mailOk && allowStagingOtp() && mailError) out.mailWarning = mailError;
  if (!mailOk) console.error("[auth/send_register_otp] mail failed", mailError, mailStatus);
  return json(res, 200, out);
}

async function handleVerifyRegisterOtp(body, res) {
  const role = normalizeForgotRole(body.role || "companion");
  const email = registerOtpAccountKey(body.email || body.account);
  const code = String(body.code || body.otp || "").trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return json(res, 400, { ok: false, message: "请输入有效邮箱。" });
  }
  if (!/^\d{6}$/.test(code)) {
    return json(res, 400, { ok: false, message: "请输入 6 位邮箱验证码。" });
  }
  const stored = await findForgotOtp(email, role, "register_otp");
  if (!stored?.code || String(stored.code) !== code) {
    return json(res, 400, { ok: false, message: "验证码错误，请重新输入。" });
  }
  if (Number(stored.exp) <= Date.now()) {
    return json(res, 400, { ok: false, message: "验证码已过期，请重新发送。" });
  }
  const token = `reg_${randomOtpCode()}${Date.now().toString(36)}`;
  await markRegisterVerified(email, role, stored.id, token);
  return json(res, 200, {
    ok: true,
    message: "邮箱已验证",
    emailVerified: true,
    registerToken: token,
    email,
    emailMasked: maskEmailHint(email),
    expiresInSec: 1800,
  });
}

async function markForgotVerified(accountKey, role, rowId, token) {
  const exp = Date.now() + 15 * 60 * 1000;
  if (rowId) {
    await supabaseJson(restUrl("password_reset_requests", `?id=eq.${encodeURIComponent(rowId)}`), {
      method: "PATCH",
      headers: headersWithServiceRole(),
      body: JSON.stringify({ status: `verified:${token}:exp:${exp}` }),
    }).catch(() => null);
  }
  globalThis.__mcjForgotResets = globalThis.__mcjForgotResets || new Map();
  globalThis.__mcjForgotResets.set(`${role}:otp:${accountKey}`, { id: rowId || token, verifiedToken: token, exp, kind: "otp" });
  globalThis.__mcjForgotResets.set(`${role}:${accountKey}`, { id: rowId || token, verifiedToken: token, exp, kind: "otp" });
  return exp;
}

async function handleForgotVerifyOtp(body, res) {
  const role = normalizeForgotRole(body.role);
  const account = String(body.email || body.account || body.phone || "").trim();
  const code = String(body.code || body.otp || "").trim();
  if (!account || !/^\d{4,8}$/.test(code)) {
    return json(res, 400, { ok: false, message: "验证码无效或已过期" });
  }
  const resolved = await resolveForgotAccount(account, role);
  if (!resolved?.profile) return json(res, 400, { ok: false, message: "验证码无效或已过期" });
  const key = forgotAccountKey(resolved.profile);
  const stored = await findForgotOtp(key, role, "otp");
  if (stored && stored.code && String(stored.code) === code && Number(stored.exp) > Date.now()) {
    const token = `mcj_${randomOtpCode()}${Date.now().toString(36)}`;
    await markForgotVerified(key, role, stored.id, token);
    return json(res, 200, {
      ok: true,
      message: "验证成功，请设置新密码",
      resetToken: token,
      emailMasked: maskEmailHint(resolved.profile.email || account),
      phoneMasked: "",
    });
  }
  return json(res, 400, { ok: false, message: "验证码无效或已过期" });
}

async function handleForgotResetPassword(body, res) {
  const role = normalizeForgotRole(body.role);
  const newPassword = String(body.newPassword || body.password || "");
  const confirmPassword = String(body.confirmPassword || body.confirm_password || "");
  if (!newPassword || newPassword.length < 8) return json(res, 400, { ok: false, message: "新密码至少 8 位" });
  if (confirmPassword && confirmPassword !== newPassword) {
    return json(res, 400, { ok: false, message: "两次输入的新密码不一致" });
  }
  const resetToken = String(body.resetToken || body.token || "").trim();
  const account = String(body.email || body.account || body.phone || "").trim();
  if (!resetToken.startsWith("mcj_")) return json(res, 400, { ok: false, message: "请先完成验证码校验" });
  const resolved = await resolveForgotAccount(account, role);
  if (!resolved?.profile?.id) return json(res, 400, { ok: false, message: "缺少账号信息" });
  const key = forgotAccountKey(resolved.profile);
  const stored = await findForgotOtp(key, role, "otp");
  if (!stored || stored.verifiedToken !== resetToken || Number(stored.exp) < Date.now()) {
    return json(res, 400, { ok: false, message: "重置凭证无效或已过期，请重新获取验证码" });
  }
  await supabaseJson(authUrl(`admin/users/${encodeURIComponent(resolved.profile.id)}`), {
    method: "PUT",
    headers: headersWithServiceRole(),
    body: JSON.stringify({ password: newPassword }),
  });
  if (globalThis.__mcjForgotResets) {
    globalThis.__mcjForgotResets.delete(`${role}:otp:${key}`);
    globalThis.__mcjForgotResets.delete(`${role}:${key}`);
  }
  if (stored.id) {
    await supabaseJson(restUrl("password_reset_requests", `?id=eq.${encodeURIComponent(stored.id)}`), {
      method: "PATCH",
      headers: headersWithServiceRole(),
      body: JSON.stringify({ status: `used:${Date.now()}` }),
    }).catch(() => null);
  }
  return json(res, 200, { ok: true, message: "密码修改成功，请重新登录。" });
}

async function allocateBossUid() {
  const rows = await supabaseJson(
    restUrl("profiles", "?role=eq.boss&select=boss_uid&boss_uid=not.is.null&order=created_at.desc&limit=500"),
    { headers: headersWithServiceRole() }
  ).catch(() => []);
  let next = 1;
  for (const row of Array.isArray(rows) ? rows : []) {
    const n = parseBossCodeNumber(row?.boss_uid);
    if (n) next = Math.max(next, n + 1);
  }
  try {
    const authUsers = await supabaseJson(authUrl("admin/users?page=1&per_page=200"), {
      headers: headersWithServiceRole(),
    });
    const list = authUsers?.users || authUsers || [];
    for (const u of Array.isArray(list) ? list : []) {
      const n = parseBossCodeNumber(metaBossUid(u));
      if (n) next = Math.max(next, n + 1);
    }
  } catch {
    /* optional */
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = formatBossCode(next + attempt);
    const existing = await supabaseJson(
      restUrl("profiles", `?boss_uid=eq.${encodeURIComponent(candidate)}&select=id&limit=1`),
      { headers: headersWithServiceRole() }
    ).catch(() => []);
    if (!Array.isArray(existing) || existing.length === 0) return candidate;
  }
  return formatBossCode(next + Date.now() % 1000);
}

async function persistBossUidMeta(userId, bossUid, authUser = {}) {
  const prevMeta = authUser?.user_metadata && typeof authUser.user_metadata === "object" ? authUser.user_metadata : {};
  await supabaseJson(authUrl(`admin/users/${encodeURIComponent(userId)}`), {
    method: "PUT",
    headers: headersWithServiceRole(),
    body: JSON.stringify({ user_metadata: { ...prevMeta, boss_uid: bossUid } }),
  });
}

async function ensureBossUid(profile, authUser = null) {
  if (!profile?.id) return profile;
  let existing = String(profile.boss_uid || metaBossUid(authUser || {}) || "").trim();
  // Normalize legacy B100001 → MCJ00001 for consistent display across ends.
  if (existing && /^B\d+$/i.test(existing)) {
    const n = parseBossCodeNumber(existing);
    if (n) existing = formatBossCode(n);
  } else if (existing) {
    existing = resolveBossPublicCode({ boss_uid: existing }) || existing;
  }
  if (existing) {
    if (!profile.boss_uid || profile.boss_uid !== existing) {
      try {
        const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(profile.id)}`), {
          method: "PATCH",
          headers: headersWithServiceRole({ Prefer: "return=representation" }),
          body: JSON.stringify({ boss_uid: existing }),
        });
        const saved = Array.isArray(rows) ? rows[0] : null;
        if (saved?.boss_uid) {
          try {
            await persistBossUidMeta(profile.id, saved.boss_uid, authUser || {});
          } catch {
            /* best-effort */
          }
          return saved;
        }
      } catch {
        /* column may be missing — keep metadata UID */
      }
    }
    return { ...profile, boss_uid: existing };
  }
  let lastError = null;
  let columnMissing = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const bossUid = await allocateBossUid();
    if (!bossUid) break;
    try {
      const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(profile.id)}`), {
        method: "PATCH",
        headers: headersWithServiceRole({ Prefer: "return=representation" }),
        body: JSON.stringify({ boss_uid: bossUid }),
      });
      const saved = Array.isArray(rows) ? rows[0] : { ...profile, boss_uid: bossUid };
      if (saved?.boss_uid) {
        try {
          await persistBossUidMeta(profile.id, saved.boss_uid, authUser || {});
        } catch {
          /* best-effort mirror */
        }
        return saved;
      }
    } catch (error) {
      lastError = error;
      const detail = String(error.message || "");
      if (/boss_uid|schema cache|Could not find/i.test(detail)) {
        columnMissing = true;
        try {
          await persistBossUidMeta(profile.id, bossUid, authUser || {});
          return { ...profile, boss_uid: bossUid };
        } catch (metaErr) {
          lastError = metaErr;
        }
        break;
      }
    }
  }
  if (columnMissing) {
    const fallback = formatBossCode(Date.now() % 100000 || 1);
    try {
      await persistBossUidMeta(profile.id, fallback, authUser || {});
      return { ...profile, boss_uid: fallback };
    } catch {
      /* fall through */
    }
  }
  throw new Error(lastError?.message || "老板编号生成失败，请稍后重试。");
}

async function userFromToken(token) {
  return supabaseJson(authUrl("user"), {
    headers: authHeaders({ Authorization: `Bearer ${token}` }),
  });
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    return json(res, 204, { ok: true });
  }

  const action = String(req.method === "GET" ? req.query.action || "health" : req.body?.action || "").trim();
  const env = envStatus();

  if (req.method === "GET" && action === "health") {
    return json(res, 200, { ok: true, configured: env.configured, missing: env.missing, tables: TABLES });
  }

  if (!env.configured) {
    return json(res, 503, {
      ok: false,
      configured: false,
      message: `未配置 ${env.missing.join(" / ")}，无法进行真实数据库登录。`,
      missing: env.missing,
    });
  }

  try {
    if (req.method === "GET" && action === "me") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { ok: false, message: "未登录" });
      const authUser = await userFromToken(token);
      let profile = await profileFor(authUser.id);
      if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料，请联系管理员。" });
      if (["boss", "customer", "owner", "user"].includes(String(profile.role || "").trim().toLowerCase())) {
        try {
          profile = await ensureBossUid({ ...profile, role: "boss" }, authUser);
        } catch {
          /* keep session usable */
        }
      }
      const user = safeProfile(profile, authUser);
      if (!VALID_ROLES.has(user.role)) return json(res, 403, { ok: false, message: "账号角色无效。" });
      if (user.status !== "active") return json(res, 403, { ok: false, message: "账号未启用或正在审核。" });
      let pendingForced = [];
      let forcedAckRequired = false;
      if (["boss", "customer", "owner", "user"].includes(String(user.role || "").toLowerCase())) {
        try {
          const acks = await import("./_content-acks.js");
          pendingForced = await acks.pendingForcedForUser(profile.id, { audience: "boss" });
          forcedAckRequired = pendingForced.length > 0;
        } catch {
          /* optional */
        }
      }
      return json(res, 200, { ok: true, user, redirect: redirectFor(user.role), pendingForced, forcedAckRequired });
    }

    if (req.method === "GET" && action === "pending_forced") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { ok: false, message: "未登录" });
      const authUser = await userFromToken(token);
      const profile = await profileFor(authUser.id);
      if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料。" });
      const pending = await (await import("./_content-acks.js")).pendingForcedForUser(profile.id, { audience: "boss" });
      return json(res, 200, { ok: true, pendingForced: pending, forcedAckRequired: pending.length > 0 });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return json(res, 405, { ok: false, message: "Method Not Allowed" });
    }

    const body = await parseBody(req);
    const requestedAction = String(body.action || "login");
    if (requestedAction === "acknowledge_forced" || requestedAction === "ack_forced") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { ok: false, message: "未登录" });
      const authUser = await userFromToken(token);
      const profile = await profileFor(authUser.id);
      if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料。" });
      const contentId = String(body.content_id || body.contentId || body.id || "").trim();
      const contentVersion = String(body.content_version || body.contentVersion || body.version || "1").trim() || "1";
      const contentType = String(body.content_type || body.contentType || "player_rules").trim() || "player_rules";
      if (!contentId) return json(res, 400, { ok: false, message: "缺少内容 ID" });
      const acks = await import("./_content-acks.js");
      const pending = await acks.pendingForcedForUser(profile.id, { audience: "boss" });
      const match = pending.find((p) => String(p.id) === contentId);
      if (!match && contentType !== "announcement") {
        return json(res, 404, { ok: false, message: "强制内容不存在或已确认" });
      }
      const ip = String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "").split(",")[0].trim();
      const saved = await acks.acknowledgeContent({
        userId: profile.id,
        contentType: match?.contentType || contentType,
        contentId,
        contentVersion: contentVersion || match?.version || "1",
        effectiveAt: match?.publishedAt || "",
        contentUpdatedAt: match?.updatedAt || "",
        ip,
        userAgent: String(req.headers["user-agent"] || ""),
      });
      const still = await acks.pendingForcedForUser(profile.id, { audience: "boss" });
      return json(res, 200, {
        ok: true,
        message: "已确认阅读",
        ack: saved,
        pendingForced: still,
        forcedAckRequired: still.length > 0,
      });
    }
    if (requestedAction === "upload_avatar") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { ok: false, message: "未登录" });
      const authUser = await userFromToken(token);
      const profile = await profileFor(authUser.id);
      if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料。" });
      if (profile.status !== "active") return json(res, 403, { ok: false, message: "账号未启用。" });
      if (profile.role !== "boss") return json(res, 403, { ok: false, message: "仅老板账号可上传头像。" });
      const dataUrl = body.data_url || body.dataUrl || body.file;
      if (!dataUrl) return json(res, 400, { ok: false, message: "请选择要上传的头像图片。" });
      const decoded = decodeDataUrl(dataUrl);
      if (!decoded || !decoded.buffer) {
        return json(res, 400, { ok: false, message: "文件格式无效，请选择 jpg / png / webp 图片。" });
      }
      const mime = String(decoded.contentType || "").toLowerCase();
      const normalized = mime === "image/jpg" ? "image/jpeg" : mime;
      if (!BOSS_AVATAR_MIME.has(normalized) && !BOSS_AVATAR_MIME.has(mime)) {
        return json(res, 400, { ok: false, message: "仅支持 JPG、PNG、WEBP 格式，最大 4MB。" });
      }
      if (decoded.buffer.length > BOSS_AVATAR_MAX_BYTES) {
        return json(res, 413, { ok: false, message: "头像不能超过 4MB，请压缩后再试。" });
      }
      try {
        await ensurePublicBucket(BOSS_AVATAR_BUCKET, ["image/jpeg", "image/png", "image/webp"]);
      } catch (bucketErr) {
        return json(res, 503, {
          ok: false,
          message: `头像存储桶不可用：${bucketErr.message || "请稍后重试"}`,
        });
      }
      const objectPath = buildObjectPath(authUser.id, "avatar", body.filename || body.fileName || "avatar.jpg");
      try {
        await uploadPrivateObject(BOSS_AVATAR_BUCKET, objectPath, decoded.buffer, normalized || "image/jpeg");
      } catch (uploadErr) {
        return json(res, 502, {
          ok: false,
          message: `上传到云存储失败：${uploadErr.message || "请稍后重试"}`,
        });
      }
      const publicUrl = publicObjectUrl(BOSS_AVATAR_BUCKET, objectPath);
      if (!publicUrl) {
        return json(res, 502, { ok: false, message: "上传成功但无法生成头像地址，请重试。" });
      }
      return json(res, 200, {
        ok: true,
        message: "头像上传成功",
        url: publicUrl,
        avatarUrl: publicUrl,
        bucket: BOSS_AVATAR_BUCKET,
        path: objectPath,
        storage: "supabase_storage",
      });
    }
    if (requestedAction === "update_profile") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { ok: false, message: "未登录" });
      const authUser = await userFromToken(token);
      const profile = await profileFor(authUser.id);
      if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料。" });
      if (profile.status !== "active") return json(res, 403, { ok: false, message: "账号未启用。" });
      const patch = {};
      if (typeof body.displayName === "string") patch.display_name = body.displayName.trim().slice(0, 40);
      if (typeof body.phone === "string") patch.phone = nationalPhoneDigits(body.phone) || body.phone.trim().slice(0, 30);
      if (typeof body.avatarUrl === "string") patch.avatar_url = body.avatarUrl.trim().slice(0, 500);
      if (typeof body.countryCode === "string" || typeof body.country_code === "string") {
        patch.country_code = normalizeCountryCode(body.countryCode || body.country_code);
      }
      if (typeof body.phoneE164 === "string" || typeof body.phone_e164 === "string") {
        patch.phone_e164 = normalizeE164(body.phoneE164 || body.phone_e164).slice(0, 32);
      } else if ((patch.country_code || profile.country_code) && typeof body.phone === "string") {
        const local = nationalPhoneDigits(body.phone);
        const cc = patch.country_code || profile.country_code || "MY";
        patch.phone_e164 = local ? normalizeE164(`${dialForCountry(cc)}${local}`).slice(0, 32) : "";
      }
      if (typeof body.email === "string") {
        const nextEmail = body.email.trim().toLowerCase().slice(0, 120);
        if (nextEmail && nextEmail !== String(profile.email || authUser.email || "").toLowerCase()) {
          patch.email = nextEmail;
        }
      }
      if (!Object.keys(patch).length) return json(res, 400, { ok: false, message: "没有可保存的资料。" });
      if (patch.phone_e164) {
        try {
          await assertPhoneAvailable(patch.phone_e164, authUser.id);
        } catch (phoneErr) {
          return json(res, phoneErr.status || 400, { ok: false, message: phoneErr.message || "该手机号已注册。" });
        }
      }
      let savedRows;
      try {
        savedRows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(authUser.id)}`), {
          method: "PATCH",
          headers: headersWithServiceRole({ Prefer: "return=representation" }),
          body: JSON.stringify(patch),
        });
      } catch (patchError) {
        if (/duplicate|unique|phone_e164/i.test(String(patchError.message || ""))) {
          return json(res, 400, { ok: false, message: "该手机号已注册，请更换号码。" });
        }
        if (!isMissingColumnError(patchError)) throw patchError;
        const fallbackPatch = { ...patch };
        delete fallbackPatch.country_code;
        delete fallbackPatch.phone_e164;
        if (!Object.keys(fallbackPatch).length) {
          return json(res, 200, { ok: true, message: "资料已保存", user: safeProfile(profile, authUser), redirect: redirectFor(profile.role) });
        }
        savedRows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(authUser.id)}`), {
          method: "PATCH",
          headers: headersWithServiceRole({ Prefer: "return=representation" }),
          body: JSON.stringify(fallbackPatch),
        });
      }
      const saved = Array.isArray(savedRows) ? savedRows[0] : { ...profile, ...patch };
      return json(res, 200, { ok: true, message: "资料已保存", user: safeProfile(saved, authUser), redirect: redirectFor(saved.role) });
    }
    if (requestedAction === "change_password") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { ok: false, message: "未登录" });
      const authUser = await userFromToken(token);
      const profile = await profileFor(authUser.id);
      if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料。" });
      if (profile.status !== "active") return json(res, 403, { ok: false, message: "账号未启用。" });
      const currentPassword = String(body.currentPassword || body.oldPassword || "");
      const newPassword = String(body.newPassword || body.password || "");
      const confirmPassword = String(body.confirmPassword || "");
      if (!currentPassword || !newPassword) return json(res, 400, { ok: false, message: "请填写当前密码和新密码。" });
      if (confirmPassword && confirmPassword !== newPassword) return json(res, 400, { ok: false, message: "两次输入的新密码不一致。" });
      if (newPassword.length < 6) return json(res, 400, { ok: false, message: "新密码至少 6 位。" });
      const email = String(profile.email || authUser.email || "").trim().toLowerCase();
      if (!email) return json(res, 400, { ok: false, message: "账号缺少邮箱，无法验证当前密码。" });
      await supabaseJson(authUrl("token?grant_type=password"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email, password: currentPassword }),
      });
      await supabaseJson(authUrl("user"), {
        method: "PUT",
        headers: authHeaders({ Authorization: `Bearer ${token}` }),
        body: JSON.stringify({ password: newPassword }),
      });
      return json(res, 200, { ok: true, message: "密码已更新" });
    }
    if (requestedAction === "refresh") {
      const refreshToken = String(body.refreshToken || body.refresh_token || "").trim();
      if (!refreshToken) return json(res, 400, { ok: false, message: "缺少 refreshToken。" });
      const auth = await supabaseJson(authUrl("token?grant_type=refresh_token"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const authUser = auth.user || (auth.access_token ? await userFromToken(auth.access_token).catch(() => null) : null);
      const profile = authUser ? await profileFor(authUser.id) : null;
      if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料，请联系管理员。" });
      const user = safeProfile(profile, authUser || {});
      if (!VALID_ROLES.has(user.role)) return json(res, 403, { ok: false, message: "账号角色无效。" });
      if (user.status !== "active") return json(res, 403, { ok: false, message: "账号未启用或正在审核。" });
      return json(res, 200, {
        ok: true,
        session: {
          accessToken: auth.access_token,
          refreshToken: auth.refresh_token || refreshToken,
          expiresAt: auth.expires_at,
          user,
        },
        redirect: redirectFor(user.role),
      });
    }
    if (requestedAction === "register") {
      const email = String(body.email || body.account || "").trim().toLowerCase();
      const password = String(body.password || "");
      const displayName = String(body.displayName || body.nickname || body.name || "").trim().slice(0, 40);
      const countryCode = normalizeCountryCode(body.countryCode || body.country_code || "MY");
      const dialCode = String(body.dialCode || body.dial_code || dialForCountry(countryCode)).trim() || dialForCountry(countryCode);
      // MVP: auth is email-only. Phone fields are ignored for registration (kept for schema compat).
      let phoneE164 = "";
      let phone = "";
      void dialCode;
      void body.phone;
      void body.phoneE164;
      void body.phone_e164;
      if (!email || !password) return json(res, 400, { ok: false, message: "请输入邮箱和密码。" });
      if (password.length < 6) return json(res, 400, { ok: false, message: "密码至少 6 位。" });
      let created;
      try {
        created = await supabaseJson(authUrl("admin/users"), {
          method: "POST",
          headers: headersWithServiceRole(),
          body: JSON.stringify({
            email,
            password,
            email_confirm: true,
            user_metadata: { display_name: displayName || email.split("@")[0] || "老板" },
          }),
        });
      } catch (error) {
        let message = String(error.message || "").trim();
        if (/user already registered|already.*(registered|exists)|duplicate|unique/i.test(message)) {
          message = "该邮箱已注册，请直接登录。";
        }
        return json(res, 400, { ok: false, message: message || "注册失败，请检查邮箱是否已存在。" });
      }
      const userId = created?.id || created?.user?.id;
      if (!userId) return json(res, 500, { ok: false, message: "Auth 账号创建失败，未返回用户 ID。" });
      let profile;
      try {
        const baseProfile = {
          id: userId,
          role: "boss",
          display_name: displayName || email.split("@")[0] || "老板",
          email,
          phone,
          avatar_url: "",
          status: "active",
          created_at: new Date().toISOString(),
        };
        const intlProfile = {
          ...baseProfile,
          country_code: countryCode,
          phone_e164: phoneE164 || "",
        };
        let bossUid = "";
        try {
          bossUid = await allocateBossUid();
        } catch {
          bossUid = "";
        }
        let rows;
        async function insertProfile(payload) {
          return supabaseJson(restUrl("profiles"), {
            method: "POST",
            headers: headersWithServiceRole({ Prefer: "return=representation" }),
            body: JSON.stringify(payload),
          });
        }
        try {
          rows = await insertProfile(bossUid ? { ...intlProfile, boss_uid: bossUid } : intlProfile);
        } catch (insertError) {
          const detail = String(insertError.message || "");
          if (isMissingColumnError(insertError)) {
            try {
              rows = await insertProfile(bossUid ? { ...baseProfile, boss_uid: bossUid } : baseProfile);
            } catch (retryError) {
              if (/boss_uid|schema cache/i.test(String(retryError.message || "")) && bossUid) {
                rows = await insertProfile(baseProfile);
              } else {
                throw retryError;
              }
            }
          } else if (/boss_uid|schema cache/i.test(detail) && bossUid) {
            try {
              rows = await insertProfile(intlProfile);
            } catch (retryIntl) {
              if (isMissingColumnError(retryIntl)) {
                rows = await insertProfile(baseProfile);
              } else {
                throw retryIntl;
              }
            }
          } else {
            throw insertError;
          }
        }
        profile = Array.isArray(rows) ? rows[0] : rows;
        try {
          profile = await ensureBossUid(profile, created?.user || created || { id: userId, user_metadata: { display_name: displayName } });
        } catch (uidError) {
          // Last resort: still register, but surface empty UID only if metadata also fails.
          const detail = String(uidError.message || "");
          if (!/boss_uid|schema cache|Could not find|Auth|metadata|user/i.test(detail)) throw uidError;
          profile = { ...(profile || baseProfile), boss_uid: profile?.boss_uid || "" };
        }
      } catch (error) {
        try {
          await supabaseJson(authUrl(`admin/users/${encodeURIComponent(userId)}`), {
            method: "DELETE",
            headers: headersWithServiceRole(),
          });
        } catch {
          /* best-effort rollback */
        }
        return json(res, 500, {
          ok: false,
          message: `老板资料创建失败：${error.message || "未知错误"}。Auth 账号已回滚，请重试。`,
        });
      }
      const auth = await supabaseJson(authUrl("token?grant_type=password"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email, password }),
      });
      const authUser = auth.user || { id: userId, email, user_metadata: { boss_uid: profile?.boss_uid } };
      const user = safeProfile(profile, authUser);
      const bossUidOut = user.bossUid || user.boss_uid || "";
      return json(res, 200, {
        ok: true,
        message: bossUidOut ? `注册成功。您的老板 UID：${bossUidOut}` : "注册成功。",
        bossUid: bossUidOut || undefined,
        session: {
          accessToken: auth.access_token,
          refreshToken: auth.refresh_token,
          expiresAt: auth.expires_at,
          user,
        },
        redirect: redirectFor("boss"),
      });
    }
    if (
      requestedAction === "forgot_send_otp" ||
      requestedAction === "forgot_password" ||
      requestedAction === "send_reset_code"
    ) {
      return handleForgotSendOtp(body, res);
    }
    if (requestedAction === "forgot_verify_otp" || requestedAction === "verify_reset_code") {
      return handleForgotVerifyOtp(body, res);
    }
    if (requestedAction === "forgot_reset_password" || requestedAction === "reset_password") {
      return handleForgotResetPassword(body, res);
    }
    if (
      requestedAction === "send_login_otp" ||
      requestedAction === "login_send_otp" ||
      requestedAction === "email_login_otp"
    ) {
      return handleLoginSendOtp(body, res);
    }
    if (
      requestedAction === "login_with_otp" ||
      requestedAction === "login_otp" ||
      requestedAction === "verify_login_otp"
    ) {
      return handleLoginWithOtp(body, res);
    }
    if (
      requestedAction === "send_register_otp" ||
      requestedAction === "register_send_otp" ||
      requestedAction === "email_register_otp"
    ) {
      return handleSendRegisterOtp(body, res);
    }
    if (
      requestedAction === "verify_register_otp" ||
      requestedAction === "register_verify_otp" ||
      requestedAction === "verify_email_otp"
    ) {
      return handleVerifyRegisterOtp(body, res);
    }
    if (requestedAction === "mail_status") {
      return json(res, 200, { ok: true, mail: mailProviderStatus() });
    }
    if (requestedAction === "mail_ping") {
      if (!allowStagingOtp()) {
        return json(res, 403, { ok: false, message: "mail_ping 仅 Staging / Preview 可用。" });
      }
      const to = String(body.to || body.email || "").trim().toLowerCase();
      if (!to || !/^\S+@\S+\.\S+$/.test(to)) {
        return json(res, 400, { ok: false, message: "请提供 to 邮箱。", mail: mailProviderStatus() });
      }
      try {
        const { sendMail } = await import("./_mail.js");
        const result = await sendMail({
          to,
          subject: "妙脆角 · Resend 探活邮件",
          text: "这是 Staging mail_ping 探活邮件。若你收到此信，说明 RESEND_API_KEY / RESEND_FROM 已生效。",
          html: "<p>这是 Staging <b>mail_ping</b> 探活邮件。若你收到此信，说明 Resend 已生效。</p>",
          purpose: "mail_ping",
        });
        return json(res, 200, { ok: true, message: "探活邮件已发送", result, mail: mailProviderStatus() });
      } catch (err) {
        return json(res, 502, {
          ok: false,
          message: String(err?.message || err || "发送失败"),
          mail: mailProviderStatus(),
        });
      }
    }
    if (requestedAction !== "login") return json(res, 400, { ok: false, message: "未知登录操作" });
    const email = String(body.email || body.account || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) return json(res, 400, { ok: false, message: "请输入邮箱和密码。" });

    const auth = await supabaseJson(authUrl("token?grant_type=password"), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ email, password }),
    });
    const authUser = auth.user;
    let profile = await profileFor(authUser.id);
    if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料，请联系管理员。" });
    if (["boss", "customer", "owner", "user"].includes(String(profile.role || "").trim().toLowerCase())) {
      try {
        profile = await ensureBossUid({ ...profile, role: "boss" }, authUser);
      } catch {
        /* keep login usable even if UID backfill fails */
      }
    }
    const user = safeProfile(profile, { ...authUser, user_metadata: { ...(authUser?.user_metadata || {}), boss_uid: profile.boss_uid || metaBossUid(authUser) } });
    if (!VALID_ROLES.has(user.role)) return json(res, 403, { ok: false, message: "账号角色无效。" });
    if (user.status !== "active") return json(res, 403, { ok: false, message: "账号未启用或正在审核。" });

    return json(res, 200, {
      ok: true,
      session: {
        accessToken: auth.access_token,
        refreshToken: auth.refresh_token,
        expiresAt: auth.expires_at,
        user,
      },
      redirect: redirectFor(user.role),
    });
  } catch (error) {
    const action = String((req.body && req.body.action) || req.query?.action || "");
    let message = String(error.message || "").trim();
    if (/failed to fetch|fetch failed|network|econnrefused|enotfound|timeout/i.test(message)) {
      message = "暂时无法连接服务器，请稍后重试";
    } else if (/invalid login credentials|invalid.*(email|password)|email not confirmed/i.test(message)) {
      message = "邮箱或密码错误。";
    }
    if (action === "change_password" || action === "update_profile" || action === "upload_avatar") {
      const status = /密码|password|credentials|invalid|邮箱或密码|格式|超过|4MB|jpg|png|webp/i.test(message) ? 400 : 401;
      const fallback =
        action === "change_password" ? "修改密码失败。" : action === "upload_avatar" ? "头像上传失败。" : "保存资料失败。";
      return json(res, status, { ok: false, message: message || fallback });
    }
    const fallback = action === "refresh" ? "refreshToken 已失效，请重新登录。" : "邮箱或密码错误。";
    return json(res, 401, { ok: false, message: message || fallback });
  }
}


