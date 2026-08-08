/**
 * Admin「邮件通知记录」— mounts into existing shell (no layout redesign).
 */
(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  if (!Auth) return;

  var state = { loading: false, error: "", logs: [], message: "" };

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
  function mount() {
    return document.getElementById("mailNotificationLogs");
  }
  function statusLabel(row) {
    if (row.success || row.status === "sent") return '<span class="status ok">成功</span>';
    if (row.status === "email_pending") return '<span class="status wait">待发送</span>';
    return '<span class="status danger">失败</span>';
  }
  function paint() {
    var box = mount();
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="content-loading">正在读取邮件通知记录...</div>';
      return;
    }
    if (state.error) {
      box.innerHTML =
        '<div class="empty"><strong>读取失败</strong><span>' +
        esc(state.error) +
        '</span><button class="btn" type="button" data-mail-log-reload>重试</button></div>';
      return;
    }
    var rows = (state.logs || [])
      .map(function (row) {
        return (
          "<tr>" +
          "<td>" +
          esc(row.recipient || "-") +
          "</td>" +
          "<td>" +
          esc(row.orderNo || "-") +
          "</td>" +
          "<td>" +
          esc(row.mailTypeLabel || row.mailType || "-") +
          "</td>" +
          "<td>" +
          esc(row.sentAt || row.createdAt || "-") +
          "</td>" +
          "<td>" +
          statusLabel(row) +
          "</td>" +
          "<td>" +
          esc(row.failReason || "-") +
          "</td>" +
          "<td>" +
          esc(row.retryCount || 0) +
          "</td>" +
          '<td><button class="btn small" type="button" data-mail-log-retry-one="' +
          esc(row.id) +
          '"' +
          (row.success ? " disabled" : "") +
          ">重试</button></td>" +
          "</tr>"
        );
      })
      .join("");
    box.innerHTML =
      '<div class="admin-section-head compact"><div><h3>邮件通知记录</h3><p>指定订单 / 状态变更 / 超时提醒的发送日志（notification_key 幂等，不会因刷新重复发送）。</p></div>' +
      '<div class="row"><button class="mini-btn" type="button" data-mail-log-reload>刷新</button>' +
      '<button class="mini-btn" type="button" data-mail-log-retry-failed>重试失败项</button></div></div>' +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      '<div class="table-wrap"><table class="admin-table"><thead><tr>' +
      "<th>收件人</th><th>订单编号</th><th>邮件类型</th><th>发送时间</th><th>成功/失败</th><th>失败原因</th><th>重试次数</th><th>操作</th>" +
      "</tr></thead><tbody>" +
      (rows || '<tr><td colspan="8"><div class="empty">暂无邮件通知记录</div></td></tr>') +
      "</tbody></table></div>";
  }
  function load() {
    state.loading = true;
    state.error = "";
    paint();
    var get = Auth.get
      ? Auth.get("/api/admin/mail-logs?limit=120", { "x-mcj-admin-role": role() })
      : Auth.fetch("/api/admin/mail-logs?limit=120", {
          headers: Auth.getAuthHeaders
            ? Auth.getAuthHeaders({ Accept: "application/json", "x-mcj-admin-role": role() })
            : { Accept: "application/json", "x-mcj-admin-role": role() },
        }).then(function (r) {
          return r.json();
        });
    Promise.resolve(get)
      .then(function (res) {
        state.loading = false;
        if (!res || res.ok === false) throw new Error((res && res.message) || "读取失败");
        state.logs = res.logs || [];
        state.message = res.configured === false ? res.message || "未配置数据库" : "";
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || String(err);
        paint();
      });
  }
  function post(action, payload) {
    return Auth.post
      ? Auth.post("/api/admin/mail-logs", Object.assign({ action: action }, payload || {}), {
          "x-mcj-admin-role": role(),
        })
      : Auth.fetch("/api/admin/mail-logs", {
          method: "POST",
          headers: Auth.getAuthHeaders
            ? Auth.getAuthHeaders({
                "Content-Type": "application/json",
                Accept: "application/json",
                "x-mcj-admin-role": role(),
              })
            : { "Content-Type": "application/json", Accept: "application/json", "x-mcj-admin-role": role() },
          body: JSON.stringify(Object.assign({ action: action }, payload || {})),
        }).then(function (r) {
          return r.json();
        });
  }
  document.addEventListener("click", function (e) {
    var box = mount();
    if (!box) return;
    if (e.target.closest("[data-mail-log-reload]")) {
      load();
      return;
    }
    if (e.target.closest("[data-mail-log-retry-failed]")) {
      post("retry_failed", { limit: 15 })
        .then(function (res) {
          state.message = (res && res.message) || "已触发重试";
          load();
        })
        .catch(function (err) {
          alert(err.message || "重试失败");
        });
      return;
    }
    var one = e.target.closest("[data-mail-log-retry-one]");
    if (one) {
      post("retry_one", { id: one.getAttribute("data-mail-log-retry-one") })
        .then(function (res) {
          state.message = (res && res.message) || "已触发重试";
          load();
        })
        .catch(function (err) {
          alert(err.message || "重试失败");
        });
    }
  });
  function maybeLoad() {
    if (!mount()) return;
    if (document.body.dataset.adminSection === "mail-logs" || location.hash === "#mail-logs") load();
  }
  window.addEventListener("hashchange", maybeLoad);
  document.addEventListener("DOMContentLoaded", function () {
    maybeLoad();
    // When admin suite activates section without hash race, observe dataset.
    var obs = new MutationObserver(maybeLoad);
    obs.observe(document.body, { attributes: true, attributeFilter: ["data-admin-section"] });
  });
  window.MCJAdminMailLogs = { reload: load };
})();
