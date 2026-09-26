/**
 * Discord API helpers (server-side only).
 * Secrets must come from env — never import into frontend bundles.
 */
const API = "https://discord.com/api/v10";

const PERM = {
  VIEW_CHANNEL: 1n << 10n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
};

function env(name, fallback = "") {
  return String(process.env[name] || fallback || "").trim();
}

export function discordConfig() {
  return {
    clientId: env("DISCORD_CLIENT_ID"),
    clientSecret: env("DISCORD_CLIENT_SECRET"),
    botToken: env("DISCORD_BOT_TOKEN"),
    guildId: env("DISCORD_GUILD_ID"),
    categoryId: env("DISCORD_ORDER_CATEGORY_ID"),
    redirectUri: env("DISCORD_REDIRECT_URI"),
  };
}

export function discordConfigured() {
  const c = discordConfig();
  return !!(c.clientId && c.clientSecret && c.botToken && c.guildId && c.categoryId && c.redirectUri);
}

export function publicSiteOrigin() {
  return (
    env("PUBLIC_SITE_URL") ||
    env("SITE_URL") ||
    env("APP_URL") ||
    env("MCJ_PUBLIC_BASE") ||
    "https://www.meowcuijiao.com"
  ).replace(/\/$/, "");
}

export function recommendedRedirectUri() {
  return `${publicSiteOrigin()}/api/discord/oauth-callback`;
}

function botHeaders() {
  const token = discordConfig().botToken;
  if (!token) throw Object.assign(new Error("DISCORD_BOT_TOKEN missing"), { code: "DISCORD_NOT_CONFIGURED" });
  return {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
  };
}

async function discordFetch(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), ...(init.bot === false ? {} : botHeaders()) },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    const msg = body?.message || text || `Discord HTTP ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status, body, code: "DISCORD_API_ERROR" });
  }
  return body;
}

export function oauthAuthorizeUrl({ state, redirectUri }) {
  const c = discordConfig();
  if (!c.clientId) throw Object.assign(new Error("DISCORD_CLIENT_ID missing"), { code: "DISCORD_NOT_CONFIGURED" });
  const uri = redirectUri || c.redirectUri || recommendedRedirectUri();
  const params = new URLSearchParams({
    client_id: c.clientId,
    response_type: "code",
    redirect_uri: uri,
    scope: "identify guilds.join",
    state: String(state || ""),
    prompt: "consent",
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

export async function exchangeOAuthCode(code, redirectUri) {
  const c = discordConfig();
  if (!c.clientId || !c.clientSecret) {
    throw Object.assign(new Error("Discord OAuth not configured"), { code: "DISCORD_NOT_CONFIGURED" });
  }
  const uri = redirectUri || c.redirectUri || recommendedRedirectUri();
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: "authorization_code",
    code: String(code || ""),
    redirect_uri: uri,
  });
  const res = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw Object.assign(new Error(json?.error_description || json?.error || text || "OAuth exchange failed"), {
      status: res.status,
      body: json,
      code: "DISCORD_OAUTH_EXCHANGE_FAILED",
    });
  }
  return json;
}

export async function fetchDiscordUser(accessToken) {
  const res = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw Object.assign(new Error(json?.message || text || "Failed to fetch Discord user"), {
      status: res.status,
      body: json,
    });
  }
  return json;
}

export async function addUserToGuild({ discordUserId, accessToken }) {
  const c = discordConfig();
  if (!c.guildId) throw Object.assign(new Error("DISCORD_GUILD_ID missing"), { code: "DISCORD_NOT_CONFIGURED" });
  try {
    await discordFetch(`/guilds/${c.guildId}/members/${encodeURIComponent(discordUserId)}`, {
      method: "PUT",
      body: JSON.stringify({ access_token: accessToken }),
    });
    return { ok: true, joined: true };
  } catch (err) {
    // Already a member → Discord returns 204/OK or conflict; treat 204 as success above.
    if (err?.status === 204 || err?.status === 201) return { ok: true, joined: true };
    // 400 / already member variants
    const msg = String(err?.message || "");
    if (/already|member/i.test(msg) || err?.status === 400) return { ok: true, joined: false, already: true };
    throw err;
  }
}

function allowVoiceOverwrite(discordUserId) {
  const allow = (PERM.VIEW_CHANNEL | PERM.CONNECT | PERM.SPEAK).toString();
  return {
    id: String(discordUserId),
    type: 1, // member
    allow,
    deny: "0",
  };
}

function everyoneDenyOverwrite(guildId) {
  const deny = (PERM.VIEW_CHANNEL | PERM.CONNECT).toString();
  return {
    id: String(guildId),
    type: 0, // role (@everyone = guild id)
    allow: "0",
    deny,
  };
}

/** Safe channel name: order number only — no PII. */
export function safeChannelName(orderNo) {
  const raw = String(orderNo || "ORDER").trim().toUpperCase();
  const cleaned = raw.replace(/[^A-Z0-9-]/g, "").slice(0, 80);
  return cleaned || "ORDER";
}

export function discordChannelUrl(channelId) {
  const guildId = discordConfig().guildId;
  if (!guildId || !channelId) return "";
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

export function discordInviteUrlFromCode(code) {
  const c = String(code || "").trim();
  if (!c) return "";
  return `https://discord.gg/${c}`;
}

