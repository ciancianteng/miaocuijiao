/**
 * Durable OTP store for serverless isolates.
 *
 * - SoT: public.password_reset_requests (multi-user / multi-request rows)
 * - NO platform_settings single-slot fallback
 * - NO process-memory Map as durable store or resend cooldown
 * - commitOtpAfterSuccessfulSend: only rotates active OTP after mail success
 * - Other accounts' active OTPs are never touched
 */
import { randomInt } from "node:crypto";

const DEFAULT_COOLDOWN_MS = 60 * 1000;
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_VERIFY_FAILS = 8;

function envValue(key, fallback = "") {
  return String(process.env[key] || fallback).trim();
}

function restUrl(table, query = "") {
  return `${envValue("SUPABASE_URL").replace(/\/$/, "")}/rest/v1/${table}${query}`;
}

function serviceHeaders(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY") || envValue("SUPABASE_ANON_KEY");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
    ...extra,
  };
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
    const detail =
      body?.error_description ||
      body?.msg ||
      body?.message ||
      body?.hint ||
      body?.details ||
      (typeof body === "string" ? body : "") ||
      `${response.status} ${response.statusText}`;
    const err = new Error(detail);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

function normAccount(accountKey) {
  return String(accountKey || "").trim().toLowerCase();
}
function normRole(role) {
  return String(role || "").trim().toLowerCase();
}
function normKind(kind) {
  return String(kind || "otp").trim() || "otp";
}

