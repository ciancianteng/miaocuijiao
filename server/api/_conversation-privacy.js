/**
 * Boss↔CS and Companion↔CS conversation isolation helpers.
 * Order data may be shared; chat transcripts must never be.
 */

export function conversationTypeOf(row = {}) {
  const raw = String(row.conversation_type || "").trim().toLowerCase();
  if (raw) return raw;
  // Legacy rows without conversation_type.
  if (row.boss_id && !row.companion_id) return "order_support";
  if (row.companion_id && !row.boss_id) return "companion_support";
  if (row.order_id && row.boss_id) return "order_support";
  if (row.companion_id) return "companion_support";
  return "general_support";
}

/** Boss↔CS only (order or general). Never companion_support. */
export function isBossCsConversation(row = {}) {
  const t = conversationTypeOf(row);
  if (t === "companion_support") return false;
  if (t === "order_support" || t === "general_support") return true;
  // Legacy: has boss, typed as support-ish.
  return Boolean(row.boss_id) && t !== "companion_support";
}

/** Companion↔CS only. */
export function isCompanionCsConversation(row = {}) {
  const t = conversationTypeOf(row);
  if (t === "companion_support") return true;
  // Legacy companion-only rows (no boss).
  return Boolean(row.companion_id) && !row.boss_id && t !== "order_support" && t !== "general_support";
}

export function assertCompanionCanAccessConversation(row, companionUserId) {
  const uid = String(companionUserId || "").trim();
  if (!uid || !row?.id) {
    throw Object.assign(new Error("会话不存在或无权访问"), { status: 404 });
  }
  if (String(row.companion_id || "") !== uid) {
    throw Object.assign(new Error("会话不存在或无权访问"), { status: 404 });
  }
  if (!isCompanionCsConversation(row)) {
    throw Object.assign(new Error("无权访问该会话"), { status: 403 });
  }
  return true;
}

export function assertBossCanAccessConversation(row, bossUserId) {
  const uid = String(bossUserId || "").trim();
  if (!uid || !row?.id) {
    throw Object.assign(new Error("会话不存在或无权访问"), { status: 404 });
  }
  if (String(row.boss_id || "") !== uid) {
    throw Object.assign(new Error("会话不存在或无权访问"), { status: 404 });
  }
  if (!isBossCsConversation(row)) {
    throw Object.assign(new Error("无权访问该会话"), { status: 403 });
  }
  return true;
}

/** PostgREST filter fragment: companion may only list companion_support (+ legacy companion-only). */
export function companionSupportListFilter(companionUserId) {
  const uid = encodeURIComponent(String(companionUserId || "").trim());
  return `and=(companion_id.eq.${uid},or(conversation_type.eq.companion_support,and(conversation_type.is.null,boss_id.is.null)))`;
}
