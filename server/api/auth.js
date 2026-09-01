import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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
import { validatePassword, PASSWORD_RULE_HINT } from "./_password-policy.js";
import {
  resolveHasPassword,
  resolveMustChangePassword,
  resolveEmailVerified,
  securityPublicFields,
  stampPasswordSet,
  stampPasswordUnset,
  markMustChangePassword,
  revokeUserSessions,
  touchLastLogin,
  NO_PASSWORD_LOGIN_MESSAGE,
  RESET_EMAIL_GENERIC_MESSAGE,
  logSecurityAdminAction,
} from "./_account-security.js";
import {
  classifyAuthPortalIntent,
  shouldHealAsBoss,
  repairDeniedMessage,
  maxBossUidNumberFromList,
} from "./_auth-orphan-heal.js";
import {
  userCanAccessPortal as sharedUserCanAccessPortal,
  computeCapabilities,
  isBossLikeRole,
  enrichProfileRoles,
} from "./_account-roles.js";

function opaqueSystemPassword() {
  // Never shown to users/admins — only satisfies GoTrue's password requirement
  // for OTP-first accounts that have not chosen a login password yet.
  return `Mcj!${crypto.randomBytes(24).toString("base64url")}`;
}
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_FAILS = 8;

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

function normalizeLoginPortal(raw) {
  const p = String(raw || "")
    .trim()
    .toLowerCase();
  if (!p || p === "public" || p === "unified" || p === "auto" || p === "any") return "";
  if (p === "cs" || p === "service" || p === "customer-service") return "customer_service";
  if (p === "player" || p === "pw") return "companion";
  if (p === "customer" || p === "owner" || p === "user") return "boss";
  if (p === "super_admin" || p === "superadmin") return "admin";
  if (p === "boss" || p === "companion" || p === "customer_service" || p === "admin") return p;
  return "";
}

function portalDeniedMessage(portal) {
  if (portal === "boss") return "该账号暂无老板端权限";
  if (portal === "companion") return "该账号暂无陪玩端权限";
  if (portal === "customer_service") return "该账号暂无客服权限";
  if (portal === "admin") return "该账号暂无管理员权限";
  return "账号角色与当前入口不匹配。";
}

/** Unified portal gate — single capability resolver (same as _account-roles.userCanAccessPortal). */
function userHasPortalAccess(user, portal) {
  return sharedUserCanAccessPortal(user, portal);
}

/** Merge GoTrue session user with admin user so app_metadata roles are never dropped. */
async function authUserForCapabilities(sessionUser = {}, fallbackId = "") {
  const sid = String(sessionUser?.id || fallbackId || "").trim();
  let full = null;
  if (sid) {
    try {
      full = await findAuthUserById(sid);
    } catch {
      full = null;
    }
  }
  const base = full && typeof full === "object" ? full : {};
  const session = sessionUser && typeof sessionUser === "object" ? sessionUser : {};
  return {
    ...base,
    ...session,
    id: session.id || base.id || sid,
    email: session.email || base.email || "",
    app_metadata: { ...(base.app_metadata || {}), ...(session.app_metadata || {}) },
    user_metadata: { ...(base.user_metadata || {}), ...(session.user_metadata || {}) },
    raw_app_meta_data: base.raw_app_meta_data || session.raw_app_meta_data,
    raw_user_meta_data: base.raw_user_meta_data || session.raw_user_meta_data,
  };
}

/** Role picker only for public unified login when account truly has boss+companion (never staff). */
function computeNeedRolePick(user, loginPortal) {
  if (loginPortal) return false;
  const role = String(user?.role || "").toLowerCase();
  if (role === "admin" || role === "super_admin" || role === "customer_service" || role === "service") return false;
  return !!(user?.hasBoss && user?.hasCompanion);
}

function metaBossUid(authUser = {}) {
  return String(authUser?.user_metadata?.boss_uid || authUser?.app_metadata?.boss_uid || "").trim();
}

function safeProfile(profile = {}, authUser = {}, security = null, rolesInfo = null) {
  let role = String(profile.role || "").trim();
  const roleLower = role.toLowerCase();
  // Frontend historically used "customer" for the same boss account.
  if (roleLower === "customer" || roleLower === "owner" || roleLower === "user") role = "boss";
  const bossUid = resolveBossPublicCode(profile, { bossUid: metaBossUid(authUser) });
  const isSelf = true; // session payload is always the authenticated user
  const countryCode = normalizeCountryCode(profile.country_code || profile.countryCode || "MY");
  const phoneE164 = String(profile.phone_e164 || profile.phoneE164 || "").trim();
  const dialCode = dialForCountry(countryCode);
  const roles = Array.isArray(rolesInfo?.roles)
    ? rolesInfo.roles
    : Array.isArray(profile.roles)
      ? profile.roles
      : role
        ? [roleLower === "boss" ? "boss" : roleLower]
        : [];
  // Single source: rolesInfo from computeCapabilities / enrichProfileRoles.
  // Belt-and-suspenders: profiles.role boss-like always grants hasBoss.
  let hasBoss = rolesInfo ? !!rolesInfo.hasBoss : roles.includes("boss") || role === "boss";
  let hasCompanion = rolesInfo ? !!rolesInfo.hasCompanion : roles.includes("companion") || roleLower === "companion";
  if (role === "boss" || roleLower === "boss" || roleLower === "customer" || roleLower === "owner" || roleLower === "user") {
    hasBoss = true;
    if (!roles.includes("boss")) roles.push("boss");
  }
  if (hasBoss && roleLower === "companion") {
    // Session-facing role for Boss portal compatibility when capability says Boss.
    role = "boss";
  }
  const out = {
    id: profile.id || authUser.id || "",
    bossUid,
    boss_uid: bossUid,
    uid: bossUid || profile.id || authUser.id || "",
    role,
    roles,
    hasBoss,
    hasCompanion,
    displayName: profile.display_name || authUser.user_metadata?.display_name || "",
    avatarUrl: profile.avatar_url || "",
    status: profile.status || "pending",
    createdAt: profile.created_at || authUser.created_at || "",
    lastSignInAt: authUser.last_sign_in_at || profile.last_sign_in_at || profile.last_login_at || "",
    countryCode,
    country_code: countryCode,
    phoneE164,
    phone_e164: phoneE164,
    dialCode,
  };
  // Self-facing: boss/CS/companion may see own email/phone; never return password/secrets.
  if (isSelf && (role === "boss" || role === "companion" || hasBoss || hasCompanion || role === "customer_service" || role === "admin" || role === "super_admin")) {
    out.email = profile.email || authUser.email || "";
    out.phone = profile.phone || authUser.phone || "";
  }
  if (role === "customer_service" && !out.displayName) out.displayName = "客服";
  if ((role === "admin" || role === "super_admin") && !out.displayName) out.displayName = "管理员";
  if (security && typeof security === "object") {
    Object.assign(out, securityPublicFields(profile, authUser, !!security.hasPassword));
  }
  return out;
}

async function enrichSafeProfile(profile = {}, authUser = {}) {
  const mergedAuth = await authUserForCapabilities(authUser, profile?.id);
  const hasPassword = await resolveHasPassword(profile, mergedAuth, { probeAuth: true });
  let rolesInfo = null;
  try {
    const enriched = await enrichProfileRoles(profile, mergedAuth);
    rolesInfo = enriched;
    profile = enriched.profile || profile;
  } catch {
    /* optional — still fall back to profiles.role via computeCapabilities */
    try {
      rolesInfo = computeCapabilities(profile, { authUser: mergedAuth });
    } catch {
      rolesInfo = null;
    }
  }
  return safeProfile(profile, mergedAuth, { hasPassword }, rolesInfo);
}

/** Prefer the profile row that matches the login portal capability. */
function pickProfileForLoginPortal(rows, portal, authUser = null) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!list.length) return null;
  const want = String(portal || "").trim().toLowerCase();
  if (want === "boss") {
    const hit = list.find((row) => isBossLikeRole(row?.role) || computeCapabilities(row, { authUser }).hasBoss);
    if (hit) return hit;
  }
  if (want === "companion") {
    const hit = list.find((row) => {
      const caps = computeCapabilities(row, { authUser });
      return caps.hasCompanion || String(row?.role || "").trim().toLowerCase() === "companion";
    });
    if (hit) return hit;
  }
  return list[0];
}

function canManagePassword(profile = {}) {
  const st = String(profile.status || "").toLowerCase();
  return st !== "disabled";
}

