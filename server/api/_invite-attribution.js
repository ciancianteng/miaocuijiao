/**
 * Invite attribution + confirm-before-bind + deferred antifraud rewards.
 *
 * ACTIVE ops relation SoT remains boss_companion_relations (#185).
 * Confirm only binds — rewards wait for a qualifying completed order.
 *
 * Owner antifraud (§16–17):
 *   Boss inviter     → invitee (boss) first real paid order completed
 *                      + after-sale closed + no refund → catfood (bonus) reward
 *   Companion inviter → invitee companion approved + first real completed order
 *                      + after-sale closed + no refund → companion_income (withdrawable)
 *
 * Idempotency: referral_reward:{invitee_id}:{reward_type}
 */
import {
  bindRelation,
  getActiveRelationForCompanion,
  isRelationsMissing,
} from "./_boss-companion-relations.js";
import {
  hasBossRole,
  hasCompanionRole,
  loadCompanionRowForUser,
} from "./_account-roles.js";
import { isBossInviteLinksEnabled } from "./_feature-flags.js";
import { creditWallet, isMissingRelation, money, restUrl, serviceHeaders, supabaseJson } from "./_wallet.js";
import { isBossAfterSaleOpen } from "./_earnings-windows.js";
import { isTestAccountRecord } from "./_test-accounts.js";

const ATTR_TABLE = "invite_attributions";
const ATTR_EVT_TABLE = "invite_attribution_events";
const REWARD_TABLE = "invite_reward_ledger";
const CASH_WALLET_TABLE = "invite_cash_wallets";
const LINK_TABLE = "boss_invite_links";

/** Defaults — override via env without code change. */
export const DEFAULT_BOSS_INVITE_MEOWCOIN = Number(process.env.MCJ_BOSS_INVITE_MEOWCOIN || 10);
export const DEFAULT_COMPANION_INVITE_CASH = Number(process.env.MCJ_COMPANION_INVITE_CASH || 5);

function nowIso() {
  return new Date().toISOString();
}

function httpError(message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function referralIdempotencyKey(inviteeId, rewardType) {
  return `referral_reward:${String(inviteeId || "").trim()}:${String(rewardType || "").trim()}`;
}

async function loadProfile(id) {
  if (!id) return null;
  const rows = await supabaseJson(
    restUrl("profiles", `?id=eq.${encodeURIComponent(id)}&select=*&limit=1`),
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

export function isAttributionMissing(error) {
  return (
    isMissingRelation(error) ||
    /invite_attributions|invite_attribution_events|invite_reward_ledger|invite_cash_wallets|PGRST205/i.test(
      String(error?.message || "")
    )
  );
}

export function viewAttribution(row = {}, extras = {}) {
  return {
    id: row.id || "",
    inviteCode: row.invite_code || "",
    inviteLinkId: row.invite_link_id || "",
    inviterUserId: row.inviter_user_id || "",
    inviterRole: row.inviter_role || "",
    inviteeUserId: row.invitee_user_id || "",
    inviteeRoleAtCreate: row.invitee_role_at_create || "unknown",
    status: row.status || "",
    relationId: row.relation_id || null,
    confirmedAt: row.confirmed_at || null,
    rejectedAt: row.rejected_at || null,
    rewardGranted: !!row.reward_granted,
    detail: row.detail || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    inviter: extras.inviter || null,
  };
}

async function insertAttrEvent(attributionId, eventType, actorUserId, payload = {}) {
  try {
    await supabaseJson(restUrl(ATTR_EVT_TABLE), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        attribution_id: attributionId,
        event_type: eventType,
        actor_user_id: actorUserId || null,
        payload,
      }),
    });
  } catch (e) {
    if (!isAttributionMissing(e)) console.warn("[invite-attr] event soft-fail", e?.message || e);
  }
}

async function resolveInviteeRole(userId) {
  const [profile, companionRow] = await Promise.all([loadProfile(userId), loadCompanionRowForUser(userId)]);
  if (!profile) return "unknown";
  if (hasCompanionRole(profile, { companion: companionRow })) return "companion";
  if (hasBossRole(profile)) return "boss";
  return "user";
}

