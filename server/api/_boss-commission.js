/**
 * Boss direct-commission from platform fee.
 *
 * Business rule (locked):
 *   order_amount = customer payment (gross)
 *   platform_fee = order_amount * platform_rate / 100
 *   boss_commission = platform_fee * boss_commission_rate / 100
 *   companion income is UNCHANGED (boss paid from platform revenue)
 *
 * Rate resolution:
 *   1) active relation.commission_rate (admin override)
 *   2) boss current level.commission_rate
 *   3) platform_settings.defaultBossCommissionRate
 *   4) missing → skip (fail closed)
 *
 * SAFEGUARD: boss_commission ALWAYS = platform_fee * rate / 100 (never companion income).
 * Snapshots frozen after settle; level changes do not rewrite historical earnings.
 */
import { money, roundMoney } from "./_commission-rates.js";
import {
  getActiveRelationForCompanion,
  isRelationsMissing,
} from "./_boss-companion-relations.js";
import { getEffectiveBossLevelForSettle } from "./_boss-levels.js";
import { isMissingRelation, restUrl, serviceHeaders, supabaseJson } from "./_wallet.js";

const EARNINGS_TABLE = "boss_commission_earnings";
const SETTINGS_ID = "global";

export function calcBossCommissionFromPlatformFee({
  orderAmount,
  platformFeeRate,
  bossCommissionRate,
  companionIncomeAmount = null, // accepted only for transparency; NEVER used in boss calc
} = {}) {
  const gross = roundMoney(orderAmount);
  const platformRate = Math.min(100, Math.max(0, money(platformFeeRate)));
  const bossRate = Math.min(100, Math.max(0, money(bossCommissionRate)));
  // SAFETY: platform fee from order gross only
  const platformFeeAmount = roundMoney((gross * platformRate) / 100);
  // SAFETY: boss commission from platform_fee only — never from companion income
  const bossCommissionAmount = roundMoney((platformFeeAmount * bossRate) / 100);
  void companionIncomeAmount;
  return {
    orderAmount: gross,
    platformFeeRate: platformRate,
    platformFeeAmount,
    bossCommissionRate: bossRate,
    bossCommissionAmount,
    companionIncomeUnchanged: true,
    calculatedFrom: "platform_fee_only",
  };
}

export async function readDefaultBossCommissionRate() {
  try {
    const rows = await supabaseJson(
      restUrl("platform_settings", `?id=eq.${encodeURIComponent(SETTINGS_ID)}&select=id,data&limit=1`),
      { headers: serviceHeaders() }
    );
    const data = rows?.[0]?.data || {};
    if (data.defaultBossCommissionRate == null || data.defaultBossCommissionRate === "") {
      return null;
    }
    const n = money(data.defaultBossCommissionRate);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.min(100, Math.max(0, n));
  } catch (error) {
    if (isMissingRelation(error)) return null;
    return null;
  }
}

/**
 * @returns {{ rate: number|null, source: 'relation'|'platform_default'|'none', relation: object|null }}
 */
export async function resolveBossCommissionRateForCompanion(companionId) {
  if (!companionId) return { rate: null, source: "none", relation: null };
  let relation = null;
  try {
    relation = await getActiveRelationForCompanion(companionId);
  } catch (error) {
    if (isRelationsMissing(error) || isMissingRelation(error)) {
      return { rate: null, source: "none", relation: null };
    }
    throw error;
  }
  if (!relation) return { rate: null, source: "none", relation: null };

  if (relation.commission_rate != null && relation.commission_rate !== "") {
    const n = money(relation.commission_rate);
    if (Number.isFinite(n) && n >= 0) {
      return {
        rate: Math.min(100, Math.max(0, n)),
        source: "relation",
        relation,
        bossLevel: null,
      };
    }
  }

  let bossLevel = null;
  try {
    const effective = await getEffectiveBossLevelForSettle(relation.boss_id);
    bossLevel = effective?.level || null;
    const levelRate = money(bossLevel?.commission_rate ?? bossLevel?.commissionRate);
    if (bossLevel && Number.isFinite(levelRate) && levelRate >= 0) {
      return {
        rate: Math.min(100, Math.max(0, levelRate)),
        source: "boss_level",
        relation,
        bossLevel,
      };
    }
  } catch (_) {
    /* level table may be missing mid-rollout */
  }

  const platformDefault = await readDefaultBossCommissionRate();
  if (platformDefault == null) {
    return { rate: null, source: "none", relation, bossLevel };
  }
  return { rate: platformDefault, source: "platform_default", relation, bossLevel };
}