function newRequestId() {
  return `fpr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isMissingTable(err) {
  return /PGRST205|Could not find the table|schema cache|does not exist|42P01/i.test(
    String(err?.message || err || "")
  );
}

function missingTableError(cause) {
  return Object.assign(
    new Error("验证码存储表未就绪（password_reset_requests）。请先在 Staging 执行 OTP migration。"),
    { status: 503, code: "OTP_TABLE_MISSING", cause: String(cause?.message || cause || "") }
  );
}

export function randomOtpCode() {
  return String(randomInt(100000, 1000000));
}

function parseLegacyStatus(status, kind) {
  const k = normKind(kind);
  const otpRe = new RegExp(`^${k}:(\\d{6}):exp:(\\d+)$`);
  const m = String(status || "").match(otpRe);
  if (m) return { code: m[1], exp: Number(m[2]), verifiedToken: "" };
  if (k === "otp" || k === "login_otp") {
    const v = String(status || "").match(/^verified:([A-Za-z0-9_-]+):exp:(\d+)$/);
    if (v) return { code: "", exp: Number(v[2]), verifiedToken: v[1] };
  }
  if (k === "register_otp") {
    const v = String(status || "").match(/^register_verified:([A-Za-z0-9_-]+):exp:(\d+)$/);
    if (v) return { code: "", exp: Number(v[2]), verifiedToken: v[1] };
  }
  return null;
}

function rowIsActiveOtp(row, kind) {
  if (!row) return false;
  const status = String(row.status || "");
  if (status === "active") {
    const exp = row.expires_at ? Date.parse(row.expires_at) : Number(row.exp || 0);
    if (Number.isFinite(exp) && exp > 0 && exp <= Date.now()) return false;
    return !!String(row.code || "").trim();
  }
  const parsed = parseLegacyStatus(status, kind);
  if (!parsed?.code) return false;
  return Number(parsed.exp) > Date.now();
}

function mapFoundRow(row, kind) {
  const k = normKind(kind || row.kind || "otp");
  if (String(row.status || "") === "active") {
    const exp = row.expires_at ? Date.parse(row.expires_at) : 0;
    return {
      id: row.id,
      code: String(row.code || ""),
      exp: Number.isFinite(exp) ? exp : 0,
      row,
      kind: k,
      source: "password_reset_requests",
      deliveryStatus: row.delivery_status || "",
      providerMessageId: row.provider_message_id || "",
      verifyFails: Number(row.verify_fails || 0),
    };
  }
  const parsed = parseLegacyStatus(row.status, k);
  if (!parsed) return null;
  if (parsed.verifiedToken) {
    return {
      id: row.id,
      verifiedToken: parsed.verifiedToken,
      exp: parsed.exp,
      row,
      kind: k,
      source: "password_reset_requests",
    };
  }
  return {
    id: row.id,
    code: parsed.code,
    exp: parsed.exp,
    row,
    kind: k,
    source: "password_reset_requests",
    deliveryStatus: row.delivery_status || "",
    providerMessageId: row.provider_message_id || "",
    verifyFails: Number(row.verify_fails || 0),
  };
}

async function listRecentRows(accountKey, role, kind, limit = 12) {
  const key = normAccount(accountKey);
  const r = normRole(role);
  const k = normKind(kind);
  try {
    return (
      (await supabaseJson(
        restUrl(
          "password_reset_requests",
          `?account=eq.${encodeURIComponent(key)}&role=eq.${encodeURIComponent(r)}&kind=eq.${encodeURIComponent(k)}&order=created_at.desc&limit=${limit}`
        ),
        { headers: serviceHeaders({ Prefer: "return=representation" }) }
      )) || []
    );
  } catch (err) {
    if (isMissingTable(err)) throw missingTableError(err);
    // Older schemas without kind column: fall back to account+role filter
    if (/kind|PGRST204|column/i.test(String(err.message || err))) {
      const rows =
        (await supabaseJson(
          restUrl(
            "password_reset_requests",
            `?account=eq.${encodeURIComponent(key)}&role=eq.${encodeURIComponent(r)}&order=created_at.desc&limit=${limit}`
          ),
          { headers: serviceHeaders({ Prefer: "return=representation" }) }
        ).catch((e2) => {
          if (isMissingTable(e2)) throw missingTableError(e2);
          throw e2;
        })) || [];
      return rows.filter((row) => !row.kind || normKind(row.kind) === k || parseLegacyStatus(row.status, k));
    }
    throw err;
  }
}

/**
 * DB-backed resend cooldown (shared across Vercel isolates).
 * Does NOT stamp cooldown — call only to check; stamp via commit after send.
 */
export async function assertResendCooldown({
  accountKey,
  role,
  kind = "otp",
  cooldownMs = DEFAULT_COOLDOWN_MS,
} = {}) {
  const key = normAccount(accountKey);
  const r = normRole(role);
  const k = normKind(kind);
  let lastSentMs = 0;
  try {
    const rows = await listRecentRows(key, r, k, 8);
    for (const row of rows) {
      const sent = row.sent_at ? Date.parse(row.sent_at) : 0;
      if (Number.isFinite(sent) && sent > lastSentMs) lastSentMs = sent;
      // Legacy rows without sent_at: treat successful active/legacy otp status created_at as sent
      if (!row.sent_at && (rowIsActiveOtp(row, k) || String(row.delivery_status || "") === "sent")) {
        const created = row.created_at ? Date.parse(row.created_at) : 0;
        if (Number.isFinite(created) && created > lastSentMs) lastSentMs = created;
      }
    }
  } catch (err) {
    if (err?.code === "OTP_TABLE_MISSING") throw err;
    throw err;
  }
  const wait = cooldownMs - (Date.now() - lastSentMs);
  if (lastSentMs && wait > 0) {
    throw Object.assign(new Error(`发送过于频繁，请 ${Math.ceil(wait / 1000)} 秒后再试。`), {
      status: 429,
      retryAfterSec: Math.ceil(wait / 1000),
      code: "OTP_RESEND_COOLDOWN",
    });
  }
  return { ok: true, lastSentMs };
}

/**
 * Immediate active store (admin tooling / tests). Prefer commitOtpAfterSuccessfulSend for user flows.
 */
export async function storeOtp({
  accountKey,
  role,
  code,
  kind = "otp",
  ttlMs = DEFAULT_TTL_MS,
  provider = "",
  providerMessageId = "",
  deliveryStatus = "sent",
  sentAt = null,
  supersedePrevious = true,
} = {}) {
  const key = normAccount(accountKey);
  const r = normRole(role);
  const k = normKind(kind);
  const otp = String(code || "").trim();
  if (!key || !r || !/^\d{4,8}$/.test(otp)) {
    throw Object.assign(new Error("验证码参数无效"), { status: 400, code: "OTP_BAD_ARGS" });
  }
  const id = newRequestId();
  const expMs = Date.now() + ttlMs;
  const expiresAt = new Date(expMs).toISOString();
  const sentIso = sentAt ? new Date(sentAt).toISOString() : new Date().toISOString();
  const legacyStatus = `${k}:${otp}:exp:${expMs}`;

  if (supersedePrevious) {
    await supersedeActiveOtps(key, r, k, id);
  }

  const payload = {
    id,
    account: key,
    role: r,
    kind: k,
    status: "active",
    code: otp,
    expires_at: expiresAt,
    sent_at: sentIso,
    provider: String(provider || ""),
    provider_message_id: String(providerMessageId || ""),
    delivery_status: String(deliveryStatus || "sent"),
    verify_fails: 0,
    detail: legacyStatus,
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };

  try {
    await supabaseJson(restUrl("password_reset_requests"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(payload),
    });
  } catch (err) {
    if (isMissingTable(err)) throw missingTableError(err);
    // Column-incomplete schema: minimal insert with legacy status only
    if (/PGRST204|column|schema cache/i.test(String(err.message || err))) {
      await supabaseJson(restUrl("password_reset_requests"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          id,
          account: key,
          role: r,
          status: legacyStatus,
          created_at: new Date().toISOString(),
        }),
      }).catch((e2) => {
        if (isMissingTable(e2)) throw missingTableError(e2);
        throw e2;
      });
    } else {
      console.error("[otp-store] storeOtp failed", err.message || err);
      throw Object.assign(new Error("验证码存储失败，请稍后重试。"), {
        status: 503,
        code: "OTP_STORE_FAILED",
      });
    }
  }
  return { id, exp: expMs, dbOk: true };
}

async function supersedeActiveOtps(accountKey, role, kind, exceptId = "") {
  const rows = await listRecentRows(accountKey, role, kind, 20).catch(() => []);
  const now = new Date().toISOString();
  for (const row of rows) {
    if (!row?.id || (exceptId && row.id === exceptId)) continue;
    if (!rowIsActiveOtp(row, kind) && String(row.status || "") !== "active") continue;
    await supabaseJson(restUrl("password_reset_requests", `?id=eq.${encodeURIComponent(row.id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({
        status: "superseded",
        updated_at: now,
        detail: `superseded_at:${Date.now()}`,
      }),
    }).catch(() => null);
  }
}

