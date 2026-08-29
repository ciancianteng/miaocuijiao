/**
 * Boss referral / 推广返利 — real binds + reward ledger (cat_food via wallet, points via ledger).
 * Triggered from invitee first recharge / order completed. No mock rewards.
 */
import {
  creditWallet,
  isMissingRelation,
  money,
  nowIso,
  restUrl,
  serviceHeaders,
  supabaseJson,
} from "./_wallet.js";
import { applyPoints } from "./_points.js";

function codeFromUserId(userId) {
  const raw = String(userId || "").replace(/-/g, "").toUpperCase();
  const slice = raw.slice(0, 8) || "BOSS0000";
  return `MCJ${slice}`;
}

export async function ensureInviteCode(userId) {
  if (!userId) throw Object.assign(new Error("缺少用户"), { status: 400 });
  try {
    const existing = await supabaseJson(
      restUrl("boss_invite_codes", `?user_id=eq.${encodeURIComponent(userId)}&limit=1`),
      { headers: serviceHeaders() }
    );
    if (Array.isArray(existing) && existing[0]?.invite_code) return existing[0];
  } catch (error) {
    if (isMissingRelation(error)) {
      return { user_id: userId, invite_code: codeFromUserId(userId), _missing: true };
    }
    throw error;
  }

  let inviteCode = codeFromUserId(userId);
  for (let i = 0; i < 5; i += 1) {
    try {
      const rows = await supabaseJson(restUrl("boss_invite_codes"), {
        method: "POST",
        headers: serviceHeaders({ Prefer: "return=representation" }),
        body: JSON.stringify({
          user_id: userId,
          invite_code: inviteCode,
          created_at: nowIso(),
          updated_at: nowIso(),
        }),
      });
      return (Array.isArray(rows) && rows[0]) || { user_id: userId, invite_code: inviteCode };
    } catch (error) {
      const msg = String(error?.message || error || "");
      if (/duplicate|unique/i.test(msg)) {
        inviteCode = `${codeFromUserId(userId)}${String(i + 1)}`;
        const again = await supabaseJson(
          restUrl("boss_invite_codes", `?user_id=eq.${encodeURIComponent(userId)}&limit=1`),
          { headers: serviceHeaders() }
        ).catch(() => null);
        if (Array.isArray(again) && again[0]) return again[0];
        continue;
      }
      if (isMissingRelation(error)) {
        return { user_id: userId, invite_code: inviteCode, _missing: true };
      }
      throw error;
    }
  }
  return { user_id: userId, invite_code: inviteCode };
}

