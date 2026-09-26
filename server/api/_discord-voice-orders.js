/**
 * Order-scoped Discord voice room orchestration.
 * Never breaks paid/confirmed orders if Discord API fails.
 */
import {
  addMemberChannelPermission,
  addUserToGuild,
  avatarUrl,
  createChannelInvite,
  createPrivateVoiceChannel,
  deleteVoiceChannel,
  discordChannelUrl,
  discordConfigured,
  discordConfig,
  exchangeOAuthCode,
  fetchDiscordUser,
  oauthAuthorizeUrl,
  recommendedRedirectUri,
  removeMemberChannelPermission,
  safeChannelName,
} from "./_discord.js";

const VOICE_MODES = new Set(["game_mic", "discord", "none"]);

export function normalizeVoiceMode(raw) {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "discord" || v === "game_mic" || v === "none") return v;
  if (v === "game" || v === "mic" || v === "game-mic") return "game_mic";
  if (v === "chat" || v === "text" || v === "no_voice" || v === "novoice") return "none";
  return "game_mic";
}

/** New order create: only discord | game_mic (legacy "none" no longer selectable). */
export function normalizeVoiceModeForNewOrder(raw) {
  const m = normalizeVoiceMode(raw);
  return m === "discord" ? "discord" : "game_mic";
}

export function voiceModeLabel(mode) {
  const m = normalizeVoiceMode(mode);
  if (m === "discord") return "Discord语音房";
  // Legacy value kept for historical orders only (no longer selectable on new orders).
  if (m === "none") return "仅平台文字聊天";
  return "游戏麦";
}

function envUrl() {
  return String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
}
function envKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

function serviceHeaders(extra = {}) {
  const key = envKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}

function restUrl(table, query = "") {
  return `${envUrl()}/rest/v1/${table}${query}`;
}

async function supabaseJson(endpoint, opts = {}) {
  const response = await fetch(endpoint, opts);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw Object.assign(new Error(body?.message || text || `HTTP ${response.status}`), {
      status: response.status,
      body,
    });
  }
  return body;
}