function canLoginWithStatus(profile = {}, role = "") {
  const st = String(profile.status || "").toLowerCase();
  if (st === "disabled") return false;
  const r = String(role || profile.role || "").toLowerCase();
  // Companion: pending/rejected may still manage account & login.
  if (r === "companion") return st === "active" || st === "pending" || st === "rejected" || st === "";
  return st === "active" || st === "";
}

function assertEmailVerifiedOrThrow(profile = {}, authUser = {}) {
  if (resolveEmailVerified(profile, authUser)) return;
  throw Object.assign(new Error("请先完成邮箱验证。"), { status: 403, code: "EMAIL_NOT_VERIFIED" });
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "")
    .split(",")[0]
    .trim()
    .slice(0, 64);
}

function otpFailBucket() {
  globalThis.__mcjOtpFails = globalThis.__mcjOtpFails || new Map();
  return globalThis.__mcjOtpFails;
}

function assertOtpNotRateLimited(key) {
  const row = otpFailBucket().get(key);
  if (row && Number(row.fails || 0) >= OTP_MAX_FAILS && Date.now() - Number(row.at || 0) < OTP_TTL_MS) {
    throw Object.assign(new Error("验证码错误次数过多，请稍后再试。"), { status: 429 });
  }
}

function recordOtpFail(key) {
  const map = otpFailBucket();
  const prev = map.get(key) || { fails: 0, at: Date.now() };
  map.set(key, { fails: Number(prev.fails || 0) + 1, at: Date.now() });
}

function clearOtpFails(key) {
  otpFailBucket().delete(key);
}

async function assertOtpResendCooldown(accountKey, role, kind = "otp") {
  const key = `${String(role || "").toLowerCase()}:${String(kind || "otp")}:${String(accountKey || "").toLowerCase()}`;
  globalThis.__mcjOtpCooldown = globalThis.__mcjOtpCooldown || new Map();
  const last = Number(globalThis.__mcjOtpCooldown.get(key) || 0);
  const wait = OTP_RESEND_COOLDOWN_MS - (Date.now() - last);
  if (last && wait > 0) {
    throw Object.assign(new Error(`发送过于频繁，请 ${Math.ceil(wait / 1000)} 秒后再试。`), {
      status: 429,
      retryAfterSec: Math.ceil(wait / 1000),
    });
  }
  globalThis.__mcjOtpCooldown.set(key, Date.now());
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
  if (role === "super_admin" || role === "superadmin") return "admin";
  if (role === "companion" || role === "customer_service" || role === "boss" || role === "admin") return role;
  return "boss";
}

function roleFilterSql(role) {
  if (role === "boss") return "or=(role.eq.boss,role.eq.customer,role.eq.owner,role.eq.user)";
  if (role === "companion") return "role=eq.companion";
  if (role === "customer_service") return "role=eq.customer_service";
  if (role === "admin") return "or=(role.eq.admin,role.eq.super_admin)";
  return `role=eq.${encodeURIComponent(role)}`;
}

async function profilesLookup(query) {
  return supabaseJson(restUrl("profiles", query), { headers: headersWithServiceRole() }).catch(() => []);
}

function profileMatchesRole(profile, role) {
  const r = String(profile?.role || "").trim().toLowerCase();
  if (role === "boss") return r === "boss" || r === "customer" || r === "owner" || r === "user";
  if (role === "admin") return r === "admin" || r === "super_admin";
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
    let hit = (byEmail || []).find((row) => profileMatchesRole(row, role));
    // Dual-role / staff-primary (e.g. admin + companion_profiles): primary role alone
    // must not block companion/boss portal OTP. Match portal capability via enrichment.
    if (!hit?.id && (role === "companion" || role === "boss") && Array.isArray(byEmail)) {
      for (const row of byEmail) {
        if (!row?.id) continue;
        try {
          const enriched = await enrichProfileRoles(row);
          if (role === "companion" && enriched?.hasCompanion) {
            hit = row;
            break;
          }
          if (role === "boss" && enriched?.hasBoss) {
            hit = row;
            break;
          }
        } catch {
          /* best-effort capability lookup */
        }
      }
    }
    if (hit?.id) return { profile: hit, via: "email", role };
  }

  return null;
}

/** Auth user by email (GoTrue admin). Used by register/OTP orphan gates. */
async function findAuthUserByEmail(email) {
  const target = String(email || "").trim().toLowerCase();
  if (!target || !/@/.test(target)) return null;
  try {
    const body = await supabaseJson(authUrl(`admin/users?email=${encodeURIComponent(target)}`), {
      headers: headersWithServiceRole(),
    });
    if (Array.isArray(body?.users) && body.users.length) {
      return body.users.find((u) => String(u.email || "").toLowerCase() === target) || null;
    }
    if (body?.id && String(body.email || "").toLowerCase() === target) return body;
  } catch {
    /* fall through */
  }
  try {
    const body = await supabaseJson(authUrl("admin/users?page=1&per_page=200"), {
      headers: headersWithServiceRole(),
    });
    const users = Array.isArray(body?.users) ? body.users : [];
    return users.find((u) => String(u.email || "").toLowerCase() === target) || null;
  } catch {
    return null;
  }
}

async function findAuthUserById(userId) {
  const id = String(userId || "").trim();
  if (!id) return null;
  try {
    const raw = await supabaseJson(authUrl(`admin/users/${encodeURIComponent(id)}`), {
      headers: headersWithServiceRole(),
    });
    return raw?.user && typeof raw.user === "object" ? raw.user : raw;
  } catch {
    return null;
  }
}

function isAuthUserBanned(authUser = {}) {
  if (authUser?.banned === true) return true;
  const until = authUser?.banned_until || authUser?.ban_duration;
  if (!until) return false;
  const ts = Date.parse(String(until));
  if (!Number.isFinite(ts)) return !!authUser?.banned;
  return ts > Date.now();
}

/**
 * Delete an Auth user we just created in THIS request. Verifies deletion.
 * Never call for pre-existing accounts.
 */
async function rollbackCreatedAuthUser(userId, context = "") {
  const id = String(userId || "").trim();
  if (!id) {
    throw Object.assign(new Error("Auth 回滚失败：缺少用户 ID。"), {
      status: 500,
      code: "AUTH_ROLLBACK_FAILED",
    });
  }
  let deleteErr = null;
  try {
    await supabaseJson(authUrl(`admin/users/${encodeURIComponent(id)}`), {
      method: "DELETE",
      headers: headersWithServiceRole(),
    });
  } catch (err) {
    deleteErr = err;
    console.error("[auth/rollback] DELETE failed", context, id, err?.message || err);
  }
  const still = await findAuthUserById(id);
  if (still?.id) {
    console.error("[auth/rollback] Auth user still present after DELETE", context, id);
    throw Object.assign(
      new Error("老板资料创建失败，且 Auth 账号回滚未成功。请联系客服，勿重复注册。"),
      { status: 500, code: "AUTH_ROLLBACK_FAILED", cause: deleteErr }
    );
  }
  if (deleteErr) {
    // DELETE threw but user is gone — treat as success with log.
    console.warn("[auth/rollback] DELETE errored but user gone", context, id, deleteErr?.message || deleteErr);
  }
  return { ok: true, rolledBack: true };
}

function loginOtpAccountKey(email) {
  return String(email || "").trim().toLowerCase();
}

/** Detect companion traces that must block Boss auto-heal. */
async function loadHealExtrasForAuthUser(authUser = {}) {
  const userId = String(authUser?.id || "").trim();
  const extras = { companionProfileExists: false, hasCompanionTrace: false };
  if (!userId) return extras;
  try {
    const rows = await supabaseJson(
      restUrl("companion_profiles", `?user_id=eq.${encodeURIComponent(userId)}&select=id,user_id&limit=1`),
      { headers: headersWithServiceRole() }
    ).catch(() => []);
    if (Array.isArray(rows) && rows[0]?.id) {
      extras.companionProfileExists = true;
      extras.hasCompanionTrace = true;
    }
  } catch {
    /* best-effort */
  }
  return extras;
}

