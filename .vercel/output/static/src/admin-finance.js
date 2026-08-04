(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "serviceReportsManagement";
  var state = {
    loading: true,
    error: "",
    message: "",
    tab: "all",
    withdrawals: [],
    payrolls: [],
    pendingPayments: [],
    receipts: [],
    payoutLogs: [],
    weeklyRules: {},
    payoutRequests: [],
    settings: {},
    filterUid: "",
    filterMonth: "",
    filterQ: "",
    filterAmount: "",
    filterDate: "",
    filterWdNo: "",
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function role() {
    try {
      var u = JSON.parse(localStorage.getItem("adminUser") || sessionStorage.getItem("adminUser") || "{}");
      return u.adminRole || u.role || "admin";
    } catch (e) {
      return "admin";
    }
  }
  function adminId() {
    try {
      var u = JSON.parse(localStorage.getItem("adminUser") || sessionStorage.getItem("adminUser") || "{}");
      return u.id || u.userId || null;
    } catch (e) {
      return null;
    }
  }
  function isFinanceRole() {
    return /^(super_admin|finance_admin|admin)$/.test(role());
  }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ Accept: "application/json", "x-mcj-admin-role": role() }, opts.headers || {});
    return (Auth && Auth.fetch ? Auth.fetch(path, opts) : fetch(path, opts)).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.ok === false) throw new Error(body.message || "请求失败");
        return body;
      });
    });
  }
  function post(action, payload) {
    return api("/api/admin/finance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action: action, adminId: adminId() }, payload || {})),
    });
  }
  function target() {
    return document.getElementById(TARGET);
  }
  function openOverlay(title, html, onReady) {
    if (window.MCJAdminOverlay) {
      window.MCJAdminOverlay.open({ title: title, html: html, onClose: function () {} });
      var body = window.MCJAdminOverlay.getBody();
      if (body && typeof onReady === "function") onReady(body, function () {
        if (window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) window.MCJAdminOverlay.close();
      });
      return;
    }
    var overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
    overlay.innerHTML =
      '<div style="background:#fff;max-width:560px;width:100%;max-height:90vh;overflow:auto;border-radius:12px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.2)">' +
      '<h3 style="margin:0 0 8px">' +
      esc(title) +
      "</h3>" +
      html +
      "</div>";
    document.body.appendChild(overlay);
    function close() {
      overlay.remove();
    }
    if (typeof onReady === "function") onReady(overlay.querySelector("div") || overlay, close);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
  }
  function detailRows(pairs) {
    return (
      '<div style="display:grid;gap:8px;font-size:13px">' +
      pairs
        .map(function (p) {
          return (
            '<div style="display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #f0f0f0;padding:6px 0"><span style="color:#666">' +
            esc(p[0]) +
            "</span><strong style=\"text-align:right;word-break:break-all\">" +
            esc(p[1]) +
            "</strong></div>"
          );
        })
        .join("") +
      "</div>"
    );
  }
  function tabsHtml() {
    var tabs = [
      ["all", "全部"],
      ["withdrawals", "陪玩提现"],
      ["payrolls", "客服工资"],
      ["friday", "本周五待处理"],
      ["reviewing", "审核中"],
      ["pending_pay", "待打款"],
      ["done", "已完成"],
      ["rejected", "已驳回"],
      ["pending", "待付款单"],
      ["receipts", "收据库"],
      ["logs", "打款日志"],
    ];
    return (
      '<div class="admin-final-tabs" style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">' +
      tabs
        .map(function (t) {
          return (
            '<button type="button" class="mini-btn' +
            (state.tab === t[0] ? " primary-lite" : "") +
            '" data-fin-tab="' +
            t[0] +
            '">' +
            t[1] +
            "</button>"
          );
        })
        .join("") +
      "</div>"
    );
  }
  function settleDateOf(row) {
    return String((row && (row.settlementDate || row.settlement_date)) || "").slice(0, 10);
  }
  function thisFridayKey() {
    var rules = state.weeklyRules || {};
    return String(rules.thisFriday || rules.nextSettlementDate || "").slice(0, 10);
  }
  function filterPayoutRows(kind) {
    var wd = state.withdrawals || [];
    var pay = state.payrolls || [];
    var fri = thisFridayKey();
    function isOpenFri(s) {
      return /pending_friday|submitted|pending_review|pending|reviewing|rolled_over|draft/.test(String(s || ""));
    }
    function isReview(s) {
      return /reviewing/.test(String(s || ""));
    }
    function isPay(s) {
      return /approved|pending_payment|approved_pending_pay|paying|paid_pending_receipt|paid/.test(String(s || ""));
    }
    function isDone(s) {
      return /completed/.test(String(s || ""));
    }
    function isRej(s) {
      return /rejected|cancelled|pay_failed/.test(String(s || ""));
    }
    if (kind === "withdrawals") return { withdrawals: wd, payrolls: [] };
    if (kind === "payrolls") return { withdrawals: [], payrolls: pay };
    if (kind === "friday") {
      return {
        withdrawals: wd.filter(function (w) {
          return isOpenFri(w.status) && (!fri || settleDateOf(w) === fri || !settleDateOf(w));
        }),
        payrolls: pay.filter(function (p) {
          return isOpenFri(p.status) && (!fri || settleDateOf(p) === fri || !settleDateOf(p));
        }),
      };
    }
    if (kind === "reviewing") {
      return {
        withdrawals: wd.filter(function (w) {
          return isReview(w.status);
        }),
        payrolls: pay.filter(function (p) {
          return isReview(p.status);
        }),
      };
    }
    if (kind === "pending_pay") {
      return {
        withdrawals: wd.filter(function (w) {
          return isPay(w.status);
        }),
        payrolls: pay.filter(function (p) {
          return isPay(p.status);
        }),
      };
    }
    if (kind === "done") {
      return {
        withdrawals: wd.filter(function (w) {
          return isDone(w.status);
        }),
        payrolls: pay.filter(function (p) {
          return isDone(p.status);
        }),
      };
    }
    if (kind === "rejected") {
      return {
        withdrawals: wd.filter(function (w) {
          return isRej(w.status);
        }),
        payrolls: pay.filter(function (p) {
          return isRej(p.status);
        }),
      };
    }
    return { withdrawals: wd, payrolls: pay };
  }
  function withdrawActions(w) {
    var html =
      '<button class="mini-btn" type="button" data-fin-detail-wd="' + esc(w.id) + '">查看详情</button> ';
    var st = String(w.status || "");
    if (/pending_friday|submitted|pending_review|pending|rolled_over/.test(st)) {
      html +=
        '<button class="mini-btn" type="button" data-fin-start-wd="' +
        esc(w.id) +
        '">开始审核</button> <button class="mini-btn primary-lite" type="button" data-fin-approve-wd="' +
        esc(w.id) +
        '">通过</button> <button class="mini-btn" type="button" data-fin-reject-wd="' +
        esc(w.id) +
        '">驳回</button>';
    }
    if (/reviewing/.test(st)) {
      html +=
        '<button class="mini-btn primary-lite" type="button" data-fin-approve-wd="' +
        esc(w.id) +
        '">通过</button> <button class="mini-btn" type="button" data-fin-reject-wd="' +
        esc(w.id) +
        '">驳回</button>';
    }
    if (/approved|pending_payment|approved_pending_pay|paying|paid_pending_receipt|paid/.test(st)) {
      html +=
        ' <button class="mini-btn primary-lite" type="button" data-fin-paid-wd="' +
        esc(w.id) +
        '">上传凭证/确认已打款</button> <button class="mini-btn" type="button" data-fin-reject-wd="' +
        esc(w.id) +
        '">驳回</button>';
    }
    if (w.status === "completed" && w.bankReference) {
      html += " <small>流水 " + esc(w.bankReference) + "</small>";
    }
    if (w.paymentAccountId) {
      html += ' <button class="mini-btn" type="button" data-fin-reveal="' + esc(w.paymentAccountId) + '">查看账号</button>';
    }
    return html;
  }
  function withdrawalsHtml(list) {
    var rows = (list || state.withdrawals || [])
      .map(function (w) {
        return (
          "<tr><td>" +
          esc(w.withdrawalNo) +
          "</td><td>" +
          esc(w.companionName) +
          (w.companionCode || w.companionUid
            ? "<br><small>" + esc(w.companionCode || w.companionUid) + "</small>"
            : "") +
          "</td><td>" +
          esc(w.catFoodAmount) +
          "</td><td>" +
          esc(w.netAmountRm) +
          "</td><td>" +
          esc(w.bankName) +
          " / " +
          esc(w.accountHolder) +
          " ****" +
          esc(w.accountLast4) +
          "</td><td>" +
          esc(w.settlementDate || "-") +
          "</td><td>" +
          esc(w.statusText) +
          "</td><td>" +
          esc(w.submittedAt) +
          "</td><td>" +
          esc(w.paidByName || w.approvedByName || "-") +
          "</td><td>" +
          withdrawActions(w) +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<div class="admin-sync-note">周结：周四 23:59（Asia/Kuala_Lumpur）前 → 本周五发放；截止后 → 下周五。人工审核 + 线下转账后上传凭证。老板充值/订单支付不在此页。</div>' +
      '<div class="table-wrap"><table><thead><tr><th>提现单号</th><th>陪玩</th><th>提现猫粮</th><th>应付 RM</th><th>银行账户</th><th>预计发放</th><th>状态</th><th>提交时间</th><th>操作管理员</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="10">暂无提现申请</td></tr>') +
      "</tbody></table></div>"
    );
  }
  function payrollActions(p) {
    var html =
      '<button class="mini-btn" type="button" data-fin-detail-pay="' + esc(p.id) + '">查看工资组成</button> ';
    var st = String(p.status || "");
    if (/draft|pending_friday|submitted|pending_review|pending|rolled_over/.test(st)) {
      html +=
        '<button class="mini-btn" type="button" data-fin-start-pay="' +
        esc(p.id) +
        '">开始审核</button> <button class="mini-btn primary-lite" type="button" data-fin-approve-pay="' +
        esc(p.id) +
        '">通过</button> <button class="mini-btn" type="button" data-fin-reject-pay="' +
        esc(p.id) +
        '">驳回</button>';
    }
    if (/reviewing/.test(st)) {
      html +=
        '<button class="mini-btn primary-lite" type="button" data-fin-approve-pay="' +
        esc(p.id) +
        '">通过</button> <button class="mini-btn" type="button" data-fin-reject-pay="' +
        esc(p.id) +
        '">驳回</button>';
    }
    if (/approved|pending_payment|approved_pending_pay|paying|paid_pending_receipt|paid/.test(st)) {
      html +=
        ' <button class="mini-btn primary-lite" type="button" data-fin-paid-pay="' +
        esc(p.id) +
        '" data-amount="' +
        esc(p.netSalaryRm) +
        '">上传凭证/确认已打款</button>';
    }
    return html;
  }
  function payrollsHtml(list) {
    var rows = (list || state.payrolls || [])
      .map(function (p) {
        return (
          "<tr><td>" +
          esc(p.payrollNo) +
          "</td><td>" +
          esc(p.staffName) +
          "</td><td>" +
          esc(p.periodStart) +
          " ~ " +
          esc(p.periodEnd) +
          "</td><td>" +
          esc(p.baseSalaryRm) +
          "</td><td>" +
          esc(p.commissionRm != null ? p.commissionRm : p.bonusRm) +
          "</td><td>" +
          esc(p.catFoodRewardRm || 0) +
          "</td><td>" +
          esc(p.deductionRm) +
          "</td><td>" +
          esc(p.netSalaryRm) +
          "</td><td>" +
          esc(p.settlementDate || "-") +
          "</td><td>" +
          esc(p.statusText) +
          "</td><td>" +
          esc(p.confirmedByName || p.approvedByName || "-") +
          "</td><td>" +
          payrollActions(p) +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<div class="admin-section-head compact" style="margin-bottom:10px"><div><p>客服工资周结：人工审核 + 线下打款。组成含底薪 / 提成 / 猫粮奖励 / 扣款 / 应发金额。</p></div><button class="mini-btn primary-lite" type="button" data-fin-create-payroll>创建工资单</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>工资单号</th><th>客服</th><th>周期</th><th>底薪</th><th>提成</th><th>猫粮奖励</th><th>扣款</th><th>应发 RM</th><th>预计发放</th><th>状态</th><th>操作管理员</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="12">暂无工资单</td></tr>') +
      "</tbody></table></div>"
    );
  }
  function pendingHtml() {
    var rows = (state.pendingPayments || [])
      .map(function (p) {
        return (
          "<tr><td>" +
          esc(p.paymentTypeText) +
          "</td><td>" +
          esc(p.paymentNo) +
          "</td><td>" +
          esc(p.payeeName) +
          "</td><td>" +
          esc(p.payeeUid) +
          "</td><td>" +
          esc(p.payeeBank) +
          " ****" +
          esc(p.payeeAccountLast4) +
          "</td><td>" +
          esc(p.amountRm) +
          "</td><td>" +
          esc(p.statusText) +
          "</td><td>" +
          (p.status === "pending_pay"
            ? '<button class="mini-btn" type="button" data-fin-mark-paying="' + esc(p.id) + '">打款中</button> '
            : "") +
          '<button class="mini-btn primary-lite" type="button" data-fin-pay-receipt="' +
          esc(p.id) +
          '" data-amount="' +
          esc(p.amountRm) +
          '">上传收据并确认</button>' +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<div class="admin-sync-note">待付款：已审核通过但尚未完成转账。禁止无收据标记完成。不含老板充值/订单支付。</div>' +
      '<div class="table-wrap"><table><thead><tr><th>付款类型</th><th>单号</th><th>收款人</th><th>UID</th><th>银行</th><th>应付 RM</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="8">暂无待付款</td></tr>') +
      "</tbody></table></div>"
    );
  }
  function receiptsHtml() {
    var list = state.receipts || [];
    var q = String(state.filterQ || "").trim().toLowerCase();
    var wdNo = String(state.filterWdNo || "").trim().toLowerCase();
    var amount = String(state.filterAmount || "").trim();
    var date = String(state.filterDate || "").trim();
    if (state.filterUid) {
      list = list.filter(function (r) {
        return String(r.payeeUid || "").indexOf(state.filterUid) >= 0;
      });
    }
    if (state.filterMonth) {
      list = list.filter(function (r) {
        return String(r.accountingMonth || "") === state.filterMonth;
      });
    }
    if (q) {
      list = list.filter(function (r) {
        var blob = [r.payeeName, r.payeeUid, r.receiptNo, r.paymentNo, r.relatedRecordId, r.withdrawalNo, r.bankReference]
          .join(" ")
          .toLowerCase();
        return blob.indexOf(q) >= 0;
      });
    }
    if (wdNo) {
      list = list.filter(function (r) {
        return String(r.withdrawalNo || r.relatedRecordId || r.paymentNo || "")
          .toLowerCase()
          .indexOf(wdNo) >= 0;
      });
    }
    if (amount) {
      list = list.filter(function (r) {
        return String(r.amountRm) === amount || String(r.amountRm).indexOf(amount) >= 0;
      });
    }
    if (date) {
      list = list.filter(function (r) {
        return String(r.uploadedAt || "").slice(0, 10) === date || String(r.uploadedAt || "").indexOf(date) >= 0;
      });
    }
    var rows = list
      .map(function (r) {
        return (
          "<tr><td>" +
          esc(r.receiptNo) +
          "</td><td>" +
          esc(r.paymentType) +
          "</td><td>" +
          esc(r.withdrawalNo || r.paymentNo || r.relatedRecordId) +
          "</td><td>" +
          esc(r.payeeName) +
          " / " +
          esc(r.payeeUid) +
          "</td><td>" +
          esc(r.amountRm) +
          "</td><td>" +
          esc(r.accountingMonth) +
          "</td><td>" +
          esc(r.bankReference) +
          "</td><td>" +
          esc(r.reconciliationStatusText) +
          "</td><td>" +
          '<button class="mini-btn" type="button" data-fin-view-receipt="' +
          esc(r.id) +
          '">查看</button> ' +
          '<button class="mini-btn" type="button" data-fin-dl-receipt="' +
          esc(r.id) +
          '">下载</button> ' +
          '<button class="mini-btn" type="button" data-fin-reconcile="' +
          esc(r.id) +
          '">已对账</button> ' +
          '<button class="mini-btn" type="button" data-fin-archive="' +
          esc(r.id) +
          '">归档</button> ' +
          '<button class="mini-btn" type="button" data-fin-void-receipt="' +
          esc(r.id) +
          '">作废</button> ' +
          '<button class="mini-btn" type="button" data-fin-delete-receipt="' +
          esc(r.id) +
          '">删除</button>' +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<div class="admin-section-head compact" style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<input class="mini-input" placeholder="昵称/UID/流水号" value="' +
      esc(state.filterQ) +
      '" data-fin-filter-q style="max-width:150px">' +
      '<input class="mini-input" placeholder="提现编号" value="' +
      esc(state.filterWdNo) +
      '" data-fin-filter-wdno style="max-width:120px">' +
      '<input class="mini-input" placeholder="金额 RM" value="' +
      esc(state.filterAmount) +
      '" data-fin-filter-amount style="max-width:100px">' +
      '<input class="mini-input" type="date" value="' +
      esc(state.filterDate) +
      '" data-fin-filter-date style="max-width:150px">' +
      '<input class="mini-input" placeholder="UID" value="' +
      esc(state.filterUid) +
      '" data-fin-filter-uid style="max-width:120px">' +
      '<input class="mini-input" placeholder="月份 2026-08" value="' +
      esc(state.filterMonth) +
      '" data-fin-filter-month style="max-width:120px">' +
      '<button class="mini-btn" type="button" data-fin-apply-filter>筛选</button>' +
      '<button class="mini-btn primary-lite" type="button" data-fin-upload-library>上传收据</button>' +
      '<button class="mini-btn primary-lite" type="button" data-fin-export>按月导出 Excel</button>' +
      "</div>" +
      '<div class="admin-sync-note">收据库长期保存银行转账截图 / PDF / 图片。可查看、下载、删除、搜索与按日期筛选。删除收据不会改写打款日志。</div>' +
      '<div class="table-wrap"><table><thead><tr><th>收据编号</th><th>类型</th><th>提现/关联单号</th><th>收款人</th><th>金额 RM</th><th>会计月</th><th>交易编号</th><th>对账</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="9">暂无收据</td></tr>') +
      "</tbody></table></div>"
    );
  }
  function logsHtml() {
    var rows = (state.payoutLogs || [])
      .map(function (l) {
        return (
          "<tr><td>" +
          esc(l.logNo) +
          "</td><td>" +
          esc(l.payoutTypeText) +
          "</td><td>" +
          esc(l.payeeName) +
          " / " +
          esc(l.payeeUid) +
          "</td><td>" +
          esc(l.amountRm) +
          "</td><td>" +
          esc(l.bankReference) +
          "</td><td>" +
          esc(l.adminName) +
          " <small>" +
          esc(l.adminRole) +
          "</small></td><td>" +
          esc(l.clientIp || "-") +
          "</td><td>" +
          esc(l.createdAt) +
          "</td><td>" +
          esc(l.notes || "-") +
          "</td><td>" +
          (l.hasReceipt
            ? '<button class="mini-btn" type="button" data-fin-view-log-receipt="' +
              esc(l.receiptPath) +
              '" data-receipt-id="' +
              esc(l.receiptId || "") +
              '">截图</button>'
            : "-") +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<div class="admin-sync-note">打款日志为不可变审计记录：管理员、时间、IP、金额、交易编号、截图路径、备注。不可编辑或删除。</div>' +
      '<div class="table-wrap"><table><thead><tr><th>日志号</th><th>类型</th><th>收款人</th><th>金额 RM</th><th>交易编号</th><th>操作管理员</th><th>IP</th><th>时间</th><th>备注</th><th>截图</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="10">暂无打款日志</td></tr>') +
      "</tbody></table></div>"
    );
  }
  function paint() {
    var box = target();
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="admin-sync-note">正在读取提现与发薪...</div>';
      return;
    }
    if (state.error) {
      box.innerHTML =
        '<div class="admin-sync-note error">' +
        esc(state.error) +
        ' <button class="mini-btn" type="button" data-fin-reload>重试</button></div>';
      return;
    }
    var filtered = filterPayoutRows(state.tab);
    var body =
      state.tab === "pending"
        ? pendingHtml()
        : state.tab === "receipts"
          ? receiptsHtml()
          : state.tab === "logs"
            ? logsHtml()
            : state.tab === "payrolls"
              ? payrollsHtml(filtered.payrolls)
              : state.tab === "withdrawals"
                ? withdrawalsHtml(filtered.withdrawals)
                : withdrawalsHtml(filtered.withdrawals) +
                  (filtered.payrolls && filtered.payrolls.length
                    ? '<div style="margin-top:16px"></div>' + payrollsHtml(filtered.payrolls)
                    : state.tab === "all" ||
                        state.tab === "friday" ||
                        state.tab === "reviewing" ||
                        state.tab === "pending_pay" ||
                        state.tab === "done" ||
                        state.tab === "rejected"
                      ? payrollsHtml(filtered.payrolls)
                      : "");
    var wr = state.weeklyRules || {};
    box.innerHTML =
      '<div class="admin-section-head compact"><div><h3>提现与发放</h3><p>周结：固定发放日星期五；申请截止星期四 ' +
      esc(wr.applicationCutoff ? String(wr.applicationCutoff).replace(/^星期四\s*/, "") : "23:59") +
      "（Asia/Kuala_Lumpur）。本周五 " +
      esc(wr.thisFriday || "-") +
      " / 下周五 " +
      esc(wr.nextFriday || "-") +
      '。老板充值与订单支付不在此列表。</p></div><button class="mini-btn" type="button" data-fin-reload>刷新</button></div>' +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      tabsHtml() +
      body;
  }
  function load() {
    state.loading = true;
    state.error = "";
    paint();
    api("/api/admin/finance?action=bootstrap")
      .then(function (res) {
        state.withdrawals = res.withdrawals || [];
        state.payrolls = res.payrolls || [];
        state.weeklyRules = res.weeklyRules || {};
        state.payoutRequests = res.payoutRequests || [];
        state.pendingPayments = res.pendingPayments || [];
        state.receipts = res.receipts || [];
        state.payoutLogs = res.payoutLogs || [];
        state.settings = res.settings || {};
        state.loading = false;
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || "读取失败";
        paint();
      });
  }
  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error("读取文件失败"));
      };
      reader.readAsDataURL(file);
    });
  }
  function bindReceiptUploaderPanel(root, paymentId, amount, onClose) {
    var fileData = "";
    var drop = root.querySelector("[data-fr-drop]");
    var fileInput = root.querySelector("[data-fr-file]");
    var preview = root.querySelector("[data-fr-preview]");
    function closePanel() {
      if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
        window.MCJAdminOverlay.close();
      } else if (typeof onClose === "function") {
        onClose();
      }
    }
    function setFile(file) {
      if (!file) return;
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/i.test(file.type)) {
        alert("仅支持 JPG/PNG/WEBP/PDF");
        return;
      }
      readFileAsDataUrl(file).then(function (dataUrl) {
        fileData = dataUrl;
        preview.textContent = file.name + "（已就绪，可替换）";
      });
    }
    drop.addEventListener("click", function () {
      fileInput.click();
    });
    drop.addEventListener("dragover", function (e) {
      e.preventDefault();
    });
    drop.addEventListener("drop", function (e) {
      e.preventDefault();
      setFile(e.dataTransfer.files && e.dataTransfer.files[0]);
    });
    fileInput.addEventListener("change", function () {
      setFile(fileInput.files && fileInput.files[0]);
    });
    root.querySelector("[data-fr-cancel]").addEventListener("click", closePanel);
    root.querySelector("[data-fr-submit]").addEventListener("click", function () {
      var paymentDate = root.querySelector("[data-fr-date]").value;
      var bankReference = root.querySelector("[data-fr-ref]").value.trim();
      var actual = root.querySelector("[data-fr-actual]").value;
      var variance = root.querySelector("[data-fr-variance]").value.trim();
      if (!paymentDate || !bankReference) {
        alert("请填写付款日期和银行交易编号");
        return;
      }
      if (!fileData) {
        alert("必须上传转账收据");
        return;
      }
      post("upload_receipt_and_confirm", {
        paymentId: paymentId,
        paymentDate: paymentDate,
        paymentTime: root.querySelector("[data-fr-time]").value || null,
        payerBank: root.querySelector("[data-fr-payer-bank]").value || "",
        payerAccountLast4: root.querySelector("[data-fr-payer-last4]").value || "",
        bankReference: bankReference,
        actualAmountRm: actual,
        varianceReason: variance,
        financeNote: root.querySelector("[data-fr-note]").value || "",
        fileDataUrl: fileData,
      })
        .then(function (res) {
          closePanel();
          state.message = res.message || "付款已确认";
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
    });
  }
  function receiptUploaderHtml(amount) {
    var today = new Date().toISOString().slice(0, 10);
    return (
      '<div class="admin-finance-uploader">' +
      '<p class="admin-sync-note">必须上传收据并填写银行交易编号后才能完成。应付金额：' +
      esc(amount) +
      " RM</p>" +
      '<label style="display:block;margin-bottom:8px">付款日期<input type="date" data-fr-date required value="' +
      esc(today) +
      '" style="width:100%"></label>' +
      '<label style="display:block;margin-bottom:8px">付款时间<input type="time" data-fr-time style="width:100%"></label>' +
      '<label style="display:block;margin-bottom:8px">付款银行<input data-fr-payer-bank style="width:100%"></label>' +
      '<label style="display:block;margin-bottom:8px">公司账户尾号<input data-fr-payer-last4 maxlength="4" style="width:100%"></label>' +
      '<label style="display:block;margin-bottom:8px">银行交易编号 / Reference No.<input data-fr-ref required style="width:100%"></label>' +
      '<label style="display:block;margin-bottom:8px">实际付款金额 RM<input type="number" step="0.01" data-fr-actual value="' +
      esc(amount) +
      '" style="width:100%"></label>' +
      '<label style="display:block;margin-bottom:8px">差异原因（实付≠应付时必填）<input data-fr-variance style="width:100%"></label>' +
      '<label style="display:block;margin-bottom:8px">财务备注<input data-fr-note style="width:100%"></label>' +
      '<div data-fr-drop style="border:1px dashed #bbb;border-radius:10px;padding:18px;text-align:center;margin:10px 0;cursor:pointer;background:#fafafa">' +
      "<strong>点击或拖拽上传收据</strong><div style=\"font-size:12px;color:#888;margin-top:6px\">JPG / PNG / WEBP / PDF</div>" +
      '<div data-fr-preview style="margin-top:8px;font-size:13px;color:#333"></div></div>' +
      '<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-fr-file hidden>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
      '<button type="button" class="mini-btn" data-fr-cancel>取消</button>' +
      '<button type="button" class="mini-btn primary-lite" data-fr-submit>确认已付款</button></div></div>'
    );
  }
  function openReceiptUploader(paymentId, amount) {
    var html = receiptUploaderHtml(amount);
    if (window.MCJAdminOverlay) {
      window.MCJAdminOverlay.open({ title: "上传转账收据并确认付款", html: html, onClose: function () {} });
      var body = window.MCJAdminOverlay.getBody();
      if (body) bindReceiptUploaderPanel(body, paymentId, amount);
      return;
    }
    var overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
    overlay.innerHTML =
      '<div style="background:#fff;max-width:480px;width:100%;border-radius:12px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.2)">' +
      "<h3 style=\"margin:0 0 8px\">上传转账收据并确认付款</h3>" +
      html +
      "</div>";
    document.body.appendChild(overlay);
    bindReceiptUploaderPanel(
      overlay.querySelector(".admin-finance-uploader") || overlay,
      paymentId,
      amount,
      function () {
        overlay.remove();
      }
    );
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.remove();
    });
  }

  function bindWithdrawPaidUploaderPanel(root, withdrawalId, onClose) {
    var fileData = "";
    var drop = root.querySelector("[data-wp-drop]");
    var fileInput = root.querySelector("[data-wp-file]");
    var preview = root.querySelector("[data-wp-preview]");
    function closePanel() {
      if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
        window.MCJAdminOverlay.close();
      } else if (typeof onClose === "function") {
        onClose();
      }
    }
    function setFile(file) {
      if (!file) return;
      if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/i.test(file.type)) {
        alert("仅支持 JPG/PNG/WEBP/PDF");
        return;
      }
      readFileAsDataUrl(file).then(function (dataUrl) {
        fileData = dataUrl;
        preview.textContent = file.name + "（已就绪，可替换）";
      });
    }
    drop.addEventListener("click", function () {
      fileInput.click();
    });
    drop.addEventListener("dragover", function (e) {
      e.preventDefault();
    });
    drop.addEventListener("drop", function (e) {
      e.preventDefault();
      setFile(e.dataTransfer.files && e.dataTransfer.files[0]);
    });
    fileInput.addEventListener("change", function () {
      setFile(fileInput.files && fileInput.files[0]);
    });
    root.querySelector("[data-wp-cancel]").addEventListener("click", closePanel);
    root.querySelector("[data-wp-submit]").addEventListener("click", function () {
      var bankReference = root.querySelector("[data-wp-ref]").value.trim();
      var paidDate = root.querySelector("[data-wp-date]").value;
      if (!fileData) {
        alert("必须上传汇款收据");
        return;
      }
      if (!bankReference) {
        alert("请填写交易编号 / 银行流水号");
        return;
      }
      if (!paidDate) {
        alert("请填写打款时间");
        return;
      }
      if (!confirm("确认已线下打款？提现将变为「已完成」，写入收据库与打款日志，并通知陪玩。")) return;
      post("mark_withdraw_paid", {
        id: withdrawalId,
        receiptDataUrl: fileData,
        bankReference: bankReference,
        paymentRemark: root.querySelector("[data-wp-note]").value.trim(),
        paymentDate: paidDate,
        paymentTime: root.querySelector("[data-wp-time]").value || null,
      })
        .then(function (res) {
          closePanel();
          state.message = res.message || "已确认打款";
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
    });
  }
  function withdrawPaidUploaderHtml() {
    var today = new Date().toISOString().slice(0, 10);
    return (
      '<div class="admin-finance-uploader">' +
      '<p class="admin-sync-note">请先通过银行/TNG 手动汇款，再上传汇款收据并填写交易编号与打款时间。确认后提现变为「已完成」，写入收据库与不可变打款日志，并自动通知陪玩。</p>' +
      '<div data-wp-drop style="border:1px dashed #bbb;border-radius:10px;padding:18px;text-align:center;margin:10px 0;cursor:pointer;background:#fafafa">' +
      "<strong>点击或拖拽上传银行转账截图</strong><div style=\"font-size:12px;color:#888;margin-top:6px\">JPG / PNG / WEBP / PDF</div>" +
      '<div data-wp-preview style="margin-top:8px;font-size:13px;color:#333"></div></div>' +
      '<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-wp-file hidden>' +
      '<label style="display:block;margin:10px 0 8px">交易编号 / Reference No.（必填）<input data-wp-ref required style="width:100%"></label>' +
      '<label style="display:block;margin:10px 0 8px">打款日期（必填）<input type="date" data-wp-date required value="' +
      esc(today) +
      '" style="width:100%"></label>' +
      '<label style="display:block;margin:10px 0 8px">打款时间<input type="time" data-wp-time style="width:100%"></label>' +
      '<label style="display:block;margin:10px 0 8px">备注（可选）<input data-wp-note style="width:100%"></label>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
      '<button type="button" class="mini-btn" data-wp-cancel>取消</button>' +
      '<button type="button" class="mini-btn primary-lite" data-wp-submit>确认已打款</button></div></div>'
    );
  }
  function openWithdrawPaidUploader(withdrawalId) {
    var html = withdrawPaidUploaderHtml();
    if (window.MCJAdminOverlay) {
      window.MCJAdminOverlay.open({ title: "线下汇款确认", html: html, onClose: function () {} });
      var body = window.MCJAdminOverlay.getBody();
      if (body) bindWithdrawPaidUploaderPanel(body, withdrawalId);
      return;
    }
    var overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
    overlay.innerHTML =
      '<div style="background:#fff;max-width:460px;width:100%;border-radius:12px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.2)">' +
      '<h3 style="margin:0 0 8px">线下汇款确认</h3>' +
      html +
      "</div>";
    document.body.appendChild(overlay);
    bindWithdrawPaidUploaderPanel(
      overlay.querySelector(".admin-finance-uploader") || overlay,
      withdrawalId,
      function () {
        overlay.remove();
      }
    );
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.remove();
    });
  }

  function openWithdrawDetail(id) {
    post("view_withdraw_detail", { id: id })
      .then(function (res) {
        var w = res.item || {};
        openOverlay(
          "提现详情 " + (w.withdrawalNo || ""),
          detailRows([
            ["提现单号", w.withdrawalNo],
            ["陪玩", (w.companionName || "") + " / " + (w.companionUid || "")],
            ["提现猫粮", w.catFoodAmount],
            ["应付 RM", w.netAmountRm],
            ["手续费 RM", w.feeRm],
            ["银行", (w.bankName || "") + " / " + (w.accountHolder || "") + " ****" + (w.accountLast4 || "")],
            ["状态", w.statusText],
            ["交易编号", w.bankReference || "-"],
            ["提交时间", w.submittedAt || "-"],
            ["审核时间", w.approvedAt || w.reviewedAt || "-"],
            ["审核管理员", w.approvedByName || "-"],
            ["打款时间", w.paidAt || "-"],
            ["打款管理员", w.paidByName || "-"],
            ["完成时间", w.completedAt || "-"],
            ["驳回原因", w.rejectReason || "-"],
            ["备注", w.paymentRemark || w.remark || "-"],
            ["收据", w.receiptUrl ? "已上传" : "无"],
          ]) +
            '<div style="margin-top:12px;text-align:right"><button type="button" class="mini-btn" data-fin-close-detail>关闭</button></div>',
          function (root, close) {
            var btn = root.querySelector("[data-fin-close-detail]");
            if (btn) btn.addEventListener("click", close);
          }
        );
      })
      .catch(function (err) {
        alert(err.message);
      });
  }

  function openPayrollDetail(id) {
    post("view_payroll_detail", { id: id })
      .then(function (res) {
        var p = res.item || {};
        var b = p.wageBreakdown || {};
        openOverlay(
          "工资组成 " + (p.payrollNo || ""),
          detailRows([
            ["工资单号", p.payrollNo],
            ["客服", (p.staffName || "") + " / " + (p.staffUid || "")],
            ["周期", (p.periodStart || "") + " ~ " + (p.periodEnd || "")],
            ["底薪", b.baseSalaryRm != null ? b.baseSalaryRm : p.baseSalaryRm],
            ["提成", b.commissionRm != null ? b.commissionRm : p.commissionRm],
            ["猫粮奖励", b.catFoodRewardRm != null ? b.catFoodRewardRm : p.catFoodRewardRm],
            ["其他奖金", b.otherBonusRm != null ? b.otherBonusRm : p.otherBonusRm || 0],
            ["扣款", b.deductionRm != null ? b.deductionRm : p.deductionRm],
            ["应发金额", b.netSalaryRm != null ? b.netSalaryRm : p.netSalaryRm],
            ["状态", p.statusText],
            ["交易编号", p.bankReference || "-"],
            ["审核管理员", p.approvedByName || "-"],
            ["打款管理员", p.confirmedByName || "-"],
            ["打款时间", p.paidAt || "-"],
            ["备注", p.note || "-"],
          ]) +
            '<div style="margin-top:12px;text-align:right"><button type="button" class="mini-btn" data-fin-close-detail>关闭</button></div>',
          function (root, close) {
            var btn = root.querySelector("[data-fin-close-detail]");
            if (btn) btn.addEventListener("click", close);
          }
        );
      })
      .catch(function (err) {
        alert(err.message);
      });
  }

  function resolvePayrollPaymentThenUpload(payrollId, amount) {
    var pending = (state.pendingPayments || []).find(function (p) {
      return p.relatedRecordId === payrollId || String(p.paymentNo || "").indexOf(payrollId) >= 0;
    });
    if (pending) {
      openReceiptUploader(pending.id, amount || pending.amountRm);
      return;
    }
    post("mark_paying", { payrollId: payrollId })
      .then(function () {
        return api("/api/admin/finance?action=bootstrap");
      })
      .then(function (res) {
        state.pendingPayments = res.pendingPayments || [];
        var pay = (state.pendingPayments || []).find(function (p) {
          return p.relatedRecordId === payrollId;
        });
        if (!pay) throw new Error("未找到工资付款单，请刷新后重试");
        openReceiptUploader(pay.id, amount || pay.amountRm);
      })
      .catch(function (err) {
        alert(err.message);
      });
  }

  function openLibraryUploader() {
    var html =
      '<div class="admin-finance-uploader">' +
      '<label style="display:block;margin-bottom:8px">金额 RM<input type="number" step="0.01" data-lib-amount style="width:100%"></label>' +
      '<label style="display:block;margin-bottom:8px">交易编号<input data-lib-ref style="width:100%"></label>' +
      '<label style="display:block;margin-bottom:8px">备注<input data-lib-note style="width:100%"></label>' +
      '<div data-lib-drop style="border:1px dashed #bbb;border-radius:10px;padding:18px;text-align:center;margin:10px 0;cursor:pointer;background:#fafafa"><strong>上传截图/PDF</strong><div data-lib-preview style="margin-top:8px"></div></div>' +
      '<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-lib-file hidden>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="mini-btn" data-lib-cancel>取消</button><button type="button" class="mini-btn primary-lite" data-lib-submit>上传</button></div></div>';
    openOverlay("上传到收据库", html, function (root, close) {
      var fileData = "";
      var drop = root.querySelector("[data-lib-drop]");
      var fileInput = root.querySelector("[data-lib-file]");
      var preview = root.querySelector("[data-lib-preview]");
      function setFile(file) {
        if (!file) return;
        if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/i.test(file.type)) {
          alert("仅支持 JPG/PNG/WEBP/PDF");
          return;
        }
        readFileAsDataUrl(file).then(function (url) {
          fileData = url;
          preview.textContent = file.name;
        });
      }
      drop.addEventListener("click", function () {
        fileInput.click();
      });
      fileInput.addEventListener("change", function () {
        setFile(fileInput.files && fileInput.files[0]);
      });
      root.querySelector("[data-lib-cancel]").addEventListener("click", close);
      root.querySelector("[data-lib-submit]").addEventListener("click", function () {
        if (!fileData) {
          alert("请上传文件");
          return;
        }
        post("upload_library_receipt", {
          fileDataUrl: fileData,
          amountRm: root.querySelector("[data-lib-amount]").value,
          bankReference: root.querySelector("[data-lib-ref]").value,
          notes: root.querySelector("[data-lib-note]").value,
        })
          .then(function (res) {
            close();
            state.message = res.message || "已上传";
            state.tab = "receipts";
            load();
          })
          .catch(function (err) {
            alert(err.message);
          });
      });
    });
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-fin-reload]")) {
      load();
      return;
    }
    var tab = e.target.closest("[data-fin-tab]");
    if (tab && target() && target().contains(tab)) {
      state.tab = tab.dataset.finTab;
      paint();
      return;
    }
    var detailWd = e.target.closest("[data-fin-detail-wd]");
    if (detailWd) {
      openWithdrawDetail(detailWd.dataset.finDetailWd);
      return;
    }
    var detailPay = e.target.closest("[data-fin-detail-pay]");
    if (detailPay) {
      openPayrollDetail(detailPay.dataset.finDetailPay);
      return;
    }
    var startWd = e.target.closest("[data-fin-start-wd]");
    if (startWd) {
      post("start_review_withdraw", { id: startWd.dataset.finStartWd })
        .then(function (res) {
          state.message = res.message;
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var approveWd = e.target.closest("[data-fin-approve-wd]");
    if (approveWd) {
      if (!confirm("确认审核通过？通过后进入「审核通过待打款」，需线下汇款并上传收据后才能完成。不会自动打款。")) return;
      post("approve_withdraw", { id: approveWd.dataset.finApproveWd })
        .then(function (res) {
          state.message = res.message;
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var rejectWd = e.target.closest("[data-fin-reject-wd]");
    if (rejectWd) {
      var reason = prompt("驳回原因（必填）");
      if (!reason || !String(reason).trim()) {
        alert("驳回原因必填");
        return;
      }
      post("reject_withdraw", { id: rejectWd.dataset.finRejectWd, reason: reason })
        .then(function (res) {
          state.message = res.message;
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var payingWd = e.target.closest("[data-fin-paying-wd]");
    if (payingWd) {
      post("mark_paying", { withdrawalId: payingWd.dataset.finPayingWd })
        .then(function (res) {
          state.message = res.message;
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var paidWd = e.target.closest("[data-fin-paid-wd]");
    if (paidWd) {
      openWithdrawPaidUploader(paidWd.dataset.finPaidWd);
      return;
    }
    var startPay = e.target.closest("[data-fin-start-pay]");
    if (startPay) {
      post("start_review_payroll", { id: startPay.dataset.finStartPay })
        .then(function (res) {
          state.message = res.message;
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var approvePay = e.target.closest("[data-fin-approve-pay]");
    if (approvePay) {
      if (!confirm("确认通过该工资单并进入待付款？")) return;
      post("approve_payroll", { id: approvePay.dataset.finApprovePay })
        .then(function (res) {
          state.message = res.message;
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var rejectPay = e.target.closest("[data-fin-reject-pay]");
    if (rejectPay) {
      var payReason = prompt("驳回原因（必填）");
      if (!payReason || !String(payReason).trim()) {
        alert("驳回原因必填");
        return;
      }
      post("reject_payroll", { id: rejectPay.dataset.finRejectPay, reason: payReason })
        .then(function (res) {
          state.message = res.message;
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var payingPay = e.target.closest("[data-fin-paying-pay]");
    if (payingPay) {
      post("mark_paying", { payrollId: payingPay.dataset.finPayingPay })
        .then(function (res) {
          state.message = res.message;
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var paidPay = e.target.closest("[data-fin-paid-pay]");
    if (paidPay) {
      resolvePayrollPaymentThenUpload(paidPay.dataset.finPaidPay, paidPay.dataset.amount);
      return;
    }
    var createPayroll = e.target.closest("[data-fin-create-payroll]");
    if (createPayroll) {
      var staffId = prompt("客服姓名或账号（管理员已填写的显示名）");
      if (!staffId) return;
      var periodStart = prompt("周期开始日期 YYYY-MM-DD", new Date().toISOString().slice(0, 8) + "01");
      var periodEnd = prompt("周期结束日期 YYYY-MM-DD", new Date().toISOString().slice(0, 10));
      var base = prompt("底薪 RM（可留空自动读取）", "");
      var bonus = prompt("奖金/提成合计 RM（可留空）", "");
      var deduction = prompt("扣款 RM（可留空）", "");
      var bankName = prompt("收款银行（快照）", "") || "";
      var holder = prompt("收款人姓名", "") || "";
      var last4 = prompt("账号后四位", "") || "";
      post("create_payroll", {
        staffId: staffId,
        periodStart: periodStart,
        periodEnd: periodEnd,
        baseSalaryRm: base || 0,
        bonusRm: bonus || 0,
        deductionRm: deduction || 0,
        fromAttendance: true,
        paymentAccount: { bank_name: bankName, account_holder: holder, account_last4: last4 },
      })
        .then(function (res) {
          state.message = res.message;
          state.tab = "payrolls";
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var markPaying = e.target.closest("[data-fin-mark-paying]");
    if (markPaying) {
      post("mark_paying", { paymentId: markPaying.dataset.finMarkPaying })
        .then(function (res) {
          state.message = res.message;
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var payReceipt = e.target.closest("[data-fin-pay-receipt]");
    if (payReceipt) {
      openReceiptUploader(payReceipt.dataset.finPayReceipt, payReceipt.dataset.amount);
      return;
    }
    var reveal = e.target.closest("[data-fin-reveal]");
    if (reveal) {
      post("reveal_account", { paymentAccountId: reveal.dataset.finReveal, reason: "财务查看完整银行账号" })
        .then(function (res) {
          var a = res.account || {};
          alert(
            "银行：" +
              (a.bankName || "") +
              "\n户名：" +
              (a.accountHolder || "") +
              "\n账号：" +
              (a.accountNumber || "") +
              "\n（已写入操作日志）"
          );
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var viewR = e.target.closest("[data-fin-view-receipt]");
    if (viewR) {
      post("receipt_signed_url", { id: viewR.dataset.finViewReceipt })
        .then(function (res) {
          if (res.url) window.open(res.url, "_blank");
          else alert("无法生成查看链接");
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var dlR = e.target.closest("[data-fin-dl-receipt]");
    if (dlR) {
      post("receipt_signed_url", { id: dlR.dataset.finDlReceipt })
        .then(function (res) {
          if (!res.url) {
            alert("无法生成下载链接");
            return;
          }
          var a = document.createElement("a");
          a.href = res.url;
          a.target = "_blank";
          a.download = "receipt-" + dlR.dataset.finDlReceipt;
          a.click();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var viewLogR = e.target.closest("[data-fin-view-log-receipt]");
    if (viewLogR) {
      var rid = viewLogR.dataset.receiptId;
      if (rid) {
        post("receipt_signed_url", { id: rid })
          .then(function (res) {
            if (res.url) window.open(res.url, "_blank");
            else alert("无法打开截图");
          })
          .catch(function (err) {
            alert(err.message);
          });
      } else {
        alert("日志截图路径：" + (viewLogR.dataset.finViewLogReceipt || ""));
      }
      return;
    }
    var recon = e.target.closest("[data-fin-reconcile]");
    if (recon) {
      post("mark_receipt", { id: recon.dataset.finReconcile, reconciliationStatus: "reconciled" })
        .then(function (res) {
          state.message = res.message;
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var arch = e.target.closest("[data-fin-archive]");
    if (arch) {
      post("mark_receipt", { id: arch.dataset.finArchive, reconciliationStatus: "archived" })
        .then(function (res) {
          state.message = res.message;
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var voidR = e.target.closest("[data-fin-void-receipt]");
    if (voidR) {
      var voidReason = prompt("作废原因（必填）");
      if (!voidReason) return;
      post("mark_receipt", { id: voidR.dataset.finVoidReceipt, reconciliationStatus: "void", voidReason: voidReason })
        .then(function (res) {
          state.message = res.message;
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var delR = e.target.closest("[data-fin-delete-receipt]");
    if (delR) {
      if (!confirm("确认删除该收据文件与记录？打款日志不会被删除。")) return;
      var delReason = prompt("删除原因（可选）", "收据库删除") || "收据库删除";
      post("delete_receipt", { id: delR.dataset.finDeleteReceipt, reason: delReason })
        .then(function (res) {
          state.message = res.message;
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var uploadLib = e.target.closest("[data-fin-upload-library]");
    if (uploadLib) {
      openLibraryUploader();
      return;
    }
    var applyFilter = e.target.closest("[data-fin-apply-filter]");
    if (applyFilter) {
      var uidEl = target() && target().querySelector("[data-fin-filter-uid]");
      var monthEl = target() && target().querySelector("[data-fin-filter-month]");
      var qEl = target() && target().querySelector("[data-fin-filter-q]");
      var wdEl = target() && target().querySelector("[data-fin-filter-wdno]");
      var amtEl = target() && target().querySelector("[data-fin-filter-amount]");
      var dateEl = target() && target().querySelector("[data-fin-filter-date]");
      state.filterUid = uidEl ? uidEl.value.trim() : "";
      state.filterMonth = monthEl ? monthEl.value.trim() : "";
      state.filterQ = qEl ? qEl.value.trim() : "";
      state.filterWdNo = wdEl ? wdEl.value.trim() : "";
      state.filterAmount = amtEl ? amtEl.value.trim() : "";
      state.filterDate = dateEl ? dateEl.value.trim() : "";
      paint();
      return;
    }
    var exportBtn = e.target.closest("[data-fin-export]");
    if (exportBtn) {
      var month =
        (target() && target().querySelector("[data-fin-filter-month]") && target().querySelector("[data-fin-filter-month]").value.trim()) ||
        prompt("导出月份 YYYY-MM", new Date().toISOString().slice(0, 7));
      if (!month) return;
      post("export_month", { month: month })
        .then(function (res) {
          var blob = new Blob(["\ufeff" + (res.csv || "")], { type: "text/csv;charset=utf-8" });
          var a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "finance-receipts-" + month + ".csv";
          a.click();
          state.message = "已导出 " + (res.count || 0) + " 条，合计 RM " + (res.totalRm || 0);
          paint();
        })
        .catch(function (err) {
          alert(err.message);
        });
    }
  });

  window.MCJAdminFinance = { reload: load };
  document.addEventListener("DOMContentLoaded", function () {
    if (!target()) return;
    load();
  });
})();
