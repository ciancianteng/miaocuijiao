/**
 * Pricing V2 P2 — seed sell price from level.base_price on first approve.
 *
 * Code status (main): P1 (#205 / 975ee9f+) and P2 (3910be4, entered main via #240 ancestry)
 * are IN main. Runtime prefers companion_services when the table exists.
 *
 * Schema drift: repo CREATE lives only in supabase/companion-marketplace.sql (bootstrap,
 * 3fdc1b6) + Staging-only ensure in scripts/backfill-companion-pricing-p1-staging.mjs
 * (fbd85c7). P1 migrations / pending-prod/11 only ALTER companion_services — they never
 * CREATE it. Production confirmed missing public.companion_services → soft-skip here and
 * use companion_profiles.price / game_prices SoT so approve does not fatal.
 *
 * Does NOT invent a second pricing system. Does NOT CREATE companion_services.
 * Does NOT bulk-rewrite existing companions.
 */
import { companionDb, hasCompanionDb, isMissingRelation } from "./_companion-media-store.js";
import { parseServiceIds, readGamePrices, splitGames } from "./_game-prices.js";

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

/**
 * Production fallback SoT when companion_services table is absent.
 * Fills missing game_prices keys from level base_price; never overwrites existing >0 prices.
 */
export function buildProfilesPricingPatchFromLevel(companion = {}, level = {}, seeds = []) {
  const base = money(level.basePrice ?? level.base_price);
  if (!(base > 0)) return null;
  const game_prices = { ...readGamePrices(companion) };
  const games = splitGames(companion.game || companion.main_service || companion.main_game || "");
  for (const g of games) {
    if (!(money(game_prices[g]) > 0)) game_prices[g] = base;
  }
  for (const seed of seeds || []) {
    const nm = String(seed.service_name || "").trim();
    if (!nm || nm === "默认服务" || nm === "服务") continue;
    if (!(money(game_prices[nm]) > 0)) game_prices[nm] = base;
  }
  const patch = { price: base };
  if (Object.keys(game_prices).length) patch.game_prices = game_prices;
  return patch;
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

function profilesOnlyResult(companionId, level, base, seeds, companion) {
  return {
    companionId,
    basePrice: base,
    levelId: String(level.id || level.level_id || ""),
    seeds: (seeds || []).length,
    written: [],
    mode: "companion_profiles",
    skippedTable: true,
    profilesPatch: buildProfilesPricingPatchFromLevel(companion, level, seeds) || { price: base },
  };
}

/**
 * Upsert level_default companion_services for approve-time seeding when the table exists.
 * If the table is missing (Production), soft-skip and return companion_profiles patch.
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

  let existing = [];
  try {
    existing =
      (await companionDb(
        "companion_services",
        `?companion_id=eq.${encodeURIComponent(companionId)}&select=id,service_id,service_name,price,source,enabled,review_status`
      )) || [];
  } catch (e) {
    if (isMissingRelation(e)) {
      console.warn(
        "[companion-services-seed] public.companion_services missing — using companion_profiles.price/game_prices SoT"
      );
      return profilesOnlyResult(companionId, level, base, seeds, companion);
    }
    const err = new Error(`读取 companion_services 失败：${e?.message || e}`);
    err.status = 500;
    err.code = "SERVICES_SEED_READ_FAILED";
    throw err;
  }

  if (!seeds.length) {
    // Table exists but no games/service_ids — still OK to approve with listing price only.
    return {
      companionId,
      basePrice: base,
      levelId: String(level.id || level.level_id || ""),
      seeds: 0,
      written: [],
      mode: "companion_services",
      profilesPatch: { price: base },
    };
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
        if (isMissingRelation(e)) {
          return profilesOnlyResult(companionId, level, base, seeds, companion);
        }
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
      if (isMissingRelation(e)) {
        return profilesOnlyResult(companionId, level, base, seeds, companion);
      }
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
    mode: "companion_services",
    profilesPatch: { price: base },
  };
}

export function derivedListingPriceFromLevel(level = {}) {
  return money(level.basePrice ?? level.base_price);
}
