/**
 * Shared companion online presence — one source of truth for labels/codes.
 * Surfaces: homepage cards, companion hall, profile detail, place-order modal,
 * companion workbench (writes via companion API; reads same codes/labels).
 *
 * Codes: online | busy | paused | offline
 * Labels follow active locale via MCJI18n.
 */
(function (global) {
  "use strict";

  var LABEL_KEYS = {
    online: "presence.online",
    busy: "presence.busy",
    paused: "presence.paused",
    offline: "presence.offline",
  };
  var LABELS_FALLBACK = {
    online: "在线可接单",
    busy: "忙碌中",
    paused: "暂停接单",
    offline: "离线",
  };

  function tt(key, fallback) {
    try {
      if (global.MCJI18n && typeof global.MCJI18n.t === "function") {
        var out = global.MCJI18n.t(key);
        if (out && out !== key) return out;
      }
    } catch (e) {}
    return fallback;
  }

  function labelsMap() {
    return {
      online: tt(LABEL_KEYS.online, LABELS_FALLBACK.online),
      busy: tt(LABEL_KEYS.busy, LABELS_FALLBACK.busy),
      paused: tt(LABEL_KEYS.paused, LABELS_FALLBACK.paused),
      offline: tt(LABEL_KEYS.offline, LABELS_FALLBACK.offline),
    };
  }

  function codeFrom(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return "";
    var lower = s.toLowerCase();
    if (lower === "online" || /在线可接单|^在线$|可接单|Available/i.test(s)) return "online";
    if (lower === "busy" || /忙碌|接单中|^Busy$/i.test(s)) return "busy";
    if (lower === "paused" || /暂停|^Paused$/i.test(s)) return "paused";
    if (lower === "offline" || /离线|下线|^Offline$/i.test(s)) return "offline";
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
      codeFrom(c.onlineStatusLabel) ||
      codeFrom(c.workStatus) ||
      "";
    if (!code) {
      if (c.online === true || c.canOrderNow === true || c.isOnline === true) code = "online";
      else code = "offline";
    }
    var labels = labelsMap();
    if (!labels[code]) code = "offline";
    return {
      code: code,
      label: labels[code],
      canOrderNow: code === "online",
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

  function refreshDomLabels() {
    try {
      document.querySelectorAll("[data-online-status]").forEach(function (el) {
        var code = el.getAttribute("data-online-status") || "offline";
        var label = labelsMap()[code] || labelsMap().offline;
        el.setAttribute("data-online-status-label", label);
        var texts = [];
        for (var i = 0; i < el.childNodes.length; i++) {
          if (el.childNodes[i].nodeType === 3) texts.push(el.childNodes[i]);
        }
        if (texts.length) texts[texts.length - 1].textContent = label;
        else if (!el.querySelector("i")) el.textContent = label;
      });
    } catch (e0) {}
  }

  global.MCJCompanionPresence = {
    get LABELS() {
      return labelsMap();
    },
    codeFrom: codeFrom,
    code: codeFrom,
    fromCompanion: fromCompanion,
    normalizeCompanionFields: normalizeCompanionFields,
    statusDotHtml: statusDotHtml,
    badgeClass: badgeClass,
    label: function (code) {
      var labels = labelsMap();
      return labels[codeFrom(code) || "offline"] || labels.offline;
    },
    refreshDomLabels: refreshDomLabels,
  };

  try {
    global.addEventListener("mcj:localechange", refreshDomLabels);
  } catch (e1) {}
})(typeof window !== "undefined" ? window : globalThis);
