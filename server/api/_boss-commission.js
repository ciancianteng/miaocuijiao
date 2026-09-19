/**
 * Boss / channel direct-commission from platform fee (role-agnostic beneficiary).
 *
 * Business rule (locked):
 *   order_amount = customer payment (gross)
 *   platform_fee = order_amount * platform_rate / 100
 *   boss_commission = platform_fee * boss_commission_rate / 100
 *   companion income is UNCHANGED (paid from platform revenue)
 *
 * Beneficiaries (DIRECT ONLY — no upline walk):
 *   - active relation of order.companion_id (target)
 *   - active relation of order.boss_id / user_id (target)
 *   dedupe by beneficiary_user_id → at most one earning per beneficiary per order
 *
 * Rate resolution per candidate:
 *   1) active relation.commission_rate (admin override)
 *   2) beneficiary boss level.commission_rate (if any)
 *   3) platform_settings.defaultBossCommissionRate
 *   4) missing → skip that candidate
 *
 * SAFEGUARD: commission ALWAYS = platform_fee * rate / 100 (never companion income).
 * Snapshots frozen after settle; level changes do not rewrite historical earnings.
 */
import { money, roundMoney } from "./_commission-rates.js";
import {
  getActiveRelationForCompanion,
  isRelationsMissing,
} from "./_boss-companion-relations.js";
import { getEffectiveBossLevelForSettle } from "./_boss-levels.js";
import { isSettlementEnabled, settlementDisabledReason } from "./_feature-flags.js";
import {
  assertNotTestPartiesForSettlement,
  isProductionRuntime,
  isTestAccountRecord,
} from "./_test-accounts.js";
import { isMissingRelation, restUrl, serviceHeaders, supabaseJson } from "./_wallet.js";