export function viewBossCommissionEarning(row = {}) {
  return {
    id: row.id || "",
    bossId: row.boss_id || "",
    companionId: row.companion_id || "",
    relationId: row.relation_id || null,
    orderId: row.order_id || "",
    orderAmount: money(row.order_amount),
    platformFeeRate: money(row.platform_fee_rate),
    platformFeeAmount: money(row.platform_fee_amount),
    bossCommissionRate: money(row.boss_commission_rate),
    bossCommissionAmount: money(row.boss_commission_amount),
    companionIncomeAmount: money(row.companion_income_amount),
    rateSource: row.rate_source || "",
    bossLevelId: row.boss_level_id || null,
    bossLevelCode: row.boss_level_code || null,
    status: row.status || "",
    note: row.note || "",
    meta: row.meta || {},
    settledAt: row.settled_at || "",
    createdAt: row.created_at || "",
  };
}

/**
 * Idempotent settle: insert earnings + boss transaction + order snapshot.
 * Does not modify companion_income amount.
 */
export async function settleBossCommissionFromPlatformFee(
  order,
  {
    platformFeeRate,
    platformFeeAmount,
    companionIncomeAmount,
    completedAt,
    method = "",
  } = {}
) {
  if (!order?.id || !order?.companion_id) {
    return { skipped: true, reason: "no_order_or_companion" };
  }

  try {
    const existing = await supabaseJson(
      restUrl(
        EARNINGS_TABLE,
        `?order_id=eq.${encodeURIComponent(order.id)}&status=in.(pending,settled)&limit=1`
      ),
      { headers: serviceHeaders() }
    );
    if (existing?.[0]) {
      return { duplicate: true, earning: viewBossCommissionEarning(existing[0]) };
    }
  } catch (error) {
    if (isMissingRelation(error)) {
      return { skipped: true, reason: "earnings_table_missing" };
    }
    throw error;
  }

  try {
    const existingTx = await supabaseJson(
      restUrl(
        "transactions",
        `?order_id=eq.${encodeURIComponent(order.id)}&transaction_type=eq.boss_commission&limit=1`
      ),
      { headers: serviceHeaders() }
    );
    if (existingTx?.[0]) {
      return { duplicate: true, transaction: existingTx[0] };
    }
  } catch (_) {
    /* optional */
  }

  const resolved = await resolveBossCommissionRateForCompanion(order.companion_id);
  if (!resolved.relation || resolved.rate == null) {
    return {
      skipped: true,
      reason: !resolved.relation ? "no_active_relation" : "no_commission_rate",
      relation: resolved.relation || null,
    };
  }

  const orderAmount = roundMoney(order.total_amount);
  const platformRate = money(
    platformFeeRate != null && platformFeeRate !== ""
      ? platformFeeRate
      : order.platform_fee_rate != null
        ? order.platform_fee_rate
        : order.platform_commission_rate
  );
  const platformFee =
    platformFeeAmount != null && platformFeeAmount !== ""
      ? roundMoney(platformFeeAmount)
      : order.platform_fee != null && order.platform_fee !== ""
        ? roundMoney(order.platform_fee)
        : roundMoney((orderAmount * platformRate) / 100);

  const calc = calcBossCommissionFromPlatformFee({
    orderAmount,
    platformFeeRate: platformRate,
    bossCommissionRate: resolved.rate,
  });
  // Keep platform fee amount aligned with companion settlement when provided
  calc.platformFeeAmount = platformFee;
  calc.bossCommissionAmount = roundMoney((platformFee * calc.bossCommissionRate) / 100);

  if (!(calc.bossCommissionAmount > 0)) {
    return {
      skipped: true,
      reason: "zero_amount",
      calc,
      relation: resolved.relation,
      rateSource: resolved.source,
    };
  }

  const settledAt = completedAt || new Date().toISOString();
  const level = resolved.bossLevel || null;
  const meta = {
    formula: "boss_commission = platform_fee * boss_commission_rate / 100",
    calculatedFrom: "platform_fee_only",
    rateSource: resolved.source,
    completionMethod: method || "",
    companionIncomeUnchanged: true,
    companionIncomeAmount: money(companionIncomeAmount),
    bossLevelId: level?.id || null,
    bossLevelCode: level?.code || null,
  };

  const earningPayload = {
    boss_id: resolved.relation.boss_id,
    companion_id: order.companion_id,
    relation_id: resolved.relation.id,
    order_id: String(order.id),
    order_amount: calc.orderAmount,
    platform_fee_rate: calc.platformFeeRate,
    platform_fee_amount: calc.platformFeeAmount,
    boss_commission_rate: calc.bossCommissionRate,
    boss_commission_amount: calc.bossCommissionAmount,
    companion_income_amount: money(companionIncomeAmount),
    rate_source: resolved.source,
    boss_level_id: level?.id || null,
    boss_level_code: level?.code || null,
    status: "settled",
    note: `MCJ_BOSS_COMMISSION:${JSON.stringify(meta)}`,
    meta,
    settled_at: settledAt,
    created_at: settledAt,
    updated_at: settledAt,
  };

  let earningRow;
  try {
    const rows = await supabaseJson(restUrl(EARNINGS_TABLE), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(earningPayload),
    });
    earningRow = Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    if (/uq_boss_commission_earnings_order|duplicate|23505/i.test(String(error?.message || ""))) {
      const again = await supabaseJson(
        restUrl(EARNINGS_TABLE, `?order_id=eq.${encodeURIComponent(order.id)}&limit=1`),
        { headers: serviceHeaders() }
      ).catch(() => []);
      return { duplicate: true, earning: viewBossCommissionEarning(again?.[0] || {}) };
    }
    throw error;
  }

  try {
    await supabaseJson(restUrl("transactions"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        user_id: resolved.relation.boss_id,
        order_id: order.id,
        transaction_type: "boss_commission",
        amount: calc.bossCommissionAmount,
        status: "completed",
        note: `MCJ_BOSS_COMMISSION:${JSON.stringify({
          ...meta,
          ...calc,
          earningId: earningRow?.id || "",
        })}`,
        created_at: settledAt,
      }),
    });
  } catch (_) {
    /* earnings row remains SoT */
  }

  try {
    await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(order.id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({
        platform_fee_rate: calc.platformFeeRate,
        platform_fee: calc.platformFeeAmount,
        boss_commission_rate: calc.bossCommissionRate,
        boss_commission_amount: calc.bossCommissionAmount,
        boss_commission_rate_source: resolved.source,
        boss_level_id: level?.id || null,
        boss_level_code: level?.code || null,
        direct_boss_id: resolved.relation.boss_id,
        boss_commission_relation_id: resolved.relation.id,
      }),
    });
  } catch (_) {
    /* columns may be missing until migration applied */
  }

  return {
    skipped: false,
    duplicate: false,
    rateSource: resolved.source,
    calc,
    earning: viewBossCommissionEarning(earningRow || earningPayload),
  };
}

export async function listBossCommissionEarnings({
  bossId = "",
  companionId = "",
  limit = 50,
} = {}) {
  const parts = [
    "select=*",
    "order=settled_at.desc",
    `limit=${Math.min(200, Math.max(1, Number(limit) || 50))}`,
  ];
  if (bossId) parts.push(`boss_id=eq.${encodeURIComponent(bossId)}`);
  if (companionId) parts.push(`companion_id=eq.${encodeURIComponent(companionId)}`);
  const rows = await supabaseJson(restUrl(EARNINGS_TABLE, `?${parts.join("&")}`), {
    headers: serviceHeaders(),
  });
  return (Array.isArray(rows) ? rows : []).map(viewBossCommissionEarning);
}

export { EARNINGS_TABLE };
