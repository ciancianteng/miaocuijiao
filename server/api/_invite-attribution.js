/**
 * Invite attribution + confirm-before-bind + one-time invite rewards.
 *
 * ACTIVE ops relation SoT remains boss_companion_relations (#185).
 * This module records pending attribution until invitee confirms.
 *
 * Rewards (inviter_role decides — never invitee):
 *   boss inviter     → meow coin / bonus catfood (invite_reward, non-withdrawable)
 *   companion inviter → invite_cash_wallets (withdrawable cash; wallet pattern from #134)
 *
 * Orthogonal to boss_commission_earnings (platform-fee ops commission).
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

/**
 * Record pending attribution from invite code. Does NOT create active relation.
 * Idempotent per invitee pending row.
 */
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
    return { attempted: true, outcome: "skipped_invalid", detail: "bad_inviter" };
  }

  // Already confirmed forever — do not create another pending / active.
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

  // Ops relation already active for this invitee-as-companion → block silently.
  try {
    const existingRel = await getActiveRelationForCompanion(inviteeUserId);
    if (existingRel) {
      return {
        attempted: true,
        outcome: "skipped_already_bound",
        detail:
          existingRel.boss_id === inviterId ? "already_bound_same" : "already_bound_other",
        relationId: existingRel.id || null,
      };
    }
  } catch (e) {
    if (!isRelationsMissing(e)) throw e;
  }

  const pending = await getPendingAttributionForInvitee(inviteeUserId);
  if (pending) {
    if (String(pending.inviter_user_id) === inviterId && String(pending.invite_code) === code) {
      return { attempted: true, outcome: "pending_confirm", attribution: viewAttribution(pending) };
    }
    // Supersede older pending from a different link.
    await supabaseJson(
      restUrl(ATTR_TABLE, `?id=eq.${encodeURIComponent(pending.id)}`),
      {
        method: "PATCH",
        headers: serviceHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({ status: "superseded", detail: "superseded_by_new_invite", updated_at: nowIso() }),
      }
    );
    await insertAttrEvent(pending.id, "supersede", inviteeUserId, { byCode: code });
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
        detail: null,
      }),
    });
    created = Array.isArray(rows) ? rows[0] : rows;
  } catch (e) {
    if (isAttributionMissing(e)) {
      return { attempted: true, outcome: "error", detail: "tables_missing" };
    }
    // Unique pending race — reload
    const again = await getPendingAttributionForInvitee(inviteeUserId);
    if (again) {
      return { attempted: true, outcome: "pending_confirm", attribution: viewAttribution(again) };
    }
    throw e;
  }

  await insertAttrEvent(created.id, "recognized", inviteeUserId, {
    inviteCode: code,
    inviterRole,
  });

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

/**
 * Grant one-time invite reward. Idempotent on attribution_id.
 */
export async function grantInviteRewardForAttribution(attribution) {
  if (!attribution?.id) return { granted: false, reason: "missing_attribution" };
  if (attribution.reward_granted) {
    return { granted: false, reason: "already_granted", duplicate: true };
  }

  const inviterRole = String(attribution.inviter_role || "");
  const inviterId = attribution.inviter_user_id;
  const inviteeId = attribution.invitee_user_id;
  const idempotencyKey = `invite_reward:${attribution.id}`;

  // Existing ledger row?
  try {
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

  let rewardType;
  let amount;
  let withdrawable;
  let currency;
  if (inviterRole === "companion") {
    rewardType = "cash";
    amount = money(DEFAULT_COMPANION_INVITE_CASH);
    withdrawable = true;
    currency = "CASH";
  } else {
    rewardType = "meow_coin";
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
        meta: { source: "invite_confirm" },
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

  // Credit destination
  if (rewardType === "meow_coin") {
    await creditWallet({
      bossId: inviterId,
      transactionType: "invite_reward",
      amount,
      balanceType: "bonus",
      idempotencyKey,
      reason: "邀请确认奖励（喵币/赠送猫粮，不可提现）",
      internalNote: `invite_attr:${attribution.id}`,
      operatorId: inviteeId,
    });
  } else {
    const wallet = await ensureInviteCashWallet(inviterId);
    const nextAvailable = money(wallet.available_amount) + amount;
    const nextEarned = money(wallet.total_earned) + amount;
    await supabaseJson(restUrl(CASH_WALLET_TABLE, `?user_id=eq.${encodeURIComponent(inviterId)}`), {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        available_amount: nextAvailable,
        total_earned: nextEarned,
        updated_at: nowIso(),
      }),
    });
  }

  await supabaseJson(restUrl(ATTR_TABLE, `?id=eq.${encodeURIComponent(attribution.id)}`), {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({
      reward_granted: true,
      reward_ledger_id: ledgerRow?.id || null,
      updated_at: nowIso(),
    }),
  });
  await insertAttrEvent(attribution.id, "reward_granted", inviterId, {
    rewardType,
    amount,
    withdrawable,
  });

  return {
    granted: true,
    rewardType,
    amount,
    withdrawable,
    currency,
    ledger: ledgerRow,
  };
}

/**
 * Invitee confirms pending attribution → active relation + reward.
 * Ordinary users cannot rebind/unbind afterward (admin APIs still can).
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
      reward: { granted: false, duplicate: true },
    };
  }
  if (String(attr.status) !== "pending") {
    throw httpError("邀请状态不可确认：" + attr.status, 400, { code: "BAD_STATUS" });
  }

  // Create/ensure active relation: beneficiary=inviter, target=invitee (#185 SoT columns).
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
        // Invite confirm may bind before full companion capability; allow when inviter is boss
        // and invitee will be treated as target. For companion inviter, still write SoT row.
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
      }),
    }
  );
  const confirmed = Array.isArray(patched) ? patched[0] : patched || { ...attr, status: "confirmed", relation_id: relationId };

  await insertAttrEvent(attr.id, "confirm", inviteeUserId, { relationId });

  // Bump invite link use_count once on confirm (not on recognize).
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

  const reward = await grantInviteRewardForAttribution(confirmed);

  return {
    ok: true,
    alreadyConfirmed: false,
    attribution: viewAttribution(confirmed),
    relationId,
    reward,
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
  if (String(attr.invitee_user_id) !== String(inviteeUserId)) throw httpError("禁止", 403);
  if (String(attr.status) !== "pending") throw httpError("状态不可拒绝", 400);

  await supabaseJson(restUrl(ATTR_TABLE, `?id=eq.${encodeURIComponent(attr.id)}`), {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({ status: "rejected", rejected_at: nowIso(), updated_at: nowIso() }),
  });
  await insertAttrEvent(attr.id, "reject", inviteeUserId, {});
  return { ok: true };
}
