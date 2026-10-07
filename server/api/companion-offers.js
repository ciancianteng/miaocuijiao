import { listCompanionOffers } from "./_companion-offers.js";

function json(res, status, data) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(data);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  const userId = String(req.query?.userId || req.query?.id || "").trim();
  if (!userId) return json(res, 400, { ok: false, message: "缺少陪玩 ID" });
  try {
    const data = await listCompanionOffers(userId, { enabledOnly: true });
    return json(res, 200, { ok: true, offers: data.offers });
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "读取服务失败" });
  }
}