/**
 * Create a real Discord invite for a voice channel (usable join link).
 * max_age=0 / max_uses=0 → never expire / unlimited uses (order-scoped room).
 */
export async function createChannelInvite(channelId, { maxAge = 0, maxUses = 0, unique = true } = {}) {
  if (!channelId) throw Object.assign(new Error("missing channelId"), { code: "DISCORD_INVITE_FAILED" });
  const invite = await discordFetch(`/channels/${encodeURIComponent(channelId)}/invites`, {
    method: "POST",
    body: JSON.stringify({
      max_age: Math.max(0, Number(maxAge) || 0),
      max_uses: Math.max(0, Number(maxUses) || 0),
      unique: !!unique,
    }),
  });
  const code = String(invite?.code || "").trim();
  if (!code) {
    throw Object.assign(new Error("Discord invite create returned empty code"), {
      code: "DISCORD_INVITE_FAILED",
      body: invite,
    });
  }
  return {
    code,
    url: discordInviteUrlFromCode(code),
    invite,
  };
}

/**
 * Create a private voice channel under the order category.
 * Permission overwrites on the channel itself (not only category).
 */
export async function createPrivateVoiceChannel({ orderNo, bossDiscordUserId, companionDiscordUserIds = [] }) {
  const c = discordConfig();
  if (!c.guildId || !c.categoryId) {
    throw Object.assign(new Error("Discord guild/category not configured"), { code: "DISCORD_NOT_CONFIGURED" });
  }
  const cleaned = safeChannelName(orderNo);
  const name = cleaned.startsWith("ORDER-") ? cleaned.slice(0, 90) : `order-${cleaned}`.slice(0, 90);
  const permission_overwrites = [everyoneDenyOverwrite(c.guildId)];
  if (bossDiscordUserId) permission_overwrites.push(allowVoiceOverwrite(bossDiscordUserId));
  const seen = new Set();
  for (const id of companionDiscordUserIds || []) {
    const d = String(id || "").trim();
    if (!d || seen.has(d) || d === String(bossDiscordUserId || "")) continue;
    seen.add(d);
    permission_overwrites.push(allowVoiceOverwrite(d));
  }
  const channel = await discordFetch(`/guilds/${c.guildId}/channels`, {
    method: "POST",
    body: JSON.stringify({
      name,
      type: 2, // GUILD_VOICE
      parent_id: c.categoryId,
      permission_overwrites,
    }),
  });
  return channel;
}

export async function addMemberChannelPermission(channelId, discordUserId) {
  if (!channelId || !discordUserId) return null;
  const allow = (PERM.VIEW_CHANNEL | PERM.CONNECT | PERM.SPEAK).toString();
  return discordFetch(`/channels/${encodeURIComponent(channelId)}/permissions/${encodeURIComponent(discordUserId)}`, {
    method: "PUT",
    body: JSON.stringify({
      type: 1,
      allow,
      deny: "0",
    }),
  });
}

export async function removeMemberChannelPermission(channelId, discordUserId) {
  if (!channelId || !discordUserId) return null;
  try {
    return await discordFetch(
      `/channels/${encodeURIComponent(channelId)}/permissions/${encodeURIComponent(discordUserId)}`,
      { method: "DELETE" }
    );
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

export async function deleteVoiceChannel(channelId) {
  if (!channelId) return null;
  try {
    return await discordFetch(`/channels/${encodeURIComponent(channelId)}`, { method: "DELETE" });
  } catch (err) {
    if (err?.status === 404) return { alreadyDeleted: true };
    throw err;
  }
}

export function avatarUrl(discordUserId, avatarHash) {
  if (!discordUserId) return "";
  if (!avatarHash) return `https://cdn.discordapp.com/embed/avatars/${Number(discordUserId) % 5}.png`;
  return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.png`;
}
