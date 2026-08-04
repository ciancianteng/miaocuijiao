import { readLocalLevels, toPublicLevel } from "../_companion-levels-store.js";

function json(res, status, data) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.status(status).json(data);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  try {
    const levels = await readLocalLevels();
    const enabledOnly = String(req.query.all || "") !== "1";
    const list = (enabledOnly ? levels.filter((item) => item.enabled !== false) : levels).map(toPublicLevel);
    const publishedAt = list.reduce((acc, row) => {
      const ts = String(row.updated_at || "");
      return ts > acc ? ts : acc;
    }, "");
    return json(res, 200, {
      ok: true,
      levels: list,
      byType: { companion_levels: list },
      publishedAt: publishedAt || new Date().toISOString(),
      source: "companion_levels",
    });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "陪玩等级读取失败" });
  }
}
