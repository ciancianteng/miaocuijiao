/**
 * Admin · 直属关系管理（Boss ↔ Companion）
 * list / search / bind / rebind / unbind / history
 * 塞进现有 admin shell，不改布局壳子。
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
    form: { boss: "", companion: "", newBoss: "", remark: "" },
    migrationSql: "",
    sqlEditorUrl: "https://supabase.com/dashboard/project/cfccwysniduwkjskiqgy/sql/new",
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
        '<p class="admin-sync-note">表未初始化。可点「执行 Staging Migration」（需服务器 DATABASE_URL）；若 skipped，请打开 Staging SQL Editor 粘贴下方 SQL。</p>' +
        '<p class="admin-sync-note"><a href="' +
        esc(state.sqlEditorUrl) +
        '" target="_blank" rel="noopener">打开 Staging SQL Editor</a> · project <code>cfccwysniduwkjskiqgy</code></p>';
      if (state.migrationSql) {
        tip +=
          '<div style="margin:10px 0 14px">' +
          '<button type="button" class="ghost-btn" data-bcr-copy-sql>复制 Migration SQL</button>' +
          '<textarea id="bcrMigrationSql" readonly rows="8" style="width:100%;margin-top:8px;font:12px/1.4 ui-monospace,monospace;background:rgba(0,0,0,.35);color:#e5e7eb;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px">' +
          esc(state.migrationSql) +
          "</textarea></div>";
      }
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
            esc(r.boundAt ? String(r.boundAt).replace("T", " ").slice(0, 19) : "-") +
            "</td>" +
            "<td>" +
            '<button type="button" class="ghost-btn" data-bcr-history="' +
            esc(r.companionId) +
            '">历史</button> ' +
            (r.status === "active"
              ? '<button type="button" class="ghost-btn" data-bcr-unbind="' +
                esc(r.companionId) +
                '">解绑</button>'
              : "") +
            "</td>" +
            "</tr>"
          );
        })
        .join("") ||
      '<tr><td colspan="5" class="empty">暂无直属关系</td></tr>';

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
            esc(e.createdAt ? String(e.createdAt).replace("T", " ").slice(0, 19) : "-") +
            "</td>" +
            "</tr>"
          );
        })
        .join("") ||
      (state.historyCompanionId
        ? '<tr><td colspan="5" class="empty">暂无历史事件</td></tr>'
        : '<tr><td colspan="5" class="empty">点击列表「历史」查看</td></tr>');

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
      '<button type="button" class="ghost-btn" data-bcr-ensure' +
      (state.busy ? " disabled" : "") +
      ">执行 Staging Migration</button>" +
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
      "</div>" +
      '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="primary-btn" data-bcr-bind' +
      (state.busy ? " disabled" : "") +
      ">绑定</button>" +
      '<button type="button" class="ghost-btn" data-bcr-rebind' +
      (state.busy ? " disabled" : "") +
      ">换绑</button>" +
      "</div>" +
      '<p class="admin-sync-note" style="margin:8px 0 0">仅 Admin 可写。绑定前校验 hasBoss / hasCompanion（#128 resolver）。不改 capability。</p>' +
      "</div>" +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>老板</th><th>陪玩</th><th>状态</th><th>绑定时间</th><th>操作</th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div>" +
      '<h3 style="margin:18px 0 8px;font-size:16px">关系历史' +
      (state.historyCompanionId ? " · " + esc(state.historyCompanionId) : "") +
      "</h3>" +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>动作</th><th>原老板</th><th>新老板</th><th>备注</th><th>时间</th></tr></thead><tbody>' +
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
        state.message = body.message || "";
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
        if (body.sql) state.migrationSql = body.sql;
        if (body.sqlEditorUrl) state.sqlEditorUrl = body.sqlEditorUrl;
        return loadList().then(function () {
          if (!state.tablesReady && !state.migrationSql) return fetchMigrationSql();
        });
      })
      .catch(function (err) {
        state.busy = false;
        // ensure may return ok:false with sql payload via throw path — try dedicated fetch
        if (action === "ensure") return fetchMigrationSql().then(function () {
          state.error = err.message || "操作失败";
          paint();
        });
        state.error = err.message || "操作失败";
        paint();
      });
  }

  function fetchMigrationSql() {
    return api("/api/admin/boss-companion-relations?action=ensure", {
      method: "POST",
      body: JSON.stringify({ action: "ensure" }),
    })
      .then(function (body) {
        if (body.sql) state.migrationSql = body.sql;
        if (body.sqlEditorUrl) state.sqlEditorUrl = body.sqlEditorUrl;
        if (body.message) state.message = body.message;
        if (body.tablesReady === true) state.tablesReady = true;
        paint();
        return body;
      })
      .catch(function (err) {
        // Some fetch wrappers throw on ok:false — body may be on err
        var msg = err && err.message ? String(err.message) : "";
        if (/DATABASE_URL|SQL Editor|migration/i.test(msg)) state.message = msg;
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
    if (e.target.closest("[data-bcr-copy-sql]")) {
      var ta = document.getElementById("bcrMigrationSql");
      var text = (ta && ta.value) || state.migrationSql || "";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          state.message = "Migration SQL 已复制";
          paint();
        });
      } else if (ta) {
        ta.focus();
        ta.select();
        try {
          document.execCommand("copy");
          state.message = "Migration SQL 已复制";
        } catch (err) {
          state.error = "复制失败，请手动全选复制";
        }
        paint();
      }
      return;
    }
    if (e.target.closest("[data-bcr-ensure]")) {
      runMutation("ensure", { action: "ensure" });
      return;
    }
    if (e.target.closest("[data-bcr-bind]")) {
      readForm();
      runMutation("bind", {
        action: "bind",
        bossId: state.form.boss,
        companionId: state.form.companion,
        remark: state.form.remark,
      });
      return;
    }
    if (e.target.closest("[data-bcr-rebind]")) {
      readForm();
      runMutation("rebind", {
        action: "rebind",
        companionId: state.form.companion,
        newBossId: state.form.newBoss || state.form.boss,
        remark: state.form.remark,
      });
      return;
    }
    var unbind = e.target.closest("[data-bcr-unbind]");
    if (unbind) {
      if (!confirm("确认解绑该陪玩的直属关系？历史将保留。")) return;
      runMutation("unbind", { action: "unbind", companionId: unbind.getAttribute("data-bcr-unbind") });
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