async function resolveInviterRole(profile, companionRow, linkOwnerRole) {
  const fromLink = String(linkOwnerRole || "").toLowerCase();
  if (fromLink === "companion" || fromLink === "boss") return fromLink;
  if (hasCompanionRole(profile, { companion: companionRow })) return "companion";
  if (hasBossRole(profile)) return "boss";
  return "boss";
}

export async function getPendingAttributionForInvitee(inviteeUserId) {
  if (!inviteeUserId) return null;
  const rows = await supabaseJson(
    restUrl(
      ATTR_TABLE,
      `?invitee_user_id=eq.${encodeURIComponent(inviteeUserId)}&status=eq.pending&order=created_at.desc&limit=1`
    ),
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function getConfirmedAttributionForInvitee(inviteeUserId) {
  if (!inviteeUserId) return null;
  const rows = await supabaseJson(
    restUrl(
      ATTR_TABLE,
      `?invitee_user_id=eq.${encodeURIComponent(inviteeUserId)}&status=eq.confirmed&order=confirmed_at.desc&limit=1`
    ),
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

function normalizeOrderStatus(status) {
  return String(status || "")
    .trim()
    .toLowerCase();
}

function orderLooksPaid(order = {}) {
  if (order.paid_at || order.paidAt) return true;
  if (money(order.paid_cat_food || order.paidCatFood) > 0) return true;
  const st = normalizeOrderStatus(order.status);
  if (["awaiting_payment", "pending_payment", "unpaid", "draft"].includes(st)) return false;
  return ["claimed", "confirmed", "in_progress", "waiting_boss_confirm", "completed", "reviewed"].includes(st);
}

function orderLooksRefundedOrOpenRefund(order = {}) {
  const st = normalizeOrderStatus(order.status);
  if (["refunded", "refund_requested", "cancelled", "canceled"].includes(st)) return true;
  const blob = `${order.note || ""}\n${order.description || ""}`;
  if (/\[\[CLAWBACK\]\]|MCJ_CLAWBACK|退款冲减/i.test(blob)) return true;
  return false;
}

function companionApproved(companionRow = {}, profile = {}) {
  const vs = String(companionRow.verification_status || companionRow.audit_status || profile.verification_status || "")
    .trim()
    .toLowerCase();
  if (/approved|verified|passed|active|ok/.test(vs)) return true;
  const review = String(companionRow.profile_review_status || companionRow.review_status || "")
    .trim()
    .toLowerCase();
  return /approved|verified|passed/.test(review);
}

/**
 * Pure eligibility helper (also used by offline tests).
 * @returns {{ ok: boolean, reason?: string }}
 */
export function evaluateInviteOrderEligibility(order = {}, ctx = {}) {
  const {
    attribution = null,
    inviteeProfile = null,
    inviteeCompanion = null,
    bossProfile = null,
    companionProfile = null,
    nowMs = Date.now(),
  } = ctx;
  if (!attribution || String(attribution.status) !== "confirmed") {
    return { ok: false, reason: "attribution_not_confirmed" };
  }
  if (attribution.reward_granted) return { ok: false, reason: "already_granted" };

  const st = normalizeOrderStatus(order.status);
  if (orderLooksRefundedOrOpenRefund(order)) return { ok: false, reason: "order_refunded_or_canceled" };
  if (st !== "completed" && st !== "reviewed") return { ok: false, reason: "order_not_completed" };
  if (!orderLooksPaid(order)) return { ok: false, reason: "order_unpaid" };
  if (isBossAfterSaleOpen(order, nowMs)) return { ok: false, reason: "after_sale_open" };

  if (
    isTestAccountRecord(bossProfile || {}) ||
    isTestAccountRecord(companionProfile || {}) ||
    isTestAccountRecord(inviteeProfile || {})
  ) {
    return { ok: false, reason: "test_data" };
  }

  const inviterRole = String(attribution.inviter_role || "");
  const inviteeId = String(attribution.invitee_user_id || "");

  if (inviterRole === "companion") {
    if (String(order.companion_id || "") !== inviteeId) {
      return { ok: false, reason: "invitee_not_order_companion" };
    }
    if (!companionApproved(inviteeCompanion || {}, inviteeProfile || {})) {
      return { ok: false, reason: "companion_not_approved" };
    }
  } else if (String(order.boss_id || "") !== inviteeId) {
    return { ok: false, reason: "invitee_not_order_boss" };
  }

  return { ok: true, reason: "eligible" };
}

export async function recognizeInviteAttribution({
  inviteCode,
  inviteeUserId,
  inviteLink = null,
} = {}) {
  const code = String(inviteCode || "").trim();
  if (!code || !inviteeUserId) {
    return { attempted: false, outcome: null };
  }
  if (!isBossInviteLinksEnabled()) {
    return { attempted: false, outcome: "flag_disabled" };
  }

  let link = inviteLink;
  if (!link) {
    const rows = await supabaseJson(
      restUrl(LINK_TABLE, `?code=eq.${encodeURIComponent(code)}&select=*&limit=1`),
      { headers: serviceHeaders() }
    );
    link = Array.isArray(rows) ? rows[0] || null : null;
  }
  if (!link || String(link.status) !== "active") {
    return { attempted: true, outcome: "skipped_invalid", detail: "link_inactive_or_missing" };
  }
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return { attempted: true, outcome: "skipped_invalid", detail: "expired" };
  }
  const max = link.max_uses == null ? null : Number(link.max_uses);
  const used = Number(link.use_count || 0);
  if (max != null && Number.isFinite(max) && used >= max) {
    return { attempted: true, outcome: "skipped_invalid", detail: "exhausted" };
  }

  const inviterId = String(link.boss_id || "").trim();
  if (!inviterId || inviterId === String(inviteeUserId)) {
    return { attempted: true, outcome: "skipped_invalid", detail: "self_invite_or_bad_inviter" };
  }

  try {
    const confirmed = await getConfirmedAttributionForInvitee(inviteeUserId);
    if (confirmed) {
      return {
        attempted: true,
        outcome: "skipped_already_bound",
        attribution: viewAttribution(confirmed),
        detail: "already_confirmed",
      };
    }
  } catch (e) {
    if (isAttributionMissing(e)) {
      return { attempted: true, outcome: "error", detail: "tables_missing" };
    }
    throw e;
  }

  try {
    const existingRel = await getActiveRelationForCompanion(inviteeUserId);
    if (existingRel) {
      return {
        attempted: true,
        outcome: "skipped_already_bound",
        detail: "active_relation_exists",
      };
    }
  } catch (e) {
    if (!isRelationsMissing(e)) throw e;
  }

  const pending = await getPendingAttributionForInvitee(inviteeUserId).catch((e) => {
    if (isAttributionMissing(e)) return null;
    throw e;
  });
  if (pending) {
    return {
      attempted: true,
      outcome: "pending_confirm",
      attribution: viewAttribution(pending),
      detail: "already_pending",
    };
  }

  const [inviterProfile, inviterCompanion, inviteeRole] = await Promise.all([
    loadProfile(inviterId),
    loadCompanionRowForUser(inviterId),
    resolveInviteeRole(inviteeUserId),
  ]);
  if (!inviterProfile) {
    return { attempted: true, outcome: "skipped_invalid", detail: "inviter_missing" };
  }
  const inviterRole = await resolveInviterRole(inviterProfile, inviterCompanion, link.owner_role);

  let created;
  try {
    const rows = await supabaseJson(restUrl(ATTR_TABLE), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        invite_link_id: link.id || null,
        invite_code: code,
        inviter_user_id: inviterId,
        inviter_role: inviterRole,
        invitee_user_id: inviteeUserId,
        invitee_role_at_create: inviteeRole,
        status: "pending",
        detail: "awaiting_invitee_confirm",
      }),
    });
    created = Array.isArray(rows) ? rows[0] : rows;
  } catch (e) {
    if (/duplicate|unique|23505/i.test(String(e?.message || ""))) {
      const again = await getPendingAttributionForInvitee(inviteeUserId);
      return {
        attempted: true,
        outcome: "pending_confirm",
        attribution: again ? viewAttribution(again) : null,
        detail: "duplicate_pending",
      };
    }
    if (isAttributionMissing(e)) {
      return { attempted: true, outcome: "error", detail: "tables_missing" };
    }
    throw e;
  }

  await insertAttrEvent(created.id, "recognize", inviteeUserId, { inviteCode: code, inviterRole });

  return {
    attempted: true,
    outcome: "pending_confirm",
    attribution: viewAttribution(created, {
      inviter: {
        id: inviterId,
        nickname: inviterProfile.nickname || inviterProfile.name || "",
        role: inviterRole,
      },
    }),
  };
}

