/**
 * Earnings / after-sale time windows (server-side SoT).
 *
 * Companion withdrawable unlock:
 *   completed_at + 24h  (independent of Boss after-sale close)
 *
 * Boss after-sale close (whichever first):
 *   A) completed_at + 24h
 *   B) Boss manual confirm completion (boss_manual)
 */
export const MS_24H = 24 * 60 * 60 * 1000;
export const COMPANION_WITHDRAW_LOCK_MS = MS_24H;
export const BOSS_AFTER_SALE_WINDOW_MS = MS_24H;
export const AFTER_SALE_CLOSED_MARKER = "[[AFTER_SALE_CLOSED]]";

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

/** When companion order income becomes withdrawable (completed_at + 24h). */
export function companionWithdrawableAtIso(order = {}) {
  const ms = parseCompletedAtMs(order);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + COMPANION_WITHDRAW_LOCK_MS).toISOString();
}

export function isCompanionEarningsLocked(order = {}, nowMs = Date.now()) {
  const st = normalizeOrderStatus(order.status || order.orderStatus);
  if (st && st !== "completed" && st !== "reviewed") return true;
  const ms = parseCompletedAtMs(order);
  if (!Number.isFinite(ms)) return true;
  return nowMs < ms + COMPANION_WITHDRAW_LOCK_MS;
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
