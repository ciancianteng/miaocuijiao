function todayInTimezone(timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(new Date());
}

module.exports = function handler(req, res) {
  const timezone = process.env.HOME_STATS_TIMEZONE || "Asia/Kuala_Lumpur";
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).json({
    date: todayInTimezone(timezone),
    timezone,
    ordersCreated: 0,
    ordersCompleted: 0,
    newCustomers: 0,
    newCompanions: 0,
    onlineCompanions: 0,
    grossRevenue: 0,
    currency: process.env.HOME_STATS_CURRENCY || "MYR"
  });
};
