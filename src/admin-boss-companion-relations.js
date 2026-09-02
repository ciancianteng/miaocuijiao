/**
 * Admin · 直属关系管理（Boss ↔ Companion）
 * Business UI only: list / search / bind / rebind / unbind / set-commission / history.
 * Developer migration / DB credential tools are intentionally not shown.
 */
(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "bossCompanionRelationsMount";
  var state = {
    loading: true,
    busy: false,
    error: "",
    message: "",
    tablesReady: true,
    q: "",
    status: "active",
    relations: [],
    history: [],
    historyCompanionId: "",
    form: { boss: "", companion: "", newBoss: "", remark: "", commissionRate: "", reason: "" },
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

  function statusLabel(s) {
    return ({ active: "生效中", unbound: "已解绑", replaced: "已换绑" })[s] || s || "-";
  }

  function paint() {
    var box = target();
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="admin-sync-note">正在读取直属关系…</div>';
      return;
    }

    var tip = "";
    if (state.error) tip += '<p class="admin-sync-note" style="color:#ff8aa0">' + esc(state.error) + "</p>";
    if (state.message) tip += '<p class="admin-sync-note" style="color:#86efac">' + esc(state.message) + "</p>";
    if (!state.tablesReady) {
      tip +=
        '<p class="admin-sync-note">直属关系功能暂未就绪。请联系技术同学完成表初始化后再进行绑定操作。</p>';
    }

    var rows =
      (state.relations || [])
        .map(function (r) {
          var boss = r.boss || {};
          var companion = r.companion || {};
          return (
            "<tr>" +
            "<td>" +
            esc(boss.displayName || "-") +
            "<div class='admin-sync-note'>" +
            esc(boss.bossUid || boss.id || "") +
            "</div></td>" +
            "<td>" +
            esc(companion.displayName || "-") +
            "<div class='admin-sync-note'>" +
            esc(companion.companionCode || companion.id || "") +
            "</div></td>" +
            "<td>" +
            esc(statusLabel(r.status)) +
            "</td>" +
            "<td>" +
            esc(r.commissionRate == null || r.commissionRate === "" ? "默认" : r.commissionRate + "%") +
            "</td>" +
            "<td>" +
            esc(r.boundAt ? String(r.boundAt).replace("T", " ").slice(0, 19) : "-") +
            "</td>" +
            "<td>" +
            '<button type="button" class="ghost-btn" data-bcr-history="' +
            esc(r.companionId) +
            '">历史</button> ' +
            (r.status === "active"
              ? '<button type="button" class="ghost-btn" data-bcr-set-rate="' +
                esc(r.id) +
                '" data-companion="' +
                esc(r.companionId) +
                '" data-rate="' +
                esc(r.commissionRate == null ? "" : r.commissionRate) +
                '">设分成</button> ' +
                '<button type="button" class="ghost-btn" data-bcr-unbind="' +
                esc(r.companionId) +
                '">解绑</button>'
              : "") +
            "</td>" +
            "</tr>"
          );
        })
        .join("") ||
      '<tr><td colspan="6" class="empty">暂无直属关系</td></tr>';

    var historyRows =
      (state.history || [])
        .map(function (e) {
          return (
            "<tr>" +
            "<td>" +
            esc(e.action) +
            "</td>" +
            "<td>" +
            esc((e.fromBoss && (e.fromBoss.bossUid || e.fromBoss.displayName)) || e.fromBossId || "-") +
            "</td>" +
            "<td>" +
            esc((e.toBoss && (e.toBoss.bossUid || e.toBoss.displayName)) || e.toBossId || "-") +
            "</td>" +
            "<td>" +
            esc(e.remark || "-") +
            "</td>" +
            "<td>" +
            esc(e.reason || "-") +
            "</td>" +
            "<td>" +
            esc(e.createdAt ? String(e.createdAt).replace("T", " ").slice(0, 19) : "-") +
            "</td>" +
            "</tr>"
          );
        })
        .join("") ||
      (state.historyCompanionId
        ? '<tr><td colspan="6" class="empty">暂无历史事件</td></tr>'
        : '<tr><td colspan="6" class="empty">点击列表「历史」查看</td></tr>');

    box.innerHTML =
      tip +
      '<div class="admin-toolbar" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;align-items:center">' +
      '<input id="bcrSearch" placeholder="搜索 boss_uid / PW编码 / 邮箱 / 昵称" value="' +
      esc(state.q) +
      '" style="min-width:220px;flex:1">' +
      '<select id="bcrStatus">' +
      '<option value=""' +
      (state.status === "" ? " selected" : "") +
      ">全部状态</option>" +
      '<option value="active"' +
      (state.status === "active" ? " selected" : "") +
      ">生效中</option>" +
      '<option value="unbound"' +
      (state.status === "unbound" ? " selected" : "") +
      ">已解绑</option>" +
      '<option value="replaced"' +
      (state.status === "replaced" ? " selected" : "") +
      ">已换绑</option>" +
      "</select>" +
      '<button type="button" class="primary-btn" data-bcr-search' +
      (state.busy ? " disabled" : "") +
      ">查询</button>" +
      "</div>" +
      '<div class="admin-card" style="margin-bottom:16px;padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:12px">' +
      "<h3 style='margin:0 0 10px;font-size:16px'>绑定 / 换绑</h3>" +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">' +
      '<label>老板（id / boss_uid）<input id="bcrBoss" value="' +
      esc(state.form.boss) +
      '"></label>' +
      '<label>陪玩（id / PW编码）<input id="bcrCompanion" value="' +
      esc(state.form.companion) +
      '"></label>' +
      '<label>换绑新老板（可选）<input id="bcrNewBoss" value="' +
      esc(state.form.newBoss) +
      '"></label>' +
      '<label>备注<input id="bcrRemark" value="' +
      esc(state.form.remark) +
      '"></label>' +
      '<label>直属分成%（占平台抽成，可空=用平台默认）<input id="bcrCommissionRate" type="number" min="0" max="100" step="0.01" value="' +
      esc(state.form.commissionRate) +
      '"></label>' +
      '<label>审计原因 reason（必填）<input id="bcrReason" required placeholder="谁/为何操作" value="' +
      esc(state.form.reason) +
      '"></label>' +
      "</div>" +
      '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="primary-btn" data-bcr-bind' +
      (state.busy || !state.tablesReady ? " disabled" : "") +
      ">绑定</button>" +
      '<button type="button" class="ghost-btn" data-bcr-rebind' +
      (state.busy || !state.tablesReady ? " disabled" : "") +
      ">换绑</button>" +
      "</div>" +
      '<p class="admin-sync-note" style="margin:8px 0 0">仅 Admin 可写。绑定/换绑/解绑/设分成必须填写 reason（审计）。≤1 活跃直属老板/陪玩。历史事件不可变。</p>' +
      "</div>" +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>老板</th><th>陪玩</th><th>状态</th><th>分成%</th><th>绑定时间</th><th>操作</th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div>" +
      '<h3 style="margin:18px 0 8px;font-size:16px">关系历史' +
      (state.historyCompanionId ? " · " + esc(state.historyCompanionId) : "") +
      "</h3>" +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>动作</th><th>原老板</th><th>新老板</th><th>备注</th><th>原因</th><th>时间</th></tr></thead><tbody>' +
      historyRows +
      "</tbody></table></div>";
  }

  function readForm() {
    state.q = (document.getElementById("bcrSearch") || {}).value || state.q;
    state.status = (document.getElementById("bcrStatus") || {}).value;
    if (state.status == null) state.status = "active";
    state.form.boss = (document.getElementById("bcrBoss") || {}).value || "";
    state.form.companion = (document.getElementById("bcrCompanion") || {}).value || "";
    state.form.newBoss = (document.getElementById("bcrNewBoss") || {}).value || "";
    state.form.remark = (document.getElementById("bcrRemark") || {}).value || "";
    state.form.commissionRate = (document.getElementById("bcrCommissionRate") || {}).value || "";
    state.form.reason = (document.getElementById("bcrReason") || {}).value || "";
  }

  function loadList() {
    state.loading = true;
    state.error = "";
    paint();
    var qs =
      "/api/admin/boss-companion-relations?action=list&status=" +
      encodeURIComponent(state.status || "") +
      "&q=" +
      encodeURIComponent(state.q || "");
    return api(qs)
      .then(function (body) {
        state.tablesReady = body.tablesReady !== false;
        state.relations = body.relations || [];
        state.message = body.message || state.message || "";
        state.loading = false;
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || "读取失败";
        paint();
      });
  }

  function loadHistory(companionId) {
    state.historyCompanionId = companionId;
    return api(
      "/api/admin/boss-companion-relations?action=history&companionId=" + encodeURIComponent(companionId)
    )
      .then(function (body) {
        state.history = body.events || [];
        paint();
      })
      .catch(function (err) {
        state.error = err.message || "历史读取失败";
        paint();
      });
  }

  function runMutation(action, payload) {
    state.busy = true;
    state.error = "";
    state.message = "";
    paint();
    return api("/api/admin/boss-companion-relations?action=" + encodeURIComponent(action), {
      method: "POST",
      body: JSON.stringify(payload || {}),
    })
      .then(function (body) {
        state.busy = false;
        state.message = body.message || "完成";
        state.tablesReady = body.tablesReady !== false;
        return loadList();
      })
      .catch(function (err) {
        state.busy = false;
        state.error = err.message || "操作失败";
        paint();
      });
  }

  document.addEventListener("click", function (e) {
    if (!e.target.closest || !document.getElementById(TARGET)) return;
    if (e.target.closest("[data-bcr-search]")) {
      readForm();
      loadList();
      return;
    }
    if (e.target.closest("[data-bcr-bind]")) {
      readForm();
      if (!String(state.form.reason || "").trim()) {
        state.error = "绑定必须填写审计原因 reason";
        paint();
        return;
      }
      runMutation("bind", {
        action: "bind",
        bossId: state.form.boss,
        companionId: state.form.companion,
        remark: state.form.remark,
        commissionRate: state.form.commissionRate,
        reason: state.form.reason,
      });
      return;
    }
    if (e.target.closest("[data-bcr-rebind]")) {
      readForm();
      if (!String(state.form.reason || "").trim()) {
        state.error = "换绑必须填写审计原因 reason";
        paint();
        return;
      }
      runMutation("rebind", {
        action: "rebind",
        companionId: state.form.companion,
        newBossId: state.form.newBoss || state.form.boss,
        remark: state.form.remark,
        commissionRate: state.form.commissionRate,
        reason: state.form.reason,
      });
      return;
    }

    var setRateBtn = e.target.closest("[data-bcr-set-rate]");
    if (setRateBtn) {
      var rid = setRateBtn.getAttribute("data-bcr-set-rate") || "";
      var cid = setRateBtn.getAttribute("data-companion") || "";
      var cur = setRateBtn.getAttribute("data-rate") || "";
      var input = window.prompt("设置该直属关系的老板分成%（占平台抽成；留空取消）", cur);
      if (input == null) return;
      var rate = String(input).trim();
      if (rate === "" || Number.isNaN(Number(rate))) {
        state.error = "请输入 0-100 的数字";
        paint();
        return;
      }
      var reason = window.prompt("审计原因 reason（必填）", state.form.reason || "");
      if (reason == null || !String(reason).trim()) {
        state.error = "设分成必须填写 reason";
        paint();
        return;
      }
      state.busy = true;
      paint();
      api("/api/admin/boss-companion-relations", {
        method: "POST",
        body: JSON.stringify({
          action: "set-commission",
          relationId: rid,
          companionId: cid,
          commissionRate: rate,
          reason: String(reason).trim(),
        }),
      })
        .then(function () {
          state.busy = false;
          state.message = "分成比例已更新";
          return loadList();
        })
        .catch(function (err) {
          state.busy = false;
          state.error = err.message || "更新失败";
          paint();
        });
      return;
    }
    var unbind = e.target.closest("[data-bcr-unbind]");
    if (unbind) {
      if (!confirm("确认解绑该陪玩的直属关系？历史将保留。")) return;
      readForm();
      var unbindReason =
        String(state.form.reason || "").trim() ||
        window.prompt("审计原因 reason（必填）", "") ||
        "";
      if (!String(unbindReason).trim()) {
        state.error = "解绑必须填写 reason";
        paint();
        return;
      }
      runMutation("unbind", {
        action: "unbind",
        companionId: unbind.getAttribute("data-bcr-unbind"),
        reason: String(unbindReason).trim(),
      });
      return;
    }
    var hist = e.target.closest("[data-bcr-history]");
    if (hist) {
      loadHistory(hist.getAttribute("data-bcr-history"));
      return;
    }
    var btn = e.target.closest('[data-section="boss-companion-relations"]');
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
