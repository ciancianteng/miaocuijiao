/**
 * Designated companion confirm window (claimed status).
 *
 * 2026-08 round acceptance: companion confirm TIMEOUT is cancelled.
 * Orders stay in `claimed` until companion accepts/rejects or CS reassigns.
 * Stamp helpers remain for audit notes; expire/isTimedOut are no-ops.
 */
import "./_load-env.js";

/** Retained for callers; timeout mechanism disabled (no auto-expire). */
export const COMPANION_CONFIRM_TIMEOUT_MS = 0;
export const COMPANION_CONFIRM_TIMEOUT_DISABLED = true;

function nowIso() {
  return new Date().toISOString();
}

export function confirmDeadlineIso(fromIso) {
  // No deadline when timeout is cancelled.
  return "";
}

/** Stamp claim time into note (audit only; not used for expiry). */
export function stampClaimedAtNote(note, atIso = nowIso()) {
  const cleaned = String(note || "")
    .replace(/\n?\[\[CLAIMED_AT\]\][^\n]*/g, "")
    .trim();
  return `${cleaned}\n[[CLAIMED_AT]]${atIso}`.trim();
}

export function claimedAtFromOrder(order = {}) {
  const note = String(order.note || order.description || "");
  const hit = note.match(/\[\[CLAIMED_AT\]\]\s*([^\n|]+)/i);
  if (hit?.[1] && !Number.isNaN(Date.parse(hit[1].trim()))) return hit[1].trim();
  if (order.paid_at && !Number.isNaN(Date.parse(order.paid_at))) return order.paid_at;
  return "";
}

export function isCompanionConfirmTimedOut() {
  return false;
}

/**
 * No-op: companion confirm timeout mechanism has been cancelled.
 * @returns {Promise<number>} always 0
 */
export async function expireCompanionConfirmTimeouts() {
  return 0;
}
