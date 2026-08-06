(function () {
  var state = {
    loaded: false,
    loading: false,
    saving: false,
    error: "",
    message: "",
    rows: [],
    storage: "",
    /** Accordion: "" = all collapsed; only one section open at a time */
    openPanel: "",
    attendanceMonth: "",
    attendanceHistory: [],
    attendanceLoading: false,
    attendanceError: "",
    attendanceLoaded: false,
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function isDbUuid(v) {
    if (window.MCJAdminPrivacy && window.MCJAdminPrivacy.isDbUuid) return window.MCJAdminPrivacy.isDbUuid(v);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || "").trim());
  }
  function isDevLogin(v) {
    if (window.MCJAdminPrivacy && window.MCJAdminPrivacy.isDevLogin) return window.MCJAdminPrivacy.isDevLogin(v);
    var s = String(v || "").trim().toLowerCase();
    if (!s) return false;
    if (/\.meow\.test$/i.test(s)) return true;
    if (/^(service|boss|companion|admin)\./i.test(s)) return true;
    return isDbUuid(s);
  }
  function publicEmailLabel(email) {
    if (window.MCJAdminPrivacy && window.MCJAdminPrivacy.publicEmailLabel) return window.MCJAdminPrivacy.publicEmailLabel(email);
    var s = String(email || "").trim();
    if (!s || isDevLogin(s)) return "未绑定邮箱";
    return s;
  }
  function formatCsCode(row) {
    var direct = String((row && (row.csCode || row.cs_code || row.staffCode || row.staff_code)) || "").trim();
    if (/^CS\d+$/i.test(direct)) return direct.toUpperCase();
    var name = String((row && row.name) || "").trim();
    var m = name.match(/(\d{3,8})$/);
    if (m) return "CS" + String(m[1]).padStart(6, "0");
    return "未分配";
  }
  function onlineStatusLabel(row) {
    var direct = String((row && row.onlineStatus) || "").trim();
    if (/^(在线|离线|接待中)$/.test(direct)) return direct;
    var clock = String((row && row.todayClockStatus) || "");
    var receptions = Number((row && row.todayReceptions) || 0) || 0;
    if (/上班|工作中|在岗/i.test(clock)) return receptions > 0 ? "接待中" : "在线";
    if (/接待/i.test(clock)) return "接待中";
    return "离线";
  }
  function workHoursLabel(row) {
    var h = row && row.todayWorkHours;
    if (h == null || h === "" || h === "-") return "-";
    var n = Number(h);
    if (Number.isFinite(n)) return n + " 小时";
    return String(h);
  }
  function adminDevInfoHtml(rows) {
    if (window.MCJAdminPrivacy && window.MCJAdminPrivacy.adminDevInfoHtml) return window.MCJAdminPrivacy.adminDevInfoHtml(rows);
    var items = (rows || []).filter(function (r) {
      return r && r[1] != null && String(r[1]).trim() !== "" && String(r[1]).trim() !== "-";
    });
    if (!items.length) return "";
    return (
      '<details class="admin-dev-info"><summary>开发信息</summary><div class="admin-dev-info-body">' +
      items
        .map(function (r) {
          return "<div><span>" + esc(r[0]) + "</span><code>" + esc(r[1]) + "</code></div>";
        })
        .join("") +
      "</div></details>"
    );
  }
  function statusChip(text) {
    var t = String(text || "");
    var cls = /启用|在线|接待中|通过|完成/.test(t) ? "ok" : /停用|离线|拒绝|冻结/.test(t) ? "bad" : "wait";
    return '<span class="chip ' + cls + '">' + esc(t || "-") + "</span>";
  }
  function toast(message, isError) {
    var msg = String(message || "");
    if (!msg) return;
    try {
      if (window.MCJNotify && typeof window.MCJNotify.push === "function") {
        window.MCJNotify.push(isError ? "error" : "system", isError ? "失败" : "成功", msg, "客服管理");
        return;
      }
    } catch (e) {}
    try {
      alert(msg);
    } catch (e2) {}
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
  function adminToken() {
    return window.MCJAdminAuthFetch
      ? window.MCJAdminAuthFetch.getAccessToken()
      : localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken") || "";
  }
  function api(action, body, method, timeoutMs) {
    var Auth = window.MCJAdminAuthFetch;
    var opts = {
      method: method || "POST",
      headers: Auth
        ? Auth.getAuthHeaders({ "Content-Type": "application/json", "x-mcj-admin-role": adminRole() })
        : {
            "Content-Type": "application/json",
            "x-mcj-admin-role": adminRole(),
            Accept: "application/json",
            Authorization: "Bearer " + adminToken(),
            "x-mcj-access-token": adminToken(),
          },
    };
    var fetchFn = Auth ? Auth.fetch : fetch;
    var ms = timeoutMs || (action === "create" || action === "update" ? 25000 : 45000);
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = null;
    if (controller) {
      opts.signal = controller.signal;
      timer = setTimeout(function () {
        try {
          controller.abort();
        } catch (e) {}
      }, ms);
    }
    var done = function (p) {
      return p.finally(function () {
        if (timer) clearTimeout(timer);
      });
    };
    if (opts.method === "GET") {
      var q = "/api/admin/service-accounts?action=" + encodeURIComponent(action || "list");
      if (action === "attendance_history") {
        if (state.attendanceMonth) q += "&month=" + encodeURIComponent(state.attendanceMonth);
      }
      return done(fetchFn(q, opts).then(parse));
    }
    opts.body = JSON.stringify(Object.assign({ action: action }, body || {}));
    return done(
      fetchFn("/api/admin/service-accounts", opts)
        .then(parse)
        .catch(function (err) {
          if (err && (err.name === "AbortError" || /abort/i.test(String(err.message || "")))) {
            throw new Error("请求超时，请重试。若邮箱已存在请更换邮箱。");
          }
          throw err;
        })
    );
  }
  function parse(res) {
    return res.text().then(function (text) {
      var body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch (e) {
        throw new Error("接口返回格式错误");
      }
      if (!res.ok || body.ok === false) {
        var msg = body.message || "请求失败：HTTP " + res.status;
        if (/邮箱已存在|already|exist|registered|duplicate|email_exists/i.test(msg)) {
          msg = "该邮箱已存在，请更换邮箱。";
        }
        throw new Error(msg);
      }
      return body;
    });
  }
  function money(v) {
    var n = Number(v || 0);
    return Number.isFinite(n) ? n.toFixed(2) : "0.00";
  }
  function currentMonth() {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
    } catch (e) {
      return new Date().toISOString().slice(0, 7);
    }
  }
  function panelFromHash() {
    var hash = (location.hash || "").replace("#", "");
    if (hash === "service-stats") return "wages";
    if (hash === "service-attendance") return "attendance";
    if (hash === "service-commission") return "commission";
    // Keep #service-accounts as section route only — do not auto-open accordion.
    return "";
  }
  function normalizeSectionHash() {
    // Accordion panel state must NOT own location.hash: admin-suite treats hash as
    // the active sidebar section and rewrites unknown hashes (and used to activate
    // empty #section-service-stats). Always stay on #service-accounts while here.
    var hash = (location.hash || "").replace("#", "");
    if (
      hash === "service-stats" ||
      hash === "service-commission" ||
      hash === "service-attendance" ||
      hash === "service-accounts"
    ) {
      try {
        if (hash !== "service-accounts") {
          history.replaceState(null, "", location.pathname + location.search + "#service-accounts");
        }
      } catch (e) {}
    }
  }
  function afterPanelOpen(name, opts) {
    opts = opts || {};
    if (!name) return;
    if (name === "commission" && typeof window.__MCJRenderCsCommission === "function") {
      try {
        window.__MCJRenderCsCommission();
      } catch (e) {}
    }
    if (name === "accounts" && typeof window.__MCJRenderCsDockRewards === "function") {
      try {
        window.__MCJRenderCsDockRewards();
      } catch (e) {}
    }
    // Only fetch attendance on user expand/refresh — not on every re-render (avoids loops).
    if (name === "attendance" && opts.fetchAttendance && !state.attendanceLoading) {
      loadAttendanceHistory(false);
    }
  }
  function setPanel(name, forceOpen) {
    var next = name || "";
    if (!forceOpen && state.openPanel === next) {
      state.openPanel = "";
    } else {
      state.openPanel = next;
    }
    normalizeSectionHash();
    render();
    afterPanelOpen(state.openPanel, { fetchAttendance: true });
  }
  function accordionShell(innerAccounts, innerCommission, innerWages, innerAttendance) {
    var tabs = [
      ["accounts", "客服账号", innerAccounts],
      ["commission", "佣金设置", innerCommission],
      ["wages", "工资中心", innerWages],
      ["attendance", "打卡查询", innerAttendance],
    ];
    return (
      '<section class="service-account-admin">' +
      '<header class="service-account-head"><div><h2>客服管理</h2><p>默认全部折叠；点击某一项展开，其余自动收起。</p></div></header>' +
      (state.error
        ? '<div class="admin-sync-note error">' +
          esc(state.error) +
          ' <button class="mini-btn" type="button" data-service-account-refresh>重试</button></div>'
        : "") +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      '<div class="cs-accordion" style="display:flex;flex-direction:column;gap:8px">' +
      tabs
        .map(function (t) {
          var open = state.openPanel === t[0];
          return (
            '<div class="cs-acc-item" data-cs-acc="' +
            t[0] +
            '" style="border:1px solid rgba(255,255,255,.12);border-radius:10px;min-width:0;max-width:100%">' +
            '<button type="button" class="mini-btn' +
            (open ? " primary-lite" : "") +
            '" data-cs-panel="' +
            t[0] +
            '" aria-expanded="' +
            (open ? "true" : "false") +
            '" style="width:100%;justify-content:space-between;display:flex;border-radius:0;padding:12px 14px">' +
            "<span>" +
            esc(t[1]) +
            "</span><span aria-hidden=\"true\">" +
            (open ? "▾" : "▸") +
            "</span></button>" +
            (open ? '<div class="cs-acc-body" style="padding:12px 14px 16px">' + t[2] + "</div>" : "") +
            "</div>"
          );
        })
        .join("") +
      "</div></section>"
    );
  }
  function accountsBodyHtml() {
    return (
      '<div style="display:flex;justify-content:flex-end;margin:0 0 12px"><button class="primary-btn" type="button" data-service-account-new>+ 新建客服账号</button></div>' +
      '<div class="service-account-form-shell" data-service-account-editor hidden></div>' +
      (state.loading ? '<div class="empty">Loading… 正在读取客服账号...</div>' : "") +
      '<div class="table-wrap service-account-table-wrap"><table class="service-account-table"><thead><tr><th>客服姓名</th><th>客服编号</th><th>登录邮箱</th><th>当前状态</th><th>在线状态</th><th>今日订单</th><th>今日接待</th><th>今日工作时长</th><th>操作</th></tr></thead><tbody>' +
      rowsHtml() +
      "</tbody></table></div>" +
      '<div id="csDockRewardMount" style="margin-top:20px"></div>'
    );
  }
  function commissionBodyHtml() {
    return '<div id="csCommissionMount"><div class="empty">Loading… 正在加载佣金设置...</div></div>';
  }
  var commissionState = { loading: false, saving: false, error: "", message: "", config: null };
  function commissionField(label, name, value, hint) {
    return (
      '<label style="display:flex;flex-direction:column;gap:4px;min-width:140px;flex:1"><span>' +
      esc(label) +
      '</span><input type="number" step="0.01" name="' +
      esc(name) +
      '" value="' +
      esc(value == null ? "" : value) +
      '">' +
      (hint ? '<small class="muted">' + esc(hint) + "</small>" : "") +
      "</label>"
    );
  }
  function renderCsCommission() {
    var mount = document.getElementById("csCommissionMount");
    if (!mount) return;
    if (commissionState.loading && !commissionState.config) {
      mount.innerHTML = '<div class="empty">Loading… 正在加载佣金设置...</div>';
      return;
    }
    if (commissionState.error && !commissionState.config) {
      mount.innerHTML =
        '<div class="admin-sync-note error">' +
        esc(commissionState.error) +
        ' <button class="mini-btn" type="button" data-cs-commission-reload>重试</button></div>';
      return;
    }
    var c = commissionState.config || {};
    mount.innerHTML =
      (commissionState.message ? '<div class="admin-sync-note">' + esc(commissionState.message) + "</div>" : "") +
      (commissionState.error ? '<div class="admin-sync-note error">' + esc(commissionState.error) + "</div>" : "") +
      '<form data-cs-commission-form style="display:flex;flex-direction:column;gap:12px">' +
      '<div style="display:flex;flex-wrap:wrap;gap:12px">' +
      commissionField("底薪 (RM)", "baseSalary", c.baseSalary, "") +
      commissionField("全勤奖励", "attendanceBonus", c.attendanceBonus, "") +
      commissionField("接待奖励", "receptionBonus", c.receptionBonus, "") +
      commissionField("每单提成 (RM)", "orderCommission", c.orderCommission, "") +
      commissionField("提成比例 %", "commissionPercent", c.commissionPercent, "") +
      "</div>" +
      '<div style="display:flex;flex-wrap:wrap;gap:12px">' +
      commissionField("夜班补贴", "nightShiftAllowance", c.nightShiftAllowance, "") +
      commissionField("加班补贴", "overtimeAllowance", c.overtimeAllowance, "") +
      commissionField("其他调整", "otherAdjustment", c.otherAdjustment, "") +
      commissionField("标准出勤天数", "standardDays", c.standardDays, "") +
      commissionField("迟到宽限(分)", "graceMinutes", c.graceMinutes, "") +
      "</div>" +
      '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
      '<label><input type="checkbox" name="settleOnOrderComplete" ' +
      (c.settleOnOrderComplete !== false ? "checked" : "") +
      "> 订单完成后结算提成</label>" +
      '<label><input type="checkbox" name="settleOnPayment" ' +
      (c.settleOnPayment ? "checked" : "") +
      "> 确认付款时结算</label>" +
      '<label><input type="checkbox" name="clawbackOnRefund" ' +
      (c.clawbackOnRefund !== false ? "checked" : "") +
      "> 退款时收回提成</label>" +
      "</div>" +
      '<div><button class="primary-btn" type="submit"' +
      (commissionState.saving ? " disabled" : "") +
      ">" +
      (commissionState.saving ? "保存中…" : "保存佣金设置") +
      "</button></div></form>";
  }
  function loadCsCommission() {
    commissionState.loading = true;
    commissionState.error = "";
    renderCsCommission();
    api("commission_config", null, "GET")
      .then(function (res) {
        commissionState.loading = false;
        commissionState.config = res.config || {};
        renderCsCommission();
      })
      .catch(function (err) {
        commissionState.loading = false;
        commissionState.error = err.message || "佣金设置加载失败";
        renderCsCommission();
      });
  }
  function saveCsCommission(form) {
    var fd = new FormData(form);
    var payload = {
      baseSalary: fd.get("baseSalary"),
      attendanceBonus: fd.get("attendanceBonus"),
      receptionBonus: fd.get("receptionBonus"),
      orderCommission: fd.get("orderCommission"),
      commissionPercent: fd.get("commissionPercent"),
      nightShiftAllowance: fd.get("nightShiftAllowance"),
      overtimeAllowance: fd.get("overtimeAllowance"),
      otherAdjustment: fd.get("otherAdjustment"),
      standardDays: fd.get("standardDays"),
      graceMinutes: fd.get("graceMinutes"),
      settleOnOrderComplete: !!(form.querySelector('[name="settleOnOrderComplete"]') || {}).checked,
      settleOnPayment: !!(form.querySelector('[name="settleOnPayment"]') || {}).checked,
      clawbackOnRefund: !!(form.querySelector('[name="clawbackOnRefund"]') || {}).checked,
    };
    commissionState.saving = true;
    commissionState.message = "";
    commissionState.error = "";
    renderCsCommission();
    api("save_commission_config", payload)
      .then(function (res) {
        commissionState.saving = false;
        commissionState.config = res.config || payload;
        commissionState.message = res.message || "佣金设置已保存";
        renderCsCommission();
      })
      .catch(function (err) {
        commissionState.saving = false;
        commissionState.error = err.message || "保存失败";
        renderCsCommission();
      });
  }
  window.__MCJRenderCsCommission = function () {
    if (!commissionState.config && !commissionState.loading) loadCsCommission();
    else renderCsCommission();
  };
  function wageStatusLabel(row) {
    var d = (row && row.wageDetail) || {};
    var raw = String((row && (row.wageStatus || row.salaryStatus)) || d.status || "pending").toLowerCase();
    if (raw === "paid" || raw === "已发放" || raw === "已结算") return "已发放";
    if (raw === "approved" || raw === "已审核") return "已审核";
    return "待结算";
  }
  function wagesBodyHtml() {
    return (
      '<header class="service-account-head" style="margin:0 0 12px"><div><h3 style="margin:0">客服工资中心</h3><p style="margin:4px 0 0">与客服端工资中心同源（全局佣金配置 + 打卡/接待/订单）。</p></div><div style="display:flex;gap:8px"><button class="mini-btn primary-lite" type="button" data-cs-wage-export>导出 CSV</button><button class="mini-btn" type="button" data-service-account-refresh>刷新</button></div></header>' +
      (state.loading ? '<div class="empty">Loading… 正在读取工资数据...</div>' : "") +
      (!state.loading && state.error
        ? '<div class="admin-sync-note error">' +
          esc(state.error) +
          ' <button class="mini-btn" type="button" data-service-account-refresh>重试</button></div>'
        : "") +
      '<div class="table-wrap service-account-table-wrap"><table class="service-account-table"><thead><tr><th>客服</th><th>底薪</th><th>接待奖励</th><th>订单提成</th><th>夜班补贴</th><th>全勤奖励</th><th>扣款</th><th>其他调整</th><th>实发工资</th><th>状态</th><th>工资计算明细</th></tr></thead><tbody>' +
      (state.loading
        ? '<tr><td colspan="11"><div class="empty">Loading…</div></td></tr>'
        : state.rows.length
          ? state.rows
              .map(function (row) {
                var d = row.wageDetail || {};
                var reception = d.receptionBonus != null ? d.receptionBonus : row.receptionBonus;
                var attendance = d.attendanceBonus != null ? d.attendanceBonus : row.attendanceBonus;
                var night = d.nightShiftAllowance != null ? d.nightShiftAllowance : row.nightShiftAllowance;
                var other = d.otherAdjustment != null ? d.otherAdjustment : row.otherAdjustment;
                var detail =
                  d.formula ||
                  "底薪" +
                    money(row.baseSalary) +
                    "+接待" +
                    money(reception) +
                    "+提成" +
                    money(row.orderCommission) +
                    "+夜班" +
                    money(night) +
                    "+全勤" +
                    money(attendance) +
                    "+其他" +
                    money(other) +
                    "-扣款" +
                    money(row.penaltyTotal) +
                    "=" +
                    money(row.estimatedSalary);
                return (
                  "<tr><td>" +
                  esc(row.name || "-") +
                  "</td><td>" +
                  esc(money(row.baseSalary)) +
                  "</td><td>" +
                  esc(money(reception)) +
                  "</td><td>" +
                  esc(money(row.orderCommission)) +
                  "</td><td>" +
                  esc(money(night)) +
                  "</td><td>" +
                  esc(money(attendance)) +
                  "</td><td>" +
                  esc(money(row.penaltyTotal)) +
                  "</td><td>" +
                  esc(money(other)) +
                  "</td><td>" +
                  esc(money(row.estimatedSalary)) +
                  "</td><td>" +
                  esc(wageStatusLabel(row)) +
                  "</td><td style=\"max-width:280px;font-size:12px;word-break:break-all\">" +
                  esc(detail) +
                  "</td></tr>"
                );
              })
              .join("")
          : '<tr><td colspan="11"><div class="empty">暂无客服工资数据</div></td></tr>') +
      "</tbody></table></div>"
    );
  }
  function attendanceBodyHtml() {
    var history = state.attendanceHistory.length
      ? state.attendanceHistory
      : state.attendanceLoaded
        ? []
        : buildLocalAttendanceHistory();
    return (
      '<header class="service-account-head" style="margin:0 0 12px"><div><h3 style="margin:0">打卡查询</h3><p style="margin:4px 0 0">按班次写入 cs_attendance_sessions（同一天可多段）；含类型、工时、迟到早退。</p></div><div style="display:flex;gap:8px;align-items:center"><input type="month" data-cs-attendance-month value="' +
      esc(state.attendanceMonth || currentMonth()) +
      '"><button class="mini-btn primary-lite" type="button" data-cs-attendance-export>导出 CSV</button><button class="mini-btn" type="button" data-cs-attendance-refresh>刷新</button></div></header>' +
      (state.attendanceLoading ? '<div class="empty">Loading… 加载打卡历史...</div>' : "") +
      (state.attendanceError
        ? '<div class="admin-sync-note error">' +
          esc(state.attendanceError) +
          ' <button class="mini-btn" type="button" data-cs-attendance-refresh>重试</button></div>'
        : "") +
      '<div class="table-wrap service-account-table-wrap"><table class="service-account-table"><thead><tr><th>客服</th><th>日期</th><th>班次类型</th><th>上班时间</th><th>下班时间</th><th>工时</th><th>迟到</th><th>早退</th><th>状态</th></tr></thead><tbody>' +
      (state.attendanceLoading
        ? '<tr><td colspan="9"><div class="empty">Loading…</div></td></tr>'
        : history.length
          ? history
              .map(function (h) {
                return (
                  "<tr><td>" +
                  esc(h.serviceName || h.name || "-") +
                  "</td><td>" +
                  esc(h.date || "-") +
                  "</td><td>" +
                  esc(h.sessionTypeLabel || h.sessionType || "正常班") +
                  "</td><td>" +
                  esc(h.clockInText || "-") +
                  "</td><td>" +
                  esc(h.clockOutText || "-") +
                  "</td><td>" +
                  esc(h.workHours != null ? h.workHours : "-") +
                  "</td><td>" +
                  esc(h.isLate ? "是(" + (h.lateMinutes || 0) + "分)" : "否") +
                  "</td><td>" +
                  esc(h.isEarlyLeave ? "是(" + (h.earlyLeaveMinutes || 0) + "分)" : "否") +
                  "</td><td>" +
                  esc(h.attendanceStatus || "-") +
                  "</td></tr>"
                );
              })
              .join("")
          : '<tr><td colspan="9"><div class="empty">本月暂无打卡历史</div></td></tr>') +
      "</tbody></table></div>"
    );
  }
  function render() {
    var target = document.getElementById("serviceAccountManagement");
    if (!target) return;
    target.innerHTML = accordionShell(accountsBodyHtml(), commissionBodyHtml(), wagesBodyHtml(), attendanceBodyHtml());
    var stats = document.getElementById("serviceWorkStats");
    if (stats) stats.innerHTML = "";
    if (!state.loaded && !state.loading) load();
    // Remount panel widgets after innerHTML wipe (no attendance refetch here).
    afterPanelOpen(state.openPanel);
  }
  function rowsHtml() {
    if (state.loading) return '<tr><td colspan="9"><div class="empty">正在读取客服账号...</div></td></tr>';
    if (!state.rows.length)
      return '<tr><td colspan="9"><div class="empty">暂无客服账号，点击右上角“新建客服账号”创建。</div></td></tr>';
    return state.rows
      .map(function (row) {
        var rawEmail = row.rawEmail || row.email || row.account || "";
        var loginEmail = publicEmailLabel(row.loginEmail != null ? row.loginEmail : row.email);
        var csCode = row.csCode || formatCsCode(row);
        var online = onlineStatusLabel(row);
        return (
          '<tr data-service-account-row="' +
          esc(row.id) +
          '"><td>' +
          esc(row.name || "-") +
          "</td><td>" +
          esc(csCode) +
          "</td><td>" +
          esc(loginEmail) +
          "</td><td>" +
          statusChip(row.status) +
          "</td><td>" +
          statusChip(online) +
          "</td><td>" +
          esc(row.todayOrders || 0) +
          "</td><td>" +
          esc(row.todayReceptions || 0) +
          "</td><td>" +
          esc(workHoursLabel(row)) +
          '</td><td><div class="service-account-actions"><button class="mini-btn" type="button" data-service-account-view="' +
          esc(row.id) +
          '">查看</button><button class="mini-btn" type="button" data-service-account-edit="' +
          esc(row.id) +
          '">编辑</button><button class="mini-btn" type="button" data-service-account-reset="' +
          esc(row.id) +
          '">重置密码</button><button class="mini-btn" type="button" data-service-account-toggle="' +
          esc(row.id) +
          '" data-next-status="' +
          (row.status === "启用" ? "停用" : "启用") +
          '">' +
          (row.status === "启用" ? "停用" : "启用") +
          '</button><button class="mini-btn danger" type="button" data-service-account-delete="' +
          esc(row.id) +
          '">删除</button></div>' +
          adminDevInfoHtml([
            ["Internal ID", row.id],
            ["Auth UID", row.id],
            ["开发登录账号", isDevLogin(rawEmail) || isDbUuid(rawEmail) ? rawEmail : ""],
            ["开发邮箱", isDevLogin(rawEmail) ? rawEmail : ""],
          ]) +
          "</td></tr>"
        );
      })
      .join("");
  }
  function load() {
    state.loading = true;
    render();
    api("list", {}, "GET")
      .then(function (res) {
        state.rows = res.accounts || [];
        state.storage = res.storage || "";
        state.error = "";
        if (res.message) state.message = res.message;
        state.loaded = true;
      })
      .catch(function (err) {
        state.rows = [];
        state.error = err.message || "客服账号读取失败";
        state.loaded = true;
      })
      .finally(function () {
        state.loading = false;
        render();
      });
  }
  function loadAttendanceHistory(force) {
    if (state.attendanceLoading && !force) return;
    state.attendanceLoading = true;
    state.attendanceError = "";
    render();
    api("attendance_history", {}, "GET")
      .then(function (res) {
        state.attendanceHistory = res.history || [];
        state.attendanceError = "";
        state.attendanceLoaded = true;
      })
      .catch(function (err) {
        state.attendanceHistory = [];
        state.attendanceError = (err && err.message) || "打卡历史读取失败";
        state.attendanceLoaded = true;
      })
      .finally(function () {
        state.attendanceLoading = false;
        render();
      });
  }
  function find(id) {
    return (
      state.rows.find(function (row) {
        return String(row.id) === String(id) || String(row.account) === String(id);
      }) || null
    );
  }
  function editor(row, readonly) {
    var isEdit = !!row;
    var rawEmail = (row && (row.rawEmail || row.email || row.account)) || "";
    var emailValue = isDevLogin(rawEmail) && readonly ? "" : isDevLogin(rawEmail) ? rawEmail : rawEmail;
    var emailShown = readonly ? publicEmailLabel(rawEmail) : emailValue;
    var csCode = row ? row.csCode || formatCsCode(row) : "";
    return (
      '<form class="service-account-form" data-service-account-form data-edit-id="' +
      esc((row && row.id) || "") +
      '"><div class="service-account-form-head"><div><h3>' +
      (readonly ? "客服账号详情" : isEdit ? "编辑客服账号" : "新建客服账号") +
      '</h3><p>密码只写入服务端哈希，不会在后台明文展示。</p></div><button class="mini-btn" type="button" data-service-account-cancel>关闭</button></div><div class="form-grid"><label>客服姓名<input name="name" value="' +
      esc((row && row.name) || "") +
      '" ' +
      (readonly ? "readonly" : "required") +
      '></label><label>客服编号<input value="' +
      esc(csCode || (isEdit ? "未分配" : "保存后按姓名生成")) +
      '" readonly></label><label>登录邮箱<input name="email" type="email" value="' +
      esc(readonly ? (emailShown === "未绑定邮箱" ? "" : emailShown) : emailValue) +
      '" placeholder="' +
      (readonly && emailShown === "未绑定邮箱" ? "未绑定邮箱" : "真实登录邮箱") +
      '" ' +
      (readonly ? "readonly" : isEdit ? "" : "required") +
      '></label><input type="hidden" name="account" value="' +
      esc(rawEmail || emailValue || "") +
      '"><label>初始密码<input name="password" type="password" placeholder="' +
      (isEdit ? "留空则不修改密码" : "至少 8 位") +
      '" ' +
      (!isEdit && !readonly ? "required" : "") +
      " " +
      (readonly ? "readonly" : "") +
      '></label><label>手机号码，可选<input name="phone" value="' +
      esc((row && row.phone) || "") +
      '" ' +
      (readonly ? "readonly" : "") +
      '></label><label>账号状态<select name="status" ' +
      (readonly ? "disabled" : "") +
      '><option value="启用" ' +
      (!row || row.status === "启用" ? "selected" : "") +
      '>启用</option><option value="停用" ' +
      (row && row.status === "停用" ? "selected" : "") +
      '>停用</option></select></label><label class="wide">备注，可选<textarea name="remark" ' +
      (readonly ? "readonly" : "") +
      ">" +
      esc((row && row.remark) || "") +
      "</textarea></label></div>" +
      (row
        ? adminDevInfoHtml([
            ["Internal ID", row.id],
            ["Auth UID", row.id],
            ["开发登录账号", isDevLogin(rawEmail) || isDbUuid(String(row.account || "")) ? rawEmail || row.account : ""],
            ["开发邮箱", isDevLogin(rawEmail) ? rawEmail : ""],
          ])
        : "") +
      (readonly
        ? ""
        : '<div class="row"><button class="primary-btn" type="submit"' +
          (state.saving ? " disabled" : "") +
          ">" +
          (state.saving ? "保存中..." : "保存客服账号") +
          '</button><button class="ghost-btn" type="button" data-service-account-cancel>取消</button></div>') +
      '<div class="admin-sync-note error" data-service-account-form-error hidden style="margin-top:10px"></div>' +
      "</form>"
    );
  }
  function editorTitle(row, readonly) {
    if (readonly) return "查看客服";
    return row ? "编辑客服" : "新建客服";
  }
  function openEditor(row, readonly) {
    var html = editor(row, readonly);
    var title = editorTitle(row, readonly);
    if (window.MCJAdminOverlay) {
      window.MCJAdminOverlay.open({ title: title, html: html, onClose: function () {} });
      return;
    }
    var box = document.querySelector("[data-service-account-editor]");
    if (!box) return;
    box.hidden = false;
    box.innerHTML = html;
    if (window.MCJAdminForms && window.MCJAdminForms.enhance) window.MCJAdminForms.enhance(box);
  }
  function closeEditor() {
    if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
      window.MCJAdminOverlay.close();
      return;
    }
    var box = document.querySelector("[data-service-account-editor]");
    if (box) {
      box.hidden = true;
      box.innerHTML = "";
    }
  }
  function setFormError(form, message) {
    var box = form && form.querySelector("[data-service-account-form-error]");
    if (!box) return;
    if (message) {
      box.hidden = false;
      box.textContent = message;
    } else {
      box.hidden = true;
      box.textContent = "";
    }
  }
  function submit(form) {
    if (state.saving) return;
    var fd = new FormData(form),
      id = form.dataset.editId || "",
      payload = { id: id };
    fd.forEach(function (v, k) {
      payload[k] = String(v || "").trim();
    });
    if (!id && payload.account && !payload.email) payload.email = payload.account;
    if (!id && payload.email && !payload.account) payload.account = payload.email;
    var action = id ? "update" : "create";
    var btn = form.querySelector('[type="submit"]');
    var defaultLabel = "保存客服账号";
    state.saving = true;
    setFormError(form, "");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "保存中...";
    }
    api(action, payload)
      .then(function (res) {
        var msg = res.message || "已保存";
        state.message = msg;
        state.error = "";
        toast(msg, false);
        closeEditor();
        state.saving = false;
        if (state.openPanel !== "accounts") state.openPanel = "accounts";
        return load();
      })
      .catch(function (err) {
        var msg = err.message || "保存失败";
        if (/邮箱已存在|already|exist|registered|duplicate/i.test(msg)) {
          msg = "该邮箱已存在，请更换邮箱。";
        }
        state.saving = false;
        state.error = msg;
        setFormError(form, msg);
        toast(msg, true);
        if (btn) {
          btn.disabled = false;
          btn.textContent = defaultLabel;
        }
      })
      .finally(function () {
        state.saving = false;
        if (btn && document.body.contains(btn)) {
          btn.disabled = false;
          if (btn.textContent === "保存中...") btn.textContent = defaultLabel;
        }
      });
  }
  function resetPassword(id) {
    var password = prompt("请输入新密码（至少 8 位）");
    if (!password) return;
    api("reset_password", { id: id, password: password })
      .then(function (res) {
        state.message = res.message || "密码已重置";
        toast(state.message, false);
        return load();
      })
      .catch(function (err) {
        state.error = err.message;
        toast(err.message, true);
        render();
      });
  }
  function toggle(id, status) {
    api("toggle", { id: id, status: status })
      .then(function (res) {
        state.message = res.message || "状态已更新";
        return load();
      })
      .catch(function (err) {
        state.error = err.message;
        toast(err.message, true);
        render();
      });
  }
  function remove(id) {
    if (!confirm("确认删除该客服账号？删除后该账号无法登录客服端。")) return;
    api("delete", { id: id })
      .then(function (res) {
        state.message = res.message || "客服账号已删除";
        toast(state.message, false);
        return load();
      })
      .catch(function (err) {
        state.error = err.message;
        toast(err.message, true);
        render();
      });
  }
  function exportWageCsv() {
    var headers = ["客服", "底薪", "接待奖励", "订单提成", "夜班补贴", "全勤奖励", "扣款", "其他调整", "实发工资", "状态", "明细"];
    var lines = [headers.join(",")];
    (state.rows || []).forEach(function (row) {
      var d = row.wageDetail || {};
      lines.push(
        [
          row.name || "-",
          money(row.baseSalary),
          money(d.receptionBonus != null ? d.receptionBonus : row.receptionBonus),
          money(row.orderCommission),
          money(d.nightShiftAllowance != null ? d.nightShiftAllowance : row.nightShiftAllowance),
          money(d.attendanceBonus != null ? d.attendanceBonus : row.attendanceBonus),
          money(row.penaltyTotal),
          money(d.otherAdjustment != null ? d.otherAdjustment : row.otherAdjustment),
          money(row.estimatedSalary),
          wageStatusLabel(row),
          d.formula || "",
        ]
          .map(function (v) {
            return '"' + String(v).replace(/"/g, '""') + '"';
          })
          .join(",")
      );
    });
    var blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "客服工资中心-" + currentMonth() + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function exportAttendanceCsv() {
    var history = state.attendanceHistory.length ? state.attendanceHistory : buildLocalAttendanceHistory();
    var headers = ["客服", "日期", "上班时间", "下班时间", "工时", "迟到", "早退", "全勤", "状态"];
    var lines = [headers.join(",")];
    history.forEach(function (h) {
      lines.push(
        [
          h.serviceName || h.name || "-",
          h.date || "-",
          h.clockInText || "-",
          h.clockOutText || "-",
          h.workHours != null ? h.workHours : "-",
          h.isLate ? "是" : "否",
          h.isEarlyLeave ? "是" : "否",
          h.fullAttendance ? "是" : "否",
          h.attendanceStatus || "-",
        ]
          .map(function (v) {
            return '"' + String(v).replace(/"/g, '""') + '"';
          })
          .join(",")
      );
    });
    var blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "客服打卡-" + (state.attendanceMonth || currentMonth()) + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function buildLocalAttendanceHistory() {
    var history = [];
    state.rows.forEach(function (row) {
      (row.attendanceHistory || []).forEach(function (h) {
        history.push({
          serviceName: row.name || "-",
          date: h.date || "-",
          clockInText: h.clockInText || "-",
          clockOutText: h.clockOutText || "-",
          workHours: h.workHours,
          isLate: h.isLate,
          isEarlyLeave: h.isEarlyLeave,
          fullAttendance: h.fullAttendance,
          attendanceStatus: h.attendanceStatus || "-",
        });
      });
    });
    return history;
  }
  function syncFromHash() {
    var next = panelFromHash();
    normalizeSectionHash();
    if (next && next !== state.openPanel) {
      state.openPanel = next;
      render();
      afterPanelOpen(state.openPanel, { fetchAttendance: true });
    }
  }
  document.addEventListener("click", function (e) {
    var panelBtn = e.target.closest("[data-cs-panel]");
    if (panelBtn) {
      e.preventDefault();
      e.stopPropagation();
      var name = panelBtn.dataset.csPanel || "";
      // Accordion: one open at a time; same panel toggles closed.
      if (state.openPanel === name) {
        state.openPanel = "";
        normalizeSectionHash();
        render();
        return;
      }
      state.openPanel = name;
      normalizeSectionHash();
      render();
      afterPanelOpen(name, { fetchAttendance: true });
      return;
    }
    if (e.target.closest("[data-cs-wage-export]")) {
      exportWageCsv();
      return;
    }
    if (e.target.closest("[data-cs-attendance-export]")) {
      exportAttendanceCsv();
      return;
    }
    if (e.target.closest("[data-cs-attendance-refresh]")) {
      loadAttendanceHistory(true);
      return;
    }
    if (e.target.closest("[data-service-account-new]")) {
      openEditor(null, false);
      return;
    }
    var view = e.target.closest("[data-service-account-view]");
    if (view) {
      openEditor(find(view.dataset.serviceAccountView), true);
      return;
    }
    var edit = e.target.closest("[data-service-account-edit]");
    if (edit) {
      openEditor(find(edit.dataset.serviceAccountEdit), false);
      return;
    }
    var reset = e.target.closest("[data-service-account-reset]");
    if (reset) {
      resetPassword(reset.dataset.serviceAccountReset);
      return;
    }
    var tog = e.target.closest("[data-service-account-toggle]");
    if (tog) {
      toggle(tog.dataset.serviceAccountToggle, tog.dataset.nextStatus);
      return;
    }
    var del = e.target.closest("[data-service-account-delete]");
    if (del) {
      remove(del.dataset.serviceAccountDelete);
      return;
    }
    if (e.target.closest("[data-service-account-cancel]")) {
      closeEditor();
      return;
    }
    if (e.target.closest("[data-service-account-refresh]")) {
      load();
      return;
    }
  });
  document.addEventListener("change", function (e) {
    if (e.target.matches("[data-cs-attendance-month]")) {
      state.attendanceMonth = String(e.target.value || "").trim();
      loadAttendanceHistory(true);
    }
  });
  document.addEventListener("submit", function (e) {
    if (e.target.matches("[data-service-account-form]")) {
      e.preventDefault();
      submit(e.target);
    }
    if (e.target.matches("[data-cs-commission-form]")) {
      e.preventDefault();
      saveCsCommission(e.target);
    }
  });
  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-cs-commission-reload]")) {
      loadCsCommission();
    }
  });
  function boot() {
    if (!state.attendanceMonth) state.attendanceMonth = currentMonth();
    // Deep-link once from legacy hashes (#service-commission etc.), then normalize.
    var fromHash = panelFromHash();
    state.openPanel = fromHash || "";
    normalizeSectionHash();
    render();
    if (fromHash) afterPanelOpen(fromHash, { fetchAttendance: true });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
  window.addEventListener("hashchange", syncFromHash);
  document.addEventListener("click", function (e) {
    var btn = e.target.closest('[data-section="service-accounts"], [data-section="service-stats"]');
    if (btn) setTimeout(syncFromHash, 50);
  });
  window.__MCJAdminCsPanel = function (name) {
    setPanel(name, true);
  };
})();
