/**
 * Unified companion public-listing sync.
 *
 * CRITICAL SAFETY RULES:
 * - Listing/status sync MUST NOT overwrite profile content (nickname, game, price,
 *   level, media URLs, tags, voice, gender, etc.) with null / "" / 0 / defaults.
 * - Backfill may only touch listing-status fields (or fill truly missing level).
 * - Content fields change only via explicit admin edit or companion update_profile.
 *
 * Semantic mapping (no is_visible / is_published columns in DB):
 *   is_published / is_visible  ≡  hallVisible from evaluatePublishGate
 */
import { evaluatePublishGate, listingBlockReason, hasAssignableLevel } from "./_companion-publish-gate.js";
import { DEFAULT_LEVELS } from "./_companion-levels-store.js";

/** Fields that listing/backfill scripts are allowed to write. */
export const LISTING_STATUS_FIELDS = new Set([
  "application_status",
  "verification_status",
  "allow_orders",
  "online_status",
  "application_reject_reason",
  "companion_code",
  "updated_at",
]);

/** Business/content fields that must never be blanked by listing sync. */
export const PROFILE_CONTENT_FIELDS = [
  "nickname",
  "game",
  "price",
  "price_min",
  "price_max",
  "level_id",
  "level_name",
  "description",
  "voice_url",
  "card_image_url",
  "tags",
  "age",
  "gender",
  "region",
  "contact_phone",
  "game_rank",
  "position",
  "game_id",
  "voice_type",
  "schedule",
  "main_service",
  "service_type",
  "service_ids",
  "game_prices",
  "featured",
  "commission_rate",
  "gift_commission_rate",
  "direct_rebate_rate",
  "media_status",
];

export function isBlankContentValue(value) {
  if (value == null) return true;
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "string") {
    const s = value.trim();
    return !s || /^未设置/.test(s);
  }
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

export function isFormallyApproved(row = {}) {
  const app = String(row.application_status || "").trim().toLowerCase();
  if (/^(archived|deleted|draft)$/.test(app)) return false;
  if (/rejected|resubmit|need_more/.test(app)) return false;
  return /approved|verified|passed/.test(app);
}

export function isUnlistedByStatus(row = {}, profile = {}) {
  const app = String(row.application_status || "").trim().toLowerCase();
  if (/^(archived|deleted)$/.test(app)) return true;
  if (/rejected|resubmit|need_more/.test(app)) return true;
  const st = String(profile?.status || "").trim().toLowerCase();
  if (/disabled|banned|frozen|blocked|suspended|deleted/.test(st)) return true;
  if (row.is_test_account === true) return true;
  return false;
}

export function defaultCompanionLevel() {
  const lv = Array.isArray(DEFAULT_LEVELS) && DEFAULT_LEVELS[0] ? DEFAULT_LEVELS[0] : null;
  if (!lv) {
    return { level_id: "lv1", level_name: "Lv1 萌喵" };
  }
  const code = String(lv.code || "Lv1").trim();
  const name = String(lv.name || "萌喵").trim();
  return {
    level_id: String(lv.id || "lv1"),
    level_name: `${code} ${name}`.trim(),
  };
}

/** Only when level is truly missing — never overwrite existing level. */
export function ensureDefaultLevelPatch(row = {}) {
  if (hasAssignableLevel(row)) return {};
  return defaultCompanionLevel();
}

/**
 * Drop blank / zero-price overwrites so existing non-empty formal data is kept.
 * - null / "" / whitespace never overwrite
 * - price 0 never overwrites existing price > 0
 * - empty arrays/objects never overwrite non-empty
 */
export function preserveExistingContent(existing = {}, incoming = {}, { allowZeroPrice = false } = {}) {
  const out = {};
  for (const [key, next] of Object.entries(incoming || {})) {
    const prev = existing[key];
    if (PROFILE_CONTENT_FIELDS.includes(key) || key === "level_id" || key === "level_name") {
      if (isBlankContentValue(next) && !isBlankContentValue(prev)) continue;
      if (
        (key === "price" || key === "price_min" || key === "price_max") &&
        !allowZeroPrice &&
        Number(next) === 0 &&
        Number(prev) > 0
      ) {
        continue;
      }
    }
    out[key] = next;
  }
  return out;
}

