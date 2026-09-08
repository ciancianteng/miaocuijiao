/**
 * P1: resolveEffectiveServicePrice
 *
 * Priority (product final):
 *   1) approved companion_services.price (enabled + approved/active) — never proposed_price
 *   2) level base_price
 *   3) legacy fallback (profiles.price / game_prices) — migration only; removed in P5
 *
 * PRICE_V2 / PRICING_V2: P4 cutover flag. P1 always allows legacy fallback so amounts stay equivalent.
 */
import { priceForGame } from "./_game-prices.js";

function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const APPROVED = new Set(["approved", "active"]);

/**
 * @param {object} opts
 * @param {object} [opts.companion] companion_profiles row
 * @param {string} [opts.companionId]
 * @param {string} [opts.serviceId]
 * @param {string} [opts.gameName]
 * @param {object|null} [opts.level] normalized level with basePrice/base_price
 * @param {object[]} [opts.services] companion_services rows (optional preloaded)
 * @param {boolean} [opts.allowLegacy=true] P1/P5: legacy fallback
 */
export function resolveEffectiveServicePrice(opts = {}) {
  const companion = opts.companion || {};
  const serviceId = String(opts.serviceId || "").trim();
  const gameName = String(opts.gameName || "").trim();
  const services = Array.isArray(opts.services) ? opts.services : [];
  const allowLegacy = opts.allowLegacy !== false;

  const match = findApprovedServiceRow(services, serviceId, gameName);
  if (match) {
    const price = money(match.price);
    if (price > 0) {
      return {
        ok: true,
        price,
        source: String(match.source || "companion_service"),
        serviceRowId: match.id || null,
        levelId: match.level_id_at_price || match.levelIdAtPrice || "",
        // Explicit: pending must never win
        ignoredProposedPrice: match.proposed_price != null || match.proposedPrice != null,
      };
    }
  }

  const level = opts.level || null;
  const base = money(level?.basePrice ?? level?.base_price ?? level?.base);
  if (base > 0) {
    return {
      ok: true,
      price: base,
      source: "level_base_price",
      serviceRowId: null,
      levelId: level?.id || "",
      ignoredProposedPrice: false,
    };
  }

  if (allowLegacy) {
    const legacy = money(priceForGame(companion, gameName, serviceId));
    if (legacy > 0) {
      return {
        ok: true,
        price: legacy,
        source: "legacy_profile",
        serviceRowId: null,
        levelId: "",
        ignoredProposedPrice: false,
      };
    }
  }

  return {
    ok: false,
    price: 0,
    source: "none",
    serviceRowId: null,
    levelId: "",
    message: "无法解析有效服务单价",
  };
}

function findApprovedServiceRow(services, serviceId, gameName) {
  const enabledApproved = services.filter((row) => {
    if (row.enabled === false) return false;
    const st = String(row.review_status || row.reviewStatus || "approved").toLowerCase();
    return APPROVED.has(st);
  });
  if (!enabledApproved.length) return null;

  if (serviceId) {
    const byId = enabledApproved.find(
      (r) => String(r.service_id || r.serviceId || r.id || "") === serviceId
    );
    if (byId) return byId;
  }
  if (gameName) {
    const byName = enabledApproved.find((r) => {
      const name = String(r.service_name || r.serviceName || r.name || "").trim();
      return name && (name === gameName || name.includes(gameName) || gameName.includes(name));
    });
    if (byName) return byName;
  }
  // Single enabled service → use it
  if (enabledApproved.length === 1) return enabledApproved[0];
  return null;
}

/** Recompute level_default rows only; keep companion_custom / admin_set (R8). */
export function shouldFollowLevelBasePrice(serviceRow = {}) {
  const source = String(serviceRow.source || "").trim();
  if (!source || source === "level_default") return true;
  if (source === "legacy_import") return true; // optional: treat legacy as followable until customized
  return false;
}

export function applyLevelBasePriceToServices(services = [], level = {}) {
  const base = money(level?.basePrice ?? level?.base_price);
  const levelId = String(level?.id || "");
  return (Array.isArray(services) ? services : []).map((row) => {
    if (!shouldFollowLevelBasePrice(row)) return { ...row, followedBase: false };
    return {
      ...row,
      price: base,
      base_price_snapshot: base,
      basePriceSnapshot: base,
      level_id_at_price: levelId,
      levelIdAtPrice: levelId,
      source: row.source === "legacy_import" ? "level_default" : row.source || "level_default",
      followedBase: true,
    };
  });
}
