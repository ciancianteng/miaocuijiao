/**
 * Boss personal-center action sections (below VIP card only).
 * Does NOT touch VIP membership card markup/CSS/logic.
 */
(function (global) {
  "use strict";

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function ico(kind) {
    var common =
      ' class="bca-ico-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
    if (kind === "orders") {
      return (
        "<svg" +
        common +
        '><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>'
      );
    }
    if (kind === "recharge") {
      return (
        "<svg" +
        common +
        '><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="16" cy="14.5" r="1.25"/></svg>'
      );
    }
    if (kind === "gifts") {
      return (
        "<svg" +
        common +
        '><path d="M20 12v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8"/><path d="M12 22V7"/><path d="M3.5 7h17v5H3.5z"/><path d="M12 7c-1.8-2.8-5-2.8-5 0 0 2.2 2.8 3.2 5 4.2 2.2-1 5-2 5-4.2 0-2.8-3.2-2.8-5 0z"/></svg>'
      );
    }
    if (kind === "direct") {
      return (
        "<svg" +
        common +
        '><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="3.5"/><path d="M20 8v6M17 11h6"/></svg>'
      );
    }
    if (kind === "profile") {
      return (
        "<svg" +
        common +
        '><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>'
      );
    }
    if (kind === "assets") {
      return (
        "<svg" +
        common +
        '><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><path d="M8 14.5h3"/></svg>'
      );
    }
    if (kind === "points") {
      return (
        "<svg" +
        common +
        '><path d="M12 3l2.2 5.4L20 9.3l-4 3.9.9 5.6L12 16.2 7.1 18.8l.9-5.6-4-3.9 5.8-.9L12 3z"/></svg>'
      );
    }
    if (kind === "security") {
      return (
        "<svg" +
        common +
        '><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><path d="M9.5 12l1.8 1.8L14.8 10"/></svg>'
      );
    }
    if (kind === "guide") {
      return (
        "<svg" +
        common +
        '><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v15H6.5A2.5 2.5 0 0 0 4 19.5V4.5A2.5 2.5 0 0 1 6.5 2z"/></svg>'
      );
    }
    if (kind === "pwa") {
      return (
        "<svg" +
        common +
        '><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/><path d="M12 6v5M9.5 8.5 12 6l2.5 2.5"/></svg>'
      );
    }
    if (kind === "notify") {
      return (
        "<svg" +
        common +
        '><path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5"/><path d="M9.5 17a2.5 2.5 0 0 0 5 0"/></svg>'
      );
    }
    if (kind === "support") {
      return (
        "<svg" +
        common +
        '><path d="M4 13v-1a8 8 0 0 1 16 0v1"/><path d="M4 13a2.5 2.5 0 0 0 2.5 2.5H8v-5H6.5A2.5 2.5 0 0 0 4 13z"/><path d="M20 13a2.5 2.5 0 0 1-2.5 2.5H16v-5h1.5A2.5 2.5 0 0 1 20 13z"/><path d="M19 15.5V17a3 3 0 0 1-3 3h-2"/></svg>'
      );
    }
    return "";
  }

  function quickTile(href, kind, label) {
    return (
      '<a class="bca-quick-item" href="' +
      esc(href) +
      '" aria-label="' +
      esc(label) +
      '">' +
      '<span class="bca-quick-ico" aria-hidden="true">' +
      ico(kind) +
      "</span>" +
      '<span class="bca-quick-label">' +
      esc(label) +
      "</span></a>"
    );
  }

  function listRow(opts) {
    var tag = opts.tag || "a";
    var attrs = opts.attrs || "";
    var kind = opts.kind || "";
    var label = opts.label || "";
    return (
      "<" +
      tag +
      ' class="bca-row" ' +
      attrs +
      ">" +
      '<span class="bca-row-ico" aria-hidden="true">' +
      ico(kind) +
      "</span>" +
      '<span class="bca-row-label">' +
      esc(label) +
      "</span>" +
      '<span class="bca-row-chevron" aria-hidden="true"></span>' +
      "</" +
      tag +
      ">"
    );
  }

  /**
   * @param {{ hasCompanion?: boolean }} opts
   */
  function renderBossCenterActions(opts) {
    var o = opts && typeof opts === "object" ? opts : {};
    var companionStrip = o.hasCompanion
      ? '<div class="bca-portal-strip"><button type="button" class="bca-portal-link" data-switch-portal="companion">切换到陪玩端</button></div>'
      : '<div class="bca-portal-strip"><a class="bca-portal-link" href="companion-apply.html">申请成为陪玩</a></div>';

    return (
      '<div class="bca-root" data-boss-center-actions="1">' +
      '<section class="bca-section" aria-labelledby="bcaQuickTitle">' +
      '<h3 class="bca-section-title" id="bcaQuickTitle">常用功能</h3>' +
      '<div class="bca-quick" role="navigation" aria-label="常用功能">' +
      quickTile("/orders.html", "orders", "我的订单") +
      quickTile("/recharge.html", "recharge", "充值") +
      quickTile("gifts.html", "gifts", "礼物中心") +
      quickTile("my-direct-companions.html", "direct", "直属陪玩") +
      "</div>" +
      "</section>" +
      '<section class="bca-section" aria-labelledby="bcaAccountTitle">' +
      '<h3 class="bca-section-title" id="bcaAccountTitle">账号管理</h3>' +
      '<div class="bca-card">' +
      listRow({
        tag: "button",
        kind: "profile",
        label: "编辑资料",
        attrs: 'type="button" data-mine-feature="profile" aria-haspopup="dialog"',
      }) +
      listRow({
        tag: "button",
        kind: "assets",
        label: "我的资产",
        attrs: 'type="button" data-mine-feature="assets" aria-haspopup="dialog"',
      }) +
      listRow({
        tag: "a",
        kind: "points",
        label: "我的积分",
        attrs: 'href="points.html"',
      }) +
      listRow({
        tag: "button",
        kind: "security",
        label: "账号安全",
        attrs: 'type="button" data-mine-feature="security" aria-haspopup="dialog"',
      }) +
      "</div>" +
      "</section>" +
      '<section class="bca-section" aria-labelledby="bcaHelpTitle">' +
      '<h3 class="bca-section-title" id="bcaHelpTitle">设置与帮助</h3>' +
      '<div class="bca-card">' +
      listRow({
        tag: "a",
        kind: "guide",
        label: "老板使用教学",
        attrs: 'href="/guide.html?role=boss" data-boss-tutorial-entry="1"',
      }) +
      listRow({
        tag: "button",
        kind: "pwa",
        label: "添加妙脆角到主屏幕",
        attrs: 'type="button" data-pwa-install',
      }) +
      listRow({
        tag: "button",
        kind: "notify",
        label: "消息通知",
        attrs: 'type="button" data-open-notify-settings',
      }) +
      listRow({
        tag: "a",
        kind: "support",
        label: "联系客服",
        attrs: 'href="/support.html"',
      }) +
      "</div>" +
      "</section>" +
      companionStrip +
      "</div>"
    );
  }

  global.MCJBossCenterActions = {
    render: renderBossCenterActions,
  };
})(typeof window !== "undefined" ? window : globalThis);
