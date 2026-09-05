/**
 * Boss loyalty points (phase 1).
 * Independent from wallets (猫粮) and companion popularity points.
 *
 * awardPoints is idempotent via idempotency_key (UNIQUE on user_points_ledger).
 */
import {
  hasWalletDb,
  isMissingRelation,
  rpcUrl,
  serviceHeaders,
  supabaseJson,
  restUrl,
} from "./_wallet.js";
import { isPointsAwardEnabled, pointsAwardDisabledReason } from "./_feature-flags.js";
import {
  assertNotTestPartiesForSettlement,
  isProductionRuntime,
  isTestAccountRecord,
} from "./_test-accounts.js";

async function loadProfileForPointsGuard(userId) {
  if (!userId) return null;
  const withFlag =
    `?id=eq.${encodeURIComponent(userId)}&select=id,role,email,display_name,nickname,is_test_account&limit=1`;
  const withoutFlag =
    `?id=eq.${encodeURIComponent(userId)}&select=id,role,email,display_name,nickname&limit=1`;
  try {
    const rows = await supabaseJson(restUrl("profiles", withFlag), { headers: serviceHeaders() });
    return rows?.[0] || null;
  } catch (error) {
    const msg = String(error?.message || error || "");
    if (!/is_test_account|PGRST204|42703|schema cache/i.test(msg)) throw error;
    const rows = await supabaseJson(restUrl("profiles", withoutFlag), { headers: serviceHeaders() });
    return rows?.[0] || null;
  }
}

async function skipIfTestBossForPoints(order) {
  const bossId = order?.boss_id;
  if (!bossId && !order) return { ok: true };
  try {
    const bossProfile = bossId ? await loadProfileForPointsGuard(bossId) : null;
    if (bossProfile && isTestAccountRecord(bossProfile)) {
      return { ok: false, skipped: true, reason: "test_boss" };
    }
    const partyGuard = assertNotTestPartiesForSettlement({
      bossProfile,
      order: typeof order === "object" ? order : null,
    });
    if (!partyGuard.ok) {
      return { ok: false, skipped: true, reason: partyGuard.reason || "test_party" };
    }
    return { ok: true };
  } catch (_) {
    if (isProductionRuntime()) {
      return { ok: false, skipped: true, reason: "test_guard_error" };
    }
    return { ok: true };
  }
}

/** Fallback defaults when points_settings is missing / unreadable. */
export const DEFAULT_ORDER_COMPLETION_POINTS = 100; // deprecated fixed award fallback (legacy)
export const DEFAULT_POINTS_PER_CAT_FOOD = 10;
/** @deprecated Use DEFAULT_POINTS_PER_CAT_FOOD — order spend unit is 猫粮, not bank MYR. */
export const DEFAULT_POINTS_PER_RM = DEFAULT_POINTS_PER_CAT_FOOD;
export const DEFAULT_MIN_ORDER_CAT_FOOD = 0;
export const DEFAULT_MIN_ORDER_AMOUNT = DEFAULT_MIN_ORDER_CAT_FOOD;
export const DEFAULT_MAX_REWARD_POINTS = 0; // 0 = unlimited
export const DEFAULT_ROUNDING_MODE = "floor";
export const DEFAULT_POINTS_ENABLED = true;

/** @deprecated Fixed award constant retained for smoke / legacy imports. */
export const ORDER_COMPLETION_POINTS = DEFAULT_ORDER_COMPLETION_POINTS;

const ROUNDING_MODES = new Set(["floor", "ceil", "round"]);

export function orderPointsIdempotencyKey(orderId) {
  return `order_points:${String(orderId || "").trim()}`;
}

export function orderPointsClawbackIdempotencyKey(orderId) {
  return `order_points_clawback:${String(orderId || "").trim()}`;
}

/**
 * Boss effective spend for loyalty points — unit: 猫粮.
 * Matches refund「实付」: paid_cat_food if > 0, else total_amount.
 * Orders do not store bank MYR; do not treat this number as payment-gateway RM.
 */
export function orderEffectiveSpendAmount(order) {
  if (!order || typeof order !== "object") return 0;
  const paid = Number(order.paid_cat_food);
  if (Number.isFinite(paid) && paid > 0) return paid;
  const total = Number(order.total_amount);
  if (Number.isFinite(total) && total > 0) return total;
  const amount = Number(order.amount);
  if (Number.isFinite(amount) && amount > 0) return amount;
  return 0;
}

/** Alias: order spend in 猫粮 for points. */
export function orderEffectiveCatFoodSpend(order) {
  return orderEffectiveSpendAmount(order);
}

