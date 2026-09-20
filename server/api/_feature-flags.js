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

/**
 * Boss open invite links (generate / resolve / redeem → existing 直属 bind).
 * Env: BOSS_INVITE_LINKS_ENABLED
 * Production fail-closed when unset; non-production defaults on (local/staging).
 */
export function isBossInviteLinksEnabled(env = process.env) {
  const parsed = parseBoolFlag(env.BOSS_INVITE_LINKS_ENABLED);
  if (parsed != null) return parsed;
  return !isProductionRuntime(env);
}

export function bossInviteLinksDisabledReason(env = process.env) {
  if (isBossInviteLinksEnabled(env)) return null;
  return "boss_invite_links_flag_disabled";
}

/**
 * Pricing V2 read cutover (P4). Alias: PRICING_V2.
 * P1–P3: leave unset / false — resolver keeps legacy-first equivalence.
 * P4: enable on Staging then Production gray. Never blast-enable in P1.
 * Env: PRICE_V2 or PRICING_V2
 */
export function isPricingV2Enabled(env = process.env) {
  const parsed = parseBoolFlag(env.PRICE_V2 ?? env.PRICING_V2);
  if (parsed != null) return parsed;
  return false;
}

export function pricingV2DisabledReason(env = process.env) {
  if (isPricingV2Enabled(env)) return null;
  return "pricing_v2_flag_disabled";
}
