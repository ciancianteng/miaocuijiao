/**
 * Browser-side mirror of canonical order statuses (no secrets).
 * Keep in sync with server/api/_order-status.js labels.
 */
(function (global) {
  var LABELS = {
    awaiting_payment: "待付款",
    pending: "待接单",
    waiting_boss_confirm: "选择陪玩中",
    claimed: "待陪玩确认",
    confirmed: "待开始",
    in_progress: "进行中",
    completed: "已完成",
    reviewed: "已评价",
    cancelled: "已取消",
    refund_requested: "售后",
    refunded: "已退款",
  };
  var ALIASES = {
    pending_payment: "awaiting_payment",
    unpaid: "awaiting_payment",
    waiting_payment: "awaiting_payment",
    draft: "awaiting_payment",
    pending_grab: "pending",
    selecting: "waiting_boss_confirm",
    pending_companion_confirm: "claimed",
    paid: "claimed",
    waiting_companion_confirm: "claimed",
    waiting_companion: "claimed",
    companion_confirmed: "pending",
    waiting_cs_assign: "pending",
    after_sale: "refund_requested",
  };
  function normalize(raw) {
    var key = String(raw || "").trim().toLowerCase();
    if (!key) return "awaiting_payment";
    if (LABELS[key]) return key;
    return ALIASES[key] || key;
  }
  function label(status) {
    var key = normalize(status);
    return LABELS[key] || key;
  }
  function isPreviewHost() {
    var h = String((global.location && global.location.hostname) || "");
    if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
    // Vercel Preview hostnames: *-projects.vercel.app (Production often uses custom domain).
    return /\.vercel\.app$/i.test(h) && !/^www\./i.test(h);
  }
  global.MCJOrderStatus = {
    LABELS: LABELS,
    normalize: normalize,
    label: label,
    isPreviewHost: isPreviewHost,
  };
})(typeof window !== "undefined" ? window : globalThis);