export function parseNonNegNumber(raw, { integer = false, fieldLabel = "数值" } = {}) {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: false, message: `请填写${fieldLabel}。` };
  }
  if (typeof raw === "boolean") {
    return { ok: false, message: `${fieldLabel}不合法。` };
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, message: `${fieldLabel}必须为大于等于 0 的${integer ? "整数" : "数字"}。` };
  }
  if (integer && !Number.isInteger(n)) {
    return { ok: false, message: `${fieldLabel}必须为大于等于 0 的整数。` };
  }
  return { ok: true, value: n };
}

/** @deprecated Prefer parseNonNegNumber for rate fields. */
export function parseOrderCompletionPoints(raw) {
  const parsed = parseNonNegNumber(raw, { integer: true, fieldLabel: "积分" });
  if (!parsed.ok) {
    return { ok: false, message: parsed.message || "积分必须为大于等于 0 的整数。" };
  }
  return parsed;
}

export function normalizeRoundingMode(raw) {
  const mode = String(raw || DEFAULT_ROUNDING_MODE).trim().toLowerCase();
  return ROUNDING_MODES.has(mode) ? mode : DEFAULT_ROUNDING_MODE;
}

export function applyRounding(value, mode) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const m = normalizeRoundingMode(mode);
  if (m === "ceil") return Math.ceil(n);
  if (m === "round") return Math.round(n);
  return Math.floor(n);
}

export function defaultBossPointsSettings() {
  return {
    id: 1,
    enabled: DEFAULT_POINTS_ENABLED,
    pointsPerCatFood: DEFAULT_POINTS_PER_CAT_FOOD,
    points_per_cat_food: DEFAULT_POINTS_PER_CAT_FOOD,
    // Legacy aliases — same numeric default; unit is 猫粮 not RM.
    pointsPerRm: DEFAULT_POINTS_PER_CAT_FOOD,
    points_per_rm: DEFAULT_POINTS_PER_CAT_FOOD,
    minOrderCatFood: DEFAULT_MIN_ORDER_CAT_FOOD,
    min_order_cat_food: DEFAULT_MIN_ORDER_CAT_FOOD,
    minOrderAmount: DEFAULT_MIN_ORDER_CAT_FOOD,
    min_order_amount: DEFAULT_MIN_ORDER_CAT_FOOD,
    maxRewardPoints: DEFAULT_MAX_REWARD_POINTS,
    roundingMode: DEFAULT_ROUNDING_MODE,
    orderCompletionPoints: DEFAULT_ORDER_COMPLETION_POINTS,
    order_completion_points: DEFAULT_ORDER_COMPLETION_POINTS,
    examples: buildPointsExamples(DEFAULT_POINTS_PER_CAT_FOOD, DEFAULT_ROUNDING_MODE),
    spendUnit: "cat_food",
    spendUnitLabel: "猫粮",
    updatedAt: null,
    createdAt: null,
  };
}

export function buildPointsExamples(pointsPerCatFood, roundingMode = DEFAULT_ROUNDING_MODE) {
  const rate = Number(pointsPerCatFood);
  const safeRate = Number.isFinite(rate) && rate >= 0 ? rate : DEFAULT_POINTS_PER_CAT_FOOD;
  return [10, 50, 100].map((catFood) => {
    const points = applyRounding(catFood * safeRate, roundingMode);
    return {
      amount: catFood,
      catFood,
      points,
      label: `${catFood}猫粮 × ${safeRate} = ${points}积分`,
    };
  });
}