export async function findRelationByInvitee(inviteeId) {
  try {
    const rows = await supabaseJson(
      restUrl(
        "referral_relations",
        `?invitee_id=eq.${encodeURIComponent(inviteeId)}&status=eq.active&limit=1`
      ),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
}

export async function findInviterByCode(inviteCode) {
  const code = String(inviteCode || "").trim().toUpperCase();
  if (!code) return null;
  try {
    const rows = await supabaseJson(
      restUrl("boss_invite_codes", `?invite_code=eq.${encodeURIComponent(code)}&limit=1`),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
}

/**
 * Bind invitee → inviter once. Uses real invite code owned by another boss.
 */
export async function bindReferral({ inviteeId, inviteCode }) {
  if (!inviteeId) throw Object.assign(new Error("缺少被邀请人"), { status: 400 });
  const code = String(inviteCode || "").trim().toUpperCase();
  if (!code) throw Object.assign(new Error("请输入邀请码"), { status: 400 });

  const existing = await findRelationByInvitee(inviteeId);
  if (existing) {
    return { ok: true, duplicate: true, relation: existing, message: "已绑定过邀请关系" };
  }

  const owner = await findInviterByCode(code);
  if (!owner || !owner.user_id) {
    throw Object.assign(new Error("邀请码无效"), { status: 404 });
  }
  if (String(owner.user_id) === String(inviteeId)) {
    throw Object.assign(new Error("不能填写自己的邀请码"), { status: 400 });
  }

  try {
    const rows = await supabaseJson(restUrl("referral_relations"), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        inviter_id: owner.user_id,
        invitee_id: inviteeId,
        invite_code: code,
        status: "active",
        bound_at: nowIso(),
        created_at: nowIso(),
        updated_at: nowIso(),
      }),
    });
    const relation = Array.isArray(rows) ? rows[0] : rows;
    return { ok: true, duplicate: false, relation, message: "邀请关系已绑定" };
  } catch (error) {
    if (isMissingRelation(error)) {
      throw Object.assign(new Error("推广表尚未创建，请先执行 migration 20260829_boss_levels_and_referral.sql"), {
        status: 503,
      });
    }
    const msg = String(error?.message || error || "");
    if (/duplicate|unique|referral_relations_invitee/i.test(msg)) {
      const again = await findRelationByInvitee(inviteeId);
      return { ok: true, duplicate: true, relation: again, message: "已绑定过邀请关系" };
    }
    throw error;
  }
}

export async function listReferralRules(triggerEvent = "") {
  try {
    let q = "?enabled=eq.true&order=sort.asc";
    if (triggerEvent) {
      q = `?enabled=eq.true&trigger_event=eq.${encodeURIComponent(triggerEvent)}&order=sort.asc`;
    }
    const rows = await supabaseJson(restUrl("referral_reward_rules", q), { headers: serviceHeaders() });
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
}

export async function listReferralRewards(userId, { as = "beneficiary", limit = 50 } = {}) {
  const col = as === "inviter" ? "inviter_id" : "beneficiary_id";
  try {
    const rows = await supabaseJson(
      restUrl(
        "referral_rewards",
        `?${col}=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${Math.max(1, Math.min(200, Number(limit) || 50))}`
      ),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
}

export async function countInvitees(inviterId) {
  try {
    const rows = await supabaseJson(
      restUrl(
        "referral_relations",
        `?inviter_id=eq.${encodeURIComponent(inviterId)}&status=eq.active&select=id`
      ),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) ? rows.length : 0;
  } catch (error) {
    if (isMissingRelation(error)) return 0;
    throw error;
  }
}

export function viewReferralReward(row = {}) {
  return {
    id: row.id,
    relationId: row.relation_id,
    beneficiaryId: row.beneficiary_id,
    inviterId: row.inviter_id,
    inviteeId: row.invitee_id,
    orderId: row.order_id || "",
    paymentOrderId: row.payment_order_id || "",
    triggerEvent: row.trigger_event || "",
    rewardAsset: row.reward_asset || "",
    baseAmount: money(row.base_amount),
    rebatePercent: money(row.rebate_percent),
    rewardAmount: money(row.reward_amount),
    status: row.status || "",
    description: row.description || "",
    createdAt: row.created_at || "",
  };
}

async function insertRewardRow(payload) {
  const rows = await supabaseJson(restUrl("referral_rewards"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function creditAsset({
  beneficiaryId,
  rewardAsset,
  amount,
  description,
  orderId,
  paymentOrderId,
  idempotencyKey,
}) {
  const amt = money(amount);
  if (amt <= 0) return { ok: true, skipped: true };

  if (rewardAsset === "points") {
    // Do NOT attach order_id: uniq_point_transactions_earn_order is reserved for order-completion earn.
    const result = await applyPoints({
      userId: beneficiaryId,
      points: amt,
      type: "earn",
      orderId: null,
      description:
        description ||
        (orderId ? `推广积分奖励（订单 ${orderId}）` : paymentOrderId ? `推广积分奖励（充值 ${paymentOrderId}）` : "推广积分奖励"),
      operatorId: null,
    });
    return { ok: !!result?.ok, pointTxId: result?.transaction_id || null, result };
  }

  // Default: cat_food → bonus wallet (invite_reward)
  const result = await creditWallet({
    bossId: beneficiaryId,
    transactionType: "invite_reward",
    amount: amt,
    balanceType: "bonus",
    idempotencyKey,
    reason: description || "推广返利",
    relatedOrderId: orderId || null,
    relatedRechargeId: paymentOrderId || null,
  });
  const txId = result?.transaction_id || result?.id || result?.tx?.id || null;
  return { ok: true, walletTxId: txId, result };
}

/**
 * Credit referral rewards for a trigger. Idempotent per (beneficiary, order|payment, trigger).
 */
export async function creditReferralForEvent({
  inviteeId,
  triggerEvent,
  baseAmount = 0,
  orderId = null,
  paymentOrderId = null,
}) {
  if (!inviteeId || !triggerEvent) {
    return { ok: false, skipped: true, message: "缺少 invitee 或 trigger" };
  }

  const relation = await findRelationByInvitee(inviteeId);
  if (!relation) {
    return { ok: true, skipped: true, message: "无推广绑定，跳过" };
  }

  const rules = await listReferralRules(triggerEvent);
  if (!rules.length) {
    return { ok: true, skipped: true, message: "无启用规则" };
  }

  const results = [];
  for (const rule of rules) {
    const rebatePercent = money(rule.rebate_percent);
    const maxPct = money(rule.max_rebate_percent) || 30;
    const pct = Math.min(rebatePercent, maxPct);
    const asset = String(rule.reward_asset || "cat_food").toLowerCase() === "points" ? "points" : "cat_food";
    const base = money(baseAmount);
    const inviterAmount = Math.round(((base * pct) / 100) * 100) / 100;

    const beneficiaries = [
      {
        id: relation.inviter_id,
        amount: inviterAmount,
        role: "inviter",
        description: `推广返利 ${pct}%（${triggerEvent}）`,
      },
    ];
    if (rule.credit_invitee) {
      const inviteeAmt =
        asset === "points"
          ? money(rule.invitee_fixed_points) || inviterAmount
          : money(rule.invitee_fixed_cat_food) || inviterAmount;
      if (inviteeAmt > 0) {
        beneficiaries.push({
          id: relation.invitee_id,
          amount: inviteeAmt,
          role: "invitee",
          description: `邀请注册奖励（${triggerEvent}）`,
        });
      }
    }

    for (const b of beneficiaries) {
      if (money(b.amount) <= 0) continue;
      const idempotencyKey = [
        "referral",
        triggerEvent,
        relation.id,
        b.id,
        orderId || paymentOrderId || "none",
        rule.code || rule.id,
      ].join(":");

      let rewardRow;
      try {
        rewardRow = await insertRewardRow({
          relation_id: relation.id,
          rule_id: rule.id,
          beneficiary_id: b.id,
          inviter_id: relation.inviter_id,
          invitee_id: relation.invitee_id,
          order_id: orderId || null,
          payment_order_id: paymentOrderId || null,
          trigger_event: triggerEvent,
          reward_asset: asset,
          base_amount: base,
          rebate_percent: pct,
          reward_amount: money(b.amount),
          status: "pending",
          description: b.description,
          created_at: nowIso(),
        });
      } catch (error) {
        const msg = String(error?.message || error || "");
        if (/duplicate|unique|uniq_referral/i.test(msg)) {
          results.push({ ok: true, duplicate: true, beneficiaryId: b.id, rule: rule.code });
          continue;
        }
        if (isMissingRelation(error)) {
          return { ok: false, skipped: true, message: "推广表尚未创建" };
        }
        throw error;
      }

      try {
        const credited = await creditAsset({
          beneficiaryId: b.id,
          rewardAsset: asset,
          amount: b.amount,
          description: b.description,
          orderId,
          paymentOrderId,
          idempotencyKey,
        });
        if (rewardRow?.id) {
          await supabaseJson(restUrl("referral_rewards", `?id=eq.${encodeURIComponent(rewardRow.id)}`), {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({
              status: "credited",
              wallet_tx_id: credited.walletTxId || null,
              point_tx_id: credited.pointTxId || null,
            }),
          }).catch(() => null);
        }
        results.push({
          ok: true,
          duplicate: false,
          beneficiaryId: b.id,
          amount: money(b.amount),
          asset,
          rule: rule.code,
          rewardId: rewardRow?.id,
        });
      } catch (err) {
        if (rewardRow?.id) {
          await supabaseJson(restUrl("referral_rewards", `?id=eq.${encodeURIComponent(rewardRow.id)}`), {
            method: "PATCH",
            headers: serviceHeaders(),
            body: JSON.stringify({ status: "failed", description: `${b.description}｜失败：${err.message || err}` }),
          }).catch(() => null);
        }
        results.push({ ok: false, beneficiaryId: b.id, message: err.message || "发放失败" });
      }
    }
  }

  return { ok: true, results };
}

/** After invitee order completed — rebate on paid amount. */
export async function creditReferralForCompletedOrder(order = {}) {
  const inviteeId = String(order.boss_id || order.bossId || order.user_id || "").trim();
  const orderId = String(order.id || "").trim();
  if (!inviteeId || !orderId) return { ok: false, skipped: true };
  const paid = money(order.paid_cat_food ?? order.paidCatFood ?? order.total_amount ?? order.totalAmount ?? 0);
  return creditReferralForEvent({
    inviteeId,
    triggerEvent: "invitee_order_completed",
    baseAmount: paid,
    orderId,
    paymentOrderId: null,
  });
}

/** After invitee recharge credited — first paid recharge only for first_recharge rule. */
export async function creditReferralForRecharge(paymentOrder = {}) {
  const inviteeId = String(paymentOrder.boss_id || paymentOrder.bossId || "").trim();
  const paymentOrderId = String(paymentOrder.id || "").trim();
  if (!inviteeId || !paymentOrderId) return { ok: false, skipped: true };

  // Count prior paid recharges excluding this one
  let isFirst = true;
  try {
    const prior = await supabaseJson(
      restUrl(
        "payment_orders",
        `?boss_id=eq.${encodeURIComponent(inviteeId)}&status=in.(paid,credited)&id=neq.${encodeURIComponent(paymentOrderId)}&select=id&limit=1`
      ),
      { headers: serviceHeaders() }
    );
    if (Array.isArray(prior) && prior.length) isFirst = false;
  } catch {
    /* if cannot check, still attempt first_recharge rule (idempotent) */
  }

  if (!isFirst) {
    return { ok: true, skipped: true, message: "非首充，跳过首充推广奖励" };
  }

  const base = money(
    paymentOrder.paid_cat_food ??
      paymentOrder.paidCatFood ??
      paymentOrder.amount_rm ??
      paymentOrder.pay_amount_rm ??
      0
  );
  return creditReferralForEvent({
    inviteeId,
    triggerEvent: "invitee_first_recharge",
    baseAmount: base,
    orderId: null,
    paymentOrderId,
  });
}

export async function getReferralBannerMeta() {
  const rules = await listReferralRules();
  let maxRebate = 30;
  let bothSides = false;
  for (const r of rules) {
    maxRebate = Math.max(maxRebate, money(r.max_rebate_percent) || 0, money(r.rebate_percent) || 0);
    if (r.credit_invitee) bothSides = true;
  }
  return {
    title: "推广返利 · 邀请好友",
    subtitle: bothSides ? `双方得奖励 · 最高返利 ${maxRebate}%` : `最高返利 ${maxRebate}%`,
    maxRebatePercent: maxRebate,
    bothSides,
  };
}

export async function getBossReferralSummary(userId) {
  const codeRow = await ensureInviteCode(userId);
  const invitees = await countInvitees(userId);
  const rewards = await listReferralRewards(userId, { as: "beneficiary", limit: 100 });
  const asInviter = await listReferralRewards(userId, { as: "inviter", limit: 100 });
  const totalEarned = rewards
    .filter((r) => String(r.status) === "credited")
    .reduce((s, r) => s + money(r.reward_amount), 0);
  const banner = await getReferralBannerMeta();
  return {
    inviteCode: codeRow?.invite_code || codeFromUserId(userId),
    inviteeCount: invitees,
    totalEarnedCatFood: Math.round(totalEarned * 100) / 100,
    rewardCount: rewards.length,
    inviterRewardCount: asInviter.length,
    banner,
    recentRewards: rewards.slice(0, 20).map(viewReferralReward),
    schemaMissing: !!codeRow?._missing,
  };
}
