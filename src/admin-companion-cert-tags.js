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
    exportYear: now.getFullYear(),
    exportMonth: now.getMonth() + 1,
  };

  var RANGES = [
    ["today", "今日"],
    ["week", "本周"],
    ["month", "本月"],
    ["custom", "自定义"],
    ["all", "全部"],
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
      '<div class="toolbar" style="margin:10px 0">' +
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
      '<div class="metric-card" style="padding:12px 14px">' +
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
      kpiCard("完成单量", String(k.completedCount || 0)) +
      kpiCard("订单总金额", money(k.gross)) +
      kpiCard("实际结算", money(k.actualSettled)) +
      kpiCard("陪玩收入", money(k.companionIncome)) +
      kpiCard("平台佣金", money(k.platformCommission)) +
      kpiCard("退款金额", money(k.refundAmount), (k.refundedOrders || 0) + " 单含退款") +
      "</div>"
    );
  }

  function badgeCardsHtml() {
    var list = (state.stats && state.stats.badges) || [];
    if (!list.length) return '<div class="empty">暂无认证勋章统计。</div>';
    return (
      '<div class="panel-grid" style="margin:10px 0">' +
      list
        .map(function (b) {
          return (
            '<div class="panel" style="padding:12px 14px;cursor:pointer" data-cert-detail="' +
            esc(b.id) +
            '">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
            badgePreviewHtml(b) +
            '<span class="status ' +
            (b.enabled !== false ? "ok" : "wait") +
            '">' +
            (b.enabled !== false ? "启用" : "停用") +
            "</span></div>" +
            '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px 10px;margin-top:10px;font-size:12px;color:var(--muted)">' +
            "<div>持有人数<br><b style=\"color:#fff;font-size:14px\">" +
            esc(b.holders) +
            (b.pendingRemoval ? '<small style="color:var(--yellow)"> (' + esc(b.pendingRemoval) + " 待取消)</small>" : "") +
            "</b></div>" +
            "<div>完成单量<br><b style=\"color:#fff;font-size:14px\">" +
            esc(b.completedCount) +
            "</b></div>" +
            "<div>统一分成<br><b style=\"color:#fff;font-size:14px\">" +
            esc(pct(b.companionShareRate)) +
            "</b></div>" +
            "<div>营业额<br><b style=\"color:#fff;font-size:14px\">" +
            money(b.actualSettled) +
            "</b></div>" +
            "<div>平台利润<br><b style=\"color:#fff;font-size:14px\">" +
            money(b.platformCommission) +
            "</b></div>" +
            "<div>本月<br><b style=\"color:#fff;font-size:14px\">" +
            esc((b.month && b.month.completedCount) || 0) +
            " 单 / " +
            money(b.month && b.month.platformCommission) +
            "</b></div>" +
            "</div></div>"
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
      '<div class="table-tools" style="justify-content:flex-start">' +
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
      (tagId ? "导出本勋章 CSV / Excel" : "导出全部勋章 CSV / Excel") +
      "</button></div>"
    );
  }

  function listPageHtml() {
    var s = state.stats;
    return (
      '<div class="content-admin-head"><div><h3>认证勋章统计与统一佣金</h3><p>按勋章查看持有人数、完成单量、营业额与平台利润；统一佣金对持有该勋章的所有陪玩自动生效。历史订单按绑定陪玩时的勋章快照归属与结算。</p></div>' +
      '<button class="primary-btn" type="button" data-cert-tag-add>新增认证徽章</button></div>' +
      (state.error ? '<div class="admin-sync-note" style="color:#c00">' + esc(state.error) + "</div>" : "") +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      (state.formOpen && state.editing && !(window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen())
        ? '<div class="panel" style="margin:12px 0">' + formHtml(state.editing) + "</div>"
        : "") +
      rangeToolbarHtml() +
      (state.statsError ? '<div class="admin-sync-note" style="color:#c00">' + esc(state.statsError) + "</div>" : "") +
      (s
        ? kpiGridHtml(s.kpis, kpiCard("勋章陪玩（去重）", String((s.kpis && s.kpis.holders) || 0), (s.kpis && s.kpis.badges) + " 个勋章")) +
          '<p class="admin-sync-note" style="margin:0 0 6px;font-size:12px">' +
          esc(s.note || "") +
          "</p>" +
          badgeCardsHtml()
        : '<div class="content-loading">正在统计...</div>') +
      exportToolbarHtml("") +
      '<h4 style="margin:16px 0 8px">勋章设置（前台卡片）</h4>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>前台预览</th><th>图标</th><th>颜色</th><th>排序</th><th>统一陪玩分成</th><th>佣金优先级</th><th>展示</th><th>操作</th></tr></thead><tbody>' +
      rowsHtml() +
      "</tbody></table></div>"
    );
  }

  function memberStatus(row) {
    var cls = row.status === "active" ? "ok" : row.status === "pending_removal" ? "wait" : "bad";
    return '<span class="status ' + cls + '">' + esc(row.statusLabel || row.status) + "</span>";
  }

  function membersTableHtml(d) {
    var rows = d.members || [];
    if (!rows.length) return '<div class="empty">暂无成员。可在上方输入 PW 编号授予。</div>';
    return (
      '<div class="table-wrap"><table class="data-table" style="min-width:980px"><thead><tr><th>PW 编号</th><th>昵称</th><th>状态</th><th>授予时间 / 授予人</th><th class="amount">完成单量</th><th class="amount">订单总额</th><th class="amount">陪玩收入</th><th class="amount">平台佣金</th><th>取消记录</th><th>操作</th></tr></thead><tbody>' +
      rows
        .map(function (r) {
          var removal = "";
          if (r.removalRequestedAt) {
            removal =
              "申请：" +
              dt(r.removalRequestedAt) +
              " " +
              esc(r.removalRequestedByName || "") +
              "<br>原因：" +
              esc(r.removalReason || "-") +
              (r.removalApprovedAt ? "<br>批准：" + dt(r.removalApprovedAt) + " " + esc(r.removalApprovedByName || "") : "");
          }
          var ops = "";
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
          return (
            "<tr><td>" +
            esc(r.pwCode || "-") +
            "</td><td>" +
            esc(r.nickname || "-") +
            "</td><td>" +
            memberStatus(r) +
            "</td><td>" +
            dt(r.joinedAt) +
            "<br><small>" +
            esc(r.grantedByName || "-") +
            '</small></td><td class="amount">' +
            esc(r.completedCount) +
            '</td><td class="amount">' +
            money(r.gross) +
            '</td><td class="amount">' +
            money(r.companionIncome) +
            '</td><td class="amount">' +
            money(r.platformCommission) +
            '</td><td style="font-size:12px">' +
            (removal || "-") +
            '</td><td class="actions-cell">' +
            (ops || "-") +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>"
    );
  }

  function ordersTableHtml(d) {
    var rows = d.orders || [];
    if (!rows.length) return '<div class="empty">该时间范围内暂无归属此勋章的已结算订单。</div>';
    return (
      '<div class="table-wrap"><table class="data-table" style="min-width:1100px"><thead><tr><th>订单号</th><th>完成时间</th><th>老板</th><th>陪玩</th><th class="amount">订单金额</th><th class="amount">实际结算</th><th class="amount">陪玩收入</th><th class="amount">平台佣金</th><th class="amount">退款</th><th>结算分成</th><th>状态</th></tr></thead><tbody>' +
      rows
        .map(function (r) {
          return (
            "<tr><td>" +
            esc(r.orderNo || r.orderId) +
            "</td><td>" +
            dt(r.completedAt) +
            "</td><td>" +
            esc(r.bossName || "-") +
            (r.bossCode ? "<br><small>" + esc(r.bossCode) + "</small>" : "") +
            "</td><td>" +
            esc(r.pwCode || "-") +
            "<br><small>" +
            esc(r.nickname || "") +
            '</small></td><td class="amount">' +
            money(r.gross) +
            '</td><td class="amount">' +
            money(r.actualSettled) +
            '</td><td class="amount">' +
            money(r.companionIncome) +
            '</td><td class="amount">' +
            money(r.platformCommission) +
            '</td><td class="amount">' +
            money(r.refund) +
            "</td><td>" +
            esc(pct(r.companionShareRate)) +
            (r.commissionBadgeName ? "<br><small>按「" + esc(r.commissionBadgeName) + "」</small>" : "<br><small>默认规则</small>") +
            '</td><td><span class="status ' +
            (r.effective ? (r.refund > 0 ? "wait" : "ok") : "bad") +
            '">' +
            esc(r.statusLabel || r.status) +
            "</span></td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>"
    );
  }

  function monthlyTableHtml(d) {
    var rows = d.monthly || [];
    if (!rows.length) return '<div class="empty">暂无月度数据。</div>';
    return (
      '<div class="table-wrap"><table class="data-table" style="min-width:760px"><thead><tr><th>月份</th><th class="amount">完成单量</th><th class="amount">订单总金额</th><th class="amount">实际结算</th><th class="amount">陪玩收入</th><th class="amount">平台佣金</th><th class="amount">退款</th></tr></thead><tbody>' +
      rows
        .map(function (r) {
          return (
            "<tr><td>" +
            esc(r.month) +
            '</td><td class="amount">' +
            esc(r.completedCount) +
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

  function detailPageHtml() {
    var d = state.detail;
    var b = (d && d.badge) || state.tags.find(function (t) {
      return String(t.id) === String(state.detailId);
    }) || {};
    var tabs = [
      ["members", "成员"],
      ["orders", "订单"],
      ["monthly", "月度汇总"],
      ["log", "佣金变更记录"],
    ];
    var body = "";
    if (state.detailError) body = '<div class="admin-sync-note" style="color:#c00">' + esc(state.detailError) + "</div>";
    else if (!d || state.detailLoading) body = '<div class="content-loading">正在读取勋章详情...</div>';
    else {
      body =
        kpiGridHtml(d.kpis) +
        '<p class="admin-sync-note" style="margin:0 0 8px;font-size:12px">本月：' +
        esc((d.month && d.month.completedCount) || 0) +
        " 单 · 营业额 " +
        money(d.month && d.month.actualSettled) +
        " · 平台利润 " +
        money(d.month && d.month.platformCommission) +
        "</p>" +
        '<div class="tabs">' +
        tabs
          .map(function (t) {
            return '<button type="button" data-cert-detail-tab="' + t[0] + '" class="' + (state.detailTab === t[0] ? "active" : "") + '">' + t[1] + "</button>";
          })
          .join("") +
        "</div>" +
        (state.detailTab === "orders"
          ? ordersTableHtml(d)
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
      '<form class="toolbar" style="margin:0 0 8px" data-cert-commission-form>' +
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
      '<form class="toolbar" style="margin:0" data-cert-grant-form>' +
      "<span>授予勋章</span>" +
      '<input name="companionRef" placeholder="陪玩 PW 编号，如 PW00076" style="width:220px">' +
      '<button class="mini-btn" type="submit">授予</button>' +
      "</form></div>" +
      rangeToolbarHtml() +
      body +
      exportToolbarHtml(state.detailId)
    );
  }

  function pageHtml() {
    if (state.loading) return '<div class="content-loading">正在读取认证徽章...</div>';
    return state.view === "detail" ? detailPageHtml() : listPageHtml();
  }

  function render() {
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
  }

  function loadStats() {
    state.statsError = "";
    return apiGet("action=stats&" + rangeQuery())
      .then(function (body) {
        state.stats = body;
        render();
      })
      .catch(function (err) {
        state.statsError = err.message || "统计读取失败";
        render();
      });
  }

  function loadDetail() {
    if (!state.detailId) return Promise.resolve();
    state.detailLoading = true;
    state.detailError = "";
    render();
    return apiGet("action=detail&id=" + encodeURIComponent(state.detailId) + "&" + rangeQuery())
      .then(function (body) {
        state.detail = body;
        state.detailLoading = false;
        render();
      })
      .catch(function (err) {
        state.detailLoading = false;
        state.detailError = err.message || "详情读取失败";
        render();
      });
  }

  function refreshCurrent() {
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
        refreshCurrent();
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
    if (!t.getAttribute("data-cert-live")) return;
    var form = t.closest("[data-cert-tag-form]");
    if (form) syncLivePreview(form);
  });

  document.addEventListener("click", function (e) {
    if (!e.target || !e.target.closest) return;
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
    var detailBtn = e.target.closest("[data-cert-detail]");
    if (detailBtn && !e.target.closest("[data-cert-tag-edit],[data-cert-tag-toggle],[data-cert-tag-delete]")) {
      state.view = "detail";
      state.detailId = detailBtn.getAttribute("data-cert-detail");
      state.detail = null;
      state.detailTab = "members";
      state.message = "";
      loadDetail();
      return;
    }
    if (e.target.closest("[data-cert-back]")) {
      state.view = "list";
      state.detail = null;
      state.message = "";
      render();
      loadStats();
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
      if (!confirm("确认删除该认证徽章？已有授予记录或订单归属的勋章不能删除，请改为停用。")) return;
      apiPost({ action: "delete", id: del.getAttribute("data-cert-tag-delete") })
        .then(afterMutation)
        .catch(function (err) {
          alert(err.message || "删除失败");
        });
    }
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
    if (section === "companion-cert-tags") load();
  });

  function boot() {
    if (!target()) return;
    load();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.MCJAdminCompanionCertTags = { reload: load, render: render };
})();
