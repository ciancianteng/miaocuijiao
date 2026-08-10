/**
 * Admin · 组队大厅管理（首页入口单例设置）
 * SoT: platform_settings.data.teamLobbyEnabled + teamLobbyLink
 * Public: GET /api/platform/settings
 */
(function () {
  "use strict";

  var TARGET_ID = "teamLobbySettings";
  var state = {
    loading: true,
    saving: false,
    error: "",
    message: "",
    enabled: false,
    link: "",
  };

  function Auth() {
    return window.MCJAdminAuthFetch || null;
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function target() {
    return document.getElementById(TARGET_ID);
  }

  function apiGet() {
    var auth = Auth();
    if (auth && auth.get) return auth.get("/api/admin/platform-settings?action=settings_only");
    throw new Error("管理员登录态未就绪，请重新登录后台后再管理组队大厅。");
  }

  function apiPost(body) {
    var auth = Auth();
    if (auth && auth.post) return auth.post("/api/admin/platform-settings", body);
    throw new Error("管理员登录态未就绪，请重新登录后台后再管理组队大厅。");
  }

  function paint() {
    var el = target();
    if (!el) return;
    if (state.loading) {
      el.innerHTML = '<div class="content-loading">正在读取组队大厅设置...</div>';
      return;
    }
    el.innerHTML =
      '<div class="admin-team-lobby-panel">' +
      '<header class="admin-section-head compact"><div><h3>组队大厅管理</h3><p>控制老板端首页「组队大厅」是否开放，以及点击后打开的跳转链接。保存后写入数据库（platform_settings），刷新/重新登录仍保留。</p></div></header>' +
      (state.error ? '<div class="admin-sync-note" style="border-color:rgba(252,165,165,.35);color:#fecaca">' + esc(state.error) + "</div>" : "") +
      (state.message ? '<div class="admin-sync-note">' + esc(state.message) + "</div>" : "") +
      '<form class="admin-team-lobby-form" data-team-lobby-form>' +
      '<fieldset class="tl-status-fieldset">' +
      "<legend>组队大厅状态</legend>" +
      '<label class="tl-radio"><input type="radio" name="teamLobbyEnabled" value="true"' +
      (state.enabled ? " checked" : "") +
      '> <span>启用</span></label>' +
      '<label class="tl-radio"><input type="radio" name="teamLobbyEnabled" value="false"' +
      (state.enabled ? "" : " checked") +
      '> <span>停用</span></label>' +
      "</fieldset>" +
      '<label class="tl-link-field"><span>跳转链接</span><input name="teamLobbyLink" type="url" inputmode="url" placeholder="https://discord.gg/xxx 或其他组队大厅链接" value="' +
      esc(state.link) +
      '" autocomplete="off"><small>必须 https:// 开头。启用时必填；停用后老板端不可再进入旧链接。</small></label>' +
      '<div class="tl-actions">' +
      '<button class="mini-btn primary" type="submit" data-team-lobby-save' +
      (state.saving ? " disabled" : "") +
      ">" +
      (state.saving ? "保存中..." : "保存设置") +
      "</button>" +
      '<button class="mini-btn" type="button" data-team-lobby-reload>刷新</button>' +
      "</div>" +
      '<p class="tl-hint">当前状态：<strong>' +
      (state.enabled ? "启用" : "停用") +
      "</strong>" +
      (state.link ? " · 链接 " + esc(state.link) : " · 尚未填写链接") +
      "</p>" +
      "</form></div>";
  }

  function applySettings(settings) {
    settings = settings || {};
    state.enabled = settings.teamLobbyEnabled === true || settings.teamLobbyEnabled === "true";
    state.link = String(settings.teamLobbyLink || "").trim();
  }

  function load() {
    state.loading = true;
    state.error = "";
    state.message = "";
    paint();
    return apiGet()
      .then(function (res) {
        applySettings((res && res.settings) || {});
        state.loading = false;
        state.error = "";
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = (err && err.message) || "读取失败";
        paint();
      });
  }

  function save(form) {
    if (state.saving) return;
    var fd = new FormData(form);
    var enabled = String(fd.get("teamLobbyEnabled")) === "true";
    var link = String(fd.get("teamLobbyLink") || "").trim();
    if (enabled && !link) {
      alert("启用前必须填写跳转链接");
      return;
    }
    if (link && !/^https:\/\//i.test(link)) {
      alert("跳转链接必须是 https:// 开头的完整地址");
      return;
    }
    state.saving = true;
    state.message = "";
    state.error = "";
    paint();
    apiPost({
      action: "save_team_lobby",
      teamLobbyEnabled: enabled,
      teamLobbyLink: link,
      reason: "后台组队大厅管理保存",
    })
      .then(function (res) {
        applySettings((res && res.settings) || { teamLobbyEnabled: enabled, teamLobbyLink: link });
        state.saving = false;
        state.message = (res && res.message) || "已保存";
        paint();
      })
      .catch(function (err) {
        state.saving = false;
        state.error = (err && err.message) || "保存失败";
        paint();
      });
  }

  function onClick(e) {
    if (e.target.closest("[data-team-lobby-reload]")) {
      e.preventDefault();
      load();
      return;
    }
  }

  function onSubmit(e) {
    var form = e.target.closest("[data-team-lobby-form]");
    if (!form) return;
    e.preventDefault();
    save(form);
  }

  function maybeLoad(section) {
    if (section === "team-lobby-links" || section === "team-lobby") load();
  }

  function bind() {
    if (bind.done) return;
    bind.done = true;
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    document.addEventListener("mcj:admin-section", function (ev) {
      maybeLoad(ev && ev.detail && ev.detail.section);
    });
    // Fallback: observe active section changes from side-nav clicks
    document.addEventListener("click", function (e) {
      var btn = e.target.closest('.side-nav [data-section="team-lobby-links"]');
      if (btn) setTimeout(load, 0);
    });
  }

  function init() {
    bind();
    if (document.getElementById("section-team-lobby-links")?.classList.contains("active") || target()) {
      // Lazy: only fetch when section opened; still paint shell if present
      if (document.body.getAttribute("data-admin-section") === "team-lobby-links") load();
      else if (target() && !target().dataset.tlReady) {
        target().dataset.tlReady = "1";
        target().innerHTML =
          '<div class="admin-team-lobby-panel"><header class="admin-section-head compact"><div><h3>组队大厅管理</h3><p>点击左侧「组队大厅管理」后加载真实设置。</p></div></header><button class="mini-btn primary" type="button" data-team-lobby-reload>加载设置</button></div>';
      }
    }
  }

  window.MCJAdminTeamLobby = { reload: load, init: init };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
