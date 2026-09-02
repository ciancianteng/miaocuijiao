/**
 * Admin · Boss 等级（可配置升级门槛 + 分成% + 手动钉选）
 * 塞进现有 admin shell，不改布局壳子。历史结算不受等级变更影响。
 */
(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "bossLevelsMount";
  var state = {
    loading: true,
    busy: false,
    error: "",
    message: "",
    tablesReady: true,
    levels: [],
    form: {
      id: "",
      code: "",
      name: "",
      requiredActiveCompanions: "0",
      commissionRate: "0",
      sortOrder: "100",
      isEnabled: true,
    },
    pin: { bossId: "", levelCode: "silver", pinMode: "permanent", expiresAt: "", reason: "" },
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
      { Accept: "application/json", "Content-Type": "application/json", "x-mcj-admin-role": role() },
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
      box.innerHTML = '<div class="admin-sync-note">正在读取 Boss 等级…</div>';
      return;
    }
    var tip = "";
    if (state.error) tip += '<p class="admin-sync-note" style="color:#ff8aa0">' + esc(state.error) + "</p>";
    if (state.message) tip += '<p class="admin-sync-note" style="color:#86efac">' + esc(state.message) + "</p>";
    if (!state.tablesReady) {
      tip +=
        '<p class="admin-sync-note">表未初始化。请到「直属关系管理」执行 Staging Migration（含 20260903 levels/invites/safeguards）。</p>';
    }

    var levels = state.levels || [];
    var enabledCount = levels.filter(function (lv) {
      return lv.isEnabled !== false;
    }).length;
    var cards =
      levels
        .map(function (lv) {
          return (
            '<article class="bcr-level-card">' +
            '<div class="code">' +
            esc(lv.code) +
            "</div>" +
            '<div class="name">' +
            esc(lv.name) +
            "</div>" +
            '<div class="meta">' +
            '<span class="bcr-pill rate">分成 ' +
            esc(lv.commissionRate) +
            "%</span>" +
            '<span class="bcr-pill">门槛 ' +
            esc(lv.requiredActiveCompanions) +
            "</span>" +
            '<span class="bcr-pill ' +
            (lv.isEnabled ? "on" : "off") +
            '">' +
            (lv.isEnabled ? "启用" : "停用") +
            "</span>" +
            "</div>" +
            '<div class="bcr-actions"><button type="button" class="ghost-btn" data-bl-edit="' +
            esc(lv.id) +
            '">编辑</button></div>' +
            "</article>"
          );
        })
        .join("") || '<div class="empty">暂无等级</div>';

    var rows =
      levels
        .map(function (lv) {
          return (
            "<tr>" +
            "<td>" +
            esc(lv.code) +
            "</td>" +
            "<td>" +
            esc(lv.name) +
            "</td>" +
            "<td>" +
            esc(lv.requiredActiveCompanions) +
            "</td>" +
            "<td>" +
            esc(lv.commissionRate) +
            "%</td>" +
            "<td>" +
            (lv.isEnabled ? "启用" : "停用") +
            "</td>" +
            "<td>" +
            '<button type="button" class="ghost-btn" data-bl-edit="' +
            esc(lv.id) +
            '">编辑</button>' +
            "</td>" +
            "</tr>"
          );
        })
        .join("") || '<tr><td colspan="6" class="empty">暂无等级</td></tr>';

    box.innerHTML =
      tip +
      '<div class="bcr-hero"><h3>Boss 等级经营面板</h3><p>Boss 分成 = 平台抽成 × 等级/关系费率。等级变更<strong>不改</strong>历史已结算订单快照。手动钉选支持永久或到期。</p></div>' +
      '<div class="bcr-kpis">' +
      '<div class="bcr-kpi"><span>等级总数</span><strong>' +
      levels.length +
      "</strong></div>" +
      '<div class="bcr-kpi"><span>启用中</span><strong>' +
      enabledCount +
      "</strong></div>" +
      '<div class="bcr-kpi"><span>结算口径</span><strong style="font-size:14px">平台抽成内</strong></div>' +
      "</div>" +
      '<div class="admin-toolbar" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">' +
      '<button type="button" class="primary-btn" data-bl-reload' +
      (state.busy ? " disabled" : "") +
      ">刷新</button>" +
      '<button type="button" class="ghost-btn" data-bl-new' +
      (state.busy ? " disabled" : "") +
      ">新建等级</button>" +
      "</div>" +
      '<div class="bcr-level-grid">' +
      cards +
      "</div>" +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>code</th><th>名称</th><th>直属陪玩门槛</th><th>分成%(占平台抽成)</th><th>状态</th><th></th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div>" +
      '<div class="bcr-panel">' +
      "<h3>编辑等级规则</h3>" +
      '<div class="bcr-form-grid">' +
      '<label>id<input id="blId" value="' +
      esc(state.form.id) +
      '"></label>' +
      '<label>code<input id="blCode" value="' +
      esc(state.form.code) +
      '"></label>' +
      '<label>名称<input id="blName" value="' +
      esc(state.form.name) +
      '"></label>' +
      '<label>直属陪玩数门槛<input id="blReq" type="number" min="0" step="1" value="' +
      esc(state.form.requiredActiveCompanions) +
      '"></label>' +
      '<label>分成%<input id="blRate" type="number" min="0" max="100" step="0.01" value="' +
      esc(state.form.commissionRate) +
      '"></label>' +
      '<label>排序<input id="blSort" type="number" value="' +
      esc(state.form.sortOrder) +
      '"></label>' +
      '<label>启用<select id="blEnabled"><option value="1"' +
      (state.form.isEnabled ? " selected" : "") +
      '>是</option><option value="0"' +
      (!state.form.isEnabled ? " selected" : "") +
      ">否</option></select></label>" +
      "</div>" +
      '<div class="bcr-actions"><button type="button" class="primary-btn" data-bl-save' +
      (state.busy ? " disabled" : "") +
      ">保存等级</button></div>" +
      "</div>" +
      '<div class="bcr-panel">' +
      "<h3>手动钉选 / 重评</h3>" +
      '<div class="bcr-form-grid">' +
      '<label>老板 id / boss_uid<input id="blPinBoss" value="' +
      esc(state.pin.bossId) +
      '"></label>' +
      '<label>等级 code<input id="blPinCode" value="' +
      esc(state.pin.levelCode) +
      '"></label>' +
      '<label>钉选模式<select id="blPinMode"><option value="permanent"' +
      (state.pin.pinMode === "permanent" ? " selected" : "") +
      '>永久</option><option value="until_expiry"' +
      (state.pin.pinMode === "until_expiry" ? " selected" : "") +
      ">到期</option></select></label>" +
      '<label>到期时间（until_expiry）<input id="blPinExp" type="datetime-local" value="' +
      esc(state.pin.expiresAt) +
      '"></label>' +
      '<label class="reason-field">审计 reason（必填）<input id="blPinReason" value="' +
      esc(state.pin.reason) +
      '"></label>' +
      "</div>" +
      '<div class="bcr-actions">' +
      '<button type="button" class="primary-btn" data-bl-set-level' +
      (state.busy ? " disabled" : "") +
      ">手动设级</button>" +
      '<button type="button" class="ghost-btn" data-bl-clear-pin' +
      (state.busy ? " disabled" : "") +
      ">清钉选并自动重评</button>" +
      '<button type="button" class="ghost-btn" data-bl-reeval' +
      (state.busy ? " disabled" : "") +
      ">强制重评</button>" +
      "</div></div>";
  }

  function readForms() {
    state.form.id = (document.getElementById("blId") || {}).value || "";
    state.form.code = (document.getElementById("blCode") || {}).value || "";
    state.form.name = (document.getElementById("blName") || {}).value || "";
    state.form.requiredActiveCompanions = (document.getElementById("blReq") || {}).value || "0";
    state.form.commissionRate = (document.getElementById("blRate") || {}).value || "0";
    state.form.sortOrder = (document.getElementById("blSort") || {}).value || "100";
    state.form.isEnabled = String((document.getElementById("blEnabled") || {}).value || "1") !== "0";
    state.pin.bossId = (document.getElementById("blPinBoss") || {}).value || "";
    state.pin.levelCode = (document.getElementById("blPinCode") || {}).value || "";
    state.pin.pinMode = (document.getElementById("blPinMode") || {}).value || "permanent";
    state.pin.expiresAt = (document.getElementById("blPinExp") || {}).value || "";
    state.pin.reason = (document.getElementById("blPinReason") || {}).value || "";
  }

  function loadList() {
    state.loading = true;
    state.error = "";
    paint();
    return api("/api/admin/boss-levels?action=list")
      .then(function (body) {
        state.tablesReady = body.tablesReady !== false;
        state.levels = body.levels || [];
        state.message = body.message || state.message || "";
        state.loading = false;
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || "读取失败";
        state.tablesReady = false;
        paint();
      });
  }

  function fillEdit(id) {
    var lv = (state.levels || []).find(function (x) {
      return String(x.id) === String(id);
    });
    if (!lv) return;
    state.form = {
      id: lv.id || "",
      code: lv.code || "",
      name: lv.name || "",
      requiredActiveCompanions: String(lv.requiredActiveCompanions != null ? lv.requiredActiveCompanions : 0),
      commissionRate: String(lv.commissionRate != null ? lv.commissionRate : 0),
      sortOrder: String(lv.sortOrder != null ? lv.sortOrder : 100),
      isEnabled: lv.isEnabled !== false,
    };
    paint();
  }

  document.addEventListener("click", function (e) {
    if (!e.target.closest || !document.getElementById(TARGET)) return;
    if (e.target.closest("[data-bl-reload]")) {
      loadList();
      return;
    }
    if (e.target.closest("[data-bl-new]")) {
      state.form = {
        id: "",
        code: "",
        name: "",
        requiredActiveCompanions: "0",
        commissionRate: "0",
        sortOrder: "100",
        isEnabled: true,
      };
      paint();
      return;
    }
    var edit = e.target.closest("[data-bl-edit]");
    if (edit) {
      fillEdit(edit.getAttribute("data-bl-edit"));
      return;
    }
    if (e.target.closest("[data-bl-save]")) {
      readForms();
      state.busy = true;
      state.error = "";
      paint();
      api("/api/admin/boss-levels?action=upsert", {
        method: "POST",
        body: JSON.stringify({
          action: "upsert",
          id: state.form.id || undefined,
          code: state.form.code,
          name: state.form.name,
          requiredActiveCompanions: Number(state.form.requiredActiveCompanions),
          commissionRate: Number(state.form.commissionRate),
          sortOrder: Number(state.form.sortOrder),
          isEnabled: state.form.isEnabled,
        }),
      })
        .then(function (body) {
          state.busy = false;
          state.message = body.message || "已保存";
          return loadList();
        })
        .catch(function (err) {
          state.busy = false;
          state.error = err.message || "保存失败";
          paint();
        });
      return;
    }
    if (e.target.closest("[data-bl-set-level]")) {
      readForms();
      if (!state.pin.reason.trim()) {
        state.error = "手动设级必须填写 reason";
        paint();
        return;
      }
      var expiresAt = state.pin.expiresAt
        ? new Date(state.pin.expiresAt).toISOString()
        : null;
      state.busy = true;
      paint();
      api("/api/admin/boss-levels?action=set-level", {
        method: "POST",
        body: JSON.stringify({
          action: "set-level",
          bossId: state.pin.bossId,
          levelCode: state.pin.levelCode,
          pinMode: state.pin.pinMode,
          expiresAt: expiresAt,
          pinExpiresAt: expiresAt,
          reason: state.pin.reason,
        }),
      })
        .then(function (body) {
          state.busy = false;
          state.message = body.message || "已设级";
          paint();
        })
        .catch(function (err) {
          state.busy = false;
          state.error = err.message || "设级失败";
          paint();
        });
      return;
    }
    if (e.target.closest("[data-bl-clear-pin]") || e.target.closest("[data-bl-reeval]")) {
      readForms();
      var force = !!e.target.closest("[data-bl-reeval]");
      var act = force ? "reevaluate" : "clear-pin";
      if (!state.pin.reason.trim() && !force) {
        state.error = "清钉选必须填写 reason";
        paint();
        return;
      }
      state.busy = true;
      paint();
      api("/api/admin/boss-levels?action=" + encodeURIComponent(act), {
        method: "POST",
        body: JSON.stringify({
          action: act,
          bossId: state.pin.bossId,
          reason: state.pin.reason || "admin_reevaluate",
          force: force,
        }),
      })
        .then(function (body) {
          state.busy = false;
          state.message = body.message || "完成";
          paint();
        })
        .catch(function (err) {
          state.busy = false;
          state.error = err.message || "操作失败";
          paint();
        });
      return;
    }
    var btn = e.target.closest('[data-section="boss-levels"]');
    if (btn) loadList();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if (target()) loadList();
    });
  } else if (target()) {
    loadList();
  }
})();
