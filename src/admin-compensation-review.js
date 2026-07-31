(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "compensationReviewMount";
  var state = { loading: true, error: "", items: [], message: "" };

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
  function typeText(t) {
    return (
      {
        after_sale: "售后补偿",
        bad_review: "差评安抚",
        activity: "活动奖励",
        invite: "邀请奖励",
        manual: "人工调整",
        other: "其他",
      }[t] ||
      t ||
      "-"
    );
  }
  function paint() {
    var box = target();
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="admin-sync-note">正在读取补偿申请...</div>';
      return;
    }
    if (state.error) {
      box.innerHTML = '<div class="admin-sync-note error">' + esc(state.error) + ' <button class="mini-btn" type="button" data-cp-reload>重试</button></div>';
      return;
    }
    var rows = (state.items || [])
      .map(function (item) {
        var pending = item.status === "pending";
        return (
          "<tr><td>" +
          esc(item.id) +
          "</td><td>" +
          esc(item.boss_id) +
          "</td><td>" +
          esc(typeText(item.request_type)) +
          "</td><td>" +
          esc(item.suggested_amount) +
          "</td><td>" +
          esc(item.reason) +
          "</td><td>" +
          esc(item.status) +
          "</td><td>" +
          (pending
            ? '<button class="mini-btn primary-lite" type="button" data-cp-approve="' +
              esc(item.id) +
              '" data-amount="' +
              esc(item.suggested_amount) +
              '">通过</button> <button class="mini-btn" type="button" data-cp-reject="' +
              esc(item.id) +
              '">驳回</button>'
            : "-") +
          "</td></tr>"
        );
      })
      .join("");
    box.innerHTML =
      '<div class="admin-section-head compact"><div><h3>补偿审核</h3><p>客服提交后，管理员审核通过才会真正入账赠送猫粮。</p></div><button class="mini-btn" type="button" data-cp-reload>刷新</button></div>' +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      '<div class="table-wrap"><table><thead><tr><th>申请ID</th><th>老板</th><th>类型</th><th>建议数量</th><th>原因</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="7">暂无补偿申请</td></tr>') +
      "</tbody></table></div>";
  }
  function load() {
    state.loading = true;
    state.error = "";
    paint();
    api("/api/admin/wallet?action=compensations")
      .then(function (res) {
        state.items = res.items || [];
        state.loading = false;
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || "读取失败";
        paint();
      });
  }
  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-cp-reload]")) {
      load();
      return;
    }
    var approve = e.target.closest("[data-cp-approve]");
    if (approve) {
      var amount = prompt("确认发放数量（可修改）", approve.dataset.amount || "");
      if (amount == null) return;
      var note = prompt("审核备注（可选）", "") || "";
      if (!confirm("确认审核通过并入账 " + amount + " 赠送猫粮？")) return;
      api("/api/admin/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "review_compensation", id: approve.dataset.cpApprove, decision: "approve", approvedAmount: Number(amount), reviewNote: note }),
      })
        .then(function (res) {
          state.message = res.message || "已通过";
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
      return;
    }
    var reject = e.target.closest("[data-cp-reject]");
    if (reject) {
      var note2 = prompt("驳回原因", "");
      if (note2 == null) return;
      api("/api/admin/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "review_compensation", id: reject.dataset.cpReject, decision: "reject", reviewNote: note2 }),
      })
        .then(function (res) {
          state.message = res.message || "已驳回";
          load();
        })
        .catch(function (err) {
          alert(err.message);
        });
    }
  });
  document.addEventListener("DOMContentLoaded", load);
  window.MCJAdminCompensationReload = load;
})();
