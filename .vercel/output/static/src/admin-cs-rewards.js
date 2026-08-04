(function () {
  "use strict";
  var state = {
    loaded: false,
    loading: false,
    saving: false,
    error: "",
    message: "",
    settings: null,
    records: [],
    filterStatus: "",
    filterServiceId: "",
    filterName: "",
    expandedServiceIds: {},
    commissionConfig: null,
    commissionLoading: false,
    commissionSaving: false,
    commissionError: "",
    commissionMessage: "",
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
      return user.adminRole || user.role || localStorage.getItem("mcjRole") || sessionStorage.getItem("mcjRole") || "admin";
    } catch (e) {
      return localStorage.getItem("mcjRole") || sessionStorage.getItem("mcjRole") || "admin";
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
      if (!res.ok || body.ok === false) throw new Error(body.message || "请求失败：HTTP " + res.status);
      return body;
    });
  }

  function api(action, body, method) {
    var Auth = window.MCJAdminAuthFetch;
    var opts = {
      method: method || "POST",
      headers: Auth
        ? Auth.getAuthHeaders({ "Content-Type": "application/json", "x-mcj-admin-role": adminRole() })
        : {
            "Content-Type": "application/json",
            "x-mcj-admin-role": adminRole(),
            Accept: "application/json",
          },
    };
    var fetchFn = Auth ? Auth.fetch : fetch;
    var q = "/api/admin/cs-rewards?action=" + encodeURIComponent(action || "settings");
    if (opts.method === "GET") {
      if (state.filterStatus) q += "&status=" + encodeURIComponent(state.filterStatus);
      if (state.filterServiceId) q += "&service_id=" + encodeURIComponent(state.filterServiceId);
      return fetchFn(q, opts).then(parse);
    }
    opts.body = JSON.stringify(Object.assign({ action: action }, body || {}));
    return fetchFn("/api/admin/cs-rewards", opts).then(parse);
  }

  function fmtTime(v) {
    if (!v) return "-";
    try {
      return new Date(v).toLocaleString("zh-CN", { hour12: false });
    } catch (e) {
      return String(v);
    }
  }

  function fmtNum(v, digits) {
    var n = Number(v);
    if (!Number.isFinite(n)) return "0";
    var d = digits == null ? 2 : digits;
    return n.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: d });
  }

  function recordTime(r) {
    return r && (r.settledAt || r.createdAt || "");
  }

  function inSameDay(iso, now) {
    if (!iso) return false;
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return false;
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }

  function inSameMonth(iso, now) {
    if (!iso) return false;
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return false;
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }

  function rewardRmForRecord(r, cfg) {
    if (r && r.finalAmountRm != null && Number.isFinite(Number(r.finalAmountRm))) {
      return Number(r.finalAmountRm);
    }
    cfg = cfg || state.commissionConfig || {};
    var reception = Number(cfg.receptionBonus || 0);
    var fixed = Number(cfg.orderCommission || 0);
    var pct = Number(cfg.commissionPercent || 0);
    var orderAmt = Number(r && r.orderAmount != null ? r.orderAmount : 0);
    return reception + fixed + (orderAmt * pct) / 100;
  }

  function isPayStatus(status) {
    return status === "pending" || status === "settled";
  }

  function aggregateByService(records) {
    var map = {};
    (records || []).forEach(function (r) {
      var sid = r.serviceId || "_unknown";
      if (!map[sid]) {
        map[sid] = {
          serviceId: sid,
          serviceName: r.serviceName || "-",
          orderCount: 0,
          successCount: 0,
          pendingCount: 0,
          settledCount: 0,
          cancelledCount: 0,
          clawedCount: 0,
          catFood: 0,
          catFoodPending: 0,
          catFoodSettled: 0,
          rewardRm: 0,
          rewardRmPending: 0,
          rewardRmSettled: 0,
          records: [],
        };
      }
      var g = map[sid];
      g.records.push(r);
      g.orderCount += 1;
      if (r.serviceName && r.serviceName !== "-") g.serviceName = r.serviceName;
      var amt = Number(r.amount || 0);
      var rm = rewardRmForRecord(r);
      if (r.status === "settled") {
        g.successCount += 1;
        g.settledCount += 1;
        g.catFood += amt;
        g.catFoodSettled += amt;
        g.rewardRm += rm;
        g.rewardRmSettled += rm;
      } else if (r.status === "pending") {
        g.pendingCount += 1;
        g.catFood += amt;
        g.catFoodPending += amt;
        g.rewardRm += rm;
        g.rewardRmPending += rm;
      } else if (r.status === "clawed_back") {
        g.clawedCount += 1;
      } else if (r.status === "cancelled") {
        g.cancelledCount += 1;
      }
    });
    return Object.keys(map)
      .map(function (k) {
        return map[k];
      })
      .sort(function (a, b) {
        return b.rewardRm - a.rewardRm || b.catFood - a.catFood || String(a.serviceName).localeCompare(String(b.serviceName), "zh");
      });
  }

  function groupSettleStatus(g) {
    if (g.pendingCount > 0 && g.settledCount > 0) return "部分待发";
    if (g.pendingCount > 0) return "待发放";
    if (g.settledCount > 0 && g.clawedCount > 0) return "已发放(含扣回)";
    if (g.settledCount > 0) return "已发放";
    if (g.clawedCount > 0) return "已扣回";
    if (g.cancelledCount > 0) return "已取消";
    return "-";
  }

  function computeSummary(records) {
    var now = new Date();
    var monthCat = 0;
    var monthRm = 0;
    var todayCat = 0;
    var todayRm = 0;
    var pendingCat = 0;
    var pendingRm = 0;
    var settledCat = 0;
    var settledRm = 0;
    (records || []).forEach(function (r) {
      if (!isPayStatus(r.status)) return;
      var amt = Number(r.amount || 0);
      var rm = rewardRmForRecord(r);
      var t = recordTime(r) || r.createdAt;
      if (r.status === "pending") {
        pendingCat += amt;
        pendingRm += rm;
      } else {
        settledCat += amt;
        settledRm += rm;
      }
      if (inSameMonth(t, now)) {
        monthCat += amt;
        monthRm += rm;
      }
      if (inSameDay(t, now)) {
        todayCat += amt;
        todayRm += rm;
      }
    });
    return { monthCat: monthCat, monthRm: monthRm, todayCat: todayCat, todayRm: todayRm, pendingCat: pendingCat, pendingRm: pendingRm, settledCat: settledCat, settledRm: settledRm };
  }

  function mount() {
    var box = document.getElementById("csDockRewardMount");
    if (box) return box;
    // Only render inside the open「客服账号」accordion body — do not inject a sibling that stretches the page.
    return null;
  }

  function commissionMount() {
    var box = document.getElementById("csCommissionMount");
    return box || null;
  }

  function commissionForm(c) {
    c = c || {};
    return (
      '<form class="service-account-form" data-cs-commission-form>' +
      '<div class="service-account-form-head"><div><h3>客服佣金设置</h3><p>全局平台默认，写入 platform_settings.data.csCommission（并同步 META 备份）。工资中心、订单结算、提现与奖励记录均实时读取此处；改数值保存后刷新即生效，无需改代码。</p></div></div>' +
      '<div class="form-grid">' +
      '<label>每次成功接待奖励 RM<input name="receptionBonus" type="number" min="0" step="0.01" value="' +
      esc(c.receptionBonus != null ? c.receptionBonus : 0) +
      '"></label>' +
      '<label>底薪 RM<input name="baseSalary" type="number" min="0" step="0.01" value="' +
      esc(c.baseSalary != null ? c.baseSalary : 0) +
      '"></label>' +
      '<label>全勤奖励 RM<input name="attendanceBonus" type="number" min="0" step="0.01" value="' +
      esc(c.attendanceBonus != null ? c.attendanceBonus : 0) +
      '"></label>' +
      '<label>夜班补贴 RM<input name="nightShiftAllowance" type="number" min="0" step="0.01" value="' +
      esc(c.nightShiftAllowance != null ? c.nightShiftAllowance : 0) +
      '"></label>' +
      '<label>其他调整 RM<input name="otherAdjustment" type="number" step="0.01" value="' +
      esc(c.otherAdjustment != null ? c.otherAdjustment : 0) +
      '"></label>' +
      '<label>每单固定奖励 RM<input name="orderCommission" type="number" min="0" step="0.01" value="' +
      esc(c.orderCommission != null ? c.orderCommission : 0) +
      '"></label>' +
      '<label>订单提成比例 %<input name="commissionPercent" type="number" min="0" max="100" step="0.01" value="' +
      esc(c.commissionPercent != null ? c.commissionPercent : 0) +
      '"></label>' +
      '<label>订单完成后结算<select name="settleOnOrderComplete"><option value="true"' +
      (c.settleOnOrderComplete !== false ? " selected" : "") +
      '>是</option><option value="false"' +
      (c.settleOnOrderComplete === false ? " selected" : "") +
      ">否</option></select></label>" +
      '<label>老板支付后结算<select name="settleOnPayment"><option value="true"' +
      (c.settleOnPayment ? " selected" : "") +
      '>是</option><option value="false"' +
      (!c.settleOnPayment ? " selected" : "") +
      ">否</option></select></label>" +
      '<label>退款后扣回提成<select name="clawbackOnRefund"><option value="true"' +
      (c.clawbackOnRefund !== false ? " selected" : "") +
      '>是</option><option value="false"' +
      (c.clawbackOnRefund === false ? " selected" : "") +
      ">否</option></select></label>" +
      '<label>迟到扣款 RM/次<input name="lateDeduction" type="number" min="0" step="0.01" value="' +
      esc(c.lateDeduction != null ? c.lateDeduction : 0) +
      '"></label>' +
      '<label>缺勤扣款 RM/次<input name="absenceDeduction" type="number" min="0" step="0.01" value="' +
      esc(c.absenceDeduction != null ? c.absenceDeduction : 0) +
      '"></label>' +
      '<label>早退扣款 RM/次<input name="earlyLeaveDeduction" type="number" min="0" step="0.01" value="' +
      esc(c.earlyLeaveDeduction != null ? c.earlyLeaveDeduction : 0) +
      '"></label>' +
      '<label>应出勤天数<input name="standardDays" type="number" min="1" step="1" value="' +
      esc(c.standardDays != null ? c.standardDays : 22) +
      '"></label>' +
      '<label>迟到宽限分钟<input name="graceMinutes" type="number" min="0" step="1" value="' +
      esc(c.graceMinutes != null ? c.graceMinutes : 10) +
      '"></label>' +
      "</div>" +
      '<div class="row" style="margin-top:12px"><button class="primary-btn" type="submit"' +
      (state.commissionSaving ? " disabled" : "") +
      ">" +
      (state.commissionSaving ? "保存中..." : "保存佣金设置") +
      '</button><button class="ghost-btn" type="button" data-cs-commission-reload>刷新</button></div>' +
      "</form>"
    );
  }

  function commissionApi(action, body, method) {
    var Auth = window.MCJAdminAuthFetch;
    var opts = {
      method: method || "POST",
      headers: Auth
        ? Auth.getAuthHeaders({ "Content-Type": "application/json", "x-mcj-admin-role": adminRole() })
        : { "Content-Type": "application/json", "x-mcj-admin-role": adminRole(), Accept: "application/json" },
    };
    var fetchFn = Auth ? Auth.fetch : fetch;
    if (opts.method === "GET") {
      return fetchFn("/api/admin/service-accounts?action=" + encodeURIComponent(action || "commission_config"), opts).then(parse);
    }
    opts.body = JSON.stringify(Object.assign({ action: action }, body || {}));
    return fetchFn("/api/admin/service-accounts", opts).then(parse);
  }

  function openCommissionOverlay() {
    if (!window.MCJAdminOverlay) return false;
    window.MCJAdminOverlay.open({
      title: "客服佣金设置",
      html: commissionForm(state.commissionConfig || {}),
    });
    return true;
  }

  function openRewardSettingsOverlay() {
    if (!window.MCJAdminOverlay) return false;
    window.MCJAdminOverlay.open({
      title: "客服对接奖励设置",
      html: settingsForm(state.settings || {}),
    });
    return true;
  }

  function renderCommission() {
    var box = commissionMount();
    if (!box) return;
    var c = state.commissionConfig || {};
    var useOverlay = !!window.MCJAdminOverlay;
    var summary =
      '<div class="dashboard-pending-summary" style="margin-bottom:12px">' +
      "<span>底薪 <strong>RM" +
      esc(c.baseSalary != null ? c.baseSalary : 0) +
      "</strong> · 提成 <strong>" +
      esc(c.commissionPercent != null ? c.commissionPercent : 0) +
      "%</strong> · 接待奖 <strong>RM" +
      esc(c.receptionBonus != null ? c.receptionBonus : 0) +
      "</strong> · 夜班 <strong>RM" +
      esc(c.nightShiftAllowance != null ? c.nightShiftAllowance : 0) +
      "</strong> · 其他调整 <strong>RM" +
      esc(c.otherAdjustment != null ? c.otherAdjustment : 0) +
      "</strong></span>" +
      '<div class="admin-dash-actions">' +
      '<button class="mini-btn primary-lite" type="button" data-cs-commission-edit>编辑佣金设置</button>' +
      '<button class="mini-btn" type="button" data-cs-commission-reload>刷新</button>' +
      "</div></div>";
    box.innerHTML =
      (state.commissionError
        ? '<div class="admin-sync-note error">' +
          esc(state.commissionError) +
          ' <button class="mini-btn" type="button" data-cs-commission-reload>重试</button></div>'
        : "") +
      (state.commissionMessage ? '<div class="admin-sync-note">' + esc(state.commissionMessage) + "</div>" : "") +
      (state.commissionLoading
        ? '<div class="empty">Loading… 加载佣金设置...</div>'
        : useOverlay
          ? summary
          : commissionForm(c)) +
      '<div style="margin-top:28px" id="csDockRewardInCommission"></div>';
    var dockHost = document.getElementById("csDockRewardInCommission");
    if (dockHost) {
      dockHost.innerHTML =
        '<div class="cs-reward-panel" data-cs-dock-reward-admin>' +
        rewardsPanelHtml({ showSettingsBtn: true, inlineSettings: true }) +
        "</div>";
    }
    if (
      useOverlay &&
      window.MCJAdminOverlay.isOpen &&
      window.MCJAdminOverlay.isOpen() &&
      document.querySelector("#adminOverlay [data-cs-commission-form]")
    ) {
      window.MCJAdminOverlay.setBody(commissionForm(c));
    }
  }

  function loadCommission() {
    state.commissionLoading = true;
    state.commissionError = "";
    renderCommission();
    commissionApi("commission_config", {}, "GET")
      .then(function (res) {
        state.commissionConfig = res.config || {};
      })
      .catch(function (err) {
        state.commissionError = err.message || "佣金设置读取失败";
      })
      .finally(function () {
        state.commissionLoading = false;
        renderCommission();
      });
  }

  function saveCommission(form) {
    var fd = new FormData(form);
    var payload = {
      receptionBonus: Number(fd.get("receptionBonus") || 0),
      baseSalary: Number(fd.get("baseSalary") || 0),
      attendanceBonus: Number(fd.get("attendanceBonus") || 0),
      nightShiftAllowance: Number(fd.get("nightShiftAllowance") || 0),
      otherAdjustment: Number(fd.get("otherAdjustment") || 0),
      orderCommission: Number(fd.get("orderCommission") || 0),
      commissionPercent: Number(fd.get("commissionPercent") || 0),
      settleOnOrderComplete: String(fd.get("settleOnOrderComplete")) !== "false",
      settleOnPayment: String(fd.get("settleOnPayment")) === "true",
      clawbackOnRefund: String(fd.get("clawbackOnRefund")) !== "false",
      lateDeduction: Number(fd.get("lateDeduction") || 0),
      absenceDeduction: Number(fd.get("absenceDeduction") || 0),
      earlyLeaveDeduction: Number(fd.get("earlyLeaveDeduction") || 0),
      standardDays: Number(fd.get("standardDays") || 22),
      graceMinutes: Number(fd.get("graceMinutes") || 10),
    };
    state.commissionSaving = true;
    state.commissionMessage = "";
    state.commissionError = "";
    var btn = form.querySelector('[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "保存中...";
    }
    commissionApi("save_commission_config", { payload: payload })
      .then(function (res) {
        state.commissionConfig = res.config || payload;
        state.commissionMessage = res.message || "客服佣金设置已保存";
        if (window.MCJNotify) window.MCJNotify.push("system", "成功", state.commissionMessage, "客服佣金");
        if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
          window.MCJAdminOverlay.close();
        }
      })
      .catch(function (err) {
        state.commissionError = err.message || "保存失败";
        if (window.MCJNotify) window.MCJNotify.push("error", "失败", state.commissionError, "客服佣金");
        else alert(state.commissionError);
      })
      .finally(function () {
        state.commissionSaving = false;
        renderCommission();
      });
  }

  function settingsForm(s) {
    s = s || {};
    var node = s.settleNode || "paid";
    return (
      '<form class="service-account-form" data-cs-reward-settings-form>' +
      '<div class="service-account-form-head"><div><h3>客服奖励设置</h3><p>对接成功 = 客服接待老板后，老板成功下单且订单进入有效状态。仅绑定唯一订单结算，结束接待本身不发奖。</p></div></div>' +
      '<div class="form-grid">' +
      '<label>启用客服对接奖励<select name="enabled"><option value="true"' +
      (s.enabled !== false ? " selected" : "") +
      '>启用</option><option value="false"' +
      (s.enabled === false ? " selected" : "") +
      ">停用</option></select></label>" +
      '<label>每次成功对接奖励猫粮<input name="amountCatFood" type="number" min="0" step="0.01" required value="' +
      esc(s.amountCatFood != null ? s.amountCatFood : 10) +
      '"></label>' +
      '<label>奖励结算节点<select name="settleNode">' +
      '<option value="paid"' +
      (node === "paid" ? " selected" : "") +
      ">老板支付成功后结算</option>" +
      '<option value="in_progress"' +
      (node === "in_progress" ? " selected" : "") +
      ">订单进入进行中后结算</option>" +
      '<option value="completed"' +
      (node === "completed" ? " selected" : "") +
      ">订单完成后结算</option>" +
      "</select></label>" +
      '<label>每日奖励上限（0=不限）<input name="dailyCap" type="number" min="0" step="1" value="' +
      esc(s.dailyCap != null ? s.dailyCap : 0) +
      '"></label>' +
      '<label>退款后是否扣回奖励<select name="clawbackOnRefund"><option value="true"' +
      (s.clawbackOnRefund !== false ? " selected" : "") +
      '>是</option><option value="false"' +
      (s.clawbackOnRefund === false ? " selected" : "") +
      ">否</option></select></label>" +
      '<label>取消订单是否取消奖励<select name="cancelOnCancel"><option value="true"' +
      (s.cancelOnCancel !== false ? " selected" : "") +
      '>是</option><option value="false"' +
      (s.cancelOnCancel === false ? " selected" : "") +
      ">否</option></select></label>" +
      '<label>单个订单只允许奖励一次<select name="oncePerOrder"><option value="true"' +
      (s.oncePerOrder !== false ? " selected" : "") +
      '>是</option><option value="false" disabled>否（强制唯一）</option></select></label>' +
      '<label>奖励修改生效时间<input name="effectiveFrom" type="datetime-local" value="' +
      esc(toLocalInput(s.effectiveFrom)) +
      '"></label>' +
      "</div>" +
      '<div class="row" style="margin-top:12px"><button class="primary-btn" type="submit"' +
      (state.saving ? " disabled" : "") +
      ">" +
      (state.saving ? "保存中..." : "保存奖励设置") +
      '</button><button class="ghost-btn" type="button" data-cs-reward-reload>刷新</button></div>' +
      (s.effectiveFrom
        ? '<p class="admin-sync-note" style="margin-top:10px">当前生效时间：' + esc(fmtTime(s.effectiveFrom)) + "</p>"
        : "") +
      "</form>"
    );
  }

  function toLocalInput(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      var pad = function (n) {
        return String(n).padStart(2, "0");
      };
      return (
        d.getFullYear() +
        "-" +
        pad(d.getMonth() + 1) +
        "-" +
        pad(d.getDate()) +
        "T" +
        pad(d.getHours()) +
        ":" +
        pad(d.getMinutes())
      );
    } catch (e) {
      return "";
    }
  }

  function fromLocalInput(v) {
    if (!v) return "";
    try {
      return new Date(v).toISOString();
    } catch (e) {
      return "";
    }
  }

  function summaryCardsHtml() {
    var s = computeSummary(state.records || []);
    return (
      '<div class="stat-grid cs-reward-summary" style="margin:0 0 14px">' +
      '<div class="stat-card"><span>本月奖励总额</span><b>RM ' +
      esc(fmtNum(s.monthRm)) +
      '</b><small class="cs-reward-card-sub">' +
      esc(fmtNum(s.monthCat)) +
      " 猫粮</small></div>" +
      '<div class="stat-card"><span>今日奖励</span><b>RM ' +
      esc(fmtNum(s.todayRm)) +
      '</b><small class="cs-reward-card-sub">' +
      esc(fmtNum(s.todayCat)) +
      " 猫粮</small></div>" +
      '<div class="stat-card"><span>待发放</span><b>RM ' +
      esc(fmtNum(s.pendingRm)) +
      '</b><small class="cs-reward-card-sub">' +
      esc(fmtNum(s.pendingCat)) +
      " 猫粮</small></div>" +
      '<div class="stat-card"><span>已发放</span><b>RM ' +
      esc(fmtNum(s.settledRm)) +
      '</b><small class="cs-reward-card-sub">' +
      esc(fmtNum(s.settledCat)) +
      " 猫粮</small></div>" +
      "</div>"
    );
  }

  function filterToolbarHtml() {
    return (
      '<div class="cs-reward-toolbar">' +
      '<select data-cs-reward-filter-status><option value="">全部状态</option>' +
      '<option value="settled"' +
      (state.filterStatus === "settled" ? " selected" : "") +
      ">已结算</option>" +
      '<option value="pending"' +
      (state.filterStatus === "pending" ? " selected" : "") +
      ">待结算</option>" +
      '<option value="cancelled"' +
      (state.filterStatus === "cancelled" ? " selected" : "") +
      ">已取消</option>" +
      '<option value="clawed_back"' +
      (state.filterStatus === "clawed_back" ? " selected" : "") +
      ">已扣回</option></select>" +
      '<input data-cs-reward-filter-name placeholder="按客服姓名筛选" value="' +
      esc(state.filterName) +
      '">' +
      '<button class="mini-btn primary-lite" type="button" data-cs-reward-filter-apply>筛选</button>' +
      '<button class="mini-btn" type="button" data-cs-reward-reload>刷新记录</button>' +
      "</div>"
    );
  }

  function detailRowsHtml(group) {
    var rows = group.records || [];
    if (!rows.length) {
      return '<tr class="cs-reward-detail-row"><td colspan="7"><div class="empty">暂无明细</div></td></tr>';
    }
    var head =
      '<tr class="cs-reward-detail-row"><td colspan="7"><div class="cs-reward-detail-box">' +
      '<table class="cs-reward-detail-table"><thead><tr>' +
      "<th>订单编号</th><th>老板编号</th><th>订单金额</th><th>固定/提成/最终</th><th>时间</th>" +
      "</tr></thead><tbody>";
    var body = rows
      .map(function (r) {
        var bossCode = r.bossUid || r.bossName || "-";
        var rewardAmt = Number(r.amount || 0);
        var rm = rewardRmForRecord(r);
        var breakdown =
          r.fixedRewardRm != null
            ? "固定 RM" +
              fmtNum(r.fixedRewardRm) +
              " + 提成 RM" +
              fmtNum(r.percentCommissionRm || 0) +
              " = RM" +
              fmtNum(rm)
            : fmtNum(rewardAmt) + " 猫粮 / RM " + fmtNum(rm);
        return (
          "<tr>" +
          "<td>" +
          esc(r.orderNo || "-") +
          "</td>" +
          "<td>" +
          esc(bossCode) +
          "</td>" +
          "<td>" +
          esc(fmtNum(r.orderAmount)) +
          "</td>" +
          "<td>" +
          esc(breakdown) +
          "</td>" +
          "<td>" +
          esc(fmtTime(recordTime(r))) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
    return head + body + "</tbody></table></div></td></tr>";
  }

  function recordsTable() {
    var filtered = (state.records || []).filter(function (r) {
      if (state.filterName) {
        var q = String(state.filterName).trim().toLowerCase();
        if (q && String(r.serviceName || "").toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
    var groups = aggregateByService(filtered);
    var body = !groups.length
      ? '<tr><td colspan="7"><div class="empty">暂无客服奖励记录</div></td></tr>'
      : groups
          .map(function (g) {
            var open = !!state.expandedServiceIds[g.serviceId];
            var main =
              '<tr class="cs-reward-group-row" data-cs-reward-group="' +
              esc(g.serviceId) +
              '">' +
              "<td>" +
              esc(g.serviceName) +
              "</td>" +
              "<td>" +
              esc(g.orderCount) +
              "</td>" +
              "<td>" +
              esc(g.successCount) +
              "</td>" +
              "<td>" +
              esc(fmtNum(g.catFood)) +
              "</td>" +
              "<td><strong>RM " +
              esc(fmtNum(g.rewardRm)) +
              "</strong></td>" +
              "<td>" +
              esc(groupSettleStatus(g)) +
              "</td>" +
              '<td><button class="mini-btn" type="button" data-cs-reward-toggle="' +
              esc(g.serviceId) +
              '">' +
              (open ? "收起" : "查看详情") +
              "</button></td>" +
              "</tr>";
            return open ? main + detailRowsHtml(g) : main;
          })
          .join("");
    return (
      '<div class="table-wrap service-account-table-wrap cs-reward-table-wrap"><table class="service-account-table cs-reward-table"><thead><tr>' +
      "<th>客服姓名</th><th>接待订单数</th><th>接待成功数</th><th>奖励猫粮</th><th>奖励RM</th><th>结算状态</th><th>查看详情</th>" +
      "</tr></thead><tbody>" +
      body +
      "</tbody></table></div>"
    );
  }

  function rewardsPanelHtml(opts) {
    opts = opts || {};
    var useOverlay = !!window.MCJAdminOverlay;
    return (
      (state.error ? '<div class="admin-sync-note error">' + esc(state.error) + "</div>" : "") +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      '<header class="service-account-head"><div><h3>客服奖励记录</h3><p>按客服汇总本月应付；展开查看订单明细。每条记录绑定唯一订单。</p></div>' +
      (opts.showSettingsBtn && useOverlay
        ? '<button class="mini-btn primary-lite" type="button" data-cs-reward-edit>编辑奖励设置</button>'
        : "") +
      "</header>" +
      (opts.inlineSettings && !useOverlay ? settingsForm(state.settings || {}) : "") +
      summaryCardsHtml() +
      filterToolbarHtml() +
      (state.loading ? '<div class="empty">加载中...</div>' : recordsTable())
    );
  }

  function render() {
    var box = mount();
    if (!box) return;
    box.innerHTML =
      '<section class="service-account-admin cs-reward-panel" data-cs-dock-reward-admin>' +
      rewardsPanelHtml({ showSettingsBtn: false, inlineSettings: true }) +
      "</section>";
  }

  function loadAll() {
    state.loading = true;
    state.error = "";
    render();
    if (document.getElementById("csCommissionMount")) renderCommission();
    Promise.all([api("settings", {}, "GET"), api("records", {}, "GET")])
      .then(function (pair) {
        state.settings = (pair[0] && pair[0].settings) || null;
        state.records = (pair[1] && pair[1].records) || [];
        state.loaded = true;
      })
      .catch(function (err) {
        state.error = err.message || "客服奖励读取失败";
        state.loaded = true;
      })
      .finally(function () {
        state.loading = false;
        render();
        if (document.getElementById("csCommissionMount")) renderCommission();
      });
  }

  function saveSettings(form) {
    var fd = new FormData(form);
    var payload = {
      enabled: String(fd.get("enabled")) !== "false",
      amountCatFood: Number(fd.get("amountCatFood") || 0),
      settleNode: String(fd.get("settleNode") || "paid"),
      dailyCap: Number(fd.get("dailyCap") || 0),
      clawbackOnRefund: String(fd.get("clawbackOnRefund")) !== "false",
      cancelOnCancel: String(fd.get("cancelOnCancel")) !== "false",
      oncePerOrder: true,
      effectiveFrom: fromLocalInput(String(fd.get("effectiveFrom") || "")) || new Date().toISOString(),
    };
    state.saving = true;
    state.message = "";
    state.error = "";
    var btn = form.querySelector('[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "保存中...";
    }
    api("save_settings", { payload: payload })
      .then(function (res) {
        state.settings = res.settings || payload;
        state.message = res.message || "客服奖励设置已保存";
        if (window.MCJNotify) window.MCJNotify.push("system", "成功", state.message, "客服奖励");
        if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
          window.MCJAdminOverlay.close();
        }
        return api("records", {}, "GET");
      })
      .then(function (res) {
        if (res && res.records) state.records = res.records;
      })
      .catch(function (err) {
        state.error = err.message || "保存失败";
        if (window.MCJNotify) window.MCJNotify.push("error", "失败", state.error, "客服奖励");
        else alert(state.error);
      })
      .finally(function () {
        state.saving = false;
        render();
        if (document.getElementById("csCommissionMount")) renderCommission();
      });
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-cs-commission-edit]")) {
      openCommissionOverlay();
      return;
    }
    if (e.target.closest("[data-cs-reward-edit]")) {
      openRewardSettingsOverlay();
      return;
    }
    var toggle = e.target.closest("[data-cs-reward-toggle]");
    if (toggle) {
      var sid = String(toggle.getAttribute("data-cs-reward-toggle") || "");
      if (sid) {
        if (state.expandedServiceIds[sid]) delete state.expandedServiceIds[sid];
        else state.expandedServiceIds[sid] = true;
        render();
        if (document.getElementById("csCommissionMount")) renderCommission();
      }
      return;
    }
    if (e.target.closest("[data-cs-reward-reload]")) {
      loadAll();
      return;
    }
    if (e.target.closest("[data-cs-commission-reload]")) {
      loadCommission();
      return;
    }
    if (e.target.closest("[data-cs-reward-filter-apply]")) {
      var st = document.querySelector("[data-cs-reward-filter-status]");
      var nameEl = document.querySelector("[data-cs-reward-filter-name]");
      state.filterStatus = st ? String(st.value || "") : "";
      state.filterName = nameEl ? String(nameEl.value || "").trim() : "";
      state.filterServiceId = "";
      loadAll();
    }
  });

  document.addEventListener("submit", function (e) {
    if (e.target.matches("[data-cs-reward-settings-form]")) {
      e.preventDefault();
      saveSettings(e.target);
      return;
    }
    if (e.target.matches("[data-cs-commission-form]")) {
      e.preventDefault();
      saveCommission(e.target);
    }
  });

  function maybeLoadCommission() {
    if (!document.getElementById("csCommissionMount")) return;
    if (!state.commissionConfig && !state.commissionLoading) {
      loadCommission();
      if (!state.loaded && !state.loading) loadAll();
    } else renderCommission();
  }

  function maybeLoad() {
    if (document.getElementById("csCommissionMount")) {
      maybeLoadCommission();
      return;
    }
    if (!document.getElementById("serviceAccountManagement")) return;
    if (!state.loaded && !state.loading) loadAll();
    else render();
  }

  window.__MCJRenderCsDockRewards = maybeLoad;
  window.__MCJRenderCsCommission = maybeLoadCommission;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", maybeLoad);
  } else {
    maybeLoad();
  }
  document.addEventListener("click", function (e) {
    var btn = e.target.closest('[data-section="service-accounts"], [data-section="service-stats"]');
    if (btn) setTimeout(maybeLoad, 50);
  });
})();
