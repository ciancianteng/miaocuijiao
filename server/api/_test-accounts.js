/**
 * Production-safe test / smoke account detection for dashboard aggregation
 * and runtime write guards. Does not delete or mutate data.
 *
 * Match rules (any one → test):
 * - email contains @meow.test (case-insensitive)
 * - email domain used by prod-smoke fixtures (@mcj-prod-smoke.invalid)
 * - display_name / nickname / username contains Smoke or ProdSmoke
 * - is_test_account / is_test === true
 */

const MEOW_TEST_EMAIL_RE = /@meow\.test\b/i;
const PROD_SMOKE_EMAIL_RE = /@mcj-prod-smoke\.invalid\b/i;
/** Username / display markers used by ProdSmoke* and *Smoke* E2E fixtures */
const SMOKE_NAME_RE = /prodsmoke|smoke/i;

export function isProductionRuntime(env = process.env) {
  const vercel = String(env.VERCEL_ENV || "").toLowerCase();
  const app = String(env.APP_ENV || "").toLowerCase();
  const nodeEnv = String(env.NODE_ENV || "").toLowerCase();
  if (vercel === "production" || app === "production") return true;
  // Prefer Vercel/APP env; never treat plain NODE_ENV alone as prod when VERCEL_ENV=preview.
  if (vercel === "preview" || vercel === "development") return false;
  if (app === "staging" || app === "preview" || app === "development") return false;
  return nodeEnv === "production" && !vercel && !app;
}

export function isTestEmail(email = "") {
  const e = String(email || "").trim();
  if (!e) return false;
  return MEOW_TEST_EMAIL_RE.test(e) || PROD_SMOKE_EMAIL_RE.test(e);
}

export function isTestUsername(...parts) {
  const joined = parts
    .map((p) => String(p == null ? "" : p).trim())
    .filter(Boolean)
    .join(" ");
  if (!joined) return false;
  return SMOKE_NAME_RE.test(joined);
}

export function isTestAccountFlag(row = {}) {
  if (!row || typeof row !== "object") return false;
  return row.is_test_account === true || row.is_test === true;
}

/**
 * True when a profile / companion row should be excluded from production business stats
 * and blocked from Production write paths.
 * @param {object} row profile-like object
 * @param {object} [extra] optional companion_profiles / denormalized fields
 */
export function isTestAccountRecord(row = {}, extra = {}) {
  if (isTestAccountFlag(row) || isTestAccountFlag(extra)) return true;
  if (isTestEmail(row.email) || isTestEmail(extra.email)) return true;
  if (
    isTestUsername(
      row.display_name,
      row.nickname,
      row.name,
      row.account,
      extra.display_name,
      extra.nickname,
      extra.name
    )
  ) {
    return true;
  }
  return false;
}

/** Hard-blocked production test admin identity (login / register). */
export function isBlockedProductionTestAdmin(email = "") {
  return String(email || "").trim().toLowerCase() === "admin@meow.test";
}

/**
 * Production must refuse smoke / @meow.test identities for login & register.
 * Broader than admin-only: any @meow.test or Smoke/ProdSmoke display name.
 */
export function shouldBlockTestIdentityOnProduction({ email = "", displayName = "" } = {}, env = process.env) {
  if (!isProductionRuntime(env)) return false;
  if (isBlockedProductionTestAdmin(email)) return true;
  if (isTestEmail(email)) return true;
  if (isTestUsername(displayName)) return true;
  return false;
}

export const PROD_TEST_ACCOUNT_BLOCK_MESSAGE =
  "正式环境禁止使用测试账号（@meow.test / Smoke）登录或注册。请使用正式管理员账号。";

/**
 * Build id → profile map and a Set of test profile ids for order filtering.
 * @param {object[]} profiles
 */
export function indexProfilesForStats(profiles = []) {
  const byId = new Map();
  const testIds = new Set();
  for (const p of profiles || []) {
    if (!p?.id) continue;
    byId.set(p.id, p);
    if (isTestAccountRecord(p)) testIds.add(p.id);
  }
  return { byId, testIds };
}

/**
 * True when an order involves a known test party (by id set or denormalized names).
 */
export function isTestTouchedOrder(order = {}, testIds = new Set(), byId = new Map()) {
  const partyIds = [order.boss_id, order.companion_id, order.customer_service_id, order.player_id].filter(
    Boolean
  );
  for (const id of partyIds) {
    if (testIds.has(id)) return true;
    const p = byId.get(id);
    if (p && isTestAccountRecord(p)) return true;
  }
  if (
    isTestUsername(
      order.boss_name,
      order.companion_name,
      order.player_name,
      order.customer_service_name,
      order.service_name
    )
  ) {
    return true;
  }
  return false;
}

/** Alias used by some callers. */
export function isTestOrderRecord(order = {}, testIds = new Set(), byId = new Map()) {
  return isTestTouchedOrder(order, testIds, byId);
}

export function filterBusinessProfiles(profiles = [], role) {
  return (profiles || []).filter((p) => {
    if (role && p.role !== role) return false;
    return !isTestAccountRecord(p);
  });
}