export function viewPointsSettings(row) {
  if (!row) return defaultBossPointsSettings();
  const enabled = row.enabled == null ? true : !!row.enabled;
  const rateRaw = Number(
    row.points_per_cat_food != null ? row.points_per_cat_food : row.points_per_rm
  );
  const pointsPerCatFood =
    Number.isFinite(rateRaw) && rateRaw >= 0 ? rateRaw : DEFAULT_POINTS_PER_CAT_FOOD;
  const minRaw = Number(
    row.min_order_cat_food != null ? row.min_order_cat_food : row.min_order_amount
  );
  const minOrderCatFood =
    Number.isFinite(minRaw) && minRaw >= 0 ? minRaw : DEFAULT_MIN_ORDER_CAT_FOOD;
  const maxRaw = Number(row.max_reward_points);
  const maxRewardPoints =
    Number.isFinite(maxRaw) && Number.isInteger(maxRaw) && maxRaw >= 0
      ? maxRaw
      : DEFAULT_MAX_REWARD_POINTS;
  const roundingMode = normalizeRoundingMode(row.rounding_mode);
  const legacy = Number(row.order_completion_points);
  const orderCompletionPoints =
    Number.isFinite(legacy) && Number.isInteger(legacy) && legacy >= 0
      ? legacy
      : DEFAULT_ORDER_COMPLETION_POINTS;
  return {
    id: 1,
    enabled,
    pointsPerCatFood,
    points_per_cat_food: pointsPerCatFood,
    pointsPerRm: pointsPerCatFood,
    points_per_rm: pointsPerCatFood,
    minOrderCatFood,
    min_order_cat_food: minOrderCatFood,
    minOrderAmount: minOrderCatFood,
    min_order_amount: minOrderCatFood,
    maxRewardPoints,
    max_reward_points: maxRewardPoints,
    roundingMode,
    rounding_mode: roundingMode,
    orderCompletionPoints,
    order_completion_points: orderCompletionPoints,
    examples: buildPointsExamples(pointsPerCatFood, roundingMode),
    spendUnit: "cat_food",
    spendUnitLabel: "猫粮",
    updatedAt: row.updated_at || row.updatedAt || null,
    createdAt: row.created_at || row.createdAt || null,
  };
}

/**
 * rewardPoints from effective 猫粮 spend × rate (with min / max / rounding).
 */
export function computeOrderRewardPoints(amount, settingsView) {
  const cfg = settingsView || defaultBossPointsSettings();
  if (!cfg.enabled) return 0;
  const spend = Number(amount);
  if (!Number.isFinite(spend) || spend <= 0) return 0;
  const minSpend = Number(cfg.minOrderCatFood != null ? cfg.minOrderCatFood : cfg.minOrderAmount || 0);
  if (spend < minSpend) return 0;
  const rate = Number(cfg.pointsPerCatFood != null ? cfg.pointsPerCatFood : cfg.pointsPerRm);
  if (!Number.isFinite(rate) || rate < 0) return 0;
  let points = applyRounding(spend * rate, cfg.roundingMode);
  if (!Number.isFinite(points) || points < 0) points = 0;
  const max = Number(cfg.maxRewardPoints);
  if (Number.isFinite(max) && max > 0) points = Math.min(points, max);
  return Math.trunc(points);
}

export async function getPointsSettingsRow() {
  if (!hasPointsDb()) return null;
  try {
    const rows = await supabaseJson(
      restUrl("points_settings", "?id=eq.1&limit=1"),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) ? rows[0] || null : null;
  } catch (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
}

/**
 * Load Boss points rules. Never throws for award callers — returns defaults on failure.
 */
export async function getBossPointsSettings() {
  try {
    if (!hasPointsDb()) return defaultBossPointsSettings();
    const row = await getPointsSettingsRow();
    return viewPointsSettings(row);
  } catch {
    return defaultBossPointsSettings();
  }
}

/**
 * @deprecated Use getBossPointsSettings + computeOrderRewardPoints.
 * Kept so older call sites still get a numeric fallback.
 */
export async function getOrderCompletionPoints() {
  try {
    const settings = await getBossPointsSettings();
    // Example RM10 preview for legacy consumers
    return computeOrderRewardPoints(10, settings) || DEFAULT_ORDER_COMPLETION_POINTS;
  } catch {
    return DEFAULT_ORDER_COMPLETION_POINTS;
  }
}

export function hasPointsDb() {
  return hasWalletDb();
}

function asInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/**
 * Award points to a user once per idempotency_key.
 *
 * @param {object} params
 * @param {string} params.user_id
 * @param {number} params.points
 * @param {string} [params.reason]
 * @param {string} [params.source]
 * @param {string|null} [params.related_order_id]
 * @param {string} params.idempotency_key
 * @param {string|null} [params.operator_id]
 */
export async function awardPoints(params = {}) {
  const userId = String(params.user_id || params.userId || "").trim();
  const points = asInt(params.points, 0);
  const reason = String(params.reason || "");
  const source = String(params.source || "");
  const relatedOrderId = params.related_order_id || params.relatedOrderId || null;
  const idempotencyKey = String(params.idempotency_key || params.idempotencyKey || "").trim();
  const operatorId = params.operator_id || params.operatorId || null;

  if (!userId) {
    return { ok: false, error: "user_id_required" };
  }
  if (points <= 0) {
    return { ok: false, error: "invalid_points" };
  }
  if (!idempotencyKey) {
    return { ok: false, error: "idempotency_key_required" };
  }
  if (!hasPointsDb()) {
    return { ok: false, skipped: true, error: "points_db_unavailable" };
  }

  // 1) Fast path: idempotency_key already exists → do not credit again.
  try {
    const existing = await supabaseJson(
      restUrl(
        "user_points_ledger",
        `?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`
      ),
      { headers: serviceHeaders() }
    );
    if (Array.isArray(existing) && existing[0]) {
      return {
        ok: true,
        duplicate: true,
        ledger_id: existing[0].id,
        user_id: existing[0].user_id,
        delta: asInt(existing[0].delta),
        balance_after: asInt(existing[0].balance_after),
        idempotency_key: existing[0].idempotency_key,
      };
    }
  } catch (error) {
    if (isMissingRelation(error)) {
      return { ok: false, skipped: true, error: "points_tables_missing" };
    }
    // Continue to RPC / write path for transient read issues.
  }

  // 2) Atomic credit via RPC (account lock + ledger insert).
  try {
    const result = await supabaseJson(rpcUrl("mcj_award_user_points"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        p_user_id: userId,
        p_points: points,
        p_reason: reason,
        p_source: source,
        p_related_order_id: relatedOrderId || null,
        p_idempotency_key: idempotencyKey,
        p_operator_id: operatorId || null,
      }),
    });
    if (result && typeof result === "object") {
      return {
        ok: result.ok !== false,
        duplicate: !!result.duplicate,
        ledger_id: result.ledger_id || null,
        user_id: result.user_id || userId,
        delta: asInt(result.delta, points),
        balance_after: asInt(result.balance_after),
        idempotency_key: result.idempotency_key || idempotencyKey,
        error: result.error || undefined,
      };
    }
    return { ok: false, error: "empty_rpc_result" };
  } catch (error) {
    if (isMissingRelation(error)) {
      return { ok: false, skipped: true, error: "points_rpc_missing" };
    }
    // 3) Fallback REST path when RPC is unavailable but tables exist.
    return awardPointsRestFallback({
      userId,
      points,
      reason,
      source,
      relatedOrderId,
      idempotencyKey,
      operatorId,
      error,
    });
  }
}

