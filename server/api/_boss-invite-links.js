/**
 * Boss open invite links → redeem into existing boss_companion_relations.
 * Does not change bind/rebind/unbind logic; calls bindRelation as-is.
 * Does not use boss_companion_invitations.
 */
import crypto from "node:crypto";
import {
  bindRelation,
  getActiveRelationForCompanion,
  isRelationsMissing,
} from "./_boss-companion-relations.js";
import { isBossInviteLinksEnabled, bossInviteLinksDisabledReason } from "./_feature-flags.js";
import { isMissingRelation, restUrl, serviceHeaders, supabaseJson } from "./_wallet.js";

const LINK_TABLE = "boss_invite_links";
const REDEEM_TABLE = "boss_invite_redemptions";

function httpError(message, status = 400, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function nowIso() {
  return new Date().toISOString();
}

export function inviteLinksDisabledPayload() {
  return {
    ok: false,
    code: "BOSS_INVITE_LINKS_DISABLED",
    message: "老板邀请链接功能尚未开通",
    reason: bossInviteLinksDisabledReason(),
  };
}

export function assertInviteLinksEnabled() {
  if (!isBossInviteLinksEnabled()) {
    throw httpError("老板邀请链接功能尚未开通", 503, {
      code: "BOSS_INVITE_LINKS_DISABLED",
      reason: bossInviteLinksDisabledReason(),
    });
  }
}

export function isInviteLinksMissing(error) {
  return isMissingRelation(error) || isRelationsMissing(error);
}

export function generateInviteCode() {
  return crypto.randomBytes(18).toString("base64url");
}

export function publicInviteUrl(code, base = "") {
  const root = String(base || process.env.MCJ_PUBLIC_BASE || "https://www.meowcuijiao.com").replace(/\/+$/, "");
  return `${root}/invite.html?code=${encodeURIComponent(code)}`;
}

export function viewInviteLink(row = {}) {
  const code = String(row.code || "");
  return {
    id: row.id || "",
    code,
    bossId: row.boss_id || "",
    status: row.status || "",
    maxUses: row.max_uses == null ? null : Number(row.max_uses),
    useCount: Number(row.use_count || 0),
    expiresAt: row.expires_at || null,
    label: row.label || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    revokedAt: row.revoked_at || null,
    url: code ? publicInviteUrl(code) : "",
  };
}

async function loadLinkByCode(code) {
  const c = String(code || "").trim();
  if (!c) return null;
  const rows = await supabaseJson(
    restUrl(LINK_TABLE, `?code=eq.${encodeURIComponent(c)}&select=*&limit=1`),
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function loadLinkById(id) {
  const rows = await supabaseJson(
    restUrl(LINK_TABLE, `?id=eq.${encodeURIComponent(id)}&select=*&limit=1`),
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

function linkValidity(link) {
  if (!link) return { ok: false, reason: "not_found" };
  if (String(link.status) !== "active") return { ok: false, reason: "inactive" };
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  const max = link.max_uses == null ? null : Number(link.max_uses);
  const used = Number(link.use_count || 0);
  if (max != null && Number.isFinite(max) && used >= max) {
    return { ok: false, reason: "exhausted" };
  }
  return { ok: true, reason: "" };
}

export async function createBossInviteLink({
  bossId,
  maxUses = null,
  expiresInDays = null,
  label = "",
} = {}) {
  assertInviteLinksEnabled();
  if (!bossId) throw httpError("缺少老板账号", 400);
  const code = generateInviteCode();
  let expiresAt = null;
  const days = Number(expiresInDays);
  if (Number.isFinite(days) && days > 0) {
    expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  }
  let max = null;
  if (maxUses != null && maxUses !== "") {
    max = Math.max(1, Math.floor(Number(maxUses)));
    if (!Number.isFinite(max)) max = null;
  }
  const payload = {
    code,
    boss_id: bossId,
    status: "active",
    max_uses: max,
    use_count: 0,
    expires_at: expiresAt,
    label: String(label || "").trim() || null,
  };
  try {
    const rows = await supabaseJson(restUrl(LINK_TABLE), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(payload),
    });
    const created = Array.isArray(rows) ? rows[0] : rows;
    return viewInviteLink(created);
  } catch (error) {
    if (isInviteLinksMissing(error)) {
      throw httpError("邀请链接表尚未初始化", 503, { code: "INVITE_TABLES_MISSING" });
    }
    throw error;
  }
}

export async function listBossInviteLinks(bossId, { limit = 50 } = {}) {
  assertInviteLinksEnabled();
  if (!bossId) return [];
  try {
    const rows = await supabaseJson(
      restUrl(
        LINK_TABLE,
        `?boss_id=eq.${encodeURIComponent(bossId)}&order=created_at.desc&limit=${Math.min(100, Math.max(1, Number(limit) || 50))}`
      ),
      { headers: serviceHeaders() }
    );
    return (Array.isArray(rows) ? rows : []).map(viewInviteLink);
  } catch (error) {
    if (isInviteLinksMissing(error)) {
      throw httpError("邀请链接表尚未初始化", 503, { code: "INVITE_TABLES_MISSING" });
    }
    throw error;
  }
}

export async function revokeBossInviteLink({ bossId, linkId } = {}) {
  assertInviteLinksEnabled();
  const link = await loadLinkById(linkId);
  if (!link) throw httpError("邀请链接不存在", 404);
  if (String(link.boss_id) !== String(bossId)) {
    throw httpError("无权撤销其他老板的邀请链接", 403, { code: "FORBIDDEN_OTHER_BOSS" });
  }
  if (String(link.status) === "revoked") return viewInviteLink(link);
  const rows = await supabaseJson(restUrl(LINK_TABLE, `?id=eq.${encodeURIComponent(link.id)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ status: "revoked", revoked_at: nowIso() }),
  });
  const updated = Array.isArray(rows) ? rows[0] : rows;
  return viewInviteLink(updated || { ...link, status: "revoked", revoked_at: nowIso() });
}

export async function resolveBossInviteLink(code) {
  assertInviteLinksEnabled();
  let link;
  try {
    link = await loadLinkByCode(code);
  } catch (error) {
    if (isInviteLinksMissing(error)) {
      throw httpError("邀请链接表尚未初始化", 503, { code: "INVITE_TABLES_MISSING" });
    }
    throw error;
  }
  const validity = linkValidity(link);
  if (!validity.ok) {
    throw httpError("邀请链接无效或已失效", 404, {
      code: "INVITE_INVALID",
      reason: validity.reason,
    });
  }

  let bossName = "";
  let bossCode = "";
  try {
    const profiles = await supabaseJson(
      restUrl("profiles", `?id=eq.${encodeURIComponent(link.boss_id)}&select=id,display_name,boss_uid&limit=1`),
      { headers: serviceHeaders() }
    );
    const boss = Array.isArray(profiles) ? profiles[0] : null;
    bossName = String(boss?.display_name || "").trim();
    bossCode = String(boss?.boss_uid || "").trim();
  } catch {
    /* preview optional */
  }

  return {
    ok: true,
    code: link.code,
    bossId: link.boss_id,
    bossDisplayName: bossName || "老板",
    bossPublicCode: bossCode,
    expiresAt: link.expires_at || null,
    remainingUses:
      link.max_uses == null ? null : Math.max(0, Number(link.max_uses) - Number(link.use_count || 0)),
  };
}

async function insertRedemption(row) {
  try {
    await supabaseJson(restUrl(REDEEM_TABLE), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(row),
    });
  } catch (error) {
    // Unique (link, invitee) — treat as already recorded
    if (/duplicate|unique|uq_boss_invite_redemptions/i.test(String(error?.message || ""))) {
      return { duplicate: true };
    }
    throw error;
  }
  return { duplicate: false };
}

async function bumpUseCount(link) {
  const next = Number(link.use_count || 0) + 1;
  const max = link.max_uses == null ? null : Number(link.max_uses);
  const patch = { use_count: next };
  if (max != null && Number.isFinite(max) && next >= max) {
    patch.status = "exhausted";
  }
  await supabaseJson(restUrl(LINK_TABLE, `?id=eq.${encodeURIComponent(link.id)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify(patch),
  });
}

/**
 * After companion auth+profile+capability succeed: bind via existing bindRelation.
 * Never throws to fail registration — returns outcome summary.
 */
export async function redeemInviteAfterCompanionReady({
  inviteCode,
  inviteeId,
} = {}) {
  const code = String(inviteCode || "").trim();
  if (!code || !inviteeId) {
    return { attempted: false, outcome: null };
  }
  if (!isBossInviteLinksEnabled()) {
    return { attempted: false, outcome: "flag_disabled" };
  }

  let link;
  try {
    link = await loadLinkByCode(code);
  } catch (error) {
    if (isInviteLinksMissing(error)) {
      return { attempted: true, outcome: "skipped_invalid", detail: "tables_missing" };
    }
    return { attempted: true, outcome: "error", detail: error.message || "load_failed" };
  }

  const validity = linkValidity(link);
  if (!validity.ok) {
    if (link?.id) {
      await insertRedemption({
        invite_link_id: link.id,
        code: link.code || code,
        boss_id: link.boss_id,
        invitee_id: inviteeId,
        relation_id: null,
        outcome: "skipped_invalid",
        detail: validity.reason || "invalid",
      }).catch(() => {});
    }
    return { attempted: true, outcome: "skipped_invalid", detail: validity.reason || "not_found" };
  }

  try {
    const existing = await getActiveRelationForCompanion(inviteeId);
    if (existing) {
      await insertRedemption({
        invite_link_id: link.id,
        code: link.code,
        boss_id: link.boss_id,
        invitee_id: inviteeId,
        relation_id: existing.id || null,
        outcome: "skipped_already_bound",
        detail:
          existing.boss_id === link.boss_id ? "already_bound_same_boss" : "already_bound_other_boss",
      });
      return {
        attempted: true,
        outcome: "skipped_already_bound",
        relationId: existing.id || null,
        bossId: existing.boss_id,
      };
    }
  } catch (error) {
    if (isRelationsMissing(error)) {
      return { attempted: true, outcome: "error", detail: "relations_missing" };
    }
  }

  const audit = `invite_link:${link.code}`;
  try {
    const result = await bindRelation({
      bossId: link.boss_id,
      companionId: inviteeId,
      operatorId: inviteeId,
      remark: audit,
      reason: audit,
      commissionRate: null,
    });
    const relationId = result?.relation?.id || null;
    await insertRedemption({
      invite_link_id: link.id,
      code: link.code,
      boss_id: link.boss_id,
      invitee_id: inviteeId,
      relation_id: relationId,
      outcome: "bound",
      detail: null,
    });
    await bumpUseCount(link).catch(() => {});
    return {
      attempted: true,
      outcome: "bound",
      relationId,
      bossId: link.boss_id,
    };
  } catch (error) {
    const codeName = error?.code || "";
    if (codeName === "ALREADY_BOUND" || codeName === "ACTIVE_EXISTS") {
      let relationId = error.activeRelationId || null;
      try {
        const existing = await getActiveRelationForCompanion(inviteeId);
        relationId = existing?.id || relationId;
      } catch {
        /* ignore */
      }
      await insertRedemption({
        invite_link_id: link.id,
        code: link.code,
        boss_id: link.boss_id,
        invitee_id: inviteeId,
        relation_id: relationId,
        outcome: "skipped_already_bound",
        detail: codeName,
      }).catch(() => {});
      return { attempted: true, outcome: "skipped_already_bound", relationId };
    }
    await insertRedemption({
      invite_link_id: link.id,
      code: link.code,
      boss_id: link.boss_id,
      invitee_id: inviteeId,
      relation_id: null,
      outcome: "error",
      detail: String(error?.message || codeName || "bind_failed").slice(0, 500),
    }).catch(() => {});
    return { attempted: true, outcome: "error", detail: error?.message || "bind_failed" };
  }
}
