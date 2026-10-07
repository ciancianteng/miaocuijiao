/**
 * Boss-facing "客服在线时间" badge. Window comes from /api/platform/settings
 * (csOnlineHoursStart / csOnlineHoursEnd, edited in 后台 → 系统设置 → 平台信息) and is
 * evaluated in Asia/Kuala_Lumpur, never device time. Purely informational: never blocks ordering.
 *
 * Fills every [data-cs-online-badge] node ("full" or "compact") and keeps them current.
 */
(function () {
  "use strict";
  if (window.MCJCsOnlineHours) return;

  var TZ = "Asia/Kuala_Lumpur";
  var CACHE_KEY = "mcjCsOnlineHours.v1";
  var CACHE_MS = 10 * 60 * 1000;
  var HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
  var hours = { start: "09:00", end: "12:00" };
  var loaded = false;

  function myNowHHMM(now) {
    var parts = {};
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now || new Date())
      .forEach(function (p) {
        parts[p.type] = p.value;
      });
    return parts.hour + ":" + parts.minute;
  }
  function isOnline(now) {
    var t = myNowHHMM(now);
    if (hours.start === hours.end) return false;
    if (hours.start < hours.end) return t >= hours.start && t < hours.end;
    return t >= hours.start || t < hours.end;
  }
  function plain(hhmm) {
    return Number(hhmm.slice(0, 2)) + ":" + hhmm.slice(3);
  }
  function windowText() {
    var h = Number(hours.start.slice(0, 2));
    var period = h < 12 ? "早上" : h < 18 ? "下午" : "晚上";
    return period + " " + plain(hours.start) + " – " + plain(hours.end);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function html(mode) {
    var on = isOnline();
    if (mode === "compact") {
      return (
        '<span class="mcj-cs-hours-pill' + (on ? " is-on" : "") + '" title="客服在线时间：' + esc(windowText()) + '（马来西亚时间）">' +
        (on ? "客服在线" : "非客服在线时段") +
        "</span>"
      );
    }
    return (
      '<div class="mcj-cs-hours' + (on ? " is-on" : "") + '" role="status" data-cs-online-state="' + (on ? "online" : "offline") + '">' +
      '<span class="mcj-cs-hours-dot" aria-hidden="true"></span>' +
      '<span class="mcj-cs-hours-text"><strong>' + (on ? "客服在线" : "非客服在线时段") + "</strong>" +
      "<span>客服在线时间：" + esc(windowText()) + "（马来西亚时间）</span>" +
      (on ? "" : "<span>当前非客服在线时段，可先提交需求，我们会在客服时间处理。</span>") +
      "</span></div>"
    );
  }
  function paint() {
    document.querySelectorAll("[data-cs-online-badge]").forEach(function (el) {
      var mode = el.getAttribute("data-cs-online-badge") === "compact" ? "compact" : "full";
      var next = html(mode);
      if (el.__mcjCsHours !== next) {
        el.__mcjCsHours = next;
        el.innerHTML = next;
      }
    });
  }
  function apply(src) {
    if (src && HHMM.test(String(src.csOnlineHoursStart || ""))) hours.start = src.csOnlineHoursStart;
    if (src && HHMM.test(String(src.csOnlineHoursEnd || ""))) hours.end = src.csOnlineHoursEnd;
  }
  function load() {
    try {
      var cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
      if (cached && Date.now() - cached.at < CACHE_MS) {
        apply(cached);
        loaded = true;
        paint();
        return Promise.resolve(hours);
      }
    } catch (e) {}
    return fetch("/api/platform/settings", { headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.json();
      })
      .then(function (body) {
        apply((body && body.settings) || {});
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), csOnlineHoursStart: hours.start, csOnlineHoursEnd: hours.end }));
        } catch (e) {}
      })
      .catch(function () {})
      .then(function () {
        loaded = true;
        paint();
        return hours;
      });
  }
  function ensureCss() {
    if (document.querySelector("link[data-mcj-cs-hours-css]")) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/src/cs-online-hours.css?v=20261007b1528";
    link.setAttribute("data-mcj-cs-hours-css", "1");
    document.head.appendChild(link);
  }

  window.MCJCsOnlineHours = {
    html: html,
    isOnline: isOnline,
    hours: function () {
      return { start: hours.start, end: hours.end, loaded: loaded };
    },
    paint: paint,
    load: load,
  };

  function start() {
    ensureCss();
    load();
    if (typeof MutationObserver === "function") {
      var pending = false;
      new MutationObserver(function () {
        if (pending) return;
        pending = true;
        setTimeout(function () {
          pending = false;
          paint();
        }, 50);
      }).observe(document.body, { childList: true, subtree: true });
    }
    setInterval(paint, 60 * 1000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