async function awardPointsRestFallback({
  userId,
  points,
  reason,
  source,
  relatedOrderId,
  idempotencyKey,
  operatorId,
  error: rpcError,
}) {
  try {
    const again = await supabaseJson(
      restUrl(
        "user_points_ledger",
        `?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`
      ),
      { headers: serviceHeaders() }
    );
    if (Array.isArray(again) && again[0]) {
      return {
        ok: true,
        duplicate: true,
        ledger_id: again[0].id,
        user_id: again[0].user_id,
        delta: asInt(again[0].delta),
        balance_after: asInt(again[0].balance_after),
        idempotency_key: again[0].idempotency_key,
      };
    }

    let account = (
      await supabaseJson(
        restUrl("user_points_accounts", `?user_id=eq.${encodeURIComponent(userId)}&limit=1`),
        { headers: serviceHeaders() }
      )
    )?.[0];

    if (!account) {
      const created = await supabaseJson(restUrl("user_points_accounts"), {
        method: "POST",
        headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
        body: JSON.stringify({
          user_id: userId,
          balance: 0,
          lifetime_earned: 0,
          lifetime_spent: 0,
          outstanding_debt: 0,
          lifetime_debt_opened: 0,
          lifetime_debt_repaid: 0,
        }),
      });
      account = Array.isArray(created) ? created[0] : created;
      if (!account) {
        account = (
          await supabaseJson(
            restUrl("user_points_accounts", `?user_id=eq.${encodeURIComponent(userId)}&limit=1`),
            { headers: serviceHeaders() }
          )
        )?.[0];
      }
    }

    const prevBalance = asInt(account?.balance, 0);
    const prevEarned = asInt(account?.lifetime_earned, 0);
    const prevDebt = asInt(account?.outstanding_debt, 0);
    const repay = Math.min(points, Math.max(0, prevDebt));
    const credit = points - repay;
    const balanceAfter = prevBalance + credit;
    const debtAfter = Math.max(0, prevDebt - repay);
    const reasonFinal =
      repay > 0
        ? `${reason || "积分入账"}（毛奖励 ${points}，抵扣欠款 ${repay}，入账 ${credit}）`
        : reason;

    await supabaseJson(
      restUrl("user_points_accounts", `?user_id=eq.${encodeURIComponent(userId)}`),
      {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({
          balance: balanceAfter,
          lifetime_earned: prevEarned + points,
          outstanding_debt: debtAfter,
          lifetime_debt_repaid: asInt(account?.lifetime_debt_repaid, 0) + repay,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    try {
      const ledgerRows = await supabaseJson(restUrl("user_points_ledger"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          user_id: userId,
          delta: credit,
          balance_after: balanceAfter,
          debt_delta: -repay,
          debt_after: debtAfter,
          clawback_target: 0,
          gross_points: points,
          reason: reasonFinal,
          source,
          related_order_id: relatedOrderId || null,
          idempotency_key: idempotencyKey,
          operator_id: operatorId || null,
        }),
      });
      const row = Array.isArray(ledgerRows) ? ledgerRows[0] : ledgerRows;
      return {
        ok: true,
        duplicate: false,
        ledger_id: row?.id || null,
        user_id: userId,
        delta: credit,
        gross_points: points,
        debt_repaid: repay,
        balance_after: balanceAfter,
        debt_after: debtAfter,
        idempotency_key: idempotencyKey,
      };
    } catch (insertErr) {
      // Unique violation → concurrent award already committed; do not double-count further.
      const dup = await supabaseJson(
        restUrl(
          "user_points_ledger",
          `?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`
        ),
        { headers: serviceHeaders() }
      ).catch(() => []);
      if (Array.isArray(dup) && dup[0]) {
        return {
          ok: true,
          duplicate: true,
          ledger_id: dup[0].id,
          user_id: dup[0].user_id,
          delta: asInt(dup[0].delta),
          balance_after: asInt(dup[0].balance_after),
          idempotency_key: dup[0].idempotency_key,
        };
      }
      throw insertErr;
    }
  } catch (fallbackErr) {
    if (isMissingRelation(fallbackErr)) {
      return { ok: false, skipped: true, error: "points_tables_missing" };
    }
    return {
      ok: false,
      error: fallbackErr?.message || rpcError?.message || "award_points_failed",
    };
  }
}

async function reserveOrderPointsIdempotency({
  orderId,
  bossId,
  source,
  operatorId = null,
  reason = "订单完成奖励（0 分）",
}) {
  const key = orderPointsIdempotencyKey(orderId);
  const existing = await supabaseJson(
    restUrl("user_points_ledger", `?idempotency_key=eq.${encodeURIComponent(key)}&limit=1`),
    { headers: serviceHeaders() }
  );
  if (Array.isArray(existing) && existing[0]) {
    return {
      ok: true,
      duplicate: true,
      skipped: true,
      points: 0,
      ledger_id: existing[0].id,
      idempotency_key: key,
    };
  }
  await ensureUserPointsAccount(bossId);
  const account = await getUserPointsAccount(bossId);
  const balanceAfter = asInt(account?.balance, 0);
  const inserted = await supabaseJson(restUrl("user_points_ledger"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      user_id: bossId,
      delta: 0,
      balance_after: balanceAfter,
      reason,
      source,
      related_order_id: orderId,
      idempotency_key: key,
      operator_id: operatorId || null,
    }),
  });
  const row = Array.isArray(inserted) ? inserted[0] : inserted;
  return {
    ok: true,
    duplicate: false,
    skipped: true,
    points: 0,
    ledger_id: row?.id || null,
    balance_after: balanceAfter,
    idempotency_key: key,
  };
}