async function patchOrder(orderId, patch) {
  const rows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify(patch),
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function getDiscordLink(userId) {
  if (!userId) return null;
  try {
    const rows = await supabaseJson(
      restUrl(
        "user_discord_links",
        `?user_id=eq.${encodeURIComponent(userId)}&select=user_id,discord_user_id,discord_username,discord_avatar,discord_connected_at,guild_joined_at&limit=1`
      ),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) ? rows[0] || null : null;
  } catch (err) {
    if (/relation|schema cache|PGRST|42P01/i.test(String(err?.message || ""))) return null;
    throw err;
  }
}

export async function upsertDiscordLink(userId, discordUser, { accessToken, refreshToken, expiresIn, guildJoined } = {}) {
  const discordUserId = String(discordUser?.id || "").trim();
  if (!userId || !discordUserId) throw new Error("missing user/discord ids");
  const username = String(discordUser.global_name || discordUser.username || "").trim();
  const avatar = avatarUrl(discordUserId, discordUser.avatar);
  const now = new Date().toISOString();
  const row = {
    user_id: userId,
    discord_user_id: discordUserId,
    discord_username: username,
    discord_avatar: avatar,
    discord_connected_at: now,
    updated_at: now,
  };
  if (guildJoined) row.guild_joined_at = now;
  // Do not store raw tokens in plaintext long-term in Phase 1 unless needed for guilds.join retry.
  // Keep expires marker only.
  if (expiresIn) {
    row.discord_token_expires_at = new Date(Date.now() + Number(expiresIn) * 1000).toISOString();
  }
  try {
    const rows = await supabaseJson(restUrl("user_discord_links"), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify(row),
    });
    return Array.isArray(rows) ? rows[0] : row;
  } catch (err) {
    // Fallback PATCH if upsert Prefer unsupported
    const rows = await supabaseJson(restUrl("user_discord_links", `?user_id=eq.${encodeURIComponent(userId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify(row),
    });
    if (Array.isArray(rows) && rows[0]) return rows[0];
    await supabaseJson(restUrl("user_discord_links"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify(row),
    });
    return row;
  }
}

export function buildOAuthStart({ userId, returnTo, stateExtra = {} }) {
  if (!discordConfigured()) {
    return {
      ok: false,
      code: "DISCORD_NOT_CONFIGURED",
      message: "Discord 尚未配置，请联系管理员设置环境变量。",
      redirectUriHint: recommendedRedirectUri(),
    };
  }
  const payload = {
    u: userId,
    r: returnTo || "/orders.html",
    t: Date.now(),
    ...stateExtra,
  };
  const state = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const url = oauthAuthorizeUrl({ state });
  return { ok: true, url, state, redirectUri: discordConfig().redirectUri || recommendedRedirectUri() };
}

export async function completeOAuthCallback({ code, state }) {
  if (!code) throw Object.assign(new Error("missing code"), { status: 400 });
  let payload = {};
  try {
    payload = JSON.parse(Buffer.from(String(state || ""), "base64url").toString("utf8"));
  } catch {
    throw Object.assign(new Error("invalid OAuth state"), { status: 400, code: "INVALID_STATE" });
  }
  const userId = String(payload.u || "").trim();
  if (!userId) throw Object.assign(new Error("OAuth state missing user"), { status: 400 });
  // CSRF/time window: 30 minutes
  if (payload.t && Date.now() - Number(payload.t) > 30 * 60 * 1000) {
    throw Object.assign(new Error("OAuth state expired"), { status: 400, code: "STATE_EXPIRED" });
  }
  const token = await exchangeOAuthCode(code);
  const discordUser = await fetchDiscordUser(token.access_token);
  let guildJoined = false;
  try {
    const join = await addUserToGuild({
      discordUserId: discordUser.id,
      accessToken: token.access_token,
    });
    guildJoined = !!join?.ok;
  } catch (err) {
    console.warn("[discord] guilds.join failed", String(err?.message || err).slice(0, 160));
  }
  const link = await upsertDiscordLink(userId, discordUser, {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresIn: token.expires_in,
    guildJoined,
  });
  let sync = null;
  try {
    sync = await syncBoundUserToOpenDiscordOrders(userId);
  } catch (err) {
    console.warn("[discord] sync after oauth", String(err?.message || err).slice(0, 160));
  }
  return {
    ok: true,
    userId,
    returnTo: String(payload.r || "/orders.html"),
    link,
    discordUserId: String(discordUser.id),
    sync,
  };
}

/** Resolve the order row that owns the Discord channel (parent for multi). */
export async function resolveVoiceOwnerOrder(order) {
  if (!order) return null;
  if (!order.parent_order_id) return order;
  try {
    const rows = await supabaseJson(
      restUrl("orders", `?id=eq.${encodeURIComponent(order.parent_order_id)}&limit=1`),
      { headers: serviceHeaders() }
    );
    return rows?.[0] || order;
  } catch {
    return order;
  }
}

function roomClosed(status) {
  const s = String(status || "").trim().toLowerCase();
  return s === "deleted" || s === "closed";
}

function inviteFromRow(row) {
  const url = String(row?.discord_invite_url || "").trim();
  if (url && /^https?:\/\/(discord\.gg|discord\.com\/invite)\//i.test(url)) return url;
  const code = String(row?.discord_invite_code || "").trim();
  if (code) return `https://discord.gg/${code}`;
  return "";
}

export function orderVoiceView(order, { discordLink = null, owner = null } = {}) {
  const src = owner || order || {};
  const mode = normalizeVoiceMode(src.voice_mode || order?.voice_mode);
  const channelId = String(src.discord_channel_id || order?.discord_channel_id || "").trim();
  const status = String(src.discord_channel_status || order?.discord_channel_status || "").trim();
  const closed = roomClosed(status);
  const inviteUrl = !closed ? inviteFromRow(src) || inviteFromRow(order) : "";
  const deepLink = !closed && channelId ? discordChannelUrl(channelId) : "";
  // Prefer real invite; deep link alone often fails for private rooms.
  const enterUrl = inviteUrl || deepLink || "";
  const bound = !!(discordLink && discordLink.discord_user_id);
  return {
    voiceMode: mode,
    voiceModeLabel: voiceModeLabel(mode),
    discordChannelId: channelId || null,
    discordChannelStatus: status || null,
    discordInviteUrl: inviteUrl || null,
    discord_invite_url: inviteUrl || null,
    discordInviteCode: String(src.discord_invite_code || order?.discord_invite_code || "").trim() || null,
    discordChannelUrl: enterUrl || null,
    discord_channel_url: enterUrl || null,
    discordDeepLink: deepLink || null,
    discordChannelCreatedAt: src.discord_channel_created_at || order?.discord_channel_created_at || null,
    discordBound: bound,
    discordUsername: discordLink?.discord_username || "",
    discordRequiresBind: mode === "discord" && !bound,
    discordRoomPending: mode === "discord" && !closed && !channelId && status !== "error",
    discordRoomError: mode === "discord" && status === "error",
    discordRoomClosed: mode === "discord" && closed,
    discordGuildId: discordConfig().guildId || null,
  };
}

async function patchOrderInviteFields(orderId, channelId, invite, { createdAt = null, mirrorParentId = null } = {}) {
  const now = createdAt || new Date().toISOString();
  const patchFull = {
    discord_channel_id: channelId,
    discord_channel_status: "ready",
    discord_channel_created_at: now,
    discord_invite_url: invite.url,
    discord_invite_code: invite.code,
  };
  const patchNoInvite = {
    discord_channel_id: channelId,
    discord_channel_status: "ready",
    discord_channel_created_at: now,
  };
  try {
    await patchOrder(orderId, patchFull);
  } catch (err) {
    const msg = String(err?.message || err || "");
    if (/discord_invite_|column|schema cache|PGRST/i.test(msg)) {
      await patchOrder(orderId, patchNoInvite);
    } else {
      throw err;
    }
  }
  const parentId = mirrorParentId || orderId;
  try {
    const childPatch = {
      discord_channel_id: channelId,
      discord_channel_status: "ready",
      discord_channel_created_at: now,
      voice_mode: "discord",
      discord_invite_url: invite.url,
      discord_invite_code: invite.code,
    };
    await supabaseJson(restUrl("orders", `?parent_order_id=eq.${encodeURIComponent(parentId)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify(childPatch),
    });
  } catch (err) {
    const msg = String(err?.message || err || "");
    if (/discord_invite_|column|schema cache|PGRST/i.test(msg)) {
      try {
        await supabaseJson(restUrl("orders", `?parent_order_id=eq.${encodeURIComponent(parentId)}`), {
          method: "PATCH",
          headers: serviceHeaders(),
          body: JSON.stringify({
            discord_channel_id: channelId,
            discord_channel_status: "ready",
            discord_channel_created_at: now,
            voice_mode: "discord",
          }),
        });
      } catch (_) {}
    }
  }
}

async function ensureInviteForOwner(owner) {
  const channelId = String(owner?.discord_channel_id || "").trim();
  if (!channelId) return { ok: false, reason: "no_channel" };
  if (roomClosed(owner.discord_channel_status)) {
    return { ok: false, reason: "closed", channelId };
  }
  const existing = inviteFromRow(owner);
  if (existing) {
    return {
      ok: true,
      reused: true,
      channelId,
      inviteUrl: existing,
      inviteCode: String(owner.discord_invite_code || "").trim() || null,
      channelUrl: existing,
    };
  }
  const invite = await createChannelInvite(channelId, { maxAge: 0, maxUses: 0, unique: true });
  try {
    await patchOrder(owner.id, {
      discord_invite_url: invite.url,
      discord_invite_code: invite.code,
      discord_channel_status: owner.discord_channel_status === "error" ? "ready" : owner.discord_channel_status || "ready",
    });
  } catch (err) {
    if (!/discord_invite_|column|schema cache|PGRST/i.test(String(err?.message || ""))) throw err;
  }
  if (!owner.parent_order_id) {
    try {
      await supabaseJson(restUrl("orders", `?parent_order_id=eq.${encodeURIComponent(owner.id)}`), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({
          discord_invite_url: invite.url,
          discord_invite_code: invite.code,
        }),
      });
    } catch (_) {}
  }
  return {
    ok: true,
    created: true,
    channelId,
    inviteUrl: invite.url,
    inviteCode: invite.code,
    channelUrl: invite.url,
  };
}

async function grantUserOnChannel(channelId, userId) {
  if (!channelId || !userId) return;
  const link = await getDiscordLink(userId);
  if (!link?.discord_user_id) return;
  await addMemberChannelPermission(channelId, link.discord_user_id);
}

async function collectCompanionDiscordIds(owner, companionUserId) {
  const ids = [];
  const pushLink = async (uid) => {
    if (!uid) return;
    try {
      const link = await getDiscordLink(uid);
      if (link?.discord_user_id) ids.push(link.discord_user_id);
    } catch (_) {}
  };
  if (companionUserId) await pushLink(companionUserId);
  if (owner?.companion_id && owner.companion_id !== companionUserId) await pushLink(owner.companion_id);
  if (!owner?.parent_order_id) {
    try {
      const kids = await supabaseJson(
        restUrl(
          "orders",
          `?parent_order_id=eq.${encodeURIComponent(owner.id)}&select=companion_id&companion_id=not.is.null&limit=40`
        ),
        { headers: serviceHeaders() }
      );
      for (const k of Array.isArray(kids) ? kids : []) {
        await pushLink(k.companion_id);
      }
    } catch (_) {}
  }
  return [...new Set(ids.map((x) => String(x)))];
}

/**
 * Create / reuse order Discord voice room + real invite (idempotent on parent/owner).
 * May run after payment (boss bound) or companion accept — never blocks payment path.
 */
export async function ensureOrderVoiceChannel(order, { companionUserId, bossUserId } = {}) {
  if (!order) return { ok: false, skipped: true, reason: "no_order" };
  const mode = normalizeVoiceMode(order.voice_mode);
  if (mode !== "discord") return { ok: true, skipped: true, reason: "not_discord" };
  if (!discordConfigured()) {
    return { ok: false, skipped: true, reason: "not_configured", code: "DISCORD_NOT_CONFIGURED" };
  }

  const owner = await resolveVoiceOwnerOrder(order);
  if (!owner?.id) return { ok: false, skipped: true, reason: "no_owner" };
  if (roomClosed(owner.discord_channel_status)) {
    return { ok: false, skipped: true, reason: "closed", code: "DISCORD_ROOM_CLOSED" };
  }

  // Idempotent: already have channel → grant late members + ensure invite
  if (owner.discord_channel_id) {
    try {
      if (companionUserId) await grantUserOnChannel(owner.discord_channel_id, companionUserId);
      const bossId = bossUserId || owner.boss_id || order.boss_id;
      if (bossId) await grantUserOnChannel(owner.discord_channel_id, bossId);
    } catch (err) {
      console.warn("[discord] grant on reuse", String(err?.message || err).slice(0, 160));
    }
    try {
      const inv = await ensureInviteForOwner(owner);
      return {
        ok: true,
        reused: true,
        channelId: owner.discord_channel_id,
        inviteUrl: inv.inviteUrl || inviteFromRow(owner) || null,
        inviteCode: inv.inviteCode || null,
        channelUrl: inv.inviteUrl || inviteFromRow(owner) || discordChannelUrl(owner.discord_channel_id),
      };
    } catch (err) {
      console.warn("[discord] ensure invite", String(err?.message || err).slice(0, 160));
      return {
        ok: true,
        reused: true,
        channelId: owner.discord_channel_id,
        inviteUrl: inviteFromRow(owner) || null,
        channelUrl: inviteFromRow(owner) || discordChannelUrl(owner.discord_channel_id),
        inviteWarning: err?.message || "invite_failed",
      };
    }
  }

  // Payment must be done (not awaiting_payment / cancelled)
  const paidOk = !["awaiting_payment", "cancelled"].includes(String(owner.status || ""));
  const childPaidOk = !["awaiting_payment", "cancelled"].includes(String(order.status || ""));
  if (!paidOk && !childPaidOk) {
    return { ok: true, skipped: true, reason: "not_paid" };
  }

  const bossId = bossUserId || owner.boss_id || order.boss_id;
  const bossLink = bossId ? await getDiscordLink(bossId) : null;
  const companionLink = companionUserId
    ? await getDiscordLink(companionUserId)
    : owner.companion_id
      ? await getDiscordLink(owner.companion_id)
      : order.companion_id
        ? await getDiscordLink(order.companion_id)
        : null;

  // Need at least one bound participant to create the private room.
  if (!bossLink?.discord_user_id && !companionLink?.discord_user_id) {
    return { ok: true, skipped: true, reason: "no_bound_participant" };
  }

  try {
    await patchOrder(owner.id, { discord_channel_status: "creating" });
  } catch (_) {}

  try {
    const fresh = await resolveVoiceOwnerOrder(owner);
    if (fresh?.discord_channel_id) {
      if (companionLink?.discord_user_id) {
        await addMemberChannelPermission(fresh.discord_channel_id, companionLink.discord_user_id);
      }
      if (bossLink?.discord_user_id) {
        await addMemberChannelPermission(fresh.discord_channel_id, bossLink.discord_user_id);
      }
      const inv = await ensureInviteForOwner(fresh);
      return {
        ok: true,
        reused: true,
        channelId: fresh.discord_channel_id,
        inviteUrl: inv.inviteUrl || inviteFromRow(fresh) || null,
        channelUrl: inv.inviteUrl || inviteFromRow(fresh) || discordChannelUrl(fresh.discord_channel_id),
      };
    }

    const companionIds = await collectCompanionDiscordIds(owner, companionUserId);
    if (companionLink?.discord_user_id && !companionIds.includes(companionLink.discord_user_id)) {
      companionIds.push(companionLink.discord_user_id);
    }

    const channel = await createPrivateVoiceChannel({
      orderNo: safeChannelName(owner.order_no || order.order_no || owner.id),
      bossDiscordUserId: bossLink?.discord_user_id || "",
      companionDiscordUserIds: companionIds,
    });
    const channelId = String(channel?.id || "");
    if (!channelId) throw new Error("Discord channel create returned empty id");

    const invite = await createChannelInvite(channelId, { maxAge: 0, maxUses: 0, unique: true });
    const now = new Date().toISOString();
    await patchOrderInviteFields(owner.id, channelId, invite, {
      createdAt: now,
      mirrorParentId: owner.parent_order_id ? null : owner.id,
    });

    return {
      ok: true,
      created: true,
      channelId,
      inviteUrl: invite.url,
      inviteCode: invite.code,
      channelUrl: invite.url,
    };
  } catch (err) {
    console.warn("[discord] create channel/invite failed", String(err?.message || err).slice(0, 200));
    try {
      await patchOrder(owner.id, { discord_channel_status: "error" });
    } catch (_) {}
    return {
      ok: false,
      error: true,
      message: "语音房创建失败，请稍后重试",
      detail: err?.message || "Discord channel create failed",
      code: err?.code || "DISCORD_CHANNEL_CREATE_FAILED",
    };
  }
}

/** Soft-fail wrapper for pay / CS confirm paths. */
export async function maybeEnsureDiscordAfterPaid(order, opts = {}) {
  try {
    if (!order || normalizeVoiceMode(order.voice_mode) !== "discord") {
      return { ok: true, skipped: true, reason: "not_discord" };
    }
    return await ensureOrderVoiceChannel(order, opts);
  } catch (err) {
    console.warn("[discord] after paid", String(err?.message || err).slice(0, 160));
    return { ok: false, error: true, message: err?.message || "discord_after_paid_failed" };
  }
}

/**
 * After OAuth bind: grant perms / create rooms for user's open Discord orders.
 */
export async function syncBoundUserToOpenDiscordOrders(userId) {
  if (!userId || !discordConfigured()) return { ok: true, skipped: true };
  const link = await getDiscordLink(userId);
  if (!link?.discord_user_id) return { ok: true, skipped: true, reason: "not_bound" };

  let asBoss = [];
  let asCompanion = [];
  try {
    asBoss = await supabaseJson(
      restUrl(
        "orders",
        `?boss_id=eq.${encodeURIComponent(userId)}&voice_mode=eq.discord&select=id,parent_order_id,boss_id,companion_id,status,voice_mode,discord_channel_id,discord_channel_status,discord_invite_url,discord_invite_code,order_no&status=not.in.(cancelled,completed,reviewed,refunded,fully_refunded)&limit=40`
      ),
      { headers: serviceHeaders() }
    );
  } catch (_) {}
  try {
    asCompanion = await supabaseJson(
      restUrl(
        "orders",
        `?companion_id=eq.${encodeURIComponent(userId)}&voice_mode=eq.discord&select=id,parent_order_id,boss_id,companion_id,status,voice_mode,discord_channel_id,discord_channel_status,discord_invite_url,discord_invite_code,order_no&status=not.in.(cancelled,completed,reviewed,refunded,fully_refunded)&limit=40`
      ),
      { headers: serviceHeaders() }
    );
  } catch (_) {}

  const list = [...(Array.isArray(asBoss) ? asBoss : []), ...(Array.isArray(asCompanion) ? asCompanion : [])];
  const seen = new Set();
  let ensured = 0;
  for (const row of list) {
    if (!row?.id || seen.has(row.id)) continue;
    if (roomClosed(row.discord_channel_status)) continue;
    if (String(row.status || "") === "awaiting_payment") continue;
    seen.add(row.id);
    const isCompanion = String(row.companion_id || "") === String(userId);
    const result = await ensureOrderVoiceChannel(row, {
      companionUserId: isCompanion ? userId : row.companion_id || undefined,
      bossUserId: row.boss_id,
    });
    if (result?.ok && !result.skipped) ensured += 1;
  }
  return { ok: true, scanned: seen.size, ensured };
}

export async function revokeCompanionVoiceAccess(order, companionUserId) {
  try {
    const owner = await resolveVoiceOwnerOrder(order);
    if (!owner?.discord_channel_id) return { ok: true, skipped: true };
    const link = await getDiscordLink(companionUserId);
    if (!link?.discord_user_id) return { ok: true, skipped: true };
    await removeMemberChannelPermission(owner.discord_channel_id, link.discord_user_id);
    return { ok: true };
  } catch (err) {
    console.warn("[discord] revoke access", String(err?.message || err).slice(0, 160));
    return { ok: false, message: err?.message };
  }
}

export async function grantCompanionVoiceAccess(order, companionUserId) {
  try {
    const owner = await resolveVoiceOwnerOrder(order);
    if (!owner?.discord_channel_id) {
      return ensureOrderVoiceChannel(order, { companionUserId });
    }
    const link = await getDiscordLink(companionUserId);
    if (!link?.discord_user_id) return { ok: true, skipped: true, reason: "not_bound" };
    await addMemberChannelPermission(owner.discord_channel_id, link.discord_user_id);
    return { ok: true, channelId: owner.discord_channel_id };
  } catch (err) {
    console.warn("[discord] grant access", String(err?.message || err).slice(0, 160));
    return { ok: false, message: err?.message };
  }
}

const TERMINAL = new Set(["completed", "cancelled", "reviewed", "refunded", "fully_refunded"]);

export async function cleanupExpiredDiscordChannels({ graceMinutes = 30, limit = 30 } = {}) {
  if (!discordConfigured()) return { ok: true, skipped: true, reason: "not_configured" };
  const graceIso = new Date(Date.now() - graceMinutes * 60 * 1000).toISOString();
  let rows = [];
  try {
    rows = await supabaseJson(
      restUrl(
        "orders",
        `?select=id,parent_order_id,status,discord_channel_id,discord_channel_status,created_at,order_no` +
          `&discord_channel_id=not.is.null` +
          `&or=(parent_order_id.is.null,order_type.eq.multi_group)` +
          `&created_at=lte.${encodeURIComponent(graceIso)}` +
          `&limit=${Math.max(1, Math.min(100, limit))}`
      ),
      { headers: serviceHeaders() }
    );
  } catch (err) {
    return { ok: false, message: err?.message };
  }
  const list = (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!r.discord_channel_id) return false;
    if (String(r.discord_channel_status || "") === "deleted") return false;
    return TERMINAL.has(String(r.status || "").toLowerCase());
  });
  let deleted = 0;
  let failed = 0;
  for (const row of list) {
    try {
      await deleteVoiceChannel(row.discord_channel_id);
      await patchOrder(row.id, {
        discord_channel_status: "deleted",
        discord_channel_deleted_at: new Date().toISOString(),
        discord_invite_url: null,
        discord_invite_code: null,
      });
      deleted += 1;
    } catch (err) {
      failed += 1;
      console.warn("[discord] cleanup", row.id, String(err?.message || err).slice(0, 120));
    }
  }
  return { ok: true, scanned: list.length, deleted, failed };
}

export { VOICE_MODES, discordConfigured, recommendedRedirectUri, discordChannelUrl, inviteFromRow };