async function ensureInviteCashWallet(userId) {
  const rows = await supabaseJson(
    restUrl(CASH_WALLET_TABLE, `?user_id=eq.${encodeURIComponent(userId)}&limit=1`),
    { headers: serviceHeaders() }
  );
  if (rows?.[0]) return rows[0];
  const created = await supabaseJson(restUrl(CASH_WALLET_TABLE), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      user_id: userId,
      available_amount: 0,
      pending_amount: 0,
      frozen_amount: 0,
      total_earned: 0,
      total_withdrawn: 0,
    }),
  });
  return Array.isArray(created) ? created[0] : created;
}

async function creditCompanionInviteIncome(companionId, amount, attribution, orderId) {
  if (!(amount > 0) || !companionId) return null;
  const note = `邀请佣金 MCJ_INVITE:${JSON.stringify({
    source: "invite",
    attributionId: attribution.id,
    inviteeId: attribution.invitee_user_id,
    orderId: orderId || null,
    amount,
  })}`;
  const rows = await supabaseJson(restUrl("transactions"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      user_id: companionId,
      order_id: null,
      transaction_type: "companion_income",
      amount,
      status: "completed",
      note,
      created_at: nowIso(),
    }),
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

/**
 * Grant one-time invite reward AFTER eligibility. Idempotent on invitee+reward_type.
 */
export async function grantInviteRewardForAttribution(attribution, { order = null, force = false } = {}) {
  if (!attribution?.id) return { granted: false, reason: "missing_attribution" };
  if (attribution.reward_granted) {
    return { granted: false, reason: "already_granted", duplicate: true };
  }

  const inviterRole = String(attribution.inviter_role || "");
  const inviterId = attribution.inviter_user_id;
  const inviteeId = attribution.invitee_user_id;
  const rewardType = inviterRole === "companion" ? "cash" : "meow_coin";
  const idempotencyKey = referralIdempotencyKey(inviteeId, rewardType);

  try {
    const byKey = await supabaseJson(
      restUrl(
        REWARD_TABLE,
        `?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&status=eq.granted&limit=1`
      ),
      { headers: serviceHeaders() }
    );
    if (byKey?.[0]) {
      return { granted: false, reason: "already_granted", duplicate: true, ledger: byKey[0] };
    }
    const existing = await supabaseJson(
      restUrl(
        REWARD_TABLE,
        `?attribution_id=eq.${encodeURIComponent(attribution.id)}&status=eq.granted&limit=1`
      ),
      { headers: serviceHeaders() }
    );
    if (existing?.[0]) {
      return { granted: false, reason: "already_granted", duplicate: true, ledger: existing[0] };
    }
  } catch (e) {
    if (isAttributionMissing(e)) return { granted: false, reason: "tables_missing" };
    throw e;
  }

  if (!force) {
    if (!order) return { granted: false, reason: "missing_qualifying_order" };
    const [inviteeProfile, inviteeCompanion, bossProfile, companionProfile] = await Promise.all([
      loadProfile(inviteeId),
      loadCompanionRowForUser(inviteeId),
      loadProfile(order.boss_id),
      loadProfile(order.companion_id),
    ]);
    const elig = evaluateInviteOrderEligibility(order, {
      attribution,
      inviteeProfile,
      inviteeCompanion,
      bossProfile,
      companionProfile,
    });
    if (!elig.ok) return { granted: false, reason: elig.reason };
  }

  let amount;
  let withdrawable;
  let currency;
  if (rewardType === "cash") {
    amount = money(DEFAULT_COMPANION_INVITE_CASH);
    withdrawable = true;
    currency = "CASH";
  } else {
    amount = money(DEFAULT_BOSS_INVITE_MEOWCOIN);
    withdrawable = false;
    currency = "CATFOOD";
  }
  if (!(amount > 0)) return { granted: false, reason: "zero_amount" };

  let ledgerRow;
  try {
    const rows = await supabaseJson(restUrl(REWARD_TABLE), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        attribution_id: attribution.id,
        inviter_user_id: inviterId,
        invitee_user_id: inviteeId,
        inviter_role: inviterRole === "companion" ? "companion" : "boss",
        reward_type: rewardType,
        amount,
        currency,
        withdrawable,
        idempotency_key: idempotencyKey,
        status: "granted",
        meta: {
          source: "qualifying_order",
          orderId: order?.id || null,
          orderNo: order?.order_no || null,
        },
      }),
    });
    ledgerRow = Array.isArray(rows) ? rows[0] : rows;
  } catch (e) {
    if (/duplicate|unique|23505/i.test(String(e?.message || ""))) {
      return { granted: false, reason: "already_granted", duplicate: true };
    }
    if (isAttributionMissing(e)) return { granted: false, reason: "tables_missing" };
    throw e;
  }

  if (rewardType === "meow_coin") {
    await creditWallet({
      bossId: inviterId,
      transactionType: "invite_reward",
      amount,
      balanceType: "bonus",
      idempotencyKey,
      reason: "邀请达标奖励（猫粮/赠送，不可提现）",
      internalNote: `invite_attr:${attribution.id};order:${order?.id || ""}`,
      operatorId: inviteeId,
    });
  } else {
    await creditCompanionInviteIncome(inviterId, amount, attribution, order?.id || null);
    // Mirror earned total on invite_cash_wallets for channel reporting ONLY — do not add
    // available_amount (withdrawable SoT is companion_income ledger).
    try {
      const wallet = await ensureInviteCashWallet(inviterId);
      const nextEarned = money(wallet.total_earned) + amount;
      await supabaseJson(restUrl(CASH_WALLET_TABLE, `?user_id=eq.${encodeURIComponent(inviterId)}`), {
        method: "PATCH",
        headers: serviceHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({
          total_earned: nextEarned,
          updated_at: nowIso(),
        }),
      });
    } catch (e) {
      if (!isAttributionMissing(e)) console.warn("[invite-attr] cash wallet soft-fail", e?.message || e);
    }
  }

  await supabaseJson(restUrl(ATTR_TABLE, `?id=eq.${encodeURIComponent(attribution.id)}`), {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({
      reward_granted: true,
      reward_ledger_id: ledgerRow?.id || null,
      updated_at: nowIso(),
      detail: `rewarded_via_order:${order?.id || ""}`,
    }),
  });
  await insertAttrEvent(attribution.id, "reward_granted", inviterId, {
    rewardType,
    amount,
    withdrawable,
    orderId: order?.id || null,
    idempotencyKey,
  });

  return {
    granted: true,
    rewardType,
    amount,
    withdrawable,
    currency,
    ledger: ledgerRow,
    idempotencyKey,
  };
}