async function assertCanHealBossOrThrow(authUser) {
  const extras = await loadHealExtrasForAuthUser(authUser);
  if (!shouldHealAsBoss(authUser, extras)) {
    const intent = classifyAuthPortalIntent(authUser, extras);
    throw Object.assign(new Error(repairDeniedMessage(intent)), {
      status: 403,
      code: "ACCOUNT_NEEDS_REPAIR",
      intent,
    });
  }
  return extras;
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
  return storeOtp({ accountKey, role, code, kind, ttlMs: OTP_TTL_MS });
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
    message: RESET_EMAIL_GENERIC_MESSAGE,
    channel: "email",
    expiresInSec: Math.floor(OTP_TTL_MS / 1000),
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
  try {
    await assertOtpResendCooldown(forgotAccountKey(profile), role, "otp");
  } catch (err) {
    return json(res, err.status || 429, {
      ok: false,
      message: err.message || "发送过于频繁，请稍后再试。",
      retryAfterSec: err.retryAfterSec || 60,
    });
  }
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
        : RESET_EMAIL_GENERIC_MESSAGE,
    channel: "email",
    emailMasked: maskEmailHint(email),
    phoneMasked: "",
    expiresInSec: Math.floor(OTP_TTL_MS / 1000),
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
    return json(res, 400, { ok: false, message: "该端请使用邮箱密码登录。", mailSent: false });
  }
  const email = loginOtpAccountKey(body.email || body.account);
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return json(res, 400, { ok: false, message: "请输入有效邮箱。", mailSent: false });
  }
  // Unified public shape for non-send paths — reduces account enumeration; frontend must not countdown.
  const privacy = {
    ok: true,
    mailSent: false,
    message: "如该邮箱已注册，将收到登录验证码。",
    channel: "email",
    expiresInSec: Math.floor(OTP_TTL_MS / 1000),
  };

  const authUser = await findAuthUserByEmail(email);
  if (!authUser?.id || isAuthUserBanned(authUser)) {
    return json(res, 200, privacy);
  }

  let profile = (await resolveForgotAccount(email, role))?.profile || (await profileFor(authUser.id));
  if (!profile) {
    if (role === "companion") {
      console.warn("[auth/send_login_otp] companion portal orphan — no auto boss heal");
      return json(res, 200, privacy);
    }
    try {
      await assertCanHealBossOrThrow(authUser);
      profile = await ensureBossProfileForAuthUser(authUser);
    } catch (healErr) {
      console.error("[auth/send_login_otp] orphan heal skipped/failed", healErr?.code || "", healErr?.message || healErr);
      return json(res, 200, privacy);
    }
  }

  if (String(profile.status || "").toLowerCase() === "disabled") {
    return json(res, 200, privacy);
  }
  if (!resolveEmailVerified(profile, authUser)) {
    return json(res, 200, privacy);
  }

  const otpKey = forgotAccountKey(profile) || loginOtpAccountKey(email);
  try {
    await assertOtpResendCooldown(otpKey, role, "login_otp");
  } catch (err) {
    return json(res, err.status || 429, {
      ok: false,
      mailSent: false,
      message: err.message || "发送过于频繁，请稍后再试。",
      retryAfterSec: err.retryAfterSec || 60,
    });
  }
  const code = randomOtpCode();
  try {
    await storeForgotOtp(otpKey, role, code, "login_otp");
  } catch (storeErr) {
    console.error("[auth/send_login_otp] store failed", storeErr?.message || storeErr);
    return json(res, 200, privacy);
  }
  void sendSmsOtp({ phone: profile.phone || "", code, purpose: "login" });
  let mailOk = false;
  let mailError = "";
  try {
    await sendEmailOtp({
      to: String(profile.email || email).toLowerCase(),
      code,
      purpose: "login",
      roleLabel: roleLabelOf(role),
    });
    mailOk = true;
  } catch (err) {
    mailError = String(err?.message || err || "");
  }
  const mailStatus = mailProviderStatus();
  if (!mailOk) {
    console.error("[auth/send_login_otp] mail failed", mailError, mailStatus);
    if (allowStagingOtp()) {
      return json(res, 200, {
        ...privacy,
        message: mailStatus.resend
          ? `验证码邮件发送失败：${mailError || "Resend 错误"}。已生成 Staging 调试验证码。`
          : "邮件服务暂不可用（未读到 RESEND_API_KEY），已生成 Staging 调试验证码。",
        mail: mailStatus,
        devCode: code,
        mailWarning: mailError || undefined,
      });
    }
    return json(res, 200, privacy);
  }
  return json(res, 200, {
    ok: true,
    mailSent: true,
    message: privacy.message,
    channel: "email",
    expiresInSec: Math.floor(OTP_TTL_MS / 1000),
    role,
  });
}

