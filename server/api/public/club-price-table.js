import { loadPublicServices } from "../platform/services.js";
import { LOCKED_LEVEL_IDS, readLocalLevels, stripMarkupAllowanceMarker } from "../_companion-levels-store.js";
import { catalogBasePrice, computeFinalPrice, loadMarkupMap, markupFor } from "../_lv-markup.js";
import { loadAllPricePolicies, normalizePricePolicy } from "../_service-price-policy.js";
import {
  PRICE_TABLE_DEFAULT_CATEGORIES,
  groupGamesForPriceTable,
  inferGameFamily,
  normalizeCategoryRow,
  resolvePriceCategory,
} from "../_price-table-catalog.js";

function json(res, status, data) {
  res.status(status).json(data);
}

function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function env(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return process.env[key] || "";
}

function hasDb() {
  return !!(env("SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY"));
}

function serviceHeaders() {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const base = { apikey: key, "Content-Type": "application/json", "User-Agent": "MCJ-Server/1.0" };
  if (!key.startsWith("sb_secret_")) base.Authorization = `Bearer ${key}`;
  return base;
}

function restUrl(table, query = "") {
  return `${env("SUPABASE_URL")}/rest/v1/${table}${query}`;
}

async function loadCategoryRows() {
  if (hasDb()) {
    try {
      const response = await fetch(
        restUrl("service_categories", "?order=sort_order.asc,name.asc"),
        { headers: serviceHeaders() }
      );
      const text = await response.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (response.ok && Array.isArray(body) && body.length) {
        return body.map((row, i) => normalizeCategoryRow(row, i));
      }
    } catch {
      /* fall through */
    }
  }
  try {
    const { readLocalCategories } = await import("../_services-store.js");
    const local = await readLocalCategories();
    if (Array.isArray(local) && local.length) {
      if (typeof local[0] === "object") {
        return local.map((row, i) => normalizeCategoryRow(row, i));
      }
      return local.map((name, i) => normalizeCategoryRow({ name, sort: i + 1, enabled: true }, i));
    }
  } catch {
    /* fall through */
  }
  return PRICE_TABLE_DEFAULT_CATEGORIES.map((row, i) => normalizeCategoryRow(row, i));
}

function ensurePriceTabs(rows) {
  const byName = new Map();
  for (const row of rows || []) {
    if (!row || !row.name) continue;
    byName.set(row.name, row);
  }
  for (const seed of PRICE_TABLE_DEFAULT_CATEGORIES) {
    if (!byName.has(seed.name)) {
      byName.set(seed.name, normalizeCategoryRow(seed, byName.size));
    }
  }
  return Array.from(byName.values()).sort((a, b) => a.sort - b.sort || String(a.name).localeCompare(String(b.name), "zh"));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  try {
    const [levelRows, loaded, markupMap, categoryRowsRaw] = await Promise.all([
      readLocalLevels().catch(() => []),
      loadPublicServices(),
      loadMarkupMap(),
      loadCategoryRows().catch(() => PRICE_TABLE_DEFAULT_CATEGORIES.map((r, i) => normalizeCategoryRow(r, i))),
    ]);
    let policies = {};
    try {
      const map = await loadAllPricePolicies();
      policies = Object.fromEntries(
        Object.entries(map || {}).map(([key, value]) => [key, normalizePricePolicy(value)])
      );
    } catch {
      policies = {};
    }

    const allCategories = ensurePriceTabs(categoryRowsRaw);
    const defaultNames = new Set(PRICE_TABLE_DEFAULT_CATEGORIES.map((c) => c.name));
    // Legacy free-text categories stay in admin/service assignment, but user tabs
    // only show the price-table set (端游 / 手游 / 娱乐陪伴) plus any extra enabled
    // custom tabs that are not legacy aliases.
    const LEGACY_HIDE = new Set(["语音", "娱乐", "定制", "其他", "射击", "三角洲行动"]);
    const categories = allCategories.filter((c) => {
      if (c.enabled === false) return false;
      if (defaultNames.has(c.name)) return true;
      if (LEGACY_HIDE.has(c.name)) return false;
      return true;
    });
    const enabledNames = categories.map((c) => c.name);

    const levels = (Array.isArray(levelRows) ? levelRows : [])
      .filter((row) => LOCKED_LEVEL_IDS.includes(String(row.id || "").toLowerCase()) && row.enabled !== false)
      .sort((a, b) => Number(a.level || a.sort || 0) - Number(b.level || b.sort || 0))
      .map((row) => {
        const id = String(row.id || "").toLowerCase();
        const pack = markupFor(markupMap, "", id);
        const fromLevel = row.markupAllowance != null && row.markupAllowance !== "";
        const markupConfigured = fromLevel || !!pack.configured;
        const markupAllowance = markupConfigured
          ? Math.max(0, money(fromLevel ? row.markupAllowance : pack.markupAllowance))
          : null;
        return {
          id,
          code: row.code || String(row.id || "").toUpperCase(),
          name: String(row.name || "").trim(),
          level: Number(row.level || 0) || 0,
          markupConfigured,
          markupAllowance,
          description: String(row.description || "").trim(),
          benefits: stripMarkupAllowanceMarker(row.benefits || ""),
        };
      });

    const games = (loaded.services || [])
      .filter((row) => row && row.enabled !== false)
      .map((row) => {
        const base = catalogBasePrice(row);
        const baseConfigured = base > 0;
        const unit = policies[String(row.id)]?.unit || "局";
        const priceCategory = resolvePriceCategory(row.category, row.name, enabledNames);
        const family = inferGameFamily(row.name);
        const byLevel = LOCKED_LEVEL_IDS.map((levelId) => {
          const pack = markupFor(markupMap, row.id, levelId);
          const markupConfigured = !!pack.configured;
          const markupAllowance = markupConfigured ? Math.max(0, money(pack.markupAllowance)) : null;
          const finalConfigured = baseConfigured && markupConfigured;
          return {
            levelId,
            markupConfigured,
            markupAllowance,
            baseConfigured,
            basePrice: baseConfigured ? base : null,
            finalConfigured,
            finalPrice: finalConfigured ? computeFinalPrice(base, markupAllowance, true) : null,
          };
        });
        return {
          id: row.id,
          name: row.name || row.title || "未命名游戏",
          category: row.category || "",
          priceCategory,
          family,
          icon: row.icon || "",
          unit,
          sort: Number(row.sort || 0) || 0,
          baseConfigured,
          basePrice: baseConfigured ? base : null,
          levels: byLevel,
        };
      })
      .sort((a, b) => a.sort - b.sort || String(a.name).localeCompare(String(b.name), "zh"));

    const groups = groupGamesForPriceTable(games, categories);

    return json(res, 200, {
      ok: true,
      categories,
      levels,
      games,
      groups,
      source: loaded.source || "",
    });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      message: error.message || "价格表读取失败",
      categories: PRICE_TABLE_DEFAULT_CATEGORIES.map((r, i) => normalizeCategoryRow(r, i)),
      levels: [],
      games: [],
      groups: [],
    });
  }
}
