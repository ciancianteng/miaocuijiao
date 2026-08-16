(function () {
  "use strict";
  var state = {
    tab: "levels",
    loading: false,
    message: "",
    error: "",
    guide: { title: "俱乐部等级说明", intro: "" },
    workRules: [],
    editingRule: null,
    records: [],
    recordFilter: "",
    forcedOnly: true,
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function adminRole() {
    try {
      var raw = localStorage.getItem("adminUser") || sessionStorage.getItem("adminUser") || "{}";
      var user = JSON.parse(raw);
      return user.adminRole || user.role || "admin";
    } catch (e) {
      return "admin";
    }
  }
  function parse(res) {
    return res.text().then(function (text) {
      var body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch (e) {
        throw new Error("接口返回格式错误");
      }
      if (!res.ok || body.ok === false) throw new Error(body.message || "请求失败");
      return body;
    });
  }
  function api(action, body, method) {
    var Auth = window.MCJAdminAuthFetch;
    var opts = {
      method: method || "POST",
      headers: Auth
        ? Auth.getAuthHeaders({ "Content-Type": "application/json", "x-mcj-admin-role": adminRole() })
        : { "Content-Type": "application/json", "x-mcj-admin-role": adminRole() },
    };
    var fetchFn = Auth ? Auth.fetch : fetch;
    if (opts.method === "GET") {
      var q = "/api/admin/rules-hub?action=" + encodeURIComponent(action);
      if (state.recordFilter) q += "&filter=" + encodeURIComponent(state.recordFilter);
      return fetchFn(q, opts).then(parse);
    }
    opts.body = JSON.stringify(Object.assign({ action: action }, body || {}));
    return fetchFn("/api/admin/rules-hub", opts).then(parse);
  }
  function contentApi(body) {
    var Auth = window.MCJAdminAuthFetch;
    var fetchFn = Auth ? Auth.fetch : fetch;
    var headers = Auth
      ? Auth.getAuthHeaders({ "Content-Type": "application/json", "x-mcj-admin-role": adminRole() })
      : { "Content-Type": "application/json", "x-mcj-admin-role": adminRole() };
    return fetchFn("/api/admin/content", { method: "POST", headers: headers, body: JSON.stringify(body) }).then(parse);
  }
  function contentList() {
    var Auth = window.MCJAdminAuthFetch;
    var fetchFn = Auth ? Auth.fetch : fetch;
    var headers = Auth
      ? Auth.getAuthHeaders({ Accept: "application/json", "x-mcj-admin-role": adminRole() })
      : { Accept: "application/json", "x-mcj-admin-role": adminRole() };
    return fetchFn("/api/admin/content", { method: "GET", headers: headers }).then(parse);
  }

  function mount() {
    return document.getElementById("rulesHubMount");
  }

  function tabsHtml() {
    var tabs = [
      ["levels", "俱乐部等级说明"],
      ["rules", "陪玩规则"],
      ["forced", "强制公告"],
      ["acks", "阅读记录"],
    ];
    return (
      '<div class="service-record-toolbar" style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px">' +
      tabs
        .map(function (t) {
          return (
            '<button class="mini-btn' +
            (state.tab === t[0] ? " primary-lite" : "") +
            '" type="button" data-rules-hub-tab="' +
            t[0] +
            '">' +
            esc(t[1]) +
            "</button>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function levelsTab() {
    return (
      '<div data-rules-hub-panel="levels">' +
      '<form class="service-account-form" data-rules-guide-form style="margin-bottom:16px">' +
      "<h3>页面文案</h3>" +
      '<div class="form-grid">' +
      '<label>页面标题<input name="title" required value="' +
      esc(state.guide.title || "") +
      '"></label>' +
      '<label class="wide">简短介绍<textarea name="intro" rows="3">' +
      esc(state.guide.intro || "") +
      "</textarea></label>" +
      "</div>" +
      '<div class="row" style="margin-top:10px"><button class="primary-btn" type="submit">保存页面文案</button></div>' +
      "</form>" +
      '<p class="admin-sync-note">下方等级列表复用现有陪玩等级管理（价格、图标、升级条件等）。保存后首页「俱乐部等级说明」立即读取。</p>' +
      '<div id="companionLevelSettingsHub"></div>' +
      "</div>"
    );
  }

  function rulesTab() {
    var rows = state.workRules || [];
    var edit = state.editingRule;
    return (
      '<div data-rules-hub-panel="rules">' +
      '<p class="admin-sync-note">陪玩端「陪玩规则」读取此处分类正文。申请页「陪玩制度」仍在下方平台内容模块维护。</p>' +
      (edit
        ? '<form class="service-account-form" data-work-rule-form data-edit-id="' +
          esc(edit.id || "") +
          '"><div class="service-account-form-head"><div><h3>' +
          (edit.id ? "编辑规则" : "新建规则") +
          '</h3></div><button class="mini-btn" type="button" data-work-rule-cancel>关闭</button></div><div class="form-grid">' +
          '<label>分类 / 标题<input name="title" required value="' +
          esc(edit.title || edit.category || "") +
          '"></label>' +
          '<label>排序<input name="sort" type="number" value="' +
          esc(edit.sort || 100) +
          '"></label>' +
          '<label>版本号<input name="version" value="' +
          esc(edit.version || "1") +
          '"></label>' +
          '<label>是否启用<select name="enabled"><option value="true"' +
          (edit.enabled !== false ? " selected" : "") +
          '>启用</option><option value="false"' +
          (edit.enabled === false ? " selected" : "") +
          ">停用</option></select></label>" +
          '<label>是否强制确认<select name="forceConfirm"><option value="false"' +
          (!edit.forceConfirm ? " selected" : "") +
          '>否</option><option value="true"' +
          (edit.forceConfirm ? " selected" : "") +
          ">是</option></select></label>" +
          '<label>生效时间<input name="effectiveAt" type="datetime-local" value="' +
          esc(toLocal(edit.effectiveAt)) +
          '"></label>' +
          '<label class="wide">正文<textarea name="body" rows="8" required>' +
          esc(edit.body || "") +
          "</textarea></label></div>" +
          '<div class="row"><button class="primary-btn" type="submit">保存规则</button></div></form>'
        : '<div class="row" style="margin-bottom:10px"><button class="primary-btn" type="button" data-work-rule-new>新建规则</button><button class="mini-btn" type="button" data-work-rule-reload>刷新</button></div>') +
      '<div class="table-wrap service-account-table-wrap"><table class="service-account-table"><thead><tr><th>排序</th><th>分类</th><th>版本</th><th>启用</th><th>强制确认</th><th>更新时间</th><th>操作</th></tr></thead><tbody>' +
      (rows.length
        ? rows
            .map(function (r) {
              return (
                "<tr><td>" +
                esc(r.sort) +
                "</td><td>" +
                esc(r.category || r.title) +
                "</td><td>" +
                esc(r.version) +
                "</td><td>" +
                esc(r.enabled ? "是" : "否") +
                "</td><td>" +
                esc(r.forceConfirm ? "是" : "否") +
                "</td><td>" +
                esc(r.updatedAt || "-") +
                '</td><td><button class="mini-btn" type="button" data-work-rule-edit="' +
                esc(r.id) +
                '">编辑</button></td></tr>'
              );
            })
            .join("")
        : '<tr><td colspan="7"><div class="empty">暂无规则，点击新建或刷新自动种子分类</div></td></tr>') +
      "</tbody></table></div>" +
      '<header class="service-account-head" style="margin-top:18px"><div><h3>陪玩申请制度（申请页）</h3><p>与申请第 1 步同步</p></div></header>' +
      '<div id="table-companion_rules"></div>' +
      "</div>"
    );
  }

  function forcedTab() {
    return (
      '<div data-rules-hub-panel="forced">' +
      '<p class="admin-sync-note">强制阅读公告：陪玩未确认前不能切换在线、抢单、接单、开始订单。修改正文会自动升版本并要求重新确认。</p>' +
      '<form class="admin-final-form" data-forced-announcement-form>' +
      '<input type="hidden" name="id">' +
      '<input type="hidden" name="kind" value="forced">' +
      '<label>发布对象<select name="audience"><option value="companion" selected>陪玩端</option><option value="all">全平台</option><option value="home">首页</option><option value="boss">老板端</option><option value="customer_service">客服端</option></select></label>' +
      '<label>公告分类<select name="category"><option value="companion" selected>陪玩公告</option><option value="home">首页公告</option></select></label>' +
      '<label>标题<input name="title" required placeholder="强制公告标题"></label>' +
      '<label>排序<input name="sort_order" type="number" value="10"></label>' +
      '<label>开始时间<input name="start_at" type="datetime-local"></label>' +
      '<label>结束时间<input name="end_at" type="datetime-local"></label>' +
      '<label>启用<select name="is_active"><option value="true" selected>启用</option><option value="false">停用</option></select></label>' +
      '<label class="wide">正文<textarea name="content" required rows="8" placeholder="强制公告正文"></textarea></label>' +
      '<button class="primary-btn" type="submit">发布强制公告</button>' +
      '<button class="mini-btn" type="button" data-forced-reset>清空</button>' +
      "</form>" +
      '<div class="admin-final-table-wrap" style="margin-top:14px" data-forced-list><div class="empty">加载中...</div></div>' +
      "</div>"
    );
  }

  function acksTab() {
    var rows = state.records || [];
    return (
      '<div data-rules-hub-panel="acks">' +
      '<div class="service-record-toolbar" style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px">' +
      '<select data-ack-filter><option value="">全部</option><option value="acked"' +
      (state.recordFilter === "acked" ? " selected" : "") +
      ">已阅读</option><option value=\"unread\"" +
      (state.recordFilter === "unread" ? " selected" : "") +
      ">未阅读</option><option value=\"expired\"" +
      (state.recordFilter === "expired" ? " selected" : "") +
      ">版本过期</option><option value=\"inactive\"" +
      (state.recordFilter === "inactive" ? " selected" : "") +
      ">已停用陪玩</option></select>" +
      '<button class="mini-btn primary-lite" type="button" data-ack-reload>刷新</button></div>' +
      '<div class="table-wrap service-account-table-wrap"><table class="service-account-table"><thead><tr><th>陪玩</th><th>公告/内容ID</th><th>版本</th><th>状态</th><th>确认时间</th><th>需重新确认</th></tr></thead><tbody>' +
      (rows.length
        ? rows
            .map(function (r) {
              return (
                "<tr><td>" +
                esc(r.companionName) +
                "</td><td>" +
                esc(r.contentTitle || r.contentId) +
                "</td><td>" +
                esc(r.contentVersion) +
                "</td><td>" +
                esc(r.statusText || r.status) +
                "</td><td>" +
                esc(r.acknowledgedAt || "-") +
                "</td><td>" +
                esc(r.needsReconfirm ? "是" : "否") +
                "</td></tr>"
              );
            })
            .join("")
        : '<tr><td colspan="6"><div class="empty">暂无阅读记录</div></td></tr>') +
      "</tbody></table></div></div>"
    );
  }

  function toLocal(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      var p = function (n) {
        return String(n).padStart(2, "0");
      };
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
    } catch (e) {
      return "";
    }
  }
  function fromLocal(v) {
    if (!v) return "";
    try {
      return new Date(v).toISOString();
    } catch (e) {
      return "";
    }
  }

  function render() {
    var box = mount();
    if (!box) return;
    var body =
      state.tab === "levels"
        ? levelsTab()
        : state.tab === "rules"
          ? rulesTab()
          : state.tab === "forced"
            ? forcedTab()
            : acksTab();
    box.innerHTML =
      '<section class="service-account-admin">' +
      '<header class="service-account-head"><div><h2>平台制度与等级管理</h2><p>统一管理俱乐部等级说明、陪玩规则、强制公告与阅读记录。保存后前台实时读取，无需发版。</p></div></header>' +
      (state.error ? '<div class="admin-sync-note error">' + esc(state.error) + "</div>" : "") +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      tabsHtml() +
      body +
      "</section>";
    if (state.tab === "levels") {
      if (window.MCJAdminCompanionLevels && window.MCJAdminCompanionLevels.reload) {
        try {
          window.MCJAdminCompanionLevels.reload();
        } catch (e) {}
      } else if (typeof window.__MCJRenderCompanionLevels === "function") {
        window.__MCJRenderCompanionLevels();
      }
      // Trigger suite player_rules mount when on rules — levels uses companionLevelSettings id
    }
    if (state.tab === "rules") {
      // Mount apply-page player_rules editor into #table-companion_rules.
      // loadPlatformContent accepts module key or cfg; MCJAdminSuite must be exported by admin-suite.
      var mountApplyRules = function () {
        if (!window.MCJAdminSuite || typeof window.MCJAdminSuite.loadPlatformContent !== "function") return false;
        try {
          window.MCJAdminSuite.loadPlatformContent("companion-rules");
          return true;
        } catch (e) {
          return false;
        }
      };
      if (!mountApplyRules()) {
        setTimeout(mountApplyRules, 80);
        setTimeout(mountApplyRules, 400);
      }
    }
    if (state.tab === "forced") loadForcedList();
  }

  function loadForcedList() {
    var host = document.querySelector("[data-forced-list]");
    if (!host) return;
    contentList()
      .then(function (res) {
        var rows = (res.announcements || []).filter(function (a) {
          return String(a.kind || "") === "forced" || a.requires_ack === true;
        });
        host.innerHTML =
          '<table class="admin-final-table"><thead><tr><th>标题</th><th>对象</th><th>版本</th><th>启用</th><th>时间窗</th><th>操作</th></tr></thead><tbody>' +
          (rows.length
            ? rows
                .map(function (r) {
                  return (
                    "<tr><td>" +
                    esc(r.title) +
                    "</td><td>" +
                    esc(r.audience) +
                    "</td><td>" +
                    esc(r.content_version || 1) +
                    "</td><td>" +
                    esc(r.is_active === false ? "停用" : "启用") +
                    "</td><td>" +
                    esc((r.start_at || "-") + " ~ " + (r.end_at || "-")) +
                    '</td><td><button class="mini-btn" type="button" data-forced-edit=\'' +
                    esc(JSON.stringify(r)) +
                    "'>编辑</button></td></tr>"
                  );
                })
                .join("")
            : '<tr><td colspan="6"><div class="empty">暂无强制公告</div></td></tr>') +
          "</tbody></table>";
      })
      .catch(function (err) {
        host.innerHTML = '<div class="empty">' + esc(err.message) + "</div>";
      });
  }

  function loadBootstrap() {
    state.loading = true;
    state.error = "";
    api("bootstrap", {}, "GET")
      .then(function (res) {
        state.guide = res.guide || state.guide;
        state.workRules = res.workRules || [];
        state.loaded = true;
      })
      .catch(function (err) {
        state.error = err.message || "加载失败";
      })
      .finally(function () {
        state.loading = false;
        render();
        if (state.tab === "acks") loadAcks();
      });
  }

  function loadAcks() {
    api("ack_records", {}, "GET")
      .then(function (res) {
        state.records = res.records || [];
        render();
      })
      .catch(function (err) {
        state.error = err.message;
        render();
      });
  }

  document.addEventListener("click", function (e) {
    var tab = e.target.closest("[data-rules-hub-tab]");
    if (tab) {
      state.tab = tab.getAttribute("data-rules-hub-tab");
      state.message = "";
      render();
      if (state.tab === "acks") loadAcks();
      if (state.tab === "rules") {
        api("work_rules", {}, "GET")
          .then(function (res) {
            state.workRules = res.rules || [];
            render();
          })
          .catch(function () {});
      }
      return;
    }
    if (e.target.closest("[data-work-rule-new]")) {
      state.editingRule = { title: "", body: "", sort: 100, enabled: true, forceConfirm: false, version: "1" };
      render();
      return;
    }
    if (e.target.closest("[data-work-rule-cancel]")) {
      state.editingRule = null;
      render();
      return;
    }
    var edit = e.target.closest("[data-work-rule-edit]");
    if (edit) {
      state.editingRule = (state.workRules || []).find(function (r) {
        return String(r.id) === String(edit.getAttribute("data-work-rule-edit"));
      }) || null;
      render();
      return;
    }
    if (e.target.closest("[data-work-rule-reload]")) {
      api("work_rules", {}, "GET").then(function (res) {
        state.workRules = res.rules || [];
        render();
      });
      return;
    }
    if (e.target.closest("[data-ack-reload]")) {
      var sel = document.querySelector("[data-ack-filter]");
      state.recordFilter = sel ? sel.value : "";
      loadAcks();
      return;
    }
    if (e.target.closest("[data-forced-reset]")) {
      var f = document.querySelector("[data-forced-announcement-form]");
      if (f) f.reset();
      return;
    }
    var fed = e.target.closest("[data-forced-edit]");
    if (fed) {
      try {
        var a = JSON.parse(fed.getAttribute("data-forced-edit"));
        var form = document.querySelector("[data-forced-announcement-form]");
        if (!form) return;
        form.elements.id.value = a.id || "";
        form.elements.title.value = a.title || "";
        form.elements.content.value = a.content || "";
        form.elements.audience.value = a.audience || "companion";
        form.elements.category.value = a.category || "companion";
        form.elements.sort_order.value = a.sort_order != null ? a.sort_order : 10;
        form.elements.is_active.value = a.is_active === false ? "false" : "true";
        form.elements.start_at.value = toLocal(a.start_at);
        form.elements.end_at.value = toLocal(a.end_at);
      } catch (err) {}
    }
  });

  document.addEventListener("submit", function (e) {
    if (e.target.matches("[data-rules-guide-form]")) {
      e.preventDefault();
      var fd = new FormData(e.target);
      api("save_guide", { guide: { title: fd.get("title"), intro: fd.get("intro") } })
        .then(function (res) {
          state.guide = res.guide || state.guide;
          state.message = res.message || "已保存";
          render();
        })
        .catch(function (err) {
          state.error = err.message;
          render();
        });
      return;
    }
    if (e.target.matches("[data-work-rule-form]")) {
      e.preventDefault();
      var fd2 = new FormData(e.target);
      api("save_work_rule", {
        rule: {
          id: e.target.getAttribute("data-edit-id") || "",
          title: fd2.get("title"),
          category: fd2.get("title"),
          body: fd2.get("body"),
          sort: fd2.get("sort"),
          version: fd2.get("version"),
          enabled: fd2.get("enabled") !== "false",
          forceConfirm: fd2.get("forceConfirm") === "true",
          effectiveAt: fromLocal(fd2.get("effectiveAt")),
        },
      })
        .then(function (res) {
          state.message = res.message || "已保存";
          state.editingRule = null;
          return api("work_rules", {}, "GET");
        })
        .then(function (res) {
          state.workRules = res.rules || [];
          render();
        })
        .catch(function (err) {
          state.error = err.message;
          render();
        });
      return;
    }
    if (e.target.matches("[data-forced-announcement-form]")) {
      e.preventDefault();
      var ad = new FormData(e.target);
      contentApi({
        action: "save_announcement",
        announcement: {
          id: ad.get("id"),
          kind: "forced",
          requires_ack: true,
          category: ad.get("category") || "companion",
          audience: ad.get("audience") || "companion",
          title: ad.get("title"),
          content: ad.get("content"),
          start_at: ad.get("start_at"),
          end_at: ad.get("end_at"),
          sort_order: ad.get("sort_order") || 10,
          is_pinned: true,
          is_scrolling: false,
          is_active: ad.get("is_active") !== "false",
        },
      })
        .then(function (res) {
          state.message = res.message || "强制公告已保存";
          e.target.reset();
          loadForcedList();
        })
        .catch(function (err) {
          state.error = err.message;
          render();
        });
    }
  });

  function maybeLoad() {
    if (!mount()) return;
    if (!state.loaded) loadBootstrap();
    else render();
  }

  document.addEventListener("DOMContentLoaded", maybeLoad);
  document.addEventListener("click", function (e) {
    if (e.target.closest('[data-section="rules-hub"],[data-section="companion-rules"]')) {
      setTimeout(maybeLoad, 40);
    }
  });
  window.__MCJRenderRulesHub = maybeLoad;
})();