/**
 * Rotate active OTP only after email send succeeded.
 * Failed sends must call recordOtpSendFailure instead — old active OTP stays valid.
 */
export async function commitOtpAfterSuccessfulSend({
  accountKey,
  role,
  code,
  kind = "otp",
  ttlMs = DEFAULT_TTL_MS,
  provider = "resend",
  providerMessageId = "",
} = {}) {
  return storeOtp({
    accountKey,
    role,
    code,
    kind,
    ttlMs,
    provider,
    providerMessageId,
    deliveryStatus: "sent",
    sentAt: Date.now(),
    supersedePrevious: true,
  });
}

/** Audit-only row; does not supersede or invalidate any active OTP. */
export async function recordOtpSendFailure({
  accountKey,
  role,
  kind = "otp",
  code = "",
  error = "",
  provider = "",
  providerMessageId = "",
} = {}) {
  const id = newRequestId();
  const key = normAccount(accountKey);
  const r = normRole(role);
  const k = normKind(kind);
  const payload = {
    id,
    account: key,
    role: r,
    kind: k,
    status: "send_failed",
    code: code ? String(code) : null,
    expires_at: null,
    sent_at: null,
    provider: String(provider || ""),
    provider_message_id: String(providerMessageId || ""),
    delivery_status: "failed",
    verify_fails: 0,
    detail: String(error || "").slice(0, 500),
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
  try {
    await supabaseJson(restUrl("password_reset_requests"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(payload),
    });
  } catch (err) {
    if (isMissingTable(err)) {
      console.error("[otp-store] recordOtpSendFailure missing table", err.message || err);
      return { ok: false, id, code: "OTP_TABLE_MISSING" };
    }
    console.error("[otp-store] recordOtpSendFailure", err.message || err);
    return { ok: false, id };
  }
  return { ok: true, id };
}

export async function findOtp(accountKey, role, kind = "otp") {
  const key = normAccount(accountKey);
  const r = normRole(role);
  const k = normKind(kind);
  const rows = await listRecentRows(key, r, k, 12);
  for (const row of rows) {
    if (rowIsActiveOtp(row, k)) {
      const mapped = mapFoundRow(row, k);
      if (mapped?.code) return mapped;
    }
  }
  // Verified tokens (post-OTP) for forgot / register flows
  for (const row of rows) {
    const mapped = mapFoundRow(row, k);
    if (mapped?.verifiedToken && Number(mapped.exp) > Date.now()) return mapped;
  }
  return null;
}

export async function assertOtpVerifyNotLocked(accountKey, role, kind = "otp", maxFails = DEFAULT_MAX_VERIFY_FAILS) {
  const hit = await findOtp(accountKey, role, kind);
  if (hit && Number(hit.verifyFails || hit.row?.verify_fails || 0) >= maxFails) {
    throw Object.assign(new Error("验证码错误次数过多，请稍后再试。"), {
      status: 429,
      code: "OTP_VERIFY_LOCKED",
    });
  }
  return hit;
}

export async function recordOtpVerifyFail(accountKey, role, kind = "otp") {
  const hit = await findOtp(accountKey, role, kind);
  if (!hit?.id) return { ok: false };
  const next = Number(hit.verifyFails || hit.row?.verify_fails || 0) + 1;
  await supabaseJson(restUrl("password_reset_requests", `?id=eq.${encodeURIComponent(hit.id)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ verify_fails: next, updated_at: new Date().toISOString() }),
  }).catch(() => null);
  return { ok: true, fails: next };
}

export async function clearOtpVerifyFails(accountKey, role, kind = "otp") {
  const hit = await findOtp(accountKey, role, kind);
  if (!hit?.id) return { ok: false };
  await supabaseJson(restUrl("password_reset_requests", `?id=eq.${encodeURIComponent(hit.id)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ verify_fails: 0, updated_at: new Date().toISOString() }),
  }).catch(() => null);
  return { ok: true };
}

