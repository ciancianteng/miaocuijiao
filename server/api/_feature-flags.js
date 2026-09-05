/**
 * Go-live feature flags for settlement / points.
 * Production fail-closed: unset → disabled when isProductionRuntime().
 * Non-production: unset → enabled (preserve local/staging behavior).
 */
import { isProductionRuntime } from "./_test-accounts.js";

function parseBoolFlag(raw) {
  if (raw == null || raw === "") return null;
  const v = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return null;
}

/**
 * Boss commission + companion settlement writes.
 * Env: SETTLEMENT_ENABLED
 */
export function isSettlementEnabled(env = process.env) {
  const parsed = parseBoolFlag(env.SETTLEMENT_ENABLED);
  if (parsed != null) return parsed;
  return !isProductionRuntime(env);
}

/**
 * Boss loyalty points award / clawback writes.
 * Env: POINTS_AWARD_ENABLED
 */
export function isPointsAwardEnabled(env = process.env) {
  const parsed = parseBoolFlag(env.POINTS_AWARD_ENABLED);
  if (parsed != null) return parsed;
  return !isProductionRuntime(env);
}

export function settlementDisabledReason(env = process.env) {
  if (isSettlementEnabled(env)) return null;
  return "settlement_flag_disabled";
}

export function pointsAwardDisabledReason(env = process.env) {
  if (isPointsAwardEnabled(env)) return null;
  return "points_award_flag_disabled";
}
