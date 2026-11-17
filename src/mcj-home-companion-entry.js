/**
 * Home-only companion entry CTA — do NOT load full companion-application.js on homepage.
 * Prefer live companion bootstrap when a companion session exists; fall back to localStorage.
 */
(function () {
  "use strict";

  function existingApplication() {
    try {
      var raw = localStorage.getItem("mcjCompanionApplication") || localStorage.getItem("companionApplication");
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function companionToken() {
    try {
      var raw = localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession") || "";
      if (!raw) return "";
      var parsed = JSON.parse(raw);
      return String((parsed && (parsed.token || parsed.accessToken)) || "").trim();
    } catch (e) {
      return "";
    }
  }

  function isApproved(app) {
    if (!app) return false;
    var st = String(app.status || app.applicationStatus || app.auditStatus || "").toLowerCase();
    return /approved|verified|passed|已通过/.test(st);
  }

  function isPending(app) {
    if (!app) return false;
    var st = String(app.status || app.applicationStatus || app.auditStatus || "").toLowerCase();
    return /pending|review|submitted|审核中|待审核/.test(st);
  }

  function paint(entry, mode) {
    if (!entry) return;
    if (mode === "approved") {
      entry.href = "/companion/dashboard/";
      entry.innerHTML = "<i>🐱</i><div><strong>陪玩工作台</strong><span>审核已通过，进入工作台接单</span></div>";
      return;
    }
    if (mode === "pending") {
      entry.href = "/companion/review-status/";
      entry.innerHTML = "<i>🐱</i><div><strong>审核进度</strong><span>资料审核中，点击查看进度</span></div>";
    }
  }

  function initFromLocal(entry) {
    var app = existingApplication();
    if (isApproved(app)) paint(entry, "approved");
    else if (isPending(app)) paint(entry, "pending");
  }

  function initFromApi(entry) {
    var token = companionToken();
    if (!token) {
      initFromLocal(entry);
      return;
    }
    fetch("/api/companion", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        "x-mcj-access-token": token,
      },
      body: JSON.stringify({ action: "bootstrap" }),
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "bootstrap failed");
          return body;
        });
      })
      .then(function (body) {
        var player = (body && body.player) || {};
        var status = String(player.auditStatus || player.applicationStatus || "").toLowerCase();
        var app = { status: status, applicationStatus: status, auditStatus: status };
        try {
          localStorage.setItem("mcjCompanionApplication", JSON.stringify(app));
        } catch (e) {}
        if (isApproved(app)) paint(entry, "approved");
        else if (isPending(app)) paint(entry, "pending");
        else if (/need_more|resubmit|rejected|draft/.test(status)) entry.href = "/companion/review-status/";
      })
      .catch(function () {
        initFromLocal(entry);
      });
  }

  function init() {
    var entry = document.querySelector("[data-companion-entry]");
    if (!entry) return;
    initFromLocal(entry);
    initFromApi(entry);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
