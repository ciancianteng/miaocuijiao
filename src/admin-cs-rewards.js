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

  function mount() {
    var host = document.getElementById("serviceAccountManagement");
    if (!host || !host.parentNode) return null;
    // Prefer the single mount inside 客服账号 accordion; remove orphan duplicates.
    var boxes = Array.prototype.slice.call(document.querySelectorAll("#csDockRewardMount"));
    var inner = host.querySelector("#csDockRewardMount");
    boxes.forEach(function (node) {
      if (inner && node !== inner) {
        try { node.remove(); } catch (e) {}
      }
    });
    var box = inner || document.getElementById("csDockRewardMount");
    if (!box) {
      box = document.createElement("div");
      box.id = "csDockRewardMount";
      box.style.marginTop = "24px";
      // Only create when accounts panel is open (inner placeholder missing).
      var accBody = host.querySelector('.cs-acc-item[data-cs-acc="accounts"] .cs-acc-body');
      if (accBody) accBody.appendChild(box);
      else {
        if (host.nextSibling) host.parentNode.insertBefore(box, host.nextSibling);
        else host.parentNode.appendChild(box);
      }
    }
    return box;
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

  function recordsTable() {
    var rows = state.records || [];
    var body = !rows.length
      ? '<tr><td colspan="11"><div class="empty">暂无客服奖励记录</div></td></tr>'
      : rows
          .map(function (r) {
            return (
              "<tr>" +
              "<td>" +
              esc(r.serviceName || "-") +
              "</td>" +
              "<td>" +
              esc(r.bossName || "-") +
              "</td>" +
              "<td>" +
              esc(r.orderNo || "-") +
              "</td>" +
              "<td>" +
              esc(r.conversationId || "-") +
              "</td>" +
              "<td>" +
              esc(r.orderAmount != null ? r.orderAmount : "-") +
              "</td>" +
              "<td>" +
              esc(r.amount != null ? r.amount : "-") +
              "</td>" +
              "<td>" +
              esc(r.statusText || r.status || "-") +
              "</td>" +
              "<td>" +
              esc(fmtTime(r.settledAt)) +
              "</td>" +
              "<td>" +
              esc(r.refunded || r.clawed ? "是" : "否") +
              "</td>" +
              "<td>" +
              esc(r.clawed ? "是" : "否") +
              "</td>" +
              "<td>" +
              esc(r.clawbackReason || r.cancelReason || r.source || "-") +
              "</td>" +
              "</tr>"
            );
          })
          .join("");
    return (
      '<div class="table-wrap service-account-table-wrap"><table class="service-account-table"><thead><tr>' +
      "<th>客服名称</th><th>老板</th><th>订单编号</th><th>会话编号</th><th>订单金额</th><th>奖励猫粮</th><th>结算状态</th><th>结算时间</th><th>是否退款</th><th>是否扣回</th><th>备注</th>" +
      "</tr></thead><tbody>" +
      body +
      "</tbody></table></div>"
    );
  }

  function render() {
    var box = mount();
    if (!box) return;
    var s = state.settings || {};
    box.innerHTML =
      '<section class="service-account-admin" data-cs-dock-reward-admin>' +
      (state.error ? '<div class="admin-sync-note error">' + esc(state.error) + "</div>" : "") +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      settingsForm(s) +
      '<header class="service-account-head" style="margin-top:22px"><div><h3>客服奖励记录</h3><p>每条记录绑定唯一订单；同一订单不可重复结算。</p></div></header>' +
      '<div class="service-record-toolbar" style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px">' +
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
      '<input data-cs-reward-filter-service placeholder="按客服 UUID 筛选" value="' +
      esc(state.filterServiceId) +
      '">' +
      '<button class="mini-btn primary-lite" type="button" data-cs-reward-filter-apply>筛选</button>' +
      '<button class="mini-btn" type="button" data-cs-reward-reload>刷新记录</button>' +
      "</div>" +
      (state.loading ? '<div class="empty">加载中...</div>' : recordsTable()) +
      "</section>";
  }

  function loadAll() {
    state.loading = true;
    state.error = "";
    render();
    Promise.all([api("settings", {}, "GET"), api("records", {}, "GET")])
      .then(function (pair) {
        state.settings = (pair[0] && pair[0].settings) || null;
        var raw = (pair[1] && pair[1].records) || [];
        var seen = Object.create(null);
        state.records = raw.filter(function (r) {
          var key = String((r && (r.orderId || r.order_id || r.id)) || "");
          if (!key) return true;
          if (seen[key]) return false;
          seen[key] = 1;
          return true;
        });
        state.loaded = true;
      })
      .catch(function (err) {
        state.error = err.message || "客服奖励读取失败";
        state.loaded = true;
      })
      .finally(function () {
        state.loading = false;
        render();
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
    render();
    api("save_settings", { payload: payload })
      .then(function (res) {
        state.settings = res.settings || payload;
        state.message = res.message || "客服奖励设置已保存";
        return api("records", {}, "GET");
      })
      .then(function (res) {
        if (res && res.records) state.records = res.records;
      })
      .catch(function (err) {
        state.error = err.message || "保存失败";
      })
      .finally(function () {
        state.saving = false;
        render();
      });
  }

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-cs-reward-reload]")) {
      loadAll();
      return;
    }
    if (e.target.closest("[data-cs-reward-filter-apply]")) {
      var st = document.querySelector("[data-cs-reward-filter-status]");
      var sid = document.querySelector("[data-cs-reward-filter-service]");
      state.filterStatus = st ? String(st.value || "") : "";
      state.filterServiceId = sid ? String(sid.value || "").trim() : "";
      loadAll();
    }
  });

  document.addEventListener("submit", function (e) {
    if (e.target.matches("[data-cs-reward-settings-form]")) {
      e.preventDefault();
      saveSettings(e.target);
    }
  });

  function maybeLoad() {
    if (!document.getElementById("serviceAccountManagement")) return;
    if (!state.loaded && !state.loading) loadAll();
    else render();
  }

  window.__MCJRenderCsDockRewards = maybeLoad;

  document.addEventListener("DOMContentLoaded", maybeLoad);
  document.addEventListener("click", function (e) {
    var btn = e.target.closest('[data-section="service-accounts"]');
    if (btn) setTimeout(maybeLoad, 50);
  });
})();
