/**
 * Companion marketplace verification badges (admin-controlled).
 * Keys: real_verified | game_verified | voice_verified | official_verified | recommended
 */
import "./_load-env.js";

export const BADGE_KEYS = [
  "real_verified",
  "game_verified",
  "voice_verified",
  "official_verified",
  "recommended",
];

export const BADGE_META = {
  real_verified: { key: "real_verified", label: "真人认证", short: "真人" },
  game_verified: { key: "game_verified", label: "游戏认证", short: "游戏" },
  voice_verified: { key: "voice_verified", label: "声线认证", short: "声线" },
  official_verified: { key: "official_verified", label: "官方认证", short: "官方" },
  recommended: { key: "recommended", label: "官方推荐", short: "推荐" },
};

function emptyBadges() {
  return {
    real_verified: false,
    game_verified: false,
    voice_verified: false,
    official_verified: false,
    recommended: false,
  };
}

function restUrl(table, query = "") {
  return `${process.env.SUPABASE_URL || process.env.PROD_SUPABASE_URL || ""}/rest/v1/${table}${query}`;
}

function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PROD_SUPABASE_SERVICE_ROLE_KEY || "";
}

function headers(extra = {}) {
  const key = serviceKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    ...extra,
  };
}

async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const msg = body?.message || body?.hint || body?.details || text || "companion_badges request failed";
    const err = new Error(msg);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

function normalizeRow(row = {}) {
  const out = emptyBadges();
  for (const key of BADGE_KEYS) {
    out[key] = row[key] === true;
  }
  out.companionProfileId = row.companion_profile_id || row.companionProfileId || "";
  out.updatedAt = row.updated_at || row.updatedAt || "";
  return out;
}

/** Public/admin display list of enabled badges only. */
export function enabledBadgeList(badges = {}) {
  return BADGE_KEYS.filter((key) => badges[key] === true).map((key) => ({
    key,
    label: BADGE_META[key].label,
    short: BADGE_META[key].short,
  }));
}

export function publicBadgesPayload(badges = {}) {
  const normalized = normalizeRow(badges);
  return {
    ...normalized,
    items: enabledBadgeList(normalized),
  };
}

export async function badgesByProfileIds(profileIds = []) {
  const ids = [...new Set((profileIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  const map = {};
  ids.forEach((id) => {
    map[id] = emptyBadges();
  });
  if (!ids.length || !serviceKey()) return map;
  try {
    const rows = await supabaseJson(
      restUrl(
        "companion_badges",
        `?companion_profile_id=in.(${ids.map(encodeURIComponent).join(",")})&select=*`
      ),
      { headers: headers() }
    );
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = String(row.companion_profile_id || "");
      if (!id) continue;
      map[id] = normalizeRow(row);
    }
  } catch (err) {
    // Table may not exist yet on some environments — fail soft with empty badges.
    if (!/companion_badges|PGRST205|42P01|schema cache/i.test(String(err?.message || err || ""))) {
      console.warn("[companion_badges] load failed", err?.message || err);
    }
  }
  return map;
}

export async function getBadgesForProfile(companionProfileId) {
  const id = String(companionProfileId || "").trim();
  if (!id) return emptyBadges();
  const map = await badgesByProfileIds([id]);
  return map[id] || emptyBadges();
}

function bool(value, fallback = false) {
  if (value === true || value === false) return value;
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on", "enabled"].includes(raw)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(raw)) return false;
  return fallback;
}

/** Build patch from admin payload (supports nested badges{} or flat badge_* / camelCase keys). */
export function badgesPatchFromPayload(payload = {}) {
  const src = payload.badges && typeof payload.badges === "object" ? payload.badges : payload;
  const patch = {};
  const aliases = {
    real_verified: ["real_verified", "realVerified", "badge_real_verified"],
    game_verified: ["game_verified", "gameVerified", "badge_game_verified"],
    voice_verified: ["voice_verified", "voiceVerified", "badge_voice_verified"],
    official_verified: ["official_verified", "officialVerified", "badge_official_verified"],
    recommended: ["recommended", "badge_recommended", "badgeRecommended"],
  };
  for (const key of BADGE_KEYS) {
    const names = aliases[key] || [key];
    for (const name of names) {
      if (src[name] != null) {
        patch[key] = bool(src[name], false);
        break;
      }
    }
  }
  return patch;
}

export async function upsertBadgesForProfile(companionProfileId, patch = {}, updatedBy = null) {
  const id = String(companionProfileId || "").trim();
  if (!id) throw Object.assign(new Error("missing companion_profile_id"), { status: 400 });
  const cleaned = {};
  for (const key of BADGE_KEYS) {
    if (patch[key] != null) cleaned[key] = bool(patch[key], false);
  }
  if (!Object.keys(cleaned).length) {
    return getBadgesForProfile(id);
  }
  const body = {
    companion_profile_id: id,
    ...cleaned,
    updated_at: new Date().toISOString(),
  };
  if (updatedBy) body.updated_by = updatedBy;

  const rows = await supabaseJson(
    restUrl("companion_badges", "?on_conflict=companion_profile_id&select=*"),
    {
      method: "POST",
      headers: headers({
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      }),
      body: JSON.stringify(body),
    }
  );
  const row = Array.isArray(rows) ? rows[0] : rows;
  return normalizeRow(row || { companion_profile_id: id, ...cleaned });
}
