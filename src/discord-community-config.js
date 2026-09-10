/**
 * MEOW CUI JIAO Discord community invite — single maintenance point.
 *
 * Fill any ONE of (first match wins):
 * 1. window.__MCJ_DISCORD_INVITE_URL = "https://discord.gg/xxxx"
 * 2. Env: VITE_DISCORD_INVITE_URL (build-time, see .env.example)
 * 3. Platform settings: discordInviteUrl via /api/platform/settings
 * 4. Legacy local keys: discordInviteUrl / mcj_siteSettings / mcjPlatformSettings
 *
 * Empty / invalid → UI shows「Discord 社区即将开放」, never opens a bad URL.
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

/** Only allow https Discord invite hosts. */
export function sanitizeDiscordInviteUrl(raw) {
  var s = String(raw || "").trim();
  if (!s) return "";
  try {
    var u = new URL(s);
    if (u.protocol !== "https:") return "";
    var host = String(u.hostname || "")
      .toLowerCase()
      .replace(/^www\./, "");
    if (host === "discord.gg" || host === "discord.com" || host.endsWith(".discord.com")) {
      return u.toString();
    }
    return "";
  } catch (e) {
    return "";
  }
}

export function getDiscordInviteUrl() {
  var candidates = [
    typeof window !== "undefined" ? window.__MCJ_DISCORD_INVITE_URL : "",
    typeof import.meta !== "undefined" && import.meta.env ? import.meta.env.VITE_DISCORD_INVITE_URL : "",
    cachedPlatformUrl,
    readLocal("discordInviteUrl"),
    readLocal("DISCORD_INVITE_URL"),
    readJsonField("mcj_siteSettings", "discordInviteUrl"),
    readJsonField("mcjPlatformSettings", "discordInviteUrl"),
  ];
  for (var i = 0; i < candidates.length; i++) {
    var ok = sanitizeDiscordInviteUrl(candidates[i]);
    if (ok) return ok;
  }
  return "";
}

export function isDiscordInviteReady() {
  return !!getDiscordInviteUrl();
}

export function setCachedPlatformDiscordInvite(url) {
  cachedPlatformUrl = sanitizeDiscordInviteUrl(url);
  return cachedPlatformUrl;
}

/**
 * Open invite safely. Returns { ok, reason }.
 * Mobile: window.open → Discord app / browser when possible.
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
    // Popup blocked — same-tab fallback still keeps chat page replaceable via Back.
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
      return setCachedPlatformDiscordInvite(settings.discordInviteUrl || settings.DISCORD_INVITE_URL || "");
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
    refreshDiscordInviteFromPlatform: refreshDiscordInviteFromPlatform,
    setCachedPlatformDiscordInvite: setCachedPlatformDiscordInvite,
  };
}
