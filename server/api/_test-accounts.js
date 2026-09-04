/**
 * Production-safe test / smoke account detection for dashboard aggregation
 * and runtime write / login guards. Does not delete or mutate data.
 *
 * Layers:
 * 1) Stats / business-write exclusion (`isTestAccountRecord`):
 *    - email @meow.test or @mcj-prod-smoke.invalid
 *    - display_name / nickname contains Smoke or ProdSmoke
 *    - is_test_account / is_test === true
 *    (PR148 dashboard filter — keep broad exclusion)
 *
 * 2) Production login / register identity block (`shouldBlockTestIdentityOnProduction`):
 *    - Explicit smoke / fixture identities only (not every @meow.test address)
 *    - Exception: bootstrap admin `admin@meow.test` may log into Admin Portal
 *      until DISABLE_PROD_TEST_ADMIN=1 (or ALLOW_PROD_TEST_ADMIN=0)
 */

const MEOW_TEST_EMAIL_RE = /@meow\.test\b/i;
const PROD_SMOKE_EMAIL_RE = /@mcj-prod-smoke\.invalid\b/i;
/** Username / display markers used by ProdSmoke* and *Smoke* E2E fixtures */
const SMOKE_NAME_RE = /prodsmoke|smoke/i;

/** Exact fixture emails used by Preview/Staging smoke suites */
const KNOWN_SMOKE_FIXTURE_EMAILS = new Set([
  "boss@meow.test",
  "companion@meow.test",
  "service@meow.test",
  "player@meow.test",
  "cs@meow.test",
]);

/**
 * Prefix / pattern fixtures at @meow.test (ui.accept.*, *.smoke.*, prodsmoke*, …).
 * Does NOT match arbitrary @meow.test addresses.
 */
const SMOKE_FIXTURE_LOCAL_RE =
  /^(?:ui\.accept\.|.*\.smoke\.|smoke\.|prodsmoke|boss\.final\.|companion\.|service\.final\.|cs\.smoke\.)/i;

export const BOOTSTRAP_TEST_ADMIN_EMAIL = "admin@meow.test";

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

/** Bootstrap Admin Portal identity (dev-stage production unlock). */
export function isBootstrapTestAdmin(email = "") {
  return String(email || "").trim().toLowerCase() === BOOTSTRAP_TEST_ADMIN_EMAIL;
}

/**
 * @deprecated Use isBootstrapTestAdmin + shouldBlockTestIdentityOnProduction({ loginPortal }).
 * Kept so older imports still resolve; no longer means "always blocked on prod".
 */
export function isBlockedProductionTestAdmin(email = "") {
  return isBootstrapTestAdmin(email);
}

/**
 * When false, admin@meow.test cannot log into Production Admin Portal.
 * Set DISABLE_PROD_TEST_ADMIN=1 (or ALLOW_PROD_TEST_ADMIN=0) after a formal admin exists.
 * Also see scripts/disable-prod-test-admin.mjs to disable the account itself.
 */
export function isProdTestAdminBootstrapEnabled(env = process.env) {
  const disable = String(env.DISABLE_PROD_TEST_ADMIN || "").trim().toLowerCase();
  if (disable === "1" || disable === "true" || disable === "yes") return false;
  const allow = String(env.ALLOW_PROD_TEST_ADMIN || "").trim().toLowerCase();
  if (allow === "0" || allow === "false" || allow === "no") return false;
  return true;
}

function normalizePortalHint(loginPortal = "", purpose = "") {
  return String(loginPortal || purpose || "")
    .trim()
    .toLowerCase();
}

export function isAdminPortalLogin(loginPortal = "", purpose = "") {
  const hint = normalizePortalHint(loginPortal, purpose);
  return hint === "admin" || hint === "super_admin" || hint === "admin_login";
}

/**
 * Explicit smoke / fixture identity for Production login & register gates.
 * Intentionally narrower than `isTestEmail` — does not ban every @meow.test address.
 */
export function isExplicitSmokeIdentity({ email = "", displayName = "", row = null } = {}) {
  if (isTestAccountFlag(row || {})) return true;
  const e = String(email || "").trim().toLowerCase();
  if (!e) {
    return isTestUsername(displayName);
  }
  if (PROD_SMOKE_EMAIL_RE.test(e)) return true;
  if (KNOWN_SMOKE_FIXTURE_EMAILS.has(e)) return true;
  if (MEOW_TEST_EMAIL_RE.test(e)) {
    const local = e.split("@")[0] || "";
    if (SMOKE_FIXTURE_LOCAL_RE.test(local)) return true;
  }
  if (isTestUsername(displayName, row?.display_name, row?.nickname, row?.name)) return true;
  return false;
}

/**
 * Production must refuse smoke / fixture identities for login & register.
 *
 * Options:
 * - loginPortal / purpose: when `admin` + bootstrap enabled, allow admin@meow.test
 * - purpose `register`: also refuse any @meow.test registration on Production
 */
export function shouldBlockTestIdentityOnProduction(
  { email = "", displayName = "", loginPortal = "", purpose = "", row = null } = {},
  env = process.env
) {
  if (!isProductionRuntime(env)) return false;

  const portal = normalizePortalHint(loginPortal, purpose);
  const isRegister = portal === "register" || purpose === "register";

  if (isBootstrapTestAdmin(email)) {
    if (!isRegister && isAdminPortalLogin(loginPortal, purpose) && isProdTestAdminBootstrapEnabled(env)) {
      return false;
    }
    return true;
  }

  if (isExplicitSmokeIdentity({ email, displayName, row })) return true;

  // New Production registrations must not mint fixture-domain accounts.
  if (isRegister && isTestEmail(email)) return true;

  return false;
}

export const PROD_TEST_ACCOUNT_BLOCK_MESSAGE =
  "正式环境禁止使用测试账号（Smoke / 明确测试标记）登录或注册。请使用正式账号。";

/**
 * Block Production business writes (orders, marketplace, withdrawals, …)
 * for any profile matching `isTestAccountRecord` (keeps PR148 broad filter).
 * Returns `{ ok:false, message, code }` or null when allowed.
 */
export function productionTestAccountWriteBlock(profile = {}, env = process.env) {
  if (!isProductionRuntime(env)) return null;
  if (!isTestAccountRecord(profile || {})) return null;
  return {
    ok: false,
    message: PROD_TEST_ACCOUNT_BLOCK_MESSAGE,
    code: "PROD_TEST_ACCOUNT_BLOCKED",
  };
}

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
