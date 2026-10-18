/**
 * Notification destinations from kind + real business id.
 * Appointment ids are never treated as order ids.
 * A missing id stays on the current page with a message.
 */
(function (root) {
  "use strict";

  function bossNotifyTarget(item) {
    item = item || {};
    var kind = String(item.kind || "").trim().toLowerCase();
    var id = String(item.relatedId || item.related_id || "").trim();
    if (!kind) {
      return { ok: false, message: "这条通知缺少类型，已保持在当前页。" };
    }
    if (kind === "appointment") {
      return { ok: false, message: "这是预约通知，不能按订单打开。请到预约页面查看。" };
    }
    if (kind === "order" || kind.indexOf("order") === 0) {
      if (!id) return { ok: false, message: "这条订单通知缺少订单编号，已保持在当前页。" };
      return { ok: true, url: "/orders.html?id=" + encodeURIComponent(id) };
    }
    if (kind === "cs_reply" || kind === "support" || kind === "customer_service") {
      if (!id) return { ok: false, message: "这条客服通知缺少关联编号，已保持在当前页。" };
      return { ok: true, url: "/support.html?order=" + encodeURIComponent(id) };
    }
    if (kind === "recharge" || kind === "wallet") {
      return { ok: true, url: "/recharge.html" };
    }
    if (kind === "gift") return { ok: true, url: "/gifts.html" };
    if (kind === "vip") return { ok: true, url: "/mine.html" };
    return { ok: false, message: "这条通知没有可打开的页面，已保持在当前页。" };
  }

  function portalReturnAllowed(role, pending, origin) {
    var raw = String(pending || "").trim();
    if (!raw) return "";
    var base = origin || "https://meow.local";
    var url;
    try {
      url = new URL(raw, base);
    } catch (e) {
      return "";
    }
    if (url.origin !== new URL(base).origin) return "";
    var path = url.pathname || "/";
    var roleName = String(role || "").trim().toLowerCase();
    if (roleName === "player") roleName = "companion";
    if (roleName === "cs" || roleName === "service") roleName = "customer_service";
    if (roleName === "companion") {
      return /^\/companion\//i.test(path) ? url.pathname + url.search + url.hash : "";
    }
    if (roleName === "customer_service") {
      return /^\/customer-service\//i.test(path) ? url.pathname + url.search + url.hash : "";
    }
    if (roleName === "boss") {
      if (/^\/(companion|customer-service|admin)(\/|$)/i.test(path)) return "";
      return url.pathname + url.search + url.hash;
    }
    return "";
  }

  var api = { bossNotifyTarget: bossNotifyTarget, portalReturnAllowed: portalReturnAllowed };
  root.MCJNotifyTarget = api;
  if (typeof exports === "object" && exports) {
    exports.bossNotifyTarget = bossNotifyTarget;
    exports.portalReturnAllowed = portalReturnAllowed;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