async function loadProfileForSettlementGuard(userId) {
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

const EARNINGS_TABLE = "boss_commission_earnings";
const SETTINGS_ID = "global";
const SOURCE_RANK = { relation: 3, boss_level: 2, platform_default: 1, none: 0 };

export function calcBossCommissionFromPlatformFee({
  orderAmount,
  platformFeeRate,
  bossCommissionRate,
  companionIncomeAmount = null, // accepted only for transparency; NEVER used in boss calc
} = {}) {
  const gross = roundMoney(orderAmount);
  const platformRate = Math.min(100, Math.max(0, money(platformFeeRate)));
  const bossRate = Math.min(100, Math.max(0, money(bossCommissionRate)));
  const platformFeeAmount = roundMoney((gross * platformRate) / 100);
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

/** Partial / full clawback math (unit-testable). */
export function calcBossCommissionClawback({
  settledAmount,
  alreadyClawed = 0,
  orderAmount,
  refundAmount = null,
  mode = "refund",
} = {}) {
  const settled = roundMoney(settledAmount);
  const clawed = Math.max(0, roundMoney(alreadyClawed));
  const gross = roundMoney(orderAmount);
  if (!(settled > 0)) {
    return { targetClawback: clawed, delta: 0, fullyClawed: true, remaining: 0 };
  }
  let ratio = 1;
  if (mode === "partial_refund" || (refundAmount != null && refundAmount !== "" && gross > 0)) {
    const refund = Math.max(0, roundMoney(refundAmount));
    ratio = Math.min(1, Math.max(0, refund / gross));
  }
  if (mode === "cancel" || mode === "refund") {
    ratio = 1;
  }
  const targetClawback = roundMoney(settled * ratio);
  const nextClawed = Math.max(clawed, targetClawback);
  const delta = roundMoney(nextClawed - clawed);
  const remaining = roundMoney(Math.max(0, settled - nextClawed));
  return {
    targetClawback: nextClawed,
    delta,
    fullyClawed: remaining <= 0,
    remaining,
    ratio,
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
 * Resolve rate for a target user's active direct relation (depth-1 only).
 */
export async function resolveBossCommissionRateForCompanion(companionId) {
  if (!companionId) return { rate: null, source: "none", relation: null, bossLevel: null };
  let relation = null;
  try {
    relation = await getActiveRelationForCompanion(companionId);
  } catch (error) {
    if (isRelationsMissing(error) || isMissingRelation(error)) {
      return { rate: null, source: "none", relation: null, bossLevel: null };
    }
    throw error;
  }
  if (!relation) return { rate: null, source: "none", relation: null, bossLevel: null };

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

/**
 * Collect DIRECT beneficiaries for an order (companion side + boss side), dedupe by beneficiary id.
 * Never walks beneficiary → beneficiary.
 */
export async function collectOrderCommissionCandidates(order = {}) {
  const companionId = String(order.companion_id || "").trim();
  const bossId = String(order.boss_id || order.user_id || order.customer_id || "").trim();
  const sides = [];
  if (companionId) sides.push({ side: "companion", targetId: companionId });
  if (bossId && bossId !== companionId) sides.push({ side: "boss", targetId: bossId });

  const byBeneficiary = new Map();
  for (const { side, targetId } of sides) {
    const resolved = await resolveBossCommissionRateForCompanion(targetId);
    if (!resolved.relation || resolved.rate == null) continue;
    const beneficiaryId = String(resolved.relation.boss_id || "").trim();
    if (!beneficiaryId) continue;
    if (companionId && beneficiaryId === companionId) continue;
    const prev = byBeneficiary.get(beneficiaryId);
    const rank = SOURCE_RANK[resolved.source] || 0;
    const prevRank = prev ? SOURCE_RANK[prev.source] || 0 : -1;
    if (!prev || rank > prevRank) {
      byBeneficiary.set(beneficiaryId, {
        beneficiaryId,
        side,
        sides: prev ? [...new Set([...(prev.sides || [prev.side]), side])] : [side],
        rate: resolved.rate,
        source: resolved.source,
        relation: resolved.relation,
        bossLevel: resolved.bossLevel || null,
        targetId,
      });
    } else if (prev) {
      prev.sides = [...new Set([...(prev.sides || [prev.side]), side])];
    }
  }
  return [...byBeneficiary.values()];
}

export function viewBossCommissionEarning(row = {}) {
  return {
    id: row.id || "",
    bossId: row.boss_id || "",
    beneficiaryUserId: row.beneficiary_user_id || row.boss_id || "",
    companionId: row.companion_id || "",
    relationId: row.relation_id || null,
    orderId: row.order_id || "",
    orderAmount: money(row.order_amount),
    platformFeeRate: money(row.platform_fee_rate),
    platformFeeAmount: money(row.platform_fee_amount),
    bossCommissionRate: money(row.boss_commission_rate),
    bossCommissionAmount: money(row.boss_commission_amount),
    clawbackAmount: money(row.clawback_amount),
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

async function settleOneBeneficiary(
  order,
  candidate,
  { platformFee, platformRate, companionIncomeAmount, settledAt, method }
) {
  const beneficiaryId = candidate.beneficiaryId;
  try {
    const existing = await supabaseJson(
      restUrl(
        EARNINGS_TABLE,
        `?order_id=eq.${encodeURIComponent(order.id)}&or=(beneficiary_user_id.eq.${encodeURIComponent(beneficiaryId)},boss_id.eq.${encodeURIComponent(beneficiaryId)})&status=in.(pending,settled)&limit=1`
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
        `?order_id=eq.${encodeURIComponent(order.id)}&transaction_type=eq.boss_commission&user_id=eq.${encodeURIComponent(beneficiaryId)}&limit=1`
      ),
      { headers: serviceHeaders() }
    );
    if (existingTx?.[0]) {
      return { duplicate: true, transaction: existingTx[0] };
    }
  } catch (_) {
    /* optional */
  }

  try {
    const earningBoss = await loadProfileForSettlementGuard(beneficiaryId);
    if (earningBoss && isTestAccountRecord(earningBoss)) {
      return { skipped: true, reason: "test_beneficiary", relation: candidate.relation };
    }
  } catch (_) {
    if (isProductionRuntime()) {
      return { skipped: true, reason: "test_guard_error" };
    }
  }

  const orderAmount = roundMoney(order.total_amount);
  const calc = calcBossCommissionFromPlatformFee({
    orderAmount,
    platformFeeRate: platformRate,
    bossCommissionRate: candidate.rate,
  });
  calc.platformFeeAmount = platformFee;
  calc.bossCommissionAmount = roundMoney((platformFee * calc.bossCommissionRate) / 100);

  if (!(calc.bossCommissionAmount > 0)) {
    return {
      skipped: true,
      reason: "zero_amount",
      calc,
      relation: candidate.relation,
      rateSource: candidate.source,
    };
  }

  const level = candidate.bossLevel || null;
  const meta = {
    formula: "boss_commission = platform_fee * boss_commission_rate / 100",
    calculatedFrom: "platform_fee_only",
    rateSource: candidate.source,
    completionMethod: method || "",
    companionIncomeUnchanged: true,
    companionIncomeAmount: money(companionIncomeAmount),
    bossLevelId: level?.id || null,
    bossLevelCode: level?.code || null,
    sides: candidate.sides || [candidate.side],
    directOnly: true,
    noUplineTraversal: true,
  };

  const earningPayload = {
    boss_id: beneficiaryId,
    beneficiary_user_id: beneficiaryId,
    companion_id: order.companion_id,
    relation_id: candidate.relation.id,
    order_id: String(order.id),
    order_amount: calc.orderAmount,
    platform_fee_rate: calc.platformFeeRate,
    platform_fee_amount: calc.platformFeeAmount,
    boss_commission_rate: calc.bossCommissionRate,
    boss_commission_amount: calc.bossCommissionAmount,
    clawback_amount: 0,
    companion_income_amount: money(companionIncomeAmount),
    rate_source: candidate.source,
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
    const msg = String(error?.message || "");
    if (/beneficiary_user_id|clawback_amount|PGRST204|42703|schema cache/i.test(msg)) {
      const slim = { ...earningPayload };
      delete slim.beneficiary_user_id;
      delete slim.clawback_amount;
      try {
        const rows = await supabaseJson(restUrl(EARNINGS_TABLE), {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify(slim),
        });
        earningRow = Array.isArray(rows) ? rows[0] : rows;
      } catch (error2) {
        if (/uq_boss_commission_earnings_order|duplicate|23505/i.test(String(error2?.message || ""))) {
          return { duplicate: true };
        }
        throw error2;
      }
    } else if (/uq_boss_commission_earnings_order|duplicate|23505/i.test(msg)) {
      return { duplicate: true };
    } else {
      throw error;
    }
  }

  try {
    await supabaseJson(restUrl("transactions"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        user_id: beneficiaryId,
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

  return {
    skipped: false,
    duplicate: false,
    rateSource: candidate.source,
    calc,
    earning: viewBossCommissionEarning(earningRow || earningPayload),
    beneficiaryId,
  };
}

/**
 * Idempotent settle with dual-side lookup + beneficiary dedupe.
 * Never recursively walks beneficiary uplines.
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

  if (!isSettlementEnabled()) {
    return { skipped: true, reason: settlementDisabledReason() || "settlement_flag_disabled" };
  }

  try {
    const companionProfile = await loadProfileForSettlementGuard(order.companion_id);
    const bossProfile = order.boss_id
      ? await loadProfileForSettlementGuard(order.boss_id)
      : null;
    const partyGuard = assertNotTestPartiesForSettlement({
      bossProfile,
      companionProfile,
      order,
    });
    if (!partyGuard.ok) {
      return { skipped: true, reason: partyGuard.reason || "test_party" };
    }
  } catch (_) {
    if (isProductionRuntime()) {
      return { skipped: true, reason: "test_guard_error" };
    }
  }

  let candidates = [];
  try {
    candidates = await collectOrderCommissionCandidates(order);
  } catch (error) {
    if (isRelationsMissing(error) || isMissingRelation(error)) {
      return { skipped: true, reason: "relations_missing" };
    }
    throw error;
  }

  if (!candidates.length) {
    return { skipped: true, reason: "no_active_relation" };
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

  const settledAt = completedAt || new Date().toISOString();
  const results = [];
  for (const candidate of candidates) {
    const one = await settleOneBeneficiary(order, candidate, {
      platformFee,
      platformRate,
      companionIncomeAmount,
      settledAt,
      method,
    });
    results.push(one);
  }

  const settled = results.filter((r) => r && !r.skipped && !r.duplicate);
  const duplicates = results.filter((r) => r?.duplicate);
  const primary =
    settled.find((r) => (r.earning?.meta?.sides || []).includes("companion")) ||
    settled[0] ||
    duplicates[0] ||
    results[0];

  if (primary?.earning && !primary.skipped) {
    try {
      await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(order.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({
          platform_fee_rate: primary.calc?.platformFeeRate ?? platformRate,
          platform_fee: primary.calc?.platformFeeAmount ?? platformFee,
          boss_commission_rate: primary.calc?.bossCommissionRate,
          boss_commission_amount: primary.calc?.bossCommissionAmount,
          boss_commission_rate_source: primary.rateSource,
          boss_level_id: primary.earning?.bossLevelId || null,
          boss_level_code: primary.earning?.bossLevelCode || null,
          direct_boss_id: primary.beneficiaryId || primary.earning?.bossId,
          boss_commission_relation_id: primary.earning?.relationId || null,
        }),
      });
    } catch (_) {
      /* columns may be missing until migration applied */
    }
  }

  if (!settled.length && duplicates.length === results.length) {
    return {
      duplicate: true,
      earnings: duplicates.map((d) => d.earning).filter(Boolean),
      earning: duplicates[0]?.earning || null,
      beneficiaries: candidates.map((c) => c.beneficiaryId),
    };
  }

  if (!settled.length) {
    return {
      skipped: true,
      reason: results[0]?.reason || "no_settleable_candidate",
      results,
      beneficiaries: candidates.map((c) => c.beneficiaryId),
    };
  }

  return {
    skipped: false,
    duplicate: false,
    rateSource: primary?.rateSource,
    calc: primary?.calc,
    earning: primary?.earning,
    earnings: settled.map((s) => s.earning).filter(Boolean),
    beneficiaries: settled.map((s) => s.beneficiaryId).filter(Boolean),
    candidateCount: candidates.length,
    settledCount: settled.length,
  };
}

/**
 * Refund / cancel clawback for channel commission rows on an order.
 * Money fields stay immutable; uses clawback_amount (+ status=clawed_back when fully clawed).
 */
export async function clawbackBossCommissionForOrder(
  order,
  { refundAmount = null, reason = "", mode = "refund" } = {}
) {
  if (!order?.id) return { ok: false, reason: "no_order" };
  let rows = [];
  try {
    rows =
      (await supabaseJson(
        restUrl(
          EARNINGS_TABLE,
          `?order_id=eq.${encodeURIComponent(order.id)}&status=in.(pending,settled)&select=*`
        ),
        { headers: serviceHeaders() }
      )) || [];
  } catch (error) {
    if (isMissingRelation(error)) return { ok: true, skipped: true, reason: "earnings_table_missing" };
    throw error;
  }
  if (!rows.length) return { ok: true, skipped: true, reason: "no_earnings", clawed: [] };

  const orderAmount = roundMoney(order.total_amount ?? order.order_amount ?? 0);
  const clawed = [];
  for (const row of rows) {
    const settledAmt = money(row.boss_commission_amount);
    const already = money(row.clawback_amount);
    const effectiveMode =
      mode === "partial_refund"
        ? "partial_refund"
        : mode === "cancel" || mode === "refund"
          ? mode
          : refundAmount != null && refundAmount !== "" && Number(refundAmount) < orderAmount
            ? "partial_refund"
            : mode;
    const math = calcBossCommissionClawback({
      settledAmount: settledAmt,
      alreadyClawed: already,
      orderAmount,
      refundAmount:
        refundAmount != null && refundAmount !== ""
          ? refundAmount
          : effectiveMode === "cancel" || effectiveMode === "refund"
            ? orderAmount
            : refundAmount,
      mode: effectiveMode,
    });
    if (!(math.delta > 0) && math.fullyClawed && already >= settledAmt) {
      clawed.push({ id: row.id, skipped: true, reason: "already_fully_clawed" });
      continue;
    }
    if (!(math.delta > 0) && !math.fullyClawed) {
      clawed.push({ id: row.id, skipped: true, reason: "no_delta" });
      continue;
    }
    const patch = {
      clawback_amount: math.targetClawback,
      updated_at: new Date().toISOString(),
    };
    if (math.fullyClawed) patch.status = "clawed_back";
    try {
      await supabaseJson(restUrl(EARNINGS_TABLE, `?id=eq.${encodeURIComponent(row.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify(patch),
      });
    } catch (error) {
      if (/clawback_amount|PGRST204|42703|schema cache/i.test(String(error?.message || ""))) {
        if (math.fullyClawed || effectiveMode === "cancel" || effectiveMode === "refund") {
          await supabaseJson(restUrl(EARNINGS_TABLE, `?id=eq.${encodeURIComponent(row.id)}`), {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({ status: "clawed_back", updated_at: new Date().toISOString() }),
          }).catch(() => null);
        }
      } else {
        throw error;
      }
    }

    if (math.delta > 0) {
      try {
        await supabaseJson(restUrl("transactions"), {
          method: "POST",
          headers: serviceHeaders(),
          body: JSON.stringify({
            user_id: row.beneficiary_user_id || row.boss_id,
            order_id: order.id,
            transaction_type: "boss_commission_clawback",
            amount: -Math.abs(math.delta),
            status: "completed",
            note: `MCJ_BOSS_COMMISSION_CLAWBACK:${JSON.stringify({
              reason: reason || mode,
              mode: effectiveMode,
              earningId: row.id,
              delta: math.delta,
            })}`,
            created_at: new Date().toISOString(),
          }),
        });
      } catch (_) {
        /* best-effort */
      }
    }
    clawed.push({
      id: row.id,
      beneficiaryId: row.beneficiary_user_id || row.boss_id,
      delta: math.delta,
      clawbackAmount: math.targetClawback,
      fullyClawed: math.fullyClawed,
    });
  }
  return { ok: true, clawed, count: clawed.length };
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
  if (bossId) {
    parts.push(
      `or=(boss_id.eq.${encodeURIComponent(bossId)},beneficiary_user_id.eq.${encodeURIComponent(bossId)})`
    );
  }
  if (companionId) parts.push(`companion_id=eq.${encodeURIComponent(companionId)}`);
  const rows = await supabaseJson(restUrl(EARNINGS_TABLE, `?${parts.join("&")}`), {
    headers: serviceHeaders(),
  });
  return (Array.isArray(rows) ? rows : []).map(viewBossCommissionEarning);
}

export { EARNINGS_TABLE, SOURCE_RANK };
