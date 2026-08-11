(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "table-companion_applications";
  var state = { loading: true, error: "", rows: [], filter: "pending", message: "" };

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
  function statusCode(row) {
    return String(row.application_status || row.applicationStatus || row.verification_status || row.auditStatus || "pending").toLowerCase();
  }
  function statusLabel(code) {
    var key = String(code || "").toLowerCase().trim();
    var map = {
      draft: "草稿中",
      pending: "审核中",
      review: "审核中",
      submitted: "审核中",
      resubmit: "需要补资料",
      need_more: "需要补资料",
      approved: "审核通过",
      verified: "审核通过",
      passed: "审核通过",
      rejected: "审核未通过",
    };
    if (map[key]) return map[key];
    if (!key || /^[a-z][a-z0-9_]*$/i.test(key)) return "-";
    return String(code);
  }
  function isApplicationQueue(row) {
    var code = statusCode(row);
    if (/approved|verified|passed/.test(code) && !row.application_submitted_at && !row.applicationSubmittedAt) {
      /* still show if they have submitted_at */
    }
    return !!row.id && (row.application_submitted_at || row.applicationSubmittedAt || row.game || row.mainGame || row.main_service || /pending|resubmit|rejected|approved|review|submitted/.test(code));
  }
  function filteredRows() {
    var list = (state.rows || []).filter(isApplicationQueue);
    var f = state.filter || "all";
    if (f === "all") return list;
    if (f === "pending") return list.filter(function (r) { return /pending|review|submitted/.test(statusCode(r)); });
    if (f === "resubmit") return list.filter(function (r) { return /resubmit|need_more/.test(statusCode(r)); });
    if (f === "approved") return list.filter(function (r) { return /approved|verified|passed/.test(statusCode(r)); });
    if (f === "rejected") return list.filter(function (r) { return /rejected/.test(statusCode(r)); });
    return list;
  }
  function paint() {
    var box = document.getElementById(TARGET);
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="admin-sync-note">正在读取陪玩申请…</div>';
      return;
    }
    if (state.error) {
      box.innerHTML =
        '<div class="admin-sync-note error">' +
        esc(state.error) +
        ' <button class="mini-btn" type="button" data-capp-reload>重试</button></div>';
      return;
    }
    var rows = filteredRows();
    var body = rows
      .map(function (item) {
        var code = statusCode(item);
        var id = item.id || item.playerId || "";
        return (
          "<tr>" +
          "<td>" +
          esc(id) +
          "</td><td>" +
          esc(item.nickname || item.name || "-") +
          "</td><td>" +
          esc(item.phone || item.email || "-") +
          "</td><td>" +
          esc(item.game || item.mainGame || item.main_service || "-") +
          "</td><td>" +
          esc(statusLabel(code)) +
          "</td><td>" +
          esc(item.depositStatus || item.deposit_status || "-") +
          "</td><td>" +
          '<button class="mini-btn primary-lite" type="button" data-capp-open="' +
          esc(id) +
          '">审核</button> ' +
          '<button class="mini-btn" type="button" data-capp-approve="' +
          esc(id) +
          '">通过</button> ' +
          '<button class="mini-btn" type="button" data-capp-resubmit="' +
          esc(id) +
          '">补资料</button> ' +
          '<button class="mini-btn danger-btn" type="button" data-capp-reject="' +
          esc(id) +
          '">拒绝</button>' +
          "</td></tr>"
        );
      })
      .join("");
    box.innerHTML =
      '<div class="admin-section-head compact"><div><h3>陪玩申请审核</h3><p>查看申请人完整资料、媒体与敏感认证信息；通过后开通陪玩端登录（默认离线，须完成身份与押金后才可接单）。</p></div>' +
      '<div class="content-admin-toolbar compact"><select data-capp-filter>' +
      [
        ["pending", "审核中"],
        ["resubmit", "需要补资料"],
        ["approved", "审核通过"],
        ["rejected", "审核未通过"],
        ["all", "全部"],
      ]
        .map(function (pair) {
          return (
            '<option value="' +
            pair[0] +
            '" ' +
            (state.filter === pair[0] ? "selected" : "") +
            ">" +
            pair[1] +
            "</option>"
          );
        })
        .join("") +
      '</select><button class="mini-btn" type="button" data-capp-reload>刷新</button></div></div>' +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      '<div class="table-wrap"><table><thead><tr><th>申请ID</th><th>昵称</th><th>联系方式</th><th>游戏</th><th>申请状态</th><th>押金</th><th>操作</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="7">暂无陪玩申请</td></tr>') +
      "</tbody></table></div>";
  }
  function load() {
    state.loading = true;
    state.error = "";
    paint();
    api("/api/admin/players")
      .then(function (res) {
        state.rows = res.players || res.data || [];
        state.loading = false;
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || "读取失败";
        paint();
      });
  }
  function review(id, status, reason) {
    return api("/api/admin/players", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "review_application",
        id: id,
        payload: { status: status, rejectReason: reason || "" },
      }),
    }).then(function (res) {
      state.message = res.message || "审核已保存";
      if (window.MCJAdminPlayerBridge && window.MCJAdminPlayerBridge.reloadList) {
        window.MCJAdminPlayerBridge.reloadList();
      }
      load();
      return res;
    });
  }
  function openDetail(id) {
    if (window.MCJAdminPlayerBridge && window.MCJAdminPlayerBridge.reloadDetail) {
      window.MCJAdminPlayerBridge.reloadDetail(id, "edit");
      return;
    }
    var btn = document.querySelector('[data-player-action="edit"][data-player-id="' + id + '"]');
    if (btn) btn.click();
  }
  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-capp-reload]")) {
      load();
      return;
    }
    var open = e.target.closest("[data-capp-open]");
    if (open) {
      openDetail(open.getAttribute("data-capp-open"));
      return;
    }
    var approve = e.target.closest("[data-capp-approve]");
    if (approve) {
      if (!confirm("确认通过该陪玩申请？通过后可登录陪玩端，默认离线。")) return;
      review(approve.getAttribute("data-capp-approve"), "approved", "")
        .then(function () {
          alert("已通过。申请人可登录陪玩端；完成身份认证与押金审核后才可接单。");
        })
        .catch(function (err) {
          alert(err.message || "操作失败");
        });
      return;
    }
    var resubmit = e.target.closest("[data-capp-resubmit]");
    if (resubmit) {
      var reason = prompt("请填写需要补交的资料说明（必填）", "");
      if (reason == null) return;
      if (!String(reason).trim()) {
        alert("要求补资料时必须填写原因");
        return;
      }
      review(resubmit.getAttribute("data-capp-resubmit"), "resubmit", reason).catch(function (err) {
        alert(err.message || "操作失败");
      });
      return;
    }
    var reject = e.target.closest("[data-capp-reject]");
    if (reject) {
      var reason2 = prompt("请填写拒绝原因（必填）", "");
      if (reason2 == null) return;
      if (!String(reason2).trim()) {
        alert("拒绝时必须填写原因");
        return;
      }
      review(reject.getAttribute("data-capp-reject"), "rejected", reason2).catch(function (err) {
        alert(err.message || "操作失败");
      });
    }
  });
  document.addEventListener("change", function (e) {
    if (e.target.matches("[data-capp-filter]")) {
      state.filter = e.target.value || "pending";
      paint();
    }
  });
  function maybeLoad() {
    if (document.getElementById(TARGET)) load();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", maybeLoad);
  } else {
    maybeLoad();
  }
  window.addEventListener("hashchange", function () {
    if ((location.hash || "").replace("#", "") === "companion-applications") load();
  });
  window.MCJAdminCompanionApplicationsReload = load;
})();
