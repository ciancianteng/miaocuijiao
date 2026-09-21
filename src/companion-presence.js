/**
 * Shared companion online presence — one source of truth for labels/codes.
 * Surfaces: homepage cards, companion hall, profile detail, place-order modal,
 * companion workbench (writes via companion API; reads same codes/labels).
 *
 * Codes: online | busy | paused | offline
 * Labels: 在线可接单 | 忙碌中 | 暂停接单 | 离线
 *
 * Boss order eligibility (must match server assertCompanionOrderable /
 * canCompanionAcceptBossOrder): online and busy can receive new orders;
 * paused and offline cannot.
 */
(function (global) {
  "use strict";

  var LABELS = {
    online: "在线可接单",
    busy: "忙碌中",
    paused: "暂停接单",
    offline: "离线",
  };

  function truthyFlag(v) {
    return v === true || v === 1 || v === "1" || v === "true";
  }

  function falsyFlag(v) {
    return v === false || v === 0 || v === "0" || v === "false";
  }

  function codeFrom(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return "";
    var lower = s.toLowerCase();
    // Reject 不可接单 before the looser 可接单 substring.
    if (/不可接/.test(s) && !/在线可接单/.test(s)) return "paused";
    if (lower === "online" || /在线可接单/.test(s) || /^在线$/.test(s)) return "online";
    if (lower === "busy" || /忙碌|接单中/.test(s)) return "busy";
    if (lower === "paused" || /暂停/.test(s)) return "paused";
    if (lower === "offline" || /离线|下线/.test(s)) return "offline";
    if (/可接单/.test(s) && !/不可/.test(s)) return "online";
    return "";
  }

  function fromCompanion(c) {
    c = c || {};
    var code =
      codeFrom(c.availabilityStatus) ||
      codeFrom(c.availability_status) ||
      codeFrom(c.online_status) ||
      (/^(online|busy|paused|offline)$/i.test(String(c.onlineStatus || ""))
        ? codeFrom(c.onlineStatus)
        : "") ||
      codeFrom(c.availabilityText) ||
      codeFrom(c.status) ||
      codeFrom(c.statusText) ||
      codeFrom(c.onlineStatusLabel) ||
      codeFrom(c.workStatus) ||
      "";
    if (!code) {
      if (truthyFlag(c.canAcceptBossOrder) || truthyFlag(c.canOrderNow) || truthyFlag(c.isOnline)) {
        code = "online";
      } else if (truthyFlag(c.online)) {
        code = "online";
      } else if (falsyFlag(c.online) || falsyFlag(c.canOrderNow)) {
        code = "offline";
      } else {
        code = "offline";
      }
    }
    if (!LABELS[code]) code = "offline";
    var canAcceptBossOrder = code === "online" || code === "busy";
    return {
      code: code,
      label: LABELS[code],
      canOrderNow: code === "online",
      canAcceptBossOrder: canAcceptBossOrder,
      className: "is-" + code,
    };
  }

  function normalizeCompanionFields(c) {
    if (!c || typeof c !== "object") return c;
    var p = fromCompanion(c);
    c.availabilityStatus = p.code;
    c.availabilityText = p.label;
    c.onlineStatus = p.label;
    c.status = p.label;
    c.onlineStatusLabel = p.label;
    c.canOrderNow = p.canOrderNow;
    c.canAcceptBossOrder = p.canAcceptBossOrder;
    c.online = p.code === "online" || p.code === "busy";
    return c;
  }

  function statusDotHtml(c, escFn) {
    var p = fromCompanion(c);
    var esc =
      typeof escFn === "function"
        ? escFn
        : function (v) {
            return String(v == null ? "" : v).replace(/[&<>"']/g, function (ch) {
              return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
            });
          };
    return (
      '<span class="mcj-status-dot ' +
      p.className +
      '" data-online-status="' +
      esc(p.code) +
      '" data-online-status-label="' +
      esc(p.label) +
      '"><i></i>' +
      esc(p.label) +
      "</span>"
    );
  }

  function badgeClass(c) {
    return " " + fromCompanion(c).className;
  }

  function canAcceptBossOrder(c) {
    return fromCompanion(c).canAcceptBossOrder === true;
  }

  function unavailableReason(c) {
    var p = fromCompanion(c);
    if (p.code === "paused") return "该陪玩已暂停接单，请稍后再试";
    if (p.code === "offline") return "该陪玩当前离线，暂不可下单";
    if (p.canAcceptBossOrder) return "";
    return "该陪玩当前不可接单";
  }

  global.MCJCompanionPresence = {
    LABELS: LABELS,
    codeFrom: codeFrom,
    fromCompanion: fromCompanion,
    normalizeCompanionFields: normalizeCompanionFields,
    statusDotHtml: statusDotHtml,
    badgeClass: badgeClass,
    canAcceptBossOrder: canAcceptBossOrder,
    unavailableReason: unavailableReason,
    label: function (code) {
      return LABELS[codeFrom(code) || "offline"] || LABELS.offline;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
