(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "giftFinanceManagement";
  var state = {
    loading: true,
    error: "",
    tab: "gifts",
    summary: null,
    transactions: [],
    recharges: [],
    companions: [],
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function role() {
    try {
      return JSON.parse(localStorage.getItem("adminUser") || sessionStorage.getItem("adminUser") || "{}").adminRole || "admin";
    } catch (e) {
      return "admin";
    }
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
  function target() {
    return document.getElementById(TARGET);
  }
  function downloadCsv(filename, csv) {
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename || "export.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  function paint() {
    var box = target();
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="admin-sync-note">正在读取礼物财务报表...</div>';
      return;
    }
    if (state.error) {
      box.innerHTML =
        '<div class="admin-sync-note">' +
        esc(state.error) +
        ' <button class="mini-btn" type="button" data-gf-reload>重试</button></div>';
      return;
    }
    var s = state.summary || {};
    var gs = s.giftSummary || {};
    var tabs =
      '<div class="admin-tabs" style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">' +
      [
        ["gifts", "礼物流水"],
        ["recharge", "充值记录"],
        ["earnings", "陪玩礼物收益"],
      ]
        .map(function (t) {
          return (
            '<button class="mini-btn' +
            (state.tab === t[0] ? " primary-lite" : "") +
            '" type="button" data-gf-tab="' +
            t[0] +
            '">' +
            t[1] +
            "</button>"
          );
        })
        .join("") +
      "</div>";
    var metrics =
      '<div class="panel-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:12px">' +
      [
        ["礼物累计陪玩到账", gs.totalGiftEarnings],
        ["今日礼物到账", gs.dailyEarnings],
        ["本月礼物到账", gs.monthlyEarnings],
        ["礼物流水笔数", gs.transactionCount],
        ["充值单数", s.rechargeCount],
        ["已确认充值", s.rechargePaidCount],
      ]
        .map(function (m) {
          return (
            '<div class="admin-sync-note" style="margin:0"><strong style="display:block;font-size:18px">' +
            esc(m[1] != null ? m[1] : 0) +
            "</strong><span>" +
            esc(m[0]) +
            "</span></div>"
          );
        })
        .join("") +
      "</div>";

    var body = "";
    if (state.tab === "recharge") {
      body =
        '<div style="margin-bottom:8px"><button class="mini-btn" type="button" data-gf-export="recharge">导出充值 CSV</button></div>' +
        '<div class="table-wrap"><table><thead><tr><th>单号</th><th>时间</th><th>老板</th><th>金额RM</th><th>猫粮</th><th>赠送</th><th>状态</th><th>方式</th></tr></thead><tbody>' +
        ((state.recharges || [])
          .map(function (r) {
            return (
              "<tr><td>" +
              esc(r.paymentNo) +
              "</td><td>" +
              esc(r.createdAt) +
              "</td><td>" +
              esc(r.bossId) +
              "</td><td>" +
              esc(r.amountRm) +
              "</td><td>" +
              esc(r.catFood) +
              "</td><td>" +
              esc(r.bonusCatFood) +
              "</td><td>" +
              esc(r.status) +
              "</td><td>" +
              esc(r.method) +
              "</td></tr>"
            );
          })
          .join("") || '<tr><td colspan="8">暂无充值记录</td></tr>') +
        "</tbody></table></div>";
    } else if (state.tab === "earnings") {
      body =
        '<div style="margin-bottom:8px"><button class="mini-btn" type="button" data-gf-export="earnings">导出陪玩收益 CSV</button></div>' +
        '<div class="table-wrap"><table><thead><tr><th>陪玩ID</th><th>昵称</th><th>笔数</th><th>总额</th><th>到账</th><th>抽成</th></tr></thead><tbody>' +
        ((state.companions || [])
          .map(function (c) {
            return (
              "<tr><td>" +
              esc(c.companionCode || c.companionId) +
              "</td><td>" +
              esc(c.companionName) +
              "</td><td>" +
              esc(c.transactionCount) +
              "</td><td>" +
              esc(c.totalGross) +
              "</td><td>" +
              esc(c.totalIncome) +
              "</td><td>" +
              esc(c.totalCommission) +
              "</td></tr>"
            );
          })
          .join("") || '<tr><td colspan="6">暂无礼物收益</td></tr>') +
        "</tbody></table></div>";
    } else {
      body =
        '<div style="margin-bottom:8px"><button class="mini-btn" type="button" data-gf-export="gifts">导出礼物流水 CSV</button></div>' +
        '<div class="table-wrap"><table><thead><tr><th>时间</th><th>交易号</th><th>发送方</th><th>陪玩</th><th>礼物</th><th>数量</th><th>价值</th><th>到账</th><th>来源</th></tr></thead><tbody>' +
        ((state.transactions || [])
          .map(function (t) {
            return (
              "<tr><td>" +
              esc(t.createdAt) +
              "</td><td>" +
              esc(t.transactionId) +
              "</td><td>" +
              esc(t.senderCode || t.senderName || t.senderBossId) +
              "</td><td>" +
              esc(t.companionCode || t.companionName || t.companionId) +
              "</td><td>" +
              esc(t.giftName) +
              "</td><td>" +
              esc(t.quantity) +
              "</td><td>" +
              esc(t.value) +
              "</td><td>" +
              esc(t.companionIncome) +
              "</td><td>" +
              esc(t.sourceChannel) +
              "</td></tr>"
            );
          })
          .join("") || '<tr><td colspan="9">暂无礼物流水</td></tr>') +
        "</tbody></table></div>";
    }

    box.innerHTML =
      '<div class="admin-section-head compact"><div><h3>礼物 / 打赏财务报告</h3><p>充值确认到账后的 paid 余额才可赠送礼物。以下报表可导出会计核对。</p></div>' +
      '<button class="mini-btn" type="button" data-gf-reload>刷新</button></div>' +
      metrics +
      tabs +
      body;
  }
  function loadTabData() {
    if (state.tab === "recharge") {
      return api("/api/admin/gift-finance?action=recharge_records&limit=300").then(function (res) {
        state.recharges = res.recharges || [];
      });
    }
    if (state.tab === "earnings") {
      return api("/api/admin/gift-finance?action=companion_earnings&limit=500").then(function (res) {
        state.companions = res.companions || [];
      });
    }
    return api("/api/admin/gift-finance?action=gift_transactions&limit=300").then(function (res) {
      state.transactions = res.transactions || [];
    });
  }
  function load() {
    state.loading = true;
    paint();
    api("/api/admin/gift-finance?action=summary")
      .then(function (res) {
        state.summary = res;
        return loadTabData();
      })
      .then(function () {
        state.loading = false;
        state.error = "";
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || "加载失败";
        paint();
      });
  }
  document.addEventListener("click", function (e) {
    if (!target() || !target().contains(e.target)) return;
    if (e.target.closest("[data-gf-reload]")) return load();
    var tab = e.target.closest("[data-gf-tab]");
    if (tab) {
      state.tab = tab.getAttribute("data-gf-tab");
      state.loading = true;
      paint();
      loadTabData()
        .then(function () {
          state.loading = false;
          paint();
        })
        .catch(function (err) {
          state.loading = false;
          state.error = err.message;
          paint();
        });
      return;
    }
    var exp = e.target.closest("[data-gf-export]");
    if (exp) {
      var kind = exp.getAttribute("data-gf-export");
      var action =
        kind === "recharge"
          ? "export_recharge_records"
          : kind === "earnings"
            ? "export_companion_earnings"
            : "export_gift_transactions";
      api("/api/admin/gift-finance?action=" + action + "&limit=1000")
        .then(function (res) {
          downloadCsv(res.filename || "export.csv", res.csv || "");
        })
        .catch(function (err) {
          alert(err.message || "导出失败");
        });
    }
  });
  document.addEventListener("DOMContentLoaded", function () {
    if (target()) load();
  });
})();
