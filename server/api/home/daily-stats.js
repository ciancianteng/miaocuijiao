import { hasPlatformDb, loadPlatformStats, statsTimezone, todayInTimezone } from "../_platform-stats.js";

export default async function handler(req, res) {
  const timezone = statsTimezone();
  const date = todayInTimezone(timezone);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  if (!hasPlatformDb()) {
    return res.status(503).json({
      ok: false,
      configured: false,
      message: "数据库未配置",
      date,
      timezone,
    });
  }

  try {
    const payload = await loadPlatformStats();
    const s = payload.stats || {};
    return res.status(200).json({
      ok: true,
      configured: true,
      date: payload.date || date,
      timezone: payload.timezone || timezone,
      updatedAt: new Date().toISOString(),
      // Same numbers as /api/admin/dashboard (shared loader).
      ordersCreated: s.ordersCreated || s.todayOrdersCreated || 0,
      ordersCompleted: s.todayOrdersCompleted || 0,
      onlineCompanions: s.onlineCompanions || 0,
      bosses: s.bosses || 0,
      companions: s.companions || 0,
      grossRevenue: s.grossRevenue != null ? s.grossRevenue : s.todayAmount || 0,
      platformProfit: s.todayPlatformProfit != null ? s.todayPlatformProfit : s.platformProfit || 0,
      currency: process.env.HOME_STATS_CURRENCY || "MYR",
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      configured: true,
      message: error.message || "今日平台数据加载失败",
      date,
      timezone,
    });
  }
}