/**
 * Sweep confirmed attributions awaiting reward — used when after-sale closes later.
 */
export async function sweepPendingInviteRewards({ limit = 40 } = {}) {
  try {
    if (!isBossInviteLinksEnabled()) return { ok: true, scanned: 0, granted: 0 };
    const rows = await supabaseJson(
      restUrl(
        ATTR_TABLE,
        `?status=eq.confirmed&reward_granted=eq.false&order=confirmed_at.asc&limit=${Math.max(1, Math.min(100, limit))}`
      ),
      { headers: serviceHeaders() }
    ).catch((e) => {
      if (isAttributionMissing(e)) return [];
      throw e;
    });
    let granted = 0;
    const details = [];
    for (const attr of rows || []) {
      const inviteeId = attr.invitee_user_id;
      const inviterRole = String(attr.inviter_role || "");
      let orderQuery =
        inviterRole === "companion"
          ? `?companion_id=eq.${encodeURIComponent(inviteeId)}&status=eq.completed&order=completed_at.asc&limit=20`
          : `?boss_id=eq.${encodeURIComponent(inviteeId)}&status=eq.completed&order=completed_at.asc&limit=20`;
      const orders = await supabaseJson(restUrl("orders", orderQuery), { headers: serviceHeaders() }).catch(
        () => []
      );
      let hit = null;
      for (const order of orders || []) {
        const r = await grantInviteRewardForAttribution(attr, { order });
        details.push({ attributionId: attr.id, orderId: order.id, ...r });
        if (r.granted) {
          granted += 1;
          hit = r;
          break;
        }
      }
      if (!hit) details.push({ attributionId: attr.id, granted: false, reason: "no_qualifying_order_yet" });
    }
    return { ok: true, scanned: (rows || []).length, granted, details };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  }
}

