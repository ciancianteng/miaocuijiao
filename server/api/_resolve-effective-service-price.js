/**
 * resolveEffectiveServicePrice — unified companion service sell price (P1).
 *
 * Priority (PRICE_V2 off / P1 default — behavioral equivalence with legacy):
 *   1. enabled + review_status ∈ {approved, active} companion_services row → row.price
 *      (never reads proposed_price)
 *   2. legacy priceForGame / companion.price if > 0 → legacy_profile
 *   3. level.base_price if > 0 → level_base_price
 *
 * Target priority when PRICE_V2 on (P4):
 *   1. approved/active service row
 *   2. level.base_price
 *   3. legacy (migration safety until P5 removes it)
 *
 * P1 does not delete or silence legacy reads; call sites may keep priceForGame
 * until P4 gray cutover.
 */
import { priceForGame } from "./_game-prices.js";
import { isPricingV2Enabled } from "./_feature-flags.js";

const APPROVED_STATUSES = new Set(["approved", "active"]);

function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function normalizeServiceRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter(Boolean);
}

function isEffectiveServiceRow(row) {
  if (!row) return false;
  if (row.enabled === false || row.enabled === "false" || row.enabled === 0) return false;
  const status = String(row.review_status || row.reviewStatus || "approved").trim().toLowerCase();
  return APPROVED_STATUSES.has(status);
}

function matchServiceRow(rows, { serviceId = "", gameName = "", serviceRowId = "" } = {}) {
  const list = normalizeServiceRows(rows).filter(isEffectiveServiceRow);
  if (!list.length) return null;
  const rid = String(serviceRowId || "").trim();
  if (rid) {
    const byId = list.find((r) => String(r.id) === rid);
    if (byId) return byId;
  }
  const sid = String(serviceId || "").trim();
  if (sid) {
    const bySid = list.find((r) => String(r.service_id || r.serviceId || "") === sid);
    if (bySid) return bySid;
  }
  const name = String(gameName || "").trim();
  if (name) {
    const exact = list.find((r) => String(r.service_name || r.serviceName || r.name || "").trim() === name);
    if (exact) return exact;
    const fuzzy = list.find((r) => {
      const n = String(r.service_name || r.serviceName || r.name || "").trim();
      return n && (name.includes(n) || n.includes(name));
    });
    if (fuzzy) return fuzzy;
  }
  // Single enabled service → use it when caller did not specify
  if (list.length === 1 && !sid && !name && !rid) return list[0];
  return null;
}

function levelBasePrice(level) {
  if (!level || typeof level !== "object") return 0;
  const raw =
    level.basePrice ??
    level.base_price ??
    level.base ??
    null;
  if (raw != null && raw !== "") return money(raw);
  return 0;
}

/**
 * @param {object} args
 * @param {object} [args.companion] companion_profiles-like row
 * @param {string} [args.companionId]
 * @param {string} [args.serviceId]
 * @param {string} [args.gameName]
 * @param {string} [args.serviceRowId]
 * @param {object|null} [args.level] companion_levels-like (normalized or db)
 * @param {object[]} [args.serviceRows] preloaded companion_services rows
 * @param {object} [args.env] process.env override for tests
 * @returns {{ price: number, source: string, serviceRow: object|null, levelId: string|null }}
 */
export function resolveEffectiveServicePrice({
  companion = null,
  companionId = "",
  serviceId = "",
  gameName = "",
  serviceRowId = "",
  level = null,
  serviceRows = null,
  env = process.env,
} = {}) {
  const row = matchServiceRow(serviceRows, { serviceId, gameName, serviceRowId });
  if (row) {
    return {
      price: money(row.price),
      source: String(row.source || "companion_service").trim() || "companion_service",
      serviceRow: row,
      levelId: String(row.level_id_at_price || row.levelIdAtPrice || level?.id || "") || null,
      companionId: String(companionId || companion?.user_id || companion?.id || "") || null,
    };
  }

  const v2 = isPricingV2Enabled(env);
  const base = levelBasePrice(level);
  const legacy = money(priceForGame(companion || {}, gameName, serviceId));

  if (v2) {
    if (base > 0) {
      return {
        price: base,
        source: "level_base_price",
        serviceRow: null,
        levelId: String(level?.id || level?.code || "") || null,
        companionId: String(companionId || companion?.user_id || companion?.id || "") || null,
      };
    }
    if (legacy > 0) {
      return {
        price: legacy,
        source: "legacy_profile",
        serviceRow: null,
        levelId: String(level?.id || level?.code || "") || null,
        companionId: String(companionId || companion?.user_id || companion?.id || "") || null,
      };
    }
  } else {
    // P1 default: preserve pre-migration amounts when no service rows yet
    if (legacy > 0) {
      return {
        price: legacy,
        source: "legacy_profile",
        serviceRow: null,
        levelId: String(level?.id || level?.code || "") || null,
        companionId: String(companionId || companion?.user_id || companion?.id || "") || null,
      };
    }
    if (base > 0) {
      return {
        price: base,
        source: "level_base_price",
        serviceRow: null,
        levelId: String(level?.id || level?.code || "") || null,
        companionId: String(companionId || companion?.user_id || companion?.id || "") || null,
      };
    }
  }

  return {
    price: 0,
    source: "none",
    serviceRow: null,
    levelId: String(level?.id || level?.code || "") || null,
    companionId: String(companionId || companion?.user_id || companion?.id || "") || null,
  };
}

export function isApprovedServiceReviewStatus(status) {
  return APPROVED_STATUSES.has(String(status || "").trim().toLowerCase());
}

export { money as moneyAmount };
