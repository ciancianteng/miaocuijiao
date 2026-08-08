(function () {
  "use strict";

  var Auth = window.MCJAdminAuthFetch;
  var TARGET_ID = "companionVoiceTypeManagement";
  var state = {
    loading: true,
    saving: false,
    error: "",
    message: "",
    items: [],
    editing: null,
    formOpen: false,
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function target() {
    return document.getElementById(TARGET_ID);
  }

  function apiGet() {
    if (Auth && Auth.get) return Auth.get("/api/admin/companion-voice-types");
    return fetch("/api/admin/companion-voice-types", {
      headers: { Accept: "application/json", "x-mcj-admin-role": "admin" },
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.ok === false) throw new Error(body.message || "读取失败");
        return body;
      });
    });
  }

  function apiPost(body) {
    if (Auth && Auth.post) return Auth.post("/api/admin/companion-voice-types", body);
    return fetch("/api/admin/companion-voice-types", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mcj-admin-role": "admin" },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || data.ok === false) throw new Error(data.message || "保存失败");
        return data;
      });
    });
  }

  function blank() {
    return {
      id: "",
      name: "",
      description: "",
      sort: (state.items.length + 1) * 10,
      enabled: true,
    };
  }

  function formTitle() {
    return state.editing && state.editing.id ? "编辑声线" : "新增声线";
  }

  function openFormOverlay() {
    if (!state.formOpen || !state.editing) return false;
    if (window.MCJAdminOverlay) {
      window.MCJAdminOverlay.open({
        title: formTitle(),
        html: formHtml(state.editing),
        onClose: function () {
          state.formOpen = false;
          state.editing = null;
        },
      });
      return true;
    }
    return false;
  }

  function closeFormOverlay() {
    if (window.MCJAdminOverlay && window.MCJAdminOverlay.isOpen && window.MCJAdminOverlay.isOpen()) {
      window.MCJAdminOverlay.close();
      return;
    }
    state.formOpen = false;
    state.editing = null;
    render();
  }

  function formHtml(row) {
    row = row || blank();
    return (
      '<form class="admin-self-form" data-voice-type-form>' +
      '<input type="hidden" name="id" value="' +
      esc(row.id || "") +
      '">' +
      '<div class="form-grid">' +
      '<label><span>声线名称</span><input name="name" required value="' +
      esc(row.name || "") +
      '" placeholder="甜妹 / 御姐 / 萝莉音"></label>' +
      '<label><span>说明</span><input name="description" value="' +
      esc(row.description || "") +
      '" placeholder="可选说明"></label>' +
      '<label><span>排序</span><input name="sort" type="number" value="' +
      esc(row.sort || 100) +
      '"></label>' +
      '<label><span>状态</span><select name="enabled" data-admin-control="switch"><option value="true"' +
      (row.enabled !== false ? " selected" : "") +
      ">启用</option><option value=\"false\"" +
      (row.enabled === false ? " selected" : "") +
      ">停用</option></select></label>" +
      "</div>" +
      '<div class="row" style="margin-top:12px;gap:10px">' +
      '<button class="primary-btn" type="submit">保存声线</button>' +
      '<button class="ghost-btn" type="button" data-voice-cancel>取消</button>' +
      "</div>" +
      "</form>"
    );
  }

  function rowsHtml() {
    if (!state.items.length) {
      return '<tr><td colspan="5"><div class="empty">暂无声线。点击新增，添加甜妹、御姐、萝莉音等（与标签完全分开）。</div></td></tr>';
    }
    return state.items
      .map(function (item) {
        return (
          "<tr>" +
          "<td><strong>" +
          esc(item.name) +
          "</strong></td>" +
          "<td>" +
          esc(item.description || "-") +
          "</td>" +
          "<td>" +
          esc(item.sort) +
          "</td>" +
          '<td><span class="status ' +
          (item.enabled !== false ? "ok" : "wait") +
          '">' +
          (item.enabled !== false ? "启用" : "停用") +
          "</span></td>" +
          '<td><div class="row"><button class="mini-btn" type="button" data-voice-edit="' +
          esc(item.id) +
          '">编辑</button>' +
          '<button class="mini-btn" type="button" data-voice-toggle="' +
          esc(item.id) +
          '" data-enabled="' +
          (item.enabled !== false ? "false" : "true") +
          '">' +
          (item.enabled !== false ? "停用" : "启用") +
          "</button>" +
          '<button class="mini-btn" type="button" data-voice-delete="' +
          esc(item.id) +
          '">删除</button></div></td>' +
          "</tr>"
        );
      })
      .join("");
  }

  function pageHtml() {
    if (state.loading) return '<div class="content-loading">正在读取声线...</div>';
    return (
      '<div class="content-admin-head"><div><h3>声线管理</h3><p>声线与标签分开：声线如甜妹/御姐/萝莉音；标签如随和/技术流。陪玩在资料页必选，四端同步显示「声线：xxx」。</p></div>' +
      '<div class="content-version-meta"><span>' +
      esc(state.items.length) +
      " 个声线</span><span>" +
      esc(state.message || state.error || "保存后立即同步陪玩端选项") +
      "</span></div></div>" +
      '<div class="content-admin-toolbar compact"><button class="btn primary" type="button" data-voice-new>新增声线</button><button class="btn" type="button" data-voice-reload>刷新</button></div>' +
      (!window.MCJAdminOverlay && state.formOpen
        ? '<div class="panel" style="margin-bottom:14px">' + formHtml(state.editing) + "</div>"
        : "") +
      '<div class="table-wrap"><table><thead><tr><th>声线名称</th><th>说明</th><th>排序</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
      rowsHtml() +
      "</tbody></table></div>"
    );
  }

  function render() {
    var el = target();
    if (!el) return;
    el.innerHTML = pageHtml();
    if (window.MCJAdminForms && window.MCJAdminForms.enhance) window.MCJAdminForms.enhance(el);
    bind();
  }

  function load() {
    state.loading = true;
    render();
    apiGet()
      .then(function (result) {
        state.items = result.items || result.voiceTypes || [];
        state.loading = false;
        state.message = "已加载声线";
        state.error = "";
        render();
      })
      .catch(function (err) {
        state.items = [];
        state.loading = false;
        state.error = err.message || "读取失败";
        render();
      });
  }

  function collect(form) {
    var fd = new FormData(form);
    return {
      id: String(fd.get("id") || "").trim(),
      name: String(fd.get("name") || "").trim(),
      description: String(fd.get("description") || "").trim(),
      sort: Number(fd.get("sort") || 100),
      enabled: String(fd.get("enabled")) !== "false",
    };
  }

  function bind() {
    var el = target();
    if (!el || el.dataset.voiceBound === "1") return;
    el.dataset.voiceBound = "1";

    el.addEventListener("click", function (e) {
      if (e.target.closest("[data-voice-new]")) {
        state.editing = blank();
        state.formOpen = true;
        if (!openFormOverlay()) render();
        return;
      }
      if (e.target.closest("[data-voice-reload]")) {
        load();
        return;
      }
      var edit = e.target.closest("[data-voice-edit]");
      if (edit) {
        var row = state.items.find(function (item) {
          return String(item.id) === String(edit.getAttribute("data-voice-edit"));
        });
        if (!row) return;
        state.editing = Object.assign({}, row);
        state.formOpen = true;
        if (!openFormOverlay()) render();
        return;
      }
      var toggle = e.target.closest("[data-voice-toggle]");
      if (toggle) {
        var enable = String(toggle.getAttribute("data-enabled")) === "true";
        apiPost({
          action: enable ? "enable" : "disable",
          id: toggle.getAttribute("data-voice-toggle"),
        })
          .then(function (res) {
            state.items = res.items || state.items;
            state.message = res.message || (enable ? "已启用" : "已停用");
            render();
          })
          .catch(function (err) {
            state.error = err.message || "操作失败";
            render();
          });
        return;
      }
      var del = e.target.closest("[data-voice-delete]");
      if (del) {
        if (!confirm("确认删除该声线？陪玩端将不再显示此选项。")) return;
        apiPost({ action: "delete", id: del.getAttribute("data-voice-delete") })
          .then(function (res) {
            state.items = res.items || [];
            state.message = res.message || "已删除";
            render();
          })
          .catch(function (err) {
            state.error = err.message || "删除失败";
            render();
          });
      }
    });

    el.addEventListener("submit", function (e) {
      var form = e.target.closest("[data-voice-type-form]");
      if (!form) return;
      e.preventDefault();
      if (state.saving) return;
      state.saving = true;
      var payload = collect(form);
      apiPost({ action: "save", id: payload.id, payload: payload })
        .then(function (res) {
          state.saving = false;
          state.items = res.items || state.items;
          state.message = res.message || "已保存，四端选项将同步";
          closeFormOverlay();
          state.formOpen = false;
          state.editing = null;
          render();
          if (window.MCJTaxonomy) {
            if (window.MCJTaxonomy.notifyChanged) window.MCJTaxonomy.notifyChanged();
            else if (window.MCJTaxonomy.reload) window.MCJTaxonomy.reload();
          }
        })
        .catch(function (err) {
          state.saving = false;
          state.error = err.message || "保存失败";
          render();
          if (state.formOpen) openFormOverlay();
        });
    });

    el.addEventListener("click", function (e) {
      if (e.target.closest("[data-voice-cancel]")) {
        closeFormOverlay();
        state.formOpen = false;
        state.editing = null;
        render();
      }
    });

    document.addEventListener("submit", function (e) {
      var form = e.target.closest("[data-voice-type-form]");
      if (!form || !window.MCJAdminOverlay || !window.MCJAdminOverlay.isOpen || !window.MCJAdminOverlay.isOpen()) return;
      e.preventDefault();
      if (state.saving) return;
      state.saving = true;
      var payload = collect(form);
      apiPost({ action: "save", id: payload.id, payload: payload })
        .then(function (res) {
          state.saving = false;
          state.items = res.items || state.items;
          state.message = res.message || "已保存";
          closeFormOverlay();
          state.formOpen = false;
          state.editing = null;
          render();
          if (window.MCJTaxonomy) {
            if (window.MCJTaxonomy.notifyChanged) window.MCJTaxonomy.notifyChanged();
            else if (window.MCJTaxonomy.reload) window.MCJTaxonomy.reload();
          }
        })
        .catch(function (err) {
          state.saving = false;
          alert(err.message || "保存失败");
        });
    });
  }

  function boot() {
    if (!target()) return;
    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.MCJAdminCompanionVoiceTypes = { reload: load };
})();