/**
 * After order completion / after-sale close: try grant for boss or companion invitee.
 * Safe NO-OP when ineligible. Never throws into order path.
 */
export async function maybeGrantInviteRewardForOrder(order) {
  if (!order?.id) return { granted: false, reason: "missing_order" };
  try {
    if (!isBossInviteLinksEnabled()) return { granted: false, reason: "flag_disabled" };

    const candidates = [];
    if (order.boss_id) {
      const a = await getConfirmedAttributionForInvitee(order.boss_id);
      if (a && !a.reward_granted && String(a.inviter_role) !== "companion") candidates.push(a);
    }
    if (order.companion_id) {
      const a = await getConfirmedAttributionForInvitee(order.companion_id);
      if (a && !a.reward_granted && String(a.inviter_role) === "companion") candidates.push(a);
    }
    if (!candidates.length) return { granted: false, reason: "no_pending_reward_attribution" };

    const results = [];
    for (const attr of candidates) {
      results.push(await grantInviteRewardForAttribution(attr, { order }));
    }
    const granted = results.find((r) => r.granted);
    return granted || results[0] || { granted: false, reason: "not_eligible" };
  } catch (e) {
    console.warn("[invite-attr] maybeGrant soft-fail", e?.message || e);
    return { granted: false, reason: "error", detail: String(e?.message || e).slice(0, 200) };
  }
}

