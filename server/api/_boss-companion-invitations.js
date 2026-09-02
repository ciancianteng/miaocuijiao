/**
 * Boss ↔ Companion invitations (both directions).
 * Accept creates relation via bindRelation (Admin-path not required; invite accept is party action).
 * One active Boss per companion still enforced by relations unique index.
 */
import {
  bindRelation,
  getActiveRelationForCompanion,
  isRelationsMissing,
} from "./_boss-companion-relations.js";
import { isReferralMissing, upsertCompanionBossReferral } from "./_companion-referral.js";
import { isMissingRelation, restUrl, serviceHeaders, supabaseJson } from "./_wallet.js";

const TABLE = "boss_companion_invitations";

function nowIso() {
  return new Date().toISOString();
}
function httpError(message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

export function viewInvitation(row = {}) {
  return {
    id: row.id || "",
    fromRole: row.from_role || "",
    bossId: row.boss_id || "",
    companionId: row.companion_id || "",
    status: row.status || "",
    message: row.message || "",
    expiresAt: row.expires_at || "",
    respondedAt: row.responded_at || null,
    relationId: row.relation_id || null,
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

export async function createInvitation({
  fromRole,
  bossId,
  companionId,
  message = "",
  expiresAt = null,
} = {}) {
  if (!["boss", "companion"].includes(fromRole)) throw httpError("fromRole 无效", 400);
  if (!bossId || !companionId) throw httpError("缺少 bossId/companionId", 400);
  if (bossId === companionId) throw httpError("不能邀请自己", 400);

  const active = await getActiveRelationForCompanion(companionId).catch((err) => {
    if (isRelationsMissing(err) || isMissingRelation(err)) return null;
    throw err;
  });
  if (active && active.boss_id !== bossId) {
    throw httpError("该陪玩已有其他生效中的直属老板，无法发起邀请", 409, {
      code: "COMPANION_HAS_ACTIVE_BOSS",
      activeBossId: active.boss_id,
    });
  }
  if (active && active.boss_id === bossId) {
    throw httpError("双方已是生效直属关系", 409, { code: "ALREADY_BOUND" });
  }

  const payload = {
    from_role: fromRole,
    boss_id: bossId,
    companion_id: companionId,
    status: "pending",
    message: String(message || "").trim() || null,
    expires_at: expiresAt || new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  try {
    const rows = await supabaseJson(restUrl(TABLE), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify(payload),
    });
    return viewInvitation(Array.isArray(rows) ? rows[0] : rows);
  } catch (error) {
    if (/uq_bci_pending|duplicate|23505/i.test(String(error?.message || ""))) {
      throw httpError("已有待处理邀请", 409, { code: "PENDING_EXISTS" });
    }
    if (isMissingRelation(error)) throw httpError("邀请表未初始化", 503, { code: "INVITES_MISSING" });
    throw error;
  }
}

export async function listInvitationsForUser({ userId, roleHint = "" } = {}) {
  if (!userId) return [];
  const parts = ["select=*", "order=created_at.desc", "limit=50"];
  if (roleHint === "boss") parts.push(`boss_id=eq.${encodeURIComponent(userId)}`);
  else if (roleHint === "companion") parts.push(`companion_id=eq.${encodeURIComponent(userId)}`);
  else {
    // OR filter via two queries
    const [a, b] = await Promise.all([
      supabaseJson(restUrl(TABLE, `?select=*&boss_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=50`), {
        headers: serviceHeaders(),
      }).catch(() => []),
      supabaseJson(
        restUrl(TABLE, `?select=*&companion_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=50`),
        { headers: serviceHeaders() }
      ).catch(() => []),
    ]);
    const map = new Map();
    for (const row of [...(a || []), ...(b || [])]) map.set(row.id, row);
    return [...map.values()].map(viewInvitation);
  }
  const rows = await supabaseJson(restUrl(TABLE, `?${parts.join("&")}`), {
    headers: serviceHeaders(),
  });
  return (Array.isArray(rows) ? rows : []).map(viewInvitation);
}

export async function respondInvitation({
  invitationId,
  actorId,
  actorRole,
  accept,
} = {}) {
  if (!invitationId || !actorId) throw httpError("缺少参数", 400);
  const rows = await supabaseJson(
    restUrl(TABLE, `?id=eq.${encodeURIComponent(invitationId)}&limit=1`),
    { headers: serviceHeaders() }
  );
  const inv = rows?.[0];
  if (!inv) throw httpError("邀请不存在", 404);
  if (inv.status !== "pending") throw httpError("邀请已处理", 409);
  if (inv.expires_at && Date.parse(inv.expires_at) < Date.now()) {
    await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(invitationId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ status: "expired", updated_at: nowIso() }),
    });
    throw httpError("邀请已过期", 410);
  }

  // Only the counterparty accepts/rejects
  if (inv.from_role === "boss") {
    if (actorRole !== "companion" || actorId !== inv.companion_id) {
      throw httpError("仅被邀请陪玩可处理", 403);
    }
  } else {
    if (actorRole !== "boss" || actorId !== inv.boss_id) {
      throw httpError("仅被邀请老板可处理", 403);
    }
  }

  if (!accept) {
    const updated = await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(invitationId)}`), {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({ status: "rejected", responded_at: nowIso(), updated_at: nowIso() }),
    });
    return { invitation: viewInvitation(Array.isArray(updated) ? updated[0] : updated), relation: null };
  }

  // Companion → Boss invite: referral graph is independent of 直属 BCR.
  // Upsert referral first so rebate binding succeeds even if BCR bind is blocked.
  let referral = null;
  if (inv.from_role === "companion") {
    try {
      referral = await upsertCompanionBossReferral({
        companionId: inv.companion_id,
        bossId: inv.boss_id,
        invitationId,
        remark: `invite_accepted:${invitationId}`,
        boundByAdmin: false,
      });
    } catch (err) {
      if (!isReferralMissing(err)) {
        referral = { error: err.message || "referral_upsert_failed" };
      } else {
        referral = { skipped: true, reason: "tables_missing" };
      }
    }
  }

  // Accept → BCR bind (直属). Soft-fail when companion already has another Boss —
  // referral may still have been established above.
  let bind = null;
  let bindWarning = null;
  try {
    bind = await bindRelation({
      bossId: inv.boss_id,
      companionId: inv.companion_id,
      operatorId: actorId,
      remark: `invite:${invitationId}`,
      reason: `invite_accepted:${inv.from_role}`,
    });
  } catch (err) {
    if (inv.from_role === "companion" && referral && !referral.error && !referral.skipped) {
      bindWarning = err.message || "bcr_bind_failed";
    } else {
      throw err;
    }
  }

  const updated = await supabaseJson(restUrl(TABLE, `?id=eq.${encodeURIComponent(invitationId)}`), {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      status: "accepted",
      responded_at: nowIso(),
      relation_id: bind?.relation?.id || bind?.id || null,
      updated_at: nowIso(),
    }),
  });

  return {
    invitation: viewInvitation(Array.isArray(updated) ? updated[0] : updated),
    relation: bind?.relation || bind || null,
    referral,
    bindWarning,
  };
}

export { TABLE };