/**
 * Award Boss loyalty points when an order reaches completed.
 * Formula: rounding(effectiveCatFoodSpend × points_per_cat_food) with min/max from points_settings.
 * Amount field: paid_cat_food > 0 ? paid_cat_food : total_amount (猫粮; refund「实付」同源).
 * Idempotency key: order_points:{order_id}
 */
export async function awardBossPointsForCompletedOrder(order, { method = "boss_manual", operatorId = null } = {}) {
  const orderId = order?.id;
  const bossId = order?.boss_id;
  if (!orderId || !bossId) {
    return { ok: false, skipped: true, error: "missing_order_or_boss" };
  }

  // G8: Production points writes stay off until flag explicitly enabled.
  if (!isPointsAwardEnabled()) {
    return {
      ok: true,
      skipped: true,
      points: 0,
      error: pointsAwardDisabledReason() || "points_award_flag_disabled",
    };
  }

  // G6: fail-closed — test / smoke bosses must not receive ledger awards.
  const testGuard = await skipIfTestBossForPoints(order);
  if (!testGuard.ok) {
    return {
      ok: true,
      skipped: true,
      points: 0,
      error: testGuard.reason || "test_account",
    };
  }

  const source =
    method === "system_auto_24h"
      ? "order_complete_auto"
      : method === "admin_force"
        ? "order_complete_admin"
        : "order_complete_boss";

  let settings;
  try {
    settings = await getBossPointsSettings();
  } catch {
    settings = defaultBossPointsSettings();
  }

  const spend = orderEffectiveCatFoodSpend(order);
  let points = 0;
  try {
    points = computeOrderRewardPoints(spend, settings);
  } catch {
    points = 0;
  }
  if (!Number.isFinite(points) || points < 0) points = 0;

  const rate = Number(settings.pointsPerCatFood != null ? settings.pointsPerCatFood : settings.pointsPerRm);
  const minSpend = Number(settings.minOrderCatFood != null ? settings.minOrderCatFood : settings.minOrderAmount || 0);

  if (!settings.enabled) {
    try {
      return await reserveOrderPointsIdempotency({
        orderId,
        bossId,
        source,
        operatorId,
        reason: "订单完成奖励（积分已关闭）",
      });
    } catch (error) {
      if (isMissingRelation(error)) {
        return { ok: true, skipped: true, points: 0, error: "points_table_missing" };
      }
      if (/duplicate|unique|23505/i.test(String(error?.message || ""))) {
        return {
          ok: true,
          duplicate: true,
          skipped: true,
          points: 0,
          idempotency_key: orderPointsIdempotencyKey(orderId),
        };
      }
      return { ok: false, skipped: true, points: 0, error: error?.message || "disabled_mark_failed" };
    }
  }

  if (points === 0) {
    try {
      return await reserveOrderPointsIdempotency({
        orderId,
        bossId,
        source,
        operatorId,
        reason:
          spend < minSpend
            ? "订单完成奖励（未达最低消费猫粮）"
            : "订单完成奖励（计算结果为 0）",
      });
    } catch (error) {
      if (isMissingRelation(error)) {
        return { ok: true, skipped: true, points: 0, error: "points_table_missing" };
      }
      if (/duplicate|unique|23505/i.test(String(error?.message || ""))) {
        return {
          ok: true,
          duplicate: true,
          skipped: true,
          points: 0,
          idempotency_key: orderPointsIdempotencyKey(orderId),
        };
      }
      return { ok: false, skipped: true, points: 0, error: error?.message || "zero_mark_failed" };
    }
  }

  return awardPoints({
    user_id: bossId,
    points,
    reason: `订单完成奖励（消费 ${spend} 猫粮 × ${rate}）`,
    source,
    related_order_id: orderId,
    idempotency_key: orderPointsIdempotencyKey(orderId),
    operator_id: operatorId || null,
  });
}