/**
 * Invitee confirms pending attribution → active relation ONLY (no reward yet).
 */
export async function confirmInviteAttribution({
  inviteeUserId,
  attributionId = "",
} = {}) {
  if (!inviteeUserId) throw httpError("缺少用户", 401);
  if (!isBossInviteLinksEnabled()) {
    throw httpError("邀请功能尚未开通", 503, { code: "BOSS_INVITE_LINKS_DISABLED" });
  }

  let attr = null;
  if (attributionId) {
    const rows = await supabaseJson(
      restUrl(ATTR_TABLE, `?id=eq.${encodeURIComponent(attributionId)}&limit=1`),
      { headers: serviceHeaders() }
    );
    attr = Array.isArray(rows) ? rows[0] : null;
  } else {
    attr = await getPendingAttributionForInvitee(inviteeUserId);
    if (!attr) {
      const confirmedExisting = await getConfirmedAttributionForInvitee(inviteeUserId);
      if (confirmedExisting) {
        return {
          ok: true,
          alreadyConfirmed: true,
          attribution: viewAttribution(confirmedExisting),
          reward: { granted: false, pending: "awaiting_qualifying_order", duplicate: true },
        };
      }
    }
  }
  if (!attr) throw httpError("没有待确认的邀请关系", 404, { code: "NO_PENDING" });
  if (String(attr.invitee_user_id) !== String(inviteeUserId)) {
    throw httpError("只能确认自己的邀请关系", 403, { code: "FORBIDDEN" });
  }
  if (String(attr.status) === "confirmed") {
    return {
      ok: true,
      alreadyConfirmed: true,
      attribution: viewAttribution(attr),
      reward: {
        granted: false,
        pending: attr.reward_granted ? null : "awaiting_qualifying_order",
        duplicate: true,
      },
    };
  }
  if (String(attr.status) !== "pending") {
    throw httpError("邀请状态不可确认：" + attr.status, 400, { code: "BAD_STATUS" });
  }

  let relationId = null;
  let relationResult = null;
  try {
    const existing = await getActiveRelationForCompanion(inviteeUserId);
    if (existing) {
      if (String(existing.boss_id) !== String(attr.inviter_user_id)) {
        throw httpError("你已有其他直属关系，无法确认此邀请", 409, {
          code: "ALREADY_BOUND_OTHER",
        });
      }
      relationId = existing.id;
    } else {
      relationResult = await bindRelation({
        bossId: attr.inviter_user_id,
        companionId: inviteeUserId,
        operatorId: inviteeUserId,
        remark: `invite_confirm:${attr.invite_code}`,
        reason: `invite_confirm:${attr.invite_code}`,
        commissionRate: null,
        skipCapabilityCheck: true,
      });
      relationId = relationResult?.relation?.id || null;
    }
  } catch (e) {
    if (e?.code === "ALREADY_BOUND" || e?.code === "ACTIVE_EXISTS") {
      const existing = await getActiveRelationForCompanion(inviteeUserId);
      if (existing && String(existing.boss_id) === String(attr.inviter_user_id)) {
        relationId = existing.id;
      } else {
        throw e;
      }
    } else if (isRelationsMissing(e) || isAttributionMissing(e)) {
      throw httpError("直属关系表未就绪", 503, { code: "TABLES_MISSING" });
    } else {
      throw e;
    }
  }

  const patched = await supabaseJson(
    restUrl(ATTR_TABLE, `?id=eq.${encodeURIComponent(attr.id)}`),
    {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        status: "confirmed",
        confirmed_at: nowIso(),
        relation_id: relationId,
        updated_at: nowIso(),
        detail: "confirmed_awaiting_qualifying_order",
      }),
    }
  );
  const confirmed = Array.isArray(patched)
    ? patched[0]
    : patched || { ...attr, status: "confirmed", relation_id: relationId };

  await insertAttrEvent(attr.id, "confirm", inviteeUserId, { relationId });

  if (attr.invite_link_id) {
    try {
      const links = await supabaseJson(
        restUrl(LINK_TABLE, `?id=eq.${encodeURIComponent(attr.invite_link_id)}&select=*&limit=1`),
        { headers: serviceHeaders() }
      );
      const link = links?.[0];
      if (link) {
        await supabaseJson(restUrl(LINK_TABLE, `?id=eq.${encodeURIComponent(link.id)}`), {
          method: "PATCH",
          headers: serviceHeaders({ Prefer: "return=minimal" }),
          body: JSON.stringify({
            use_count: Number(link.use_count || 0) + 1,
            updated_at: nowIso(),
          }),
        });
      }
    } catch (_) {
      /* soft */
    }
  }

  return {
    ok: true,
    alreadyConfirmed: false,
    attribution: viewAttribution(confirmed),
    relationId,
    reward: {
      granted: false,
      pending: "awaiting_qualifying_order",
      message: "绑定成功。邀请奖励将在被邀请方完成首笔真实有效订单且售后关闭、无退款后发放。",
    },
  };
}