export async function markOtpVerified(accountKey, role, kind, rowId, token, ttlMs = 30 * 60 * 1000) {
  const key = normAccount(accountKey);
  const r = normRole(role);
  const k = normKind(kind);
  const exp = Date.now() + ttlMs;
  const statusPrefix = k === "register_otp" ? "register_verified" : "verified";
  const status = `${statusPrefix}:${token}:exp:${exp}`;
  const id = rowId && !String(rowId).startsWith("mcj_otp_") ? rowId : null;
  if (!id) {
    throw Object.assign(new Error("验证码记录缺失，请重新获取。"), { status: 400, code: "OTP_ROW_MISSING" });
  }
  try {
    await supabaseJson(restUrl("password_reset_requests", `?id=eq.${encodeURIComponent(id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({
        status,
        code: null,
        verify_fails: 0,
        expires_at: new Date(exp).toISOString(),
        updated_at: new Date().toISOString(),
        detail: status,
      }),
    });
  } catch (err) {
    if (isMissingTable(err)) throw missingTableError(err);
    throw err;
  }
  return exp;
}

export async function findRegisterVerified(accountKey, role, token) {
  const key = normAccount(accountKey);
  const r = normRole(role || "companion");
  const want = String(token || "").trim();
  if (!want) return null;
  const rows = await listRecentRows(key, r, "register_otp", 12).catch(() => []);
  const re = /^register_verified:([A-Za-z0-9_-]+):exp:(\d+)$/;
  for (const row of rows) {
    const m = String(row.status || "").match(re);
    if (m && m[1] === want && Number(m[2]) > Date.now()) {
      return { id: row.id, verifiedToken: m[1], exp: Number(m[2]), row, source: "password_reset_requests" };
    }
  }
  return null;
}

export async function invalidateOtp(accountKey, role, kind = "otp") {
  const key = normAccount(accountKey);
  const r = normRole(role);
  const k = normKind(kind);
  const usedStatus = `used:${Date.now()}`;
  const rows = await listRecentRows(key, r, k, 20).catch(() => []);
  for (const row of rows) {
    if (!row?.id) continue;
    if (!rowIsActiveOtp(row, k) && String(row.status || "") !== "active") continue;
    await supabaseJson(restUrl("password_reset_requests", `?id=eq.${encodeURIComponent(row.id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({
        status: usedStatus,
        code: null,
        updated_at: new Date().toISOString(),
      }),
    }).catch(() => null);
  }
  return { ok: true };
}

export async function consumeRegisterVerified(accountKey, role, token) {
  const hit = await findRegisterVerified(accountKey, role, token);
  if (!hit) {
    throw Object.assign(new Error("邮箱验证已失效，请重新获取验证码。"), { status: 400 });
  }
  const key = normAccount(accountKey);
  const r = normRole(role || "companion");
  if (hit.id) {
    await supabaseJson(restUrl("password_reset_requests", `?id=eq.${encodeURIComponent(hit.id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ status: `register_used:${Date.now()}`, updated_at: new Date().toISOString() }),
    }).catch(() => null);
  }
  return { ok: true, email: key, role: r };
}

export const OTP_STORE_COOLDOWN_MS = DEFAULT_COOLDOWN_MS;
export const OTP_STORE_TTL_MS = DEFAULT_TTL_MS;
