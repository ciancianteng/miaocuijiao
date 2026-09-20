/**
 * MEOW CUI JIAO public community link (Discord / other).
 *
 * Source of truth: platform_settings via GET /api/platform/settings
 * Fields (first non-empty wins after sanitize):
 *   discordInviteUrl → discordInviteLink → teamLobbyLink
 *
 * Do not hardcode invite URLs in page HTML.
 * Empty / invalid → UI shows「社区链接暂未配置」, never opens a bad URL.
 */
var cachedPlatformUrl = "";

function readLocal(key) {
  try {
    return String(localStorage.getItem(key) || sessionStorage.getItem(key) || "").trim();
  } catch (e) {
    return "";
  }
}

function readJsonField(storageKey, field) {
  try {
    var raw = localStorage.getItem(storageKey) || sessionStorage.getItem(storageKey) || "";
    if (!raw) return "";
    var obj = JSON.parse(raw);
    return String((obj && obj[field]) || "").trim();
  } catch (e) {
    return "";
  }
}

/**
 * Allow only http(s) absolute URLs. Empty is valid (= not configured).
 * Blocks javascript:, data:, etc.
 */
export function sanitizeCommunityUrl(raw) {
  var s = String(raw || "").trim();
  if (!s) return "";
  try {
    var u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString();
  } catch (e) {
    return "";
  }
}

/** @deprecated alias — prefer sanitizeCommunityUrl */
export function sanitizeDiscordInviteUrl(raw) {
  return sanitizeCommunityUrl(raw);
}

export function getDiscordInviteUrl() {
  var candidates = [
    cachedPlatformUrl,
    readLocal("discordInviteUrl"),
    readJsonField("mcj_siteSettings", "discordInviteUrl"),
    readJsonField("mcjPlatformSettings", "discordInviteUrl"),
    readJsonField("mcjPlatformSettings", "teamLobbyLink"),
    typeof window !== "undefined" ? window.__MCJ_DISCORD_INVITE_URL : "",
    typeof import.meta !== "undefined" && import.meta.env ? import.meta.env.VITE_DISCORD_INVITE_URL : "",
  ];
  for (var i = 0; i < candidates.length; i++) {
    var ok = sanitizeCommunityUrl(candidates[i]);
    if (ok) return ok;
  }
  return "";
}

export function isDiscordInviteReady() {
  return !!getDiscordInviteUrl();
}

export function setCachedPlatformDiscordInvite(url) {
  cachedPlatformUrl = sanitizeCommunityUrl(url);
  return cachedPlatformUrl;
}

/**
 * Open invite safely. Returns { ok, reason }.
 */
export function openDiscordInvite() {
  var url = getDiscordInviteUrl();
  if (!url) {
    return { ok: false, reason: "missing" };
  }
  try {
    var win = window.open(url, "_blank", "noopener,noreferrer");
    if (win) {
      try {
        win.opener = null;
      } catch (e) {}
      return { ok: true, reason: "opened" };
    }
  } catch (e) {}
  try {
    location.href = url;
    return { ok: true, reason: "navigated" };
  } catch (e2) {
    return { ok: false, reason: "failed" };
  }
}

/** Soft-load platform settings into cache (non-blocking). */
export function refreshDiscordInviteFromPlatform() {
  return fetch("/api/platform/settings", { headers: { Accept: "application/json" }, cache: "no-store" })
    .then(function (res) {
      return res.json().catch(function () {
        return {};
      });
    })
    .then(function (body) {
      var settings = (body && body.settings) || {};
      var raw =
        settings.discordInviteUrl ||
        settings.discordInviteLink ||
        settings.teamLobbyLink ||
        settings.DISCORD_INVITE_URL ||
        "";
      return setCachedPlatformDiscordInvite(raw);
    })
    .catch(function () {
      return "";
    });
}

if (typeof window !== "undefined") {
  window.MCJDiscordCommunity = {
    getDiscordInviteUrl: getDiscordInviteUrl,
    isDiscordInviteReady: isDiscordInviteReady,
    openDiscordInvite: openDiscordInvite,
    sanitizeDiscordInviteUrl: sanitizeDiscordInviteUrl,
    sanitizeCommunityUrl: sanitizeCommunityUrl,
    refreshDiscordInviteFromPlatform: refreshDiscordInviteFromPlatform,
    setCachedPlatformDiscordInvite: setCachedPlatformDiscordInvite,
  };
}