export async function rejectInviteAttribution({ inviteeUserId, attributionId = "" } = {}) {
  if (!inviteeUserId) throw httpError("缺少用户", 401);
  let attr = null;
  if (attributionId) {
    const rows = await supabaseJson(
      restUrl(ATTR_TABLE, `?id=eq.${encodeURIComponent(attributionId)}&limit=1`),
      { headers: serviceHeaders() }
    );
    attr = rows?.[0] || null;
  } else {
    attr = await getPendingAttributionForInvitee(inviteeUserId);
  }
  if (!attr) throw httpError("没有待确认的邀请", 404);
  if (String(attr.invitee_user_id) !== String(inviteeUserId)) {
    throw httpError("只能拒绝自己的邀请关系", 403);
  }
  if (String(attr.status) !== "pending") {
    return { ok: true, attribution: viewAttribution(attr), already: true };
  }
  const patched = await supabaseJson(restUrl(ATTR_TABLE, `?id=eq.${encodeURIComponent(attr.id)}`), {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      status: "rejected",
      rejected_at: nowIso(),
      updated_at: nowIso(),
    }),
  });
  await insertAttrEvent(attr.id, "reject", inviteeUserId, {});
  return { ok: true, attribution: viewAttribution(Array.isArray(patched) ? patched[0] : patched) };
}
