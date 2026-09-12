/**
 * Role-scoped privacy filters. Never rely on frontend-only hiding.
 *
 * Roles: public | boss | companion | customer_service | admin
 */

import {
  anonymousBossLabel,
  csDisplayName,
  resolveBossPublicCode,
  resolveCompanionPublicCode,
} from "./_account-codes.js";

const ANON_BOSS_AVATAR = "/default-avatar.png";

const SENSITIVE_KEYS = [
  "email",
  "phone",
  "password",
  "password_hash",
  "id_card",
  "identity_no",
  "identityNo",
  "idCard",
  "bank_account",
  "bankAccount",
  "bank_name",
  "bankName",
  "deposit_proof",
  "depositProof",
  "deposit_voucher",
  "real_name",
  "realName",
  "id_card_front",
  "id_card_back",
  "payment_secret",
  "api_key",
  "apiKey",
  "secret_key",
  "webhook_secret",
  "access_token",
  "refresh_token",
  "ip",
  "ip_address",
  "device",
  "device_info",
  "user_agent",
];

function omitKeys(obj, keys) {
  if (!obj || typeof obj !== "object") return obj;
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

/** Strip secrets that must never leave the server in any role. */
export function stripSecrets(obj) {
  return omitKeys(obj, [
    "password",
    "password_hash",
    "api_key",
    "apiKey",
    "secret_key",
    "webhook_secret",
    "access_token",
    "refresh_token",
    "service_role_key",
    "supabase_service_role",
  ]);
}

/**
 * Boss as seen by companion (or public): code + anonymous avatar only.
 */
export function bossForCompanion(profile = {}, extras = {}) {
  const code = resolveBossPublicCode(profile, extras);
  return {
    bossUid: code,
    boss_uid: code,
    publicId: code,
    bossName: anonymousBossLabel(profile, extras),
    name: anonymousBossLabel(profile, extras),
    avatar: ANON_BOSS_AVATAR,
    avatarUrl: ANON_BOSS_AVATAR,
  };
}

/** Reject email / test-account strings so CS never shows boss.final…@meow.test style labels. */
function looksLikeAccountLeak(name) {
  const s = String(name || "").trim();
  if (!s) return true;
  if (/@/.test(s)) return true;
  if (/\.(test|meow)\b/i.test(s)) return true;
  if (/^(boss|companion|service|admin|cs)\./i.test(s)) return true;
  if (/^[a-z0-9._+-]+\.[a-z0-9._+-]+\.\d{8,}$/i.test(s)) return true;
  return false;
}

/**
 * Boss as seen by CS: nickname + MCJ code for work; never email/phone/wallet/test account strings.
 */
export function bossForCs(profile = {}, extras = {}) {
  const code = resolveBossPublicCode(profile, extras);
  const rawName = String(profile.display_name || extras.displayName || extras.nickname || "").trim();
  const name = looksLikeAccountLeak(rawName) ? "" : rawName;
  const label = name || (code ? `老板 ${code}` : "老板");
  return {
    id: profile.id || extras.id || "",
    bossUid: code,
    boss_uid: code,
    bossName: label,
    name: label,
    avatar: profile.avatar_url || ANON_BOSS_AVATAR,
  };
}

/**
 * Companion public card fields (hall / boss / CS work view).
 */
export function companionPublicCard(row = {}, profile = {}, extras = {}) {
  const code = resolveCompanionPublicCode(row, extras);
  const nickname =
    String(row.nickname || profile.display_name || extras.nickname || extras.name || "").trim() || "陪玩";
  return {
    id: row.user_id || row.id || extras.id || "",
    publicId: code,
    companionCode: code,
    companion_code: code,
    nickname,
    name: nickname,
    level: row.level_name || row.level_id || extras.level || "",
    price: row.price ?? row.price_min ?? extras.price ?? null,
    game: row.game || extras.game || "",
    onlineStatus: row.availability_status || row.online_status || extras.onlineStatus || "offline",
    avatar: extras.avatar || profile.avatar_url || row.avatar_url || "",
    intro: row.intro || row.bio || "",
  };
}

/**
 * CS display object — name only for frontends; email only for admin account column.
 */
export function csPublic(row = {}, { includeEmail = false } = {}) {
  const out = {
    id: row.id || "",
    name: csDisplayName(row),
    displayName: csDisplayName(row),
    status: row.status || "active",
    avatar: row.avatar_url || "",
  };
  if (includeEmail) out.account = row.email || "";
  return out;
}

/**
 * Remove sensitive keys from an arbitrary payload for a viewer role.
 */
export function filterByRole(payload, role) {
  const r = String(role || "public").toLowerCase();
  let out = stripSecrets(payload);
  if (r === "admin" || r === "super_admin") return out;

  out = omitKeys(out, SENSITIVE_KEYS);

  if (r === "customer_service" || r === "service") {
    out = omitKeys(out, [
      "identity_no",
      "identityNo",
      "id_card",
      "bank_account",
      "bankAccount",
      "bank_name",
      "deposit_proof",
      "wallet_ledger",
      "walletLedger",
      "payment_channels",
      "api_keys",
    ]);
  }

  if (r === "companion" || r === "public" || r === "boss") {
    out = omitKeys(out, ["bossEmail", "bossPhone", "boss_email", "boss_phone", "email", "phone"]);
  }

  return out;
}

export function assertNoSensitiveLeak(obj, context = "") {
  const json = JSON.stringify(obj || {});
  const hits = [];
  if (/"password"\s*:\s*"[^"]+"/i.test(json)) hits.push("password");
  if (/"api_key"\s*:\s*"[^"]+"/i.test(json)) hits.push("api_key");
  if (/"service_role/i.test(json)) hits.push("service_role");
  if (hits.length) {
    const err = new Error(`隐私泄漏检测失败 (${context}): ${hits.join(", ")}`);
    err.status = 500;
    throw err;
  }
  return true;
}
