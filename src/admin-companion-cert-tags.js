(function () {
  "use strict";

  var Auth = window.MCJAdminAuthFetch;
  var TARGET_ID = "companionCertTagManagement";
  var API = "/api/admin/companion-cert-tags";
  var now = new Date();
  var state = {
    loading: true,
    saving: false,
    error: "",
    message: "",
    tags: [],
    editing: null,
    formOpen: false,
    view: "list",
    range: "month",
    from: "",
    to: "",
    stats: null,
    statsError: "",
    detailId: "",
    detail: null,
    detailLoading: false,
    detailError: "",
    detailTab: "members",
    detailHolder: "",
    tagFilter: "",
    companionQuery: "",
    holder: null,
    holderRef: "",
    holderTag: "",
    holderScope: "tag",
    holderBack: "list",
    holderLoading: false,
    holderError: "",
    orderFilter: "all",
    exportYear: now.getFullYear(),
    exportMonth: now.getMonth() + 1,
    tab: "overview",
    moreId: "",
    overview: null,
    overviewError: "",
  };

  var PAGE_TABS = [
    ["overview", "数据总览"],
    ["badges", "勋章管理"],
    ["orders", "订单统计"],
    ["settings", "系统设置"],
  ];

  var RANGES = [
    ["today", "今天"],
    ["week", "本周"],
    ["month", "本月"],
    ["custom", "自定义日期"],
    ["all", "全部时间"],
  ];

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(v) {
    var n = Number(v);
    return (Number.isFinite(n) ? n : 0).toFixed(2);
  }
  function pct(v) {
    return v == null || v === "" ? "未设置" : Number(v).toFixed(2).replace(/\.00$/, "") + "%";
  }
  function dt(v) {
    if (!v) return "-";
    var d = new Date(v);
    if (isNaN(d.getTime())) return esc(v);
    var p = function (n) {
      return String(n).padStart(2, "0");
    };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function target() {
    return document.getElementById(TARGET_ID);
  }

  function scroller() {
    var nodes = [document.querySelector(".admin-main"), document.body, document.scrollingElement, document.documentElement];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node && node.scrollHeight > node.clientHeight + 2) return node;
    }
    return document.scrollingElement || document.documentElement;
  }

  function ensureCss() {
    if (document.getElementById("cert-admin-tabs-css")) return;
    var s = document.createElement("style");
    s.id = "cert-admin-tabs-css";
    s.textContent =
      "#companionCertTagManagement{max-width:100%;overflow-x:clip;word-break:keep-all;overflow-wrap:break-word;padding-bottom:calc(16px + env(safe-area-inset-bottom));}" +
      "#companionCertTagManagement .cert-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:0 0 12px;}" +
      "#companionCertTagManagement .cert-tabs button{min-height:36px;padding:8px 4px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:#f5d6e6;font-size:13px;font-weight:700;white-space:nowrap;cursor:pointer;}" +
      "#companionCertTagManagement .cert-tabs button.active{background:linear-gradient(180deg,#ff7eb3,#c86bff);color:#1a0b14;border-color:transparent;}" +
      "#companionCertTagManagement .cert-tabs button:active,#companionCertTagManagement .cert-badge-card button:active,#companionCertTagManagement .cert-export button:active{transform:scale(.98);opacity:.86;}" +
      "#companionCertTagManagement .cert-kpi{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important;margin:0 0 12px;}" +
      "#companionCertTagManagement .cert-stat{padding:12px;border-radius:14px;min-width:0;}" +
      "#companionCertTagManagement .cert-stat::after{display:none!important;content:none!important;}" +
      "#companionCertTagManagement .cert-stat span{display:block;font-size:12px;line-height:1.35;color:#cbb8c4;}" +
      "#companionCertTagManagement .cert-stat strong{display:block;margin-top:6px;font-size:22px;line-height:1.15;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:visible;color:#fff;}" +
      "#companionCertTagManagement .cert-stat small{display:block;margin-top:4px;font-size:11px;line-height:1.35;color:#9f949c;}" +
      "#companionCertTagManagement .cert-badge-list,#companionCertTagManagement .cert-settings-list,#companionCertTagManagement .cert-break-list{display:grid;grid-template-columns:1fr;gap:12px;}" +
      "#companionCertTagManagement .cert-badge-card{padding:14px;border-radius:14px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);min-width:0;}" +
      "#companionCertTagManagement .cert-badge-card .cert-card-top{display:flex;justify-content:space-between;align-items:center;gap:8px;}" +
      "#companionCertTagManagement .cert-badge-card .cert-card-meta{display:grid;gap:4px;margin:10px 0;color:#d9ccd4;font-size:14px;line-height:1.4;}" +
      "#companionCertTagManagement .cert-actions{display:flex;flex-wrap:wrap;gap:8px;}" +
      "#companionCertTagManagement .cert-actions .mini-btn,#companionCertTagManagement .cert-actions .primary-btn{flex:1 1 120px;min-height:36px;white-space:nowrap;}" +
      "#companionCertTagManagement .cert-more{position:relative;margin-top:8px;}" +
      "#companionCertTagManagement .cert-more>button{width:100%;min-height:36px;}" +
      "#companionCertTagManagement .cert-more-menu{display:flex;flex-direction:column;gap:6px;margin-top:8px;}" +
      "#companionCertTagManagement .cert-export{margin-top:12px;padding:12px;border-radius:14px;border:1px solid rgba(255,255,255,.1);}" +
      "#companionCertTagManagement .cert-link{margin-top:4px;}" +
      "#companionCertTagManagement .table-wrap{max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;}" +
      "#companionCertTagManagement .toolbar select,#companionCertTagManagement .toolbar input,#companionCertTagManagement .table-tools select{min-width:0;max-width:100%;}" +
      "@media(max-width:640px){#companionCertTagManagement .cert-tabs{grid-template-columns:repeat(2,minmax(0,1fr));}#companionCertTagManagement .cert-stat strong{font-size:20px;}}" +
      "@media(min-width:900px){#companionCertTagManagement .cert-kpi{grid-template-columns:repeat(3,minmax(0,1fr))!important;}}" +
      "@media(max-width:767px){body.mcj-cert-admin .admin-header{height:auto!important;min-height:0!important;max-height:none!important;padding:6px 12px!important;gap:8px;}body.mcj-cert-admin .admin-header h1{font-size:16px;line-height:1.2;}body.mcj-cert-admin .admin-header .admin-breadcrumb{display:none;}body.mcj-cert-admin .admin-content{padding:12px!important;}}";
    document.head.appendChild(s);
  }

  function setCertBody(on) {
    if (document.body) document.body.classList.toggle("mcj-cert-admin", !!on);
  }

  function apiGet(query) {
    var url = API + (query ? "?" + query : "");
    if (Auth && Auth.get) return Auth.get(url);
    return fetch(url, {
      headers: { Accept: "application/json", "x-mcj-admin-role": "admin" },
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.ok === false) throw new Error(body.message || "读取失败");
        return body;
      });
    });
  }

  function apiPost(body) {
    if (Auth && Auth.post) return Auth.post(API, body);
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mcj-admin-role": "admin" },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || data.ok === false) throw new Error(data.message || "保存失败");
        return data;
      });
    });
  }

  function rangeQuery() {
    var q = "range=" + encodeURIComponent(state.range);
    if (state.range === "custom") q += "&from=" + encodeURIComponent(state.from) + "&to=" + encodeURIComponent(state.to || state.from);
    return q;
  }

  function blank() {
    return {
      id: "",
      name: "",
      icon: "🏅",
      color: "#f5c542",
      sort: (state.tags.length + 1) * 10,
      enabled: true,
      companionShareRate: null,
      commissionPriority: 100,
    };
  }

  function badgePreviewHtml(row) {
    row = row || blank();
    var color = row.color || "#f5c542";
    return (
      '<span class="mcj-cert-badge" style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;border:1px solid ' +
      esc(color) +
      ";color:" +
      esc(color) +
      ";background:color-mix(in srgb, " +
      esc(color) +
      ' 16%, transparent);font-size:12px;font-weight:700">' +
      '<span aria-hidden="true">' +
      esc(row.icon || "🏅") +
      "</span>" +
      esc(row.name || "徽章名称") +
      "</span>"
    );
  }

  function formHtml(row) {
    row = row || blank();
    return (
      '<form class="admin-self-form" data-cert-tag-form>' +
      '<input type="hidden" name="id" value="' +
      esc(row.id || "") +
      '">' +
      '<p class="admin-sync-note" style="margin:0 0 12px">自定义前台卡片认证徽章：名称、图标、颜色、启用状态；并可设置该勋章的统一陪玩分成（所有持有该勋章的陪玩自动适用，只影响之后绑定的订单）。</p>' +
      '<div class="form-grid">' +
      '<label><span>徽章名称</span><input name="name" required value="' +
      esc(row.name || "") +
      '" placeholder="官方推荐 / 金牌陪玩 / 实力认证" data-cert-live="name"></label>' +
      '<label><span>徽章图标</span><input name="icon" value="' +
      esc(row.icon || "🏅") +
      '" placeholder="🏅" data-cert-live="icon"></label>' +
      '<label><span>徽章颜色</span><input name="color" type="color" value="' +
      esc(row.color || "#f5c542") +
      '" data-cert-live="color"></label>' +
      '<label><span>排序</span><input name="sort" type="number" value="' +
      esc(row.sort || 100) +
      '"></label>' +
      '<label><span>前台展示</span><select name="enabled"><option value="true"' +
      (row.enabled !== false ? " selected" : "") +
      ">启用显示</option><option value=\"false\"" +
      (row.enabled === false ? " selected" : "") +
      ">停用（前台不展示）</option></select></label>" +
      '<label><span>统一陪玩分成 %（留空=按默认规则）</span><input name="companionShareRate" type="number" min="0" max="100" step="0.01" value="' +
      esc(row.companionShareRate == null ? "" : row.companionShareRate) +
      '" placeholder="例如 70"></label>' +
      '<label><span>佣金优先级（多勋章时数字小优先）</span><input name="commissionPriority" type="number" min="0" max="9999" step="1" value="' +
      esc(row.commissionPriority == null ? 100 : row.commissionPriority) +
      '"></label>' +
      '<label class="wide"><span>前台预览</span><div data-cert-preview style="padding:10px 0">' +
      badgePreviewHtml(row) +
      "</div></label>" +
      "</div>" +
      '<div class="row" style="margin-top:12px;gap:10px">' +
      '<button class="primary-btn" type="submit">' +
      (row.id ? "保存徽章" : "创建徽章") +
      "</button>" +
      '<button class="ghost-btn" type="button" data-cert-tag-cancel>取消</button>' +
      "</div></form>"
    );
  }

  function rowsHtml() {
    if (!state.tags.length) {
      return '<tr><td colspan="8"><div class="empty">暂无认证徽章。点击「新增认证徽章」创建名称 / 颜色 / 图标，并启用后即可分配到陪玩卡片。</div></td></tr>';
    }
    return state.tags
      .map(function (tag) {
        return (
          "<tr>" +
          "<td>" +
          badgePreviewHtml(tag) +
          "</td>" +
          "<td>" +
          esc(tag.icon || "-") +
          "</td>" +
          '<td><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:' +
          esc(tag.color || "#ccc") +
          ';vertical-align:middle"></span> ' +
          esc(tag.color || "-") +
          "</td>" +
          "<td>" +
          esc(tag.sort) +
          "</td>" +
          "<td>" +
          esc(pct(tag.companionShareRate)) +
          "</td>" +
          "<td>" +
          esc(tag.commissionPriority == null ? 100 : tag.commissionPriority) +
          "</td>" +
          '<td><span class="status ' +
          (tag.enabled !== false ? "ok" : "wait") +
          '">' +
          (tag.enabled !== false ? "启用显示" : "已停用") +
          "</span></td>" +
          '<td><div class="row"><button class="mini-btn" type="button" data-cert-detail="' +
          esc(tag.id) +
          '">统计</button><button class="mini-btn" type="button" data-cert-tag-edit="' +
          esc(tag.id) +
          '">编辑</button>' +
          '<button class="mini-btn" type="button" data-cert-tag-toggle="' +
          esc(tag.id) +
          '" data-enabled="' +
          (tag.enabled !== false ? "false" : "true") +
          '">' +
          (tag.enabled !== false ? "停用" : "启用") +
          "</button>" +
          '<button class="mini-btn" type="button" data-cert-tag-delete="' +
          esc(tag.id) +
          '">删除</button></div></td>' +
          "</tr>"
        );
      })
      .join("");
  }

  function rangeToolbarHtml() {
    return (
      '<div class="toolbar" style="margin:10px 0;flex-wrap:wrap;gap:8px">' +
      '<div class="tabs" style="margin:0">' +
      RANGES.map(function (r) {
        return '<button type="button" data-cert-range="' + r[0] + '" class="' + (state.range === r[0] ? "active" : "") + '">' + r[1] + "</button>";
      }).join("") +
      "</div>" +
      (state.range === "custom"
        ? '<input type="date" data-cert-from value="' +
          esc(state.from) +
          '"><span>至</span><input type="date" data-cert-to value="' +
          esc(state.to) +
          '"><button class="mini-btn" type="button" data-cert-apply-custom>查询</button>'
        : "") +
      "</div>"
    );
  }

  function kpiCard(label, value, sub) {
    return (
      '<div class="metric-card cert-stat">' +
      '<span style="font-size:12px">' +
      esc(label) +
      "</span>" +
      '<strong style="font-size:20px;margin-top:6px;line-height:1.2;font-variant-numeric:tabular-nums">' +
      esc(value) +
      "</strong>" +
      (sub ? '<small style="display:block;margin-top:4px;color:var(--muted);font-size:11px">' + esc(sub) + "</small>" : "") +
      "</div>"
    );
  }

  function kpiGridHtml(k, extra) {
    k = k || {};
    return (
      '<div class="metric-grid" style="margin:10px 0">' +
      (extra || "") +
      kpiCard("接单数量", String(k.takenCount || 0), "接单总金额 " + money(k.takenAmount)) +
      kpiCard("已完成订单", String(k.completedCount || 0)) +
      kpiCard("订单总金额", money(k.gross), "已完成订单金额") +
      kpiCard("平台佣金", money(k.platformCommission), "按绑定快照") +
      kpiCard("实际结算", money(k.actualSettled)) +
      kpiCard("陪玩收入", money(k.companionIncome)) +
      kpiCard("退款金额", money(k.refundAmount), (k.refundedOrders || 0) + " 单含退款") +
      "</div>"
    );
  }

  function uidText(c) {
    return "UID " + ((c && (c.uid || c.pwCode)) || "-");
  }

  function whoHtml(c) {
    if (!c) return "-";
    return "<b>" + esc(c.nickname || "-") + '</b> <small style="color:var(--muted)">' + esc(uidText(c)) + "</small>";
  }

  function holderLink(pid, tagId, label) {
    return (
      '<button type="button" data-cert-holder="' +
      esc(pid) +
      '" data-cert-holder-tag="' +
      esc(tagId || "") +
      '" style="all:unset;cursor:pointer;color:#ffd6e7;font-weight:700;text-decoration:underline;overflow-wrap:anywhere">' +
      esc(label || "-") +
      "</button>"
    );
  }

  /** Mobile card (shown < 768px via the shared .capp-mobile-cards rule). Values are pre-escaped HTML. */
  function cardHtml(headHtml, pairs, actionsHtml) {
    return (
      '<div class="capp-card">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
      headHtml +
      "</div>" +
      '<div class="capp-card-meta" style="grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 10px">' +
      pairs
        .map(function (p) {
          return '<div style="min-width:0"><span style="color:#9f949c">' + esc(p[0]) + '</span><br><b style="color:#fff;overflow-wrap:anywhere">' + p[1] + "</b></div>";
        })
        .join("") +
      "</div>" +
      (actionsHtml ? '<div class="capp-card-actions">' + actionsHtml + "</div>" : "") +
      "</div>"
    );
  }

  function listFiltersHtml() {
    var who = state.stats && state.stats.filters && state.stats.filters.companion;
    return (
      '<div class="toolbar" style="margin:0 0 10px;flex-wrap:wrap;gap:8px">' +
      "<span>勋章</span>" +
      '<select data-cert-filter-tag style="min-width:0;flex:1 1 140px"><option value="">全部勋章</option>' +
      visibleTags()
        .map(function (t) {
          return '<option value="' + esc(t.id) + '"' + (String(state.tagFilter) === String(t.id) ? " selected" : "") + ">" + esc(t.name) + "</option>";
        })
        .join("") +
      "</select>" +
      "<span>陪玩 UID / 昵称</span>" +
      '<input data-cert-filter-companion placeholder="UID（PW 编号）或昵称" style="min-width:0;flex:1 1 160px" value="' +
      esc(state.companionQuery) +
      '">' +
      '<button class="mini-btn" type="button" data-cert-filter-apply>筛选</button>' +
      (state.tagFilter || state.companionQuery ? '<button class="mini-btn" type="button" data-cert-filter-clear>清除筛选</button>' : "") +
      "</div>" +
      (who
        ? '<div class="admin-sync-note" style="margin:0 0 10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">当前陪玩：' +
          whoHtml(who) +
          '<button class="mini-btn" type="button" data-cert-holder="' +
          esc(who.companionProfileId) +
          '" data-cert-holder-tag="' +
          esc(state.tagFilter) +
          '">查看该陪玩全部订单</button></div>'
        : "")
    );
  }

  function visibleTags() {
    var seen = {};
    var out = [];
    state.tags.forEach(function (t) {
      var id = String((t && t.id) || "");
      if (id && seen[id]) return;
      if (id) seen[id] = 1;
      out.push(t);
    });
    return out;
  }

  function duplicateNameNote() {
    var names = {};
    var hits = [];
    visibleTags().forEach(function (t) {
      var key = String(t.name || "").trim().toLowerCase();
      if (!key) return;
      if (names[key]) hits.push(t.name);
      names[key] = (names[key] || 0) + 1;
    });
    if (!hits.length) return "";
    return '<div class="admin-sync-note" style="color:#e0b15a">发现同名勋章：' + esc(hits.join("、")) + "。页面按勋章 ID 分开显示，没有删除任何记录。</div>";
  }

  function holderCount(tag) {
    var sources = [(state.overview && state.overview.badges) || [], (state.stats && state.stats.badges) || []];
    for (var i = 0; i < sources.length; i++) {
      var hit = sources[i].find(function (b) {
        return String(b.id) === String(tag.id);
      });
      if (hit && hit.holders != null) return hit.holders;
    }
    return null;
  }

  function statusPill(enabled) {
    return '<span class="status ' + (enabled !== false ? "ok" : "wait") + '">' + (enabled !== false ? "已启用" : "已停用") + "</span>";
  }

  function manageCardsHtml() {
    var tags = visibleTags();
    if (!tags.length) return '<div class="empty">暂无认证勋章。</div>';
    return (
      '<div class="cert-badge-list">' +
      tags
        .map(function (tag) {
          var holders = holderCount(tag);
          var open = String(state.moreId) === String(tag.id);
          return (
            '<article class="cert-badge-card">' +
            '<div class="cert-card-top">' +
            badgePreviewHtml(tag) +
            statusPill(tag.enabled) +
            "</div>" +
            '<div class="cert-card-meta"><div>持有人：' +
            esc(holders == null ? "…" : holders) +
            "</div><div>统一佣金：" +
            esc(pct(tag.companionShareRate)) +
            "</div></div>" +
            '<div class="cert-actions">' +
            '<button class="mini-btn" type="button" data-cert-detail="' +
            esc(tag.id) +
            '">查看详情</button>' +
            '<button class="mini-btn" type="button" data-cert-tag-edit="' +
            esc(tag.id) +
            '">编辑</button></div>' +
            '<div class="cert-more" data-cert-more-root>' +
            '<button class="mini-btn" type="button" data-cert-more="' +
            esc(tag.id) +
            '">更多操作 ⋯</button>' +
            (open
              ? '<div class="cert-more-menu"><button class="mini-btn" type="button" data-cert-tag-toggle="' +
                esc(tag.id) +
                '" data-enabled="' +
                (tag.enabled !== false ? "false" : "true") +
                '">' +
                (tag.enabled !== false ? "停用" : "启用") +
                '</button><button class="mini-btn" type="button" data-cert-tag-delete="' +
                esc(tag.id) +
                '">删除</button></div>'
              : "") +
            "</div></article>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function exportToolbarHtml(tagId) {
    var years = [];
    for (var y = now.getFullYear(); y >= now.getFullYear() - 3; y--) years.push(y);
    return (
      '<div class="table-tools cert-export" style="justify-content:flex-start;flex-wrap:wrap;gap:8px">' +
      "<span>月报导出</span>" +
      '<select data-cert-export-year>' +
      years
        .map(function (y) {
          return '<option value="' + y + '"' + (y === Number(state.exportYear) ? " selected" : "") + ">" + y + " 年</option>";
        })
        .join("") +
      "</select>" +
      '<select data-cert-export-month>' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
        .map(function (mo) {
          return '<option value="' + mo + '"' + (mo === Number(state.exportMonth) ? " selected" : "") + ">" + mo + " 月</option>";
        })
        .join("") +
      "</select>" +
      '<button type="button" data-cert-export="' +
      esc(tagId || "") +
      '">' +
      (tagId ? "导出本勋章 Excel / CSV" : "导出 Excel / CSV") +
      "</button></div>"
    );
  }

  function tagOpsHtml(tag) {
    return (
      '<button class="mini-btn" type="button" data-cert-detail="' +
      esc(tag.id) +
      '">统计 / 持有人</button><button class="mini-btn" type="button" data-cert-tag-edit="' +
      esc(tag.id) +
      '">编辑</button>' +
      '<button class="mini-btn" type="button" data-cert-tag-toggle="' +
      esc(tag.id) +
      '" data-enabled="' +
      (tag.enabled !== false ? "false" : "true") +
      '">' +
      (tag.enabled !== false ? "停用" : "启用") +
      "</button>" +
      '<button class="mini-btn" type="button" data-cert-tag-delete="' +
      esc(tag.id) +
      '">删除</button>'
    );
  }

  function settingsCardsHtml() {
    var tags = visibleTags();
    if (!tags.length) return '<div class="empty">暂无认证勋章。</div>';
    return (
      '<div class="cert-settings-list">' +
      tags
        .map(function (tag) {
          return (
            '<article class="cert-badge-card">' +
            '<div class="cert-card-top">' +
            badgePreviewHtml(tag) +
            statusPill(tag.enabled) +
            "</div>" +
            '<div class="cert-card-meta"><div>排序：' +
            esc(tag.sort) +
            "</div><div>颜色：" +
            esc(tag.color || "-") +
            "</div><div>统一陪玩分成：" +
            esc(pct(tag.companionShareRate)) +
            "</div><div>佣金优先级：" +
            esc(tag.commissionPriority == null ? 100 : tag.commissionPriority) +
            "</div></div>" +
            '<div class="cert-actions"><button class="mini-btn" type="button" data-cert-tag-edit="' +
            esc(tag.id) +
            '">编辑</button></div></article>'
          );
        })
        .join("") +
      "</div>"
    );
  }

  function overviewKpiHtml(k) {
    k = k || {};
    return (
      '<div class="metric-grid cert-kpi">' +
      kpiCard("持有人数", String(k.holders || 0), "同一人多枚勋章只计 1 人") +
      kpiCard("接单数量", String(k.takenCount || 0), "按接单时间，订单去重") +
      kpiCard("已完成订单", String(k.completedCount || 0), "只计已结算") +
      kpiCard("订单总金额", money(k.gross), "已结算，按订单去重") +
      kpiCard("平台总佣金", money(k.platformCommission), "按绑定快照，不重算") +
      kpiCard("陪玩总收入", money(k.companionIncome), "已结算订单") +
      "</div>" +
      '<button class="primary-btn cert-link" type="button" data-cert-page="orders">查看详细统计</button>'
    );
  }

  function ordersKpiHtml(k) {
    k = k || {};
    return (
      '<div class="metric-grid cert-kpi">' +
      kpiCard("持有人数", String(k.holders || 0), "当前筛选下去重") +
      kpiCard("接单数量", String(k.takenCount || 0), "按接单时间") +
      kpiCard("已完成订单", String(k.completedCount || 0), "只计已结算") +
      kpiCard("接单总金额", money(k.takenAmount), "符合条件的接单") +
      kpiCard("已完成订单金额", money(k.gross), "已结算订单") +
      kpiCard("平台佣金", money(k.platformCommission), "历史快照，不重算") +
      kpiCard("实际结算", money(k.actualSettled)) +
      kpiCard("陪玩收入", money(k.companionIncome)) +
      kpiCard("退款金额", money(k.refundAmount), (k.refundedOrders || 0) + " 单含退款") +
      "</div>"
    );
  }

  function ordersBreakdownHtml() {
    var list = (state.stats && state.stats.badges) || [];
    if (state.tagFilter || list.length < 2) return "";
    return (
      '<h4 style="margin:14px 0 6px">各勋章明细</h4>' +
      '<p class="admin-sync-note" style="margin:0 0 8px;font-size:12px">顶部合计按订单去重。同一订单若归属多个勋章，会分别出现在下面各勋章中，所以各勋章相加可以大于顶部合计。这不是重复入账。</p>' +
      '<div class="cert-break-list">' +
      list
        .map(function (b) {
          return (
            '<article class="cert-badge-card"><div class="cert-card-top">' +
            badgePreviewHtml(b) +
            statusPill(b.enabled) +
            '</div><div class="cert-card-meta"><div>持有人：' +
            esc(b.holders || 0) +
            "</div><div>接单：" +
            esc(b.takenCount || 0) +
            " · 完成：" +
            esc(b.completedCount || 0) +
            "</div><div>已完成金额：" +
            money(b.gross) +
            "</div><div>平台佣金：" +
            money(b.platformCommission) +
            " · 陪玩收入：" +
            money(b.companionIncome) +
            "</div></div></article>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function noticesHtml() {
    return (
      (state.error ? '<div class="admin-sync-note" style="color:#c00">' + esc(state.error) + "</div>" : "") +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      duplicateNameNote()
    );
  }

  function tabBarHtml() {
    var active = state.view === "detail" || (state.view === "holder" && state.holderBack === "detail") ? "badges" : state.tab;
    return (
      '<div class="cert-tabs" role="tablist">' +
      PAGE_TABS.map(function (t) {
        return '<button type="button" role="tab" data-cert-page="' + t[0] + '" class="' + (active === t[0] ? "active" : "") + '" aria-selected="' + (active === t[0] ? "true" : "false") + '">' + t[1] + "</button>";
      }).join("") +
      "</div>"
    );
  }

  function overviewPageHtml() {
    var s = state.overview;
    return (
      '<div class="content-admin-head"><div><h3>数据总览</h3><p>全部时间、全部勋章。顶部数字按订单去重，同一人持有多枚勋章只计一次。</p></div></div>' +
      (state.overviewError ? '<div class="admin-sync-note" style="color:#c00">' + esc(state.overviewError) + "</div>" : "") +
      (s ? overviewKpiHtml(s.kpis) : '<div class="content-loading">正在统计...</div>')
    );
  }

  function badgesPageHtml() {
    return '<div class="content-admin-head"><div><h3>勋章管理</h3><p>查看持有人与订单，或编辑、启用、停用。删除需要再次确认，已有授予或订单的勋章不能删除。</p></div></div>' + manageCardsHtml();
  }

  function ordersPageHtml() {
    var s = state.stats;
    return (
      '<div class="content-admin-head"><div><h3>订单统计</h3><p>只统计当前筛选范围内的订单。已结算金额使用绑定时的佣金快照。</p></div></div>' +
      rangeToolbarHtml() +
      listFiltersHtml() +
      (state.statsError ? '<div class="admin-sync-note" style="color:#c00">' + esc(state.statsError) + "</div>" : "") +
      (s ? ordersKpiHtml(s.kpis) + '<p class="admin-sync-note" style="margin:0 0 8px;font-size:12px">' + esc(s.note || "") + "</p>" + ordersBreakdownHtml() : '<div class="content-loading">正在统计...</div>') +
      exportToolbarHtml(state.tagFilter || "")
    );
  }

  function settingsPageHtml() {
    var fallback =
      state.formOpen && state.editing && !(window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen())
        ? '<div class="panel" style="margin:12px 0">' + formHtml(state.editing) + "</div>"
        : "";
    return (
      '<div class="content-admin-head"><div><h3>系统设置</h3><p>前台卡片、排序、颜色、启用状态、统一陪玩分成和佣金优先级。点编辑后在面板里修改，不会把表单铺在页面上。</p></div>' +
      '<button class="primary-btn" type="button" data-cert-tag-add>新增认证勋章</button></div>' +
      fallback +
      settingsCardsHtml()
    );
  }

  function listPageHtml() {
    if (state.tab === "badges") return badgesPageHtml();
    if (state.tab === "orders") return ordersPageHtml();
    if (state.tab === "settings") return settingsPageHtml();
    return overviewPageHtml();
  }

  function memberStatus(row) {
    var cls = row.status === "active" ? "ok" : row.status === "pending_removal" ? "wait" : "bad";
    return '<span class="status ' + cls + '">' + esc(row.statusLabel || row.status) + "</span>";
  }

  function memberOpsHtml(r) {
    var ops =
      '<button class="mini-btn" type="button" data-cert-holder="' +
      esc(r.companionProfileId) +
      '" data-cert-holder-tag="' +
      esc(state.detailId) +
      '">查看订单明细</button>';
    if (r.status === "active") {
      ops +=
        '<button class="mini-btn" type="button" data-cert-request-removal="' +
        esc(r.id) +
        '">申请取消</button>' +
        (r.isCommissionPrimary
          ? '<span class="status info">佣金主勋章</span>'
          : '<button class="mini-btn" type="button" data-cert-set-primary="' + esc(r.companionProfileId) + '">设为佣金主勋章</button>');
    } else if (r.status === "pending_removal") {
      ops +=
        '<button class="mini-btn danger-btn" type="button" data-cert-approve-removal="' +
        esc(r.id) +
        '">批准取消</button><button class="mini-btn" type="button" data-cert-reject-removal="' +
        esc(r.id) +
        '">驳回</button>';
    }
    return ops;
  }

  function removalHtml(r) {
    if (!r.removalRequestedAt) return "";
    return (
      "申请：" +
      dt(r.removalRequestedAt) +
      " " +
      esc(r.removalRequestedByName || "") +
      "<br>原因：" +
      esc(r.removalReason || "-") +
      (r.removalApprovedAt ? "<br>批准：" + dt(r.removalApprovedAt) + " " + esc(r.removalApprovedByName || "") : "")
    );
  }

  function membersTableHtml(d) {
    var rows = d.members || [];
    if (!rows.length) return '<div class="empty">暂无持有人。可在上方输入 PW 编号授予。</div>';
    var table =
      '<div class="table-wrap capp-table-wrap"><table class="data-table" style="min-width:1280px"><thead><tr><th>陪玩名称 / 昵称</th><th>UID</th><th>徽章名称</th><th>获得徽章时间 / 授予人</th><th>状态</th><th class="amount">接单数量</th><th class="amount">已完成订单</th><th class="amount">接单总金额</th><th class="amount">订单总金额</th><th class="amount">平台佣金</th><th class="amount">陪玩收入</th><th>取消记录</th><th>操作</th></tr></thead><tbody>' +
      rows
        .map(function (r) {
          return (
            "<tr><td>" +
            holderLink(r.companionProfileId, state.detailId, r.nickname || r.pwCode || "-") +
            "</td><td>" +
            esc(r.uid || r.pwCode || "-") +
            "</td><td>" +
            esc(r.badgeName || r.tagName || "-") +
            "</td><td>" +
            dt(r.joinedAt) +
            "<br><small>" +
            esc(r.grantedByName || "-") +
            "</small></td><td>" +
            memberStatus(r) +
            '</td><td class="amount">' +
            esc(r.takenCount || 0) +
            '</td><td class="amount">' +
            esc(r.completedCount || 0) +
            '</td><td class="amount">' +
            money(r.takenAmount) +
            '</td><td class="amount">' +
            money(r.gross) +
            '</td><td class="amount">' +
            money(r.platformCommission) +
            '</td><td class="amount">' +
            money(r.companionIncome) +
            '</td><td style="font-size:12px">' +
            (removalHtml(r) || "-") +
            '</td><td class="actions-cell"><div class="row" style="gap:6px;flex-wrap:wrap">' +
            memberOpsHtml(r) +
            "</div></td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>";
    var cards =
      '<div class="capp-mobile-cards">' +
      rows
        .map(function (r) {
          return cardHtml(
            '<div style="min-width:0">' + holderLink(r.companionProfileId, state.detailId, r.nickname || r.pwCode || "-") + '<br><small style="color:#9f949c">' + esc(uidText(r)) + "</small></div>" + memberStatus(r),
            [
              ["徽章名称", esc(r.badgeName || r.tagName || "-")],
              ["获得徽章时间", dt(r.joinedAt)],
              ["接单数量", esc(r.takenCount || 0)],
              ["已完成订单", esc(r.completedCount || 0)],
              ["接单总金额", money(r.takenAmount)],
              ["订单总金额", money(r.gross)],
              ["平台佣金", money(r.platformCommission)],
              ["陪玩收入", money(r.companionIncome)],
            ].concat(r.removalRequestedAt ? [["取消记录", removalHtml(r)]] : []),
            memberOpsHtml(r)
          );
        })
        .join("") +
      "</div>";
    return table + cards;
  }

  var ORDER_FILTERS = [
    ["all", "全部"],
    ["taken", "已接单"],
    ["completed", "已完成"],
    ["open", "未完成"],
    ["closed", "已取消 / 退款"],
  ];

  function orderMatches(r, f) {
    if (f === "taken") return !!r.taken;
    if (f === "completed") return !!r.effective;
    if (f === "open") return !r.settled && r.status !== "cancelled" && r.status !== "refunded";
    if (f === "closed") return r.status === "cancelled" || r.status === "refunded" || (r.settled && !r.effective);
    return true;
  }

  function orderStatusHtml(r) {
    var cls = r.effective ? (r.refund > 0 ? "wait" : "ok") : r.status === "cancelled" || r.status === "refunded" || r.settled ? "bad" : "info";
    return '<span class="status ' + cls + '">' + esc(r.statusLabel || r.status) + "</span>";
  }

  function commissionRuleHtml(r) {
    if (!r.settled) return '<small style="color:var(--muted)">结算后显示</small>';
    return esc(pct(r.companionShareRate)) + (r.commissionBadgeName ? "<br><small>按「" + esc(r.commissionBadgeName) + "」</small>" : "<br><small>默认规则</small>");
  }

  function ordersHtml(all, opts) {
    opts = opts || {};
    all = all || [];
    var rows = all.filter(function (r) {
      return orderMatches(r, state.orderFilter);
    });
    var chips =
      '<div class="tabs" style="margin:8px 0;flex-wrap:wrap">' +
      ORDER_FILTERS.map(function (f) {
        var n = all.filter(function (r) {
          return orderMatches(r, f[0]);
        }).length;
        return '<button type="button" data-cert-order-filter="' + f[0] + '" class="' + (state.orderFilter === f[0] ? "active" : "") + '">' + f[1] + " " + n + "</button>";
      }).join("") +
      "</div>";
    if (!rows.length) return chips + '<div class="empty">' + esc(opts.empty || "该时间范围内暂无相关订单。") + "</div>";
    var table =
      '<div class="table-wrap capp-table-wrap"><table class="data-table" style="min-width:1380px"><thead><tr><th>订单号</th><th>下单时间</th><th>接单时间</th><th>完成时间</th><th>老板</th>' +
      (opts.showCompanion ? "<th>陪玩</th>" : "") +
      '<th>状态</th><th class="amount">订单金额</th><th class="amount">实际结算</th><th class="amount">陪玩收入</th><th class="amount">平台利润</th><th class="amount">退款</th><th>结算分成</th><th>归属勋章</th></tr></thead><tbody>' +
      rows
        .map(function (r) {
          return (
            "<tr><td>" +
            esc(r.orderNo || r.orderId) +
            "</td><td>" +
            dt(r.createdAt) +
            "</td><td>" +
            (r.taken ? dt(r.takenAt) : "-") +
            "</td><td>" +
            dt(r.completedAt) +
            "</td><td>" +
            esc(r.bossName || "-") +
            (r.bossCode ? "<br><small>" + esc(r.bossCode) + "</small>" : "") +
            "</td>" +
            (opts.showCompanion
              ? "<td>" + holderLink(r.companionProfileId, opts.tagId, r.nickname || r.pwCode || "-") + "<br><small>" + esc(uidText(r)) + "</small></td>"
              : "") +
            "<td>" +
            orderStatusHtml(r) +
            '</td><td class="amount">' +
            money(r.gross) +
            '</td><td class="amount">' +
            (r.settled ? money(r.actualSettled) : "-") +
            '</td><td class="amount">' +
            (r.settled ? money(r.companionIncome) : "-") +
            '</td><td class="amount">' +
            (r.settled ? money(r.platformCommission) : "-") +
            '</td><td class="amount">' +
            money(r.refund) +
            "</td><td>" +
            commissionRuleHtml(r) +
            '</td><td style="font-size:12px">' +
            esc((r.badgeNames || []).join("、") || "-") +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>";
    var cards =
      '<div class="capp-mobile-cards">' +
      rows
        .map(function (r) {
          return cardHtml(
            '<b style="color:#fff;overflow-wrap:anywhere">' + esc(r.orderNo || r.orderId) + "</b>" + orderStatusHtml(r),
            (opts.showCompanion ? [["陪玩", holderLink(r.companionProfileId, opts.tagId, r.nickname || r.pwCode || "-") + " <small>" + esc(r.pwCode || "") + "</small>"]] : [])
              .concat([
                ["老板", esc(r.bossName || "-")],
                ["订单金额", money(r.gross)],
                ["下单时间", dt(r.createdAt)],
                ["接单时间", r.taken ? dt(r.takenAt) : "-"],
                ["完成时间", dt(r.completedAt)],
                ["实际结算", r.settled ? money(r.actualSettled) : "-"],
                ["陪玩收入", r.settled ? money(r.companionIncome) : "-"],
                ["平台利润", r.settled ? money(r.platformCommission) : "-"],
                ["退款", money(r.refund)],
                ["结算分成", commissionRuleHtml(r)],
                ["归属勋章", esc((r.badgeNames || []).join("、") || "-")],
              ]),
            ""
          );
        })
        .join("") +
      "</div>";
    return chips + table + cards;
  }

  function monthlyTableHtml(d) {
    var rows = d.monthly || [];
    if (!rows.length) return '<div class="empty">暂无月度数据。</div>';
    return (
      '<div class="table-wrap"><table class="data-table" style="min-width:900px"><thead><tr><th>月份</th><th class="amount">接单数量</th><th class="amount">接单总金额</th><th class="amount">已完成订单</th><th class="amount">订单总金额</th><th class="amount">实际结算</th><th class="amount">陪玩收入</th><th class="amount">平台佣金</th><th class="amount">退款</th></tr></thead><tbody>' +
      rows
        .map(function (r) {
          return (
            "<tr><td>" +
            esc(r.month) +
            '</td><td class="amount">' +
            esc(r.takenCount || 0) +
            '</td><td class="amount">' +
            money(r.takenAmount) +
            '</td><td class="amount">' +
            esc(r.completedCount || 0) +
            '</td><td class="amount">' +
            money(r.gross) +
            '</td><td class="amount">' +
            money(r.actualSettled) +
            '</td><td class="amount">' +
            money(r.companionIncome) +
            '</td><td class="amount">' +
            money(r.platformCommission) +
            '</td><td class="amount">' +
            money(r.refundAmount) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>"
    );
  }

  function commissionLogHtml(d) {
    var rows = d.commissionLog || [];
    if (!rows.length) return '<div class="empty">暂无佣金变更记录。</div>';
    return (
      '<div class="table-wrap"><table class="data-table" style="min-width:520px"><thead><tr><th>时间</th><th>原陪玩分成</th><th>新陪玩分成</th><th>操作人</th></tr></thead><tbody>' +
      rows
        .map(function (r) {
          return "<tr><td>" + dt(r.changedAt) + "</td><td>" + esc(pct(r.oldRate)) + "</td><td>" + esc(pct(r.newRate)) + "</td><td>" + esc(r.changedByName || "-") + "</td></tr>";
        })
        .join("") +
      "</tbody></table></div>"
    );
  }

  function detailHolderFilterHtml(d) {
    var opts = (d && d.holderOptions) || [];
    return (
      '<div class="toolbar" style="margin:0 0 10px;flex-wrap:wrap;gap:8px">' +
      "<span>持有人 / 陪玩</span>" +
      '<select data-cert-detail-holder style="min-width:0;flex:1 1 220px"><option value="">全部持有人</option>' +
      opts
        .map(function (o) {
          return (
            '<option value="' +
            esc(o.companionProfileId) +
            '"' +
            (String(state.detailHolder) === String(o.companionProfileId) ? " selected" : "") +
            ">" +
            esc((o.nickname || "-") + " · " + uidText(o) + (o.status === "removed" ? "（已取消）" : o.status === "pending_removal" ? "（待取消）" : "")) +
            "</option>"
          );
        })
        .join("") +
      "</select>" +
      (state.detailHolder
        ? '<button class="mini-btn" type="button" data-cert-holder="' + esc(state.detailHolder) + '" data-cert-holder-tag="' + esc(state.detailId) + '">打开该持有人订单明细</button>'
        : "") +
      "</div>"
    );
  }

  function detailPageHtml() {
    var d = state.detail;
    var b = (d && d.badge) || state.tags.find(function (t) {
      return String(t.id) === String(state.detailId);
    }) || {};
    var tabs = [
      ["members", "持有人"],
      ["orders", "订单明细"],
      ["monthly", "月度汇总"],
      ["log", "佣金变更记录"],
    ];
    var body = "";
    if (state.detailError) body = '<div class="admin-sync-note" style="color:#c00">' + esc(state.detailError) + "</div>";
    else if (!d || state.detailLoading) body = '<div class="content-loading">正在读取勋章详情...</div>';
    else {
      body =
        detailHolderFilterHtml(d) +
        kpiGridHtml(d.kpis, kpiCard("持有人数", String(b.holders != null ? b.holders : 0), (d.members || []).length + " 位（含已取消）")) +
        '<p class="admin-sync-note" style="margin:0 0 8px;font-size:12px">本月：接单 ' +
        esc((d.month && d.month.takenCount) || 0) +
        " 单 · 完成 " +
        esc((d.month && d.month.completedCount) || 0) +
        " 单 · 订单总金额 " +
        money(d.month && d.month.gross) +
        " · 平台佣金 " +
        money(d.month && d.month.platformCommission) +
        "</p>" +
        '<div class="tabs" style="flex-wrap:wrap">' +
        tabs
          .map(function (t) {
            var n = t[0] === "members" ? " " + (d.members || []).length : t[0] === "orders" ? " " + (d.orders || []).length : "";
            return '<button type="button" data-cert-detail-tab="' + t[0] + '" class="' + (state.detailTab === t[0] ? "active" : "") + '">' + t[1] + n + "</button>";
          })
          .join("") +
        "</div>" +
        (state.detailTab === "orders"
          ? ordersHtml(d.orders, { showCompanion: true, tagId: state.detailId, empty: "该时间范围内暂无归属此勋章的订单。" })
          : state.detailTab === "monthly"
            ? monthlyTableHtml(d)
            : state.detailTab === "log"
              ? commissionLogHtml(d)
              : membersTableHtml(d));
    }
    return (
      '<div class="content-admin-head"><div><h3 style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      badgePreviewHtml(b) +
      "<span>勋章详情</span></h3><p>持有人数 " +
      esc(b.holders != null ? b.holders : "-") +
      " · 统一陪玩分成 " +
      esc(pct(b.companionShareRate)) +
      (b.platformRate != null ? " / 平台 " + esc(pct(b.platformRate)) : "") +
      " · 佣金优先级 " +
      esc(b.commissionPriority == null ? 100 : b.commissionPriority) +
      "</p></div>" +
      '<button class="ghost-btn" type="button" data-cert-back>返回勋章列表</button></div>' +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      '<div class="panel" style="padding:12px 14px;margin:8px 0">' +
      '<form class="toolbar" style="margin:0 0 8px;flex-wrap:wrap;gap:8px" data-cert-commission-form>' +
      "<span>统一陪玩分成 %</span>" +
      '<input name="companionShareRate" type="number" min="0" max="100" step="0.01" style="width:110px" value="' +
      esc(b.companionShareRate == null ? "" : b.companionShareRate) +
      '" placeholder="留空=默认">' +
      "<span>优先级</span>" +
      '<input name="commissionPriority" type="number" min="0" max="9999" step="1" style="width:90px" value="' +
      esc(b.commissionPriority == null ? 100 : b.commissionPriority) +
      '">' +
      '<button class="mini-btn" type="submit">保存统一佣金</button>' +
      '<small style="color:var(--muted)">修改只影响之后绑定陪玩的订单；已绑定 / 已结算订单保留原佣金快照。</small>' +
      "</form>" +
      '<form class="toolbar" style="margin:0;flex-wrap:wrap;gap:8px" data-cert-grant-form>' +
      "<span>授予勋章</span>" +
      '<input name="companionRef" placeholder="陪玩 PW 编号，如 PW00076" style="min-width:0;flex:1 1 180px;max-width:260px">' +
      '<button class="mini-btn" type="submit">授予</button>' +
      "</form></div>" +
      rangeToolbarHtml() +
      body +
      exportToolbarHtml(state.detailId)
    );
  }

  function holderPageHtml() {
    var h = state.holder;
    var tag = state.tags.find(function (t) {
      return String(t.id) === String(state.holderTag);
    });
    var backLabel = state.holderBack === "detail" ? "返回勋章详情" : "返回勋章列表";
    var head = function (inner) {
      return (
        '<div class="content-admin-head"><div>' +
        inner +
        '</div><button class="ghost-btn" type="button" data-cert-holder-back>' +
        backLabel +
        "</button></div>"
      );
    };
    if (state.holderError) return head("<h3>持有人订单明细</h3>") + '<div class="admin-sync-note" style="color:#c00">' + esc(state.holderError) + "</div>";
    if (!h || state.holderLoading) return head("<h3>持有人订单明细</h3>") + '<div class="content-loading">正在读取该陪玩的订单...</div>';
    var who = h.holder || {};
    var a = h.assignment;
    var all = h.allTime || {};
    return (
      head(
        '<h3 style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          esc(who.nickname || "-") +
          '<small style="color:var(--muted);font-weight:400">' +
          esc(uidText(who)) +
          "</small></h3><p style=\"display:flex;align-items:center;gap:8px;flex-wrap:wrap\">" +
          (a && tag
            ? badgePreviewHtml(tag) + "<span>获得徽章时间 " + dt(a.grantedAt) + (a.grantedByName ? "（" + esc(a.grantedByName) + "）" : "") + "</span>" + memberStatus(a)
            : tag
              ? badgePreviewHtml(tag) + "<span>未持有记录（仅历史订单归属）</span>"
              : "<span>该陪玩全部勋章归属订单</span>") +
          "</p>"
      ) +
      (tag
        ? '<div class="tabs" style="margin:8px 0;flex-wrap:wrap">' +
          '<button type="button" data-cert-holder-scope="tag" class="' +
          (state.holderScope === "tag" ? "active" : "") +
          '">只看「' +
          esc(tag.name) +
          "」订单</button>" +
          '<button type="button" data-cert-holder-scope="all" class="' +
          (state.holderScope === "all" ? "active" : "") +
          '">全部勋章订单</button></div>'
        : "") +
      rangeToolbarHtml() +
      kpiGridHtml(h.kpis, kpiCard("相关订单", String((h.orders || []).length), "当前时间范围")) +
      '<p class="admin-sync-note" style="margin:0 0 8px;font-size:12px">累计（全部时间）：接单 ' +
      esc(all.takenCount || 0) +
      " 单 · 接单总金额 " +
      money(all.takenAmount) +
      " · 完成 " +
      esc(all.completedCount || 0) +
      " 单 · 订单总金额 " +
      money(all.gross) +
      " · 平台佣金 " +
      money(all.platformCommission) +
      "</p>" +
      ((h.badges || []).length
        ? '<div class="toolbar" style="margin:0 0 8px;flex-wrap:wrap;gap:8px"><span>持有勋章</span>' +
          h.badges
            .map(function (bd) {
              var t = state.tags.find(function (x) {
                return String(x.id) === String(bd.tagId);
              }) || { name: bd.tagName };
              return '<span style="display:inline-flex;gap:4px;align-items:center">' + badgePreviewHtml(t) + memberStatus(bd) + "</span>";
            })
            .join("") +
          "</div>"
        : "") +
      '<h4 style="margin:12px 0 4px">订单明细</h4>' +
      ordersHtml(h.orders, { empty: "该时间范围内该陪玩暂无相关订单。" })
    );
  }

  function pageHtml() {
    if (state.loading) return '<div class="content-loading">正在读取认证徽章...</div>';
    var body = state.view === "holder" ? holderPageHtml() : state.view === "detail" ? detailPageHtml() : listPageHtml();
    return tabBarHtml() + noticesHtml() + body;
  }

  function render(opts) {
    ensureCss();
    var box = scroller();
    var y = box ? box.scrollTop : 0;
    var el = target();
    if (!el) return;
    el.innerHTML = pageHtml();
    if (state.formOpen && state.editing && window.MCJAdminOverlay) {
      window.MCJAdminOverlay.open({
        title: state.editing.id ? "编辑认证徽章" : "新增认证徽章",
        html: formHtml(state.editing),
        onClose: function () {
          state.formOpen = false;
          state.editing = null;
        },
      });
    }
    if (!box) return;
    if (opts && opts.toTop) {
      var header = document.querySelector(".admin-header");
      var headerH = header ? header.offsetHeight : 0;
      var top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
      box.scrollTop = Math.max(0, top - headerH - 8);
      return;
    }
    box.scrollTop = y;
  }

  function toTop() {
    render({ toTop: true });
  }

  function listQuery() {
    var q = "action=stats&" + rangeQuery();
    if (state.tagFilter) q += "&id=" + encodeURIComponent(state.tagFilter);
    if (state.companionQuery) q += "&companion=" + encodeURIComponent(state.companionQuery);
    return q;
  }

  /** Filters fire overlapping requests; only the latest response per view may render. */
  var reqSeq = { stats: 0, detail: 0, holder: 0, overview: 0 };

  function loadOverview() {
    var my = ++reqSeq.overview;
    state.overviewError = "";
    return apiGet("action=stats&range=all")
      .then(function (body) {
        if (my !== reqSeq.overview) return;
        state.overview = body;
        if (!state.formOpen && state.view === "list" && (state.tab === "overview" || state.tab === "badges")) render();
      })
      .catch(function (err) {
        if (my !== reqSeq.overview) return;
        state.overviewError = err.message || "统计读取失败";
        if (!state.formOpen && state.view === "list" && (state.tab === "overview" || state.tab === "badges")) render();
      });
  }

  function loadStats() {
    var my = ++reqSeq.stats;
    state.statsError = "";
    return apiGet(listQuery())
      .then(function (body) {
        if (my !== reqSeq.stats) return;
        state.stats = body;
        if (!state.formOpen && state.view === "list" && (state.tab === "orders" || state.tab === "badges")) render();
      })
      .catch(function (err) {
        if (my !== reqSeq.stats) return;
        state.statsError = err.message || "统计读取失败";
        if (!state.formOpen && state.view === "list" && state.tab === "orders") render();
      });
  }

  function loadDetail() {
    if (!state.detailId) return Promise.resolve();
    state.detailLoading = true;
    state.detailError = "";
    render();
    var q = "action=detail&id=" + encodeURIComponent(state.detailId) + "&" + rangeQuery();
    if (state.detailHolder) q += "&companion=" + encodeURIComponent(state.detailHolder);
    var my = ++reqSeq.detail;
    return apiGet(q)
      .then(function (body) {
        if (my !== reqSeq.detail) return;
        state.detail = body;
        state.detailLoading = false;
        render();
      })
      .catch(function (err) {
        if (my !== reqSeq.detail) return;
        state.detailLoading = false;
        state.detailError = err.message || "详情读取失败";
        render();
      });
  }

  function loadHolder() {
    if (!state.holderRef) return Promise.resolve();
    state.holderLoading = true;
    state.holderError = "";
    render();
    var q = "action=holder&companion=" + encodeURIComponent(state.holderRef) + "&" + rangeQuery();
    if (state.holderScope === "tag" && state.holderTag) q += "&id=" + encodeURIComponent(state.holderTag);
    var my = ++reqSeq.holder;
    return apiGet(q)
      .then(function (body) {
        if (my !== reqSeq.holder) return;
        state.holder = body;
        state.holderLoading = false;
        render();
      })
      .catch(function (err) {
        if (my !== reqSeq.holder) return;
        state.holderLoading = false;
        state.holderError = err.message || "读取失败";
        render();
      });
  }

  function refreshCurrent() {
    if (state.view === "holder") return loadHolder();
    return state.view === "detail" ? loadDetail() : loadStats();
  }

  function load() {
    state.loading = true;
    state.error = "";
    render();
    apiGet()
      .then(function (body) {
        state.tags = body.items || body.tags || [];
        state.loading = false;
        render();
        loadOverview();
        loadStats();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || "读取失败";
        render();
      });
  }

  function downloadCsv(tagId) {
    var q = "action=export&year=" + encodeURIComponent(state.exportYear) + "&month=" + encodeURIComponent(state.exportMonth) + (tagId ? "&id=" + encodeURIComponent(tagId) : "");
    apiGet(q)
      .then(function (res) {
        var blob = new Blob(["\ufeff" + (res.csv || "")], { type: "text/csv;charset=utf-8" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = (res.fileBase || "MeowCuiJiao_CertBadge") + ".csv";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          URL.revokeObjectURL(a.href);
          a.remove();
        }, 500);
        state.message = "已导出 " + (res.month || "") + "：" + (res.summaryCount || 0) + " 个勋章，" + (res.orderCount || 0) + " 条订单明细";
        render();
      })
      .catch(function (err) {
        alert(err.message || "导出失败");
      });
  }

  function afterMutation(body) {
    state.message = (body && body.message) || "已更新";
    if (body && body.items) state.tags = body.items;
    loadOverview();
    refreshCurrent();
  }

  function syncLivePreview(root) {
    if (!root) return;
    var preview = root.querySelector("[data-cert-preview]");
    if (!preview) return;
    var nameEl = root.querySelector('[name="name"]');
    var iconEl = root.querySelector('[name="icon"]');
    var colorEl = root.querySelector('[name="color"]');
    preview.innerHTML = badgePreviewHtml({
      name: nameEl ? nameEl.value : "",
      icon: iconEl ? iconEl.value : "🏅",
      color: colorEl ? colorEl.value : "#f5c542",
    });
  }

  document.addEventListener("input", function (e) {
    if (!e.target || !e.target.getAttribute || !e.target.getAttribute("data-cert-live")) return;
    var form = e.target.closest("[data-cert-tag-form]");
    if (form) syncLivePreview(form);
  });
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    if (t.hasAttribute("data-cert-export-year")) state.exportYear = Number(t.value);
    if (t.hasAttribute("data-cert-export-month")) state.exportMonth = Number(t.value);
    if (t.hasAttribute("data-cert-from")) state.from = t.value;
    if (t.hasAttribute("data-cert-to")) state.to = t.value;
    if (t.hasAttribute("data-cert-filter-tag")) {
      state.tagFilter = t.value;
      loadStats();
      return;
    }
    if (t.hasAttribute("data-cert-detail-holder")) {
      state.detailHolder = t.value;
      loadDetail();
      return;
    }
    if (!t.getAttribute("data-cert-live")) return;
    var form = t.closest("[data-cert-tag-form]");
    if (form) syncLivePreview(form);
  });

  document.addEventListener("click", function (e) {
    if (!e.target || !e.target.closest) return;
    var pageBtn = e.target.closest("[data-cert-page]");
    if (pageBtn && !e.target.closest("[data-cert-more],[data-cert-tag-edit],[data-cert-tag-toggle],[data-cert-tag-delete],[data-cert-detail]")) {
      state.tab = pageBtn.getAttribute("data-cert-page") || "overview";
      state.view = "list";
      state.moreId = "";
      render({ toTop: true });
      if (state.tab === "overview" && !state.overview) loadOverview();
      if (state.tab === "orders" && !state.stats) loadStats();
      return;
    }
    var moreBtn = e.target.closest("[data-cert-more]");
    if (moreBtn) {
      var mid = moreBtn.getAttribute("data-cert-more");
      state.moreId = String(state.moreId) === String(mid) ? "" : mid;
      render();
      return;
    }
    if (state.moreId && !e.target.closest("[data-cert-more-root]")) state.moreId = "";
    var rangeBtn = e.target.closest("[data-cert-range]");
    if (rangeBtn) {
      state.range = rangeBtn.getAttribute("data-cert-range");
      if (state.range === "custom") {
        render();
        return;
      }
      render();
      refreshCurrent();
      return;
    }
    if (e.target.closest("[data-cert-apply-custom]")) {
      if (!state.from) {
        alert("请选择开始日期");
        return;
      }
      refreshCurrent();
      return;
    }
    if (e.target.closest("[data-cert-filter-apply]")) {
      var qInput = target() && target().querySelector("[data-cert-filter-companion]");
      state.companionQuery = qInput ? String(qInput.value || "").trim() : "";
      loadStats();
      return;
    }
    if (e.target.closest("[data-cert-filter-clear]")) {
      state.tagFilter = "";
      state.companionQuery = "";
      render();
      loadStats();
      return;
    }
    var holderBtn = e.target.closest("[data-cert-holder]");
    if (holderBtn) {
      state.holderBack = state.view === "detail" ? "detail" : "list";
      state.view = "holder";
      state.holderRef = holderBtn.getAttribute("data-cert-holder");
      state.holderTag = holderBtn.getAttribute("data-cert-holder-tag") || "";
      state.holderScope = state.holderTag ? "tag" : "all";
      state.holder = null;
      state.orderFilter = "all";
      state.message = "";
      loadHolder();
      toTop();
      return;
    }
    if (e.target.closest("[data-cert-holder-back]")) {
      state.view = state.holderBack === "detail" && state.detailId ? "detail" : "list";
      state.holder = null;
      state.orderFilter = "all";
      refreshCurrent();
      toTop();
      return;
    }
    var scopeBtn = e.target.closest("[data-cert-holder-scope]");
    if (scopeBtn) {
      state.holderScope = scopeBtn.getAttribute("data-cert-holder-scope");
      loadHolder();
      return;
    }
    var ofBtn = e.target.closest("[data-cert-order-filter]");
    if (ofBtn) {
      state.orderFilter = ofBtn.getAttribute("data-cert-order-filter");
      render();
      return;
    }
    var detailBtn = e.target.closest("[data-cert-detail]");
    if (detailBtn && !e.target.closest("[data-cert-tag-edit],[data-cert-tag-toggle],[data-cert-tag-delete]")) {
      state.view = "detail";
      state.tab = "badges";
      state.moreId = "";
      state.detailId = detailBtn.getAttribute("data-cert-detail");
      state.detail = null;
      state.detailTab = "members";
      state.detailHolder = "";
      state.orderFilter = "all";
      state.message = "";
      loadDetail();
      toTop();
      return;
    }
    if (e.target.closest("[data-cert-back]")) {
      state.view = "list";
      state.tab = "badges";
      state.detail = null;
      state.message = "";
      state.moreId = "";
      render();
      loadStats();
      toTop();
      return;
    }
    var tabBtn = e.target.closest("[data-cert-detail-tab]");
    if (tabBtn) {
      state.detailTab = tabBtn.getAttribute("data-cert-detail-tab");
      render();
      return;
    }
    var exp = e.target.closest("[data-cert-export]");
    if (exp) {
      downloadCsv(exp.getAttribute("data-cert-export"));
      return;
    }
    var reqRm = e.target.closest("[data-cert-request-removal]");
    if (reqRm) {
      var reason = prompt("请填写取消该勋章的原因（提交后需管理员审批，审批前勋章继续生效）：", "");
      if (reason == null) return;
      if (!String(reason).trim()) {
        alert("请填写取消原因");
        return;
      }
      apiPost({ action: "request_removal", assignmentId: reqRm.getAttribute("data-cert-request-removal"), reason: reason })
        .then(afterMutation)
        .catch(function (err) {
          alert(err.message || "操作失败");
        });
      return;
    }
    var apRm = e.target.closest("[data-cert-approve-removal]");
    if (apRm) {
      if (!confirm("批准取消后该陪玩不再持有此勋章（之后的新订单不再按此勋章结算）；历史订单仍归属此勋章。确认批准？")) return;
      apiPost({ action: "approve_removal", assignmentId: apRm.getAttribute("data-cert-approve-removal") })
        .then(afterMutation)
        .catch(function (err) {
          alert(err.message || "操作失败");
        });
      return;
    }
    var rjRm = e.target.closest("[data-cert-reject-removal]");
    if (rjRm) {
      apiPost({ action: "reject_removal", assignmentId: rjRm.getAttribute("data-cert-reject-removal") })
        .then(afterMutation)
        .catch(function (err) {
          alert(err.message || "操作失败");
        });
      return;
    }
    var prim = e.target.closest("[data-cert-set-primary]");
    if (prim) {
      apiPost({ action: "set_primary", companionProfileId: prim.getAttribute("data-cert-set-primary"), id: state.detailId })
        .then(afterMutation)
        .catch(function (err) {
          alert(err.message || "操作失败");
        });
      return;
    }
    var add = e.target.closest("[data-cert-tag-add]");
    if (add) {
      state.editing = blank();
      state.formOpen = true;
      render();
      return;
    }
    var edit = e.target.closest("[data-cert-tag-edit]");
    if (edit) {
      var id = edit.getAttribute("data-cert-tag-edit");
      state.editing =
        state.tags.find(function (t) {
          return String(t.id) === String(id);
        }) || blank();
      state.formOpen = true;
      render();
      return;
    }
    var cancel = e.target.closest("[data-cert-tag-cancel]");
    if (cancel) {
      state.formOpen = false;
      state.editing = null;
      if (window.MCJAdminOverlay && window.MCJAdminOverlay.close) window.MCJAdminOverlay.close();
      render();
      return;
    }
    var toggle = e.target.closest("[data-cert-tag-toggle]");
    if (toggle) {
      state.moreId = "";
      var tid = toggle.getAttribute("data-cert-tag-toggle");
      var en = toggle.getAttribute("data-enabled") === "true";
      apiPost({ action: en ? "enable" : "disable", id: tid })
        .then(afterMutation)
        .catch(function (err) {
          alert(err.message || "操作失败");
        });
      return;
    }
    var del = e.target.closest("[data-cert-tag-delete]");
    if (del) {
      state.moreId = "";
      if (!confirm("确认删除该认证徽章？已有授予记录或订单归属的勋章不能删除，请改为停用。")) return;
      apiPost({ action: "delete", id: del.getAttribute("data-cert-tag-delete") })
        .then(afterMutation)
        .catch(function (err) {
          alert(err.message || "删除失败");
        });
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" || !e.target || !e.target.hasAttribute) return;
    if (e.target.hasAttribute("data-cert-filter-companion")) {
      e.preventDefault();
      state.companionQuery = String(e.target.value || "").trim();
      loadStats();
      return;
    }
    if (e.target.hasAttribute("data-cert-detail") && e.target.getAttribute("role") === "button") e.target.click();
  });

  document.addEventListener("submit", function (e) {
    var commissionForm = e.target.closest("[data-cert-commission-form]");
    if (commissionForm) {
      e.preventDefault();
      var cfd = new FormData(commissionForm);
      var rate = String(cfd.get("companionShareRate") || "").trim();
      var b = (state.detail && state.detail.badge) || {};
      var oldRate = b.companionShareRate == null ? "未设置" : b.companionShareRate + "%";
      if (!confirm("将统一陪玩分成从 " + oldRate + " 改为 " + (rate === "" ? "默认规则" : rate + "%") + "？\n只影响之后绑定陪玩的订单，已有订单保留原佣金快照。")) return;
      apiPost({ action: "set_commission", id: state.detailId, companionShareRate: rate === "" ? null : Number(rate), commissionPriority: cfd.get("commissionPriority") })
        .then(afterMutation)
        .catch(function (err) {
          alert(err.message || "保存失败");
        });
      return;
    }
    var grantForm = e.target.closest("[data-cert-grant-form]");
    if (grantForm) {
      e.preventDefault();
      var ref = String(new FormData(grantForm).get("companionRef") || "").trim();
      if (!ref) {
        alert("请填写陪玩 PW 编号");
        return;
      }
      apiPost({ action: "grant", id: state.detailId, companionRef: ref })
        .then(afterMutation)
        .catch(function (err) {
          alert(err.message || "授予失败");
        });
      return;
    }
    var form = e.target.closest("[data-cert-tag-form]");
    if (!form) return;
    e.preventDefault();
    var fd = new FormData(form);
    var rateRaw = String(fd.get("companionShareRate") || "").trim();
    var draft = {
      id: String(fd.get("id") || "").trim(),
      name: String(fd.get("name") || "").trim(),
      icon: String(fd.get("icon") || "🏅").trim(),
      color: String(fd.get("color") || "#f5c542").trim(),
      sort: Number(fd.get("sort") || 100),
      enabled: String(fd.get("enabled")) !== "false",
      companionShareRate: rateRaw === "" ? null : Number(rateRaw),
      commissionPriority: Number(fd.get("commissionPriority") || 100),
    };
    if (!draft.name) {
      alert("请填写徽章名称");
      return;
    }
    if (draft.companionShareRate != null && !(draft.companionShareRate >= 0 && draft.companionShareRate <= 100)) {
      alert("陪玩分成需在 0–100 之间");
      return;
    }
    state.saving = true;
    apiPost({ action: "save", tag: draft })
      .then(function (body) {
        state.formOpen = false;
        state.editing = null;
        state.saving = false;
        if (window.MCJAdminOverlay && window.MCJAdminOverlay.close) window.MCJAdminOverlay.close();
        afterMutation(body);
      })
      .catch(function (err) {
        state.saving = false;
        alert(err.message || "保存失败");
      });
  });

  document.addEventListener("mcj:admin-section", function (e) {
    var section = e && e.detail && e.detail.section;
    setCertBody(section === "companion-cert-tags");
    if (section === "companion-cert-tags") load();
  });

  function boot() {
    ensureCss();
    if (!target()) return;
    var shown = document.getElementById("section-companion-cert-tags");
    if (shown && shown.offsetParent !== null) setCertBody(true);
    load();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.MCJAdminCompanionCertTags = { reload: load, render: render };
})();
