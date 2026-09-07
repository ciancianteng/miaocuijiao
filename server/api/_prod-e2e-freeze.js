/**
 * Production E2E freeze for order / wallet / settlement mutations.
 *
 * Policy (2026-09):
 * 1) On Production runtime, any automation/E2E fingerprint is refused for
 *    place_order / pay_order / confirm_complete / wallet grant-debit /
 *    settlement finalize. No override.
 * 2) Even off Production, E2E automation may only touch parties whose
 *    profiles.is_test_account === true (strict DB flag).
 *
 * Real user traffic without E2E markers is unaffected.
 */
import { isProductionRuntime, isTestAccountFlag } from "./_test-accounts.js";

/** Idempotency / reason / description fingerprints used by settlement & payment E2E. */
export const PROD_E2E_AUTOMATION_RE =
  /(?:^|[^a-z0-9])(?:e2e|pr\d{2,}|pr[-_]?180|settlement\s*verify|alias\s*check|prodsmoke|smoke[-_]?test|mcj[-_]?e2e|verify[-_]?credit|temp\s*grant)/i;

export const PROD_E2E_IDEMPOTENCY_RE =
  /(?:^|[^a-z0-9])(?:pr\d{2,}[-_]?(?:settle|alias|verify|credit|e2e)|e2e[-_]|smoke[-_]|prodsmoke)/i;

export const PROD_E2E_SETTLEMENT_FROZEN_CODE = "PROD_E2E_SETTLEMENT_FROZEN";
export const PROD_E2E_NON_TEST_PARTY_CODE = "PROD_E2E_NON_TEST_PARTY";

export const PROD_E2E_SETTLEMENT_FROZEN_MESSAGE =
  "正式环境已冻结 E2E/自动化 下单、钱包发放与结算写入。请仅在 Staging/Preview 使用 is_test_account=true 账号测试。";

export const PROD_E2E_NON_TEST_PARTY_MESSAGE =
  "E2E/自动化 禁止对 is_test_account=false（正式账号）创建订单、钱包流水或完成结算。请改用测试账号。";

function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const want = String(name || "").toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === want) return String(v ?? "").trim();
  }
  return "";
}

/**
 * True when the request looks like an automated settlement/payment E2E.
 */
export function looksLikeE2eAutomation(ctx = {}) {
  const headers = ctx.headers || ctx.req?.headers || {};
  if (headerValue(headers, "x-mcj-e2e") === "1") return true;
  if (headerValue(headers, "x-mcj-automation") === "1") return true;
  if (/^e2e\b/i.test(headerValue(headers, "x-mcj-client"))) return true;

  const parts = [
    ctx.idempotencyKey,
    ctx.idempotency_key,
    ctx.reason,
    ctx.description,
    ctx.note,
    ctx.notes,
    ctx.gameId,
    ctx.game_id,
    ctx.title,
    ctx.message,
    ctx.body?.idempotencyKey,
    ctx.body?.idempotency_key,
    ctx.body?.reason,
    ctx.body?.description,
    ctx.body?.notes,
    ctx.body?.note,
    ctx.body?.gameId,
    ctx.body?.internalNote,
    ctx.order?.idempotency_key,
    ctx.order?.description,
    ctx.order?.note,
  ]
    .map((x) => String(x == null ? "" : x).trim())
    .filter(Boolean);

  const blob = parts.join("\n");
  if (!blob) return false;
  return PROD_E2E_AUTOMATION_RE.test(blob) || PROD_E2E_IDEMPOTENCY_RE.test(blob);
}

/**
 * Strict: every party must have DB flag is_test_account === true.
 * Missing / false / heuristic-only matches do NOT qualify.
 */
export function assertAllPartiesAreDbTestAccounts(parties = []) {
  const list = (Array.isArray(parties) ? parties : [parties]).filter(Boolean);
  if (!list.length) {
    return {
      ok: false,
      code: PROD_E2E_NON_TEST_PARTY_CODE,
      message: PROD_E2E_NON_TEST_PARTY_MESSAGE,
      reason: "missing_party_profile",
      offenders: [],
    };
  }
  const offenders = [];
  for (const p of list) {
    if (!isTestAccountFlag(p)) {
      offenders.push({
        id: p.id || "",
        email: p.email || "",
        display_name: p.display_name || p.nickname || "",
        is_test_account: p.is_test_account === true,
      });
    }
  }
  if (offenders.length) {
    return {
      ok: false,
      code: PROD_E2E_NON_TEST_PARTY_CODE,
      message: PROD_E2E_NON_TEST_PARTY_MESSAGE,
      reason: "non_test_party",
      offenders,
    };
  }
  return { ok: true, skipped: false, offenders: [] };
}

/**
 * Gate for order / wallet / settlement writers.
 * @returns {{ ok: boolean, code?: string, message?: string, frozen?: boolean, reason?: string, offenders?: object[] }}
 */
export function assertE2eOrderPaymentSettlementAllowed(ctx = {}, env = process.env) {
  if (!looksLikeE2eAutomation(ctx)) {
    return { ok: true, skipped: true, reason: "not_e2e" };
  }

  if (isProductionRuntime(env)) {
    return {
      ok: false,
      frozen: true,
      code: PROD_E2E_SETTLEMENT_FROZEN_CODE,
      message: PROD_E2E_SETTLEMENT_FROZEN_MESSAGE,
      reason: "prod_e2e_frozen",
    };
  }

  // Staging/Preview E2E: every party must carry the DB test flag.
  if (!Object.prototype.hasOwnProperty.call(ctx, "parties") || ctx.parties == null) {
    return {
      ok: false,
      code: PROD_E2E_NON_TEST_PARTY_CODE,
      message: PROD_E2E_NON_TEST_PARTY_MESSAGE,
      reason: "missing_party_profile",
      offenders: [],
    };
  }
  const partyGuard = assertAllPartiesAreDbTestAccounts(ctx.parties);
  if (!partyGuard.ok) return partyGuard;

  return { ok: true, skipped: false, reason: "e2e_non_prod_ok" };
}

export function e2eFreezeHttpResult(guard) {
  if (!guard || guard.ok) return null;
  return {
    status: 403,
    body: {
      ok: false,
      code: guard.code || PROD_E2E_SETTLEMENT_FROZEN_CODE,
      message: guard.message || PROD_E2E_SETTLEMENT_FROZEN_MESSAGE,
      reason: guard.reason || null,
      offenders: guard.offenders || undefined,
      frozen: !!guard.frozen,
    },
  };
}