/**
 * Listing-status-only patch for backfill / republish.
 * NEVER includes nickname/game/price/media/tags/etc.
 */
export function listingStatusOnlyPatch(row = {}, extra = {}) {
  const now = new Date().toISOString();
  const patch = {
    updated_at: now,
  };
  if (/approved|verified|passed/i.test(String(row.application_status || ""))) {
    patch.application_status = row.application_status;
  } else {
    patch.application_status = "approved";
  }
  if (/approved|verified|passed/i.test(String(row.verification_status || ""))) {
    patch.verification_status = row.verification_status;
  } else {
    patch.verification_status = "approved";
  }
  if (row.allow_orders === false) {
    // Do not force-enable if explicitly disabled unless extra overrides.
  } else {
    patch.allow_orders = true;
  }
  // Keep existing online_status — never force offline if already online.
  if (extra.online_status != null) {
    patch.online_status = extra.online_status;
  }
  if (extra.allow_orders != null) patch.allow_orders = extra.allow_orders;
  if (extra.companion_code && !row.companion_code) patch.companion_code = extra.companion_code;
  // Optional: fill missing level only.
  if (extra.fillDefaultLevel) {
    Object.assign(patch, ensureDefaultLevelPatch(row));
  }
  // Strip any accidental content keys from extra.
  for (const key of Object.keys(extra)) {
    if (!LISTING_STATUS_FIELDS.has(key) && key !== "fillDefaultLevel") continue;
    if (key === "fillDefaultLevel") continue;
    if (extra[key] !== undefined) patch[key] = extra[key];
  }
  return patch;
}

/** Patch applied when admin approves an application (status only + optional admin extras).
 *  Application approve ≠ 可接单：进入「待认证」，须身份证或押金二选一通过后才开放接单。
 */
export function approveListingPatch(extra = {}) {
  const now = new Date().toISOString();
  return {
    application_status: "approved",
    // Keep listing unpublished until credential (ID or deposit) is admin-approved.
    verification_status: "pending",
    allow_orders: false,
    // Stay offline until companion completes credential and goes online.
    online_status: extra.online_status != null ? extra.online_status : "offline",
    updated_at: now,
    ...extra,
  };
}

/**
 * Approve patch that fills default level ONLY when the current row has none.
 * Never overwrites an existing level with Lv1.
 * Preserves existing online_status when not explicitly provided.
 */
export function approveListingPatchForRow(row = {}, extra = {}) {
  const levelFromRow = ensureDefaultLevelPatch(row);
  const merged = preserveExistingContent(row, {
    ...levelFromRow,
    ...extra,
  });
  if (merged.online_status == null && row.online_status) {
    merged.online_status = row.online_status;
  }
  return approveListingPatch(merged);
}

/** Patch applied when rejected / need more / archived (auto-unlist). */
export function unlistListingPatch({ status, reason = "" } = {}) {
  const now = new Date().toISOString();
  const st = String(status || "rejected").trim().toLowerCase();
  return {
    application_status: st,
    verification_status: /archived|deleted/.test(st) ? undefined : st,
    allow_orders: false,
    online_status: "offline",
    application_reject_reason: reason || "",
    updated_at: now,
  };
}

/** Profile patch so public list join + gate see an active companion. */
export function activeCompanionProfilePatch() {
  return {
    role: "companion",
    status: "active",
  };
}

export function disabledCompanionProfilePatch() {
  return {
    status: "disabled",
  };
}

export function isListingEligible(row = {}, profile = {}, mediaExtras = {}) {
  return evaluatePublishGate(row, profile, mediaExtras).hallVisible;
}

export function describeListingBlock(row = {}, profile = {}, mediaExtras = {}) {
  return listingBlockReason(evaluatePublishGate(row, profile, mediaExtras));
}

export { evaluatePublishGate, listingBlockReason, hasAssignableLevel };
