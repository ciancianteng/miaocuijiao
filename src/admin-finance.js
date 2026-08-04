(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "serviceReportsManagement";
  var state = {
    loading: true,
    error: "",
    message: "",
    tab: "friday",
    withdrawals: [],
    payrolls: [],
    bossRefunds: [],
    pendingPayments: [],
    receipts: [],
    settings: {},
    weeklyRules: {},
    settlementSummary: {},
    filterUid: "",
    filterMonth: "",
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
    return /^(super_admin|finance_admin)$/.test(role());
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
  function tabsHtml() {
    var tabs = [
      ["friday", "周五结算中心"],
      ["refunds", "老板退款"],
      ["withdrawals", "陪玩工资"],
      ["payrolls", "客服工资"],
      ["pending", "待付款单"],
      ["receipts", "收据库"],
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
  function fridayBannerHtml() {
    var rules = state.weeklyRules || {};
    var sum = state.settlementSummary || {};
    return (
      '<div class="admin-sync-note">' +
      "周结：周四 23:59（Asia/Kuala_Lumpur）前 → 本周五发放；截止后 → 下周五。人工银行转账后须上传打款凭证。退款/陪玩工资/客服工资统一周五批次。" +
      "<br>本周五 " +
      esc(rules.thisFriday || sum.thisFriday || "-") +
      " · 待退款 " +
      esc(sum.pendingRefunds || 0) +
      " · 待陪玩 " +
      esc(sum.pendingCompanion || 0) +
      " · 待客服 " +
      esc(sum.pendingCs || 0) +
      " · 待退款额 RM " +
      esc(sum.refundPendingRm || 0) +
      ' <button class="mini-btn" type="button" data-fin-export-settle>导出本月结算 CSV</button>' +
      "</div>"
    );
  }
  function refundsHtml(list) {
    var rows = (list || state.bossRefunds || [])
      .map(function (r) {
        var actions = "";
        if (/approved_for_payout|carried_forward|failed/i.test(String(r.status || ""))) {
          actions +=
            '<button class="mini-btn" type="button" data-fin-refund-batch="' +
            esc(r.id) +
            '">加入本周批次</button> ';
          actions +=
            '<button class="mini-btn" type="button" data-fin-refund-next="' +
            esc(r.id) +
            '">移至下周</button> ';
        }
        if (/approved_for_payout|included_in_batch|processing|failed|carried_forward/i.test(String(r.status || ""))) {
          actions +=
            '<button class="mini-btn primary-lite" type="button" data-fin-refund-paid="' +
            esc(r.id) +
            '">上传凭证/打款完成</button>';
        }
        return (
          "<tr><td>" +
          esc(r.refundNo) +
          "</td><td>" +
          esc(r.bossName) +
          "<br><small>" +
          esc(r.bossUid) +
          "</small></td><td>" +
          esc(r.orderNo) +
          "</td><td>RM " +
          esc(r.amountRm) +
          "</td><td>" +
          esc(r.assignedCsName || "-") +
          "</td><td>" +
          esc(r.settlementDate || "-") +
          "</td><td>" +
          esc(r.statusText) +
          "</td><td>" +
          esc(r.createdAt) +
          "</td><td>" +
          actions +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<div class="table-wrap"><table><thead><tr><th>退款单号</th><th>老板</th><th>订单</th><th>金额</th><th>负责人客服</th><th>预计结算日</th><th>状态</th><th>申请时间</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="9">暂无老板退款</td></tr>') +
      "</tbody></table></div>"
    );
  }
  function withdrawalsHtml() {
    var rows = (state.withdrawals || [])
      .map(function (w) {
        return (
          "<tr><td>" +
          esc(w.withdrawalNo) +
          "</td><td>" +
          esc(w.companionName) +
          "<br><small>" +
          esc(w.companionUid) +
          "</small></td><td>" +
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
          esc(w.statusText) +
          "</td><td>" +
          esc(w.submittedAt) +
          "</td><td>" +
          (w.status === "pending_review" ||
          w.status === "pending_friday" ||
          w.status === "submitted" ||
          w.status === "rolled_over"
            ? '<button class="mini-btn primary-lite" type="button" data-fin-approve-wd="' +
              esc(w.id) +
              '">通过</button> <button class="mini-btn" type="button" data-fin-reject-wd="' +
              esc(w.id) +
              '">拒绝</button>'
            : "") +
          (/approved_pending_pay|paying|paid_pending_receipt|pending_payment|approved|paid/.test(String(w.status || ""))
            ? ' <button class="mini-btn primary-lite" type="button" data-fin-paid-wd="' +
              esc(w.id) +
              '">打款完成</button> <button class="mini-btn" type="button" data-fin-reject-wd="' +
              esc(w.id) +
              '">拒绝</button>'
            : "") +
          (w.paymentAccountId
            ? ' <button class="mini-btn" type="button" data-fin-reveal="' + esc(w.paymentAccountId) + '">查看账号</button>'
            : "") +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<div class="admin-sync-note">陪玩提现与客服工资分开管理。审核通过后进入待付款，必须上传收据后才能完成。</div>' +
      '<div class="table-wrap"><table><thead><tr><th>提现单号</th><th>陪玩</th><th>提现猫粮</th><th>应付 RM</th><th>银行账户</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="8">暂无提现申请</td></tr>') +
      "</tbody></table></div>"
    );
  }
  function payrollsHtml() {
    var rows = (state.payrolls || [])
      .map(function (p) {
        return (
          "<tr><td>" +
          esc(p.payrollNo) +
          "</td><td>" +
          esc(p.staffName) +
          "<br><small>" +
          esc(p.staffUid) +
          "</small></td><td>" +
          esc(p.periodStart) +
          " ~ " +
          esc(p.periodEnd) +
          "</td><td>" +
          esc(p.baseSalaryRm) +
          "</td><td>" +
          esc(p.bonusRm) +
          "</td><td>" +
          esc(p.deductionRm) +
          "</td><td>" +
          esc(p.netSalaryRm) +
          "</td><td>" +
          esc(p.statusText) +
          "</td><td>" +
          (/draft|pending_review/.test(p.status)
            ? '<button class="mini-btn primary-lite" type="button" data-fin-approve-pay="' + esc(p.id) + '">审核通过</button>'
            : "-") +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<div class="admin-section-head compact" style="margin-bottom:10px"><div><p>工资金额由系统/管理员计算确认，客服不能自行填写应付工资。</p></div><button class="mini-btn primary-lite" type="button" data-fin-create-payroll>创建工资单</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>工资单号</th><th>客服</th><th>工资周期</th><th>基础工资</th><th>奖金</th><th>扣款</th><th>实付 RM</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="9">暂无工资单</td></tr>') +
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
            ? '<button class="mini-btn" type="button" data-fin-mark-paying="' + esc(p.id) + '">标记处理中</button> '
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
      '<div class="admin-sync-note">待付款中心：已审核通过但尚未完成转账的项目。禁止无收据标记完成。</div>' +
      '<div class="table-wrap"><table><thead><tr><th>付款类型</th><th>单号</th><th>收款人</th><th>UID</th><th>银行</th><th>应付 RM</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="8">暂无待付款</td></tr>') +
      "</tbody></table></div>"
    );
  }
  function receiptsHtml() {
    var list = state.receipts || [];
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
    var rows = list
      .map(function (r) {
        return (
          "<tr><td>" +
          esc(r.receiptNo) +
          "</td><td>" +
          esc(r.paymentType) +
          "</td><td>" +
          esc(r.paymentNo || r.relatedRecordId) +
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
          '<button class="mini-btn" type="button" data-fin-reconcile="' +
          esc(r.id) +
          '">已对账</button> ' +
          '<button class="mini-btn" type="button" data-fin-archive="' +
          esc(r.id) +
          '">归档</button> ' +
          '<button class="mini-btn" type="button" data-fin-void-receipt="' +
          esc(r.id) +
          '">作废</button>' +
          "</td></tr>"
        );
      })
      .join("");
    return (
      '<div class="admin-section-head compact" style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<input class="mini-input" placeholder="按 UID 筛选" value="' +
      esc(state.filterUid) +
      '" data-fin-filter-uid style="max-width:140px">' +
      '<input class="mini-input" placeholder="月份 2026-07" value="' +
      esc(state.filterMonth) +
      '" data-fin-filter-month style="max-width:140px">' +
      '<button class="mini-btn" type="button" data-fin-apply-filter>筛选</button>' +
      '<button class="mini-btn primary-lite" type="button" data-fin-export>按月导出 Excel</button>' +
      "</div>" +
      '<div class="admin-sync-note">收据库长期保留付款凭证。错误收据只能作废，不能删除历史记录。本模块不自动报税，仅整理财务资料。</div>' +
      '<div class="table-wrap"><table><thead><tr><th>收据编号</th><th>类型</th><th>关联单号</th><th>收款人</th><th>金额 RM</th><th>会计月</th><th>银行流水号</th><th>对账</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="9">暂无收据</td></tr>') +
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
    var body =
      state.tab === "payrolls"
        ? payrollsHtml()
        : state.tab === "pending"
          ? pendingHtml()
          : state.tab === "receipts"
            ? receiptsHtml()
            : state.tab === "refunds"
              ? refundsHtml()
              : state.tab === "friday"
                ? fridayBannerHtml() +
                  "<h4>老板退款（本周）</h4>" +
                  refundsHtml(
                    (state.bossRefunds || []).filter(function (r) {
                      return /pending_review|approved_for_payout|included_in_batch|processing|carried_forward|failed/i.test(
                        String(r.status || "")
                      );
                    })
                  ) +
                  "<h4>陪玩工资（待处理）</h4>" +
                  withdrawalsHtml() +
                  "<h4>客服工资（待处理）</h4>" +
                  payrollsHtml()
                : withdrawalsHtml();
    box.innerHTML =
      '<div class="admin-section-head compact"><div><h3>周五结算中心</h3><p>老板退款 · 陪玩工资 · 客服工资统一周五结算；打款须上传凭证。禁止即时到账。</p></div><button class="mini-btn" type="button" data-fin-reload>刷新</button></div>' +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      (state.tab !== "friday" ? fridayBannerHtml() : "") +
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
        state.bossRefunds = res.bossRefunds || [];
        state.pendingPayments = res.pendingPayments || [];
        state.receipts = res.receipts || [];
        state.settings = res.settings || {};
        state.weeklyRules = res.weeklyRules || {};
        state.settlementSummary = res.settlementSummary || {};
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
  function openReceiptUploader(paymentId, amount) {
    if (!isFinanceRole() && role() !== "admin") {
      /* allow prompt; API enforces finance roles */
    }
    var overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
    overlay.innerHTML =
      '<div style="background:#fff;max-width:480px;width:100%;border-radius:12px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.2)">' +
      "<h3 style=\"margin:0 0 8px\">上传转账收据并确认付款</h3>" +
      '<p style="margin:0 0 12px;color:#666;font-size:13px">必须上传收据并填写银行交易编号后才能完成。应付金额：' +
      esc(amount) +
      " RM</p>" +
      '<label style="display:block;margin-bottom:8px">付款日期<input type="date" data-fr-date required style="width:100%"></label>' +
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
      '<button type="button" class="mini-btn primary-lite" data-fr-submit>确认已付款</button></div></div>';
    document.body.appendChild(overlay);
    var fileData = "";
    var drop = overlay.querySelector("[data-fr-drop]");
    var fileInput = overlay.querySelector("[data-fr-file]");
    var preview = overlay.querySelector("[data-fr-preview]");
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
    overlay.querySelector("[data-fr-cancel]").addEventListener("click", function () {
      overlay.remove();
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.remove();
    });
    overlay.querySelector("[data-fr-submit]").addEventListener("click", function () {
      var paymentDate = overlay.querySelector("[data-fr-date]").value;
      var bankReference = overlay.querySelector("[data-fr-ref]").value.trim();
      var actual = overlay.querySelector("[data-fr-actual]").value;
      var variance = overlay.querySelector("[data-fr-variance]").value.trim();
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
        paymentTime: overlay.querySelector("[data-fr-time]").value || null,
        payerBank: overlay.querySelector("[data-fr-payer-bank]").value || "",
        payerAccountLast4: overlay.querySelector("[data-fr-payer-last4]").value || "",
        bankReference: bankReference,
        actualAmountRm: actual,
        varianceReason: variance,
        financeNote: overlay.querySelector("[data-fr-note]").value || "",
        fileDataUrl: fileData,
      })
        .then(function (res) {
          overlay.remove();
          state.message = res.message || "付款已确认";
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
    });
  }

  function openBossRefundPaidUploader(refundId) {
    var row = (state.bossRefunds || []).find(function (r) {
      return String(r.id) === String(refundId);
    });
    var amount = row ? row.amountRm : "";
    var overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
    overlay.innerHTML =
      '<div style="background:#fff;max-width:480px;width:100%;border-radius:12px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.2)">' +
      '<h3 style="margin:0 0 8px">老板退款 · 上传打款凭证</h3>' +
      '<p style="margin:0 0 12px;color:#666;font-size:13px">必须上传凭证并填写银行参考号后才能标记完成。应付：RM ' +
      esc(amount) +
      "</p>" +
      '<label style="display:block;margin-bottom:8px">实际打款金额 RM<input type="number" step="0.01" data-rf-amount value="' +
      esc(amount) +
      '" style="width:100%"></label>' +
      '<label style="display:block;margin-bottom:8px">银行参考号 / Transaction Reference<input data-rf-ref required style="width:100%"></label>' +
      '<div data-rf-drop style="border:1px dashed #bbb;border-radius:10px;padding:18px;text-align:center;margin:10px 0;cursor:pointer;background:#fafafa"><strong>点击上传打款凭证</strong></div>' +
      '<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-rf-file hidden>' +
      '<div data-rf-preview style="font-size:13px;margin:8px 0"></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
      '<button type="button" class="mini-btn" data-rf-cancel>取消</button>' +
      '<button type="button" class="mini-btn primary-lite" data-rf-submit>二次确认 · 打款完成</button></div></div>';
    document.body.appendChild(overlay);
    var fileData = "";
    var drop = overlay.querySelector("[data-rf-drop]");
    var fileInput = overlay.querySelector("[data-rf-file]");
    drop.addEventListener("click", function () {
      fileInput.click();
    });
    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      readFileAsDataUrl(file).then(function (url) {
        fileData = url;
        overlay.querySelector("[data-rf-preview]").textContent = "已选择：" + file.name;
      });
    });
    overlay.querySelector("[data-rf-cancel]").addEventListener("click", function () {
      overlay.remove();
    });
    overlay.querySelector("[data-rf-submit]").addEventListener("click", function () {
      var ref = overlay.querySelector("[data-rf-ref]").value.trim();
      if (!ref) {
        alert("必须填写银行参考号");
        return;
      }
      if (!fileData) {
        alert("没有上传打款凭证，不允许标记完成");
        return;
      }
      if (!confirm("确认该笔老板退款已银行打款完成？将通知老板并入账（幂等，重复点击不会重复入账）。")) return;
      post("mark_refund_paid", {
        id: refundId,
        bankReference: ref,
        paidAmount: overlay.querySelector("[data-rf-amount]").value,
        receiptDataUrl: fileData,
      })
        .then(function (res) {
          overlay.remove();
          state.message = res.message || "退款打款完成";
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
    });
  }

  function openWithdrawPaidUploader(withdrawalId) {
    var overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px";
    overlay.innerHTML =
      '<div style="background:#fff;max-width:460px;width:100%;border-radius:12px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.2)">' +
      '<h3 style="margin:0 0 8px">上传打款收据/截图并确认完成</h3>' +
      '<p style="margin:0 0 12px;color:#666;font-size:13px">必须上传转账收据或截图后才能标记「打款完成」，陪玩端将同步显示已打款。银行流水号可选填。</p>' +
      '<div data-wp-drop style="border:1px dashed #bbb;border-radius:10px;padding:18px;text-align:center;margin:10px 0;cursor:pointer;background:#fafafa">' +
      "<strong>点击或拖拽上传收据/截图</strong><div style=\"font-size:12px;color:#888;margin-top:6px\">JPG / PNG / WEBP / PDF</div>" +
      '<div data-wp-preview style="margin-top:8px;font-size:13px;color:#333"></div></div>' +
      '<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" data-wp-file hidden>' +
      '<label style="display:block;margin:10px 0 8px">银行流水号 / 备注（可选）<input data-wp-ref style="width:100%"></label>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">' +
      '<button type="button" class="mini-btn" data-wp-cancel>取消</button>' +
      '<button type="button" class="mini-btn primary-lite" data-wp-submit>确认打款完成</button></div></div>';
    document.body.appendChild(overlay);
    var fileData = "";
    var drop = overlay.querySelector("[data-wp-drop]");
    var fileInput = overlay.querySelector("[data-wp-file]");
    var preview = overlay.querySelector("[data-wp-preview]");
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
    overlay.querySelector("[data-wp-cancel]").addEventListener("click", function () {
      overlay.remove();
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.remove();
    });
    overlay.querySelector("[data-wp-submit]").addEventListener("click", function () {
      if (!fileData) {
        alert("必须上传转账收据或截图");
        return;
      }
      if (!confirm("确认标记该提现为「打款完成」？陪玩端将同步显示已打款。")) return;
      post("mark_withdraw_paid", {
        id: withdrawalId,
        receiptDataUrl: fileData,
        bankReference: overlay.querySelector("[data-wp-ref]").value.trim(),
      })
        .then(function (res) {
          overlay.remove();
          state.message = res.message || "打款已确认";
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
    });
  }

  document.addEventListener("click", function (e) {
    if (!target() || !target().contains(e.target) && !e.target.closest("[data-fr-submit]")) {
      /* allow overlay buttons outside target */
    }
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
    var refundBatch = e.target.closest("[data-fin-refund-batch]");
    if (refundBatch) {
      post("add_refund_to_batch", { id: refundBatch.dataset.finRefundBatch })
        .then(function (res) {
          state.message = res.message || "已加入本周批次";
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var refundNext = e.target.closest("[data-fin-refund-next]");
    if (refundNext) {
      if (!confirm("确认将该退款移至下周结算？")) return;
      post("rollover_refund", { id: refundNext.dataset.finRefundNext })
        .then(function (res) {
          state.message = res.message || "已顺延";
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var refundPaid = e.target.closest("[data-fin-refund-paid]");
    if (refundPaid) {
      openBossRefundPaidUploader(refundPaid.dataset.finRefundPaid);
      return;
    }
    var exportSettle = e.target.closest("[data-fin-export-settle]");
    if (exportSettle) {
      var now = new Date();
      post("export_settlement", {
        year: String(now.getFullYear()),
        month: String(now.getMonth() + 1).padStart(2, "0"),
        type: "all",
      })
        .then(function (res) {
          var blob = new Blob(["\ufeff" + (res.csv || "")], { type: "text/csv;charset=utf-8" });
          var a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = (res.fileBase || "MeowCuiJiao_Settlement") + ".csv";
          a.click();
          state.message = "已导出 " + (res.count || 0) + " 笔，合计 RM " + (res.totalRm || 0);
          paint();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var approveWd = e.target.closest("[data-fin-approve-wd]");
    if (approveWd) {
      if (!confirm("确认审核通过？通过后进入待付款，不会直接视为已付款。")) return;
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
      var reason = prompt("驳回原因");
      if (!reason) return;
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
    var paidWd = e.target.closest("[data-fin-paid-wd]");
    if (paidWd) {
      openWithdrawPaidUploader(paidWd.dataset.finPaidWd);
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
    var createPayroll = e.target.closest("[data-fin-create-payroll]");
    if (createPayroll) {
      var staffId = prompt("客服 UID / profiles.id");
      if (!staffId) return;
      var periodStart = prompt("周期开始日期 YYYY-MM-DD", new Date().toISOString().slice(0, 8) + "01");
      var periodEnd = prompt("周期结束日期 YYYY-MM-DD", new Date().toISOString().slice(0, 10));
      var base = prompt("基础工资 RM", "0");
      var bonus = prompt("奖金 RM", "0");
      var deduction = prompt("扣款 RM", "0");
      var bankName = prompt("收款银行（快照）", "") || "";
      var holder = prompt("收款人姓名", "") || "";
      var last4 = prompt("账号后四位", "") || "";
      post("create_payroll", {
        staffId: staffId,
        periodStart: periodStart,
        periodEnd: periodEnd,
        baseSalaryRm: base,
        bonusRm: bonus,
        deductionRm: deduction,
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
    var applyFilter = e.target.closest("[data-fin-apply-filter]");
    if (applyFilter) {
      var uidEl = target() && target().querySelector("[data-fin-filter-uid]");
      var monthEl = target() && target().querySelector("[data-fin-filter-month]");
      state.filterUid = uidEl ? uidEl.value.trim() : "";
      state.filterMonth = monthEl ? monthEl.value.trim() : "";
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
