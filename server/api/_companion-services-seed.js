/**
 * Pricing V2 P2 — seed companion_services from level.base_price on first approve.
 * Reuses P1 columns (source=level_default, base_price_snapshot, level_id_at_price).
 * Does NOT invent a second pricing system. Does NOT bulk-rewrite existing companions.
 */
import { companionDb, hasCompanionDb } from "./_companion-media-store.js";
import { parseServiceIds, splitGames } from "./_game-prices.js";

function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Build level_default service rows for a companion from games / service_ids.
 * Price always comes from level.base_price — never from applicant price / game_prices.
 */
export function buildLevelDefaultServiceSeeds(companion = {}, level = {}) {
  const levelId = String(level.id || level.level_id || "").trim();
  const base = money(level.basePrice ?? level.base_price);
  if (!(base > 0)) return [];

  const ids = parseServiceIds(companion.service_ids ?? companion.serviceIds);
  const games = splitGames(companion.game || companion.main_service || companion.main_game || "");
  const unit = companion.pricing_unit || companion.pricingUnit || "小时";
  const companionId = String(companion.user_id || companion.userId || "").trim();
  if (!companionId) return [];

  const seeds = [];
  const seen = new Set();

  const push = (serviceId = "", name = "") => {
    const nm = String(name || "").trim() || "服务";
    const sid = String(serviceId || "").trim();
    const key = `${sid}::${nm}`;
    if (seen.has(key)) return;
    seen.add(key);
    seeds.push({
      companion_id: companionId,
      service_id: sid || null,
      service_name: nm,
      price: base,
      pricing_unit: unit,
      enabled: true,
      review_status: "approved",
      source: "level_default",
      base_price_snapshot: base,
      level_id_at_price: levelId || null,
      updated_at: nowIso(),
    });
  };

  if (ids.length) {
    ids.forEach((id, idx) => {
      const name = games[idx] || (/^[0-9a-f-]{36}$/i.test(String(id)) ? "游戏" : String(id));
      push(id, /^[0-9a-f-]{36}$/i.test(String(name)) ? games[idx] || "游戏" : name);
    });
  } else if (games.length) {
    games.forEach((g) => push("", g));
  } else {
    push("", "默认服务");
  }

  return seeds;
}

function findExisting(existing, seed) {
  const sid = String(seed.service_id || "");
  const name = String(seed.service_name || "");
  return (
    (existing || []).find((r) => sid && String(r.service_id || "") === sid) ||
    (existing || []).find((r) => name && String(r.service_name || "") === name) ||
    null
  );
}

/**
 * Upsert level_default companion_services for approve-time seeding.
 * - Skips rows that already have a non-level_default source (preserve legacy / custom).
 * - Updates empty / level_default rows to the approved level base_price.
 * - Never bulk-rewrites unrelated companions.
 */
export async function seedCompanionServicesFromLevel(companion = {}, level = {}) {
  if (!hasCompanionDb()) {
    const err = new Error("数据库未配置，无法初始化陪玩服务价格");
    err.status = 500;
    err.code = "SERVICES_SEED_NO_DB";
    throw err;
  }

  const base = money(level.basePrice ?? level.base_price);
  if (!(base > 0)) {
    const err = new Error("所选等级缺少有效的基础价格 base_price，无法通过审核");
    err.status = 400;
    err.code = "LEVEL_BASE_PRICE_MISSING";
    throw err;
  }

  const companionId = String(companion.user_id || companion.userId || "").trim();
  if (!companionId) {
    const err = new Error("陪玩账号缺少 user_id，无法初始化服务价格");
    err.status = 400;
    err.code = "SERVICES_SEED_NO_USER";
    throw err;
  }

  const seeds = buildLevelDefaultServiceSeeds(companion, level);
  if (!seeds.length) {
    const err = new Error("无法根据申请资料生成服务价格行");
    err.status = 400;
    err.code = "SERVICES_SEED_EMPTY";
    throw err;
  }

  let existing = [];
  try {
    existing =
      (await companionDb(
        "companion_services",
        `?companion_id=eq.${encodeURIComponent(companionId)}&select=id,service_id,service_name,price,source,enabled,review_status`
      )) || [];
  } catch (e) {
    const err = new Error(`读取 companion_services 失败：${e?.message || e}`);
    err.status = 500;
    err.code = "SERVICES_SEED_READ_FAILED";
    throw err;
  }

  const written = [];
  for (const seed of seeds) {
    const hit = findExisting(existing, seed);
    if (hit) {
      const src = String(hit.source || "").trim().toLowerCase();
      // Preserve applicant/admin/legacy custom rows — P2 only seeds level_default gaps.
      if (src && src !== "level_default") {
        written.push({ id: hit.id, action: "kept_existing", source: src, price: money(hit.price) });
        continue;
      }
      try {
        const patched = await companionDb(
          "companion_services",
          `?id=eq.${encodeURIComponent(hit.id)}`,
          {
            method: "PATCH",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({
              price: seed.price,
              enabled: true,
              review_status: "approved",
              source: "level_default",
              base_price_snapshot: seed.base_price_snapshot,
              level_id_at_price: seed.level_id_at_price,
              updated_at: nowIso(),
            }),
          }
        );
        written.push({
          id: hit.id,
          action: "updated",
          price: seed.price,
          row: Array.isArray(patched) ? patched[0] : patched,
        });
      } catch (e) {
        const err = new Error(`更新 companion_services 失败：${e?.message || e}`);
        err.status = 500;
        err.code = "SERVICES_SEED_UPDATE_FAILED";
        throw err;
      }
      continue;
    }

    try {
      const inserted = await companionDb("companion_services", "", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(seed),
      });
      written.push({
        action: "inserted",
        price: seed.price,
        row: Array.isArray(inserted) ? inserted[0] : inserted,
      });
    } catch (e) {
      const err = new Error(`写入 companion_services 失败：${e?.message || e}`);
      err.status = 500;
      err.code = "SERVICES_SEED_INSERT_FAILED";
      throw err;
    }
  }

  return {
    companionId,
    basePrice: base,
    levelId: String(level.id || level.level_id || ""),
    seeds: seeds.length,
    written,
  };
}

export function derivedListingPriceFromLevel(level = {}) {
  return money(level.basePrice ?? level.base_price);
}
