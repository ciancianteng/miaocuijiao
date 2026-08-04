(function () {
  "use strict";
  var APPLY_RULE_SLUG = "apply-step1";
  var APPLY_RULE_ID = "pc-player-rules-default";
  var state = {
    tab: "levels",
    loading: false,
    message: "",
    error: "",
    guide: { title: "俱乐部等级说明", intro: "" },
    editingGuide: false,
    playerRules: [],
    editingPlayerRule: null,
    workRules: [],
    editingRule: null,
    records: [],
    recordFilter: "",
    forcedOnly: true,
    editingForced: null,
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
  function platformContentGet(type) {
    var Auth = window.MCJAdminAuthFetch;
    var fetchFn = Auth ? Auth.fetch : fetch;
    var headers = Auth
      ? Auth.getAuthHeaders({ Accept: "application/json", "x-mcj-admin-role": adminRole() })
      : { Accept: "application/json", "x-mcj-admin-role": adminRole() };
    return fetchFn("/api/admin/platform-content?type=" + encodeURIComponent(type), { method: "GET", headers: headers }).then(parse);
  }
  function platformContentSave(action, type, id, payload) {
    var Auth = window.MCJAdminAuthFetch;
    var fetchFn = Auth ? Auth.fetch : fetch;
    var headers = Auth
      ? Auth.getAuthHeaders({ "Content-Type": "application/json", "x-mcj-admin-role": adminRole() })
      : { "Content-Type": "application/json", "x-mcj-admin-role": adminRole() };
    return fetchFn("/api/admin/platform-content", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ action: action, type: type, id: id || "", payload: payload || {} }),
    }).then(parse);
  }
  function mapPlayerRuleItem(item) {
    item = item || {};
    var d = Object.assign({}, item.published || {}, item.draft || {}, item);
    return {
      id: item.id || "",
      slug: item.slug || d.slug || "",
      title: d.title || item.title || "陪玩规则",
      subtitle: d.subtitle || "",
      body: d.body || d.content || "",
      versionNote: d.versionNote || d.version || String(item.version || "1"),
      notes: d.notes || "",
      penaltyRules: d.penaltyRules || "",
      depositRules: d.depositRules || "",
      sort: Number(d.sort != null ? d.sort : item.sort != null ? item.sort : 100),
      status: item.status || "published",
      enabled: item.enabled !== false,
      forceConfirm: d.forceConfirm === true || d.requiresAck === true,
      updatedAt: item.updated_at || item.published_at || "",
      version: item.version || d.version || "1",
    };
  }
  function isApplyPlayerRule(row) {
    if (!row) return false;
    var id = String(row.id || "");
    var slug = String(row.slug || "").toLowerCase();
    if (id === APPLY_RULE_ID || slug === APPLY_RULE_SLUG || slug === "apply" || /apply|申请/.test(slug)) return true;
    if (/申请|陪玩制度|陪玩规则/.test(String(row.title || "")) && !/俱乐部等级|平台使用/.test(String(row.title || ""))) return true;
    return false;
  }
  function pickPrimaryPlayerRule(rows) {
    rows = Array.isArray(rows) ? rows.slice() : [];
    var apply = rows.find(isApplyPlayerRule);
    if (apply) return apply;
    var nonBoss = rows.find(function (r) {
      return !r.forceConfirm && !/俱乐部等级|平台使用/.test(String(r.title || ""));
    });
    if (nonBoss) return nonBoss;
    return rows.sort(function (a, b) {
      return Number(b.sort || 0) - Number(a.sort || 0);
    })[0] || null;
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

  function truncateText(v, n) {
    var s = String(v == null ? "" : v).trim();
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  function guideFormHtml() {
    return (
      '<form class="service-account-form" data-rules-guide-form>' +
      '<div class="form-grid">' +
      '<label>页面标题<input name="title" required value="' +
      esc(state.guide.title || "") +
      '"></label>' +
      '<label class="wide">简短介绍<textarea name="intro" rows="3">' +
      esc(state.guide.intro || "") +
      "</textarea></label>" +
      "</div>" +
      '<div class="row" style="margin-top:10px"><button class="primary-btn" type="submit">保存页面文案</button></div>' +
      "</form>"
    );
  }

  function openGuideOverlay() {
    if (!state.editingGuide) return false;
    if (window.MCJAdminOverlay) {
      window.MCJAdminOverlay.open({
        title: "编辑页面文案",
        html: guideFormHtml(),
        onClose: function () {
          state.editingGuide = false;
        },
      });
      return true;
    }
    return false;
  }

  function closeGuideOverlay() {
    if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
      window.MCJAdminOverlay.close();
      return;
    }
    state.editingGuide = false;
    render();
  }

  function levelsTab() {
    var useInlineForm = state.editingGuide && !window.MCJAdminOverlay;
    return (
      '<div data-rules-hub-panel="levels">' +
      (useInlineForm
        ? '<div class="service-account-form-head" style="margin-bottom:10px"><div><h3>页面文案</h3></div><button class="mini-btn" type="button" data-rules-guide-cancel>关闭</button></div>' +
          guideFormHtml()
        : '<div class="service-account-form" style="margin-bottom:16px"><div class="service-account-form-head"><div><h3>页面文案</h3><p>' +
          esc(truncateText(state.guide.title || "未设置标题", 24)) +
          (state.guide.intro ? " · " + esc(truncateText(state.guide.intro, 40)) : "") +
          '</p></div><button class="mini-btn" type="button" data-rules-guide-edit>编辑页面文案</button></div></div>') +
      '<p class="admin-sync-note">下方为全站等级配置中心：价格、徽章、边框、抽成、升级条件统一写入 companion_levels。保存当前等级仅写单条；「发布到全站」后四端即时读取同一份配置。</p>' +
      '<div id="companionLevelSettingsHub"></div>' +
      "</div>"
    );
  }

  function playerRuleFormHtml(edit) {
    edit = edit || {};
    return (
      '<form class="service-account-form" data-player-rule-form data-edit-id="' +
      esc(edit.id || "") +
      '"><div class="form-grid">' +
      '<label>标题<input name="title" required value="' +
      esc(edit.title || "陪玩规则") +
      '"></label>' +
      '<label>副标题<input name="subtitle" value="' +
      esc(edit.subtitle || "") +
      '"></label>' +
      '<label>排序<input name="sort" type="number" value="' +
      esc(edit.sort != null ? edit.sort : 100) +
      '"></label>' +
      '<label>版本说明<input name="versionNote" value="' +
      esc(edit.versionNote || edit.version || "1") +
      '"></label>' +
      '<label>是否启用<select name="enabled"><option value="true"' +
      (edit.enabled !== false ? " selected" : "") +
      '>启用</option><option value="false"' +
      (edit.enabled === false ? " selected" : "") +
      ">停用</option></select></label>" +
      '<label class="wide">正文（申请第 1 步全文）<textarea name="body" rows="12" required>' +
      esc(edit.body || "") +
      "</textarea></label>" +
      '<label class="wide">注意事项<textarea name="notes" rows="3">' +
      esc(edit.notes || "") +
      "</textarea></label>" +
      '<label class="wide">处罚规则<textarea name="penaltyRules" rows="3">' +
      esc(edit.penaltyRules || "") +
      "</textarea></label>" +
      '<label class="wide">退款与押金规则<textarea name="depositRules" rows="3">' +
      esc(edit.depositRules || "") +
      "</textarea></label></div>" +
      '<div class="row"><button class="primary-btn" type="submit">保存并同步申请页</button><button class="ghost-btn" type="button" data-player-rule-cancel>取消</button></div></form>'
    );
  }

  function openPlayerRuleOverlay() {
    if (!state.editingPlayerRule) return false;
    if (window.MCJAdminOverlay) {
      window.MCJAdminOverlay.open({
        title: state.editingPlayerRule.id ? "编辑陪玩规则" : "新建陪玩规则",
        html: playerRuleFormHtml(state.editingPlayerRule),
        onClose: function () {
          state.editingPlayerRule = null;
        },
      });
      return true;
    }
    return false;
  }

  function closePlayerRuleOverlay() {
    if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
      window.MCJAdminOverlay.close();
      return;
    }
    state.editingPlayerRule = null;
    render();
  }

  function workRuleFormHtml(edit) {
    edit = edit || {};
    return (
      '<form class="service-account-form" data-work-rule-form data-edit-id="' +
      esc(edit.id || "") +
      '"><div class="form-grid">' +
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
      '<div class="row"><button class="primary-btn" type="submit">保存分类规则</button><button class="ghost-btn" type="button" data-work-rule-cancel>取消</button></div></form>'
    );
  }

  function workRuleTitle(edit) {
    return edit && edit.id ? "编辑分类规则" : "新建分类规则";
  }

  function openWorkRuleOverlay() {
    if (!state.editingRule) return false;
    if (window.MCJAdminOverlay) {
      window.MCJAdminOverlay.open({
        title: workRuleTitle(state.editingRule),
        html: workRuleFormHtml(state.editingRule),
        onClose: function () {
          state.editingRule = null;
        },
      });
      return true;
    }
    return false;
  }

  function closeWorkRuleOverlay() {
    if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
      window.MCJAdminOverlay.close();
      return;
    }
    state.editingRule = null;
    render();
  }

  function rulesTab() {
    var rows = state.playerRules || [];
    var edit = state.editingPlayerRule;
    var useInlineForm = edit && !window.MCJAdminOverlay;
    var primary = pickPrimaryPlayerRule(rows);
    var workRows = state.workRules || [];
    var workEdit = state.editingRule;
    var useWorkInline = workEdit && !window.MCJAdminOverlay;
    return (
      '<div data-rules-hub-panel="rules">' +
      '<p class="admin-sync-note">本页「陪玩规则」写入独立库 <code>player_rules</code>，与「俱乐部等级说明」「强制公告」完全分开。陪玩申请第 1 步只读此处正文，保存后刷新申请页立即同步。</p>' +
      (primary
        ? '<div class="service-account-form" style="margin-bottom:14px"><div class="service-account-form-head"><div><h3>当前申请页正文</h3><p>' +
          esc(truncateText(primary.title || "未命名", 32)) +
          (primary.updatedAt ? " · 更新 " + esc(primary.updatedAt) : "") +
          '</p></div><button class="mini-btn primary-lite" type="button" data-player-rule-edit="' +
          esc(primary.id) +
          '">编辑申请页规则</button></div><pre style="white-space:pre-wrap;max-height:160px;overflow:auto;margin:0;padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.22);color:rgba(255,255,255,.82);font:inherit">' +
          esc(truncateText(primary.body || "（正文为空）", 480)) +
          "</pre></div>"
        : '<div class="admin-sync-note" style="margin-bottom:12px">尚未发布陪玩规则。请新建并保存，申请第 1 步才会显示正文。</div>') +
      (useInlineForm
        ? '<div class="service-account-form-head" style="margin-bottom:10px"><div><h3>' +
          (edit.id ? "编辑陪玩规则" : "新建陪玩规则") +
          '</h3></div><button class="mini-btn" type="button" data-player-rule-cancel>关闭</button></div>' +
          playerRuleFormHtml(edit)
        : '<div class="row" style="margin-bottom:10px"><button class="primary-btn" type="button" data-player-rule-new>新建陪玩规则</button><button class="mini-btn" type="button" data-player-rule-reload>刷新</button></div>') +
      '<div class="table-wrap service-account-table-wrap"><table class="service-account-table"><thead><tr><th>排序</th><th>标题</th><th>版本</th><th>启用</th><th>申请页</th><th>更新时间</th><th>操作</th></tr></thead><tbody>' +
      (rows.length
        ? rows
            .map(function (r) {
              var isApply = primary && String(primary.id) === String(r.id);
              return (
                "<tr><td>" +
                esc(r.sort) +
                "</td><td>" +
                esc(r.title) +
                "</td><td>" +
                esc(r.versionNote || r.version) +
                "</td><td>" +
                esc(r.enabled ? "是" : "否") +
                "</td><td>" +
                esc(isApply ? "是" : "-") +
                "</td><td>" +
                esc(r.updatedAt || "-") +
                '</td><td><button class="mini-btn" type="button" data-player-rule-edit="' +
                esc(r.id) +
                '">编辑</button></td></tr>'
              );
            })
            .join("")
        : '<tr><td colspan="7"><div class="empty">暂无陪玩规则，请新建</div></td></tr>') +
      "</tbody></table></div>" +
      '<header class="service-account-head" style="margin-top:22px"><div><h3>陪玩端工作台分类规则</h3><p>独立库 <code>companion_work_rules</code>，仅陪玩端「陪玩规则」页读取，不影响申请第 1 步。</p></div></header>' +
      (useWorkInline
        ? workRuleFormHtml(workEdit)
        : '<div class="row" style="margin-bottom:10px"><button class="primary-btn" type="button" data-work-rule-new>新建分类</button><button class="mini-btn" type="button" data-work-rule-reload>刷新分类</button></div>') +
      '<div class="table-wrap service-account-table-wrap"><table class="service-account-table"><thead><tr><th>排序</th><th>分类</th><th>版本</th><th>启用</th><th>强制确认</th><th>更新时间</th><th>操作</th></tr></thead><tbody>' +
      (workRows.length
        ? workRows
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
        : '<tr><td colspan="7"><div class="empty">暂无分类规则</div></td></tr>') +
      "</tbody></table></div>" +
      "</div>"
    );
  }

  function forcedFormHtml(edit) {
    edit = edit || {};
    return (
      '<form class="admin-final-form" data-forced-announcement-form>' +
      '<input type="hidden" name="id" value="' +
      esc(edit.id || "") +
      '">' +
      '<input type="hidden" name="kind" value="forced">' +
      '<label>发布对象<select name="audience">' +
      '<option value="companion"' +
      (!edit.audience || edit.audience === "companion" ? " selected" : "") +
      ">陪玩端</option>" +
      '<option value="all"' +
      (edit.audience === "all" ? " selected" : "") +
      ">全平台</option>" +
      '<option value="home"' +
      (edit.audience === "home" ? " selected" : "") +
      ">首页</option>" +
      '<option value="boss"' +
      (edit.audience === "boss" ? " selected" : "") +
      ">老板端</option>" +
      '<option value="customer_service"' +
      (edit.audience === "customer_service" ? " selected" : "") +
      ">客服端</option>" +
      "</select></label>" +
      '<label>公告分类<select name="category">' +
      '<option value="companion"' +
      (!edit.category || edit.category === "companion" ? " selected" : "") +
      ">陪玩公告</option>" +
      '<option value="home"' +
      (edit.category === "home" ? " selected" : "") +
      ">首页公告</option>" +
      "</select></label>" +
      '<label>标题<input name="title" required placeholder="强制公告标题" value="' +
      esc(edit.title || "") +
      '"></label>' +
      '<label>排序<input name="sort_order" type="number" value="' +
      esc(edit.sort_order != null ? edit.sort_order : 10) +
      '"></label>' +
      '<label>开始时间<input name="start_at" type="datetime-local" value="' +
      esc(toLocal(edit.start_at)) +
      '"></label>' +
      '<label>结束时间<input name="end_at" type="datetime-local" value="' +
      esc(toLocal(edit.end_at)) +
      '"></label>' +
      '<label>启用<select name="is_active"><option value="true"' +
      (edit.is_active !== false ? " selected" : "") +
      ">启用</option><option value=\"false\"" +
      (edit.is_active === false ? " selected" : "") +
      ">停用</option></select></label>" +
      '<label class="wide">正文<textarea name="content" required rows="8" placeholder="强制公告正文">' +
      esc(edit.content || "") +
      "</textarea></label>" +
      '<button class="primary-btn" type="submit">' +
      (edit.id ? "保存公告" : "发布强制公告") +
      "</button>" +
      '<button class="mini-btn" type="button" data-forced-reset>清空</button>' +
      "</form>"
    );
  }

  function forcedTitle(edit) {
    return edit && edit.id ? "编辑强制公告" : "发布强制公告";
  }

  function openForcedOverlay() {
    if (!state.editingForced) return false;
    if (window.MCJAdminOverlay) {
      window.MCJAdminOverlay.open({
        title: forcedTitle(state.editingForced),
        html: forcedFormHtml(state.editingForced),
        onClose: function () {
          state.editingForced = null;
        },
      });
      return true;
    }
    return false;
  }

  function closeForcedOverlay() {
    if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
      window.MCJAdminOverlay.close();
      return;
    }
    state.editingForced = null;
    render();
  }

  function forcedTab() {
    var edit = state.editingForced;
    var useInlineForm = edit && !window.MCJAdminOverlay;
    return (
      '<div data-rules-hub-panel="forced">' +
      '<p class="admin-sync-note">强制阅读公告：陪玩未确认前不能切换在线、抢单、接单、开始订单。修改正文会自动升版本并要求重新确认。</p>' +
      (useInlineForm
        ? '<div class="service-account-form-head" style="margin-bottom:10px"><div><h3>' +
          esc(forcedTitle(edit)) +
          '</h3></div><button class="mini-btn" type="button" data-forced-cancel>关闭</button></div>' +
          forcedFormHtml(edit)
        : '<div class="row" style="margin-bottom:10px"><button class="primary-btn" type="button" data-forced-new>发布强制公告</button></div>') +
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
    if (state.tab === "forced") loadForcedList();
  }

  function loadPlayerRules() {
    return platformContentGet("player_rules")
      .then(function (res) {
        state.playerRules = (res.items || []).map(mapPlayerRuleItem);
        return state.playerRules;
      })
      .catch(function (err) {
        state.error = err.message || "陪玩规则加载失败";
        return [];
      });
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
    Promise.all([
      api("bootstrap", {}, "GET"),
      platformContentGet("player_rules").catch(function () {
        return { items: [] };
      }),
    ])
      .then(function (pair) {
        var res = pair[0] || {};
        state.guide = res.guide || state.guide;
        state.workRules = res.workRules || [];
        state.playerRules = ((pair[1] && pair[1].items) || []).map(mapPlayerRuleItem);
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
        loadPlayerRules().then(function () {
          render();
        });
        api("work_rules", {}, "GET")
          .then(function (res) {
            state.workRules = res.rules || [];
            render();
          })
          .catch(function () {});
      }
      return;
    }
    if (e.target.closest("[data-rules-guide-edit]")) {
      state.editingGuide = true;
      if (!openGuideOverlay()) render();
      return;
    }
    if (e.target.closest("[data-rules-guide-cancel]")) {
      closeGuideOverlay();
      return;
    }
    if (e.target.closest("[data-player-rule-new]")) {
      var seed = pickPrimaryPlayerRule(state.playerRules) || {};
      state.editingPlayerRule = {
        id: "",
        title: "陪玩规则",
        subtitle: "申请成为陪玩前必读",
        body: "",
        sort: 100,
        enabled: true,
        versionNote: "1",
        notes: "",
        penaltyRules: "",
        depositRules: "",
      };
      if (!state.playerRules.length && seed.body) state.editingPlayerRule.body = seed.body;
      if (!openPlayerRuleOverlay()) render();
      return;
    }
    if (e.target.closest("[data-player-rule-cancel]")) {
      closePlayerRuleOverlay();
      return;
    }
    var ped = e.target.closest("[data-player-rule-edit]");
    if (ped) {
      state.editingPlayerRule =
        (state.playerRules || []).find(function (r) {
          return String(r.id) === String(ped.getAttribute("data-player-rule-edit"));
        }) || null;
      if (state.editingPlayerRule && !openPlayerRuleOverlay()) render();
      return;
    }
    if (e.target.closest("[data-player-rule-reload]")) {
      loadPlayerRules().then(function () {
        state.message = "陪玩规则已刷新";
        render();
      });
      return;
    }
    if (e.target.closest("[data-work-rule-new]")) {
      state.editingRule = { title: "", body: "", sort: 100, enabled: true, forceConfirm: false, version: "1" };
      if (!openWorkRuleOverlay()) render();
      return;
    }
    if (e.target.closest("[data-work-rule-cancel]")) {
      closeWorkRuleOverlay();
      return;
    }
    var edit = e.target.closest("[data-work-rule-edit]");
    if (edit) {
      state.editingRule = (state.workRules || []).find(function (r) {
        return String(r.id) === String(edit.getAttribute("data-work-rule-edit"));
      }) || null;
      if (state.editingRule && !openWorkRuleOverlay()) render();
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
    if (e.target.closest("[data-forced-new]")) {
      state.editingForced = {};
      if (!openForcedOverlay()) render();
      return;
    }
    if (e.target.closest("[data-forced-cancel]")) {
      closeForcedOverlay();
      return;
    }
    if (e.target.closest("[data-forced-reset]")) {
      var f = e.target.closest("form");
      if (f) f.reset();
      return;
    }
    var fed = e.target.closest("[data-forced-edit]");
    if (fed) {
      try {
        var a = JSON.parse(fed.getAttribute("data-forced-edit"));
        state.editingForced = a || {};
        if (!openForcedOverlay()) render();
      } catch (err) {}
      return;
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
          if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
            window.MCJAdminOverlay.close();
          } else {
            state.editingGuide = false;
          }
          render();
        })
        .catch(function (err) {
          state.error = err.message;
          render();
        });
      return;
    }
    if (e.target.matches("[data-player-rule-form]")) {
      e.preventDefault();
      var pfd = new FormData(e.target);
      var editId = String(e.target.getAttribute("data-edit-id") || "").trim();
      var primary = pickPrimaryPlayerRule(state.playerRules);
      var draft = {
        title: String(pfd.get("title") || "").trim() || "陪玩规则",
        subtitle: String(pfd.get("subtitle") || "").trim(),
        body: String(pfd.get("body") || "").trim(),
        content: String(pfd.get("body") || "").trim(),
        versionNote: String(pfd.get("versionNote") || "1").trim() || "1",
        version: String(pfd.get("versionNote") || "1").trim() || "1",
        notes: String(pfd.get("notes") || "").trim(),
        penaltyRules: String(pfd.get("penaltyRules") || "").trim(),
        depositRules: String(pfd.get("depositRules") || "").trim(),
        sort: Number(pfd.get("sort") || 100),
        forceConfirm: false,
        requiresAck: false,
      };
      var enabled = pfd.get("enabled") !== "false";
      var payload = {
        type: "player_rules",
        title: draft.title,
        slug: APPLY_RULE_SLUG,
        status: "published",
        enabled: enabled,
        sort: draft.sort,
        draft: draft,
        published: draft,
      };
      var savePromise;
      if (editId) {
        savePromise = platformContentSave("save", "player_rules", editId, payload);
      } else if (primary && primary.id) {
        payload.slug = primary.slug || APPLY_RULE_SLUG;
        savePromise = platformContentSave("save", "player_rules", primary.id, payload);
      } else {
        payload.id = APPLY_RULE_ID;
        savePromise = platformContentSave("create", "player_rules", "", payload);
      }
      savePromise
        .then(function (res) {
          state.message = res.message || "陪玩规则已保存，申请页刷新即可同步";
          if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
            window.MCJAdminOverlay.close();
          } else {
            state.editingPlayerRule = null;
          }
          return loadPlayerRules();
        })
        .then(function () {
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
          if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
            window.MCJAdminOverlay.close();
          } else {
            state.editingRule = null;
          }
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
          if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
            window.MCJAdminOverlay.close();
          } else {
            state.editingForced = null;
          }
          render();
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
