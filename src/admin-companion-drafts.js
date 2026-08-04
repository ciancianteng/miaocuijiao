(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "companionDraftsMount";
  var state = { loading: true, error: "", rows: [], message: "" };

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
  function fmtTime(v) {
    if (!v) return "-";
    try {
      return new Date(v).toLocaleString("zh-CN", { hour12: false });
    } catch (e) {
      return String(v);
    }
  }
  function paint() {
    var box = document.getElementById(TARGET);
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="admin-sync-note">正在读取申请草稿…</div>';
      return;
    }
    if (state.error) {
      box.innerHTML =
        '<div class="admin-sync-note error">' +
        esc(state.error) +
        ' <button class="mini-btn" type="button" data-cdraft-reload>重试</button></div>';
      return;
    }
    var rows = state.rows || [];
    var body = rows
      .map(function (item) {
        var id = item.id || item.playerId || "";
        return (
          "<tr>" +
          "<td>" +
          esc(id) +
          "</td><td>" +
          esc(item.nickname || item.name || "-") +
          "</td><td>" +
          esc(item.email || item.phone || "-") +
          "</td><td>" +
          esc(item.game || item.mainGame || item.main_service || "-") +
          "</td><td>" +
          esc(fmtTime(item.updated_at || item.updatedAt || item.created_at)) +
          "</td><td>" +
          '<button class="mini-btn" type="button" data-cdraft-open="' +
          esc(id) +
          '">查看</button> ' +
          '<button class="mini-btn danger-btn" type="button" data-cdraft-archive="' +
          esc(id) +
          '">归档</button>' +
          "</td></tr>"
        );
      })
      .join("");
    box.innerHTML =
      '<div class="admin-section-head compact"><div><h3>申请草稿</h3><p>仅显示未正式提交审核的陪玩申请草稿。草稿不会出现在陪玩管理、大厅、排行榜等正式运营列表。超过 30 天将自动归档。</p></div>' +
      '<div class="content-admin-toolbar compact"><button class="mini-btn" type="button" data-cdraft-reload>刷新</button></div></div>' +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      '<div class="table-wrap"><table><thead><tr><th>ID</th><th>昵称</th><th>联系方式</th><th>游戏</th><th>最近更新</th><th>操作</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="6">暂无申请草稿</td></tr>') +
      "</tbody></table></div>";
  }
  function load() {
    state.loading = true;
    state.error = "";
    paint();
    api("/api/admin/players?scope=drafts")
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
  function archive(id) {
    if (!confirm("确认归档该申请草稿？归档后不再出现在草稿列表，也不会进入正式陪玩列表。")) return;
    return api("/api/admin/players", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive_draft", id: id, payload: {} }),
    }).then(function (res) {
      state.message = res.message || "已归档";
      if (window.MCJAdminPlayerBridge && window.MCJAdminPlayerBridge.reloadList) {
        window.MCJAdminPlayerBridge.reloadList();
      }
      load();
    }).catch(function (err) {
      alert(err.message || "归档失败");
    });
  }
  function openDetail(id) {
    if (window.MCJAdminPlayerBridge && window.MCJAdminPlayerBridge.reloadDetail) {
      window.MCJAdminPlayerBridge.reloadDetail(id, "view");
      return;
    }
  }
  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-cdraft-reload]")) {
      load();
      return;
    }
    var open = e.target.closest("[data-cdraft-open]");
    if (open) {
      openDetail(open.getAttribute("data-cdraft-open"));
      return;
    }
    var arch = e.target.closest("[data-cdraft-archive]");
    if (arch) {
      archive(arch.getAttribute("data-cdraft-archive"));
    }
  });
  function boot() {
    if (!document.getElementById(TARGET)) return;
    load();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  window.MCJAdminCompanionDrafts = { reload: load };
})();
