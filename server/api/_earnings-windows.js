/**
 * Earnings / after-sale time windows (server-side SoT).
 *
 * Companion withdrawable unlock (whichever first):
 *   A) Boss manual confirm completion → unlock immediately at bossConfirmedAt (= completed_at)
 *   B) serviceCompletedAt + 24h (companion apply-complete / COMPLETION_REQUESTED_AT)
 *
 * Boss after-sale close (whichever first):
 *   A) completed_at + 24h
 *   B) Boss manual confirm completion (boss_manual)
 *
 * IMPORTANT: Boss confirm only unlocks withdraw — it must NOT re-settle income.
 */
export const MS_24H = 24 * 60 * 60 * 1000;
export const COMPANION_WITHDRAW_LOCK_MS = MS_24H;
export const BOSS_AFTER_SALE_WINDOW_MS = MS_24H;
export const AFTER_SALE_CLOSED_MARKER = "[[AFTER_SALE_CLOSED]]";
export const COMPLETION_REQUESTED_AT_MARKER = "[[COMPLETION_REQUESTED_AT]]";

export function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function normalizeOrderStatus(status) {
  return String(status || "")
    .trim()
    .toLowerCase();
}

export function resolveCompletionMethod(order = {}) {
  const col = String(order.completion_method || order.completionMethod || "").trim();
  if (col) return col;
  const blob = `${order.note || ""}\n${order.description || ""}`;
  const m = blob.match(/\[\[COMPLETION_METHOD\]\]\s*([^\n\]]+)/i);
  return String(m?.[1] || "").trim();
}

export function parseCompletedAtMs(order = {}) {
  const raw = order.completed_at || order.completedAt || "";
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : NaN;
}

export function parseCompletionRequestedAtMs(order = {}) {
  const blob = `${order.note || ""}\n${order.description || ""}`;
  const hit = blob.match(/\[\[COMPLETION_REQUESTED_AT\]\]\s*([^\n|]+)/i);
  if (hit?.[1]) {
    const ms = Date.parse(String(hit[1]).trim());
    if (Number.isFinite(ms)) return ms;
  }
  const col = order.completion_requested_at || order.completionRequestedAt || "";
  const ms = Date.parse(String(col));
  return Number.isFinite(ms) ? ms : NaN;
}

