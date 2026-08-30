/**
 * Admin · Boss loyalty points settings (order completion award).
 * Independent from companion popularity.
 */
(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "pointsSettingsMount";
  var state = {
    loading: true,
    saving: false,
    error: "",
    message: "",
    orderCompletionPoints: 100,
    tablesReady: true,
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function role() {
    try {
      return (
        JSON.parse(localStorage.getItem("adminUser") || sessionStorage.getItem("adminUser") || "{}")
          .adminRole || "admin"
      );
    } catch (e) {
      return "admin";
    }
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign(
      { Accept: "application/json", "x-mcj-admin-role": role() },
      opts.headers || {}
    );
    return (Auth && Auth.fetch ? Auth.fetch(path, opts) : fetch(path, opts)).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.ok === false) throw new Error(body.message || "请求失败");
        return body;
      });
    });
  }

  function target() {
    return document.getElementById(TARGET);
  }

  function paint() {
    var box = target();
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="admin-sync-note">正在读取积分设置...</div>';
      return;
    }

    var tip = "";
    if (state.error) tip += '<p class="admin-sync-note" style="color:#ff8aa0">' + esc(state.error) + "</p>";
    if (state.message) tip += '<p class="admin-sync-note" style="color:#86efac">' + esc(state.message) + "</p>";
    if (!state.tablesReady) {
      tip +=
        '<p class="admin-sync-note">积分设置表未初始化时，发分仍 fallback 为 100；请在 Staging 执行 migration。</p>';
    }

    box.innerHTML =
      tip +
      '<form class="payment-editor" data-points-settings-form>' +
      '<section class="panel" style="margin:0;padding:0;border:0;background:transparent">' +
      "<h3 style=\"margin:0 0 8px;font-size:16px\">Boss 完成订单奖励积分</h3>" +
      '<p class="admin-sync-note" style="margin:0 0 14px">仅影响修改之后新完成的订单；已完成订单不补发、不重算。与陪玩人气积分相互独立。</p>' +
      '<div class="payment-field-grid" style="max-width:420px">' +
      "<label><span>Boss 完成订单奖励积分</span>" +
      '<input name="orderCompletionPoints" type="number" inputmode="numeric" min="0" step="1" required value="' +
      esc(state.orderCompletionPoints) +
      '"></label>' +
      "</div>" +
      '<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
      '<button class="mini-btn primary-lite" type="submit" data-points-save' +
      (state.saving ? " disabled" : "") +
      ">" +
      (state.saving ? "保存中…" : "保存设置") +
      "</button>" +
      '<button class="mini-btn" type="button" data-points-reload' +
      (state.saving ? " disabled" : "") +
      ">刷新</button>" +
      "</div>" +
      "</section></form>";
  }

  function load() {
    state.loading = true;
    state.error = "";
    state.message = "";
    paint();
    return api("/api/admin/points-settings")
      .then(function (body) {
        var s = body.settings || {};
        state.orderCompletionPoints =
          s.orderCompletionPoints != null ? Number(s.orderCompletionPoints) : 100;
        if (!Number.isFinite(state.orderCompletionPoints) || state.orderCompletionPoints < 0) {
          state.orderCompletionPoints = 100;
        }
        state.tablesReady = body.tablesReady !== false;
        if (body.message) state.message = body.message;
        state.loading = false;
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || "读取积分设置失败";
        paint();
      });
  }

  function save(form) {
    if (state.saving) return;
    var raw = form.elements.orderCompletionPoints.value;
    if (!/^\d+$/.test(String(raw).trim())) {
      state.error = "请输入大于等于 0 的整数。";
      state.message = "";
      paint();
      return;
    }
    var value = Number(String(raw).trim());
    if (!Number.isInteger(value) || value < 0) {
      state.error = "请输入大于等于 0 的整数。";
      state.message = "";
      paint();
      return;
    }

    state.saving = true;
    state.error = "";
    state.message = "";
    paint();
    api("/api/admin/points-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderCompletionPoints: value }),
    })
      .then(function (body) {
        var s = body.settings || {};
        state.orderCompletionPoints =
          s.orderCompletionPoints != null ? Number(s.orderCompletionPoints) : value;
        state.tablesReady = body.tablesReady !== false;
        state.message = body.message || "积分设置已保存";
        state.saving = false;
        paint();
      })
      .catch(function (err) {
        state.saving = false;
        state.error = err.message || "保存失败";
        paint();
      });
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-points-reload]")) {
      e.preventDefault();
      load();
    }
  });

  document.addEventListener("submit", function (e) {
    var form = e.target.closest("[data-points-settings-form]");
    if (!form) return;
    e.preventDefault();
    save(form);
  });

  function boot() {
    if (!target()) return;
    load();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest('[data-section="points-settings"]');
    if (btn) setTimeout(boot, 0);
  });
})();
