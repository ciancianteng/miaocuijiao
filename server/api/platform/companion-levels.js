import { readLocalLevels, toPublicLevel } from "../_companion-levels-store.js";

function json(res, status, data) {
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
    return json(res, 200, { ok: true, levels: list, byType: { companion_levels: list } });
  } catch (error) {
    return json(res, 500, { ok: false, message: error.message || "陪玩等级读取失败" });
  }
}