/** Boss confirmed complete → unlock immediately (completed_at is the confirm stamp). */
export function parseBossConfirmedAtMs(order = {}) {
  const method = resolveCompletionMethod(order);
  if (method === "boss_manual") {
    return parseCompletedAtMs(order);
  }
  const blob = `${order.note || ""}\n${order.description || ""}`;
  if (new RegExp(`${AFTER_SALE_CLOSED_MARKER.replace(/[[\]]/g, "\\$&")}\\s*boss_manual`, "i").test(blob)) {
    return parseCompletedAtMs(order);
  }
  const col = order.boss_confirmed_at || order.bossConfirmedAt || "";
  const ms = Date.parse(String(col));
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * Service-complete clock for the 24h auto unlock.
 * Prefer companion apply-complete stamp; fall back carefully by completion method.
 */
export function parseServiceCompletedAtMs(order = {}) {
  const requested = parseCompletionRequestedAtMs(order);
  if (Number.isFinite(requested)) return requested;
  const method = resolveCompletionMethod(order);
  const completed = parseCompletedAtMs(order);
  // system_auto_24h already fires at (or after) the 24h mark —
  // treat completed_at as the unlock instant (not completed_at+24h again).
  if (method === "system_auto_24h") {
    return Number.isFinite(completed) ? completed - COMPANION_WITHDRAW_LOCK_MS : NaN;
  }
  return completed;
}

/**
 * Canonical unlock instant = earliest of:
 *   - bossConfirmedAt (if Boss confirmed)
 *   - serviceCompletedAt + 24h
 */
export function companionWithdrawableAtMs(order = {}) {
  const st = normalizeOrderStatus(order.status || order.orderStatus);
  if (st && st !== "completed" && st !== "reviewed") return NaN;

  const bossMs = parseBossConfirmedAtMs(order);
  const serviceMs = parseServiceCompletedAtMs(order);
  const autoMs = Number.isFinite(serviceMs) ? serviceMs + COMPANION_WITHDRAW_LOCK_MS : NaN;

  if (Number.isFinite(bossMs) && Number.isFinite(autoMs)) return Math.min(bossMs, autoMs);
  if (Number.isFinite(bossMs)) return bossMs;
  if (Number.isFinite(autoMs)) return autoMs;
  return NaN;
}

/** When companion order income becomes withdrawable. */
export function companionWithdrawableAtIso(order = {}) {
  const ms = companionWithdrawableAtMs(order);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toISOString();
}

export function isCompanionEarningsLocked(order = {}, nowMs = Date.now()) {
  const st = normalizeOrderStatus(order.status || order.orderStatus);
  if (st && st !== "completed" && st !== "reviewed") return true;
  const unlockMs = companionWithdrawableAtMs(order);
  if (!Number.isFinite(unlockMs)) return true;
  return nowMs < unlockMs;
}

export function companionEarningsUnlockMeta(order = {}, nowMs = Date.now()) {
  const locked = isCompanionEarningsLocked(order, nowMs);
  const unlockAt = companionWithdrawableAtIso(order);
  const bossMs = parseBossConfirmedAtMs(order);
  const bossConfirmed = Number.isFinite(bossMs);
  return {
    locked,
    unlockAt,
    bossConfirmedAt: bossConfirmed ? new Date(bossMs).toISOString() : "",
    unlockReason: !locked
      ? bossConfirmed
        ? "boss_confirmed_early"
        : "auto_24h"
      : "waiting",
    statusLabel: !locked
      ? bossConfirmed
        ? "可提现 · Boss已确认完成 · 已提前解锁"
        : "可提现"
      : unlockAt
        ? `锁定中 · 预计解锁 ${unlockAt}`
        : "锁定中",
  };
}

/**
 * Boss after-sale / refund request gate for completed orders.
 * Pre-completion (confirmed / in_progress): still open.
 * Completed + boss_manual: closed immediately.
 * Completed otherwise: open until completed_at + 24h.
 */
export function isBossAfterSaleOpen(order = {}, nowMs = Date.now()) {
  const st = normalizeOrderStatus(order.status);
  if (!st) return false;
  if (st === "refunded" || st === "cancelled" || st === "canceled") return false;
  if (st === "refund_requested" || st === "after_sale") return true;
  if (st === "confirmed" || st === "in_progress") return true;
  if (st !== "completed" && st !== "reviewed") return false;

  const blob = `${order.note || ""}\n${order.description || ""}`;
  if (new RegExp(AFTER_SALE_CLOSED_MARKER.replace(/[[\]]/g, "\\$&"), "i").test(blob)) {
    return false;
  }
  const method = resolveCompletionMethod(order);
  if (method === "boss_manual") return false;

  const ms = parseCompletedAtMs(order);
  if (!Number.isFinite(ms)) return false;
  return nowMs < ms + BOSS_AFTER_SALE_WINDOW_MS;
}

export function bossAfterSaleClosesAtIso(order = {}) {
  const st = normalizeOrderStatus(order.status);
  if (st === "confirmed" || st === "in_progress") return "";
  if (st !== "completed" && st !== "reviewed") return "";
  const method = resolveCompletionMethod(order);
  if (method === "boss_manual") {
    return String(order.completed_at || order.completedAt || "") || new Date().toISOString();
  }
  const ms = parseCompletedAtMs(order);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + BOSS_AFTER_SALE_WINDOW_MS).toISOString();
}

/**
 * Split companion order-income txs into locked (earnings_locked) vs unlocked (withdrawable pool).
 * Eligibility is evaluated at call time (nowMs) — no cron required to flip withdrawable.
 */
export function splitCompanionIncomeByWithdrawLock(incomeRows = [], orderMap = new Map(), nowMs = Date.now()) {
  const locked = [];
  const unlocked = [];
  for (const tx of incomeRows || []) {
    const oid = String(tx.order_id || tx.orderId || "");
    const order = oid ? orderMap.get(oid) || null : null;
    if (!order || isCompanionEarningsLocked(order, nowMs)) locked.push(tx);
    else unlocked.push(tx);
  }
  return { locked, unlocked };
}