async function handleLoginWithOtp(body, res) {
  const role = normalizeForgotRole(body.role || body.loginPortal || "boss");
  if (role === "customer_service" || role === "admin" || role === "super_admin") {
    return json(res, 400, { ok: false, message: "该端请使用邮箱密码登录。" });
  }
  const email = String(body.email || body.account || "").trim().toLowerCase();
  const code = String(body.code || body.otp || "").trim();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { ok: false, message: "请输入有效邮箱。" });
  if (!/^\d{4,8}$/.test(code)) return json(res, 400, { ok: false, message: "验证码无效或已过期" });
  const loginPortal = normalizeLoginPortal(body.loginPortal || body.portal || body.role || "");
  // Same resolution order as send_login_otp: email rows → forgot resolve → Auth id profile → Boss orphan heal.
  // Select only real columns (profiles.role exists; do not require profiles.roles).
  const authUserEarly = await findAuthUserByEmail(email);
  const byEmail = await profilesLookup(
    `?email=eq.${encodeURIComponent(email)}&select=id,email,phone,phone_e164,display_name,status,role,boss_uid&limit=5`
  ).catch(() => []);
  let profile0 =
    pickProfileForLoginPortal(byEmail, loginPortal || role, authUserEarly) ||
    (await resolveForgotAccount(email, loginPortal || role).catch(() => null))?.profile ||
    (authUserEarly?.id ? await profileFor(authUserEarly.id) : null) ||
    null;
  if (!profile0) {
    if (authUserEarly?.id && (loginPortal || role) !== "companion") {
      try {
        profile0 = await ensureBossProfileForAuthUser(authUserEarly);
      } catch (healErr) {
        console.error("[auth/login_with_otp] orphan heal failed", healErr?.code || "", healErr?.message || healErr);
        return json(res, healErr?.status || 403, {
          ok: false,
          code: healErr?.code || "ACCOUNT_NEEDS_REPAIR",
          message: healErr?.message || "账号资料不完整，请联系客服。",
        });
      }
    }
  }
  if (!profile0) return json(res, 400, { ok: false, message: "验证码无效或已过期" });
  if (!canLoginWithStatus(profile0, loginPortal || role || profile0.role)) {
    return json(res, 403, { ok: false, message: "账号未启用或正在审核。" });
  }
  try {
    assertEmailVerifiedOrThrow(profile0, authUserEarly || {});
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "请先完成邮箱验证。", code: "EMAIL_NOT_VERIFIED" });
  }
  const key = forgotAccountKey(profile0);
  const otpRoleKey = loginPortal || role || "boss";
  const stored = await findForgotOtp(key, otpRoleKey, "login_otp");
  if (!stored?.code || String(stored.code) !== code || Number(stored.exp) <= Date.now()) {
    return json(res, 400, { ok: false, message: "验证码无效或已过期" });
  }
  const auth = await createSessionForUserId(profile0.id, profile0.email || email);
  let profile = await profileFor(auth.user?.id || profile0.id);
  if (!profile) profile = profile0;
  // Keep Auth email on profile when blank so future email lookups match (no role change).
  if (email && !String(profile.email || "").trim()) {
    try {
      await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(profile.id)}`), {
        method: "PATCH",
        headers: headersWithServiceRole({ Prefer: "return=minimal" }),
        body: JSON.stringify({ email }),
      });
      profile = { ...profile, email };
    } catch {
      /* non-fatal */
    }
  }
  if (["boss", "customer", "owner", "user"].includes(String(profile.role || "").trim().toLowerCase())) {
    try {
      profile = await ensureBossUid({ ...profile, role: "boss" }, auth.user);
    } catch {
      /* keep login usable */
    }
  }
  await touchLastLogin(profile.id, "");
  const capabilityAuth = await authUserForCapabilities(
    {
      ...(auth.user || {}),
      ...(authUserEarly || {}),
      user_metadata: {
        ...((authUserEarly && authUserEarly.user_metadata) || {}),
        ...((auth.user && auth.user.user_metadata) || {}),
        boss_uid: profile.boss_uid || metaBossUid(auth.user) || metaBossUid(authUserEarly),
      },
    },
    profile.id
  );
  const user = await enrichSafeProfile(profile, capabilityAuth);
  if (!VALID_ROLES.has(user.role) && !(user.hasBoss || user.hasCompanion)) {
    return json(res, 403, { ok: false, message: "账号角色无效。" });
  }
  if (!canLoginWithStatus(profile, user.role || (user.hasCompanion ? "companion" : "boss"))) {
    return json(res, 403, { ok: false, message: "账号未启用或正在审核。" });
  }
  if (loginPortal && !userHasPortalAccess(user, loginPortal)) {
    const denied = {
      ok: false,
      message: portalDeniedMessage(loginPortal),
      code: "PORTAL_DENIED",
    };
    if (allowStagingOtp()) {
      denied.debug = {
        loginPortal,
        profileRole: profile.role || "",
        status: profile.status || "",
        hasBoss: !!user.hasBoss,
        hasCompanion: !!user.hasCompanion,
        roles: Array.isArray(user.roles) ? user.roles : [],
        sessionRole: user.role || "",
      };
    }
    return json(res, 403, denied);
  }
  // Bind session active role to the portal when provided.
  let sessionUser = user;
  if (loginPortal === "boss") sessionUser = { ...user, role: "boss", hasBoss: true };
  else if (loginPortal === "companion") sessionUser = { ...user, role: "companion", hasCompanion: true };
  else if (loginPortal === "customer_service") sessionUser = { ...user, role: "customer_service" };
  else if (loginPortal === "admin") sessionUser = { ...user, role: user.role === "super_admin" ? "super_admin" : "admin" };
  if (stored.id) {
    await supabaseJson(restUrl("password_reset_requests", `?id=eq.${encodeURIComponent(stored.id)}`), {
      method: "PATCH",
      headers: headersWithServiceRole(),
      body: JSON.stringify({ status: `used_login:${Date.now()}` }),
    }).catch(() => null);
  }
  const needRolePick = computeNeedRolePick(sessionUser, loginPortal);
  const defaultRedirect = loginPortal
    ? redirectFor(loginPortal === "admin" ? sessionUser.role : loginPortal)
    : sessionUser.hasBoss
      ? redirectFor("boss")
      : sessionUser.hasCompanion
        ? redirectFor("companion")
        : redirectFor(sessionUser.role);
  return json(res, 200, {
    ok: true,
    message: sessionUser.hasPassword ? "登录成功" : "登录成功。建议前往账号安全设置密码。",
    promptSetPassword: sessionUser.hasPassword !== true,
    needRolePick,
    session: {
      accessToken: auth.access_token,
      refreshToken: auth.refresh_token,
      expiresAt: auth.expires_at,
      user: sessionUser,
    },
    redirect: defaultRedirect,
    portals: {
      boss: sessionUser.hasBoss ? redirectFor("boss") : "",
      companion: sessionUser.hasCompanion ? redirectFor("companion") : "",
    },
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
  try {
    await assertOtpResendCooldown(email, role, "register_otp");
  } catch (err) {
    return json(res, err.status || 429, {
      ok: false,
      message: err.message || "发送过于频繁，请稍后再试。",
      retryAfterSec: err.retryAfterSec || 60,
    });
  }
  const existing = await profilesLookup(
    `?email=eq.${encodeURIComponent(email)}&select=id,email,role,status&limit=5`
  ).catch(() => []);
  const roleOf = (row) => String(row?.role || "").toLowerCase();
  const companionHit = (existing || []).find((row) => roleOf(row) === "companion");
  const bossHit = (existing || []).find((row) => ["boss", "customer", "owner", "user"].includes(roleOf(row)));
  const otherHit = (existing || []).find((row) => {
    const r = roleOf(row);
    return r && r !== "companion" && !["boss", "customer", "owner", "user"].includes(r);
  });
  // Unified account: one normalized email → one user_id. Never create a second Auth user for role switch.
  if ((existing || []).length) {
    if (role === "boss") {
      return json(res, 409, { ok: false, mailSent: false, message: "该邮箱已注册，请直接登录。" });
    }
    if (companionHit) {
      return json(res, 409, { ok: false, mailSent: false, message: "该邮箱已有陪玩账号，请切换到「已有账号登录」。" });
    }
    if (bossHit) {
      return json(res, 409, {
        ok: false,
        mailSent: false,
        code: "EMAIL_EXISTS_LOGIN_THEN_APPLY",
        message: "该邮箱已注册，请直接登录；登录后可在当前账号下申请陪玩身份，不会创建新账号。",
      });
    }
    if (otherHit) {
      return json(res, 409, { ok: false, mailSent: false, message: "该邮箱已被其他角色占用，请直接登录。" });
    }
    return json(res, 409, { ok: false, mailSent: false, message: "该邮箱已注册，请直接登录。" });
  }

  // Auth orphan: Auth exists but profiles missing — do not continue register OTP flow.
  const authExisting = await findAuthUserByEmail(email);
  if (authExisting?.id) {
    const extras = await loadHealExtrasForAuthUser(authExisting);
    const intent = classifyAuthPortalIntent(authExisting, extras);
    return json(res, 409, {
      ok: false,
      mailSent: false,
      code: "ACCOUNT_NEEDS_REPAIR",
      message:
        intent === "boss"
          ? "该邮箱已有登录账号但资料不完整，请直接使用验证码或密码登录以修复，不要重复注册。"
          : repairDeniedMessage(intent),
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
  if (!mailOk) {
    console.error("[auth/send_register_otp] mail failed", mailError, mailStatus);
    if (allowStagingOtp()) {
      return json(res, 200, {
        ok: true,
        mailSent: false,
        message: mailStatus.resend
          ? `验证码邮件发送失败：${mailError || "Resend 错误"}。已生成 Staging 调试验证码。`
          : "邮件服务暂不可用（未读到 RESEND_API_KEY），已生成 Staging 调试验证码。",
        channel: "email",
        emailMasked: maskEmailHint(email),
        expiresInSec: Math.floor(OTP_TTL_MS / 1000),
        retryAfterSec: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000),
        role,
        mail: mailStatus,
        devCode: code,
        mailWarning: mailError || undefined,
      });
    }
    return json(res, 502, {
      ok: false,
      mailSent: false,
      message: "验证码发送失败，请稍后重试。",
      code: "MAIL_SEND_FAILED",
      mail: mailStatus,
    });
  }
  return json(res, 200, {
    ok: true,
    mailSent: true,
    message: `注册验证码已发送至 ${maskEmailHint(email)}。`,
    channel: "email",
    emailMasked: maskEmailHint(email),
    expiresInSec: Math.floor(OTP_TTL_MS / 1000),
    retryAfterSec: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000),
    role,
    mail: mailStatus,
  });
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
  const failKey = `register:${role}:${email}`;
  try {
    assertOtpNotRateLimited(failKey);
  } catch (err) {
    return json(res, err.status || 429, { ok: false, message: err.message });
  }
  const stored = await findForgotOtp(email, role, "register_otp");
  if (!stored?.code || String(stored.code) !== code) {
    recordOtpFail(failKey);
    return json(res, 400, { ok: false, message: "验证码错误，请重新输入。" });
  }
  if (Number(stored.exp) <= Date.now()) {
    recordOtpFail(failKey);
    return json(res, 400, { ok: false, message: "验证码已过期，请重新发送。" });
  }
  clearOtpFails(failKey);
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
  // Durable verify stamp (DB + platform_settings + memory) for serverless isolates.
  return markOtpVerified(accountKey, role, "otp", rowId, token, 15 * 60 * 1000);
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
  const failKey = `forgot:${role}:${key}`;
  try {
    assertOtpNotRateLimited(failKey);
  } catch (err) {
    return json(res, err.status || 429, { ok: false, message: err.message });
  }
  const stored = await findForgotOtp(key, role, "otp");
  if (stored && stored.code && String(stored.code) === code && Number(stored.exp) > Date.now()) {
    clearOtpFails(failKey);
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
  recordOtpFail(failKey);
  return json(res, 400, { ok: false, message: "验证码无效或已过期" });
}

async function handleForgotResetPassword(body, res) {
  const role = normalizeForgotRole(body.role);
  const newPassword = String(body.newPassword || body.password || "");
  const confirmPassword = String(body.confirmPassword || body.confirm_password || "");
  const policy = validatePassword(newPassword, confirmPassword);
  if (!policy.ok) return json(res, 400, { ok: false, message: policy.message });
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
  await stampPasswordSet(resolved.profile.id, { mustChangePassword: false });
  await markMustChangePassword(resolved.profile.id, false);
  await revokeUserSessions(resolved.profile.id);
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
    restUrl("profiles", "?select=boss_uid&boss_uid=not.is.null&limit=2000"),
    { headers: headersWithServiceRole() }
  ).catch(() => []);
  const list = Array.isArray(rows) ? rows.map((r) => r?.boss_uid).filter(Boolean) : [];
  let next = maxBossUidNumberFromList(list, parseBossCodeNumber) + 1;
  if (next < 1) next = 1;
  try {
    const authUsers = await supabaseJson(authUrl("admin/users?page=1&per_page=200"), {
      headers: headersWithServiceRole(),
    });
    const users = authUsers?.users || authUsers || [];
    const metaUids = [];
    for (const u of Array.isArray(users) ? users : []) {
      const m = metaBossUid(u);
      if (m) metaUids.push(m);
    }
    const metaMax = maxBossUidNumberFromList(metaUids, parseBossCodeNumber);
    if (metaMax + 1 > next) next = metaMax + 1;
  } catch {
    /* optional */
  }
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = formatBossCode(next + attempt);
    const existing = await supabaseJson(
      restUrl("profiles", `?boss_uid=eq.${encodeURIComponent(candidate)}&select=id&limit=1`),
      { headers: headersWithServiceRole() }
    ).catch(() => []);
    if (!Array.isArray(existing) || existing.length === 0) return candidate;
  }
  return formatBossCode(next + (Date.now() % 1000));
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

/**
 * Create a Boss profiles row for an Auth user that is missing one.
 * Idempotent. Refuses companion/staff escalation. Does not steal another email's profile.
 */
async function ensureBossProfileForAuthUser(authUser = {}) {
  const userId = String(authUser.id || "").trim();
  if (!userId) return null;
  let profile = await profileFor(userId);
  if (profile) return profile;

  // Companion / staff / empty-metadata orphans must not become Boss here.
  await assertCanHealBossOrThrow(authUser);
  if (isAuthUserBanned(authUser)) {
    throw Object.assign(new Error("账号不可用。"), { status: 403, code: "ACCOUNT_DISABLED" });
  }

  const email = String(authUser.email || "").trim().toLowerCase();
  if (email) {
    const emailHits = await profilesLookup(
      `?email=eq.${encodeURIComponent(email)}&select=id,email,role&limit=5`
    ).catch(() => []);
    const other = (emailHits || []).find((row) => String(row?.id || "") !== userId);
    if (other?.id) {
      throw Object.assign(new Error("该邮箱已绑定其他账号资料，请联系客服。"), {
        status: 409,
        code: "EMAIL_PROFILE_CONFLICT",
      });
    }
  }

  const displayName =
    String(authUser.user_metadata?.display_name || authUser.user_metadata?.nickname || "").trim() ||
    (email ? email.split("@")[0] : "") ||
    "老板";
  const createdAt = new Date().toISOString();
  // Prefer omitting boss_uid so DB trigger + synced sequence allocate uniquely.
  const slim = {
    id: userId,
    role: "boss",
    display_name: displayName.slice(0, 40),
    email: email || "",
    phone: "",
    avatar_url: "",
    status: "active",
    created_at: createdAt,
  };
  const withVerified = {
    ...slim,
    email_verified: true,
    email_verified_at: createdAt,
  };

  async function insertProfile(payload) {
    return supabaseJson(restUrl("profiles"), {
      method: "POST",
      headers: headersWithServiceRole({ Prefer: "return=representation" }),
      body: JSON.stringify(payload),
    });
  }

  let rows;
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let payload;
    if (attempt === 0) payload = withVerified;
    else if (attempt === 1) payload = slim;
    else {
      const bossUid = await allocateBossUid().catch(() => "");
      payload = bossUid ? { ...slim, boss_uid: bossUid } : { ...slim };
    }
    try {
      rows = await insertProfile(payload);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const detail = String(err?.message || "");
      if (/duplicate|unique|already exists/i.test(detail) && /id|profiles_pkey|pkey/i.test(detail)) {
        return profileFor(userId);
      }
      if (/duplicate|unique|already exists/i.test(detail) && /email/i.test(detail)) {
        const again = await profileFor(userId);
        if (again) return again;
        throw Object.assign(new Error("该邮箱已绑定其他账号资料，请联系客服。"), {
          status: 409,
          code: "EMAIL_PROFILE_CONFLICT",
        });
      }
      if (/boss_uid|unique/i.test(detail) && attempt < 3) {
        console.error("[auth/ensureBossProfile] boss_uid conflict, retry", attempt, detail);
        continue;
      }
      if (isMissingColumnError(err) || /email_verified|schema cache|boss_uid|PGRST204|42703/i.test(detail)) {
        continue;
      }
      throw err;
    }
  }
  if (lastErr && !rows) {
    console.error("[auth/ensureBossProfile] insert failed", lastErr?.message || lastErr);
    throw Object.assign(new Error(`老板资料创建失败：${lastErr?.message || "未知错误"}`), {
      status: 500,
      code: "PROFILE_CREATE_FAILED",
      cause: lastErr,
    });
  }

  profile = Array.isArray(rows) ? rows[0] : rows;
  profile = (await profileFor(userId)) || profile;
  try {
    profile = await ensureBossUid(profile || slim, authUser);
  } catch (uidErr) {
    console.error("[auth/ensureBossProfile] ensureBossUid failed", uidErr?.message || uidErr);
    throw Object.assign(new Error(`老板 UID 分配失败：${uidErr?.message || "请重试"}`), {
      status: 500,
      code: "BOSS_UID_ASSIGN_FAILED",
      cause: uidErr,
    });
  }
  try {
    const { persistRoles } = await import("./_account-roles.js");
    await persistRoles(userId, ["boss"], { primaryRole: "boss" });
  } catch {
    /* optional */
  }
  return profile;
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
      if (!profile) {
        try {
          profile = await ensureBossProfileForAuthUser(authUser);
        } catch (initErr) {
          console.error("[auth/me] profile auto-init failed", initErr?.code || "", initErr?.message || initErr);
          return json(res, initErr?.status || 503, {
            ok: false,
            message: initErr?.message || "账号初始化失败，请刷新重试或联系客服。",
            code: initErr?.code || "PROFILE_INIT_FAILED",
          });
        }
      }
      if (!profile) {
        return json(res, 503, {
          ok: false,
          message: "账号初始化失败，请刷新重试或联系客服。",
          code: "PROFILE_INIT_FAILED",
        });
      }
      if (
        ["boss", "customer", "owner", "user", "companion", "player"].includes(
          String(profile.role || "").trim().toLowerCase()
        )
      ) {
        try {
          profile = await ensureBossUid(
            { ...profile, role: ["companion", "player"].includes(String(profile.role || "").toLowerCase()) ? profile.role : "boss" },
            authUser
          );
        } catch {
          /* keep session usable */
        }
      }
      const user = await enrichSafeProfile(profile, authUser);
      if (!VALID_ROLES.has(user.role) && !(user.hasBoss || user.hasCompanion)) {
        return json(res, 403, { ok: false, message: "账号角色无效。" });
      }
      if (!canLoginWithStatus(profile, user.role || (user.hasCompanion ? "companion" : "boss"))) {
        return json(res, 403, { ok: false, message: "账号未启用或正在审核。" });
      }
      let pendingForced = [];
      let forcedAckRequired = false;
      if (user.hasBoss || ["boss", "customer", "owner", "user"].includes(String(user.role || "").toLowerCase())) {
        try {
          const acks = await import("./_content-acks.js");
          pendingForced = await acks.pendingForcedForUser(profile.id, { audience: "boss" });
          forcedAckRequired = pendingForced.length > 0;
        } catch {
          /* optional */
        }
      }
      return json(res, 200, {
        ok: true,
        user,
        redirect: redirectFor(user.hasBoss ? "boss" : user.role),
        portals: {
          boss: user.hasBoss ? redirectFor("boss") : "",
          companion: user.hasCompanion ? redirectFor("companion") : "",
        },
        needRolePick: false,
        pendingForced,
        forcedAckRequired,
        passwordHint: PASSWORD_RULE_HINT,
      });
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
    if (requestedAction === "set_password") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { ok: false, message: "未登录" });
      const authUser = await userFromToken(token);
      const profile = await profileFor(authUser.id);
      if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料。" });
      if (!canManagePassword(profile)) return json(res, 403, { ok: false, message: "账号已停用，无法设置密码。" });
      const hasPassword = await resolveHasPassword(profile, authUser, { probeAuth: true });
      if (hasPassword === true) {
        return json(res, 400, { ok: false, message: "账号已设置密码，请使用「修改密码」。" });
      }
      const newPassword = String(body.newPassword || body.password || "");
      const confirmPassword = String(body.confirmPassword || body.confirm_password || "");
      const policy = validatePassword(newPassword, confirmPassword);
      if (!policy.ok) return json(res, 400, { ok: false, message: policy.message });
      await supabaseJson(authUrl(`admin/users/${encodeURIComponent(authUser.id)}`), {
        method: "PUT",
        headers: headersWithServiceRole(),
        body: JSON.stringify({ password: newPassword }),
      });
      await stampPasswordSet(authUser.id, { mustChangePassword: false });
      const email = String(profile.email || authUser.email || "").trim().toLowerCase();
      let session = null;
      if (email) {
        try {
          const auth = await supabaseJson(authUrl("token?grant_type=password"), {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ email, password: newPassword }),
          });
          session = {
            accessToken: auth.access_token,
            refreshToken: auth.refresh_token,
            expiresAt: auth.expires_at,
            user: await enrichSafeProfile(profile, auth.user || authUser),
          };
        } catch {
          session = null;
        }
      }
      return json(res, 200, {
        ok: true,
        message: "密码已设置，可用邮箱+密码登录。",
        user: session?.user || (await enrichSafeProfile(profile, authUser)),
        session,
      });
    }
    if (requestedAction === "change_password") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { ok: false, message: "未登录" });
      const authUser = await userFromToken(token);
      const profile = await profileFor(authUser.id);
      if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料。" });
      if (!canManagePassword(profile)) return json(res, 403, { ok: false, message: "账号已停用，无法修改密码。" });
      const currentPassword = String(body.currentPassword || body.oldPassword || "");
      const newPassword = String(body.newPassword || body.password || "");
      const confirmPassword = String(body.confirmPassword || "");
      if (!currentPassword || !newPassword) return json(res, 400, { ok: false, message: "请填写当前密码和新密码。" });
      const policy = validatePassword(newPassword, confirmPassword);
      if (!policy.ok) return json(res, 400, { ok: false, message: policy.message });
      const email = String(profile.email || authUser.email || "").trim().toLowerCase();
      if (!email) return json(res, 400, { ok: false, message: "账号缺少邮箱，无法验证当前密码。" });
      try {
        await supabaseJson(authUrl("token?grant_type=password"), {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ email, password: currentPassword }),
        });
      } catch {
        return json(res, 400, { ok: false, message: "当前密码不正确。" });
      }
      await supabaseJson(authUrl("user"), {
        method: "PUT",
        headers: authHeaders({ Authorization: `Bearer ${token}` }),
        body: JSON.stringify({ password: newPassword }),
      });
      await stampPasswordSet(authUser.id, { mustChangePassword: false });
      await markMustChangePassword(authUser.id, false);
      await revokeUserSessions(authUser.id);
      let session = null;
      try {
        const auth = await supabaseJson(authUrl("token?grant_type=password"), {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ email, password: newPassword }),
        });
        session = {
          accessToken: auth.access_token,
          refreshToken: auth.refresh_token,
          expiresAt: auth.expires_at,
          user: await enrichSafeProfile(profile, auth.user || authUser),
        };
      } catch {
        session = null;
      }
      return json(res, 200, {
        ok: true,
        message: "密码已更新，其他设备已退出登录。",
        session,
        user: session?.user || (await enrichSafeProfile(profile, authUser)),
      });
    }
    if (requestedAction === "revoke_sessions" || requestedAction === "logout_all_devices") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { ok: false, message: "未登录" });
      const authUser = await userFromToken(token);
      const profile = await profileFor(authUser.id);
      if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料。" });
      await revokeUserSessions(authUser.id);
      return json(res, 200, { ok: true, message: "已注销全部登录会话，请重新登录。" });
    }
    if (requestedAction === "account_security") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) return json(res, 401, { ok: false, message: "未登录" });
      const authUser = await userFromToken(token);
      const profile = await profileFor(authUser.id);
      if (!profile) return json(res, 403, { ok: false, message: "账号未绑定平台资料。" });
      if (!canManagePassword(profile)) return json(res, 403, { ok: false, message: "账号已停用。" });
      const user = await enrichSafeProfile(profile, authUser);
      return json(res, 200, {
        ok: true,
        user,
        passwordHint: PASSWORD_RULE_HINT,
        canSetPassword: user.hasPassword !== true,
        canChangePassword: user.hasPassword === true,
      });
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
      const user = await enrichSafeProfile(profile, authUser || {});
      if (!VALID_ROLES.has(user.role)) return json(res, 403, { ok: false, message: "账号角色无效。" });
      if (!canLoginWithStatus(profile, user.role)) return json(res, 403, { ok: false, message: "账号未启用或正在审核。" });
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
      const registerToken = String(body.registerToken || body.emailOtpToken || body.otpToken || "").trim();
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
      if (!email) return json(res, 400, { ok: false, message: "请输入邮箱。" });
      if (!registerToken) {
        return json(res, 400, { ok: false, message: "请先完成邮箱验证。" });
      }
      try {
        await consumeRegisterVerified(email, "boss", registerToken);
      } catch (otpErr) {
        return json(res, otpErr?.status || 400, {
          ok: false,
          message: otpErr?.message || "请先完成邮箱验证。",
        });
      }
      const wantsPassword = password.length > 0;
      if (!wantsPassword) {
        return json(res, 400, { ok: false, message: "请设置登录密码。" });
      }
      const policy = validatePassword(password, body.confirmPassword || body.confirm_password);
      if (!policy.ok) return json(res, 400, { ok: false, message: policy.message });
      const authPassword = password;
      const verifiedAt = new Date().toISOString();

      // Idempotent register: never create a second Auth user for the same email.
      const preexistingAuth = await findAuthUserByEmail(email);
      if (preexistingAuth?.id) {
        const existingProfile = await profileFor(preexistingAuth.id);
        if (existingProfile) {
          return json(res, 400, { ok: false, message: "该邮箱已注册，请直接登录。" });
        }
        let healed;
        try {
          // Only explicit Boss orphans heal; companion/staff/empty metadata → ACCOUNT_NEEDS_REPAIR.
          healed = await ensureBossProfileForAuthUser({
            ...preexistingAuth,
            email,
            user_metadata: {
              ...(preexistingAuth.user_metadata || {}),
              display_name: displayName || preexistingAuth.user_metadata?.display_name || email.split("@")[0],
            },
          });
          await supabaseJson(authUrl(`admin/users/${encodeURIComponent(preexistingAuth.id)}`), {
            method: "PUT",
            headers: headersWithServiceRole(),
            body: JSON.stringify({
              password: authPassword,
              email_confirm: true,
              user_metadata: {
                ...(preexistingAuth.user_metadata || {}),
                display_name: displayName || email.split("@")[0] || "老板",
                has_password: true,
                password_set_at: verifiedAt,
                email_verified: true,
                email_verified_at: verifiedAt,
              },
              app_metadata: {
                ...(preexistingAuth.app_metadata || {}),
                has_password: true,
                email_verified: true,
              },
            }),
          });
        } catch (healErr) {
          console.error("[auth/register] orphan heal failed", healErr?.message || healErr);
          return json(res, healErr?.status || 500, {
            ok: false,
            code: healErr?.code || "ACCOUNT_NEEDS_REPAIR",
            message: healErr?.message || "账号资料修复失败，请联系客服。",
          });
        }
        const auth = await supabaseJson(authUrl("token?grant_type=password"), {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ email, password: authPassword }),
        });
        await stampPasswordSet(preexistingAuth.id, { mustChangePassword: false });
        await touchLastLogin(preexistingAuth.id, clientIp(req));
        const user = await enrichSafeProfile(
          { ...(healed || {}), has_password: true, email_verified: true },
          auth.user || preexistingAuth
        );
        const bossUidOut = user.bossUid || user.boss_uid || "";
        return json(res, 200, {
          ok: true,
          repaired: true,
          message: bossUidOut
            ? `账号资料已修复并注册完成。您的老板 UID：${bossUidOut}。`
            : "账号资料已修复并注册完成。",
          bossUid: bossUidOut || undefined,
          emailVerified: true,
          session: {
            accessToken: auth.access_token,
            refreshToken: auth.refresh_token,
            expiresAt: auth.expires_at,
            user,
          },
          redirect: redirectFor("boss"),
        });
      }

      let created;
      let createdAuthId = "";
      try {
        created = await supabaseJson(authUrl("admin/users"), {
          method: "POST",
          headers: headersWithServiceRole(),
          body: JSON.stringify({
            email,
            password: authPassword,
            email_confirm: true,
            user_metadata: {
              display_name: displayName || email.split("@")[0] || "老板",
              has_password: true,
              password_set_at: verifiedAt,
              email_verified: true,
              email_verified_at: verifiedAt,
              roles: ["boss"],
            },
            app_metadata: { has_password: true, email_verified: true, roles: ["boss"] },
          }),
        });
      } catch (error) {
        let message = String(error.message || "").trim();
        if (/user already registered|already.*(registered|exists)|duplicate|unique/i.test(message)) {
          // Race: Auth appeared between our probe and create — do not leave caller guessing.
          const raced = await findAuthUserByEmail(email);
          if (raced?.id && !(await profileFor(raced.id))) {
            const extras = await loadHealExtrasForAuthUser(raced);
            if (shouldHealAsBoss(raced, extras)) {
              return json(res, 409, {
                ok: false,
                code: "ACCOUNT_NEEDS_REPAIR",
                message: "该邮箱已有登录账号但资料不完整，请直接登录以修复，不要重复注册。",
              });
            }
            return json(res, 409, {
              ok: false,
              code: "ACCOUNT_NEEDS_REPAIR",
              message: repairDeniedMessage(classifyAuthPortalIntent(raced, extras)),
            });
          }
          message = "该邮箱已注册，请直接登录。";
        }
        return json(res, 400, { ok: false, message: message || "注册失败，请检查邮箱是否已存在。" });
      }
      const userId = created?.id || created?.user?.id;
      createdAuthId = String(userId || "");
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
          email_verified: true,
          email_verified_at: verifiedAt,
        };
        // Prefer trigger-assigned boss_uid (synced sequence). Fallback to allocateBossUid on conflict.
        let rows;
        async function insertProfile(payload) {
          return supabaseJson(restUrl("profiles"), {
            method: "POST",
            headers: headersWithServiceRole({ Prefer: "return=representation" }),
            body: JSON.stringify(payload),
          });
        }
        try {
          rows = await insertProfile(intlProfile);
        } catch (insertError) {
          const detail = String(insertError.message || "");
          if (isMissingColumnError(insertError) || /email_verified/i.test(detail)) {
            const withoutVerified = { ...intlProfile };
            delete withoutVerified.email_verified;
            delete withoutVerified.email_verified_at;
            try {
              rows = await insertProfile(withoutVerified);
            } catch (retryMissing) {
              if (isMissingColumnError(retryMissing) || /country_code|phone_e164|PGRST204|42703/i.test(String(retryMissing.message || ""))) {
                rows = await insertProfile(baseProfile);
              } else if (/boss_uid|unique/i.test(String(retryMissing.message || ""))) {
                const bossUid = await allocateBossUid().catch(() => "");
                rows = await insertProfile(bossUid ? { ...baseProfile, boss_uid: bossUid } : baseProfile);
              } else {
                throw retryMissing;
              }
            }
          } else if (/boss_uid|unique/i.test(detail)) {
            const bossUid = await allocateBossUid().catch(() => "");
            try {
              rows = await insertProfile(bossUid ? { ...intlProfile, boss_uid: bossUid } : baseProfile);
            } catch (retryUid) {
              if (isMissingColumnError(retryUid) || /email_verified|PGRST204|42703/i.test(String(retryUid.message || ""))) {
                rows = await insertProfile(bossUid ? { ...baseProfile, boss_uid: bossUid } : baseProfile);
              } else {
                throw retryUid;
              }
            }
          } else {
            throw insertError;
          }
        }
        profile = Array.isArray(rows) ? rows[0] : rows;
        profile = (await profileFor(userId)) || profile;
        profile = { ...(profile || baseProfile), email_verified: true, email_verified_at: verifiedAt };
        try {
          profile = await ensureBossUid(profile, created?.user || created || { id: userId, user_metadata: { display_name: displayName } });
        } catch (uidError) {
          throw Object.assign(new Error(`老板 UID 分配失败：${uidError.message || "请重试"}`), {
            status: 500,
            code: "BOSS_UID_ASSIGN_FAILED",
            cause: uidError,
          });
        }
        try {
          const { persistRoles } = await import("./_account-roles.js");
          await persistRoles(userId, ["boss"], { primaryRole: "boss" });
          profile = { ...profile, roles: ["boss"] };
        } catch {
          /* optional roles column / metadata */
        }
      } catch (error) {
        try {
          await rollbackCreatedAuthUser(createdAuthId || userId, "boss-register-profile-fail");
        } catch (rollbackErr) {
          return json(res, 500, {
            ok: false,
            code: rollbackErr?.code || "AUTH_ROLLBACK_FAILED",
            message: rollbackErr?.message || "老板资料创建失败，且 Auth 回滚未成功。请联系客服。",
          });
        }
        return json(res, 500, {
          ok: false,
          code: error?.code || "PROFILE_CREATE_FAILED",
          message: `老板资料创建失败：${error.message || "未知错误"}。Auth 账号已回滚，请重试。`,
        });
      }
      let auth;
      auth = await supabaseJson(authUrl("token?grant_type=password"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email, password: authPassword }),
      });
      await stampPasswordSet(userId, { mustChangePassword: false });
      await touchLastLogin(userId, clientIp(req));
      const authUser = auth.user || {
        id: userId,
        email,
        email_confirmed_at: verifiedAt,
        user_metadata: { boss_uid: profile?.boss_uid, has_password: true, email_verified: true, email_verified_at: verifiedAt },
      };
      const user = await enrichSafeProfile(
        { ...(profile || {}), has_password: true, email_verified: true, email_verified_at: verifiedAt },
        authUser
      );
      const bossUidOut = user.bossUid || user.boss_uid || "";
      return json(res, 200, {
        ok: true,
        message: bossUidOut
          ? `注册成功。您的老板 UID：${bossUidOut}。`
          : "注册成功。",
        bossUid: bossUidOut || undefined,
        emailVerified: true,
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
    if (requestedAction === "probe_portal_capability") {
      // Staging / Preview only — diagnose Boss portal gates without mutating data.
      if (!allowStagingOtp()) {
        return json(res, 403, { ok: false, message: "probe_portal_capability 仅 Staging / Preview 可用。" });
      }
      const email = String(body.email || body.account || "").trim().toLowerCase();
      const loginPortal = normalizeLoginPortal(body.loginPortal || body.portal || body.role || "boss") || "boss";
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        return json(res, 400, { ok: false, message: "请输入有效邮箱。" });
      }
      const authUser = await findAuthUserByEmail(email);
      const byEmail = await profilesLookup(
        `?email=eq.${encodeURIComponent(email)}&select=id,email,phone,phone_e164,display_name,status,role,boss_uid&limit=5`
      ).catch(() => []);
      const profile =
        pickProfileForLoginPortal(byEmail, loginPortal, authUser) ||
        (await resolveForgotAccount(email, loginPortal).catch(() => null))?.profile ||
        (authUser?.id ? await profileFor(authUser.id) : null) ||
        null;
      if (!profile) {
        return json(res, 200, {
          ok: true,
          found: false,
          authExists: !!authUser?.id,
          hasBoss: false,
          hasCompanion: false,
          userHasPortalAccess: false,
          loginPortal,
        });
      }
      const capabilityAuth = await authUserForCapabilities(authUser || {}, profile.id);
      const enriched = await enrichProfileRoles(profile, capabilityAuth);
      const sessionUser = await enrichSafeProfile(profile, capabilityAuth);
      return json(res, 200, {
        ok: true,
        found: true,
        authExists: !!authUser?.id,
        loginPortal,
        profile: {
          id: profile.id,
          email: profile.email || "",
          role: profile.role || "",
          status: profile.status || "",
          boss_uid: profile.boss_uid || "",
        },
        authMeta: {
          app_roles: capabilityAuth?.app_metadata?.roles || null,
          app_role: capabilityAuth?.app_metadata?.role || null,
          user_roles: capabilityAuth?.user_metadata?.roles || null,
          user_role: capabilityAuth?.user_metadata?.role || null,
        },
        caps: {
          roles: enriched.roles || [],
          hasBoss: !!enriched.hasBoss,
          hasCompanion: !!enriched.hasCompanion,
          primaryRole: enriched.primaryRole || "",
        },
        session: {
          role: sessionUser.role || "",
          hasBoss: !!sessionUser.hasBoss,
          hasCompanion: !!sessionUser.hasCompanion,
          roles: sessionUser.roles || [],
        },
        userHasPortalAccess: userHasPortalAccess(sessionUser, loginPortal),
      });
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

    const loginPortal = normalizeLoginPortal(body.loginPortal || body.portal || body.role || "");
    // Forgot pre-check: use portal when provided, else any profile for this email.
    const prePortal = loginPortal || "";
    const pre = prePortal
      ? await resolveForgotAccount(email, prePortal).catch(() => null)
      : await (async () => {
          const rows = await profilesLookup(
            `?email=eq.${encodeURIComponent(email)}&select=id,email,phone,phone_e164,display_name,status,role,boss_uid&limit=3`
          ).catch(() => []);
          return Array.isArray(rows) && rows[0] ? { profile: rows[0], via: "email", role: rows[0].role } : null;
        })();
    if (pre?.profile && String(pre.profile.status || "").toLowerCase() === "disabled") {
      return json(res, 403, { ok: false, message: "账号已停用，请联系客服。" });
    }

    let auth;
    try {
      auth = await supabaseJson(authUrl("token?grant_type=password"), {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email, password }),
      });
    } catch (loginErr) {
      const raw = String(loginErr?.message || "").trim();
      const looksLikeBadPassword =
        /invalid login credentials|invalid.*(email|password)|wrong password|invalid email or password/i.test(raw);
      // Only map to NO_PASSWORD for credential failures when we positively know
      // the account never set a password. Rate limits / email-not-confirmed / etc.
      // must keep their own messages.
      if (looksLikeBadPassword && pre?.profile) {
        const hasPwd = await resolveHasPassword(pre.profile, {}, { probeAuth: true });
        if (hasPwd === false) {
          return json(res, 400, { ok: false, message: NO_PASSWORD_LOGIN_MESSAGE, code: "NO_PASSWORD" });
        }
      }
      let message = raw;
      if (/invalid login credentials|invalid.*(email|password)|email not confirmed/i.test(message)) {
        message = "邮箱或密码错误。";
      }
      return json(res, 401, { ok: false, message: message || "邮箱或密码错误。" });
    }
    const authUser = auth.user;
    let profile = await profileFor(authUser.id);
    if (!profile) {
      try {
        profile = await ensureBossProfileForAuthUser(authUser);
      } catch (healErr) {
        console.error("[auth/login] orphan heal failed", healErr?.code || "", healErr?.message || healErr);
        return json(res, healErr?.status || 403, {
          ok: false,
          code: healErr?.code || "ACCOUNT_NEEDS_REPAIR",
          message: healErr?.message || "账号未绑定平台资料，请联系管理员。",
        });
      }
    }
    try {
      assertEmailVerifiedOrThrow(profile, authUser);
    } catch (err) {
      return json(res, err.status || 403, {
        ok: false,
        message: err.message || "请先完成邮箱验证。",
        code: "EMAIL_NOT_VERIFIED",
      });
    }
    if (
      ["boss", "customer", "owner", "user", "companion", "player"].includes(
        String(profile.role || "").trim().toLowerCase()
      )
    ) {
      try {
        profile = await ensureBossUid({ ...profile, role: profile.role === "companion" ? profile.role : "boss" }, authUser);
      } catch {
        /* keep login usable even if UID backfill fails */
      }
    }
    // Successful password login proves password exists — stamp for future probes.
    await stampPasswordSet(authUser.id, {
      mustChangePassword: resolveMustChangePassword(profile, authUser),
    }).catch(() => null);
    const user = await enrichSafeProfile(
      { ...profile, has_password: true },
      { ...authUser, user_metadata: { ...(authUser?.user_metadata || {}), boss_uid: profile.boss_uid || metaBossUid(authUser), has_password: true } }
    );
    if (!VALID_ROLES.has(user.role) && !(user.hasBoss || user.hasCompanion)) {
      return json(res, 403, { ok: false, message: "账号角色无效。" });
    }
    if (!canLoginWithStatus(profile, user.role || (user.hasCompanion ? "companion" : "boss"))) {
      return json(res, 403, { ok: false, message: "账号未启用或正在审核。" });
    }
    if (loginPortal && !userHasPortalAccess(user, loginPortal)) {
      const denied = {
        ok: false,
        message: portalDeniedMessage(loginPortal),
        code: "PORTAL_DENIED",
      };
      if (allowStagingOtp()) {
        denied.debug = {
          loginPortal,
          profileRole: profile.role || "",
          status: profile.status || "",
          hasBoss: !!user.hasBoss,
          hasCompanion: !!user.hasCompanion,
          roles: Array.isArray(user.roles) ? user.roles : [],
          sessionRole: user.role || "",
        };
      }
      return json(res, 403, denied);
    }
    let sessionUser = user;
    if (loginPortal === "boss") sessionUser = { ...user, role: "boss", hasBoss: true };
    else if (loginPortal === "companion") sessionUser = { ...user, role: "companion", hasCompanion: true };
    else if (loginPortal === "customer_service") sessionUser = { ...user, role: "customer_service" };
    else if (loginPortal === "admin") sessionUser = { ...user, role: user.role === "super_admin" ? "super_admin" : "admin" };
    await touchLastLogin(profile.id, clientIp(req));
    const needRolePick = computeNeedRolePick(sessionUser, loginPortal);
    const defaultRedirect = loginPortal
      ? redirectFor(loginPortal === "admin" ? sessionUser.role : loginPortal)
      : sessionUser.hasBoss
        ? redirectFor("boss")
        : sessionUser.hasCompanion
          ? redirectFor("companion")
          : redirectFor(sessionUser.role);
    if (resolveMustChangePassword(profile, authUser)) {
      return json(res, 200, {
        ok: true,
        mustChangePassword: true,
        needRolePick,
        message: "管理员要求您修改密码后才能继续使用。",
        session: {
          accessToken: auth.access_token,
          refreshToken: auth.refresh_token,
          expiresAt: auth.expires_at,
          user: { ...sessionUser, mustChangePassword: true, must_change_password: true },
        },
        redirect: defaultRedirect,
        portals: {
          boss: sessionUser.hasBoss ? redirectFor("boss") : "",
          companion: sessionUser.hasCompanion ? redirectFor("companion") : "",
        },
      });
    }

    return json(res, 200, {
      ok: true,
      needRolePick,
      session: {
        accessToken: auth.access_token,
        refreshToken: auth.refresh_token,
        expiresAt: auth.expires_at,
        user: sessionUser,
      },
      redirect: defaultRedirect,
      portals: {
        boss: sessionUser.hasBoss ? redirectFor("boss") : "",
        companion: sessionUser.hasCompanion ? redirectFor("companion") : "",
      },
    });
  } catch (error) {
    const action = String((req.body && req.body.action) || req.query?.action || "");
    let message = String(error.message || "").trim();
    if (/failed to fetch|fetch failed|network|econnrefused|enotfound|timeout/i.test(message)) {
      message = "暂时无法连接服务器，请稍后重试";
    } else if (/invalid login credentials|invalid.*(email|password)|email not confirmed/i.test(message)) {
      message = "邮箱或密码错误。";
    }
    if (
      action === "change_password" ||
      action === "set_password" ||
      action === "update_profile" ||
      action === "upload_avatar" ||
      action === "account_security" ||
      action === "revoke_sessions" ||
      action === "logout_all_devices"
    ) {
      const status = /密码|password|credentials|invalid|邮箱或密码|格式|超过|4MB|jpg|png|webp|不一致|至少/i.test(message)
        ? 400
        : 401;
      const fallback =
        action === "change_password" || action === "set_password"
          ? "修改密码失败。"
          : action === "upload_avatar"
            ? "头像上传失败。"
            : "保存资料失败。";
      return json(res, status, { ok: false, message: message || fallback });
    }
    const fallback = action === "refresh" ? "refreshToken 已失效，请重新登录。" : "邮箱或密码错误。";
    return json(res, 401, { ok: false, message: message || fallback });
  }
}


