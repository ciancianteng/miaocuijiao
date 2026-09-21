/**
 * resolveEffectiveServicePrice — unified companion service sell price (P1).
 *
 * Product SoT (always):
 *   service-specific price ?? level.base_price
 *
 * Resolution order:
 *   1. matched companion_services row
 *      - admin_set / companion_custom / legacy_import / companion_service → row.price
 *      - level_default / level_base_price seed → prefer game_prices (priceForGame)
 *        when present, else row.price (seeded level default)
 *   2. game_prices / legacy profile price (priceForGame) if > 0
 *   3. level.base_price if > 0
 *
 * Never trusts client-submitted unit amounts — call sites snapshot server result.
 */
import { priceForGame } from "./_game-prices.js";

const APPROVED_STATUSES = new Set(["approved", "active"]);
const LEVEL_SEED_SOURCES = new Set(["level_default", "level_base_price"]);

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

function serviceRowName(row) {
  return String(row?.service_name || row?.serviceName || row?.name || "").trim();
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
    const byRow = list.find((r) => String(r.id) === sid);
    if (byRow) return byRow;
  }
  const name = String(gameName || "").trim();
  if (name) {
    const exact = list.find((r) => serviceRowName(r) === name);
    if (exact) return exact;
    // Combined labels ("A、B") are not a service. Do not pick the first contained row
    // (that returned 陪跑@30 / 王者@30 instead of 三角洲手游国服@35).
    if (/[,，、|/]/.test(name)) return null;
    const fuzzy = list
      .map((r) => ({ r, n: serviceRowName(r) }))
      .filter((x) => x.n && (name.includes(x.n) || x.n.includes(name)))
      .sort((a, b) => b.n.length - a.n.length);
    if (fuzzy.length && (fuzzy.length === 1 || fuzzy[0].n.length > fuzzy[1].n.length)) return fuzzy[0].r;
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

function isLevelSeedSource(source) {
  return LEVEL_SEED_SOURCES.has(String(source || "").trim().toLowerCase());
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
 * @param {object} [args.env] process.env override for tests (kept for call-site compat)
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
  void env; // flag no longer flips service-vs-level priority; SoT is always service ?? level
  const cid = String(companionId || companion?.user_id || companion?.id || "") || null;
  const lid = String(level?.id || level?.code || "") || null;
  const legacy = money(priceForGame(companion || {}, gameName, serviceId));
  const base = levelBasePrice(level);

  const row = matchServiceRow(serviceRows, { serviceId, gameName, serviceRowId });
  const named = String(gameName || "").trim();
  const ambiguousBlob = /[,，、|/]/.test(named);
  if (!row && ambiguousBlob) {
    return {
      price: 0,
      source: "ambiguous_service",
      serviceRow: null,
      levelId: lid,
      companionId: cid,
    };
  }
  if (row) {
    const rowSource = String(row.source || "companion_service").trim() || "companion_service";
    const rowPrice = money(row.price);
    // Seeded level_default rows must not block a later admin game_prices override.
    if (isLevelSeedSource(rowSource) && legacy > 0) {
      return {
        price: legacy,
        source: "legacy_profile",
        serviceRow: row,
        levelId: String(row.level_id_at_price || row.levelIdAtPrice || lid || "") || null,
        companionId: cid,
      };
    }
    if (rowPrice > 0) {
      return {
        price: rowPrice,
        source: rowSource,
        serviceRow: row,
        levelId: String(row.level_id_at_price || row.levelIdAtPrice || lid || "") || null,
        companionId: cid,
      };
    }
  }

  // No usable service row (or empty row price): service-specific game_prices, then level.
  if (legacy > 0) {
    return {
      price: legacy,
      source: "legacy_profile",
      serviceRow: null,
      levelId: lid,
      companionId: cid,
    };
  }
  if (base > 0) {
    return {
      price: base,
      source: "level_base_price",
      serviceRow: null,
      levelId: lid,
      companionId: cid,
    };
  }

  return {
    price: 0,
    source: "none",
    serviceRow: null,
    levelId: lid,
    companionId: cid,
  };
}

export function isApprovedServiceReviewStatus(status) {
  return APPROVED_STATUSES.has(String(status || "").trim().toLowerCase());
}

export { money as moneyAmount };
