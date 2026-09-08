/**
 * Offline: homepage daily stats must match admin dashboard口径 + KL timezone day.
 * node scripts/verify-home-daily-stats.mjs
 */
import assert from "node:assert/strict";
import { buildDashboardStats } from "../server/api/admin/dashboard.js";
import { buildHomeDailyStatsPayload } from "../server/api/home/daily-stats.js";
import { isCreatedOnLocalDay, localDateYmd, PLATFORM_STATS_TIMEZONE } from "../server/api/_platform-day.js";

const realBoss = { id: "boss-real", role: "boss", email: "realboss@gmail.com", display_name: "xiaohou" };
const realComp = { id: "comp-real", role: "companion", email: "comp@gmail.com", display_name: "凝梦" };
const smokeBoss = {
  id: "boss-smoke",
  role: "boss",
  email: "a@guerrillamailblock.com",
  display_name: "ProdSmokeBoss2",
};

// KL midnight boundary: 2026-09-03 00:30 MYT = 2026-09-02T16:30:00.000Z
const klMorningOrder = {
  id: "o-kl-morning",
  status: "completed",
  total_amount: 238,
  created_at: "2026-09-02T16:30:00.000Z",
  boss_id: realBoss.id,
  companion_id: realComp.id,
};
const utcSameCalendarButPrevKlDay = {
  id: "o-utc-prev",
  status: "completed",
  total_amount: 100,
  created_at: "2026-09-02T10:00:00.000Z", // still Sep 2 afternoon KL
  boss_id: realBoss.id,
  companion_id: realComp.id,
};
const unpaidToday = {
  id: "o-unpaid",
  status: "awaiting_payment",
  total_amount: 999,
  created_at: "2026-09-02T18:00:00.000Z", // Sep 3 02:00 KL
  boss_id: realBoss.id,
  companion_id: realComp.id,
};
const smokeToday = {
  id: "o-smoke",
  status: "completed",
  total_amount: 6000,
  created_at: "2026-09-02T18:00:00.000Z",
  boss_id: smokeBoss.id,
  companion_id: realComp.id,
};

const now = new Date("2026-09-03T04:00:00.000Z"); // Sep 3 noon-ish KL
assert.equal(localDateYmd(now, PLATFORM_STATS_TIMEZONE), "2026-09-03");
assert.equal(isCreatedOnLocalDay(klMorningOrder.created_at, "2026-09-03"), true);
assert.equal(isCreatedOnLocalDay(utcSameCalendarButPrevKlDay.created_at, "2026-09-03"), false);

const profiles = [realBoss, realComp, smokeBoss];
const orders = [klMorningOrder, utcSameCalendarButPrevKlDay, unpaidToday, smokeToday];

const admin = buildDashboardStats({ profiles, orders, withdrawals: [], now });
const home = buildHomeDailyStatsPayload({
  profiles,
  orders,
  onlineCompanions: 2,
  now,
});

assert.equal(admin.stats.todayOrders, 1, "admin: only real completed KL-today order");
assert.equal(admin.stats.todayAmount, 238, "admin: todayAmount from that order");
assert.equal(home.ordersCreated, admin.stats.todayOrders, "home orders == admin todayOrders");
assert.equal(home.todayOrders, admin.stats.todayOrders);
assert.equal(home.grossRevenue, admin.stats.todayAmount, "home revenue == admin todayAmount");
assert.equal(home.todayAmount, admin.stats.todayAmount);
assert.equal(home.onlineCompanions, 2);
assert.equal(home.timezone, PLATFORM_STATS_TIMEZONE);
assert.equal(home.date, "2026-09-03");
assert.equal(home.filter.source, "admin_dashboard_buildDashboardStats");

// Unpaid + smoke must not inflate homepage "今日有效订单 / 今日营业额"
assert.notEqual(home.ordersCreated, 3);
assert.notEqual(home.grossRevenue, 238 + 999 + 6000);

console.log(
  JSON.stringify(
    {
      ok: true,
      timezone: home.timezone,
      date: home.date,
      homeOrders: home.ordersCreated,
      homeRevenue: home.grossRevenue,
      adminTodayOrders: admin.stats.todayOrders,
      adminTodayAmount: admin.stats.todayAmount,
      aligned: true,
    },
    null,
    2
  )
);
