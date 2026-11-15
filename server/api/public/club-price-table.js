import { loadPublicServices } from "../platform/services.js";
import { LOCKED_LEVEL_IDS, readLocalLevels } from "../_companion-levels-store.js";
import { catalogBasePrice, computeFinalPrice, loadMarkupMap, markupFor } from "../_lv-markup.js";
import { loadAllPricePolicies, normalizePricePolicy } from "../_service-price-policy.js";

function json(res, status, data) {
  res.status(status).json(data);
}

function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  try {
    const [levelRows, loaded, markupMap] = await Promise.all([
      readLocalLevels().catch(() => []),
      loadPublicServices(),
      loadMarkupMap(),
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
    const levels = (Array.isArray(levelRows) ? levelRows : [])
      .filter((row) => LOCKED_LEVEL_IDS.includes(String(row.id || "").toLowerCase()) && row.enabled !== false)
      .sort((a, b) => Number(a.level || a.sort || 0) - Number(b.level || b.sort || 0))
      .map((row) => ({
        id: String(row.id || "").toLowerCase(),
        code: row.code || String(row.id || "").toUpperCase(),
        name: String(row.name || "").trim(),
        level: Number(row.level || 0) || 0,
      }));
    const games = (loaded.services || [])
      .filter((row) => row && row.enabled !== false)
      .map((row) => {
        const base = catalogBasePrice(row);
        const baseConfigured = base > 0;
        const unit = policies[String(row.id)]?.unit || "局";
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
          icon: row.icon || "",
          unit,
          sort: Number(row.sort || 0) || 0,
          baseConfigured,
          basePrice: baseConfigured ? base : null,
          levels: byLevel,
        };
      })
      .sort((a, b) => a.sort - b.sort || String(a.name).localeCompare(String(b.name), "zh"));
    return json(res, 200, {
      ok: true,
      levels,
      games,
      source: loaded.source || "",
    });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "价格表读取失败", levels: [], games: [] });
  }
}