/**
 * Clawback Boss points after a completed order is refunded (cat-food refund confirmed).
 * Full original award obligation (gross_points || delta) is always recovered:
 *   applied = min(balance, target) → balance
 *   remainder → outstanding_debt (points debt)
 * Idempotent: order_points_clawback:{order_id}. Never throws to refund callers.
 */
export async function clawbackBossPointsForRefundedOrder(
  order,
  { operatorId = null, reason = "订单退款回退积分" } = {}
) {
  const orderId = order?.id || order;
  const bossId = typeof order === "object" ? order?.boss_id : null;
  if (!orderId) return { ok: false, skipped: true, error: "missing_order" };

  // G8 / G6: when points award is disabled, do not open clawback ledgers either.
  if (!isPointsAwardEnabled()) {
    return {
      ok: true,
      skipped: true,
      error: pointsAwardDisabledReason() || "points_award_flag_disabled",
    };
  }

  if (typeof order === "object") {
    const testGuard = await skipIfTestBossForPoints(order);
    if (!testGuard.ok) {
      return { ok: true, skipped: true, error: testGuard.reason || "test_account" };
    }
  } else if (bossId) {
    const testGuard = await skipIfTestBossForPoints({ boss_id: bossId, id: orderId });
    if (!testGuard.ok) {
      return { ok: true, skipped: true, error: testGuard.reason || "test_account" };
    }
  }

  try {
    if (!hasPointsDb()) return { ok: true, skipped: true, error: "points_db_unavailable" };

    const awardKey = orderPointsIdempotencyKey(orderId);
    const clawKey = orderPointsClawbackIdempotencyKey(orderId);

    const existingClaw = await supabaseJson(
      restUrl("user_points_ledger", `?idempotency_key=eq.${encodeURIComponent(clawKey)}&limit=1`),
      { headers: serviceHeaders() }
    );
    if (Array.isArray(existingClaw) && existingClaw[0]) {
      return {
        ok: true,
        duplicate: true,
        skipped: true,
        ledger_id: existingClaw[0].id,
        delta: asInt(existingClaw[0].delta),
        debt_delta: asInt(existingClaw[0].debt_delta),
        clawback_target: asInt(existingClaw[0].clawback_target),
        balance_after: asInt(existingClaw[0].balance_after),
        debt_after: asInt(existingClaw[0].debt_after),
        idempotency_key: clawKey,
      };
    }

    const awardRows = await supabaseJson(
      restUrl("user_points_ledger", `?idempotency_key=eq.${encodeURIComponent(awardKey)}&limit=1`),
      { headers: serviceHeaders() }
    );
    const award = Array.isArray(awardRows) ? awardRows[0] : null;
    if (!award) {
      return { ok: true, skipped: true, error: "no_award_ledger" };
    }
    // Prefer gross_points (pre-debt award). Fallback to positive delta for older rows.
    const awarded = asInt(award.gross_points, 0) || Math.max(0, asInt(award.delta, 0));
    if (awarded <= 0) {
      return { ok: true, skipped: true, error: "award_was_zero", idempotency_key: awardKey };
    }

    const userId = bossId || award.user_id;
    if (!userId) return { ok: false, skipped: true, error: "missing_boss" };

    // Prefer atomic RPC (balance debit + debt open under one lock).
    try {
      const result = await supabaseJson(rpcUrl("mcj_clawback_user_points"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          p_user_id: userId,
          p_points_target: awarded,
          p_reason: reason,
          p_source: "order_refund_clawback",
          p_related_order_id: orderId,
          p_idempotency_key: clawKey,
          p_operator_id: operatorId || null,
        }),
      });
      if (result && typeof result === "object") {
        return {
          ok: result.ok !== false,
          duplicate: !!result.duplicate,
          skipped: !!result.duplicate,
          ledger_id: result.ledger_id || null,
          points: asInt(result.delta),
          applied: asInt(result.applied),
          debt_opened: asInt(result.debt_opened),
          clawback_target: asInt(result.clawback_target, awarded),
          balance_after: asInt(result.balance_after),
          debt_after: asInt(result.debt_after),
          idempotency_key: result.idempotency_key || clawKey,
          error: result.error || undefined,
        };
      }
    } catch (rpcErr) {
      if (isMissingRelation(rpcErr)) {
        /* fall through to REST */
      } else if (/Could not find the function|PGRST202|schema cache/i.test(String(rpcErr?.message || ""))) {
        /* fall through */
      } else if (/duplicate|unique|23505/i.test(String(rpcErr?.message || ""))) {
        return {
          ok: true,
          duplicate: true,
          skipped: true,
          idempotency_key: clawKey,
        };
      } else {
        // Continue REST fallback for transient RPC issues.
      }
    }

    await ensureUserPointsAccount(userId);
    const account = await getUserPointsAccount(userId);
    const balance = asInt(account?.balance, 0);
    const applied = Math.min(awarded, Math.max(0, balance));
    const debtAdd = awarded - applied;
    const balanceAfter = balance - applied;
    const debtAfter = asInt(account?.outstanding_debt, 0) + debtAdd;
    const reasonFinal = `${reason}（应回收 ${awarded}，已扣余额 ${applied}，记入欠款 ${debtAdd}）`;

    await supabaseJson(restUrl("user_points_accounts", `?user_id=eq.${encodeURIComponent(userId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({
        balance: balanceAfter,
        lifetime_spent: asInt(account?.lifetime_spent, 0) + applied,
        outstanding_debt: debtAfter,
        lifetime_debt_opened: asInt(account?.lifetime_debt_opened, 0) + debtAdd,
        updated_at: new Date().toISOString(),
      }),
    });

    const inserted = await supabaseJson(restUrl("user_points_ledger"), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        user_id: userId,
        delta: -applied,
        balance_after: balanceAfter,
        debt_delta: debtAdd,
        debt_after: debtAfter,
        clawback_target: awarded,
        gross_points: 0,
        reason: reasonFinal,
        source: "order_refund_clawback",
        related_order_id: orderId,
        idempotency_key: clawKey,
        operator_id: operatorId || null,
      }),
    });
    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return {
      ok: true,
      duplicate: false,
      points: -applied,
      applied,
      debt_opened: debtAdd,
      clawback_target: awarded,
      ledger_id: row?.id || null,
      balance_after: balanceAfter,
      debt_after: debtAfter,
      idempotency_key: clawKey,
    };
  } catch (error) {
    if (isMissingRelation(error)) {
      return { ok: true, skipped: true, error: "points_table_missing" };
    }
    if (/duplicate|unique|23505/i.test(String(error?.message || ""))) {
      return {
        ok: true,
        duplicate: true,
        skipped: true,
        idempotency_key: orderPointsClawbackIdempotencyKey(orderId),
      };
    }
    return { ok: false, skipped: true, error: error?.message || "clawback_failed" };
  }
}

/** Read helpers for Boss portal / tests. Always scope by authenticated user_id server-side. */
export async function getUserPointsAccount(userId) {
  if (!userId || !hasPointsDb()) return null;
  try {
    const rows = await supabaseJson(
      restUrl("user_points_accounts", `?user_id=eq.${encodeURIComponent(userId)}&limit=1`),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) ? rows[0] || null : null;
  } catch (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
}

/**
 * Ensure a points account row exists for any Boss (existing or newly registered).
 * Safe no-op if already present. Never awards points — only creates balance=0.
 */
export async function ensureUserPointsAccount(userId) {
  if (!userId || !hasPointsDb()) return null;
  try {
    const existing = await getUserPointsAccount(userId);
    if (existing) return existing;
    const created = await supabaseJson(restUrl("user_points_accounts"), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify({
        user_id: userId,
        balance: 0,
        lifetime_earned: 0,
        lifetime_spent: 0,
      }),
    });
    const row = Array.isArray(created) ? created[0] : created;
    if (row?.user_id) return row;
    return getUserPointsAccount(userId);
  } catch (error) {
    if (isMissingRelation(error)) return null;
    // Concurrent first-visit create: re-read.
    try {
      return await getUserPointsAccount(userId);
    } catch {
      throw error;
    }
  }
}

/** Empty account shape when Boss has never earned points (tables may be empty). */
export function emptyPointsAccountView(userId = "") {
  return {
    userId: userId || "",
    balance: 0,
    outstandingDebt: 0,
    lifetimeEarned: 0,
    lifetimeSpent: 0,
    lifetimeDebtOpened: 0,
    lifetimeDebtRepaid: 0,
    updatedAt: "",
  };
}

export function viewPointsAccount(row, userId = "") {
  if (!row) return emptyPointsAccountView(userId);
  return {
    userId: row.user_id || userId || "",
    balance: asInt(row.balance, 0),
    outstandingDebt: asInt(row.outstanding_debt, 0),
    lifetimeEarned: asInt(row.lifetime_earned, 0),
    lifetimeSpent: asInt(row.lifetime_spent, 0),
    lifetimeDebtOpened: asInt(row.lifetime_debt_opened, 0),
    lifetimeDebtRepaid: asInt(row.lifetime_debt_repaid, 0),
    updatedAt: row.updated_at || "",
  };
}

export async function listUserPointsLedger(userId, { limit = 50 } = {}) {
  if (!userId || !hasPointsDb()) return [];
  const lim = Math.min(200, Math.max(1, asInt(limit, 50)));
  try {
    const rows = await supabaseJson(
      restUrl(
        "user_points_ledger",
        `?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${lim}`
      ),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
}

function sourceLabel(source) {
  const s = String(source || "");
  if (s === "order_complete_boss") return "订单完成（老板确认）";
  if (s === "order_complete_auto") return "订单完成（系统自动）";
  if (s === "order_complete_admin") return "订单完成（后台）";
  if (s === "order_refund_clawback") return "订单退款回退积分";
  if (/order_complete/i.test(s)) return "订单完成奖励";
  return s || "积分变动";
}

export function viewPointsLedgerRow(row) {
  const delta = asInt(row?.delta, 0);
  const debtDelta = asInt(row?.debt_delta, 0);
  return {
    id: row?.id || "",
    createdAt: row?.created_at || "",
    delta,
    deltaText: delta > 0 ? `+${delta}` : String(delta),
    balanceAfter: asInt(row?.balance_after, 0),
    debtDelta,
    debtAfter: asInt(row?.debt_after, 0),
    clawbackTarget: asInt(row?.clawback_target, 0),
    grossPoints: asInt(row?.gross_points, 0),
    reason: row?.reason || sourceLabel(row?.source),
    source: row?.source || "",
    sourceLabel: sourceLabel(row?.source),
    relatedOrderId: row?.related_order_id || "",
    idempotencyKey: row?.idempotency_key || "",
    status: "posted",
    statusText: "已入账",
  };
}

export async function getPointsLedgerByIdempotencyKey(key) {
  if (!key || !hasPointsDb()) return null;
  try {
    const rows = await supabaseJson(
      restUrl("user_points_ledger", `?idempotency_key=eq.${encodeURIComponent(key)}&limit=1`),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) ? rows[0] || null : null;
  } catch (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
}
